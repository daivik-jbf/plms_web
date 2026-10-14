import { type KeyboardEvent, useRef, useState } from 'react';
import type { AttachmentSummary, LessonNode, TopicSummary } from '../../api/courses';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { MoveButton } from '../../components/MoveButton';
import { useMoveFocus } from '../../components/use-move-focus';
import styles from './Courses.module.css';

interface CourseOutlineProps {
  lessons: LessonNode[];
  selectedTopicId: string | null;
  // While a change is being sent the moves are off, so two cannot cross.
  busy: boolean;
  onSelectTopic: (topicId: string) => void;
  onAddTopic: (lesson: LessonNode) => void;
  onEditLesson: (lesson: LessonNode) => void;
  onEditTopic: (topic: TopicSummary) => void;
  onMoveLesson: (lesson: LessonNode, delta: -1 | 1) => void;
  onMoveTopic: (lesson: LessonNode, topic: TopicSummary, delta: -1 | 1) => void;
  // Given only to Admins: the trash button appears on a row when its handler is given.
  onDeleteLesson?: (lesson: LessonNode) => void;
  onDeleteTopic?: (topic: TopicSummary) => void;
}

type Entry =
  | { kind: 'lesson'; id: string; lesson: LessonNode }
  | { kind: 'topic'; id: string; lessonId: string; topic: TopicSummary }
  | { kind: 'attachment'; id: string; topicId: string };

const KIND_ICONS: Record<AttachmentSummary['kind'], IconName> = { video: 'video', audio: 'podcasts', pdf: 'list', image: 'image' };

// Only a topic that has files can be opened; one without is a leaf like a file is.
const filesOf = (topic: TopicSummary): AttachmentSummary[] => topic.attachments ?? [];

const filesText = (topic: TopicSummary): string =>
  topic.attachmentCount === 0 ? 'No files' : topic.attachmentCount === 1 ? '1 file' : `${topic.attachmentCount} files`;

// The lessons, topics and files in the order the arrow keys walk them: a closed lesson hides its topics, a closed topic its files.
function visibleEntries(lessons: LessonNode[], closed: ReadonlySet<string>): Entry[] {
  return lessons.flatMap((lesson): Entry[] => [
    { kind: 'lesson', id: lesson.id, lesson },
    ...(closed.has(lesson.id)
      ? []
      : lesson.topics.flatMap((topic): Entry[] => [
          { kind: 'topic', id: topic.id, lessonId: lesson.id, topic },
          ...(closed.has(topic.id) ? [] : filesOf(topic).map((file): Entry => ({ kind: 'attachment', id: file.id, topicId: topic.id }))),
        ])),
  ]);
}

