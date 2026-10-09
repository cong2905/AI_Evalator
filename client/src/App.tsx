import { NavLink, Route, Routes } from 'react-router-dom';
import { EvaluatePage } from './pages/EvaluatePage';
import { JobsPage } from './pages/JobsPage';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <span className={styles.brand}>AI Job Evaluator</span>
        <NavLink
          to="/"
          end
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          Evaluate
        </NavLink>
        <NavLink
          to="/jobs"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          Jobs database
        </NavLink>
      </nav>

      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<EvaluatePage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
