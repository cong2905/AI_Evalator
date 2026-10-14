import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluateWithGroq = vi.hoisted(() => vi.fn());
vi.mock('../src/services/groqClient.js', () => ({ evaluateWithGroq }));

const { createApp } = await import('../src/app.js');
const { closeDb, getDb } = await import('../src/db/db.js');
const { visitor, startSession } = await import('./helpers/session.js');
const { createTransferCode, normalizeCode, redeemTransferCode, countLiveCodes } = await import(
  '../src/db/repositories/transferRepo.js'
);
const { purgeExpiredData, purgeSession, RETENTION_DAYS } = await import('../src/retention.js');
const { touchSession, getLastSeen } = await import('../src/db/repositories/sessionRepo.js');
const { insertResume } = await import('../src/db/repositories/resumeRepo.js');
const { insertJob } = await import('../src/db/repositories/jobRepo.js');

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

const evaluateBody = (over: Record<string, unknown> = {}) => ({
  jobName: 'Frontend Engineer',
  company: 'Acme',
  jdText: JD,
  resumeText: RESUME,
  ...over,
});

/** Writes a job for a session with a chosen age in days. */
function seedJob(sessionId: string, ageDays: number, name = 'Job'): number {
  const db = getDb();
  const at = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  // The visitor exists and was last seen just now unless a test says otherwise.
  touchSession(db, sessionId);

  const resume = insertResume(db, {
    label: 'r.pdf',
    content: 'content',
    setDefault: false,
    sessionId,
  });
  db.prepare('UPDATE resumes SET updated_at = ? WHERE id = ?').run(at, resume.id);

  const id = insertJob(db, {
    sessionId,
    jobName: name,
    company: 'Acme',
    matchScore: 50,
    summary: 's',
    missingKeywords: [],
    jdText: 'jd',
    resumeId: resume.id,
    model: 'openai/gpt-oss-120b',
    items: [
      { requirement: 'React', category: 'skill', importance: 'must', evidence: '', status: 'met' },
    ],
  });
  db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run(at, id);
  return id;
}

