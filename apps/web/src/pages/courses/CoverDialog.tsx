import { type FormEvent, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';

interface CoverDialogProps {
  open: boolean;
  title: string;
  // What the cover is for, by name: shown under the heading.
  subject: string;
  currentUrl: string | null;
  onClose: () => void;
  // Sends the picture; the dialog closes when this resolves.
  onSave: (file: File) => Promise<void>;
}

// One picture field in a dialog: changing the cover of a lesson.
export function CoverDialog(props: CoverDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.title} blocked={busy}>
      <CoverForm {...props} busy={busy} setBusy={setBusy} />
    </Dialog>
  );
}

function CoverForm({ subject, currentUrl, onClose, onSave, busy, setBusy }: CoverDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) fileRef.current?.focus();
  }, [focusRequest]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const problem = file ? checkCoverFile(file) : 'Choose an image.';
    if (problem || !file) {
      setError(problem ?? 'Choose an image.');
      setFocusRequest({});
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await onSave(file);
      onClose();
    } catch (caught) {
      setFailure(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <p className={styles.coverSubject}>{subject}</p>
      {currentUrl ? <img className={styles.coverPreview} src={currentUrl} alt="The current cover" /> : null}
      <TextField
        ref={fileRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        data-autofocus
        hint={currentUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'JPEG, PNG or WebP, up to 10 MB.'}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        error={error}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
