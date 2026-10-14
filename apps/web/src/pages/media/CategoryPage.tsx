import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { deleteFolder, type Folder, listFolders } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Skeleton } from '../../components/Skeleton';
import { formatBytes, formatDateTime, plural } from '../../lib/format';
import type { CategoryConfig } from '../../media/categories';
import hub from '../courses/CoursesHub.module.css';
import { FolderDialog, type FolderDialogMode } from './FolderDialog';
import styles from './Media.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

// The folders of one category (Videos, Movies, Podcasts or Songs).
export function CategoryPage({ category }: { category: CategoryConfig }) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<Folder | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFolders(await listFolders(category.slug));
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, [category.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await deleteFolder(removing.id);
      setNotice({ tone: 'success', text: `Folder "${removing.name}" deleted.` });
      setRemoving(null);
      await load();
    } catch (error) {
      setRemoveError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function onSaved(folder: Folder, kind: FolderDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Folder "${folder.name}" created.` : `Folder renamed to "${folder.name}".` });
    void load();
  }

  const needle = query.trim().toLowerCase();
  const shown = folders?.filter((folder) => folder.name.toLowerCase().includes(needle)) ?? [];

  return (
    <>
      <div className={hub.header}>
        <span className={hub.headerTile} aria-hidden="true">
          <Icon name={category.icon} size={40} />
        </span>
        <div className={hub.headerText}>
          <h1>{category.label}</h1>
          <p>{`Organize your ${category.nounPlural} in folders`}</p>
        </div>
        <Button className={hub.newButton} onClick={() => setDialog({ kind: 'create' })}>
          <Icon name="plus" size={20} />
          New folder
        </Button>
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
        <EmptyState title="No folders yet">{`Create a folder to start adding ${category.nounPlural}.`}</EmptyState>
      ) : (
        <>
          <div className={styles.search}>
            <span className={styles.searchIcon}>
              <Icon name="search" size={18} />
            </span>
            <input type="search" aria-label="Search folders" placeholder="Search folders..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {shown.length === 0 ? (
            <p>{`No folder matches "${query.trim()}".`}</p>
          ) : (
            <ul className={styles.folderGrid} aria-label={`${category.nounTitle} folders`}>
              {shown.map((folder) => (
                <li key={folder.id} className={styles.folderCard}>
                  <Link className={styles.folderLink} to={`/${category.slug}/${folder.id}`} aria-label={`Open ${folder.name}`}>
                    <span className={styles.folderTile} aria-hidden="true">
                      <Icon name="folder" size={28} />
                    </span>
                    <span className={styles.folderText}>
                      <span className={styles.folderName}>{folder.name}</span>
                      <span className={styles.folderMeta}>
                        <span>{plural(folder.itemCount, category.noun)}</span>
                        <span>{formatBytes(folder.sizeBytes)}</span>
                      </span>
                    </span>
                  </Link>
                  <dl className={styles.folderDetails}>
                    <div>
                      <dt>Created</dt>
                      <dd>{`${formatDateTime(folder.createdAt)} by ${folder.createdBy.name}`}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{`${formatDateTime(folder.updatedAt)} by ${folder.updatedBy.name}`}</dd>
                    </div>
                  </dl>
                  <div className={styles.folderActions}>
                    <Button variant="secondary" size="small" className={hub.square} disabled={busy} aria-label={`Rename ${folder.name}`} title="Rename" onClick={() => setDialog({ kind: 'rename', folder })}>
                      <Icon name="edit" size={16} />
                    </Button>
                    <Button variant="secondary" size="small" className={hub.square} disabled={busy} aria-label={`Delete ${folder.name}`} title="Delete" onClick={() => setRemoving(folder)}>
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Delete folder"
        confirmLabel="Delete for good"
        tone="danger"
        busy={busy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
      >
        {removing
          ? removing.itemCount > 0
            ? `Delete the folder "${removing.name}" for good? Its ${plural(removing.itemCount, category.noun)}, with ${removing.itemCount === 1 ? 'its file and cover' : 'their files and covers'}, ${removing.itemCount === 1 ? 'is' : 'are'} removed too, and this cannot be undone.`
            : `Delete the folder "${removing.name}" for good? This cannot be undone.`
          : ''}
      </ConfirmDialog>
      <FolderDialog slug={category.slug} mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
