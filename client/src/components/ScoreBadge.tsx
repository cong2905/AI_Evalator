import { useEffect, useState } from 'react';
import styles from './ScoreBadge.module.css';

/**
 * A headline number, not a chart: one value, read at a glance. The percentage
 * is in the text, so it never depends on colour or on reading the gauge.
 *
 * The tide gauge beside it fills to the score; it starts empty and rises once
 * mounted, which is what gives the level something to animate from.
 */
export function ScoreBadge({ score }: { score: number }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setLevel(score), 60);
    return () => window.clearTimeout(timer);
  }, [score]);

  return (
    <div className={styles.badge}>
      <span className={styles.gauge} aria-hidden="true">
        <span className={styles.water} style={{ height: `${level}%` }} />
      </span>
      <span className={styles.value}>{score}%</span>
      <span className={styles.caption}>general match</span>
    </div>
  );
}
