import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type Folder, listFolders, listItems, type MediaItem, playItem, reorderItems } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { plural } from '../../lib/format';
import hub from '../courses/CoursesHub.module.css';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import type { CategoryConfig } from '../../media/categories';
import { usePlayer } from '../../player/PlayerContext';
import { MEDIA_KINDS } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import { EditItemDialog } from './EditItemDialog';
import { ItemsList } from './ItemsList';
import styles from './Media.module.css';
import { PendingUploads } from './PendingUploads';
import { PlayerDialog, type VideoTarget } from './PlayerDialog';
import { UploadDialog } from './UploadDialog';

type Notice = { tone: 'error' | 'success'; text: string };

export function FolderPage({ category }: { category: CategoryConfig }) {
  const { folderId = '' } = useParams();
  const uploads = useUploads();
  const player = usePlayer();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoTarget | null>(null);
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

  // Videos and movies open the pop-up player. Podcasts and songs play in the docked player, which keeps playing while
  // the person browses; it asks for the playback link itself.
  function onPlay(item: MediaItem) {
    const link = () => playItem(item.id);
    if (category.kind === 'video') {
      setPlaying({ id: item.id, title: item.title, description: item.description, addedBy: item.createdBy.name, addedAt: item.createdAt, link });
      return;
    }
    player.play({ link, title: item.title, place: `${category.label} › ${folder?.name ?? ''}`, coverUrl: item.coverUrl });
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
      <div className={hub.banner}>
        <span className={hub.bannerTile} aria-hidden="true">
          <Icon name="folder" size={44} />
        </span>
        <div className={hub.bannerText}>
          <h1 className={hub.bannerTitle}>{folder?.name ?? 'Folder'}</h1>
          <p className={hub.bannerCounts}>
            <span>
              <Icon name={category.icon} size={18} /> {items ? plural(items.length, category.nounTitle) : ''}
            </span>
          </p>
        </div>
        <div className={hub.bannerActions}>
          <Link className={hub.bannerBack} to={`/${category.slug}`}>
            <Icon name="back" size={18} />
            {`Back to ${category.label}`}
          </Link>
          <button type="button" className={hub.bannerButton} onClick={() => setUploading(true)}>
            <Icon name="plus" size={18} />
            {`Upload ${category.noun}`}
          </button>
        </div>
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
        <EmptyState title={`No ${category.nounPlural} in this folder yet`}>{`${category.label} you upload here will appear in this list.`}</EmptyState>
      ) : (
        <ItemsList
          category={category}
          items={items}
          busy={busy}
          progress={progress}
          onPlay={onPlay}
          onEdit={setEditing}
          onMove={(item, delta) => void move(item, delta)}
        />
      )}

      <PendingUploads
        belongs={(entry) => entry.folderId === folderId}
        accept={MEDIA_KINDS[category.kind].accept}
        noun={category.noun}
        nounTitle={category.nounTitle}
        reloadKey={uploads.finishedCount}
        onChanged={() => void load()}
      />

      <PlayerDialog video={playing} onClose={() => setPlaying(null)} />
      <UploadDialog open={uploading} category={category} folderId={folderId} onClose={() => setUploading(false)} onStarted={() => void load()} />
      <EditItemDialog
        noun={category.noun}
        item={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setNotice({ tone: 'success', text: `${category.nounTitle} saved.` });
          void load();
        }}
      />
    </>
  );
}
