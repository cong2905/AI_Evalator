import { loadEnv, type Env } from './env.js';
import { getDb, resolveDbPath } from './db/db.js';
import { createApp } from './app.js';

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    console.error(`\n[startup] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

function main(): void {
  const env = loadEnvOrExit();

  getDb(); // opens the file and runs migrations before we accept requests
  console.log(`[startup] database ready at ${resolveDbPath()}`);

  const app = createApp();
  // Localhost only — this app holds personal data and has no auth (SPEC.md section 9).
  const server = app.listen(env.PORT, '127.0.0.1', () => {
    console.log(`[startup] API on http://127.0.0.1:${env.PORT} · model ${env.GROQ_MODEL}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main();
