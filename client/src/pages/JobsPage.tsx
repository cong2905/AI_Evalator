import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { JobDetail, JobSummary } from '@app/shared';
import { api, ApiClientError } from '../api';
import { JobsList } from '../components/JobsList';
import { JobDetailModal } from '../components/JobDetailModal';
import { DataControls } from '../components/DataControls';
import styles from './JobsPage.module.css';

const messageOf = (err: unknown) =>
  err instanceof ApiClientError ? err.message : 'Something went wrong.';

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /** The button that opened the dialog, so focus can go back to it on close. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** Deep link from the Evaluate page: /jobs?open=7 */
  const openParam = searchParams.get('open');

  const refreshList = useCallback(async (q: string) => {
    setListError(null);
    try {
      setJobs(await api.listJobs(q));
    } catch (err) {
      setListError(messageOf(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshList(query), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, refreshList]);

  const openDetail = useCallback(async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    try {
      setDetail(await api.getJob(id));
    } catch (err) {
      setDetailError(messageOf(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openParam) return;

    const id = Number(openParam);
    if (Number.isInteger(id) && id > 0) void openDetail(id);

    // The link has been consumed; drop it so a refresh does not reopen it.
    setSearchParams({}, { replace: true });
  }, [openParam, openDetail, setSearchParams]);

  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
    setDetailError(null);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }

  function handleDeleted(id: number) {
    setJobs((current) => current.filter((job) => job.id !== id));
    closeDetail();
  }

  const searching = query.trim().length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Jobs database</h1>
          <p className={styles.subheading}>
            {jobs.length > 0
              ? `Every evaluation is saved here · ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`
              : 'Every evaluation is saved here.'}
          </p>
        </div>
        <div className={styles.searchBox}>
          <label className={styles.searchLabel} htmlFor="jobs-search">
            Search
          </label>
          <input
            id="jobs-search"
            className={styles.searchInput}
            type="search"
            placeholder="Job or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {listError && (
        <p className={styles.error} role="alert">
          {listError}
        </p>
      )}

      {loadingList && <p className={styles.muted}>Loading saved jobs…</p>}

      {!loadingList && !listError && jobs.length === 0 && (
        <div className={styles.empty}>
          {searching ? (
            <p className={styles.emptyText}>
              No jobs match “{query.trim()}”. Try a different name or company.
            </p>
          ) : (
            <p className={styles.emptyText}>
              No evaluations yet — <Link to="/">evaluate your first job</Link>.
            </p>
          )}
        </div>
      )}

      {jobs.length > 0 && (
        <JobsList
          jobs={jobs}
          onViewDetails={(job, trigger) => {
            triggerRef.current = trigger;
            void openDetail(job.id);
          }}
        />
      )}

      <DataControls
        hasData={jobs.length > 0}
        onSessionChanged={() => {
          setQuery('');
          void refreshList('');
        }}
      />

      {detailOpen && (
        <JobDetailModal
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
          onDelete={api.deleteJob}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
