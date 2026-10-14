import request from 'supertest';
import type { Express } from 'express';
import { SESSION_COOKIE } from '../../src/sessions.js';

export type Agent = ReturnType<typeof request.agent>;

/**
 * A visitor. Plain `request(app)` sends no cookies, so every call would land in
 * a different session — route tests must use an agent, which keeps the jar.
 */
export function visitor(app: Express): Agent {
  return request.agent(app);
}

/**
 * Makes one harmless request so the cookie is minted, and digs the session id
 * out of it — tests that seed rows directly need to file them under the same
 * session the agent will send.
 */
export async function startSession(agent: Agent): Promise<string> {
  const res = await agent.get('/api/health');

  const header = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const raw = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) throw new Error('no session cookie was set');

  const value = decodeURIComponent(raw.split(';')[0]!.split('=')[1] ?? '');
  // Signed cookies arrive as "s:<id>.<signature>".
  return value.replace(/^s:/, '').split('.')[0]!;
}
