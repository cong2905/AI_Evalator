import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/health', () => {
  it('reports ok with the configured model', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.model).toBe('openai/gpt-oss-120b');
    expect(new Date(res.body.startedAt).toISOString()).toBe(res.body.startedAt);
  });

  it('never leaks the API key', async () => {
    const res = await request(app).get('/api/health');
    expect(JSON.stringify(res.body)).not.toContain('test-key-not-real');
  });
});

describe('unknown routes', () => {
  it('returns the standard error shape', async () => {
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /api/nope' },
    });
  });
});
