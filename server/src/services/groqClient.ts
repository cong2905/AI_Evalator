import { z } from 'zod';
import { ApiError } from '../errors.js';
import { loadEnv } from '../env.js';
import { buildUserMessage, EVALUATION_JSON_SCHEMA, SYSTEM_PROMPT } from './prompts.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** SPEC.md section 7. */
const TIMEOUT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_CEILING_S = 20;
const MAX_BAD_OUTPUT_RETRIES = 1;
const MAX_SERVER_RETRIES = 1;
const SERVER_RETRY_DELAY_MS = 2_000;

/** The model's own JSON shape (snake_case); mapped to DTOs by the caller. */
export const evaluationPayloadSchema = z.object({
  summary: z.string(),
  missing_keywords: z.array(z.string()),
  requirements: z.array(
    z.object({
      requirement: z.string().min(1),
      category: z.enum(['skill', 'experience', 'education', 'tool', 'soft']),
      importance: z.enum(['must', 'nice']),
      evidence: z.string(),
      status: z.enum(['met', 'partial', 'missing']),
    }),
  ),
});
export type EvaluationPayload = z.infer<typeof evaluationPayloadSchema>;

export type EvaluationResult = {
  payload: EvaluationPayload;
  model: string;
};

export type GroqDeps = {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
};

const defaultDeps: GroqDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Seconds from the `retry-after` header, or a conservative default. */
function parseRetryAfter(headers: Headers): number {
  const raw = headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  return 30;
}

function buildBody(model: string, resumeText: string, jdText: string) {
  return {
    model,
    temperature: 0.1,
    reasoning_effort: 'low',
    max_completion_tokens: 2500,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'job_evaluation', strict: true, schema: EVALUATION_JSON_SCHEMA },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(resumeText, jdText) },
    ],
  };
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** Logs what the free-plan budget cares about. Never the key, never the resume. */
function logCall(model: string, latencyMs: number, usage: Usage | undefined, note = ''): void {
  const tokens = usage
    ? `${usage.prompt_tokens ?? '?'}+${usage.completion_tokens ?? '?'}=${usage.total_tokens ?? '?'}`
    : 'n/a';
  console.log(`[groq] model=${model} tokens=${tokens} latency=${latencyMs}ms${note}`);
}

/**
 * One evaluation, with the retry policy from SPEC.md section 7:
 * - 429: honour `retry-after` when it is short, otherwise hand RATE_LIMITED to the client
 * - bad schema / bad JSON: one more try, then AI_BAD_OUTPUT
 * - 5xx, network error, timeout: one more try after 2s, then AI_UNAVAILABLE
 */
export async function evaluateWithGroq(
  resumeText: string,
  jdText: string,
  deps: GroqDeps = defaultDeps,
): Promise<EvaluationResult> {
  const env = loadEnv();
  const model = env.GROQ_MODEL;
  const body = JSON.stringify(buildBody(model, resumeText, jdText));

  let rateLimitRetries = 0;
  let badOutputRetries = 0;
  let serverRetries = 0;

  for (;;) {
    const startedAt = Date.now();
    let res: Response;

    try {
      res = await deps.fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or the 60s timeout firing.
      const reason = err instanceof Error ? err.name : 'unknown';
      if (serverRetries < MAX_SERVER_RETRIES) {
        serverRetries += 1;
        console.warn(`[groq] ${reason}; retrying in ${SERVER_RETRY_DELAY_MS}ms`);
        await deps.sleep(SERVER_RETRY_DELAY_MS);
        continue;
      }
      console.error(`[groq] giving up after ${reason}`);
      throw new ApiError('AI_UNAVAILABLE', 'Could not reach Groq. Check your connection and retry.');
    }

    const latencyMs = Date.now() - startedAt;

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers);
      if (retryAfter <= RATE_LIMIT_WAIT_CEILING_S && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        rateLimitRetries += 1;
        console.warn(`[groq] rate limited; waiting ${retryAfter}s (retry ${rateLimitRetries})`);
        await deps.sleep(retryAfter * 1000);
        continue;
      }
      throw new ApiError(
        'RATE_LIMITED',
        `Groq is busy, try again in ${retryAfter}s`,
        retryAfter,
      );
    }

    if (res.status === 401 || res.status === 403) {
      // Retrying cannot fix a bad key.
      throw new ApiError('AI_UNAVAILABLE', 'Groq rejected the API key in server/.env.');
    }

    if (res.status >= 500) {
      if (serverRetries < MAX_SERVER_RETRIES) {
        serverRetries += 1;
        console.warn(`[groq] HTTP ${res.status}; retrying in ${SERVER_RETRY_DELAY_MS}ms`);
        await deps.sleep(SERVER_RETRY_DELAY_MS);
        continue;
      }
      throw new ApiError('AI_UNAVAILABLE', 'Groq is having trouble right now. Try again shortly.');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const schemaProblem = /schema/i.test(detail);

      if (schemaProblem && badOutputRetries < MAX_BAD_OUTPUT_RETRIES) {
        badOutputRetries += 1;
        console.warn(`[groq] HTTP ${res.status} schema rejection; retrying once`);
        continue;
      }
      console.error(`[groq] HTTP ${res.status}: ${detail.slice(0, 300)}`);
      throw new ApiError(
        schemaProblem ? 'AI_BAD_OUTPUT' : 'AI_UNAVAILABLE',
        schemaProblem
          ? 'The model did not return a usable comparison. Try again.'
          : `Groq refused the request (HTTP ${res.status}).`,
      );
    }

    const envelope = (await res.json().catch(() => undefined)) as
      | { choices?: Array<{ message?: { content?: string } }>; usage?: Usage }
      | undefined;
    const content = envelope?.choices?.[0]?.message?.content;
    logCall(model, latencyMs, envelope?.usage);

    const parsed = safeParsePayload(content);
    if (parsed) return { payload: parsed, model };

    if (badOutputRetries < MAX_BAD_OUTPUT_RETRIES) {
      badOutputRetries += 1;
      console.warn('[groq] response failed validation; retrying once');
      continue;
    }
    throw new ApiError(
      'AI_BAD_OUTPUT',
      'The model did not return a usable comparison. Try again.',
    );
  }
}

/** Strict mode should guarantee this, but validate anyway (defence in depth). */
function safeParsePayload(content: string | undefined): EvaluationPayload | undefined {
  if (!content) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return undefined;
  }

  const result = evaluationPayloadSchema.safeParse(json);
  return result.success ? result.data : undefined;
}
