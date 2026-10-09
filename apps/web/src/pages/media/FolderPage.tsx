import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type Folder, listFolders, listItems, reorderItems, type MediaItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import type { CategoryConfig } from '../../media/categories';
import { useUploads } from '../../uploads/UploadsContext';
import { EditItemDialog } from './EditItemDialog';
import { PendingUploads } from './PendingUploads';
import { PlayerDialog } from './PlayerDialog';
import { UploadDialog } from './UploadDialog';
import styles from './Media.module.css';
import { ItemsTable } from './ItemsTable';

type Notice = { tone: 'error' | 'success'; text: string };

export function FolderPage({ category }: { category: CategoryConfig }) {
  const { folderId = '' } = useParams();
  const uploads = useUploads();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<MediaItem | null>(null);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [folders, loaded] = await Promise.all([listFolders(category.slug), listItems(folderId)]);
      const found = folders.find((candidate) => candidate.id === folderId) ?? null;
      setMissing(found === null);
      setFolder(found);
      setItems(loaded);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [category.slug, folderId]);

  useEffect(() => {
    void load();
  }, [load, uploads.finishedCount]);

  const progress = Object.fromEntries(
    uploads.jobs
      .filter((job) => job.folderId === folderId && job.status === 'sending' && job.sizeBytes > 0)
      .map((job) => [job.itemId, Math.floor((100 * job.bytesSent) / job.sizeBytes)]),
  );

  async function move(item: MediaItem, delta: -1 | 1) {
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
        <Link to={`/${category.slug}`}>{`Back to ${category.label}`}</Link>
      </EmptyState>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to={`/${category.slug}`}>{category.label}</Link> › {folder?.name ?? ''}
      </nav>
      <div className={styles.header}>
        <h1>{folder?.name ?? 'Folder'}</h1>
        <Button onClick={() => setUploading(true)}>Upload video</Button>
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
        <ItemsTable items={items} busy={busy} progress={progress} onOpen={setPlaying} onEdit={setEditing} onMove={(item, delta) => void move(item, delta)} />
      )}

      <PendingUploads folderId={folderId} reloadKey={uploads.finishedCount} onChanged={() => void load()} />

      <PlayerDialog item={playing} onClose={() => setPlaying(null)} />
      <UploadDialog open={uploading} folderId={folderId} onClose={() => setUploading(false)} onStarted={() => void load()} />
      <EditItemDialog
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
