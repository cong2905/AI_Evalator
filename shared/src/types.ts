/**
 * DTOs used by both the server and the client (SPEC.md section 5).
 * Types only — no runtime dependencies, so either side can import it freely.
 */

export type Category = 'skill' | 'experience' | 'education' | 'tool' | 'soft';
export type Importance = 'must' | 'nice';
export type Status = 'met' | 'partial' | 'missing';

export type JobItem = {
  requirement: string;
  category: Category;
  importance: Importance;
  evidence: string;
  status: Status;
};

export type JobSummary = {
  id: number;
  jobName: string;
  company: string;
  matchScore: number;
  createdAt: string;
};

export type JobDetail = JobSummary & {
  summary: string;
  missingKeywords: string[];
  jdText: string;
  model: string;
  resumeLabel: string;
  items: JobItem[];
};

export type Resume = {
  id: number;
  label: string;
  content: string;
  isDefault: boolean;
  updatedAt: string;
};

/** `GET /api/resume/default` — no `isDefault` field, it is always true. */
export type DefaultResume = Omit<Resume, 'isDefault'>;

export type ParseResumeResponse = { text: string };

export type EvaluateRequest = {
  jobName: string;
  company: string;
  jdText: string;
  resumeText?: string;
  resumeId?: number;
};

/** `POST /api/session/transfer-code` — moves a session to another device. */
export type TransferCodeResponse = {
  code: string;
  /** ISO 8601; the code stops working at this moment. */
  expiresAt: string;
};

export type HealthResponse = {
  status: 'ok';
  model: string;
  /** ISO 8601 timestamp of when the server process started. */
  startedAt: string;
};

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'NO_DEFAULT_RESUME'
  | 'PARSE_FAILED'
  | 'INPUT_TOO_LONG'
  | 'RATE_LIMITED'
  | 'AI_BAD_OUTPUT'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Seconds to wait, only on RATE_LIMITED. */
    retryAfter?: number;
  };
};

/** Input limits (SPEC.md section 5), shared so the UI can show the same counters. */
export const LIMITS = {
  jdText: { min: 50, max: 8_000 },
  resumeText: { min: 200, max: 10_000 },
  jobName: { min: 1, max: 120 },
  company: { min: 1, max: 120 },
  uploadBytes: 5 * 1024 * 1024,
} as const;
