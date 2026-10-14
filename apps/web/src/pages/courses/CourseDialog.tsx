import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseSummary, createCourse, updateCourse } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { changesOf, ChangesDialog, textChange } from '../../components/ChangesDialog';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
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
    <GuardedDialog
      discard={mode?.kind === 'rename' ? 'Discard your changes?' : 'Discard the course you started?'}
      open={mode !== null}
      onClose={onClose}
      title={mode?.kind === 'rename' ? 'Rename course' : 'New course'}
      blocked={busy}
    >
      {mode ? <CourseForm mode={mode} busy={busy} setBusy={setBusy} onSaved={onSaved} /> : null}
    </GuardedDialog>
  );
}

type Field = 'title' | 'description';

function CourseForm({
  mode,
  busy,
  setBusy,
  onSaved,
}: Pick<CourseDialogProps, 'onSaved'> & { mode: CourseDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(mode.kind === 'rename' ? mode.course.title : '');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  const renaming = mode.kind === 'rename';
  const [reviewing, setReviewing] = useState(false);
  // A new course asks before it is thrown away; a rename can only be saved once the title is different, and shows the change first.
  const review = mode.kind === 'rename' ? changesOf(textChange('Title', mode.course.title, title)) : [];
  const dirty = renaming ? review.length > 0 : title.trim() !== '' || description.trim() !== '';
  const requestClose = useDialogGuard(dirty);

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
    if (mode.kind === 'rename') {
      if (!dirty) return;
      setReviewing(true);
      return;
    }
    await save(trimmed);
  }

  // Runs at once for a new course, and after the person has confirmed the change for a rename.
  async function save(trimmed: string) {
    setReviewing(false);
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
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={renaming && !dirty}>
          {mode.kind === 'rename' ? 'Save' : 'Create course'}
        </Button>
      </div>
      <ChangesDialog open={reviewing} changes={review} onBack={() => setReviewing(false)} onConfirm={() => void save(title.trim())} />
    </form>
  );
}
