import { Router } from 'express';
import type { HealthResponse } from '@app/shared';
import { loadEnv } from '../env.js';
import { getDb } from '../db/db.js';

export const healthRouter: Router = Router();

const startedAt = new Date().toISOString();

healthRouter.get('/health', (_req, res) => {
  const env = loadEnv();
  // Touch the database so health also proves migrations ran.
  getDb().prepare('SELECT 1').get();

  const body: HealthResponse = {
    status: 'ok',
    model: env.GROQ_MODEL,
    startedAt,
  };
  res.json(body);
});
