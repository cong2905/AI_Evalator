import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { healthRouter } from './routes/health.js';
import { resumeRouter } from './routes/resume.js';
import { evaluateRouter } from './routes/evaluate.js';
import { jobsRouter } from './routes/jobs.js';
import { sessionRouter } from './routes/session.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { cookieSecret, sessionMiddleware } from './sessions.js';
import { adoptRateLimiter, apiRateLimiter, evaluateRateLimiter } from './limits.js';
import { mountClient } from './static.js';

/** Builds the app without listening, so tests can drive it with supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  // Fly terminates TLS and forwards, so the real client IP is in X-Forwarded-For.
  // Without this the rate limiter would see one proxy IP for every visitor.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(cookieSecret()));
  // Only /api needs a session, and scoping it here keeps Set-Cookie off every
  // static asset response. Must run before the routers: every query below is
  // scoped to req.sessionId.
  app.use('/api', sessionMiddleware());

  app.use('/api', apiRateLimiter());

  app.use('/api', healthRouter);
  app.use('/api', resumeRouter);
  app.use('/api/evaluate', evaluateRateLimiter());
  app.use('/api', evaluateRouter);
  app.use('/api', jobsRouter);
  // Tight limit so an 8-character code cannot be brute-forced online.
  app.use('/api/session/adopt', adoptRateLimiter());
  app.use('/api', sessionRouter);

  // After the API routes, so /api never falls through to the SPA shell.
  mountClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
