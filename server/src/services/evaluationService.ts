import { LIMITS, type JobDetail, type JobItem } from '@app/shared';
import { ApiError } from '../errors.js';
import { getDb } from '../db/db.js';
import { getDefaultResume, getResumeById, insertResume } from '../db/repositories/resumeRepo.js';
import { getJobDetail, insertJob } from '../db/repositories/jobRepo.js';
import { assertLength } from '../schemas.js';
import { assertDailyBudget } from '../limits.js';
import { evaluateWithGroq, type EvaluationPayload } from './groqClient.js';
import { computeMatchScore } from './scoring.js';

export type EvaluateInput = {
  /** The anonymous visitor this evaluation belongs to. */
  sessionId: string;
  jobName: string;
  company: string;
  jdText: string;
  resumeText?: string;
  resumeId?: number;
};

type ResolvedResume = { id: number; content: string };

/**
 * SPEC.md section 5: `resumeText` wins, then `resumeId`, then the saved default.
 * Unsaved text is stored as a non-default row first so `jobs.resume_id` is
 * always a real reference.
 */
function resolveResume(input: EvaluateInput): ResolvedResume {
  const db = getDb();

  if (input.resumeText !== undefined) {
    const content = assertLength(input.resumeText, 'Resume text', LIMITS.resumeText);
    const saved = insertResume(db, {
      label: 'Resume used for evaluation',
      content,
      setDefault: false,
      sessionId: input.sessionId,
    });
    return { id: saved.id, content: saved.content };
  }

  if (input.resumeId !== undefined) {
    const resume = getResumeById(db, input.sessionId, input.resumeId);
    if (!resume) {
      throw new ApiError('NOT_FOUND', `No resume with id ${input.resumeId}.`);
    }
    return { id: resume.id, content: resume.content };
  }

  const fallback = getDefaultResume(db, input.sessionId);
  if (!fallback) {
    throw new ApiError('NO_DEFAULT_RESUME', 'Save a resume before evaluating a job.');
  }
  return { id: fallback.id, content: fallback.content };
}

function toItems(payload: EvaluationPayload): JobItem[] {
  return payload.requirements.map((r) => ({
    requirement: r.requirement,
    category: r.category,
    importance: r.importance,
    evidence: r.evidence,
    status: r.status,
  }));
}

export type EvaluateDeps = {
  evaluate: typeof evaluateWithGroq;
};

const defaultDeps: EvaluateDeps = { evaluate: evaluateWithGroq };

export async function runEvaluation(
  input: EvaluateInput,
  deps: EvaluateDeps = defaultDeps,
): Promise<JobDetail> {
  const jdText = assertLength(input.jdText, 'Job description', LIMITS.jdText);
  const jobName = assertLength(input.jobName, 'Job name', LIMITS.jobName);
  const company = assertLength(input.company, 'Company', LIMITS.company);

  // Checked before the resume is stored, so a capped request leaves nothing behind.
  assertDailyBudget(getDb(), input.sessionId);

  const resume = resolveResume(input);
  const { payload, model } = await deps.evaluate(resume.content, jdText);

  const items = toItems(payload);
  if (items.length === 0) {
    // Nothing worth saving, and a 0% match would be a lie.
    throw new ApiError('AI_BAD_OUTPUT', 'The model found no requirements in that job description.');
  }

  const matchScore = computeMatchScore(items);
  const db = getDb();
  const jobId = insertJob(db, {
    sessionId: input.sessionId,
    jobName,
    company,
    matchScore,
    summary: payload.summary,
    missingKeywords: payload.missing_keywords,
    jdText,
    resumeId: resume.id,
    model,
    items,
  });

  const detail = getJobDetail(db, input.sessionId, jobId);
  if (!detail) {
    throw new ApiError('INTERNAL_ERROR', 'The evaluation was lost right after saving.');
  }

  console.log(
    `[evaluate] job #${jobId} "${jobName}" @ ${company} · ${matchScore}% · ${items.length} requirements`,
  );
  return detail;
}
