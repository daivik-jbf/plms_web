import { Button } from '../components/Button';
import { formatBytes } from '../lib/format';
import styles from './UploadPanel.module.css';
import { type UploadJob, useUploads } from './UploadsContext';

function Progress({ job }: { job: UploadJob }) {
  if (job.status === 'sending') {
    return (
      <>
        <progress className={styles.bar} aria-label={`Upload progress for ${job.title}`} max={job.sizeBytes} value={job.bytesSent} />
        <p className={styles.muted}>
          {formatBytes(job.bytesSent)} of {formatBytes(job.sizeBytes)}
        </p>
      </>
    );
  }
  if (job.status === 'finishing') return <p className={styles.muted}>Finishing…</p>;
  if (job.status === 'done') return <p className={styles.muted}>Finished</p>;
  return (
    <p className={styles.error} role="alert">
      {job.message}
    </p>
  );
}

export function UploadPanel() {
  const { jobs, retry, cancel, dismiss } = useUploads();
  if (jobs.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Uploads">
      <h2 className={styles.heading}>Uploads</h2>
      <ul className={styles.list}>
        {jobs.map((job) => (
          <li key={job.id} className={styles.job}>
            <p className={styles.title}>{job.title}</p>
            <p className={styles.muted}>{job.fileName}</p>
            <Progress job={job} />
            {job.coverWarning ? <p className={styles.muted}>The cover image could not be added. You can add it later with Edit.</p> : null}
            <div className={styles.actions}>
              {job.status === 'sending' ? (
                <Button variant="secondary" size="small" aria-label={`Cancel upload of ${job.title}`} onClick={() => void cancel(job.id)}>
                  Cancel
                </Button>
              ) : null}
              {job.status === 'failed' ? (
                <Button size="small" aria-label={`Try again with ${job.title}`} onClick={() => void retry(job.id)}>
                  Try again
                </Button>
              ) : null}
              {job.status === 'done' || job.status === 'failed' ? (
                <Button variant="secondary" size="small" aria-label={`Dismiss ${job.title}`} onClick={() => dismiss(job.id)}>
                  Dismiss
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
