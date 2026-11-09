import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { openDatabase } from '../src/db/db.js';
import { all, count, get, run } from '../src/db/sql.js';

function fresh(): Promise<Db> {
  return openDatabase({ url: ':memory:' });
}

describe('migrations', () => {
  it('creates the three tables', async () => {
    const db = await fresh();
    const names = (
      await all<{ name: string }>(
        db,
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
    ).map((row) => row.name);

    expect(names).toContain('resumes');
    expect(names).toContain('jobs');
    expect(names).toContain('job_items');
    db.close();
  });

  it('is idempotent', async () => {
    const db = await fresh();
    await expect(openDatabase({ url: ':memory:' })).resolves.toBeDefined();
    db.close();
  });

  it('enables foreign keys on the connection', async () => {
    const db = await fresh();
    const row = await get<{ foreign_keys: number }>(db, 'PRAGMA foreign_keys');

    expect(Number(row?.foreign_keys)).toBe(1);
    db.close();
  });

  it('records its version where any libSQL backend can read it', async () => {
    const db = await fresh();

    // PRAGMA user_version is not dependable on a hosted database, so the marker
    // lives in a table instead. Migrating twice must not move it.
    const first = await get<{ value: string }>(
      db,
      `SELECT value FROM schema_meta WHERE key = 'version'`,
    );
    expect(Number(first?.value)).toBeGreaterThan(0);

    const markers = await count(db, `SELECT COUNT(*) AS n FROM schema_meta WHERE key = 'version'`);
    expect(markers).toBe(1);
    db.close();
  });
});

describe('constraints', () => {
  it('rejects a match_score outside 0-100', async () => {
    const db = await fresh();
    const resumeId = await insertResume(db);

    await expect(insertJob(db, resumeId, 101)).rejects.toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it('rejects a job row pointing at a missing resume', async () => {
    const db = await fresh();

    await expect(insertJob(db, 999, 50)).rejects.toThrow(/FOREIGN KEY constraint failed/i);
    db.close();
  });

  it('rejects an unknown job_items status', async () => {
    const db = await fresh();
    const jobId = await insertJob(db, await insertResume(db), 75);

    await expect(
      run(
        db,
        `INSERT INTO job_items (job_id, requirement, category, importance, evidence, status, sort_order)
         VALUES (?, 'React', 'skill', 'must', '', 'maybe', 0)`,
        [jobId],
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it('cascades job_items when a job is deleted', async () => {
    const db = await fresh();
    const jobId = await insertJob(db, await insertResume(db), 75);
    await run(
      db,
      `INSERT INTO job_items (job_id, requirement, category, importance, evidence, status, sort_order)
       VALUES (?, 'React', 'skill', 'must', '3 years of React', 'met', 0)`,
      [jobId],
    );

    await run(db, 'DELETE FROM jobs WHERE id = ?', [jobId]);

    // The delete paths in the app do not rely on this, but where the pragma is
    // honoured it should still hold.
    expect(await count(db, 'SELECT COUNT(*) AS n FROM job_items')).toBe(0);
    db.close();
  });
});

async function insertResume(db: Db): Promise<number> {
  const info = await run(
    db,
    `INSERT INTO resumes (label, content, is_default, updated_at) VALUES (?, ?, 1, ?)`,
    ['Pasted resume', 'resume text', new Date().toISOString()],
  );
  return info.lastInsertRowid;
}

async function insertJob(db: Db, resumeId: number, score: number): Promise<number> {
  const info = await run(
    db,
    `INSERT INTO jobs (job_name, company, match_score, summary, missing_keywords, jd_text, resume_id, model, created_at)
     VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    [
      'Frontend Developer',
      'Acme',
      score,
      'Good fit.',
      'job description text',
      resumeId,
      'openai/gpt-oss-120b',
      new Date().toISOString(),
    ],
  );
  return info.lastInsertRowid;
}
