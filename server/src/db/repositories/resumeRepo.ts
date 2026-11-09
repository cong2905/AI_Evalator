import type { Resume } from '@app/shared';
import type { Db } from '../db.js';
import { count, get, run } from '../sql.js';

type ResumeRow = {
  id: number;
  label: string;
  content: string;
  is_default: number;
  updated_at: string;
  session_id: string | null;
};

function toResume(row: ResumeRow): Resume {
  return {
    id: row.id,
    label: row.label,
    content: row.content,
    isDefault: row.is_default === 1,
    updatedAt: row.updated_at,
  };
}

export async function getDefaultResume(db: Db, sessionId: string): Promise<Resume | undefined> {
  const row = await get<ResumeRow>(
    db,
    `SELECT * FROM resumes
     WHERE is_default = 1 AND session_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [sessionId],
  );
  return row ? toResume(row) : undefined;
}

/** Scoped, so one visitor cannot evaluate against another visitor's resume id. */
export async function getResumeById(
  db: Db,
  sessionId: string,
  id: number,
): Promise<Resume | undefined> {
  const row = await get<ResumeRow>(db, 'SELECT * FROM resumes WHERE id = ? AND session_id = ?', [
    id,
    sessionId,
  ]);
  return row ? toResume(row) : undefined;
}

export type NewResume = {
  label: string;
  content: string;
  setDefault: boolean;
  sessionId: string;
};

/**
 * Inserts a resume. Older rows are kept (saved jobs point at them), so making
 * this one the default just clears the flag everywhere else — in one
 * transaction, so there is never zero or two defaults (SPEC.md section 4).
 */
export async function insertResume(db: Db, input: NewResume): Promise<Resume> {
  const updatedAt = new Date().toISOString();

  const tx = await db.transaction('write');
  try {
    if (input.setDefault) {
      // Only this visitor's default is cleared — never everyone's.
      await run(tx, 'UPDATE resumes SET is_default = 0 WHERE session_id = ?', [input.sessionId]);
    }
    const inserted = await run(
      tx,
      `INSERT INTO resumes (label, content, is_default, updated_at, session_id)
       VALUES (?, ?, ?, ?, ?)`,
      [input.label, input.content, input.setDefault ? 1 : 0, updatedAt, input.sessionId],
    );
    await tx.commit();

    return {
      id: inserted.lastInsertRowid,
      label: input.label,
      content: input.content,
      isDefault: input.setDefault,
      updatedAt,
    };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function countResumes(db: Db, sessionId?: string): Promise<number> {
  return sessionId === undefined
    ? count(db, 'SELECT COUNT(*) AS n FROM resumes')
    : count(db, 'SELECT COUNT(*) AS n FROM resumes WHERE session_id = ?', [sessionId]);
}
