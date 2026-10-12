import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type CourseSummary, listCourses, reorderCourses } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { MoveButton } from '../../components/MoveButton';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import { useMoveFocus } from '../../components/use-move-focus';
import media from '../media/Media.module.css';
import { CourseDialog, type CourseDialogMode } from './CourseDialog';

type Notice = { tone: 'error' | 'success'; text: string };

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CourseDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const moveFocus = useMoveFocus(busy);

  const load = useCallback(async () => {
    try {
      setCourses(await listCourses());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(index: number, delta: -1 | 1) {
    if (!courses) return;
    const ids = courses.map((course) => course.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setCourses(await reorderCourses(ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function onSaved(title: string, kind: CourseDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Course "${title}" created.` : `Course renamed to "${title}".` });
    void load();
  }

  return (
    <>
      <div className={media.header}>
        <h1>Courses</h1>
        <Button onClick={() => setDialog({ kind: 'create' })}>New course</Button>
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
        <div {...moveFocus}>
        <Table caption="Courses">
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col">Lessons</th>
              <th scope="col">Topics</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course, index) => (
              <tr key={course.id}>
                <td data-label="Course">
                  <div className={media.itemCell}>
                    {course.coverUrl ? (
                      <img className={media.cover} src={course.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className={media.coverPlaceholder} aria-hidden="true">
                        ▤
                      </span>
                    )}
                    <Link className={media.name} to={`/courses/${course.id}`}>
                      {course.title}
                    </Link>
                  </div>
                </td>
                <td data-label="Lessons">{course.lessonCount}</td>
                <td data-label="Topics">{course.topicCount}</td>
                <td data-label="Actions">
                  <div className={media.actions}>
                    <Link className={media.link} to={`/courses/${course.id}`} aria-label={`Open ${course.title}`}>
                      Open
                    </Link>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${course.title}`} onClick={() => setDialog({ kind: 'rename', course })}>
                      Rename
                    </Button>
                    <MoveButton moveKey={`${course.id}:up`} label={`Move ${course.title} up`} unavailable={busy || index === 0} onMove={() => void move(index, -1)}>
                      ↑ Move up
                    </MoveButton>
                    <MoveButton moveKey={`${course.id}:down`} label={`Move ${course.title} down`} unavailable={busy || index === courses.length - 1} onMove={() => void move(index, 1)}>
                      ↓ Move down
                    </MoveButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        </div>
      )}

      <CourseDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
