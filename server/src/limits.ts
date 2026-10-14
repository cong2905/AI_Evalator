import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { ApiErrorBody } from '@app/shared';
import { ApiError } from './errors.js';
import type { Db } from './db/db.js';

/**
 * Three layers stand between a public URL and an empty Groq quota
 * (free plan: 30 requests/min, 1,000/day):
 *
 *  1. per-IP rate limits, below
 *  2. a per-visitor daily cap, so one person cannot spend the day's budget
 *  3. a global daily ceiling, the backstop when the first two are evaded
 *     (new cookie per request, rotating IPs)
 *
 * Every layer surfaces as the existing RATE_LIMITED error, so the client's
 * countdown handles them with no extra UI.
 */
export const DAILY_EVALUATIONS_PER_SESSION = 5;
export const DAILY_EVALUATIONS_GLOBAL = 150;

function rateLimitBody(retryAfter: number, message: string): ApiErrorBody {
  return { error: { code: 'RATE_LIMITED', message, retryAfter } };
}

/** Seconds until the next UTC midnight, when the daily counters reset. */
export function secondsUntilReset(now = new Date()): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** Broad limit on everything under /api, to blunt scripted hammering. */
export function apiRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(rateLimitBody(60, 'Too many requests. Wait a minute and try again.'));
    },
  });
}

/** Tighter limit on the one route that costs money. */
export function evaluateRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json(rateLimitBody(60, 'That is a lot of evaluations at once. Try again in a minute.'));
    },
  });
}

/** Brute-forcing an 8-character transfer code has to be slow to be useless. */
export function adoptRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json(rateLimitBody(900, 'Too many code attempts. Wait 15 minutes and try again.'));
    },
  });
}

function countSince(db: Db, isoSince: string, sessionId?: string): number {
  const row = (
    sessionId === undefined
      ? db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE created_at >= ?').get(isoSince)
      : db
          .prepare('SELECT COUNT(*) AS n FROM jobs WHERE created_at >= ? AND session_id = ?')
          .get(isoSince, sessionId)
  ) as { n: number };
  return row.n;
}

/** Start of the current UTC day, the window both daily caps count over. */
function startOfDayIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  ).toISOString();
}

/**
 * Throws RATE_LIMITED when this visitor, or the demo as a whole, has used up
 * the day's evaluations. Counted from saved jobs, so there is no extra table to
 * keep in sync — a failed evaluation saves nothing and therefore costs nothing.
 */
export function assertDailyBudget(db: Db, sessionId: string, now = new Date()): void {
  const since = startOfDayIso(now);
  const retryAfter = secondsUntilReset(now);

  if (countSince(db, since, sessionId) >= DAILY_EVALUATIONS_PER_SESSION) {
    throw new ApiError(
      'RATE_LIMITED',
      `This demo allows ${DAILY_EVALUATIONS_PER_SESSION} evaluations per visitor per day. ` +
        `Your allowance resets at midnight UTC.`,
      retryAfter,
    );
  }

  if (countSince(db, since) >= DAILY_EVALUATIONS_GLOBAL) {
    throw new ApiError(
      'RATE_LIMITED',
      'The demo has hit its daily limit on AI requests. Try again tomorrow.',
      retryAfter,
    );
  }
}
