import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type Attachment, deleteAttachment, getTopic, openAttachment, reorderAttachments, type TopicDetail } from '../../api/courses';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { CATEGORIES } from '../../media/categories';
import { usePlayer } from '../../player/PlayerContext';
import { ATTACHMENT_ACCEPT } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import { PendingUploads } from '../media/PendingUploads';
import { PlayerDialog, type VideoTarget } from '../media/PlayerDialog';
import { AddAttachmentDialog } from './AddAttachmentDialog';
import { AttachmentList } from './AttachmentList';
import { AttachmentUploadDialog } from './AttachmentUploadDialog';
import hub from './CoursesHub.module.css';
import styles from './Courses.module.css';
import { EditAttachmentDialog } from './EditAttachmentDialog';
import { EditTopicDialog } from './EditTopicDialog';
import { ImageDialog } from './ImageDialog';
import { LibraryPickerDialog } from './LibraryPickerDialog';

type Notice = { tone: 'error' | 'success'; text: string };

interface TopicPanelProps {
  topicId: string;
  // For the line under a track in the docked player: "Course › Lesson › Topic".
  courseTitle: string;
  lessonTitle: string;
  // Goes up whenever the page changed something that may be in this topic (for example its title), so it reloads.
  reloadKey: number;
  // Something in the topic changed that the tree shows (its title, how many files it has): the page reloads the tree.
  onChanged: () => void;
}

