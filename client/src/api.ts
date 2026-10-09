import type { ApiErrorBody, ApiErrorCode, HealthResponse } from '@app/shared';

/** Thrown by every helper below, so UI code can switch on `code`. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(status: number, code: ApiErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiClientError(0, 'AI_UNAVAILABLE', 'Cannot reach the server. Is it running?');
  }

  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    const err = (body as ApiErrorBody | undefined)?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.retryAfter,
    );
  }

  return body as T;
}

export const api = {
  health: (): Promise<HealthResponse> => request<HealthResponse>('/health'),
};
