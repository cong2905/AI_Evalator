import styles from './SeaBackground.module.css';

/**
 * Purely decorative sky, sun and drifting clouds behind the whole app.
 * aria-hidden and pointer-events: none, so it never reaches the a11y tree
 * or swallows a click.
 */
export function SeaBackground() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.sky} />
      <div className={styles.sun} />
      <div className={`${styles.cloud} ${styles.cloudOne}`} />
      <div className={`${styles.cloud} ${styles.cloudTwo}`} />
      <div className={`${styles.cloud} ${styles.cloudThree}`} />
      <div className={styles.horizon} />
      <div className={styles.sea} />
    </div>
  );
}
