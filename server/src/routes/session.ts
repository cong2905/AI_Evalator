import { Router } from 'express';
import { z } from 'zod';
import type { TransferCodeResponse } from '@app/shared';
import { ApiError } from '../errors.js';
import { getDb } from '../db/db.js';
import { clearSessionCookie, setSessionCookie } from '../sessions.js';
import { parseOrThrow } from '../schemas.js';
import { createTransferCode, redeemTransferCode } from '../db/repositories/transferRepo.js';
import { purgeSession } from '../retention.js';

const adoptBodySchema = z.object({ code: z.string().min(1).max(40) }).strict();

export const sessionRouter: Router = Router();

sessionRouter.post('/session/transfer-code', (req, res) => {
  const { code, expiresAt } = createTransferCode(getDb(), req.sessionId);

  const body: TransferCodeResponse = { code, expiresAt };
  res.status(201).json(body);
});

sessionRouter.post('/session/adopt', (req, res) => {
  const { code } = parseOrThrow(adoptBodySchema, req.body ?? {});

  const sessionId = redeemTransferCode(getDb(), code);
  if (!sessionId) {
    // Unknown, already used and expired all read the same, so the response
    // cannot be used to probe which codes exist.
    throw new ApiError('VALIDATION_ERROR', 'That code is not valid. Codes last ten minutes and work once.');
  }

  setSessionCookie(res, sessionId);
  console.log('[session] a device adopted an existing session');
  res.status(204).end();
});

sessionRouter.delete('/session/data', (req, res) => {
  const removed = purgeSession(getDb(), req.sessionId);
  clearSessionCookie(res);

  console.log(`[session] visitor deleted ${removed.jobs} jobs and ${removed.resumes} resumes`);
  res.status(204).end();
});
