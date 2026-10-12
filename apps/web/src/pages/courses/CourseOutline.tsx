import { type KeyboardEvent, useRef, useState } from 'react';
import type { LessonNode, TopicSummary } from '../../api/courses';
import styles from './Courses.module.css';

interface CourseOutlineProps {
  lessons: LessonNode[];
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string) => void;
}

type Entry = { kind: 'lesson'; id: string; lesson: LessonNode } | { kind: 'topic'; id: string; lessonId: string };

const filesText = (topic: TopicSummary): string =>
  topic.attachmentCount === 0 ? 'No files' : topic.attachmentCount === 1 ? '1 file' : `${topic.attachmentCount} files`;

// The lessons and topics in the order the arrow keys walk them: a closed lesson hides its topics.
function visibleEntries(lessons: LessonNode[], closed: ReadonlySet<string>): Entry[] {
  return lessons.flatMap((lesson): Entry[] => [
    { kind: 'lesson', id: lesson.id, lesson },
    ...(closed.has(lesson.id) ? [] : lesson.topics.map((topic): Entry => ({ kind: 'topic', id: topic.id, lessonId: lesson.id }))),
  ]);
}

// An accessible tree (the WAI-ARIA tree pattern): one item is reachable with Tab, the arrow keys do the rest, and the
// state of every lesson is announced through aria-expanded.
export function CourseOutline({ lessons, selectedTopicId, onSelectTopic }: CourseOutlineProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
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
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (!closed.has(entry.id)) toggle(entry.id, false);
        } else {
          focusEntry(entry.lessonId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (entry.kind === 'lesson') toggle(entry.id, closed.has(entry.id));
        else onSelectTopic(entry.id);
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
    <ul role="tree" aria-label="Course contents" className={styles.tree} onKeyDown={onKeyDown}>
      {lessons.map((lesson) => {
        const open = !closed.has(lesson.id);
        return (
          <li
            key={lesson.id}
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-label={lesson.title}
            data-id={lesson.id}
            tabIndex={tabStop === lesson.id ? 0 : -1}
            ref={register(lesson.id)}
            onFocus={noteFocus(lesson.id)}
            className={styles.item}
          >
            <div className={styles.row}>
              <span className={`${styles.label} ${styles.lessonLabel}`} onClick={() => toggle(lesson.id, !open)}>
                <span aria-hidden="true">{open ? '▾ ' : '▸ '}</span>
                {lesson.title}
              </span>
            </div>
            {open ? (
              lesson.topics.length === 0 ? (
                <p className={styles.hint}>No topics yet</p>
              ) : (
                <ul role="group" className={styles.group}>
                  {lesson.topics.map((topic) => (
                    <li
                      key={topic.id}
                      role="treeitem"
                      aria-level={2}
                      aria-selected={topic.id === selectedTopicId}
                      aria-label={topic.title}
                      data-id={topic.id}
                      tabIndex={tabStop === topic.id ? 0 : -1}
                      ref={register(topic.id)}
                      onFocus={noteFocus(topic.id)}
                      className={topic.id === selectedTopicId ? `${styles.item} ${styles.selected}` : styles.item}
                    >
                      <div className={styles.row}>
                        <span className={styles.label} onClick={() => onSelectTopic(topic.id)}>
                          {topic.title}
                        </span>
                        <span className={styles.count}>{filesText(topic)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
