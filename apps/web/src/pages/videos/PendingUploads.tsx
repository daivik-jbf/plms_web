import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { listMyUploads, type PendingUpload } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Table } from '../../components/Table';
import { formatBytes, formatDateTime } from '../../lib/format';
import { FileMismatchError, useUploads } from '../../uploads/UploadsContext';
import styles from './Videos.module.css';

interface PendingUploadsProps {
  folderId: string;
  // Changes whenever the list may be out of date (an upload started or finished).
  reloadKey: number;
  onChanged: () => void;
}

// Uploads that were interrupted (for example by closing the tab): the person can continue with the same file,
// from the pieces the server already holds, or abandon them.
export function PendingUploads({ folderId, reloadKey, onChanged }: PendingUploadsProps) {
  const uploads = useUploads();
  const [list, setList] = useState<PendingUpload[]>([]);
  const [target, setTarget] = useState<PendingUpload | null>(null);
  const [cancelling, setCancelling] = useState<PendingUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setList(await listMyUploads());
    } catch {
      // The rest of the page still works; this list simply stays as it was.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey, uploads.jobs.length]);

  const running = new Set(uploads.jobs.map((job) => job.id));
  const shown = list.filter((entry) => entry.folderId === folderId && !running.has(entry.fileId));

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !target) return;
    setError(null);
    try {
      await uploads.resume(target, file);
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof FileMismatchError ? caught.message : describeError(caught));
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    setError(null);
    try {
      await uploads.cancel(cancelling.fileId);
      setCancelling(null);
      await load();
      onChanged();
    } catch (caught) {
      setError(describeError(caught));
      setCancelling(null);
    } finally {
      setBusy(false);
    }
  }

  if (shown.length === 0 && !error) return null;

  return (
    <section aria-label="Unfinished uploads">
      <h2>Unfinished uploads</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <input ref={inputRef} type="file" accept="video/mp4,.mp4" hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} />
      {shown.length > 0 ? (
        <Table caption="Unfinished uploads">
          <thead>
            <tr>
              <th scope="col">Video</th>
              <th scope="col">Size</th>
              <th scope="col">Started</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.fileId}>
                <td data-label="Video">
                  <span className={styles.name}>{entry.title}</span>
                  <span className={styles.muted}>{entry.fileName}</span>
                </td>
                <td data-label="Size">{formatBytes(entry.sizeBytes)}</td>
                <td data-label="Started">{formatDateTime(entry.createdAt)}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Button
                      size="small"
                      aria-label={`Resume ${entry.title}`}
                      onClick={() => {
                        setTarget(entry);
                        inputRef.current?.click();
                      }}
                    >
                      Resume
                    </Button>
                    <Button variant="secondary" size="small" aria-label={`Cancel upload of ${entry.title}`} onClick={() => setCancelling(entry)}>
                      Cancel
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this upload?"
        confirmLabel="Cancel upload"
        cancelLabel="Keep it"
        tone="danger"
        busy={busy}
        onCancel={() => setCancelling(null)}
        onConfirm={() => void confirmCancel()}
      >
        {cancelling ? `What was already sent of "${cancelling.title}" will be discarded. You can upload the video again later.` : ''}
      </ConfirmDialog>
    </section>
  );
}
