import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Two visitors must never see each other's resumes or evaluations, so nothing
// here may reach the real Groq API either.
const evaluateWithGroq = vi.hoisted(() => vi.fn());
vi.mock('../src/services/groqClient.js', () => ({ evaluateWithGroq }));

const { createApp } = await import('../src/app.js');
const { closeDb, getDb } = await import('../src/db/db.js');
const { SESSION_COOKIE, SESSION_MAX_AGE_MS } = await import('../src/sessions.js');
const { visitor } = await import('./helpers/session.js');

// A fresh app per test: express-rate-limit holds its counters in memory, so a
// shared instance would carry one test's requests into the next.
let app: ReturnType<typeof createApp>;

const RESUME_A = 'Alice Anderson, React engineer with eight years of experience. '.repeat(5);
const RESUME_B = 'Bob Brown, data analyst working mostly in SQL and Python. '.repeat(5);
const JD =
  'We are hiring a Frontend Engineer. Required: 3+ years React, TypeScript and automated testing.';

const PAYLOAD = {
  summary: 'Reasonable fit.',
  missing_keywords: ['Playwright'],
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

const evaluateBody = (over: Record<string, unknown> = {}) => ({
  jobName: 'Frontend Engineer',
  company: 'Acme',
  jdText: JD,
  ...over,
});

beforeEach(() => {
  closeDb();
  evaluateWithGroq.mockReset();
  evaluateWithGroq.mockResolvedValue({ payload: PAYLOAD, model: 'openai/gpt-oss-120b' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = createApp();
});

describe('the session cookie', () => {
  it('is issued on the first request', async () => {
    const res = await request(app).get('/api/health');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  it('is httpOnly, same-site and signed, so page scripts cannot read or forge it', async () => {
    const res = await request(app).get('/api/health');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Signed cookies are stored as "s:<id>.<signature>", url-encoded.
    expect(decodeURIComponent(cookie)).toContain('s:');
  });

  it('survives closing the browser — it carries a 7 day Max-Age', async () => {
    const res = await request(app).get('/api/health');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
    expect(maxAge).toBe(SESSION_MAX_AGE_MS / 1000);
    expect(maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('rolls the expiry forward on every visit without changing identity', async () => {
    const agent = visitor(app);

    const first = await agent.get('/api/health');
    const second = await agent.get('/api/health');

    const idOf = (res: { headers: Record<string, unknown> }) => {
      const cookies = (res.headers['set-cookie'] as string[]) ?? [];
      const raw = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
      return decodeURIComponent(raw.split(';')[0]!.split('=')[1] ?? '')
        .replace(/^s:/, '')
        .split('.')[0];
    };

    // Both responses re-set the cookie — that is what keeps an active visitor
    // from being logged out seven days after their first visit — but the
    // session id behind it must never change.
    expect(first.headers['set-cookie']).toBeDefined();
    expect(second.headers['set-cookie']).toBeDefined();
    expect(idOf(second)).toBe(idOf(first));
  });

  it('ignores a forged cookie and issues a fresh session', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Cookie', `${SESSION_COOKIE}=s%3Anot-a-real-uuid.badsignature`);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });
});

describe('two visitors', () => {
  it('do not share a default resume', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice.post('/api/resume').send({ text: RESUME_A, label: 'alice.pdf' });

    const bobsDefault = await bob.get('/api/resume/default');
    expect(bobsDefault.status).toBe(404);

    const alicesDefault = await alice.get('/api/resume/default');
    expect(alicesDefault.body.label).toBe('alice.pdf');
  });

  it('keep their own default when the other saves one', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice.post('/api/resume').send({ text: RESUME_A, label: 'alice.pdf' });
    await bob.post('/api/resume').send({ text: RESUME_B, label: 'bob.pdf' });

    // The is_default reset must be scoped — otherwise Bob's save unsets Alice's.
    expect((await alice.get('/api/resume/default')).body.label).toBe('alice.pdf');
    expect((await bob.get('/api/resume/default')).body.label).toBe('bob.pdf');
  });

  it('never see each other’s resume text', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice.post('/api/resume').send({ text: RESUME_A });
    await bob.post('/api/resume').send({ text: RESUME_B });

    const bobsView = await bob.get('/api/resume/default');
    expect(bobsView.body.content).toContain('Bob Brown');
    expect(bobsView.body.content).not.toContain('Alice Anderson');
  });

  it('do not see each other’s jobs in the list', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice.post('/api/evaluate').send(evaluateBody({ resumeText: RESUME_A }));

    expect((await bob.get('/api/jobs')).body).toEqual([]);
    expect((await alice.get('/api/jobs')).body).toHaveLength(1);
  });

  it('cannot open each other’s job by guessing the id', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    const created = await alice.post('/api/evaluate').send(evaluateBody({ resumeText: RESUME_A }));
    const id = created.body.id as number;

    const stolen = await bob.get(`/api/jobs/${id}`);

    // 404, not 403: Bob should not learn that the id exists at all.
    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(stolen.body)).not.toContain('Alice');
  });

  it('cannot delete each other’s job', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    const created = await alice.post('/api/evaluate').send(evaluateBody({ resumeText: RESUME_A }));
    const id = created.body.id as number;

    const attempt = await bob.delete(`/api/jobs/${id}`);

    expect(attempt.status).toBe(404);
    expect((await alice.get(`/api/jobs/${id}`)).status).toBe(200);
  });

  it('cannot evaluate against each other’s saved resume', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    const saved = await alice.post('/api/resume').send({ text: RESUME_A });
    const alicesResumeId = saved.body.id as number;

    const attempt = await bob
      .post('/api/evaluate')
      .send(evaluateBody({ resumeId: alicesResumeId }));

    expect(attempt.status).toBe(404);
    expect(evaluateWithGroq).not.toHaveBeenCalled();
  });

  it('cannot find each other’s jobs through the search box', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice
      .post('/api/evaluate')
      .send(evaluateBody({ resumeText: RESUME_A, company: 'Distinctive Corp' }));

    expect((await bob.get('/api/jobs?q=distinctive')).body).toEqual([]);
    expect((await alice.get('/api/jobs?q=distinctive')).body).toHaveLength(1);
  });

  it('file their rows under different session ids', async () => {
    const alice = visitor(app);
    const bob = visitor(app);

    await alice.post('/api/resume').send({ text: RESUME_A });
    await bob.post('/api/resume').send({ text: RESUME_B });

    const sessions = getDb()
      .prepare('SELECT DISTINCT session_id FROM resumes')
      .all() as Array<{ session_id: string | null }>;

    expect(sessions).toHaveLength(2);
    expect(sessions.every((row) => typeof row.session_id === 'string')).toBe(true);
  });
});

describe('rows from before the session column existed', () => {
  it('belong to nobody and are invisible to every visitor', async () => {
    const alice = visitor(app);
    await alice.post('/api/evaluate').send(evaluateBody({ resumeText: RESUME_A }));

    // Simulate a row written by the pre-v2 schema.
    getDb().prepare('UPDATE jobs SET session_id = NULL').run();

    expect((await alice.get('/api/jobs')).body).toEqual([]);
    expect((await visitor(app).get('/api/jobs')).body).toEqual([]);
  });
});
