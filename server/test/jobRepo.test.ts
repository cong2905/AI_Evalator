import { beforeEach, describe, expect, it } from 'vitest';
import type { JobItem } from '@app/shared';
import { closeDb, getDb } from '../src/db/db.js';
import { insertResume } from '../src/db/repositories/resumeRepo.js';
import { getJobDetail, insertJob, type NewJob } from '../src/db/repositories/jobRepo.js';

const SESSION = 'session-under-test';

beforeEach(() => closeDb());

const item = (over: Partial<JobItem> = {}): JobItem => ({
  requirement: 'React',
  category: 'skill',
  importance: 'must',
  evidence: 'Built React dashboards',
  status: 'met',
  ...over,
});

function newJob(over: Partial<NewJob> = {}): NewJob {
  const resume = insertResume(getDb(), {
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
  it('round-trips a job through getJobDetail', () => {
    const db = getDb();
    const id = insertJob(db, newJob());

    const detail = getJobDetail(db, SESSION, id);

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

  it('writes the job and its items atomically', () => {
    const db = getDb();
    const broken = newJob({
      items: [
        item({ requirement: 'first' }),
        // Slips past the type system the way a bad migration or bad cast would;
        // the CHECK constraint rejects it mid-transaction.
        item({ requirement: 'second', status: 'maybe' as JobItem['status'] }),
      ],
    });

    expect(() => insertJob(db, broken)).toThrow(/CHECK constraint failed/i);

    const jobs = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    const items = db.prepare('SELECT COUNT(*) AS n FROM job_items').get() as { n: number };
    expect(jobs.n).toBe(0);
    expect(items.n).toBe(0);
  });

  it('keeps each job independent when the same resume is evaluated twice', () => {
    const db = getDb();
    const first = newJob();
    const secondId = insertJob(db, { ...first, jobName: 'Second run', matchScore: 40 });
    const firstId = insertJob(db, first);

    expect(getJobDetail(db, SESSION, secondId)?.jobName).toBe('Second run');
    expect(getJobDetail(db, SESSION, firstId)?.matchScore).toBe(75);
  });

  it('sorts must before nice while keeping the original order inside each group', () => {
    const db = getDb();
    const id = insertJob(
      db,
      newJob({
        items: [
          item({ requirement: 'nice-first', importance: 'nice' }),
          item({ requirement: 'must-first', importance: 'must' }),
          item({ requirement: 'nice-second', importance: 'nice' }),
          item({ requirement: 'must-second', importance: 'must' }),
        ],
      }),
    );

    expect(getJobDetail(db, SESSION, id)?.items.map((i) => i.requirement)).toEqual([
      'must-first',
      'must-second',
      'nice-first',
      'nice-second',
    ]);
  });
});

describe('getJobDetail', () => {
  it('returns undefined for an unknown id', () => {
    expect(getJobDetail(getDb(), SESSION, 404)).toBeUndefined();
  });

  it('survives a corrupt missing_keywords column', () => {
    const db = getDb();
    const id = insertJob(db, newJob());
    db.prepare('UPDATE jobs SET missing_keywords = ? WHERE id = ?').run('not json', id);

    expect(getJobDetail(db, SESSION, id)?.missingKeywords).toEqual([]);
  });
});
