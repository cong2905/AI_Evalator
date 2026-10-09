import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody, ApiErrorCode } from '@app/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  NO_DEFAULT_RESUME: 409,
  PARSE_FAILED: 422,
  INPUT_TOO_LONG: 413,
  RATE_LIMITED: 429,
  AI_BAD_OUTPUT: 502,
  AI_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Every error the API returns on purpose. See SPEC.md section 5. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(code: ApiErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  const err = new ApiError('NOT_FOUND', `No route for ${req.method} ${req.path}`);
  res.status(err.status).json(err.toBody());
}

/** Express 4 needs all four parameters for this to register as an error handler. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    if (err.retryAfter !== undefined) res.setHeader('Retry-After', String(err.retryAfter));
    res.status(err.status).json(err.toBody());
    return;
  }

  console.error('[error] unhandled:', err);
  const fallback = new ApiError('INTERNAL_ERROR', 'Something went wrong on the server.');
  res.status(fallback.status).json(fallback.toBody());
}
