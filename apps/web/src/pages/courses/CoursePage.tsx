import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { addLessonWithCover, addTopicWithCover, type CourseTree, deleteLesson, deleteTopic, getCourse, getTopic, type LessonNode, reorderLessons, reorderTopics, type TopicSummary, type TopicView } from '../../api/courses';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import media from '../media/Media.module.css';
import hub from './CoursesHub.module.css';
import styles from './Courses.module.css';
import { CourseOutline } from './CourseOutline';
import { AddLessonDialog } from './AddLessonDialog';
import { AddTopicDialog } from './AddTopicDialog';
import { EditCourseDialog } from './EditCourseDialog';
import { EditLessonDialog } from './EditLessonDialog';
import { EditTopicDialog } from './EditTopicDialog';
import { plural } from './CourseDetail';
import { TopicPanel } from './TopicPanel';

type Notice = { tone: 'error' | 'success'; text: string };

type TitleMode =
  | { kind: 'add-lesson' }
  | { kind: 'add-topic'; lesson: LessonNode };

// The key gives every course its own page state when moving from one to another.
export function CoursePage() {
  const { courseId = '' } = useParams();
  return <Course key={courseId} courseId={courseId} />;
}

function Course({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topic');
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonNode | null>(null);
  const [editingTopic, setEditingTopic] = useState<TopicView | null>(null);
  const [titleMode, setTitleMode] = useState<TitleMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { state: auth } = useAuth();
  const isAdmin = auth.status === 'authenticated' && auth.user.role === 'admin';
  const [removing, setRemoving] = useState<{ kind: 'lesson'; lesson: LessonNode } | { kind: 'topic'; topic: TopicSummary } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTree(await getCourse(courseId));
      setMissing(false);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Where one pane is shown at a time (the same width as in Courses.module.css) the pane that had the keyboard is hidden
  // when the other is shown, so the keyboard is taken along: to Back when a topic opens, to that topic in the list on Back.
  const treePane = useRef<HTMLElement>(null);
  const topicPane = useRef<HTMLElement>(null);
  const shownTopic = useRef(topicId);
  useEffect(() => {
    const before = shownTopic.current;
    shownTopic.current = topicId;
    if (before === topicId || !window.matchMedia?.('(max-width: 900px)').matches) return;
    if (topicId) {
      topicPane.current?.querySelector<HTMLElement>(`.${styles.back}`)?.focus();
    } else if (before) {
      const items = Array.from(treePane.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
      (items.find((item) => item.dataset.id === before) ?? items.find((item) => item.tabIndex === 0))?.focus();
    }
  }, [topicId]);

  if (missing) {
    return (
      <EmptyState title="Course not found">
        <Link to="/courses">Back to Courses</Link>
      </EmptyState>
    );
  }
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

  const lessonOfTopic = tree.lessons.find((lesson) => lesson.topics.some((topic) => topic.id === topicId));

  // Every change answers with the whole tree. A change that fails is explained, and the tree is read again in case it moved on.
  async function move(what: string, delta: -1 | 1, change: () => Promise<CourseTree>) {
    setBusy(true);
    setNotice(null);
    try {
      setTree(await change());
      setNotice({ tone: 'success', text: `Moved ${what} ${delta === -1 ? 'up' : 'down'}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function swapped(ids: string[], id: string, delta: -1 | 1): string[] {
    const next = [...ids];
    const index = next.indexOf(id);
    [next[index], next[index + delta]] = [next[index + delta] as string, next[index] as string];
    return next;
  }

  // Sends a title from the dialog; the dialog explains a failure, and closes when this resolves.
  const sendTitle = async (mode: TitleMode, title: string, description = '', cover: File | null = null): Promise<void> => {
    switch (mode.kind) {
      case 'add-lesson':
      {
        const added = await addLessonWithCover(tree, title, description, cover);
        setTree(added.tree);
        setNotice(
          added.coverFailure
            ? { tone: 'error', text: `Lesson "${title}" was added, but the cover image could not be added: ${describeError(added.coverFailure)}` }
            : { tone: 'success', text: `Lesson "${title}" added.` },
        );
        break;
      }
      case 'add-topic': {
        const added = await addTopicWithCover(tree, mode.lesson.id, title, description, cover);
        setTree(added.tree);
        setNotice(
          added.coverFailure
            ? { tone: 'error', text: `Topic "${title}" was added, but the cover image could not be added: ${describeError(added.coverFailure)}` }
            : { tone: 'success', text: `Topic "${title}" added.` },
        );
        break;
      }
    }
  };

  // Any topic of the tree can be edited, not only the one that is open: its text is read first, for the form.
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
    setBusy(true);
    setRemoveError(null);
    try {
      if (removing.kind === 'lesson') {
        setTree(await deleteLesson(removing.lesson.id));
        setNotice({ tone: 'success', text: `Lesson "${removing.lesson.title}" moved to the Trash.` });
        // The open topic may have been in the lesson that went.
        if (topicId && removing.lesson.topics.some((topic) => topic.id === topicId)) setParams({});
      } else {
        setTree(await deleteTopic(removing.topic.id));
        setNotice({ tone: 'success', text: `Topic "${removing.topic.title}" moved to the Trash.` });
        if (topicId === removing.topic.id) setParams({});
      }
      setRemoving(null);
    } catch (error) {
      setRemoveError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className={media.crumbs}>
        <Link to="/courses">Courses</Link> › {tree.title}
      </nav>
      <div className={hub.banner}>
        <span className={hub.bannerTile} aria-hidden="true">
          {tree.coverUrl ? <img src={tree.coverUrl} alt="" /> : <Icon name="book" size={44} />}
        </span>
        <div className={hub.bannerText}>
          <h1 className={hub.bannerTitle}>{tree.title}</h1>
          <p className={hub.bannerCounts}>
            <span>
              <Icon name="book" size={18} /> {plural(tree.lessons.length, 'Lesson')}
            </span>
            <span aria-hidden="true">•</span>
            <span>
              <Icon name="tag" size={18} /> {plural(tree.lessons.reduce((sum, lesson) => sum + lesson.topics.length, 0), 'Topic')}
            </span>
          </p>
        </div>
        <div className={hub.bannerActions}>
          <Link className={hub.bannerBack} to={`/courses?course=${tree.id}`}>
            <Icon name="back" size={18} />
            Back to Courses
          </Link>
          <button type="button" className={hub.bannerButton} onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} />
            Edit course
          </button>
        </div>
        {tree.description ? <p className={hub.bannerAbout}>{tree.description}</p> : null}
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className={styles.panes} data-view={topicId ? 'topic' : 'tree'}>
        <section ref={treePane} className={styles.treePane} aria-label="Lessons and topics">
          <div className={styles.treeHeader}>
            <h2 className={styles.treeTitle}>
              <Icon name="book" size={22} />
              Lessons ({tree.lessons.length})
            </h2>
            <Button className={hub.addButton} onClick={() => setTitleMode({ kind: 'add-lesson' })}>
              <Icon name="plus" size={18} />
              Add lesson
            </Button>
          </div>
          {tree.lessons.length === 0 ? (
            <EmptyState title="No lessons yet">Add a lesson to start building the course.</EmptyState>
          ) : (
            <CourseOutline
              lessons={tree.lessons}
              selectedTopicId={topicId}
              busy={busy}
              onSelectTopic={(id) => setParams({ topic: id })}
              onAddTopic={(lesson) => setTitleMode({ kind: 'add-topic', lesson })}
              onEditLesson={(lesson) => setEditingLesson(lesson)}
              onEditTopic={(topic) => void editTopic(topic)}
              onDeleteLesson={isAdmin ? (lesson) => setRemoving({ kind: 'lesson', lesson }) : undefined}
              onDeleteTopic={isAdmin ? (topic) => setRemoving({ kind: 'topic', topic }) : undefined}
              onMoveLesson={(lesson, delta) =>
                void move(`lesson "${lesson.title}"`, delta, () =>
                  reorderLessons(
                    tree.id,
                    swapped(
                      tree.lessons.map((candidate) => candidate.id),
                      lesson.id,
                      delta,
                    ),
                  ),
                )
              }
              onMoveTopic={(lesson, topic, delta) =>
                void move(`topic "${topic.title}"`, delta, () =>
                  reorderTopics(
                    lesson.id,
                    swapped(
                      lesson.topics.map((candidate) => candidate.id),
                      topic.id,
                      delta,
                    ),
                  ),
                )
              }
            />
          )}
        </section>
        <section ref={topicPane} className={styles.topicPane} aria-label="Selected topic">
          {topicId ? (
            <>
              <Button className={styles.back} variant="secondary" size="small" aria-label="Back to the course" onClick={() => setParams({})}>
                ← Back
              </Button>
              {lessonOfTopic ? (
                <TopicPanel key={topicId} topicId={topicId} courseTitle={tree.title} lessonTitle={lessonOfTopic.title} reloadKey={reloadKey} onChanged={() => void load()} />
              ) : (
                <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>
              )}
            </>
          ) : (
            <EmptyState title="Choose a topic">Its text and files appear here.</EmptyState>
          )}
        </section>
      </div>

      <EditTopicDialog
        topic={editingTopic}
        onClose={() => setEditingTopic(null)}
        onSaved={() => {
          setNotice({ tone: 'success', text: 'Topic saved.' });
          void load();
          // The open topic may be the one that was edited.
          setReloadKey((key) => key + 1);
        }}
      />
      <EditLessonDialog
        lesson={editingLesson}
        onClose={() => setEditingLesson(null)}
        onSaved={(saved) => {
          setTree(saved);
          setNotice({ tone: 'success', text: 'Lesson saved.' });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={removing?.kind === 'topic' ? 'Delete topic' : 'Delete lesson'}
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
        {removing?.kind === 'topic'
          ? `Delete the topic "${removing.topic.title}"? It moves to the Trash with its files. An Admin can restore it from there.`
          : removing?.kind === 'lesson'
            ? `Delete the lesson "${removing.lesson.title}"? It moves to the Trash with its ${plural(removing.lesson.topics.length, 'topic')} and their files. An Admin can restore it from there.`
            : ''}
      </ConfirmDialog>
      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load()} />
      <AddTopicDialog
        open={titleMode?.kind === 'add-topic'}
        onSubmit={(title, description, cover) => (titleMode ? sendTitle(titleMode, title, description, cover) : Promise.resolve())}
        onClose={() => setTitleMode(null)}
      />
      <AddLessonDialog
        open={titleMode?.kind === 'add-lesson'}
        onSubmit={(title, description, cover) => (titleMode ? sendTitle(titleMode, title, description, cover) : Promise.resolve())}
        onClose={() => setTitleMode(null)}
      />
    </>
  );
}
