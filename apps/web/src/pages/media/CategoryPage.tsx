import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type Folder, listFolders, reorderFolders } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import type { CategoryConfig } from '../../media/categories';
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

  return (
    <>
      <div className={styles.header}>
        <h1>{category.label}</h1>
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
        <EmptyState title="No folders yet">{`Create a folder to start adding ${category.nounPlural}.`}</EmptyState>
      ) : (
        <Table caption={`${category.nounTitle} folders`}>
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">{category.label}</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((folder, index) => (
              <tr key={folder.id}>
                <td data-label="Folder">
                  <Link className={styles.name} to={`/${category.slug}/${folder.id}`}>
                    {folder.name}
                  </Link>
                </td>
                <td data-label={category.label}>{folder.itemCount}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Link className={styles.link} to={`/${category.slug}/${folder.id}`} aria-label={`Open ${folder.name}`}>
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

      <FolderDialog slug={category.slug} mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
