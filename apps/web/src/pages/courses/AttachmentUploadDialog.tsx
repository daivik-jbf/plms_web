import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CoverField } from '../../components/CoverField';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { readDuration } from '../../uploads/duration';
import { ATTACHMENT_ACCEPT, checkAttachmentFile, checkCoverFile } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import media from '../media/Media.module.css';

interface AttachmentUploadDialogProps {
  open: boolean;
  topicId: string;
  onClose: () => void;
  // Called once the server has accepted the upload (sending continues in the background).
  onStarted: () => void;
}

export function AttachmentUploadDialog({ open, topicId, onClose, onStarted }: AttachmentUploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <GuardedDialog discard="Discard this upload? Nothing has been sent yet." open={open} onClose={onClose} title="Upload a file" blocked={busy}>
      <UploadForm topicId={topicId} busy={busy} setBusy={setBusy} onClose={onClose} onStarted={onStarted} />
    </GuardedDialog>
  );
}

type Field = 'file' | 'title' | 'description' | 'cover';
type Errors = Partial<Record<Field, string>>;

function UploadForm({
  topicId,
  busy,
  setBusy,
  onClose,
  onStarted,
}: Pick<AttachmentUploadDialogProps, 'topicId' | 'onClose' | 'onStarted'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const uploads = useUploads();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const titleTouched = useRef(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  // Something typed or chosen: closing the dialog asks first.
  const requestClose = useDialogGuard(file !== null || title.trim() !== '' || description.trim() !== '' || cover !== null);
  // The length of a video or audio file is read in the background while the person fills in the form; submitting waits for it.
  const duration = useRef<Promise<number | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.field === 'file' ? fileRef : focusRequest.field === 'cover' ? coverRef : titleRef).current?.focus();
  }, [focusRequest]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    const check = chosen ? checkAttachmentFile(chosen) : null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: check && !check.ok ? check.problem : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    // A file that will be refused is never opened in a media element, and only videos and audio have a length.
    duration.current = chosen && check?.ok && (check.kind === 'video' || check.kind === 'audio') ? readDuration(chosen, check.kind) : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const check = file ? checkAttachmentFile(file) : null;
    const next: Errors = {
      file: check === null ? 'Choose a file.' : check.ok ? undefined : check.problem,
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
      await uploads.start({ file, topicId, contentType: check.contentType, title: title.trim(), durationSeconds: await duration.current, description: description.trim(), cover });
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
        setFocusRequest({ field: fromServer.file ? 'file' : 'title' });
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
        label="File (video, audio, PDF or image)"
        type="file"
        accept={ATTACHMENT_ACCEPT}
        data-autofocus
        hint="MP4 video, MP3 or M4A audio, PDF, or JPEG, PNG or WebP image. Largest sizes: 2 GB for video, 500 MB for audio, 50 MB for a PDF and 10 MB for an image. You can keep working while it uploads; progress shows in the corner. Keep this tab open until it finishes."
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
      <TextArea
        label="Description"
        rows={4}
        maxLength={2000}
        hint="Optional. Plain text. Line breaks are kept."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      <CoverField
        ref={coverRef}
        hint="Optional. A picture shown with the file. JPEG, PNG or WebP, up to 10 MB."
        onChange={setCover}
        error={errors.cover}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Start upload
        </Button>
      </div>
    </form>
  );
}
