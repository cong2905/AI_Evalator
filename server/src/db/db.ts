import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadEnv, SERVER_ROOT } from '../env.js';

export type Db = Database.Database;

/** SPEC.md section 4. Idempotent: safe to run on every startup. */
const SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_transfer_expires ON transfer_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (last_seen_at);
`;

/** Bumped whenever a step is added to migrate(). */
const SCHEMA_VERSION = 4;

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

/**
 * Fresh databases get SCHEMA_SQL as written. Databases created before a column
 * existed are stepped forward with ALTER TABLE — CREATE TABLE IF NOT EXISTS
 * silently does nothing to a table that is already there.
 */
export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);

  const version = Number(db.pragma('user_version', { simple: true }));

  if (version < 2) {
    // v2: every row belongs to an anonymous visitor session.
    if (!hasColumn(db, 'resumes', 'session_id')) {
      db.exec('ALTER TABLE resumes ADD COLUMN session_id TEXT');
    }
    if (!hasColumn(db, 'jobs', 'session_id')) {
      db.exec('ALTER TABLE jobs ADD COLUMN session_id TEXT');
    }
  }

  // v3 added a whole table, which CREATE TABLE IF NOT EXISTS above already
  // covers for old databases — no ALTER needed.

  if (version < 4) {
    // v4 moved retention from row age to session activity. Give every session
    // that already has data a full window, rather than deleting it on boot.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, created_at, last_seen_at)
       SELECT session_id, ?, ? FROM jobs WHERE session_id IS NOT NULL
       UNION
       SELECT session_id, ?, ? FROM resumes WHERE session_id IS NOT NULL`,
    ).run(now, now, now, now);
  }

  db.exec(INDEX_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/**
 * Opens a connection, applies the per-connection pragmas and migrates.
 * Pass ':memory:' for tests.
 */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  // Required on every connection — SQLite defaults it off.
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function resolveDbPath(): string {
  const env = loadEnv();
  return env.DB_PATH ?? path.join(SERVER_ROOT, 'data', 'app.db');
}

let singleton: Db | undefined;

/** The app's shared connection (SQLite is single-process here, so one is enough). */
export function getDb(): Db {
  singleton ??= openDatabase(resolveDbPath());
  return singleton;
}

export function closeDb(): void {
  singleton?.close();
  singleton = undefined;
}
