import { beforeEach, describe, expect, it } from 'vitest';
import type { JobItem } from '@app/shared';
import { closeDb, getDb } from '../src/db/db.js';
import { insertResume } from '../src/db/repositories/resumeRepo.js';
import { getJobDetail, insertJob, type NewJob } from '../src/db/repositories/jobRepo.js';
import { exec, rows } from './helpers/db.js';

const SESSION = 'session-under-test';

beforeEach(async () => {
  await closeDb();
});

const item = (over: Partial<JobItem> = {}): JobItem => ({
  requirement: 'React',
  category: 'skill',
  importance: 'must',
  evidence: 'Built React dashboards',
  status: 'met',
  ...over,
});

async function newJob(over: Partial<NewJob> = {}): Promise<NewJob> {
  const resume = await insertResume(await getDb(), {
    label: 'resume.pdf',
    content: 'resume content',
    setDefault: true,
    sessionId: SESSION,
  });

  return {
    sessionId: SESSION,
    jobName: 'Frontend Engineer',
    company: 'Acme',
    matchScore: 75,
    summary: 'Good fit.',
    missingKeywords: ['Playwright'],
    jdText: 'job description text',
    resumeId: resume.id,
    model: 'openai/gpt-oss-120b',
    items: [item()],
    ...over,
  };
}

describe('insertJob', () => {
  it('round-trips a job through getJobDetail', async () => {
    const db = await getDb();
    const id = await insertJob(db, await newJob());

    const detail = await getJobDetail(db, SESSION, id);

    expect(detail).toMatchObject({
      id,
      jobName: 'Frontend Engineer',
      company: 'Acme',
      matchScore: 75,
      summary: 'Good fit.',
      missingKeywords: ['Playwright'],
      model: 'openai/gpt-oss-120b',
      resumeLabel: 'resume.pdf',
    });
    expect(detail?.items).toEqual([item()]);
  });

  it('writes the job and its items atomically', async () => {
    const db = await getDb();
    const broken = await newJob({
      items: [
        item({ requirement: 'first' }),
        // Slips past the type system the way a bad migration or bad cast would;
        // the CHECK constraint rejects it mid-transaction.
        item({ requirement: 'second', status: 'maybe' as JobItem['status'] }),
      ],
    });

    await expect(insertJob(db, broken)).rejects.toThrow(/CHECK constraint failed/i);

    expect(await rows('jobs')).toBe(0);
    expect(await rows('job_items')).toBe(0);
  });

  it('keeps each job independent when the same resume is evaluated twice', async () => {
    const db = await getDb();
    const first = await newJob();
    const secondId = await insertJob(db, { ...first, jobName: 'Second run', matchScore: 40 });
    const firstId = await insertJob(db, first);

    expect((await getJobDetail(db, SESSION, secondId))?.jobName).toBe('Second run');
    expect((await getJobDetail(db, SESSION, firstId))?.matchScore).toBe(75);
  });

  it('sorts must before nice while keeping the original order inside each group', async () => {
    const db = await getDb();
    const id = await insertJob(
      db,
      await newJob({
        items: [
          item({ requirement: 'nice-first', importance: 'nice' }),
          item({ requirement: 'must-first', importance: 'must' }),
          item({ requirement: 'nice-second', importance: 'nice' }),
          item({ requirement: 'must-second', importance: 'must' }),
        ],
      }),
    );

    expect((await getJobDetail(db, SESSION, id))?.items.map((i) => i.requirement)).toEqual([
      'must-first',
      'must-second',
      'nice-first',
      'nice-second',
    ]);
  });
});

describe('getJobDetail', () => {
  it('returns undefined for an unknown id', async () => {
    expect(await getJobDetail(await getDb(), SESSION, 404)).toBeUndefined();
  });

  it('survives a corrupt missing_keywords column', async () => {
    const db = await getDb();
    const id = await insertJob(db, await newJob());
    await exec('UPDATE jobs SET missing_keywords = ? WHERE id = ?', ['not json', id]);

    expect((await getJobDetail(db, SESSION, id))?.missingKeywords).toEqual([]);
  });
});
