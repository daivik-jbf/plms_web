import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

interface TitleDialogProps {
  open: boolean;
  // The dialog's name ("Add lesson"), the field's label ("Lesson title"), the button ("Add lesson" or "Save") and what to
  // say when the field is empty ("Enter a lesson title.").
  heading: string;
  label: string;
  initial: string;
  submitLabel: string;
  emptyMessage: string;
  // Sends the trimmed title; the dialog closes when this resolves.
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}

// One text field in a dialog: adding a lesson or a topic, renaming either, renaming an attachment.
export function TitleDialog(props: TitleDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.heading} blocked={busy}>
      <TitleForm {...props} busy={busy} setBusy={setBusy} />
    </Dialog>
  );
}

function TitleForm({
  label,
  initial,
  submitLabel,
  emptyMessage,
  onSubmit,
  onClose,
  busy,
  setBusy,
}: TitleDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError(emptyMessage);
      setFocusRequest({});
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors.title) {
        setError(caught.fieldErrors.title.join(' '));
        setFocusRequest({});
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={inputRef} label={label} autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} error={error} />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
