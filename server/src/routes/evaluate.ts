import { Router } from 'express';
import { wrap } from '../errors.js';
import { evaluateBodySchema, parseOrThrow } from '../schemas.js';
import { runEvaluation } from '../services/evaluationService.js';

export const evaluateRouter: Router = Router();

evaluateRouter.post(
  '/evaluate',
  wrap(async (req, res) => {
    const body = parseOrThrow(evaluateBodySchema, req.body ?? {});
    const detail = await runEvaluation({ ...body, sessionId: req.sessionId });
    res.status(201).json(detail);
  }),
);
