import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluateWithGroq = vi.hoisted(() => vi.fn());
vi.mock('../src/services/groqClient.js', () => ({ evaluateWithGroq }));

const { createApp } = await import('../src/app.js');
const { closeDb, getDb } = await import('../src/db/db.js');
const { startSession, visitor } = await import('./helpers/session.js');
const {
  assertDailyBudget,
  secondsUntilReset,
  DAILY_EVALUATIONS_PER_SESSION,
  DAILY_EVALUATIONS_GLOBAL,
} = await import('../src/limits.js');
const { ApiError } = await import('../src/errors.js');
const { insertResume } = await import('../src/db/repositories/resumeRepo.js');
const { insertJob } = await import('../src/db/repositories/jobRepo.js');
const { exec, rows } = await import('./helpers/db.js');

// A fresh app per test: express-rate-limit keeps its counters in memory, so a
// shared instance would carry one test's burst into the next.
let app: ReturnType<typeof createApp>;

const RESUME = 'Alice Anderson, React engineer with eight years of experience. '.repeat(5);
const JD =
  'We are hiring a Frontend Engineer. Required: 3+ years React, TypeScript and automated testing.';

const PAYLOAD = {
  summary: 'Reasonable fit.',
  missing_keywords: [],
  requirements: [
    {
      requirement: '3+ years React',
      category: 'skill',
      importance: 'must',
      evidence: 'Built React dashboards',
      status: 'met',
    },
  ],
};

const body = (over: Record<string, unknown> = {}) => ({
  jobName: 'Frontend Engineer',
  company: 'Acme',
  jdText: JD,
  resumeText: RESUME,
  ...over,
});

/** Writes `count` jobs for a session with a chosen timestamp, cheaply. */
async function seedJobs(
  sessionId: string,
  count: number,
  createdAt = new Date().toISOString(),
): Promise<void> {
  const db = await getDb();
  const resume = await insertResume(db, {
    label: 'r.pdf',
    content: 'content',
    setDefault: false,
    sessionId,
  });

  for (let i = 0; i < count; i += 1) {
    const id = await insertJob(db, {
      sessionId,
      jobName: `Job ${i}`,
      company: 'Acme',
      matchScore: 50,
      summary: 's',
      missingKeywords: [],
      jdText: 'jd',
      resumeId: resume.id,
      model: 'openai/gpt-oss-120b',
      items: [
        {
          requirement: 'React',
          category: 'skill',
          importance: 'must',
          evidence: '',
          status: 'met',
        },
      ],
    });
    await exec('UPDATE jobs SET created_at = ? WHERE id = ?', [createdAt, id]);
  }
}

