import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CategorySlug, createFolder, type Folder, renameFolder } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { changesOf, ChangesDialog, textChange } from '../../components/ChangesDialog';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { TextField } from '../../components/TextField';
import styles from './Media.module.css';

export type FolderDialogMode = { kind: 'create' } | { kind: 'rename'; folder: Folder };

interface FolderDialogProps {
  slug: CategorySlug;
  mode: FolderDialogMode | null;
  onClose: () => void;
  onSaved: (folder: Folder, kind: FolderDialogMode['kind']) => void;
}

export function FolderDialog({ slug, mode, onClose, onSaved }: FolderDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog
      discard={mode?.kind === 'rename' ? 'Discard your changes?' : 'Discard the new folder?'}
      open={mode !== null}
      onClose={onClose}
      title={mode?.kind === 'rename' ? 'Rename folder' : 'New folder'}
      blocked={busy}
    >
      {mode ? <FolderForm slug={slug} mode={mode} busy={busy} setBusy={setBusy} onSaved={onSaved} /> : null}
    </GuardedDialog>
  );
}

function FolderForm({
  slug,
  mode,
  busy,
  setBusy,
  onSaved,
}: Pick<FolderDialogProps, 'slug' | 'onSaved'> & { mode: FolderDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(mode.kind === 'rename' ? mode.folder.name : '');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);
  const renaming = mode.kind === 'rename';
  const [reviewing, setReviewing] = useState(false);
  // A new folder asks before it is thrown away; a rename can only be saved once the name is different, and shows the change first.
  const review = mode.kind === 'rename' ? changesOf(textChange('Folder name', mode.folder.name, name)) : [];
  const dirty = renaming ? review.length > 0 : name.trim() !== '';
  const requestClose = useDialogGuard(dirty);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a folder name.');
      setFocusRequest({});
      return;
    }
    setError(undefined);
    if (mode.kind === 'rename') {
      if (!dirty) return;
      setReviewing(true);
      return;
    }
    await save(trimmed);
  }

  // Runs at once for a new folder, and after the person has confirmed the change for a rename.
  async function save(trimmed: string) {
    setReviewing(false);
    setBusy(true);
    try {
      const saved = mode.kind === 'rename' ? await renameFolder(mode.folder.id, trimmed) : await createFolder(slug, trimmed);
      onSaved(saved, mode.kind);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors.name) {
        setError(caught.fieldErrors.name.join(' '));
        setFocusRequest({});
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField
        ref={inputRef}
        label="Folder name"
        autoComplete="off"
        maxLength={100}
        data-autofocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={error}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={renaming && !dirty}>
          {mode.kind === 'rename' ? 'Save' : 'Create folder'}
        </Button>
      </div>
      <ChangesDialog open={reviewing} changes={review} onBack={() => setReviewing(false)} onConfirm={() => void save(name.trim())} />
    </form>
  );
}
