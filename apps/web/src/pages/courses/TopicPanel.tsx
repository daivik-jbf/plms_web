import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { getTopic, type TopicView } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';
import { EditTopicDialog } from './EditTopicDialog';

interface TopicPanelProps {
  topicId: string;
  // Goes up whenever the page changed something that may be in this topic (for example its title), so it reloads.
  reloadKey: number;
  // The topic's own text was saved: the page reloads the tree, which shows its title.
  onChanged: () => void;
}

// The chosen topic: its title and text. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId, reloadKey, onChanged }: TopicPanelProps) {
  const [topic, setTopic] = useState<TopicView | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

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
  }, [load, reloadKey]);

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
      <div className={styles.topicHeader}>
        <h2 className={styles.topicTitle}>{topic.title}</h2>
        <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
          Edit topic
        </Button>
      </div>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}
      <EditTopicDialog
        topic={editing ? topic : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />
    </>
  );
}
