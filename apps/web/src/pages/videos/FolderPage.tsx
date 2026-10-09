import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type Folder, listFolders, listItems, reorderItems, type VideoItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { EditVideoDialog } from './EditVideoDialog';
import { PlayerDialog } from './PlayerDialog';
import styles from './Videos.module.css';
import { VideosTable } from './VideosTable';

type Notice = { tone: 'error' | 'success'; text: string };

export function FolderPage() {
  const { folderId = '' } = useParams();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const [editing, setEditing] = useState<VideoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const [folders, loaded] = await Promise.all([listFolders(), listItems(folderId)]);
      const found = folders.find((candidate) => candidate.id === folderId) ?? null;
      setMissing(found === null);
      setFolder(found);
      setItems(loaded);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(item: VideoItem, delta: -1 | 1) {
    if (!items) return;
    const ids = items.filter((candidate) => candidate.status === 'ready').map((candidate) => candidate.id);
    const index = ids.indexOf(item.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setItems(await reorderItems(folderId, ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <EmptyState title="Folder not found">
        <Link to="/videos">Back to Videos</Link>
      </EmptyState>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to="/videos">Videos</Link> › {folder?.name ?? ''}
      </nav>
      <div className={styles.header}>
        <h1>{folder?.name ?? 'Folder'}</h1>
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
      ) : items === null ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState title="No videos in this folder yet">Videos you upload here will appear in this list.</EmptyState>
      ) : (
        <VideosTable items={items} busy={busy} progress={{}} onOpen={setPlaying} onEdit={setEditing} onMove={(item, delta) => void move(item, delta)} />
      )}

      <PlayerDialog item={playing} onClose={() => setPlaying(null)} />
      <EditVideoDialog
        item={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setNotice({ tone: 'success', text: 'Video saved.' });
          void load();
        }}
      />
    </>
  );
}
