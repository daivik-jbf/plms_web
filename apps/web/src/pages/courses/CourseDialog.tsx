import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseSummary, createCourse, updateCourse } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

export type CourseDialogMode = { kind: 'create' } | { kind: 'rename'; course: CourseSummary };

interface CourseDialogProps {
  mode: CourseDialogMode | null;
  onClose: () => void;
  onSaved: (title: string, kind: CourseDialogMode['kind']) => void;
}

export function CourseDialog({ mode, onClose, onSaved }: CourseDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode?.kind === 'rename' ? 'Rename course' : 'New course'} blocked={busy}>
      {mode ? <CourseForm mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

type Field = 'title' | 'description';

function CourseForm({
  mode,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<CourseDialogProps, 'onClose' | 'onSaved'> & { mode: CourseDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(mode.kind === 'rename' ? mode.course.title : '');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : descriptionRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setErrors({ title: 'Enter a course title.' });
      setFocusRequest({ field: 'title' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (mode.kind === 'rename') await updateCourse(mode.course.id, { title: trimmed });
      else await createCourse({ title: trimmed, description: description.trim() });
      onSaved(trimmed, mode.kind);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        setFocusRequest({ field: caught.fieldErrors.title ? 'title' : 'description' });
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
      <TextField ref={titleRef} label="Course title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      {mode.kind === 'create' ? (
        <TextArea ref={descriptionRef} label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      ) : null}
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {mode.kind === 'rename' ? 'Save' : 'Create course'}
        </Button>
      </div>
    </form>
  );
}