// The chosen topic: its title, text and attachments. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId, courseTitle, lessonTitle, reloadKey, onChanged }: TopicPanelProps) {
  const player = usePlayer();
  const uploads = useUploads();
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const { state: auth } = useAuth();
  const isAdmin = auth.status === 'authenticated' && auth.user.role === 'admin';
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoTarget | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);

  const load = useCallback(async () => {
    try {
      setTopic(await getTopic(topicId));
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [topicId]);

  // An upload that finished (or was cancelled) changes what the topic holds.
  useEffect(() => {
    void load();
  }, [load, reloadKey, uploads.finishedCount]);

  if (missing) return <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>;
  if (loadError) {
    return (
      <>
        <Alert tone="error">{loadError}</Alert>
        <Button
          variant="secondary"
          onClick={() => {
            setLoadError(null);
            void load();
          }}
        >
          Retry
        </Button>
      </>
    );
  }
  if (!topic) return <Skeleton rows={3} />;

  // Percent sent of the uploads of this topic that are running in this browser.
  const progress = Object.fromEntries(
    uploads.jobs
      .filter((job) => job.topicId === topicId && job.status === 'sending' && job.sizeBytes > 0)
      .map((job) => [job.itemId, Math.floor((100 * job.bytesSent) / job.sizeBytes)]),
  );

  // The line under a track in the docked player.
  function placeOf(attachment: Attachment): string {
    if (attachment.source === 'library') {
      const category = CATEGORIES.find((candidate) => candidate.noun === attachment.category);
      return `${category?.label ?? 'Library'} › ${attachment.libraryFolderName ?? ''}`;
    }
    return `${courseTitle} › ${lessonTitle} › ${topic?.title ?? ''}`;
  }

  // The tab is opened straight from the click, while the browser still allows it, and sent to the link when it arrives.
  async function openPdf(attachment: Attachment) {
    const tab = window.open('', '_blank');
    if (!tab) {
      setNotice({ tone: 'error', text: 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.' });
      return;
    }
    // The page that opens is on another site: it must not be able to reach this one.
    tab.opener = null;
    try {
      tab.location.href = (await openAttachment(attachment.id)).url;
    } catch (error) {
      tab.close();
      setNotice({ tone: 'error', text: describeError(error) });
    }
  }

  function open(attachment: Attachment) {
    setNotice(null);
    const link = () => openAttachment(attachment.id);
    switch (attachment.kind) {
      case 'video':
        setVideo({ id: attachment.id, title: attachment.title, description: null, addedBy: attachment.createdBy.name, addedAt: attachment.createdAt, link });
        break;
      case 'audio':
        player.play({ link, title: attachment.title, place: placeOf(attachment), coverUrl: attachment.thumbnailUrl });
        break;
      case 'pdf':
        void openPdf(attachment);
        break;
      case 'image':
        setImage(attachment);
        break;
    }
  }

  async function move(attachment: Attachment, delta: -1 | 1) {
    if (!topic) return;
    const ids = topic.attachments.filter((candidate) => candidate.status === 'ready').map((candidate) => candidate.id);
    const index = ids.indexOf(attachment.id);
    [ids[index], ids[index + delta]] = [ids[index + delta] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setTopic({ ...topic, attachments: await reorderAttachments(topic.id, ids) });
      setNotice({ tone: 'success', text: `Moved "${attachment.title}" ${delta === -1 ? 'up' : 'down'}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await deleteAttachment(removing.id);
      setNotice({ tone: 'success', text: `Attachment "${removing.title}" moved to the Trash.` });
      setRemoving(null);
      await load();
      onChanged();
    } catch (error) {
      setRemoveError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.topicHeader}>
        <div className={styles.topicHeading}>
          {topic.coverUrl ? <img className={styles.topicCover} src={topic.coverUrl} alt="" /> : null}
          <h2 className={styles.topicTitle}>{topic.title}</h2>
        </div>
        <Button variant="secondary" className={hub.addButton} onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} />
          Edit topic
        </Button>
      </div>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}

      <div className={styles.sectionHeader}>
        <h3>Attachments</h3>
        <Button className={hub.addButton} onClick={() => setChoosing(true)}>
          <Icon name="plus" size={18} />
          Add
        </Button>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {topic.attachments.length === 0 ? (
        <EmptyState title="No attachments yet">Upload a file, or add one from the library, to show it in this topic.</EmptyState>
      ) : (
        <AttachmentList
          attachments={topic.attachments}
          busy={busy}
          progress={progress}
          onOpen={open}
          onEdit={setEditingAttachment}
          onDelete={isAdmin ? setRemoving : undefined}
          onMove={(attachment, delta) => void move(attachment, delta)}
        />
      )}
      <PendingUploads
        belongs={(entry) => entry.topicId === topicId}
        accept={ATTACHMENT_ACCEPT}
        noun="attachment"
        nounTitle="Attachment"
        reloadKey={uploads.finishedCount}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />

      <EditTopicDialog
        topic={editing ? topic : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />
      <AddAttachmentDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        onUpload={() => {
          setChoosing(false);
          setUploading(true);
        }}
        onLibrary={() => {
          setChoosing(false);
          setPicking(true);
        }}
      />
      <AttachmentUploadDialog
        open={uploading}
        topicId={topic.id}
        onClose={() => setUploading(false)}
        onStarted={() => {
          void load();
          onChanged();
        }}
      />
      <LibraryPickerDialog
        open={picking}
        topicId={topic.id}
        onClose={() => setPicking(false)}
        onAttached={(attachment) => {
          setNotice({ tone: 'success', text: `Added "${attachment.title}" to the topic.` });
          void load();
          onChanged();
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Delete attachment"
        confirmLabel="Move to Trash"
        tone="danger"
        busy={busy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
      >
        {removing
          ? `Delete "${removing.title}"? It moves to the Trash, and an Admin can restore it from there. ${removing.source === 'library' ? 'The file stays in the library.' : 'The uploaded file is kept until it is deleted for good.'}`
          : ''}
      </ConfirmDialog>
      <EditAttachmentDialog
        attachment={editingAttachment}
        onClose={() => setEditingAttachment(null)}
        onSaved={(title) => {
          setNotice({ tone: 'success', text: `Attachment "${title}" saved.` });
          void load();
          onChanged();
        }}
      />
      <PlayerDialog video={video} onClose={() => setVideo(null)} />
      <ImageDialog attachment={image} onClose={() => setImage(null)} />
    </>
  );
}
