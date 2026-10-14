import type {
  ApiErrorBody,
  ApiErrorCode,
  DefaultResume,
  EvaluateRequest,
  HealthResponse,
  JobDetail,
  JobSummary,
  TransferCodeResponse,
  ParseResumeResponse,
  Resume,
} from '@app/shared';

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

export type SaveResumeInput = {
  text: string;
  label?: string;
  setDefault: boolean;
};

export const api = {
  health: (): Promise<HealthResponse> => request<HealthResponse>('/health'),

  /** Resolves to null when nothing has been saved yet, which is not an error. */
  async getDefaultResume(): Promise<DefaultResume | null> {
    try {
      return await request<DefaultResume>('/resume/default');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  },

  /** Parses an upload for preview; nothing is stored until the resume is saved. */
  async parseResumeFile(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const res = await request<ParseResumeResponse>('/resume/parse', {
      method: 'POST',
      body: form,
    });
    return res.text;
  },

  saveResume(input: SaveResumeInput): Promise<Resume> {
    return request<Resume>('/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /** Newest first. `q` filters by job name or company. */
  listJobs(q?: string): Promise<JobSummary[]> {
    const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return request<JobSummary[]>(`/jobs${query}`);
  },

  getJob(id: number): Promise<JobDetail> {
    return request<JobDetail>(`/jobs/${id}`);
  },

  deleteJob(id: number): Promise<void> {
    return request<void>(`/jobs/${id}`, { method: 'DELETE' });
  },

  /** A short-lived, single-use code that opens this session on another device. */
  createTransferCode(): Promise<TransferCodeResponse> {
    return request<TransferCodeResponse>('/session/transfer-code', { method: 'POST' });
  },

  /** Adopts the session the code belongs to; this device's own rows become unreachable. */
  adoptSession(code: string): Promise<void> {
    return request<void>('/session/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  },

  deleteMyData(): Promise<void> {
    return request<void>('/session/data', { method: 'DELETE' });
  },

  /** Saves the evaluation server-side and returns it; takes 5-15s. */
  evaluate(input: EvaluateRequest): Promise<JobDetail> {
    return request<JobDetail>('/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },
};
