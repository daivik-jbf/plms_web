import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { readDuration } from '../../uploads/duration';
import { checkCoverFile, checkMediaFile } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import styles from './Media.module.css';

interface UploadDialogProps {
  open: boolean;
  folderId: string;
  onClose: () => void;
  // Called once the server has accepted the upload (sending continues in the background).
  onStarted: () => void;
}

export function UploadDialog({ open, folderId, onClose, onStarted }: UploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Upload video" blocked={busy}>
      <UploadForm folderId={folderId} busy={busy} setBusy={setBusy} onClose={onClose} onStarted={onStarted} />
    </Dialog>
  );
}

type Field = 'file' | 'title' | 'description' | 'cover';
type Errors = Partial<Record<Field, string>>;

function UploadForm({
  folderId,
  busy,
  setBusy,
  onClose,
  onStarted,
}: Pick<UploadDialogProps, 'folderId' | 'onClose' | 'onStarted'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const uploads = useUploads();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const titleTouched = useRef(false);
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  // The length is read in the background while the person fills in the form; submitting waits for it.
  const duration = useRef<Promise<number | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!focusRequest) return;
    const targets = { file: fileRef, title: titleRef, description: descriptionRef, cover: coverRef };
    targets[focusRequest.field].current?.focus();
  }, [focusRequest]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    const check = chosen ? checkMediaFile('video', chosen) : null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: check && !check.ok ? check.problem : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    // A file that will be refused is never opened in a media element.
    duration.current = chosen && check?.ok ? readDuration(chosen, 'video') : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const check = file ? checkMediaFile('video', file) : null;
    const next: Errors = {
      file: check === null ? 'Choose a video file.' : check.ok ? undefined : check.problem,
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    const first = (['file', 'title', 'cover'] as const).find((field) => next[field]);
    if (first || !file || !check || !check.ok) {
      setFocusRequest({ field: first ?? 'file' });
      return;
    }
    setBusy(true);
    try {
      await uploads.start({ file, folderId, contentType: check.contentType, title: title.trim(), description, durationSeconds: await duration.current, cover });
      onStarted();
      onClose();
    } catch (caught) {
      const fields = caught instanceof ApiError ? caught.fieldErrors : {};
      const fromServer: Errors = {
        file: (fields.sizeBytes ?? fields.contentType ?? fields.fileName)?.join(' '),
        title: fields.title?.join(' '),
        description: fields.description?.join(' '),
      };
      if (fromServer.file || fromServer.title || fromServer.description) {
        setErrors(fromServer);
        setFocusRequest({ field: fromServer.file ? 'file' : fromServer.title ? 'title' : 'description' });
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
      <TextField
        ref={fileRef}
        label="Video file (MP4, up to 2 GB)"
        type="file"
        accept="video/mp4,.mp4"
        data-autofocus
        hint="You can keep working while it uploads; progress shows in the corner. Keep this tab open until it finishes."
        onChange={onFileChange}
        error={errors.file}
      />
      <TextField
        ref={titleRef}
        label="Title"
        autoComplete="off"
        maxLength={200}
        value={title}
        onChange={(e) => {
          titleTouched.current = true;
          setTitle(e.target.value);
        }}
        error={errors.title}
      />
      <TextArea ref={descriptionRef} label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <TextField
        ref={coverRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hint="Optional. JPEG, PNG or WebP, up to 10 MB."
        onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        error={errors.cover}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Start upload
        </Button>
      </div>
    </form>
  );
}
