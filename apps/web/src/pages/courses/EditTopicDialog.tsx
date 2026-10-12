import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type TopicView, updateTopic } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
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
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) titleRef.current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!title.trim()) {
      setErrors({ title: 'Enter a topic title.' });
      setFocusRequest({});
      return;
    }
    setErrors({});
    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== topic.title) changes.title = title.trim();
    if (description.trim() !== (topic.description ?? '')) changes.description = description.trim();
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await updateTopic(topic.id, changes);
      onSaved();
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
