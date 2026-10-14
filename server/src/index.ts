import { loadEnv, type Env } from './env.js';
import { getDb, resolveDbPath } from './db/db.js';
import { createApp } from './app.js';
import { startPurgeSchedule } from './retention.js';

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

  const db = getDb(); // opens the file and runs migrations before we accept requests
  console.log(`[startup] database ready at ${resolveDbPath()}`);

  // Enforces the retention window now and once a day after that.
  startPurgeSchedule(db);

  const app = createApp();

  // Locally this binds to loopback only (SPEC.md section 9). In a container the
  // platform's proxy reaches it from outside, so it has to listen on all
  // interfaces — TLS and the public edge are the platform's job.
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  const server = app.listen(env.PORT, host, () => {
    console.log(`[startup] listening on http://${host}:${env.PORT} · model ${env.GROQ_MODEL}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main();
