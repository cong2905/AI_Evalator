import express, { type Express } from 'express';
import { healthRouter } from './routes/health.js';
import { resumeRouter } from './routes/resume.js';
import { errorHandler, notFoundHandler } from './errors.js';

/** Builds the app without listening, so tests can drive it with supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api', resumeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
