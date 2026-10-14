import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CoverField } from '../../components/CoverField';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';

interface AddTopicDialogProps {
  open: boolean;
  onClose: () => void;
  // Sends the trimmed title and description (empty when there is none) and the cover picture, if one was chosen; the dialog closes when this resolves.
  onSubmit: (title: string, description: string, cover: File | null) => Promise<void>;
}

// A new topic: its title, and the text that goes with it.
export function AddTopicDialog(props: AddTopicDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog discard="Discard the topic you started?" open={props.open} onClose={props.onClose} title="Add topic" blocked={busy}>
      <AddForm {...props} busy={busy} setBusy={setBusy} />
    </GuardedDialog>
  );
}

function AddForm({ onClose, onSubmit, busy, setBusy }: AddTopicDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const coverRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ title?: string; description?: string; cover?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);
  // Something typed or chosen: closing the dialog asks first.
  const requestClose = useDialogGuard(title.trim() !== '' || description.trim() !== '' || cover !== null);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const coverProblem = cover ? checkCoverFile(cover) : null;
    if (!title.trim() || coverProblem) {
      setErrors({ title: title.trim() ? undefined : 'Enter a topic title.', cover: coverProblem ?? undefined });
      setFocusRequest({ field: title.trim() ? 'cover' : 'title' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(title.trim(), description.trim(), cover);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({ field: 'title' });
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
      <CoverField
        ref={coverRef}
        hint="Optional. JPEG, PNG or WebP, up to 10 MB."
        onChange={setCover}
        error={errors.cover}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Add topic
        </Button>
      </div>
    </form>
  );
}
