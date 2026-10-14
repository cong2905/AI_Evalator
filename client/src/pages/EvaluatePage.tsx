import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, type JobDetail, type Resume } from '@app/shared';
import { api, ApiClientError } from '../api';
import {
  SAMPLE_COMPANY,
  SAMPLE_JD,
  SAMPLE_JOB_NAME,
  SAMPLE_RESUME,
} from '../sampleData';
import { useCountdown } from '../hooks/useCountdown';
import { ResumePanel } from '../components/ResumePanel';
import { JobForm, type JobFormValues } from '../components/JobForm';
import { ComparisonTable } from '../components/ComparisonTable';
import { ScoreBadge } from '../components/ScoreBadge';
import styles from './EvaluatePage.module.css';

const EMPTY_FORM: JobFormValues = { jobName: '', company: '', jdText: '' };

export function EvaluatePage() {
  // Lifted out of ResumePanel because Evaluate sends this resume too.
  const [resumeText, setResumeText] = useState('');
  const [resumeLabel, setResumeLabel] = useState<string | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  /** Set once a resume row exists server-side, so we can evaluate by id. */
  const [resumeId, setResumeId] = useState<number | null>(null);

  const [form, setForm] = useState<JobFormValues>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const retry = useCountdown();

  const resumeLength = resumeText.trim().length;
  const resumeReady =
    resumeLength >= LIMITS.resumeText.min && resumeLength <= LIMITS.resumeText.max;

  /** Lets a visitor see a full evaluation without pasting anything personal. */
  function handleUseSample() {
    setResumeText(SAMPLE_RESUME);
    setResumeLabel('Sample resume');
    setSaveAsDefault(false);
    setForm({ jobName: SAMPLE_JOB_NAME, company: SAMPLE_COMPANY, jdText: SAMPLE_JD });
    setError(null);
  }

  function handleResumeSaved(resume: Resume) {
    setResumeId(resume.id);
    setResumeLabel(resume.label);
  }

  async function handleEvaluate() {
    setBusy(true);
    setError(null);

    try {
      // "Save as my default" means Evaluate saves it first, then scores against
      // that row — otherwise the text is sent inline and stored as a non-default.
      let useResumeId = resumeId;
      if (saveAsDefault) {
        const saved = await api.saveResume({
          text: resumeText,
          label: resumeLabel ?? undefined,
          setDefault: true,
        });
        handleResumeSaved(saved);
        useResumeId = saved.id;
      }

      const detail = await api.evaluate({
        jobName: form.jobName.trim(),
        company: form.company.trim(),
        jdText: form.jdText.trim(),
        ...(saveAsDefault && useResumeId !== null
          ? { resumeId: useResumeId }
          : { resumeText }),
      });

      setResult(detail);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        if (err.code === 'RATE_LIMITED' && err.retryAfter) retry.start(err.retryAfter);
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        <section className={styles.card}>
          <ResumePanel
            text={resumeText}
            onTextChange={setResumeText}
            label={resumeLabel}
            onLabelChange={setResumeLabel}
            saveAsDefault={saveAsDefault}
            onSaveAsDefaultChange={setSaveAsDefault}
            onSaved={handleResumeSaved}
            disabled={busy}
          />
        </section>

        <section className={styles.card}>
          <JobForm
            values={form}
            onChange={setForm}
            onSubmit={() => void handleEvaluate()}
            busy={busy}
            retryIn={retry.secondsLeft}
            error={error}
            resumeReady={resumeReady}
            onUseSample={handleUseSample}
          />
        </section>
      </div>

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: JobDetail }) {
  return (
    <section className={styles.card}>
      <div className={styles.resultHeader}>
        <div>
          <h2 className={styles.resultHeading}>3 · Comparison</h2>
          <p className={styles.resultMeta}>
            {result.jobName} · {result.company} — saved to Jobs database
          </p>
        </div>
        <ScoreBadge score={result.matchScore} />
      </div>

      <p className={styles.summary}>{result.summary}</p>

      <ComparisonTable items={result.items} />

      {result.missingKeywords.length > 0 && (
        <div className={styles.keywords}>
          <h3 className={styles.keywordsHeading}>Missing keywords</h3>
          <ul className={styles.chips}>
            {result.missingKeywords.map((keyword) => (
              <li key={keyword} className={styles.chip}>
                {keyword}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.resultFooter}>
        <span className={styles.resultMeta}>
          Evaluated against {result.resumeLabel} · {result.model}
        </span>
        <Link className={styles.openLink} to={`/jobs?open=${result.id}`}>
          Open in Jobs database
        </Link>
      </div>
    </section>
  );
}
