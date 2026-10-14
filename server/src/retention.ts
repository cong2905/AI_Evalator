import type { Db } from './db/db.js';

/**
 * Strangers' resumes are personal data, so the demo does not keep them
 * indefinitely — but the window is measured from a visitor's LAST VISIT, not
 * from when each row was written. Keep using the app and your evaluations stay,
 * however old they are; stop for a week and everything goes.
 *
 * This matches the rolling session cookie in sessions.ts: both are extended by
 * a visit, so the cookie never dies while the data it points at is still alive.
 */
export const RETENTION_DAYS = 7;

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type PurgeResult = {
  jobs: number;
  resumes: number;
  codes: number;
  sessions: number;
};

function cutoffIso(now: Date): string {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Deletes the data of every session not seen inside the window, plus rows left
 * behind by a cleared cookie (`session_id IS NULL`), which nobody can reach
 * again. Row age is irrelevant — only the visitor's last visit counts.
 *
 * Order matters: jobs reference resumes, so jobs go first (job_items follow by
 * ON DELETE CASCADE) and a resume is only removed once no job still points at
 * it — an active visitor may still rely on a very old resume.
 */
export function purgeExpiredData(db: Db, now = new Date()): PurgeResult {
  const cutoff = cutoffIso(now);
  const nowIso = now.toISOString();

  const run = db.transaction((): PurgeResult => {
    const live = 'SELECT id FROM sessions WHERE last_seen_at >= ?';

    const jobs = db
      .prepare(`DELETE FROM jobs WHERE session_id IS NULL OR session_id NOT IN (${live})`)
      .run(cutoff).changes;

    const resumes = db
      .prepare(
        `DELETE FROM resumes
         WHERE (session_id IS NULL OR session_id NOT IN (${live}))
           AND id NOT IN (SELECT resume_id FROM jobs)`,
      )
      .run(cutoff).changes;

    const codes = db
      .prepare('DELETE FROM transfer_codes WHERE expires_at < ? OR used_at IS NOT NULL')
      .run(nowIso).changes;

    const sessions = db
      .prepare('DELETE FROM sessions WHERE last_seen_at < ?')
      .run(cutoff).changes;

    return { jobs, resumes, codes, sessions };
  });

  return run();
}

/** Everything belonging to one visitor, for the "delete my data" button. */
export function purgeSession(db: Db, sessionId: string): PurgeResult {
  const run = db.transaction((): PurgeResult => {
    const jobs = db.prepare('DELETE FROM jobs WHERE session_id = ?').run(sessionId).changes;
    const resumes = db.prepare('DELETE FROM resumes WHERE session_id = ?').run(sessionId).changes;
    const codes = db
      .prepare('DELETE FROM transfer_codes WHERE session_id = ?')
      .run(sessionId).changes;
    const sessions = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes;

    return { jobs, resumes, codes, sessions };
  });

  return run();
}

function logPurge(result: PurgeResult): void {
  if (result.jobs || result.resumes || result.codes) {
    console.log(
      `[retention] purged ${result.jobs} jobs, ${result.resumes} resumes, ${result.codes} codes`,
    );
  }
}

/** Runs once at startup and daily after that. */
export function startPurgeSchedule(db: Db): NodeJS.Timeout {
  logPurge(purgeExpiredData(db));

  const timer = setInterval(() => {
    try {
      logPurge(purgeExpiredData(db));
    } catch (err) {
      console.error('[retention] purge failed:', err);
    }
  }, PURGE_INTERVAL_MS);

  // Never hold the process open just for the next sweep.
  timer.unref();
  return timer;
}
