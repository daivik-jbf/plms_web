import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type Attachment, updateAttachment, uploadAttachmentCover } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CoverField } from '../../components/CoverField';
import { CurrentCover } from '../../components/CurrentCover';
import { changesOf, ChangesDialog, coverChange, textChange } from '../../components/ChangesDialog';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';

interface EditAttachmentDialogProps {
  attachment: Attachment | null;
  onClose: () => void;
  // Called when something was saved, even if a later step failed, so the page never shows stale data.
  onSaved: (title: string) => void;
}

export function EditAttachmentDialog({ attachment, onClose, onSaved }: EditAttachmentDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog discard="Discard your changes?" open={attachment !== null} onClose={onClose} title="Edit attachment" blocked={busy}>
      {attachment ? <EditForm attachment={attachment} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </GuardedDialog>
  );
}

type Errors = { title?: string; description?: string; cover?: string };

function EditForm({
  attachment,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<EditAttachmentDialogProps, 'onClose' | 'onSaved'> & { attachment: Attachment; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(attachment.title);
  const [description, setDescription] = useState(attachment.description ?? '');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // What the person has changed so far; Save is only possible when there is something, and shows it first.
  const review = changesOf(
    textChange('Title', attachment.title, title),
    textChange('Description', attachment.description, description),
    coverChange(Boolean(attachment.thumbnailUrl), cover),
  );
  const dirty = review.length > 0;
  const requestClose = useDialogGuard(dirty);
  // A file from the library shows the cover of its library item, which is changed in the library.
  const ownsFile = attachment.source === 'upload';

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next: Errors = {
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    if (next.title || next.cover) {
      setFocusRequest({ field: next.title ? 'title' : 'cover' });
      return;
    }
    if (!dirty) return;
    setReviewing(true);
  }

  // Runs once the person has confirmed the list of changes.
  async function save() {
    setReviewing(false);
    setFailure(null);
    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== attachment.title) changes.title = title.trim();
    if (description.trim() !== (attachment.description ?? '')) changes.description = description.trim();
    if (Object.keys(changes).length === 0 && !cover) {
      onClose();
      return;
    }
    setBusy(true);
    let saved = false;
    try {
      if (Object.keys(changes).length > 0) {
        await updateAttachment(attachment.id, changes);
        saved = true;
      }
      if (cover) {
        await uploadAttachmentCover(attachment.id, cover);
        saved = true;
      }
      onSaved(title.trim());
      onClose();
    } catch (caught) {
      if (saved) onSaved(title.trim());
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({ field: 'title' });
      } else {
        const reason = describeError(caught);
        setFailure(saved ? `Your changes were saved, but the cover image could not be added: ${reason}` : reason);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={titleRef} label="Attachment title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea
        label="Description"
        rows={5}
        maxLength={2000}
        hint="Optional. Plain text. Line breaks are kept."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      {ownsFile ? (
        <>
          <CurrentCover url={attachment.thumbnailUrl} />
          <CoverField
            ref={coverRef}
            hint={attachment.thumbnailUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
            onChange={setCover}
            error={errors.cover}
          />
        </>
      ) : null}
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={!dirty}>
          Save
        </Button>
      </div>
      <ChangesDialog open={reviewing} changes={review} onBack={() => setReviewing(false)} onConfirm={() => void save()} />
    </form>
  );
}
