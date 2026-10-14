import type { JobSummary } from '@app/shared';
import styles from './JobsList.module.css';

type Props = {
  jobs: JobSummary[];
  onViewDetails: (job: JobSummary, trigger: HTMLButtonElement) => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The bar repeats the number next to it, so the score never depends on reading
 * a bar length — the percentage is the label, the bar is the glance.
 */
function MatchBar({ score }: { score: number }) {
  return (
    <div className={styles.matchCell}>
      <span className={styles.matchValue}>{score}%</span>
      <span
        className={styles.track}
        role="img"
        aria-label={`${score} percent general match`}
      >
        <span className={styles.fill} style={{ width: `${score}%` }} />
      </span>
    </div>
  );
}

export function JobsList({ jobs, onViewDetails }: Props) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Job name · Company</th>
            <th scope="col">General match</th>
            <th scope="col">Saved</th>
            <th scope="col">
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <div className={styles.jobName}>{job.jobName}</div>
                <div className={styles.company}>{job.company}</div>
              </td>
              <td>
                <MatchBar score={job.matchScore} />
              </td>
              <td className={styles.date}>{formatDate(job.createdAt)}</td>
              <td className={styles.actions}>
                <button
                  type="button"
                  className={styles.viewButton}
                  onClick={(e) => onViewDetails(job, e.currentTarget)}
                >
                  View details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
