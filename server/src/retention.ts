import type { Db } from './db/db.js';
import { run } from './db/sql.js';

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
 * Order matters: jobs reference resumes, so jobs go first (and their items
 * ahead of them, since nothing here relies on ON DELETE CASCADE) and a resume
 * is only removed once no job still points at it — an active visitor may still
 * rely on a very old resume.
 */
export async function purgeExpiredData(db: Db, now = new Date()): Promise<PurgeResult> {
  const cutoff = cutoffIso(now);
  const nowIso = now.toISOString();

  const live = 'SELECT id FROM sessions WHERE last_seen_at >= ?';
  const doomed = `SELECT id FROM jobs WHERE session_id IS NULL OR session_id NOT IN (${live})`;

  const tx = await db.transaction('write');
  try {
    await run(tx, `DELETE FROM job_items WHERE job_id IN (${doomed})`, [cutoff]);

    const jobs = await run(
      tx,
      `DELETE FROM jobs WHERE session_id IS NULL OR session_id NOT IN (${live})`,
      [cutoff],
    );

    const resumes = await run(
      tx,
      `DELETE FROM resumes
       WHERE (session_id IS NULL OR session_id NOT IN (${live}))
         AND id NOT IN (SELECT resume_id FROM jobs)`,
      [cutoff],
    );

    const codes = await run(
      tx,
      'DELETE FROM transfer_codes WHERE expires_at < ? OR used_at IS NOT NULL',
      [nowIso],
    );

    const sessions = await run(tx, 'DELETE FROM sessions WHERE last_seen_at < ?', [cutoff]);

    // Belt and braces: an item whose job vanished some other way is unreachable
    // and would otherwise sit in the table forever.
    await run(tx, 'DELETE FROM job_items WHERE job_id NOT IN (SELECT id FROM jobs)');

    await tx.commit();
    return {
      jobs: jobs.changes,
      resumes: resumes.changes,
      codes: codes.changes,
      sessions: sessions.changes,
    };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/** Everything belonging to one visitor, for the "delete my data" button. */
export async function purgeSession(db: Db, sessionId: string): Promise<PurgeResult> {
  const tx = await db.transaction('write');
  try {
    await run(
      tx,
      'DELETE FROM job_items WHERE job_id IN (SELECT id FROM jobs WHERE session_id = ?)',
      [sessionId],
    );
    const jobs = await run(tx, 'DELETE FROM jobs WHERE session_id = ?', [sessionId]);
    const resumes = await run(tx, 'DELETE FROM resumes WHERE session_id = ?', [sessionId]);
    const codes = await run(tx, 'DELETE FROM transfer_codes WHERE session_id = ?', [sessionId]);
    const sessions = await run(tx, 'DELETE FROM sessions WHERE id = ?', [sessionId]);

    await tx.commit();
    return {
      jobs: jobs.changes,
      resumes: resumes.changes,
      codes: codes.changes,
      sessions: sessions.changes,
    };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

function logPurge(result: PurgeResult): void {
  if (result.jobs || result.resumes || result.codes) {
    console.log(
      `[retention] purged ${result.jobs} jobs, ${result.resumes} resumes, ${result.codes} codes`,
    );
  }
}

/** Runs once at startup and daily after that. */
export async function startPurgeSchedule(db: Db): Promise<NodeJS.Timeout> {
  logPurge(await purgeExpiredData(db));

  const timer = setInterval(() => {
    void purgeExpiredData(db)
      .then(logPurge)
      .catch((err: unknown) => {
        console.error('[retention] purge failed:', err);
      });
  }, PURGE_INTERVAL_MS);

  // Never hold the process open just for the next sweep.
  timer.unref();
  return timer;
}
