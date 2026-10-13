import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

interface AddTopicDialogProps {
  open: boolean;
  onClose: () => void;
  // Sends the trimmed title and description (empty when there is none); the dialog closes when this resolves.
  onSubmit: (title: string, description: string) => Promise<void>;
}

// A new topic: its title, and the text that goes with it.
export function AddTopicDialog(props: AddTopicDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Add topic" blocked={busy}>
      <AddForm {...props} busy={busy} setBusy={setBusy} />
    </Dialog>
  );
}

function AddForm({ onClose, onSubmit, busy, setBusy }: AddTopicDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) titleRef.current?.focus();
  }, [focusRequest]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!title.trim()) {
      setErrors({ title: 'Enter a topic title.' });
      setFocusRequest({});
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(title.trim(), description.trim());
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({});
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
      <TextField ref={titleRef} label="Topic title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea
        label="Description"
        rows={6}
        maxLength={10000}
        hint="Optional. Plain text. Line breaks are kept."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Add topic
        </Button>
      </div>
    </form>
  );
}
