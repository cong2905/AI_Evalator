import type { Resume } from '@app/shared';
import type { Db } from '../db.js';

type ResumeRow = {
  id: number;
  label: string;
  content: string;
  is_default: number;
  updated_at: string;
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

export function getDefaultResume(db: Db): Resume | undefined {
  const row = db
    .prepare('SELECT * FROM resumes WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1')
    .get() as ResumeRow | undefined;
  return row ? toResume(row) : undefined;
}

export function getResumeById(db: Db, id: number): Resume | undefined {
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow | undefined;
  return row ? toResume(row) : undefined;
}

export type NewResume = {
  label: string;
  content: string;
  setDefault: boolean;
};

/**
 * Inserts a resume. Older rows are kept (saved jobs point at them), so making
 * this one the default just clears the flag everywhere else — in one
 * transaction, so there is never zero or two defaults (SPEC.md section 4).
 */
export function insertResume(db: Db, input: NewResume): Resume {
  const updatedAt = new Date().toISOString();

  const run = db.transaction((): number => {
    if (input.setDefault) {
      db.prepare('UPDATE resumes SET is_default = 0').run();
    }
    const info = db
      .prepare('INSERT INTO resumes (label, content, is_default, updated_at) VALUES (?, ?, ?, ?)')
      .run(input.label, input.content, input.setDefault ? 1 : 0, updatedAt);
    return Number(info.lastInsertRowid);
  });

  const id = run();
  return {
    id,
    label: input.label,
    content: input.content,
    isDefault: input.setDefault,
    updatedAt,
  };
}

export function countResumes(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM resumes').get() as { n: number };
  return row.n;
}
