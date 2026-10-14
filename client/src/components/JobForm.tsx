import { useId } from 'react';
import { LIMITS } from '@app/shared';
import styles from './JobForm.module.css';

export type JobFormValues = {
  jobName: string;
  company: string;
  jdText: string;
};

type Props = {
  values: JobFormValues;
  onChange: (values: JobFormValues) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Seconds left on a rate limit; the button stays disabled until it hits 0. */
  retryIn: number;
  error: string | null;
  /** False when the resume itself is too short or too long to send. */
  resumeReady: boolean;
  /** Fills the resume and this form with a worked example. */
  onUseSample: () => void;
};

const nf = new Intl.NumberFormat('en-US');

const within = (text: string, { min, max }: { min: number; max: number }) => {
  const length = text.trim().length;
  return length >= min && length <= max;
};

export function JobForm({
  values,
  onChange,
  onSubmit,
  busy,
  retryIn,
  error,
  resumeReady,
  onUseSample,
}: Props) {
  const nameId = useId();
  const companyId = useId();
  const jdId = useId();

  const jdLength = values.jdText.trim().length;
  const jdTooLong = jdLength > LIMITS.jdText.max;
  const jdTooShort = jdLength > 0 && jdLength < LIMITS.jdText.min;

  const formValid =
    within(values.jobName, LIMITS.jobName) &&
    within(values.company, LIMITS.company) &&
    within(values.jdText, LIMITS.jdText);

  const canEvaluate = formValid && resumeReady && !busy && retryIn === 0;

  const update = (patch: Partial<JobFormValues>) => onChange({ ...values, ...patch });

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (canEvaluate) onSubmit();
      }}
    >
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>2 · Job description</h2>
        <button
          type="button"
          className={styles.sampleButton}
          onClick={onUseSample}
          disabled={busy}
        >
          Try with sample data
        </button>
      </div>

      <div className={styles.row}>
        <div>
          <label className={styles.label} htmlFor={nameId}>
            Job name
          </label>
          <input
            id={nameId}
            className={styles.input}
            placeholder="e.g. Frontend Engineer"
            value={values.jobName}
            maxLength={LIMITS.jobName.max}
            disabled={busy}
            onChange={(e) => update({ jobName: e.target.value })}
          />
        </div>
        <div>
          <label className={styles.label} htmlFor={companyId}>
            Company
          </label>
          <input
            id={companyId}
            className={styles.input}
            placeholder="Company name"
            value={values.company}
            maxLength={LIMITS.company.max}
            disabled={busy}
            onChange={(e) => update({ company: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className={styles.label} htmlFor={jdId}>
          Job description
        </label>
        <textarea
          id={jdId}
          className={styles.textarea}
          placeholder="Paste the full job description here"
          value={values.jdText}
          disabled={busy}
          onChange={(e) => update({ jdText: e.target.value })}
        />
        <div className={`${styles.counter} ${jdTooShort || jdTooLong ? styles.counterBad : ''}`}>
          {nf.format(jdLength)} / {nf.format(LIMITS.jdText.max)} characters
          {jdTooShort && ` · at least ${nf.format(LIMITS.jdText.min)} needed`}
          {jdTooLong && ` · cut ${nf.format(jdLength - LIMITS.jdText.max)}`}
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
          {retryIn > 0 && (
            <>
              {' '}
              Retrying is possible in <span className={styles.countdown}>{retryIn}s</span>.
            </>
          )}
        </p>
      )}

      {!resumeReady && !error && (
        <p className={styles.hint}>Add your resume on the left before evaluating.</p>
      )}

      <div className={styles.footer}>
        <span className={styles.hint}>
          {busy ? 'Evaluating… (usually 5–15 s)' : 'Runs on Groq · about one request per evaluation'}
        </span>
        <button
          type="submit"
          className={`${styles.evaluateButton} ${busy ? styles.shimmer : ''}`}
          disabled={!canEvaluate}
        >
          {busy ? 'Evaluating…' : retryIn > 0 ? `Wait ${retryIn}s` : 'Evaluate with AI'}
        </button>
      </div>
    </form>
  );
}
