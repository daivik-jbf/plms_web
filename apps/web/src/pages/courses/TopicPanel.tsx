import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { getTopic, type TopicView } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';

// The chosen topic: its title and text. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId }: { topicId: string }) {
  const [topic, setTopic] = useState<TopicView | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  }, [load]);

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

  return (
    <>
      <h2 className={styles.topicTitle}>{topic.title}</h2>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}
    </>
  );
}
