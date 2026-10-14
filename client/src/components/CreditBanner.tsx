import styles from './CreditBanner.module.css';

/** Page footer. A real <footer> so it reads as a landmark, not a styled div. */
export function CreditBanner() {
  return (
    <footer className={styles.banner}>
      <p className={styles.line}>
        <span className={styles.name}>AI Job Evaluator</span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        Evaluations run on Groq
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        Built with React, TypeScript, Express and SQLite
      </p>
    </footer>
  );
}
