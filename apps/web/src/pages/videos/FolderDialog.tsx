import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { createFolder, type Folder, renameFolder } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import styles from './Videos.module.css';

export type FolderDialogMode = { kind: 'create' } | { kind: 'rename'; folder: Folder };

interface FolderDialogProps {
  mode: FolderDialogMode | null;
  onClose: () => void;
  onSaved: (folder: Folder, kind: FolderDialogMode['kind']) => void;
}

export function FolderDialog({ mode, onClose, onSaved }: FolderDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode?.kind === 'rename' ? 'Rename folder' : 'New folder'} blocked={busy}>
      {mode ? <FolderForm mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function FolderForm({
  mode,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<FolderDialogProps, 'onClose' | 'onSaved'> & { mode: FolderDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(mode.kind === 'rename' ? mode.folder.name : '');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

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
    setBusy(true);
    try {
      const saved = mode.kind === 'rename' ? await renameFolder(mode.folder.id, trimmed) : await createFolder(trimmed);
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
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {mode.kind === 'rename' ? 'Save' : 'Create folder'}
        </Button>
      </div>
    </form>
  );
}
