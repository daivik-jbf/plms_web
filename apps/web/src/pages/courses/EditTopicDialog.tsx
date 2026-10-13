import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type TopicView, updateTopic, uploadTopicCover } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';

interface EditTopicDialogProps {
  topic: TopicView | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditTopicDialog({ topic, onClose, onSaved }: EditTopicDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={topic !== null} onClose={onClose} title="Edit topic" blocked={busy}>
      {topic ? <EditForm topic={topic} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function EditForm({
  topic,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<EditTopicDialogProps, 'onClose' | 'onSaved'> & { topic: TopicView; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(topic.title);
  const [description, setDescription] = useState(topic.description ?? '');
  const coverRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ title?: string; description?: string; cover?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const coverProblem = cover ? checkCoverFile(cover) : null;
    if (!title.trim() || coverProblem) {
      setErrors({ title: title.trim() ? undefined : 'Enter a topic title.', cover: coverProblem ?? undefined });
      setFocusRequest({ field: title.trim() ? 'cover' : 'title' });
      return;
    }
    setErrors({});
    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== topic.title) changes.title = title.trim();
    if (description.trim() !== (topic.description ?? '')) changes.description = description.trim();
    if (Object.keys(changes).length === 0 && !cover) {
      onClose();
      return;
    }
    setBusy(true);
    let saved = false;
    try {
      if (Object.keys(changes).length > 0) {
        await updateTopic(topic.id, changes);
        saved = true;
      }
      if (cover) {
        await uploadTopicCover(topic.id, cover);
        saved = true;
      }
      onSaved();
      onClose();
    } catch (caught) {
      if (saved) onSaved();
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
      <TextField ref={titleRef} label="Topic title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea
        label="Description"
        rows={8}
        maxLength={10000}
        hint="Plain text. Line breaks are kept."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      <TextField
        ref={coverRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hint={topic.coverUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
        onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        error={errors.cover}
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
