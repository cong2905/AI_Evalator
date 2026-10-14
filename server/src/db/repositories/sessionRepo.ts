import type { Db } from '../db.js';

/**
 * Writing on every request would mean a disk write per page load, so the
 * timestamp only moves when it is meaningfully stale. Retention is measured in
 * days; an hour of granularity costs nothing.
 */
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/** Records that this visitor is still around. Cheap enough to call per request. */
export function touchSession(db: Db, sessionId: string, now = new Date()): void {
  const row = db.prepare('SELECT last_seen_at FROM sessions WHERE id = ?').get(sessionId) as
    | { last_seen_at: string }
    | undefined;

  const nowIso = now.toISOString();

  if (!row) {
    db.prepare(
      'INSERT OR IGNORE INTO sessions (id, created_at, last_seen_at) VALUES (?, ?, ?)',
    ).run(sessionId, nowIso, nowIso);
    return;
  }

  const age = now.getTime() - new Date(row.last_seen_at).getTime();
  if (age >= TOUCH_THROTTLE_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso, sessionId);
  }
}

export function getLastSeen(db: Db, sessionId: string): string | undefined {
  const row = db.prepare('SELECT last_seen_at FROM sessions WHERE id = ?').get(sessionId) as
    | { last_seen_at: string }
    | undefined;
  return row?.last_seen_at;
}

export function deleteSessionRow(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
