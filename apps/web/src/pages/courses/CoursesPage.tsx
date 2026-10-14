import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type CourseSummary, deleteCourse, listCourses, reorderCourses } from '../../api/courses';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { KebabMenu } from '../../components/KebabMenu';
import { Skeleton } from '../../components/Skeleton';
import { CourseDetail, plural } from './CourseDetail';
import { CourseDialog, type CourseDialogMode } from './CourseDialog';
import styles from './CoursesHub.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

export function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CourseDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(params.get('course'));
  const { state } = useAuth();
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';
  const [removing, setRemoving] = useState<CourseSummary | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listCourses();
      setCourses(list);
      // The course shown stays the one chosen when the order changes, and is the first one until one is chosen.
      setChosenId((current) => (list.some((course) => course.id === current) ? current : (list[0]?.id ?? null)));
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setQuery(text: string) {
    const next = new URLSearchParams(params);
    if (text) next.set('q', text);
    else next.delete('q');
    setParams(next, { replace: true });
  }

  async function move(index: number, delta: -1 | 1) {
    if (!courses) return;
    const ids = courses.map((course) => course.id);
    const target = index + delta;
    const moved = courses[index]?.title ?? '';
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setCourses(await reorderCourses(ids));
      setNotice({ tone: 'success', text: `Moved "${moved}" ${delta === -1 ? 'up' : 'down'}.` });
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
      await deleteCourse(removing.id);
      setNotice({ tone: 'success', text: `Course "${removing.title}" moved to the Trash.` });
      setRemoving(null);
      await load();
    } catch (error) {
      setRemoveError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function onSaved(title: string, kind: CourseDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Course "${title}" created.` : `Course renamed to "${title}".` });
    void load();
  }

  const selected = courses?.find((course) => course.id === chosenId) ?? courses?.[0];
  const needle = query.trim().toLowerCase();
  const shown = courses?.filter((course) => course.title.toLowerCase().includes(needle)) ?? [];

  return (
    <>
      <div className={styles.header}>
        <span className={styles.headerTile} aria-hidden="true">
          <Icon name="courses" size={40} />
        </span>
        <div className={styles.headerText}>
          <h1>Courses</h1>
          <p>Manage and organize your learning content</p>
        </div>
        <Button className={styles.newButton} onClick={() => setDialog({ kind: 'create' })}>
          <Icon name="plus" size={20} />
          New course
        </Button>
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
      ) : courses === null ? (
        <Skeleton />
      ) : courses.length === 0 ? (
        <EmptyState title="No courses yet">Create a course to start adding lessons, topics and files.</EmptyState>
      ) : (
        <div className={styles.layout}>
          <section className={styles.listCard} aria-label="All courses">
            <h2 className={styles.listTitle}>
              <Icon name="list" size={24} />
              All Courses
              <span className={styles.badge}>{courses.length}</span>
            </h2>
            <div className={styles.listSearch}>
              <span className={styles.listSearchIcon}>
                <Icon name="search" size={18} />
              </span>
              <input type="search" aria-label="Search courses in this list" placeholder="Search courses..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            {shown.length === 0 ? (
              <p className={styles.noMatch}>No course matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <ul className={styles.courses}>
                {shown.map((course) => (
                  <li key={course.id} className={course.id === selected?.id ? `${styles.course} ${styles.courseSelected}` : styles.course}>
                    <button type="button" className={styles.courseButton} aria-current={course.id === selected?.id ? 'true' : undefined} onClick={() => setChosenId(course.id)}>
                      <span className={styles.courseTile} aria-hidden="true">
                        {course.coverUrl ? <img src={course.coverUrl} alt="" loading="lazy" /> : <Icon name="book" size={26} />}
                      </span>
                      <span className={styles.courseText}>
                        <span className={styles.courseName}>{course.title}</span>
                        <span className={styles.courseMeta}>
                          {plural(course.lessonCount, 'Lesson')} • {plural(course.topicCount, 'Topic')}
                        </span>
                      </span>
                    </button>
                    <KebabMenu
                      label={`Actions for ${course.title}`}
                      disabled={busy}
                      items={[
                        { label: 'Rename', onSelect: () => setDialog({ kind: 'rename', course }) },
                        { label: 'Move up', disabled: courses.indexOf(course) === 0, onSelect: () => void move(courses.indexOf(course), -1) },
                        { label: 'Move down', disabled: courses.indexOf(course) === courses.length - 1, onSelect: () => void move(courses.indexOf(course), 1) },
                        { label: 'Open the full course editor', to: `/courses/${course.id}` },
                        ...(isAdmin ? [{ label: 'Delete', onSelect: () => setRemoving(course) }] : []),
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className={styles.detail}>
            {selected ? (
              <CourseDetail
                key={selected.id}
                course={selected}
                isAdmin={isAdmin}
                busy={busy}
                onChanged={() => void load()}
              />
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Delete course"
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
          ? `Delete the course "${removing.title}"? It moves to the Trash with its ${plural(removing.lessonCount, 'lesson')}, ${plural(removing.topicCount, 'topic')} and their files. An Admin can restore it from there.`
          : ''}
      </ConfirmDialog>
      <CourseDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
