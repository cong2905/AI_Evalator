import type { Db } from '../db.js';
import { get, run } from '../sql.js';

/**
 * Writing on every request would mean a database write per page load, so the
 * timestamp only moves when it is meaningfully stale. Retention is measured in
 * days; an hour of granularity costs nothing.
 */
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/** Records that this visitor is still around. Cheap enough to call per request. */
export async function touchSession(db: Db, sessionId: string, now = new Date()): Promise<void> {
  const row = await get<{ last_seen_at: string }>(
    db,
    'SELECT last_seen_at FROM sessions WHERE id = ?',
    [sessionId],
  );

  const nowIso = now.toISOString();

  if (!row) {
    await run(db, 'INSERT OR IGNORE INTO sessions (id, created_at, last_seen_at) VALUES (?, ?, ?)', [
      sessionId,
      nowIso,
      nowIso,
    ]);
    return;
  }

  const age = now.getTime() - new Date(row.last_seen_at).getTime();
  if (age >= TOUCH_THROTTLE_MS) {
    await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso, sessionId]);
  }
}

export async function getLastSeen(db: Db, sessionId: string): Promise<string | undefined> {
  const row = await get<{ last_seen_at: string }>(
    db,
    'SELECT last_seen_at FROM sessions WHERE id = ?',
    [sessionId],
  );
  return row?.last_seen_at;
}

export async function deleteSessionRow(db: Db, sessionId: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE id = ?', [sessionId]);
}
