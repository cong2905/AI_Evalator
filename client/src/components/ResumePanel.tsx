import { useEffect, useId, useRef, useState } from 'react';
import { LIMITS, type DefaultResume, type Resume } from '@app/shared';
import { api, ApiClientError } from '../api';
import styles from './ResumePanel.module.css';

type Props = {
  text: string;
  onTextChange: (text: string) => void;
  saveAsDefault: boolean;
  onSaveAsDefaultChange: (value: boolean) => void;
  /** Fires after a successful save so the evaluate step can reuse the saved row. */
  onSaved?: (resume: Resume) => void;
};

type Busy = 'idle' | 'loading' | 'parsing' | 'saving';

const nf = new Intl.NumberFormat('en-US');

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ResumePanel({
  text,
  onTextChange,
  saveAsDefault,
  onSaveAsDefaultChange,
  onSaved,
}: Props) {
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Label for the next save: the uploaded file name, or 'Pasted resume'. */
  const [label, setLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadId = useId();
  const textId = useId();

  useEffect(() => {
    let cancelled = false;

    api
      .getDefaultResume()
      .then((resume: DefaultResume | null) => {
        if (cancelled) return;
        if (resume) {
          onTextChange(resume.content);
          setLabel(resume.label);
          setStatus(`Default loaded: ${resume.label} · saved ${formatSavedAt(resume.updatedAt)}`);
        } else {
          setStatus('No default resume saved yet — upload or paste one below.');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setBusy('idle');
      });

    return () => {
      cancelled = true;
    };
    // Runs once on mount; onTextChange is stable enough for this one-shot load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File) {
    setBusy('parsing');
    setError(null);
    setStatus(`Reading ${file.name}…`);

    try {
      const parsed = await api.parseResumeFile(file);
      onTextChange(parsed);
      setLabel(file.name);
      setStatus(`Read ${file.name} — check the text below, then save.`);
    } catch (err) {
      setStatus(null);
      setError(messageOf(err));
      // Let the same file be picked again after a failure.
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setBusy('idle');
    }
  }

  async function handleSave() {
    setBusy('saving');
    setError(null);

    try {
      const saved = await api.saveResume({
        text,
        label: label ?? undefined,
        setDefault: saveAsDefault,
      });
      setLabel(saved.label);
      setStatus(
        saved.isDefault
          ? `Saved as your default resume: ${saved.label} · ${formatSavedAt(saved.updatedAt)}`
          : `Saved ${saved.label} (not set as default)`,
      );
      onSaved?.(saved);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy('idle');
    }
  }

  const trimmed = text.trim().length;
  const tooShort = trimmed > 0 && trimmed < LIMITS.resumeText.min;
  const tooLong = trimmed > LIMITS.resumeText.max;
  const canSave = busy === 'idle' && trimmed >= LIMITS.resumeText.min && !tooLong;

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>1 · Your resume</h2>
      <p className={`${styles.statusLine} ${error ? styles.error : ''}`} role="status">
        {error ?? status ?? ''}
      </p>

      <div>
        <label className={styles.label} htmlFor={uploadId}>
          Upload PDF or DOCX
        </label>
        <div className={styles.dropzone}>
          <input
            id={uploadId}
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy !== 'idle'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      <div>
        <label className={styles.label} htmlFor={textId}>
          …or paste resume text
        </label>
        <textarea
          id={textId}
          className={styles.textarea}
          placeholder="Paste your resume here"
          value={text}
          disabled={busy === 'loading' || busy === 'parsing'}
          onChange={(e) => {
            onTextChange(e.target.value);
            // Typed-over text is no longer the uploaded file.
            if (label && label !== 'Pasted resume') setLabel('Pasted resume');
          }}
        />
        <div className={`${styles.counter} ${tooShort || tooLong ? styles.counterBad : ''}`}>
          {nf.format(trimmed)} / {nf.format(LIMITS.resumeText.max)} characters
          {tooShort && ` · at least ${nf.format(LIMITS.resumeText.min)} needed`}
          {tooLong && ` · cut ${nf.format(trimmed - LIMITS.resumeText.max)}`}
        </div>
      </div>

      <div className={styles.footer}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
          />
          Save as my default resume
        </label>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => void handleSave()}
          disabled={!canSave}
        >
          {busy === 'saving' ? 'Saving…' : 'Save resume'}
        </button>
      </div>
    </div>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong.';
}
