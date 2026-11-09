import { Router } from 'express';
import type { HealthResponse } from '@app/shared';
import { loadEnv } from '../env.js';
import { getDb } from '../db/db.js';
import { wrap } from '../errors.js';
import { get } from '../db/sql.js';

export const healthRouter: Router = Router();

const startedAt = new Date().toISOString();

healthRouter.get(
  '/health',
  wrap(async (_req, res) => {
    const env = loadEnv();
    // Touch the database so health also proves migrations ran — and, now that
    // the database is remote, that it is actually reachable.
    await get(await getDb(), 'SELECT 1 AS ok');

    const body: HealthResponse = {
      status: 'ok',
      model: env.GROQ_MODEL,
      startedAt,
    };
    res.json(body);
  }),
);
