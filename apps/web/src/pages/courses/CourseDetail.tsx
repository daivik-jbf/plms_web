import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { addLesson, addTopic, type CourseSummary, type CourseTree, deleteLesson, deleteTopic, getCourse, getTopic, type LessonNode, renameLesson, reorderLessons, type TopicSummary, type TopicView, uploadLessonCover } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AddTopicDialog } from './AddTopicDialog';
import { CoverDialog } from './CoverDialog';
import { EditTopicDialog } from './EditTopicDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { KebabMenu } from '../../components/KebabMenu';
import { MoveButton } from '../../components/MoveButton';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { useMoveFocus } from '../../components/use-move-focus';
import styles from './CoursesHub.module.css';
import { EditCourseDialog } from './EditCourseDialog';
import { TitleDialog } from './TitleDialog';

type TitleMode = { kind: 'add-lesson' } | { kind: 'rename-lesson'; lesson: LessonNode } | { kind: 'add-topic'; lesson: LessonNode };

type Notice = { tone: 'error' | 'success'; text: string };

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface CourseDetailProps {
  course: CourseSummary;
  // Only Admins may delete; the server enforces it too.
  isAdmin: boolean;
  busy: boolean;
  onRename: () => void;
  onDelete: () => void;
  // The course changed in a way the list shows (its counts, title or cover).
  onChanged: () => void;
}

