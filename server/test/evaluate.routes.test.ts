import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { EvaluationResult } from '../src/services/groqClient.js';
import { ApiError } from '../src/errors.js';

// No test may reach the real Groq API (SPEC.md section 11).
const evaluateWithGroq = vi.hoisted(() => vi.fn());
vi.mock('../src/services/groqClient.js', () => ({ evaluateWithGroq }));

const { createApp } = await import('../src/app.js');
const { closeDb, getDb } = await import('../src/db/db.js');
const { countResumes, getDefaultResume } = await import('../src/db/repositories/resumeRepo.js');
const { startSession, visitor } = await import('./helpers/session.js');
type Agent = import('./helpers/session.js').Agent;

// A fresh app per test: express-rate-limit holds its counters in memory, so a
// shared instance would carry one test's requests into the next.
let app: ReturnType<typeof createApp>;

let agent: Agent;
let sessionId: string;

const RESUME = 'Jane Doe, frontend engineer with React and TypeScript experience. '.repeat(5);
const JD =
  'We are hiring a Frontend Engineer. Required: 3+ years React, TypeScript, automated testing. ' +
  'Preferred: design systems experience, a degree in computer science.';

/** The mockup's mixed example: 3 must (met, met, partial) + 2 nice (missing, met) = 75%. */
const MIXED_PAYLOAD = {
  summary: 'Good overall fit. Strong React and TypeScript, weaker on automated testing.',
  missing_keywords: ['Playwright', 'design systems'],
  requirements: [
    {
      requirement: '3+ years React',
      category: 'skill',
      importance: 'must',
      evidence: 'Built React dashboards, 2021-present',
      status: 'met',
    },
    {
      requirement: 'TypeScript',
      category: 'skill',
      importance: 'must',
      evidence: 'TypeScript, JavaScript in Skills',
      status: 'met',
    },
    {
      requirement: 'Automated testing (Jest / Playwright)',
      category: 'tool',
      importance: 'must',
      evidence: 'Mentions unit tests, no framework named',
      status: 'partial',
    },
    {
      requirement: 'Design system experience',
      category: 'experience',
      importance: 'nice',
      evidence: '',
      status: 'missing',
    },
    {
      requirement: "Bachelor's in CS or related",
      category: 'education',
      importance: 'nice',
      evidence: 'B.Sc. Computer Science',
      status: 'met',
    },
  ],
};

function groqReturns(payload: unknown, model = 'openai/gpt-oss-120b') {
  evaluateWithGroq.mockResolvedValueOnce({ payload, model } as EvaluationResult);
}

const body = (over: Record<string, unknown> = {}) => ({
  jobName: 'Frontend Engineer',
  company: 'Acme',
  jdText: JD,
  resumeText: RESUME,
  ...over,
});

beforeEach(async () => {
  closeDb();
  evaluateWithGroq.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = createApp();
  agent = visitor(app);
  sessionId = await startSession(agent);
});

describe('POST /api/evaluate', () => {
  it('returns a scored JobDetail', async () => {
    groqReturns(MIXED_PAYLOAD);

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      jobName: 'Frontend Engineer',
      company: 'Acme',
      matchScore: 75,
      model: 'openai/gpt-oss-120b',
      missingKeywords: ['Playwright', 'design systems'],
    });
    expect(res.body.items).toHaveLength(5);
    expect(res.body.jdText).toBe(JD);
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it('sorts must before nice, keeping job description order inside each group', async () => {
    groqReturns(MIXED_PAYLOAD);

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.body.items.map((i: { importance: string }) => i.importance)).toEqual([
      'must',
      'must',
      'must',
      'nice',
      'nice',
    ]);
    expect(res.body.items.map((i: { requirement: string }) => i.requirement)).toEqual([
      '3+ years React',
      'TypeScript',
      'Automated testing (Jest / Playwright)',
      'Design system experience',
      "Bachelor's in CS or related",
    ]);
  });

  it('passes the resume and job description to the model', async () => {
    groqReturns(MIXED_PAYLOAD);

    await agent.post('/api/evaluate').send(body());

    expect(evaluateWithGroq).toHaveBeenCalledOnce();
    const [resumeArg, jdArg] = evaluateWithGroq.mock.calls[0] as [string, string];
    expect(resumeArg).toContain('Jane Doe');
    expect(jdArg).toBe(JD);
  });

  it('saves the job and its items in the database', async () => {
    groqReturns(MIXED_PAYLOAD);

    const res = await agent.post('/api/evaluate').send(body());

    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(res.body.id) as {
      match_score: number;
      missing_keywords: string;
      resume_id: number;
    };
    const items = db
      .prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY sort_order')
      .all(res.body.id) as Array<{ requirement: string; sort_order: number }>;

    expect(job.match_score).toBe(75);
    expect(JSON.parse(job.missing_keywords)).toEqual(['Playwright', 'design systems']);
    expect(job.resume_id).toBeGreaterThan(0);
    // Stored in job-description order; the must-first sort happens on read.
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2, 3, 4]);
    expect(items[0]?.requirement).toBe('3+ years React');
  });
});

