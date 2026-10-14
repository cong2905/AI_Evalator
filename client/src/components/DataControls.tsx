import { useEffect, useState } from 'react';
import { api, ApiClientError } from '../api';
import styles from './DataControls.module.css';

type Props = {
  /** True when this device already has evaluations that adopting would hide. */
  hasData: boolean;
  /** Called after a successful adopt or delete, so the page can reload its list. */
  onSessionChanged: () => void;
};

const messageOf = (err: unknown) =>
  err instanceof ApiClientError ? err.message : 'Something went wrong.';

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function DataControls({ hasData, onSessionChanged }: Props) {
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [entered, setEntered] = useState('');
  const [busy, setBusy] = useState<'none' | 'code' | 'adopt' | 'delete'>('none');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingAdopt, setConfirmingAdopt] = useState(false);

  // Tick the expiry countdown, and drop the code once it is dead.
  useEffect(() => {
    if (!code) return;

    setRemaining(secondsLeft(code.expiresAt));
    const timer = window.setInterval(() => {
      const left = secondsLeft(code.expiresAt);
      setRemaining(left);
      if (left === 0) setCode(null);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [code]);

  async function handleCreateCode() {
    setBusy('code');
    setError(null);
    setNotice(null);
    try {
      const created = await api.createTransferCode();
      setCode({ value: created.code, expiresAt: created.expiresAt });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy('none');
    }
  }

  async function handleAdopt() {
    setBusy('adopt');
    setError(null);
    setNotice(null);
    try {
      await api.adoptSession(entered);
      setEntered('');
      setConfirmingAdopt(false);
      setNotice('This device now shows the other device’s evaluations.');
      onSessionChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy('none');
    }
  }

  async function handleDelete() {
    setBusy('delete');
    setError(null);
    try {
      await api.deleteMyData();
      setConfirmingDelete(false);
      setCode(null);
      setNotice('Everything on this device has been deleted.');
      onSessionChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy('none');
    }
  }

  return (
    <section className={styles.card} aria-labelledby="data-controls-heading">
      <h2 className={styles.heading} id="data-controls-heading">
        Your data
      </h2>
      <p className={styles.retention}>
        Evaluations are stored on this device&rsquo;s session and kept as long as you keep using
        the app &mdash; they are deleted after 7 days without a visit. Resume and job text is sent
        to Groq to produce the comparison.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.columns}>
        <div className={styles.column}>
          <h3 className={styles.subheading}>Use on another device</h3>
          {code ? (
            <>
              <p className={styles.code}>{code.value}</p>
              <p className={styles.warn}>
                Anyone with this code can open your evaluations. It works once and expires in{' '}
                <span className={styles.countdown}>{remaining}s</span>.
              </p>
            </>
          ) : (
            <>
              <p className={styles.help}>
                Get a short code, then enter it on your phone or another browser.
              </p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleCreateCode()}
                disabled={busy !== 'none'}
              >
                {busy === 'code' ? 'Getting a code…' : 'Get a code'}
              </button>
            </>
          )}
        </div>

        <div className={styles.column}>
          <h3 className={styles.subheading}>Have a code?</h3>
          <div className={styles.adoptRow}>
            <label className={styles.srOnly} htmlFor="transfer-code">
              Transfer code
            </label>
            <input
              id="transfer-code"
              className={styles.input}
              placeholder="XXXX-XXXX"
              value={entered}
              maxLength={20}
              onChange={(e) => setEntered(e.target.value)}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy !== 'none' || entered.trim().length === 0}
              onClick={() => {
                // Adopting hides whatever this device already has.
                if (hasData) setConfirmingAdopt(true);
                else void handleAdopt();
              }}
            >
              {busy === 'adopt' ? 'Opening…' : 'Use code'}
            </button>
          </div>
          {confirmingAdopt && (
            <div className={styles.confirm}>
              <span>This device already has evaluations. They will no longer be reachable.</span>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleAdopt()}
              >
                Continue
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setConfirmingAdopt(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        {confirmingDelete ? (
          <div className={styles.confirm} role="group" aria-label="Confirm delete">
            <span>Delete every evaluation and resume stored for this device?</span>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => void handleDelete()}
              disabled={busy === 'delete'}
            >
              {busy === 'delete' ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setConfirmingDelete(false)}
              disabled={busy === 'delete'}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dangerOutline}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete my data
          </button>
        )}
      </div>
    </section>
  );
}