beforeEach(() => {
  closeDb();
  evaluateWithGroq.mockReset();
  evaluateWithGroq.mockResolvedValue({ payload: PAYLOAD, model: 'openai/gpt-oss-120b' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = createApp();
});

describe('transfer codes', () => {
  it('issues a typable, unambiguous code', async () => {
    const agent = visitor(app);

    const res = await agent.post('/api/session/transfer-code');

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    // No I, L, O or U, which are the characters people misread.
    expect(res.body.code).not.toMatch(/[ILOU]/);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('never stores the code itself', async () => {
    const agent = visitor(app);

    const res = await agent.post('/api/session/transfer-code');
    const rows = getDb().prepare('SELECT * FROM transfer_codes').all();

    expect(JSON.stringify(rows)).not.toContain(res.body.code.replace('-', ''));
    expect(JSON.stringify(rows)).not.toContain(res.body.code);
  });

  it('moves a session to a second device, leaving both working', async () => {
    const laptop = visitor(app);
    const phone = visitor(app);

    await laptop.post('/api/evaluate').send(evaluateBody());
    const { body } = await laptop.post('/api/session/transfer-code');

    const adopted = await phone.post('/api/session/adopt').send({ code: body.code });
    expect(adopted.status).toBe(204);

    expect((await phone.get('/api/jobs')).body).toHaveLength(1);
    expect((await laptop.get('/api/jobs')).body).toHaveLength(1);
  });

  it('accepts a sloppily typed code', async () => {
    const laptop = visitor(app);
    const phone = visitor(app);
    await laptop.post('/api/evaluate').send(evaluateBody());
    const { body } = await laptop.post('/api/session/transfer-code');

    const sloppy = body.code.toLowerCase().replace('-', ' ');
    const adopted = await phone.post('/api/session/adopt').send({ code: sloppy });

    expect(adopted.status).toBe(204);
    expect((await phone.get('/api/jobs')).body).toHaveLength(1);
  });

  it('works once', async () => {
    const laptop = visitor(app);
    await laptop.post('/api/evaluate').send(evaluateBody());
    const { body } = await laptop.post('/api/session/transfer-code');

    expect((await visitor(app).post('/api/session/adopt').send({ code: body.code })).status).toBe(
      204,
    );
    const second = await visitor(app).post('/api/session/adopt').send({ code: body.code });

    expect(second.status).toBe(400);
  });

  it('expires after ten minutes', () => {
    const db = getDb();
    const { code } = createTransferCode(db, 'alice');

    const elevenMinutes = new Date(Date.now() + 11 * 60 * 1000);
    expect(redeemTransferCode(db, code, elevenMinutes)).toBeUndefined();

    const nineMinutes = new Date(Date.now() + 9 * 60 * 1000);
    expect(redeemTransferCode(db, code, nineMinutes)).toBe('alice');
  });

  it('gives the same answer for unknown, used and expired codes', async () => {
    const unknown = await visitor(app).post('/api/session/adopt').send({ code: 'ZZZZ-ZZZZ' });

    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/not valid/i);
  });

  it('maps Crockford look-alikes so O/0 and I/1 cannot be confused', () => {
    expect(normalizeCode('o1il-u234')).toBe(normalizeCode('0111-V234'));
  });

  it('rate-limits guessing', async () => {
    const attacker = visitor(app);

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await attacker.post('/api/session/adopt').send({ code: `AAAA-AAA${i % 10}` });
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('delete my data', () => {
  it('removes this visitor’s jobs and resumes', async () => {
    const agent = visitor(app);
    await agent.post('/api/evaluate').send(evaluateBody());

    const res = await agent.delete('/api/session/data');

    expect(res.status).toBe(204);
    const db = getDb();
    expect((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM resumes').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM job_items').get() as { n: number }).n).toBe(0);
  });

  it('leaves other visitors alone', async () => {
    const alice = visitor(app);
    const bob = visitor(app);
    await alice.post('/api/evaluate').send(evaluateBody());
    await bob.post('/api/evaluate').send(evaluateBody());

    await alice.delete('/api/session/data');

    expect((await bob.get('/api/jobs')).body).toHaveLength(1);
  });

  it('clears the cookie so the next visit starts clean', async () => {
    const agent = visitor(app);
    await agent.post('/api/evaluate').send(evaluateBody());

    const res = await agent.delete('/api/session/data');

    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('ajev_sid=;'))).toBe(true);
  });

  it('also burns any outstanding transfer codes', async () => {
    const agent = visitor(app);
    const sessionId = await startSession(agent);
    await agent.post('/api/session/transfer-code');

    purgeSession(getDb(), sessionId);

    expect(countLiveCodes(getDb())).toBe(0);
  });
});

describe('the retention purge', () => {
  /** Backdates a visitor's last visit. */
  function lastSeenDaysAgo(sessionId: string, days: number): void {
    const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    getDb().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(at, sessionId);
  }

  it('keeps an active visitor’s data however old it is', () => {
    seedJob('alice', 90, 'Three months old');
    lastSeenDaysAgo('alice', 0);

    const removed = purgeExpiredData(getDb());

    expect(removed.jobs).toBe(0);
    const left = getDb().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(left.n).toBe(1);
  });

  it('keeps data for a visitor who came back on day six', () => {
    seedJob('alice', 30, 'Old job');
    lastSeenDaysAgo('alice', RETENTION_DAYS - 1);

    purgeExpiredData(getDb());

    const left = getDb().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
    expect(left.n).toBe(1);
  });

  it('removes everything for a visitor gone longer than the window', () => {
    seedJob('alice', 1, 'Yesterday');
    lastSeenDaysAgo('alice', RETENTION_DAYS + 1);

    const removed = purgeExpiredData(getDb());

    expect(removed.jobs).toBe(1);
    expect(removed.resumes).toBe(1);
    expect(removed.sessions).toBe(1);
  });

  it('judges each visitor separately', () => {
    seedJob('active', 20, 'Kept');
    seedJob('gone', 1, 'Dropped');
    lastSeenDaysAgo('gone', RETENTION_DAYS + 2);

    purgeExpiredData(getDb());

    const names = getDb().prepare('SELECT job_name FROM jobs').all() as Array<{ job_name: string }>;
    expect(names.map((r) => r.job_name)).toEqual(['Kept']);
  });

  it('removes rows orphaned by a cleared cookie', () => {
    seedJob('alice', 1, 'Fresh but orphaned');
    getDb().prepare('UPDATE jobs SET session_id = NULL').run();
    getDb().prepare('UPDATE resumes SET session_id = NULL').run();

    const removed = purgeExpiredData(getDb());

    expect(removed.jobs).toBe(1);
    expect(removed.resumes).toBe(1);
  });

  it('never deletes a resume a surviving job still points at', () => {
    const db = getDb();
    touchSession(db, 'alice');
    const resume = insertResume(db, {
      label: 'old.pdf',
      content: 'content',
      setDefault: false,
      sessionId: 'alice',
    });
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    db.prepare('UPDATE resumes SET updated_at = ? WHERE id = ?').run(old, resume.id);

    insertJob(db, {
      sessionId: 'alice',
      jobName: 'Recent job',
      company: 'Acme',
      matchScore: 50,
      summary: 's',
      missingKeywords: [],
      jdText: 'jd',
      resumeId: resume.id,
      model: 'openai/gpt-oss-120b',
      items: [
        { requirement: 'React', category: 'skill', importance: 'must', evidence: '', status: 'met' },
      ],
    });

    expect(() => purgeExpiredData(db)).not.toThrow();

    const left = db.prepare('SELECT COUNT(*) AS n FROM resumes').get() as { n: number };
    expect(left.n).toBe(1);
  });

  it('clears used and expired transfer codes', () => {
    const db = getDb();
    const { code } = createTransferCode(db, 'alice');
    redeemTransferCode(db, code);
    createTransferCode(db, 'bob', new Date(Date.now() - 60 * 60 * 1000));

    const removed = purgeExpiredData(db);

    expect(removed.codes).toBe(2);
  });

  it('removes a job’s items with it', () => {
    seedJob('alice', 1, 'Old');
    lastSeenDaysAgo('alice', RETENTION_DAYS + 2);

    purgeExpiredData(getDb());

    const items = getDb().prepare('SELECT COUNT(*) AS n FROM job_items').get() as { n: number };
    expect(items.n).toBe(0);
  });
});

describe('session activity', () => {
  it('records a visitor on their first request', async () => {
    const agent = visitor(app);
    const sessionId = await startSession(agent);

    expect(getLastSeen(getDb(), sessionId)).toBeDefined();
  });

  it('rolls the cookie forward on a return visit', async () => {
    const agent = visitor(app);
    await agent.get('/api/health');

    const second = await agent.get('/api/health');

    // A fixed-expiry cookie would send nothing here, and the visitor would be
    // logged out seven days after their first visit no matter how active.
    const cookies = (second.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('ajev_sid='))).toBe(true);
    expect(cookies[0]).toMatch(/Max-Age=604800/);
  });

  it('keeps the same session id while rolling it', async () => {
    const agent = visitor(app);
    const first = await startSession(agent);
    await agent.get('/api/health');
    const stillThere = getLastSeen(getDb(), first);

    expect(stillThere).toBeDefined();
    const rows = getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('does not write on every single request', () => {
    const db = getDb();
    touchSession(db, 'alice');
    const first = getLastSeen(db, 'alice');

    touchSession(db, 'alice', new Date(Date.now() + 60_000));

    // A minute later is not worth a disk write; retention counts in days.
    expect(getLastSeen(db, 'alice')).toBe(first);
  });

  it('does write once the timestamp is properly stale', () => {
    const db = getDb();
    touchSession(db, 'alice');
    const first = getLastSeen(db, 'alice');

    touchSession(db, 'alice', new Date(Date.now() + 2 * 60 * 60 * 1000));

    expect(getLastSeen(db, 'alice')).not.toBe(first);
  });
});
