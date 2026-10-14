import type { JobItem } from '@app/shared';
import { StatusPill } from './StatusPill';
import styles from './ComparisonTable.module.css';

const IMPORTANCE_LABEL = { must: 'Must', nice: 'Nice' } as const;

/** Rows arrive must-before-nice in job-description order; the server sorts them. */
export function ComparisonTable({ items }: { items: JobItem[] }) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">What they ask</th>
            <th scope="col">Importance</th>
            <th scope="col">What you have</th>
            <th scope="col" className={styles.statusCell}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={`${item.requirement}-${index}`}
              className={styles.row}
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <td className={styles.requirement}>{item.requirement}</td>
              <td className={styles.importance}>{IMPORTANCE_LABEL[item.importance]}</td>
              <td className={`${styles.evidence} ${item.evidence ? styles.hasEvidence : ''}`}>
                {item.evidence ? `“${item.evidence}”` : '—'}
              </td>
              <td className={styles.statusCell}>
                <StatusPill status={item.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
