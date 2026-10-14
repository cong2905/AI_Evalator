import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { loadEnv } from './env.js';
import { getDb } from './db/db.js';
import { touchSession } from './db/repositories/sessionRepo.js';

export const SESSION_COOKIE = 'ajev_sid';

/** Matches the data retention window, so the cookie and the rows expire together. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A session id is a UUID; anything else in the cookie is treated as absent. */
function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/**
 * Gives every visitor a private sandbox without a signup.
 *
 * The cookie is rolling: each visit pushes the expiry out another window, and
 * `touchSession` records the visit so retention can keep an active visitor's
 * data. Stop refreshing either one and a returning user loses everything on the
 * seventh day regardless of how often they came back. The id is the only
 * thing that separates one visitor's resumes and jobs from another's, so it is
 * signed (a forged cookie is rejected) and httpOnly (page scripts cannot read
 * it). A visitor on a second device or in a private window is a new session;
 * that is inherent to cookie identity without accounts.
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    signed: true,
    // Load-bearing CSRF protection: cookie auth makes POST /api/evaluate and
    // DELETE /api/jobs/:id reachable from another site. 'lax' is what stops a
    // cross-site form or fetch from carrying this cookie. Never widen to 'none'.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function sessionMiddleware(): RequestHandler {
  return (req, res, next) => {
    const existing = req.signedCookies?.[SESSION_COOKIE] as unknown;

    req.sessionId = isValidId(existing) ? existing : randomUUID();

    setSessionCookie(res, req.sessionId);
    touchSession(getDb(), req.sessionId);

    next();
  };
}

/** Clears the cookie, used by the "delete my data" route. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function cookieSecret(): string {
  return loadEnv().SESSION_SECRET;
}