describe('which resume gets used', () => {
  it('stores unsaved resumeText as a non-default row so resume_id is always set', async () => {
    groqReturns(MIXED_PAYLOAD);

    await agent.post('/api/evaluate').send(body());

    const db = getDb();
    expect(countResumes(db, sessionId)).toBe(1);
    expect(getDefaultResume(db, sessionId)).toBeUndefined();
  });

  it('falls back to the saved default', async () => {
    await agent.post('/api/resume').send({ text: RESUME, label: 'my-resume.pdf' });
    groqReturns(MIXED_PAYLOAD);

    const res = await agent
      .post('/api/evaluate')
      .send(body({ resumeText: undefined }));

    expect(res.status).toBe(201);
    expect(res.body.resumeLabel).toBe('my-resume.pdf');
    expect(countResumes(getDb(), sessionId)).toBe(1);
  });

  it('uses an explicit resumeId', async () => {
    const saved = await agent
      .post('/api/resume')
      .send({ text: RESUME, label: 'older.pdf', setDefault: false });
    groqReturns(MIXED_PAYLOAD);

    const res = await agent
      .post('/api/evaluate')
      .send(body({ resumeText: undefined, resumeId: saved.body.id }));

    expect(res.body.resumeLabel).toBe('older.pdf');
  });

  it('404s on an unknown resumeId', async () => {
    const res = await agent
      .post('/api/evaluate')
      .send(body({ resumeText: undefined, resumeId: 999 }));

    expect(res.status).toBe(404);
    expect(evaluateWithGroq).not.toHaveBeenCalled();
  });

  it('409s when there is no resume at all', async () => {
    const res = await agent
      .post('/api/evaluate')
      .send(body({ resumeText: undefined }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_DEFAULT_RESUME');
    expect(evaluateWithGroq).not.toHaveBeenCalled();
  });
});

describe('input validation', () => {
  it('rejects a job description under 50 characters before calling Groq', async () => {
    const res = await agent.post('/api/evaluate').send(body({ jdText: 'Too short.' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(evaluateWithGroq).not.toHaveBeenCalled();
  });

  it('rejects a job description over 8,000 characters and says how much to cut', async () => {
    const res = await agent.post('/api/evaluate').send(body({ jdText: 'x'.repeat(8_250) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('INPUT_TOO_LONG');
    expect(res.body.error.message).toMatch(/Cut 250/);
  });

  it('rejects an over-long job name', async () => {
    const res = await agent.post('/api/evaluate').send(body({ jobName: 'x'.repeat(121) }));

    expect(res.status).toBe(413);
  });

  it('rejects a missing company', async () => {
    const res = await agent.post('/api/evaluate').send(body({ company: '   ' }));

    expect(res.status).toBe(400);
  });

  it('rejects unknown fields', async () => {
    const res = await agent.post('/api/evaluate').send(body({ sneaky: true }));

    expect(res.status).toBe(400);
  });

  it('saves nothing when validation fails', async () => {
    await agent.post('/api/evaluate').send(body({ jdText: 'short' }));

    const db = getDb();
    const jobs = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(jobs.n).toBe(0);
    expect(countResumes(db, sessionId)).toBe(0);
  });
});

describe('model trouble', () => {
  it('502s and saves nothing when the model returns no requirements', async () => {
    groqReturns({ summary: 'Nothing to compare.', missing_keywords: [], requirements: [] });

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_BAD_OUTPUT');
    const jobs = getDb().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(jobs.n).toBe(0);
  });

  it('passes a rate limit through with retryAfter and the Retry-After header', async () => {
    evaluateWithGroq.mockRejectedValueOnce(
      new ApiError('RATE_LIMITED', 'Groq is busy, try again in 40s', 40),
    );

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Groq is busy, try again in 40s',
      retryAfter: 40,
    });
    expect(res.headers['retry-after']).toBe('40');
  });

  it('passes AI_UNAVAILABLE through as a 503', async () => {
    evaluateWithGroq.mockRejectedValueOnce(new ApiError('AI_UNAVAILABLE', 'Groq is down.'));

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(503);
  });

  it('does not leak an unexpected error to the client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    evaluateWithGroq.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:443'));

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });
});
