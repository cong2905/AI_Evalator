import { Router } from 'express';
import type { JobDetail, JobSummary } from '@app/shared';
import { ApiError, wrap } from '../errors.js';
import { getDb } from '../db/db.js';
import { deleteJob, getJobDetail, listJobs } from '../db/repositories/jobRepo.js';
import { idParamSchema, parseOrThrow } from '../schemas.js';

export const jobsRouter: Router = Router();

jobsRouter.get(
  '/jobs',
  wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const jobs: JobSummary[] = await listJobs(await getDb(), req.sessionId, q);
    res.json(jobs);
  }),
);

jobsRouter.get(
  '/jobs/:id',
  wrap(async (req, res) => {
    const id = parseOrThrow(idParamSchema, req.params.id);

    // Scoped by session, so another visitor's id reads as missing, not forbidden.
    const detail: JobDetail | undefined = await getJobDetail(await getDb(), req.sessionId, id);
    if (!detail) {
      throw new ApiError('NOT_FOUND', `No saved job with id ${id}.`);
    }
    res.json(detail);
  }),
);

jobsRouter.delete(
  '/jobs/:id',
  wrap(async (req, res) => {
    const id = parseOrThrow(idParamSchema, req.params.id);

    if (!(await deleteJob(await getDb(), req.sessionId, id))) {
      throw new ApiError('NOT_FOUND', `No saved job with id ${id}.`);
    }
    console.log(`[jobs] deleted #${id}`);
    res.status(204).end();
  }),
);
