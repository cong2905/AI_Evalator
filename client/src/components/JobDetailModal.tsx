import { useEffect, useId, useRef, useState } from 'react';
import type { JobDetail } from '@app/shared';
import { ComparisonTable } from './ComparisonTable';
import { ScoreBadge } from './ScoreBadge';
import styles from './JobDetailModal.module.css';

type Props = {
  detail: JobDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
  onDelete: (id: number) => Promise<void>;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Keeps Tab inside the dialog while it is open. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, details, [tabindex]:not([tabindex="-1"])';

export function JobDetailModal({
  detail,
  loading,
  error,
  onClose,
  onDeleted,
  onDelete,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleId = useId();

  // Focus starts on Close so the dialog is reachable by keyboard immediately.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleDelete() {
    if (!detail) return;

    setDeleting(true);
    try {
      await onDelete(detail.id);
      onDeleted(detail.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        // Only a press that starts on the backdrop closes it, so a drag that
        // ends outside a text selection does not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
        ref={dialogRef}
      >
        <div className={styles.header}>
          <div>
            <h2 className={styles.title} id={titleId}>
              {detail ? `${detail.jobName} · ${detail.company}` : 'Evaluation'}
            </h2>
            {detail && (
              <p className={styles.meta}>
                Saved {formatDate(detail.createdAt)} · {detail.resumeLabel} · {detail.model}
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.closeIcon}
            onClick={onClose}
            ref={closeButtonRef}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          {loading && <p className={styles.muted}>Loading…</p>}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {detail && (
            <>
              <div className={styles.scoreRow}>
                <ScoreBadge score={detail.matchScore} />
                <p className={styles.summary}>{detail.summary}</p>
              </div>

              <ComparisonTable items={detail.items} />

              {detail.missingKeywords.length > 0 && (
                <div className={styles.keywords}>
                  <h3 className={styles.keywordsHeading}>Missing keywords</h3>
                  <ul className={styles.chips}>
                    {detail.missingKeywords.map((keyword) => (
                      <li key={keyword} className={styles.chip}>
                        {keyword}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <details className={styles.jdBlock}>
                <summary className={styles.jdSummary}>Job description</summary>
                <pre className={styles.jdText}>{detail.jdText}</pre>
              </details>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {confirmingDelete ? (
            <div className={styles.confirm} role="group" aria-label="Confirm delete">
              <span className={styles.confirmText}>Delete this evaluation for good?</span>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.dangerOutline}
              onClick={() => setConfirmingDelete(true)}
              disabled={!detail}
            >
              Delete
            </button>
          )}

          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
