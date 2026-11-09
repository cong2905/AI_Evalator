import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { JobItem } from '@app/shared';
import { createApp } from '../src/app.js';
import { closeDb, getDb } from '../src/db/db.js';
import { insertResume } from '../src/db/repositories/resumeRepo.js';
import { insertJob, type NewJob } from '../src/db/repositories/jobRepo.js';
import { startSession, visitor, type Agent } from './helpers/session.js';
import { rows } from './helpers/db.js';

const app = createApp();

let agent: Agent;
let sessionId: string;

const item = (over: Partial<JobItem> = {}): JobItem => ({
  requirement: 'React',
  category: 'skill',
  importance: 'must',
  evidence: 'Built React dashboards',
  status: 'met',
  ...over,
});

async function seedJob(over: Partial<NewJob> = {}): Promise<number> {
  const db = await getDb();
  const resume = await insertResume(db, {
    label: 'resume.pdf',
    content: 'resume content',
    setDefault: true,
    sessionId,
  });

  return insertJob(db, {
    sessionId,
    jobName: 'Frontend Engineer',
    company: 'Acme',
    matchScore: 72,
    summary: 'Good fit.',
    missingKeywords: ['Playwright'],
    jdText: 'job description text',
    resumeId: resume.id,
    model: 'openai/gpt-oss-120b',
    items: [item(), item({ requirement: 'Design systems', importance: 'nice', status: 'missing' })],
    ...over,
  });
}

beforeEach(async () => {
  await closeDb();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  agent = visitor(app);
  // Rows seeded straight into the database must belong to this agent's session.
  sessionId = await startSession(agent);
});

describe('GET /api/jobs', () => {
  it('returns an empty array when nothing is saved', async () => {
    const res = await agent.get('/api/jobs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns summaries, newest first', async () => {
    await seedJob({ jobName: 'Oldest' });
    await seedJob({ jobName: 'Middle' });
    await seedJob({ jobName: 'Newest' });

    const res = await agent.get('/api/jobs');

    expect(res.body.map((j: { jobName: string }) => j.jobName)).toEqual([
      'Newest',
      'Middle',
      'Oldest',
    ]);
  });

  it('returns only summary fields, not the whole evaluation', async () => {
    await seedJob();

    const res = await agent.get('/api/jobs');

    expect(Object.keys(res.body[0]).sort()).toEqual([
      'company',
      'createdAt',
      'id',
      'jobName',
      'matchScore',
    ]);
  });

  it('searches job name and company, case-insensitively', async () => {
    await seedJob({ jobName: 'Frontend Engineer', company: 'Acme' });
    await seedJob({ jobName: 'Data Analyst', company: 'Globex' });

    const byName = await agent.get('/api/jobs?q=front');
    const byCompany = await agent.get('/api/jobs?q=GLOBEX');
    const noMatch = await agent.get('/api/jobs?q=nothing');

    expect(byName.body).toHaveLength(1);
    expect(byName.body[0].jobName).toBe('Frontend Engineer');
    expect(byCompany.body).toHaveLength(1);
    expect(byCompany.body[0].company).toBe('Globex');
    expect(noMatch.body).toEqual([]);
  });

  it('treats % and _ as literal characters in a search', async () => {
    await seedJob({ jobName: '100% remote role' });
    await seedJob({ jobName: 'Onsite role' });

    const res = await agent.get('/api/jobs?q=%25'); // the percent sign itself

    expect(res.body).toHaveLength(1);
    expect(res.body[0].jobName).toBe('100% remote role');
  });

  it('ignores a blank search', async () => {
    await seedJob();

    const res = await agent.get('/api/jobs?q=   ');

    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the full detail with its items', async () => {
    const id = await seedJob();

    const res = await agent.get(`/api/jobs/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      jobName: 'Frontend Engineer',
      company: 'Acme',
      matchScore: 72,
      summary: 'Good fit.',
      missingKeywords: ['Playwright'],
      jdText: 'job description text',
      model: 'openai/gpt-oss-120b',
      resumeLabel: 'resume.pdf',
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].importance).toBe('must');
  });

  it('404s on an unknown id', async () => {
    const res = await agent.get('/api/jobs/999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400s on an id that is not a number', async () => {
    const res = await agent.get('/api/jobs/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/jobs/:id', () => {
  it('deletes the job and its items', async () => {
    const id = await seedJob();

    const res = await agent.delete(`/api/jobs/${id}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    expect(await rows('jobs')).toBe(0);
    expect(await rows('job_items')).toBe(0);
  });

  it('leaves the resume behind, since other jobs may point at it', async () => {
    const id = await seedJob();

    await agent.delete(`/api/jobs/${id}`);

    expect(await rows('resumes')).toBe(1);
  });

  it('deletes only the requested job', async () => {
    const keep = await seedJob({ jobName: 'Keep me' });
    const drop = await seedJob({ jobName: 'Drop me' });

    await agent.delete(`/api/jobs/${drop}`);

    const res = await agent.get('/api/jobs');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(keep);
  });

  it('404s when the job is already gone', async () => {
    const id = await seedJob();
    await agent.delete(`/api/jobs/${id}`);

    const res = await agent.delete(`/api/jobs/${id}`);

    expect(res.status).toBe(404);
  });
});
