import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../api/client';
import { deleteForGood, listTrash, restoreFromTrash, type TrashEntry } from '../../api/trash';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import hub from '../courses/CoursesHub.module.css';
import media from '../media/Media.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

const TYPE_WORDS = { course: 'Course', lesson: 'Lesson', topic: 'Topic', attachment: 'Attachment' } as const;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const formatWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function whereText(entry: TrashEntry): string {
  if (entry.type === 'lesson') return `In the course "${entry.courseTitle ?? ''}"`;
  if (entry.type === 'attachment') return `In the topic "${entry.topicTitle ?? ''}", lesson "${entry.lessonTitle ?? ''}", course "${entry.courseTitle ?? ''}"`;
  if (entry.type === 'topic') return `In the lesson "${entry.lessonTitle ?? ''}", course "${entry.courseTitle ?? ''}"`;
  return '—';
}

function containsText(entry: TrashEntry): string {
  if (entry.type === 'course') return `${plural(entry.lessonCount ?? 0, 'lesson')}, ${plural(entry.topicCount ?? 0, 'topic')}`;
  if (entry.type === 'lesson') return plural(entry.topicCount ?? 0, 'topic');
  return '—';
}

// Admins only (the route and the server both say so): what was deleted from Courses, to restore or delete for good.
export function TrashPage() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState<TrashEntry | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await listTrash());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(entry: TrashEntry) {
    setBusy(true);
    setNotice(null);
    try {
      await restoreFromTrash(entry.type, entry.id);
      setNotice({ tone: 'success', text: `${TYPE_WORDS[entry.type]} "${entry.title}" restored.` });
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
    } finally {
      await load();
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!purging) return;
    setBusy(true);
    setPurgeError(null);
    try {
      await deleteForGood(purging.type, purging.id);
      setNotice({ tone: 'success', text: `${TYPE_WORDS[purging.type]} "${purging.title}" deleted for good.` });
      setPurging(null);
      await load();
    } catch (error) {
      setPurgeError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={hub.header}>
        <span className={hub.headerTile} aria-hidden="true">
          <Icon name="trash" size={40} />
        </span>
        <div className={hub.headerText}>
          <h1>Trash</h1>
          <p>Courses, lessons, topics and files that were deleted. Restore them, or delete them for good.</p>
        </div>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loadError ? (
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
      ) : entries === null ? (
        <Skeleton />
      ) : entries.length === 0 ? (
        <EmptyState title="The Trash is empty">Courses, lessons, topics and files you delete appear here.</EmptyState>
      ) : (
        <Table caption="Trash">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Where it was</th>
              <th scope="col">It holds</th>
              <th scope="col">Deleted</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.type}:${entry.id}`}>
                <td data-label="Item">
                  <span className={media.name}>{entry.title}</span>
                  <Badge tone="neutral">{TYPE_WORDS[entry.type]}</Badge>
                </td>
                <td data-label="Where it was">{whereText(entry)}</td>
                <td data-label="It holds">{containsText(entry)}</td>
                <td data-label="Deleted">
                  {formatWhen(entry.deletedAt)}
                  {entry.deletedBy ? <span className={media.muted}>by {entry.deletedBy.name}</span> : null}
                </td>
                <td data-label="Actions">
                  <div className={media.actions}>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Restore ${entry.title}`} onClick={() => void restore(entry)}>
                      <Icon name="restore" size={16} />
                      &nbsp;Restore
                    </Button>
                    <Button variant="danger" size="small" disabled={busy} aria-label={`Delete ${entry.title} for good`} onClick={() => setPurging(entry)}>
                      <Icon name="trash" size={16} />
                      &nbsp;Delete for good
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={purging !== null}
        title="Delete for good"
        confirmLabel="Delete for good"
        tone="danger"
        busy={busy}
        error={purgeError}
        onConfirm={() => void confirmPurge()}
        onCancel={() => {
          setPurging(null);
          setPurgeError(null);
        }}
      >
        {purging
          ? `Delete the ${TYPE_WORDS[purging.type].toLowerCase()} "${purging.title}" for good? Everything in it, including the files uploaded to it, is removed and cannot be restored.`
          : ''}
      </ConfirmDialog>
    </>
  );
}
