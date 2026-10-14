import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseTree, type LessonNode, updateLesson, uploadLessonCover } from '../../api/courses';
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

interface EditLessonDialogProps {
  lesson: LessonNode | null;
  onClose: () => void;
  // Called with the course as it now is whenever something was saved, even if a later step failed, so the page never shows stale data.
  onSaved: (tree: CourseTree) => void;
}

export function EditLessonDialog({ lesson, onClose, onSaved }: EditLessonDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog discard="Discard your changes?" open={lesson !== null} onClose={onClose} title="Edit lesson" blocked={busy}>
      {lesson ? <EditForm lesson={lesson} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </GuardedDialog>
  );
}

type Errors = { title?: string; description?: string; cover?: string };

function EditForm({
  lesson,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<EditLessonDialogProps, 'onClose' | 'onSaved'> & { lesson: LessonNode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description ?? '');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // What the person has changed so far; Save is only possible when there is something, and shows it first.
  const review = changesOf(
    textChange('Title', lesson.title, title),
    textChange('Description', lesson.description, description),
    coverChange(Boolean(lesson.coverUrl), cover),
  );
  const dirty = review.length > 0;
  const requestClose = useDialogGuard(dirty);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const coverProblem = cover ? checkCoverFile(cover) : null;
    if (!title.trim() || coverProblem) {
      setErrors({ title: title.trim() ? undefined : 'Enter a lesson title.', cover: coverProblem ?? undefined });
      setFocusRequest({ field: title.trim() ? 'cover' : 'title' });
      return;
    }
    setErrors({});
    if (!dirty) return;
    setReviewing(true);
  }

  // Runs once the person has confirmed the list of changes.
  async function save() {
    setReviewing(false);
    setFailure(null);
    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== lesson.title) changes.title = title.trim();
    if (description.trim() !== (lesson.description ?? '')) changes.description = description.trim();
    if (Object.keys(changes).length === 0 && !cover) {
      onClose();
      return;
    }
    setBusy(true);
    let latest: CourseTree | null = null;
    try {
      if (Object.keys(changes).length > 0) latest = await updateLesson(lesson.id, changes);
      if (cover) latest = await uploadLessonCover(lesson.id, cover);
      if (latest) onSaved(latest);
      onClose();
    } catch (caught) {
      if (latest) onSaved(latest);
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({ field: 'title' });
      } else {
        const reason = describeError(caught);
        setFailure(latest ? `Your changes were saved, but the cover image could not be added: ${reason}` : reason);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={titleRef} label="Lesson title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea label="Description" maxLength={2000} hint="Optional." value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <CurrentCover url={lesson.coverUrl ?? null} />
      <CoverField
        ref={coverRef}
        hint={lesson.coverUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
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
