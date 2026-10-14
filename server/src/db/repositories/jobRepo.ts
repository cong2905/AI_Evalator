import type { JobDetail, JobItem, JobSummary } from '@app/shared';
import type { Db } from '../db.js';

type JobRow = {
  id: number;
  job_name: string;
  company: string;
  match_score: number;
  summary: string;
  missing_keywords: string;
  jd_text: string;
  resume_id: number;
  model: string;
  created_at: string;
  resume_label: string;
};

type SummaryRow = {
  id: number;
  job_name: string;
  company: string;
  match_score: number;
  created_at: string;
};

type ItemRow = {
  requirement: string;
  category: JobItem['category'];
  importance: JobItem['importance'];
  evidence: string;
  status: JobItem['status'];
};

export type NewJob = {
  sessionId: string;
  jobName: string;
  company: string;
  matchScore: number;
  summary: string;
  missingKeywords: string[];
  jdText: string;
  resumeId: number;
  model: string;
  /** In job-description order; the must-first sort happens on read. */
  items: JobItem[];
};

/**
 * Must-before-nice, keeping the job description's order inside each group
 * (SPEC.md section 8).
 */
const ITEMS_SQL = `
  SELECT requirement, category, importance, evidence, status
  FROM job_items
  WHERE job_id = ?
  ORDER BY CASE importance WHEN 'must' THEN 0 ELSE 1 END, sort_order
`;

const JOB_SQL = `
  SELECT jobs.*, resumes.label AS resume_label
  FROM jobs
  JOIN resumes ON resumes.id = jobs.resume_id
  WHERE jobs.id = ? AND jobs.session_id = ?
`;

/** The job row and all of its items are written in one transaction. */
export function insertJob(db: Db, input: NewJob): number {
  const createdAt = new Date().toISOString();

  const run = db.transaction((): number => {
    const info = db
      .prepare(
        `INSERT INTO jobs
           (job_name, company, match_score, summary, missing_keywords, jd_text, resume_id, model, created_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.jobName,
        input.company,
        input.matchScore,
        input.summary,
        JSON.stringify(input.missingKeywords),
        input.jdText,
        input.resumeId,
        input.model,
        createdAt,
        input.sessionId,
      );

    const jobId = Number(info.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO job_items
         (job_id, requirement, category, importance, evidence, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    input.items.forEach((item, index) => {
      insertItem.run(
        jobId,
        item.requirement,
        item.category,
        item.importance,
        item.evidence,
        item.status,
        index,
      );
    });

    return jobId;
  });

  return run();
}

function parseKeywords(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Newest first; `q` matches job name or company, case-insensitively. */
export function listJobs(db: Db, sessionId: string, q?: string): JobSummary[] {
  const term = q?.trim();

  const rows = term
    ? (db
        .prepare(
          `SELECT id, job_name, company, match_score, created_at
           FROM jobs
           WHERE session_id = ?
             AND (job_name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\')
           ORDER BY created_at DESC, id DESC`,
        )
        .all(sessionId, likeTerm(term), likeTerm(term)) as SummaryRow[])
    : (db
        .prepare(
          `SELECT id, job_name, company, match_score, created_at
           FROM jobs
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .all(sessionId) as SummaryRow[]);

  return rows.map((row) => ({
    id: row.id,
    jobName: row.job_name,
    company: row.company,
    matchScore: row.match_score,
    createdAt: row.created_at,
  }));
}

/** Escapes the LIKE wildcards so a search for "100%" is not a match-everything. */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** job_items go with it through ON DELETE CASCADE. Returns false if it was already gone. */
export function deleteJob(db: Db, sessionId: string, id: number): boolean {
  return db.prepare('DELETE FROM jobs WHERE id = ? AND session_id = ?').run(id, sessionId).changes > 0;
}

export function getJobDetail(db: Db, sessionId: string, id: number): JobDetail | undefined {
  const row = db.prepare(JOB_SQL).get(id, sessionId) as JobRow | undefined;
  if (!row) return undefined;

  const items = db.prepare(ITEMS_SQL).all(id) as ItemRow[];

  return {
    id: row.id,
    jobName: row.job_name,
    company: row.company,
    matchScore: row.match_score,
    createdAt: row.created_at,
    summary: row.summary,
    missingKeywords: parseKeywords(row.missing_keywords),
    jdText: row.jd_text,
    model: row.model,
    resumeLabel: row.resume_label,
    items,
  };
}
