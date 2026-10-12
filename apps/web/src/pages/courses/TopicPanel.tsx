import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type Attachment, getTopic, openAttachment, renameAttachment, reorderAttachments, type TopicDetail } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { CATEGORIES } from '../../media/categories';
import { usePlayer } from '../../player/PlayerContext';
import { PlayerDialog, type VideoTarget } from '../media/PlayerDialog';
import { AttachmentList } from './AttachmentList';
import styles from './Courses.module.css';
import { EditTopicDialog } from './EditTopicDialog';
import { ImageDialog } from './ImageDialog';
import { LibraryPickerDialog } from './LibraryPickerDialog';
import { TitleDialog } from './TitleDialog';

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
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<Attachment | null>(null);
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

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

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
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.topicHeader}>
        <h2 className={styles.topicTitle}>{topic.title}</h2>
        <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
          Edit topic
        </Button>
      </div>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}

      <div className={styles.sectionHeader}>
        <h3>Attachments</h3>
        <Button size="small" onClick={() => setPicking(true)}>
          Add from the library
        </Button>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {topic.attachments.length === 0 ? (
        <EmptyState title="No attachments yet">Add a file from the library to show it in this topic.</EmptyState>
      ) : (
        <AttachmentList attachments={topic.attachments} busy={busy} onOpen={open} onRename={setRenaming} onMove={(attachment, delta) => void move(attachment, delta)} />
      )}

      <EditTopicDialog
        topic={editing ? topic : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
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
      <TitleDialog
        open={renaming !== null}
        heading="Rename attachment"
        label="Attachment title"
        initial={renaming?.title ?? ''}
        submitLabel="Save"
        emptyMessage="Enter a title."
        onSubmit={async (title) => {
          await renameAttachment((renaming as Attachment).id, title);
          setNotice({ tone: 'success', text: `Attachment renamed to "${title}".` });
          await load();
        }}
        onClose={() => setRenaming(null)}
      />
      <PlayerDialog video={video} onClose={() => setVideo(null)} />
      <ImageDialog attachment={image} onClose={() => setImage(null)} />
    </>
  );
}
