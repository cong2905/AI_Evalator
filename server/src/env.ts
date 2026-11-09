import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of the server workspace root, used for .env and data/app.db. */
export const SERVER_ROOT = serverRoot;

const envSchema = z.object({
  GROQ_API_KEY: z.string().trim().min(1),
  GROQ_MODEL: z.string().trim().min(1).default('openai/gpt-oss-120b'),
  /** Signs the visitor session cookie. Any long random string; changing it logs everyone out. */
  SESSION_SECRET: z.string().trim().min(16),
  PORT: z.coerce.number().int().positive().default(3001),
  /** Override for tests; ':memory:' keeps the database off disk. */
  DB_PATH: z.string().trim().min(1).optional(),
  /**
   * Hosted libSQL (Turso). Set this and the app stops using a local file, which
   * is what lets it run on a host whose disk is wiped on every restart. Takes
   * precedence over DB_PATH.
   */
  TURSO_DATABASE_URL: z.string().trim().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().trim().min(1).optional(),
})
  .superRefine((env, ctx) => {
    if (!env.TURSO_DATABASE_URL) return;

    const local = /^(file:|:memory:)/.test(env.TURSO_DATABASE_URL);
    // A remote database without a token connects and then fails every query
    // with an auth error, which looks like a database bug rather than a missing
    // variable. Catch it at startup instead.
    if (!local && !env.TURSO_AUTH_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURSO_AUTH_TOKEN'],
        message: 'Required when TURSO_DATABASE_URL points at a hosted database.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validates an environment bag. Throws with an actionable message so the process
 * dies loudly at startup instead of failing on the first Groq call.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid server environment.\n${problems}\n\n` +
        `Fix: copy .env.example to server/.env, fill in GROQ_API_KEY ` +
        `(from https://console.groq.com/keys) and set SESSION_SECRET to a long random string ` +
        `(node -e "console.log(crypto.randomUUID()+crypto.randomUUID())").`,
    );
  }

  return parsed.data;
}

/** Reads server/.env into process.env (existing vars win), then validates. Cached. */
export function loadEnv(): Env {
  if (cached) return cached;

  dotenv.config({ path: path.join(serverRoot, '.env') });
  cached = parseEnv(process.env);
  return cached;
}

/** Test helper: forget the cached env so the next loadEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
