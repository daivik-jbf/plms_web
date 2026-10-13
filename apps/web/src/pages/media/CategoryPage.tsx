import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type Folder, listFolders, reorderFolders } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { MoveButton } from '../../components/MoveButton';
import { Skeleton } from '../../components/Skeleton';
import { useMoveFocus } from '../../components/use-move-focus';
import { plural } from '../../lib/format';
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
  const moveFocus = useMoveFocus(busy);

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

  async function move(index: number, delta: -1 | 1) {
    if (!folders) return;
    const ids = folders.map((folder) => folder.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setFolders(await reorderFolders(category.slug, ids));
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
            <ul className={styles.folderGrid} aria-label={`${category.nounTitle} folders`} {...moveFocus}>
              {shown.map((folder) => {
                const index = folders.indexOf(folder);
                return (
                  <li key={folder.id} className={styles.folderCard}>
                    <Link className={styles.folderLink} to={`/${category.slug}/${folder.id}`} aria-label={`Open ${folder.name}`}>
                      <span className={styles.folderTile} aria-hidden="true">
                        <Icon name="folder" size={28} />
                      </span>
                      <span className={styles.folderText}>
                        <span className={styles.folderName}>{folder.name}</span>
                        <span className={styles.folderMeta}>{plural(folder.itemCount, category.noun)}</span>
                      </span>
                    </Link>
                    <div className={styles.folderActions}>
                      <Button variant="secondary" size="small" className={hub.square} disabled={busy} aria-label={`Rename ${folder.name}`} title="Rename" onClick={() => setDialog({ kind: 'rename', folder })}>
                        <Icon name="edit" size={16} />
                      </Button>
                      <MoveButton className={hub.square} moveKey={`${folder.id}:up`} label={`Move ${folder.name} up`} unavailable={busy || index === 0} onMove={() => void move(index, -1)}>
                        <Icon name="up" size={16} />
                      </MoveButton>
                      <MoveButton className={hub.square} moveKey={`${folder.id}:down`} label={`Move ${folder.name} down`} unavailable={busy || index === folders.length - 1} onMove={() => void move(index, 1)}>
                        <Icon name="down" size={16} />
                      </MoveButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <FolderDialog slug={category.slug} mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
