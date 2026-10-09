import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/db.js';

function fresh() {
  return openDatabase(':memory:');
}

describe('migrations', () => {
  it('creates the three tables', () => {
    const db = fresh();
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => (row as { name: string }).name);

    expect(names).toContain('resumes');
    expect(names).toContain('jobs');
    expect(names).toContain('job_items');
    db.close();
  });

  it('is idempotent', () => {
    const db = fresh();
    expect(() => openDatabase(':memory:')).not.toThrow();
    db.close();
  });

  it('enables foreign keys on the connection', () => {
    const db = fresh();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

describe('constraints', () => {
  it('rejects a match_score outside 0-100', () => {
    const db = fresh();
    const resumeId = insertResume(db);

    expect(() => insertJob(db, resumeId, 101)).toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it('rejects a job row pointing at a missing resume', () => {
    const db = fresh();
    expect(() => insertJob(db, 999, 50)).toThrow(/FOREIGN KEY constraint failed/i);
    db.close();
  });

  it('rejects an unknown job_items status', () => {
    const db = fresh();
    const jobId = insertJob(db, insertResume(db), 75);

    expect(() =>
      db
        .prepare(
          `INSERT INTO job_items (job_id, requirement, category, importance, evidence, status, sort_order)
           VALUES (?, 'React', 'skill', 'must', '', 'maybe', 0)`,
        )
        .run(jobId),
    ).toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it('cascades job_items when a job is deleted', () => {
    const db = fresh();
    const jobId = insertJob(db, insertResume(db), 75);
    db.prepare(
      `INSERT INTO job_items (job_id, requirement, category, importance, evidence, status, sort_order)
       VALUES (?, 'React', 'skill', 'must', '3 years of React', 'met', 0)`,
    ).run(jobId);

    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);

    const left = db.prepare('SELECT COUNT(*) AS n FROM job_items').get() as { n: number };
    expect(left.n).toBe(0);
    db.close();
  });
});

type TestDb = ReturnType<typeof openDatabase>;

function insertResume(db: TestDb): number {
  const info = db
    .prepare(`INSERT INTO resumes (label, content, is_default, updated_at) VALUES (?, ?, 1, ?)`)
    .run('Pasted resume', 'resume text', new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function insertJob(db: TestDb, resumeId: number, score: number): number {
  const info = db
    .prepare(
      `INSERT INTO jobs (job_name, company, match_score, summary, missing_keywords, jd_text, resume_id, model, created_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    )
    .run(
      'Frontend Developer',
      'Acme',
      score,
      'Good fit.',
      'job description text',
      resumeId,
      'openai/gpt-oss-120b',
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}
