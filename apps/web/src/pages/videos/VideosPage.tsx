import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type Folder, listFolders, reorderFolders } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import { FolderDialog, type FolderDialogMode } from './FolderDialog';
import styles from './Videos.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

export function VideosPage() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setFolders(await listFolders());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(index: number, delta: -1 | 1) {
    if (!folders) return;
    const ids = folders.map((folder) => folder.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setFolders(await reorderFolders(ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function onSaved(folder: Folder, kind: FolderDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Folder "${folder.name}" created.` : `Folder renamed to "${folder.name}".` });
    void load();
  }

  return (
    <>
      <div className={styles.header}>
        <h1>Videos</h1>
        <Button onClick={() => setDialog({ kind: 'create' })}>New folder</Button>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loadError ? (
        <>
          <Alert tone="error">{loadError}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            Retry
          </Button>
        </>
      ) : folders === null ? (
        <Skeleton />
      ) : folders.length === 0 ? (
        <EmptyState title="No folders yet">Create a folder to start adding videos.</EmptyState>
      ) : (
        <Table caption="Video folders">
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">Videos</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((folder, index) => (
              <tr key={folder.id}>
                <td data-label="Folder">
                  <Link className={styles.name} to={`/videos/${folder.id}`}>
                    {folder.name}
                  </Link>
                </td>
                <td data-label="Videos">{folder.itemCount}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Link className={styles.link} to={`/videos/${folder.id}`} aria-label={`Open ${folder.name}`}>
                      Open
                    </Link>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${folder.name}`} onClick={() => setDialog({ kind: 'rename', folder })}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || index === 0} aria-label={`Move ${folder.name} up`} onClick={() => void move(index, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || index === folders.length - 1}
                      aria-label={`Move ${folder.name} down`}
                      onClick={() => void move(index, 1)}
                    >
                      ↓ Move down
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <FolderDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
