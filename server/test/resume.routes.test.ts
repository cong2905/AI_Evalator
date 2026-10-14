import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startSession, visitor, type Agent } from './helpers/session.js';
import { closeDb, getDb } from '../src/db/db.js';
import { countResumes, getDefaultResume } from '../src/db/repositories/resumeRepo.js';

const app = createApp();
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pdf = path.join(fixtures, 'sample-resume.pdf');
const docx = path.join(fixtures, 'sample-resume.docx');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const RESUME = 'Jane Doe, frontend engineer. '.repeat(10); // comfortably over the 200 char floor

let agent: Agent;
let sessionId: string;

// Each test starts from an empty database and a fresh visitor cookie.
beforeEach(async () => {
  closeDb();
  agent = visitor(app);
  sessionId = await startSession(agent);
});

describe('GET /api/resume/default', () => {
  it('404s when nothing is saved yet', async () => {
    const res = await agent.get('/api/resume/default');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns the saved default', async () => {
    await agent.post('/api/resume').send({ text: RESUME });

    const res = await agent.get('/api/resume/default');

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Pasted resume');
    expect(res.body.content).toContain('Jane Doe');
    expect(res.body).not.toHaveProperty('isDefault');
    expect(new Date(res.body.updatedAt).toISOString()).toBe(res.body.updatedAt);
  });
});

describe('POST /api/resume', () => {
  it('saves pasted text as the default', async () => {
    const res = await agent.post('/api/resume').send({ text: RESUME });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: 'Pasted resume', isDefault: true });
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('saves an uploaded PDF and labels it with the file name', async () => {
    const res = await agent
      .post('/api/resume')
      .attach('file', pdf)
      .field('setDefault', 'true');

    expect(res.status).toBe(201);
    expect(res.body.label).toBe('sample-resume.pdf');
    expect(res.body.content).toContain('Northwind');
    expect(res.body.isDefault).toBe(true);
  });

  it('saves an uploaded DOCX', async () => {
    const res = await agent.post('/api/resume').attach('file', docx, { contentType: DOCX_MIME });

    expect(res.status).toBe(201);
    expect(res.body.content).toContain('Jane Doe');
  });

  it('keeps exactly one default across saves, and keeps the old rows', async () => {
    await agent.post('/api/resume').send({ text: RESUME, label: 'first' });
    await agent.post('/api/resume').send({ text: RESUME, label: 'second' });

    const db = getDb();
    const defaults = db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE is_default = 1').get() as {
      n: number;
    };

    expect(defaults.n).toBe(1);
    expect(countResumes(db, sessionId)).toBe(2);
    expect(getDefaultResume(db, sessionId)?.label).toBe('second');
  });

  it('honours setDefault=false', async () => {
    await agent.post('/api/resume').send({ text: RESUME, label: 'keeper' });
    const res = await agent
      .post('/api/resume')
      .send({ text: RESUME, label: 'scratch', setDefault: false });

    expect(res.body.isDefault).toBe(false);
    expect(getDefaultResume(getDb(), sessionId)?.label).toBe('keeper');
  });

  it('rejects a resume under the 200 character floor', async () => {
    const res = await agent.post('/api/resume').send({ text: 'too short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/at least 200/);
  });

  it('rejects a resume over the 10,000 character ceiling and says how much to cut', async () => {
    const res = await agent
      .post('/api/resume')
      .send({ text: 'x'.repeat(10_500) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('INPUT_TOO_LONG');
    expect(res.body.error.message).toMatch(/Cut 500/);
  });

  it('rejects a request with neither file nor text', async () => {
    const res = await agent.post('/api/resume').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('saves nothing when the upload is not a real PDF', async () => {
    const res = await agent
      .post('/api/resume')
      .attach('file', path.join(fixtures, 'not-really.pdf'));

    expect(res.status).toBe(422);
    expect(countResumes(getDb(), sessionId)).toBe(0);
  });
});

describe('POST /api/resume/parse', () => {
  it('returns text without saving anything', async () => {
    const res = await agent.post('/api/resume/parse').attach('file', pdf);

    expect(res.status).toBe(200);
    expect(res.body.text).toContain('Jane Doe');
    expect(countResumes(getDb(), sessionId)).toBe(0);
  });

  it('requires a file', async () => {
    const res = await agent.post('/api/resume/parse').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a .txt upload', async () => {
    const res = await agent
      .post('/api/resume/parse')
      .attach('file', Buffer.from('plain text resume'), 'resume.txt');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a file over 5 MB', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0x20);
    Buffer.from('%PDF-1.4\n').copy(big);

    const res = await agent
      .post('/api/resume/parse')
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('INPUT_TOO_LONG');
  });

  it('never writes the upload to disk', async () => {
    await agent.post('/api/resume/parse').attach('file', pdf);

    const stray = fs.existsSync(path.join(process.cwd(), 'uploads'));
    expect(stray).toBe(false);
  });
});
