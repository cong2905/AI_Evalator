import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateWithGroq, type GroqDeps } from '../src/services/groqClient.js';
import { ApiError } from '../src/errors.js';

const GOOD_PAYLOAD = {
  summary: 'Strong overall fit with a gap in testing tools.',
  missing_keywords: ['Playwright'],
  requirements: [
    {
      requirement: '3+ years React',
      category: 'skill',
      importance: 'must',
      evidence: 'Built React dashboards, 2021-present',
      status: 'met',
    },
  ],
};

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

function chatResponse(payload: unknown, usage: Usage = { total_tokens: 1234 }) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }], usage }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

/** Awaits a call that must reject, and hands back the ApiError it threw. */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const outcome = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

/** Returns the queued responses in order; a thrown value simulates a network failure. */
function stubFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const next = responses.shift();
    if (next === undefined) throw new Error('fetch called more times than the test expected');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fn, calls };
}

let sleep: GroqDeps['sleep'];
let slept: number[];

beforeEach(() => {
  slept = [];
  sleep = vi.fn(async (ms: number) => {
    slept.push(ms);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('request shape', () => {
  it('sends the model, strict schema and both messages', async () => {
    const { fn, calls } = stubFetch(chatResponse(GOOD_PAYLOAD));

    await evaluateWithGroq('RESUME TEXT', 'JD TEXT', { fetch: fn as never, sleep });

    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.temperature).toBe(0.1);
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(2500);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('strict, fair technical recruiter');
    expect(body.messages[1].content).toBe('RESUME:\nRESUME TEXT\n\nJOB DESCRIPTION:\nJD TEXT');
  });

  it('authorizes with the key from the environment', async () => {
    const { fn, calls } = stubFetch(chatResponse(GOOD_PAYLOAD));

    await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-not-real');
  });

  it('returns the validated payload and the model used', async () => {
    const { fn } = stubFetch(chatResponse(GOOD_PAYLOAD));

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(result.model).toBe('openai/gpt-oss-120b');
    expect(result.payload.requirements).toHaveLength(1);
    expect(result.payload.summary).toContain('Strong overall fit');
  });
});

describe('rate limiting', () => {
  it('waits and retries when retry-after is short', async () => {
    const { fn } = stubFetch(
      errorResponse(429, '', { 'retry-after': '5' }),
      chatResponse(GOOD_PAYLOAD),
    );

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(slept).toEqual([5000]);
    expect(result.payload.requirements).toHaveLength(1);
  });

  it('gives up after two waits and reports retryAfter to the client', async () => {
    const { fn } = stubFetch(
      errorResponse(429, '', { 'retry-after': '5' }),
      errorResponse(429, '', { 'retry-after': '5' }),
      errorResponse(429, '', { 'retry-after': '7' }),
    );

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(7);
    expect(slept).toEqual([5000, 5000]);
  });

  it('does not wait when retry-after is longer than 20s', async () => {
    const { fn } = stubFetch(errorResponse(429, '', { 'retry-after': '40' }));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfter).toBe(40);
    expect(err.message).toMatch(/try again in 40s/);
    expect(slept).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back to 30s when the header is missing', async () => {
    const { fn } = stubFetch(errorResponse(429));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.retryAfter).toBe(30);
  });
});

describe('server and network trouble', () => {
  it('retries a 5xx once after 2s', async () => {
    const { fn } = stubFetch(errorResponse(503), chatResponse(GOOD_PAYLOAD));

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(slept).toEqual([2000]);
    expect(result.payload.summary).toBeTruthy();
  });

  it('reports AI_UNAVAILABLE after a second 5xx', async () => {
    const { fn } = stubFetch(errorResponse(500), errorResponse(500));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure once', async () => {
    const { fn } = stubFetch(new TypeError('fetch failed'), chatResponse(GOOD_PAYLOAD));

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(slept).toEqual([2000]);
    expect(result.model).toBe('openai/gpt-oss-120b');
  });

  it('reports AI_UNAVAILABLE after a second network failure', async () => {
    const { fn } = stubFetch(new TypeError('fetch failed'), new TypeError('fetch failed'));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_UNAVAILABLE');
  });

  it('does not retry a rejected API key', async () => {
    const { fn } = stubFetch(errorResponse(401, 'invalid api key'));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.message).toMatch(/key/i);
    expect(err.message).not.toContain('test-key-not-real');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('bad model output', () => {
  it('retries once when the JSON does not validate, then succeeds', async () => {
    const { fn } = stubFetch(
      chatResponse({ summary: 'oops', missing_keywords: [] }), // no requirements key
      chatResponse(GOOD_PAYLOAD),
    );

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.payload.requirements).toHaveLength(1);
  });

  it('reports AI_BAD_OUTPUT after a second invalid payload', async () => {
    const { fn } = stubFetch(chatResponse({ nope: true }), chatResponse({ nope: true }));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_BAD_OUTPUT');
    expect(err.status).toBe(502);
  });

  it('rejects an out-of-enum status even though strict mode should prevent it', async () => {
    const bad = {
      ...GOOD_PAYLOAD,
      requirements: [{ ...GOOD_PAYLOAD.requirements[0], status: 'maybe' }],
    };
    const { fn } = stubFetch(chatResponse(bad), chatResponse(bad));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_BAD_OUTPUT');
  });

  it('handles content that is not JSON at all', async () => {
    const notJson = new Response(
      JSON.stringify({ choices: [{ message: { content: 'Sure! Here is the table:' } }] }),
      { status: 200 },
    );
    const { fn } = stubFetch(notJson, chatResponse(GOOD_PAYLOAD));

    const result = await evaluateWithGroq('r', 'j', { fetch: fn as never, sleep });

    expect(result.payload.requirements).toHaveLength(1);
  });

  it('retries a 400 schema rejection once, then reports AI_BAD_OUTPUT', async () => {
    const body = JSON.stringify({ error: { message: 'does not match the expected schema' } });
    const { fn } = stubFetch(errorResponse(400, body), errorResponse(400, body));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(fn).toHaveBeenCalledTimes(2);
    expect(err.code).toBe('AI_BAD_OUTPUT');
  });

  it('does not retry an unrelated 400', async () => {
    const { fn } = stubFetch(errorResponse(400, '{"error":{"message":"bad model id"}}'));

    const err = await failure(evaluateWithGroq('r', 'j', { fetch: fn as never, sleep }));

    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('logging', () => {
  it('logs model, tokens and latency but never the key or the resume', async () => {
    const { fn } = stubFetch(
      chatResponse(GOOD_PAYLOAD, {
        prompt_tokens: 900,
        completion_tokens: 300,
        total_tokens: 1200,
      }),
    );

    await evaluateWithGroq('SECRET RESUME CONTENT', 'jd', { fetch: fn as never, sleep });

    const logged = vi.mocked(console.log).mock.calls.flat().join(' ');
    expect(logged).toContain('model=openai/gpt-oss-120b');
    expect(logged).toContain('900+300=1200');
    expect(logged).toMatch(/latency=\d+ms/);
    expect(logged).not.toContain('test-key-not-real');
    expect(logged).not.toContain('SECRET RESUME CONTENT');
  });
});
