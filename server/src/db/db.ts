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
  updated_at  TEXT NOT NULL
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
  created_at   TEXT NOT NULL
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
`;

/** Current schema version, bumped when a future migration is added. */
const SCHEMA_VERSION = 1;

export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
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