beforeEach(async () => {
  await closeDb();
  evaluateWithGroq.mockReset();
  evaluateWithGroq.mockResolvedValue({ payload: PAYLOAD, model: 'openai/gpt-oss-120b' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = createApp();
});

describe('secondsUntilReset', () => {
  it('counts down to the next UTC midnight', () => {
    expect(secondsUntilReset(new Date('2026-10-11T23:59:00.000Z'))).toBe(60);
    expect(secondsUntilReset(new Date('2026-10-11T00:00:00.000Z'))).toBe(24 * 60 * 60);
  });

  it('never returns zero, so a client countdown always has something to show', () => {
    expect(secondsUntilReset(new Date('2026-10-11T23:59:59.999Z'))).toBeGreaterThan(0);
  });
});

describe('the per-visitor daily cap', () => {
  it('allows evaluations up to the cap', async () => {
    await seedJobs('alice', DAILY_EVALUATIONS_PER_SESSION - 1);

    await expect(assertDailyBudget(await getDb(), 'alice')).resolves.toBeUndefined();
  });

  it('blocks the one after the cap', async () => {
    await seedJobs('alice', DAILY_EVALUATIONS_PER_SESSION);

    const err = await assertDailyBudget(await getDb(), 'alice').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as InstanceType<typeof ApiError>;
    expect(apiErr.code).toBe('RATE_LIMITED');
    expect(apiErr.status).toBe(429);
    expect(apiErr.retryAfter).toBeGreaterThan(0);
    expect(apiErr.message).toMatch(/per visitor per day/i);
  });

  it('does not punish one visitor for another visitor’s usage', async () => {
    await seedJobs('alice', DAILY_EVALUATIONS_PER_SESSION);

    await expect(assertDailyBudget(await getDb(), 'bob')).resolves.toBeUndefined();
  });

  it('ignores yesterday’s evaluations', async () => {
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await seedJobs('alice', DAILY_EVALUATIONS_PER_SESSION + 3, yesterday);

    await expect(assertDailyBudget(await getDb(), 'alice')).resolves.toBeUndefined();
  });
});

describe('the global daily ceiling', () => {
  it('stops everyone once the demo has spent its budget', async () => {
    // Spread across many sessions, so no per-visitor cap fires first.
    for (let i = 0; i < DAILY_EVALUATIONS_GLOBAL; i += 1) {
      await seedJobs(`visitor-${i}`, 1);
    }

    await expect(assertDailyBudget(await getDb(), 'a-brand-new-visitor')).rejects.toThrow(
      /daily limit/i,
    );
  });

  it('is the backstop when someone keeps minting new sessions', async () => {
    for (let i = 0; i < DAILY_EVALUATIONS_GLOBAL - 1; i += 1) {
      await seedJobs(`visitor-${i}`, 1);
    }

    await expect(assertDailyBudget(await getDb(), 'fresh')).resolves.toBeUndefined();
  });
});

describe('POST /api/evaluate under the daily cap', () => {
  it('returns 429 with a countdown instead of calling Groq', async () => {
    const agent = visitor(app);
    const sessionId = await startSession(agent);
    // Seed the day's usage directly: five calls in a row would trip the
    // per-minute burst limiter first, which is a different layer.
    await seedJobs(sessionId, DAILY_EVALUATIONS_PER_SESSION);

    evaluateWithGroq.mockClear();
    const blocked = await agent.post('/api/evaluate').send(body({ jobName: 'One too many' }));

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.retryAfter).toBeGreaterThan(0);
    expect(blocked.headers['retry-after']).toBeDefined();
    // The whole point: no request is sent, so no quota is spent.
    expect(evaluateWithGroq).not.toHaveBeenCalled();
  });

  it('still allows a visitor who is under the cap', async () => {
    const agent = visitor(app);
    const sessionId = await startSession(agent);
    await seedJobs(sessionId, DAILY_EVALUATIONS_PER_SESSION - 1);

    const res = await agent.post('/api/evaluate').send(body());

    expect(res.status).toBe(201);
    expect(evaluateWithGroq).toHaveBeenCalledOnce();
  });

  it('saves nothing when a request is capped', async () => {
    const agent = visitor(app);
    const sessionId = await startSession(agent);
    await seedJobs(sessionId, DAILY_EVALUATIONS_PER_SESSION);

    const before = await rows('resumes');
    await agent.post('/api/evaluate').send(body({ jobName: 'Blocked' }));
    const after = await rows('resumes');

    // resolveResume writes a resume row, so the cap has to run before it.
    expect(after).toBe(before);
  });
});

describe('the per-minute burst limiter', () => {
  it('cuts off a rapid run of evaluations from one IP', async () => {
    const agent = visitor(app);

    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await agent.post('/api/evaluate').send(body({ jobName: `Burst ${i}` }));
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 201).length).toBe(3);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });

  it('answers a throttled request in the shape the client already handles', async () => {
    const agent = visitor(app);
    for (let i = 0; i < 3; i += 1) {
      await agent.post('/api/evaluate').send(body({ jobName: `Burst ${i}` }));
    }

    const throttled = await agent.post('/api/evaluate').send(body({ jobName: 'Fourth' }));

    expect(throttled.status).toBe(429);
    expect(throttled.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(throttled.body.error.retryAfter).toBeGreaterThan(0);
  });
});

describe('security headers', () => {
  it('sends helmet defaults and no framework fingerprint', async () => {
    const res = await visitor(app).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
