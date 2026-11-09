import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type Config } from '@libsql/client';
import { loadEnv, SERVER_ROOT } from '../env.js';
import { get, run } from './sql.js';

export type Db = Client;

/** SPEC.md section 4. Idempotent: safe to run on every startup. */
const SCHEMA_SQL = `
-- The schema version lives in a table rather than in PRAGMA user_version so
-- that it reads and writes identically on a local file and on a hosted libSQL
-- database, where PRAGMA support is not guaranteed.
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resumes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  session_id  TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name     TEXT NOT NULL,
  company      TEXT NOT NULL,
  match_score  INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  summary      TEXT NOT NULL,
  missing_keywords TEXT NOT NULL DEFAULT '[]',
  jd_text      TEXT NOT NULL,
  resume_id    INTEGER NOT NULL REFERENCES resumes(id),
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  session_id   TEXT
);

-- The ON DELETE CASCADE documents the intent and enforces it locally, but
-- nothing relies on it: foreign key enforcement is a per-connection pragma and
-- a hosted database may not honour it, which would leave orphaned items behind
-- forever. Every delete path removes job_items explicitly instead.
CREATE TABLE IF NOT EXISTS job_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  requirement TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('skill','experience','education','tool','soft')),
  importance  TEXT NOT NULL CHECK (importance IN ('must','nice')),
  evidence    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('met','partial','missing')),
  sort_order  INTEGER NOT NULL
);

-- One row per anonymous visitor. last_seen_at is what retention measures:
-- data belongs to a session, and a session that keeps being used keeps its data.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Short-lived, single-use codes that move a session to another device.
-- Only a hash is stored, so reading this table hands over nothing.
CREATE TABLE IF NOT EXISTS transfer_codes (
  code_hash   TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
`;

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_resumes_session ON resumes (session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs (session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_session_created ON jobs (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_transfer_expires ON transfer_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (last_seen_at);
`;

/** Bumped whenever a step is added to migrate(). */
const SCHEMA_VERSION = 5;

/**
 * Asks the database rather than PRAGMA table_info, so the answer is the same on
 * a local file and on a hosted libSQL database. The identifiers are module
 * constants, never request data.
 */
async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  try {
    await db.execute({ sql: `SELECT ${column} FROM ${table} LIMIT 0`, args: [] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Databases written before schema_meta existed recorded their version in
 * PRAGMA user_version, so that is the fallback — and it reads 0 on a database
 * that is genuinely new, which is exactly the right answer.
 */
async function readVersion(db: Db): Promise<number> {
  const row = await get<{ value: string }>(
    db,
    `SELECT value FROM schema_meta WHERE key = 'version'`,
  );
  if (row) return Number(row.value);

  try {
    const pragma = await get<{ user_version: number }>(db, 'PRAGMA user_version');
    return Number(pragma?.user_version ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Fresh databases get SCHEMA_SQL as written. Databases created before a column
 * existed are stepped forward with ALTER TABLE — CREATE TABLE IF NOT EXISTS
 * silently does nothing to a table that is already there.
 */
export async function migrate(db: Db): Promise<void> {
  await db.executeMultiple(SCHEMA_SQL);

  const version = await readVersion(db);

  if (version < 2) {
    // v2: every row belongs to an anonymous visitor session.
    if (!(await hasColumn(db, 'resumes', 'session_id'))) {
      await db.execute({ sql: 'ALTER TABLE resumes ADD COLUMN session_id TEXT', args: [] });
    }
    if (!(await hasColumn(db, 'jobs', 'session_id'))) {
      await db.execute({ sql: 'ALTER TABLE jobs ADD COLUMN session_id TEXT', args: [] });
    }
  }

  // v3 added a whole table, which CREATE TABLE IF NOT EXISTS above already
  // covers for old databases — no ALTER needed.

  if (version < 4) {
    // v4 moved retention from row age to session activity. Give every session
    // that already has data a full window, rather than deleting it on boot.
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT OR IGNORE INTO sessions (id, created_at, last_seen_at)
       SELECT session_id, ?, ? FROM jobs WHERE session_id IS NOT NULL
       UNION
       SELECT session_id, ?, ? FROM resumes WHERE session_id IS NOT NULL`,
      [now, now, now, now],
    );
  }

  // v5 only moved the version marker itself into schema_meta, which the write
  // below performs for every database that reaches this point.

  await db.executeMultiple(INDEX_SQL);
  await run(db, `INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)`, [
    String(SCHEMA_VERSION),
  ]);
}

/**
 * Resolves where the data lives. Turso (hosted libSQL) wins when configured,
 * which is how the deployed app gets a database that survives a restart on a
 * host with no persistent disk; otherwise this is a local file, or memory
 * under test.
 */
export function resolveDbConfig(): Config {
  const env = loadEnv();

  if (env.TURSO_DATABASE_URL) {
    return {
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    };
  }

  const dbPath = env.DB_PATH ?? path.join(SERVER_ROOT, 'data', 'app.db');
  if (dbPath === ':memory:') return { url: ':memory:' };

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // libSQL wants a URL, and a Windows path's backslashes are not URL separators.
  return { url: `file:${dbPath.split(path.sep).join('/')}` };
}

/** Where the data lives, for the startup log. Never includes the auth token. */
export function describeDbTarget(): string {
  const { url } = resolveDbConfig();
  return url.startsWith('file:') || url === ':memory:' ? url : new URL(url).host;
}

/**
 * Opens a connection, applies the per-connection pragmas and migrates.
 * Pass `{ url: ':memory:' }` for tests.
 */
export async function openDatabase(config: Config): Promise<Db> {
  const db = createClient(config);

  // Both are local-file concerns and a hosted database manages them itself, so
  // a rejection here is expected rather than fatal.
  for (const pragma of ['foreign_keys = ON', 'journal_mode = WAL']) {
    try {
      await db.execute({ sql: `PRAGMA ${pragma}`, args: [] });
    } catch {
      // Hosted libSQL: not settable per connection, and not needed.
    }
  }

  await migrate(db);
  return db;
}

let singleton: Promise<Db> | undefined;

/**
 * The app's shared connection. Memoises the promise rather than the client, so
 * concurrent first requests share one open-and-migrate instead of racing to
 * create the schema. A failure is not cached — the next caller retries.
 */
export function getDb(): Promise<Db> {
  singleton ??= openDatabase(resolveDbConfig()).catch((err: unknown) => {
    singleton = undefined;
    throw err;
  });
  return singleton;
}

export async function closeDb(): Promise<void> {
  const pending = singleton;
  singleton = undefined;
  if (!pending) return;

  try {
    (await pending).close();
  } catch {
    // A connection that never opened has nothing to close.
  }
}
