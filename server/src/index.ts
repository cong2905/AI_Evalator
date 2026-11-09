import { loadEnv, type Env } from './env.js';
import { describeDbTarget, getDb } from './db/db.js';
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

async function main(): Promise<void> {
  const env = loadEnvOrExit();

  // Connects and runs migrations before we accept requests. A hosted database
  // can be unreachable, so this is the one place that failure is worth dying
  // on: serving an app whose database is absent only produces 500s.
  const db = await getDb();
  console.log(`[startup] database ready at ${describeDbTarget()}`);

  // Enforces the retention window now and once a day after that.
  await startPurgeSchedule(db);

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

main().catch((err: unknown) => {
  console.error(`\n[startup] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
