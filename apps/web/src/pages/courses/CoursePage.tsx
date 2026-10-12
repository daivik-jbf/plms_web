import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { addLesson, addTopic, type CourseTree, getCourse, type LessonNode, renameLesson, reorderLessons, reorderTopics, type TopicSummary, updateTopic } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';
import { CourseOutline } from './CourseOutline';
import { EditCourseDialog } from './EditCourseDialog';
import { TitleDialog } from './TitleDialog';
import { TopicPanel } from './TopicPanel';

type Notice = { tone: 'error' | 'success'; text: string };

type TitleMode =
  | { kind: 'add-lesson' }
  | { kind: 'rename-lesson'; lesson: LessonNode }
  | { kind: 'add-topic'; lesson: LessonNode }
  | { kind: 'rename-topic'; topic: TopicSummary };

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
  const [titleMode, setTitleMode] = useState<TitleMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    if (before === topicId || !window.matchMedia?.('(max-width: 760px)').matches) return;
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
  async function move(change: () => Promise<CourseTree>) {
    setBusy(true);
    setNotice(null);
    try {
      setTree(await change());
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
  const sendTitle = async (mode: TitleMode, title: string): Promise<void> => {
    switch (mode.kind) {
      case 'add-lesson':
        setTree(await addLesson(tree.id, title));
        setNotice({ tone: 'success', text: `Lesson "${title}" added.` });
        break;
      case 'rename-lesson':
        setTree(await renameLesson(mode.lesson.id, title));
        setNotice({ tone: 'success', text: `Lesson renamed to "${title}".` });
        break;
      case 'add-topic':
        setTree(await addTopic(mode.lesson.id, title));
        setNotice({ tone: 'success', text: `Topic "${title}" added.` });
        break;
      case 'rename-topic':
        await updateTopic(mode.topic.id, { title });
        setNotice({ tone: 'success', text: `Topic renamed to "${title}".` });
        await load();
        // The open topic may be the one that was renamed.
        setReloadKey((key) => key + 1);
        break;
    }
  };

  const dialog = titleMode
    ? {
        'add-lesson': { heading: 'Add lesson', label: 'Lesson title', initial: '', submitLabel: 'Add lesson', emptyMessage: 'Enter a lesson title.' },
        'rename-lesson': { heading: 'Rename lesson', label: 'Lesson title', initial: titleMode.kind === 'rename-lesson' ? titleMode.lesson.title : '', submitLabel: 'Save', emptyMessage: 'Enter a lesson title.' },
        'add-topic': { heading: 'Add topic', label: 'Topic title', initial: '', submitLabel: 'Add topic', emptyMessage: 'Enter a topic title.' },
        'rename-topic': { heading: 'Rename topic', label: 'Topic title', initial: titleMode.kind === 'rename-topic' ? titleMode.topic.title : '', submitLabel: 'Save', emptyMessage: 'Enter a topic title.' },
      }[titleMode.kind]
    : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className={media.crumbs}>
        <Link to="/courses">Courses</Link> › {tree.title}
      </nav>
      <div className={media.header}>
        <h1>{tree.title}</h1>
        <Button onClick={() => setEditing(true)}>Edit course</Button>
      </div>
      {tree.coverUrl || tree.description ? (
        <div className={styles.hero}>
          {tree.coverUrl ? <img className={styles.cover} src={tree.coverUrl} alt="" /> : null}
          {tree.description ? <p className={styles.about}>{tree.description}</p> : null}
        </div>
      ) : null}

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className={styles.panes} data-view={topicId ? 'topic' : 'tree'}>
        <section ref={treePane} className={styles.treePane} aria-label="Lessons and topics">
          <div className={styles.treeHeader}>
            <Button size="small" onClick={() => setTitleMode({ kind: 'add-lesson' })}>
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
              onRenameLesson={(lesson) => setTitleMode({ kind: 'rename-lesson', lesson })}
              onRenameTopic={(topic) => setTitleMode({ kind: 'rename-topic', topic })}
              onMoveLesson={(lesson, delta) =>
                void move(() =>
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
                void move(() =>
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

      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load()} />
      <TitleDialog
        open={titleMode !== null}
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
