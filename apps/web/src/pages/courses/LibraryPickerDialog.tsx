import { useEffect, useState } from 'react';
import { describeError } from '../../api/client';
import { type Attachment, addLibraryAttachment } from '../../api/courses';
import { type CategorySlug, type Folder, listFolders, listItems, type MediaItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { formatDuration } from '../../lib/format';
import { CATEGORIES } from '../../media/categories';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';

interface LibraryPickerDialogProps {
  open: boolean;
  topicId: string;
  onClose: () => void;
  onAttached: (attachment: Attachment) => void;
}

export function LibraryPickerDialog({ open, topicId, onClose, onAttached }: LibraryPickerDialogProps) {
  const [attaching, setAttaching] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Add from the library" blocked={attaching}>
      <Picker topicId={topicId} attaching={attaching} setAttaching={setAttaching} onClose={onClose} onAttached={onAttached} />
    </Dialog>
  );
}

function Picker({
  topicId,
  attaching,
  setAttaching,
  onClose,
  onAttached,
}: Omit<LibraryPickerDialogProps, 'open'> & { attaching: boolean; setAttaching: (attaching: boolean) => void }) {
  const [slug, setSlug] = useState<CategorySlug>('videos');
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState('');
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Goes up when Retry is pressed, so the folders are asked for again.
  const [attempt, setAttempt] = useState(0);

  // Each answer is used only while the person is still looking at the category or folder it was asked for.
  useEffect(() => {
    let current = true;
    setFolders(null);
    setFolderId('');
    setItems(null);
    setLoadError(null);
    listFolders(slug).then(
      (list) => {
        if (!current) return;
        setFolders(list);
        setFolderId(list[0]?.id ?? '');
      },
      (error: unknown) => {
        if (current) setLoadError(describeError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [slug, attempt]);

  useEffect(() => {
    if (!folderId) return;
    let current = true;
    setItems(null);
    listItems(folderId).then(
      (list) => {
        if (current) setItems(list);
      },
      (error: unknown) => {
        if (current) setLoadError(describeError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [folderId]);

  async function attach(item: MediaItem) {
    setAttaching(true);
    setAttachError(null);
    try {
      onAttached(await addLibraryAttachment(topicId, item.id));
      onClose();
    } catch (error) {
      setAttachError(describeError(error));
    } finally {
      setAttaching(false);
    }
  }

  const category = CATEGORIES.find((candidate) => candidate.slug === slug)!;
  const wanted = search.trim().toLowerCase();
  const shown = (items ?? []).filter((item) => item.status === 'ready' && item.title.toLowerCase().includes(wanted));

  return (
    <>
      <div className={styles.pickerFilters}>
        <Select label="Category" value={slug} onChange={(event) => setSlug(event.target.value as CategorySlug)}>
          {CATEGORIES.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.label}
            </option>
          ))}
        </Select>
        <Select label="Folder" value={folderId} disabled={!folders || folders.length === 0} onChange={(event) => setFolderId(event.target.value)}>
          {(folders ?? []).map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
      </div>
      <TextField label="Search by title" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
      {attachError ? <Alert tone="error">{attachError}</Alert> : null}
      {loadError ? (
        <>
          <Alert tone="error">{loadError}</Alert>
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
            Retry
          </Button>
        </>
      ) : folders === null ? (
        <Skeleton rows={3} />
      ) : folders.length === 0 ? (
        <EmptyState title={`No folders in ${category.label} yet.`} />
      ) : items === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <EmptyState title={wanted ? 'No ready items match.' : 'Nothing ready in this folder yet.'} />
      ) : (
        <ul className={styles.pickerList}>
          {shown.map((item) => (
            <li key={item.id} className={styles.pickerItem}>
              <div>
                <span className={media.name}>{item.title}</span>
                <span className={media.muted}>{formatDuration(item.durationSeconds)}</span>
              </div>
              <Button size="small" disabled={attaching} aria-label={`Attach ${item.title}`} onClick={() => void attach(item)}>
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