// An accessible tree (the WAI-ARIA tree pattern): one item is reachable with Tab, the arrow keys do the rest, and the
// state of every lesson is announced through aria-expanded. The buttons of a row are reached with Tab from that row.
export function CourseOutline({ lessons, selectedTopicId, busy, onSelectTopic, onAddTopic, onEditLesson, onEditTopic, onMoveLesson, onMoveTopic, onDeleteLesson, onDeleteTopic }: CourseOutlineProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const moveFocus = useMoveFocus(busy);
  const entries = visibleEntries(lessons, closed);
  const has = (id: string | null): id is string => id !== null && entries.some((entry) => entry.id === id);
  const tabStop = has(lastUsed) ? lastUsed : has(selectedTopicId) ? selectedTopicId : (entries[0]?.id ?? null);

  const focusEntry = (id: string): void => {
    setLastUsed(id);
    elements.current.get(id)?.focus();
  };

  const toggle = (lessonId: string, open: boolean): void => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target as HTMLElement;
    // Keys typed in something inside a row (a button) belong to that button.
    if (target.getAttribute('role') !== 'treeitem') return;
    const index = entries.findIndex((entry) => entry.id === target.dataset.id);
    const entry = entries[index];
    if (!entry) return;
    const go = (to: Entry | undefined): void => {
      event.preventDefault();
      if (to) focusEntry(to.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        go(entries[index + 1]);
        break;
      case 'ArrowUp':
        go(entries[index - 1]);
        break;
      case 'Home':
        go(entries[0]);
        break;
      case 'End':
        go(entries[entries.length - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (closed.has(entry.id)) toggle(entry.id, true);
          else if (entry.lesson.topics.length > 0) focusEntry(entries[index + 1]!.id);
        } else if (entry.kind === 'topic' && filesOf(entry.topic).length > 0) {
          if (closed.has(entry.id)) toggle(entry.id, true);
          else focusEntry(entries[index + 1]!.id);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (!closed.has(entry.id)) toggle(entry.id, false);
        } else if (entry.kind === 'topic') {
          if (filesOf(entry.topic).length > 0 && !closed.has(entry.id)) toggle(entry.id, false);
          else focusEntry(entry.lessonId);
        } else {
          focusEntry(entry.topicId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (entry.kind === 'lesson') toggle(entry.id, closed.has(entry.id));
        else if (entry.kind === 'topic') onSelectTopic(entry.id);
        else onSelectTopic(entry.topicId);
        break;
    }
  }

  const register = (id: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  };

  // Focus moving to an item itself (not to something inside it) makes it the item Tab comes back to.
  const noteFocus = (id: string) => (event: { target: EventTarget; currentTarget: EventTarget }) => {
    if (event.target === event.currentTarget) setLastUsed(id);
  };

  return (
    <ul role="tree" aria-label="Course contents" className={styles.tree} onKeyDown={onKeyDown} {...moveFocus}>
      {lessons.map((lesson, lessonIndex) => {
        const open = !closed.has(lesson.id);
        const lessonTab = tabStop === lesson.id ? 0 : -1;
        return (
          <li
            key={lesson.id}
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-label={lesson.title}
            data-id={lesson.id}
            tabIndex={lessonTab}
            ref={register(lesson.id)}
            onFocus={noteFocus(lesson.id)}
            className={styles.item}
          >
            <div className={styles.row}>
              <span className={`${styles.label} ${styles.lessonLabel}`} onClick={() => toggle(lesson.id, !open)}>
                <span aria-hidden="true" className={open ? `${styles.twisty} ${styles.twistyOpen}` : styles.twisty}>
                  <Icon name="chevron" size={16} />
                </span>
                {lesson.coverUrl ? <img className={styles.thumb} src={lesson.coverUrl} alt="" loading="lazy" /> : null}
                {lesson.title}
              </span>
              <div className={styles.actions}>
                <Button variant="secondary" size="small" className={styles.addTopic} tabIndex={lessonTab} aria-label={`Add a topic to ${lesson.title}`} onClick={() => onAddTopic(lesson)}>
                  <Icon name="plus" size={16} />
                  Add topic
                </Button>
                <Button variant="secondary" size="small" className={styles.iconButton} tabIndex={lessonTab} aria-label={`Edit lesson ${lesson.title}`} title="Edit lesson" onClick={() => onEditLesson(lesson)}>
                  <Icon name="edit" size={16} />
                </Button>
                <MoveButton className={styles.iconButton} moveKey={`lesson:${lesson.id}:up`} label={`Move lesson ${lesson.title} up`} tabIndex={lessonTab} unavailable={busy || lessonIndex === 0} onMove={() => onMoveLesson(lesson, -1)}>
                  <Icon name="up" size={16} />
                </MoveButton>
                <MoveButton
                  className={styles.iconButton}
                  moveKey={`lesson:${lesson.id}:down`}
                  label={`Move lesson ${lesson.title} down`}
                  tabIndex={lessonTab}
                  unavailable={busy || lessonIndex === lessons.length - 1}
                  onMove={() => onMoveLesson(lesson, 1)}
                >
                  <Icon name="down" size={16} />
                </MoveButton>
                {onDeleteLesson ? (
                  <Button variant="secondary" size="small" className={styles.iconButton} tabIndex={lessonTab} aria-label={`Delete lesson ${lesson.title}`} title="Delete" disabled={busy} onClick={() => onDeleteLesson(lesson)}>
                    <Icon name="trash" size={16} />
                  </Button>
                ) : null}
              </div>
            </div>
            {open ? (
              lesson.topics.length === 0 ? (
                <p className={styles.hint}>No topics yet</p>
              ) : (
                <ul role="group" className={styles.group}>
                  {lesson.topics.map((topic, topicIndex) => {
                    const topicTab = tabStop === topic.id ? 0 : -1;
                    const files = filesOf(topic);
                    const topicOpen = !closed.has(topic.id);
                    return (
                      <li
                        key={topic.id}
                        role="treeitem"
                        aria-level={2}
                        aria-expanded={files.length > 0 ? topicOpen : undefined}
                        aria-selected={topic.id === selectedTopicId}
                        aria-label={topic.title}
                        data-id={topic.id}
                        tabIndex={topicTab}
                        ref={register(topic.id)}
                        onFocus={noteFocus(topic.id)}
                        className={topic.id === selectedTopicId ? `${styles.item} ${styles.selected}` : styles.item}
                      >
                        <div className={styles.row}>
                          <span className={styles.label} onClick={() => onSelectTopic(topic.id)}>
                            {files.length > 0 ? (
                              <span
                                aria-hidden="true"
                                className={topicOpen ? `${styles.twisty} ${styles.twistyOpen}` : styles.twisty}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggle(topic.id, !topicOpen);
                                }}
                              >
                                <Icon name="chevron" size={16} />
                              </span>
                            ) : (
                              <span aria-hidden="true" className={styles.twistySpace} />
                            )}
                            {topic.coverUrl ? <img className={styles.thumb} src={topic.coverUrl} alt="" loading="lazy" /> : null}
                            {topic.title}
                          </span>
                          <span className={styles.count}>{filesText(topic)}</span>
                          <div className={styles.actions}>
                            <Button variant="secondary" size="small" className={styles.iconButton} tabIndex={topicTab} aria-label={`Edit topic ${topic.title}`} title="Edit topic" onClick={() => onEditTopic(topic)}>
                              <Icon name="edit" size={16} />
                            </Button>
                            <MoveButton
                              className={styles.iconButton}
                              moveKey={`topic:${topic.id}:up`}
                              label={`Move topic ${topic.title} up`}
                              tabIndex={topicTab}
                              unavailable={busy || topicIndex === 0}
                              onMove={() => onMoveTopic(lesson, topic, -1)}
                            >
                              <Icon name="up" size={16} />
                            </MoveButton>
                            <MoveButton
                              className={styles.iconButton}
                              moveKey={`topic:${topic.id}:down`}
                              label={`Move topic ${topic.title} down`}
                              tabIndex={topicTab}
                              unavailable={busy || topicIndex === lesson.topics.length - 1}
                              onMove={() => onMoveTopic(lesson, topic, 1)}
                            >
                              <Icon name="down" size={16} />
                            </MoveButton>
                            {onDeleteTopic ? (
                              <Button variant="secondary" size="small" className={styles.iconButton} tabIndex={topicTab} aria-label={`Delete topic ${topic.title}`} title="Delete" disabled={busy} onClick={() => onDeleteTopic(topic)}>
                                <Icon name="trash" size={16} />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {topicOpen && files.length > 0 ? (
                          <ul role="group" className={styles.group}>
                            {files.map((file) => {
                              const fileTab = tabStop === file.id ? 0 : -1;
                              return (
                                <li
                                  key={file.id}
                                  role="treeitem"
                                  aria-level={3}
                                  aria-label={file.title}
                                  data-id={file.id}
                                  tabIndex={fileTab}
                                  ref={register(file.id)}
                                  onFocus={noteFocus(file.id)}
                                  className={`${styles.item} ${styles.leaf}`}
                                >
                                  <div className={styles.row}>
                                    <span className={`${styles.label} ${styles.fileLabel}`} onClick={() => onSelectTopic(topic.id)}>
                                      <span aria-hidden="true" className={styles.fileIcon}>
                                        <Icon name={KIND_ICONS[file.kind]} size={16} />
                                      </span>
                                      {file.title}
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
