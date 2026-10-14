import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseTree, updateCourse, uploadCourseCover } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CurrentCover } from '../../components/CurrentCover';
import { CoverField } from '../../components/CoverField';
import { changesOf, ChangesDialog, coverChange, textChange } from '../../components/ChangesDialog';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';

interface EditCourseDialogProps {
  course: CourseTree | null;
  onClose: () => void;
  // Called whenever something was saved, even if a later step failed, so the page never shows stale data.
  onChanged: () => void;
}

export function EditCourseDialog({ course, onClose, onChanged }: EditCourseDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog discard="Discard your changes?" open={course !== null} onClose={onClose} title="Edit course" blocked={busy}>
      {course ? <EditForm course={course} busy={busy} setBusy={setBusy} onClose={onClose} onChanged={onChanged} /> : null}
    </GuardedDialog>
  );
}

type Errors = { title?: string; description?: string; cover?: string };

function EditForm({
  course,
  busy,
  setBusy,
  onClose,
  onChanged,
}: Pick<EditCourseDialogProps, 'onClose' | 'onChanged'> & { course: CourseTree; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // What the person has changed so far; Save is only possible when there is something, and shows it first.
  const review = changesOf(
    textChange('Title', course.title, title),
    textChange('Description', course.description, description),
    coverChange(Boolean(course.coverUrl), cover),
  );
  const dirty = review.length > 0;
  const requestClose = useDialogGuard(dirty);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next: Errors = {
      title: title.trim() ? undefined : 'Enter a course title.',
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
    if (title.trim() !== course.title) changes.title = title.trim();
    if (description.trim() !== (course.description ?? '')) changes.description = description.trim();
    setBusy(true);
    let saved = false;
    try {
      if (Object.keys(changes).length > 0) {
        await updateCourse(course.id, changes);
        saved = true;
      }
      if (cover) {
        await uploadCourseCover(course.id, cover);
        saved = true;
      }
      if (saved) onChanged();
      onClose();
    } catch (caught) {
      if (saved) onChanged();
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
      <TextField ref={titleRef} label="Course title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <CurrentCover url={course.coverUrl ?? null} />
      <CoverField
        ref={coverRef}
        hint={course.coverUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
        onChange={setCover}
        error={errors.cover}
      />
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
