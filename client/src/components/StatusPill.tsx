import type { Status } from '@app/shared';
import styles from './StatusPill.module.css';

const LABELS: Record<Status, string> = {
  met: 'Met',
  partial: 'Partial',
  missing: 'Missing',
};

/** Colour never carries the meaning on its own — the word is always there. */
export function StatusPill({ status }: { status: Status }) {
  return <span className={`${styles.pill} ${styles[status]}`}>{LABELS[status]}</span>;
}
