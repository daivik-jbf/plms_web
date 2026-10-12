import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type CourseTree, getCourse } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';
import { CourseOutline } from './CourseOutline';
import { EditCourseDialog } from './EditCourseDialog';
import { TopicPanel } from './TopicPanel';

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

  const inCourse = tree.lessons.some((lesson) => lesson.topics.some((topic) => topic.id === topicId));

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

      <div className={styles.panes} data-view={topicId ? 'topic' : 'tree'}>
        <section className={styles.treePane} aria-label="Lessons and topics">
          {tree.lessons.length === 0 ? (
            <EmptyState title="No lessons yet">Add a lesson to start building the course.</EmptyState>
          ) : (
            <CourseOutline lessons={tree.lessons} selectedTopicId={topicId} onSelectTopic={(id) => setParams({ topic: id })} />
          )}
        </section>
        <section className={styles.topicPane} aria-label="Selected topic">
          {topicId ? (
            <>
              <Button className={styles.back} variant="secondary" size="small" aria-label="Back to the course" onClick={() => setParams({})}>
                ← Back
              </Button>
              {inCourse ? <TopicPanel key={topicId} topicId={topicId} /> : <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>}
            </>
          ) : (
            <EmptyState title="Choose a topic">Its text and files appear here.</EmptyState>
          )}
        </section>
      </div>

      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load()} />
    </>
  );
}
