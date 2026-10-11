import { useState } from 'react';
import { ResumePanel } from '../components/ResumePanel';
import styles from './EvaluatePage.module.css';

export function EvaluatePage() {
  // Lifted here because the job form (milestone 4) evaluates against this text.
  const [resumeText, setResumeText] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  return (
    <div className={styles.grid}>
      <section className={styles.card}>
        <ResumePanel
          text={resumeText}
          onTextChange={setResumeText}
          saveAsDefault={saveAsDefault}
          onSaveAsDefaultChange={setSaveAsDefault}
        />
      </section>

      <section className={`${styles.card} ${styles.placeholder}`}>
        <h2 className={styles.placeholderHeading}>2 · Job description</h2>
        <p className={styles.muted}>
          The job form and the Evaluate button arrive in milestone 4, once the Groq backend
          (milestone 3) is in place.
        </p>
      </section>
    </div>
  );
}
