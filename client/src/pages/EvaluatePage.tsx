import { useEffect, useState } from 'react';
import { api, ApiClientError } from '../api';
import styles from '../App.module.css';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; model: string }
  | { kind: 'error'; message: string };

/**
 * Milestone 1 placeholder: proves the Vite proxy reaches the API.
 * The resume panel and job form land in milestones 2 and 4.
 */
export function EvaluatePage() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    api
      .health()
      .then((res) => {
        if (!cancelled) setHealth({ kind: 'ok', model: res.model });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiClientError ? err.message : 'Unknown error';
        setHealth({ kind: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={styles.card}>
      <h1>Evaluate</h1>
      <p className={styles.muted}>
        Skeleton is up. Resume panel, job form and results arrive in later milestones.
      </p>
      <p className={styles.status}>
        {health.kind === 'loading' && 'API: checking…'}
        {health.kind === 'ok' && `API: ok · model ${health.model} · DB migrated`}
        {health.kind === 'error' && `API: ${health.message}`}
      </p>
    </section>
  );
}