export function CourseDetail({ course, isAdmin, busy: listBusy, onRename, onDelete, onChanged }: CourseDetailProps) {
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState('lessons');
  const [titleMode, setTitleMode] = useState<TitleMode | null>(null);
  const [editing, setEditing] = useState(false);
  const [coverOf, setCoverOf] = useState<LessonNode | null>(null);
  const [editingTopic, setEditingTopic] = useState<TopicView | null>(null);
  const [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState<{ kind: 'lesson'; lesson: LessonNode } | { kind: 'topic'; topic: TopicSummary } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busy = working || listBusy;
  const moveFocus = useMoveFocus(working);

  const load = useCallback(async () => {
    try {
      setTree(await getCourse(course.id));
      setMissing(false);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [course.id]);

  useEffect(() => {
    void load();
    // A rename in the list changes the title the tree was read with.
  }, [load, course.title]);

  if (missing) return <EmptyState title="Course not found">It may have been removed. Choose another course in the list.</EmptyState>;
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
  if (!tree) return <Skeleton />;

  const topics = tree.lessons.flatMap((lesson) => lesson.topics.map((topic) => ({ ...topic, lesson })));
  const about = tree.description?.trim() || `This course contains ${plural(tree.lessons.length, 'lesson')} and ${plural(topics.length, 'topic')}.`;

  async function moveLesson(lesson: LessonNode, delta: -1 | 1) {
    if (!tree) return;
    const ids = tree.lessons.map((candidate) => candidate.id);
    const at = ids.indexOf(lesson.id);
    [ids[at], ids[at + delta]] = [ids[at + delta] as string, ids[at] as string];
    setWorking(true);
    setNotice(null);
    try {
      setTree(await reorderLessons(tree.id, ids));
      setNotice({ tone: 'success', text: `Moved lesson "${lesson.title}" ${delta === -1 ? 'up' : 'down'}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setWorking(false);
    }
  }

  // Sends a title from the dialog; the dialog explains a failure, and closes when this resolves.
  async function sendTitle(mode: TitleMode, title: string, description = ''): Promise<void> {
    if (!tree) return;
    if (mode.kind === 'add-lesson') {
      setTree(await addLesson(tree.id, title));
      setNotice({ tone: 'success', text: `Lesson "${title}" added.` });
    } else if (mode.kind === 'rename-lesson') {
      setTree(await renameLesson(mode.lesson.id, title));
      setNotice({ tone: 'success', text: `Lesson renamed to "${title}".` });
    } else {
      setTree(await addTopic(mode.lesson.id, title, description));
      setNotice({ tone: 'success', text: `Topic "${title}" added.` });
    }
    onChanged();
  }

  // The text of the topic is read first, for the form.
  async function editTopic(topic: TopicSummary) {
    setNotice(null);
    try {
      setEditingTopic(await getTopic(topic.id));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setWorking(true);
    setRemoveError(null);
    try {
      if (removing.kind === 'lesson') {
        setTree(await deleteLesson(removing.lesson.id));
        setNotice({ tone: 'success', text: `Lesson "${removing.lesson.title}" moved to the Trash.` });
      } else {
        setTree(await deleteTopic(removing.topic.id));
        setNotice({ tone: 'success', text: `Topic "${removing.topic.title}" moved to the Trash.` });
      }
      setRemoving(null);
      onChanged();
    } catch (error) {
      setRemoveError(describeError(error));
    } finally {
      setWorking(false);
    }
  }

  const dialog = titleMode
    ? {
        'add-lesson': { heading: 'Add lesson', label: 'Lesson title', initial: '', submitLabel: 'Add lesson', emptyMessage: 'Enter a lesson title.' },
        'rename-lesson': { heading: 'Rename lesson', label: 'Lesson title', initial: titleMode.kind === 'rename-lesson' ? titleMode.lesson.title : '', submitLabel: 'Save', emptyMessage: 'Enter a lesson title.' },
        'add-topic': { heading: 'Add topic', label: 'Topic title', initial: '', submitLabel: 'Add topic', emptyMessage: 'Enter a topic title.' },
      }[titleMode.kind]
    : null;

  const lessonsCard = (
    <section className={styles.card} aria-label="Lessons">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <Icon name="book" size={24} />
          Lessons ({tree.lessons.length})
        </h2>
        <Button className={styles.addButton} onClick={() => setTitleMode({ kind: 'add-lesson' })}>
          <Icon name="plus" size={18} />
          Add Lesson
        </Button>
      </div>
      {tree.lessons.length === 0 ? (
        <EmptyState title="No lessons yet">Add a lesson to start building the course.</EmptyState>
      ) : (
        <ol className={styles.rows} {...moveFocus}>
          {tree.lessons.map((lesson, position) => (
            <li key={lesson.id} className={position === 0 ? `${styles.row} ${styles.rowFirst}` : styles.row}>
              {lesson.coverUrl ? (
                <img className={styles.rowThumb} src={lesson.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className={styles.number} aria-hidden="true">
                  {position + 1}
                </span>
              )}
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{lesson.title}</span>
                <span className={styles.rowMeta}>
                  <Icon name="tag" size={16} />
                  {plural(lesson.topics.length, 'topic')}
                </span>
              </span>
              <span className={styles.rowActions}>
                <MoveButton className={styles.square} moveKey={`${lesson.id}:up`} label={`Move lesson ${lesson.title} up`} unavailable={busy || position === 0} onMove={() => void moveLesson(lesson, -1)}>
                  <Icon name="up" size={18} />
                </MoveButton>
                <MoveButton className={styles.square} moveKey={`${lesson.id}:down`} label={`Move lesson ${lesson.title} down`} unavailable={busy || position === tree.lessons.length - 1} onMove={() => void moveLesson(lesson, 1)}>
                  <Icon name="down" size={18} />
                </MoveButton>
                <KebabMenu
                  label={`Actions for lesson ${lesson.title}`}
                  items={[
                    { label: 'Rename lesson', onSelect: () => setTitleMode({ kind: 'rename-lesson', lesson }) },
                    { label: 'Add topic', onSelect: () => setTitleMode({ kind: 'add-topic', lesson }) },
                    { label: 'Change cover', onSelect: () => setCoverOf(lesson) },
                    ...(isAdmin ? [{ label: 'Delete lesson', onSelect: () => setRemoving({ kind: 'lesson' as const, lesson }) }] : []),
                  ]}
                />
                <Link className={styles.chevron} to={`/courses/${tree.id}${lesson.topics[0] ? `?topic=${lesson.topics[0].id}` : ''}`} aria-label={`Open lesson ${lesson.title}`}>
                  <Icon name="chevron" />
                </Link>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const topicsCard = (
    <section className={styles.card} aria-label="Topics">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <Icon name="tag" size={24} />
          Topics ({topics.length})
        </h2>
      </div>
      {topics.length === 0 ? (
        <EmptyState title="No topics yet">Add a topic to a lesson from the Lessons tab.</EmptyState>
      ) : (
        <ul className={styles.rows}>
          {topics.map((topic, position) => (
            <li key={topic.id} className={position === 0 ? `${styles.row} ${styles.rowFirst}` : styles.row}>
              {topic.coverUrl ? <img className={styles.rowThumb} src={topic.coverUrl} alt="" loading="lazy" /> : null}
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{topic.title}</span>
                <span className={styles.rowMeta}>
                  <Icon name="book" size={16} />
                  {topic.lesson.title} · {plural(topic.attachmentCount, 'file')}
                </span>
              </span>
              <span className={styles.rowActions}>
                <KebabMenu
                  label={`Actions for topic ${topic.title}`}
                  items={[
                    { label: 'Edit topic', onSelect: () => void editTopic(topic) },
                    ...(isAdmin ? [{ label: 'Delete topic', onSelect: () => setRemoving({ kind: 'topic' as const, topic }) }] : []),
                  ]}
                />
                <Link className={styles.chevron} to={`/courses/${tree.id}?topic=${topic.id}`} aria-label={`Open topic ${topic.title}`}>
                  <Icon name="chevron" />
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const actionsCard = (
    <section className={styles.card} aria-label="Actions">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <Icon name="bolt" size={24} />
          Actions
        </h2>
      </div>
      <div className={styles.actionList}>
        <Button variant="secondary" onClick={onRename}>
          <Icon name="edit" size={18} />
          Rename course
        </Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} />
          Edit description and cover
        </Button>
        <Link className={styles.linkButton} to={`/courses/${tree.id}`}>
          <Icon name="list" size={18} />
          Open the full course editor
        </Link>
      </div>
    </section>
  );

  const aside = (
    <div className={styles.aside}>
      <section className={styles.card} aria-label="Course summary">
        <h2 className={styles.cardTitle}>
          <Icon name="info" size={22} />
          Course Summary
        </h2>
        <dl className={styles.summary}>
          <div>
            <dt>
              <Icon name="book" size={18} />
              Total Lessons
            </dt>
            <dd>{tree.lessons.length}</dd>
          </div>
          <div>
            <dt>
              <Icon name="tag" size={18} />
              Total Topics
            </dt>
            <dd>{topics.length}</dd>
          </div>
          <div>
            <dt>
              <Icon name="calendar" size={18} />
              Created
            </dt>
            <dd>{formatDate(tree.createdAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );

  const body = tab === 'topics' ? topicsCard : tab === 'actions' ? actionsCard : lessonsCard;

  return (
    <>
      <div className={styles.banner}>
        <span className={styles.bannerTile} aria-hidden="true">
          {tree.coverUrl ? <img src={tree.coverUrl} alt="" /> : <Icon name="book" size={44} />}
        </span>
        <div className={styles.bannerText}>
          <h2 className={styles.bannerTitle}>{tree.title}</h2>
          <p className={styles.bannerCounts}>
            <span>
              <Icon name="book" size={18} /> {plural(tree.lessons.length, 'Lesson')}
            </span>
            <span aria-hidden="true">•</span>
            <span>
              <Icon name="tag" size={18} /> {plural(topics.length, 'Topic')}
            </span>
          </p>
        </div>
        <div className={styles.bannerActions}>
          <button type="button" className={styles.bannerButton} onClick={onRename}>
            <Icon name="edit" size={18} />
            Rename
          </button>
          <KebabMenu
            label={`More actions for ${tree.title}`}
            items={[
              { label: 'Edit description and cover', onSelect: () => setEditing(true) },
              { label: 'Open the full course editor', to: `/courses/${tree.id}` },
              ...(isAdmin ? [{ label: 'Delete course', onSelect: onDelete }] : []),
            ]}
          />
        </div>
        <p className={styles.bannerAbout}>{about}</p>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Tabs
        label="Course sections"
        tabs={[
          { id: 'lessons', label: 'Lessons' },
          { id: 'topics', label: 'Topics' },
          { id: 'actions', label: 'Actions' },
        ]}
        value={tab}
        onChange={setTab}
      >
        <div className={styles.split}>
          {body}
          {aside}
        </div>
      </Tabs>

      <EditTopicDialog
        topic={editingTopic}
        onClose={() => setEditingTopic(null)}
        onSaved={() => {
          setNotice({ tone: 'success', text: 'Topic saved.' });
          void load().then(onChanged);
        }}
      />
      <CoverDialog
        open={coverOf !== null}
        title="Lesson cover"
        subject={coverOf?.title ?? ''}
        currentUrl={coverOf?.coverUrl ?? null}
        onClose={() => setCoverOf(null)}
        onSave={async (file) => {
          if (!coverOf) return;
          setTree(await uploadLessonCover(coverOf.id, file));
          setNotice({ tone: 'success', text: `Cover of the lesson "${coverOf.title}" saved.` });
          onChanged();
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={removing?.kind === 'topic' ? 'Delete topic' : 'Delete lesson'}
        confirmLabel="Move to Trash"
        tone="danger"
        busy={working}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
      >
        {removing?.kind === 'topic'
          ? `Delete the topic "${removing.topic.title}"? It moves to the Trash with its files. An Admin can restore it from there.`
          : removing?.kind === 'lesson'
            ? `Delete the lesson "${removing.lesson.title}"? It moves to the Trash with its ${plural(removing.lesson.topics.length, 'topic')} and their files. An Admin can restore it from there.`
            : ''}
      </ConfirmDialog>
      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load().then(onChanged)} />
      <AddTopicDialog
        open={titleMode?.kind === 'add-topic'}
        onSubmit={(title, description) => (titleMode ? sendTitle(titleMode, title, description) : Promise.resolve())}
        onClose={() => setTitleMode(null)}
      />
      <TitleDialog
        open={titleMode !== null && titleMode.kind !== 'add-topic'}
        heading={dialog?.heading ?? ''}
        label={dialog?.label ?? ''}
        initial={dialog?.initial ?? ''}
        submitLabel={dialog?.submitLabel ?? ''}
        emptyMessage={dialog?.emptyMessage ?? ''}
        onSubmit={(title) => (titleMode ? sendTitle(titleMode, title) : Promise.resolve())}
        onClose={() => setTitleMode(null)}
      />
    </>
  );
}
