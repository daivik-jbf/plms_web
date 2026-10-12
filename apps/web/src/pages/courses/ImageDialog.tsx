import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { type Attachment, openAttachment } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';

const IMAGE_FAILED = 'This image could not be shown. Please try again later.';

export function ImageDialog({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  return (
    <Dialog open={attachment !== null} onClose={onClose} title={attachment?.title ?? 'Image'}>
      {attachment ? <Picture attachment={attachment} /> : null}
    </Dialog>
  );
}

function Picture({ attachment }: { attachment: Attachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every link that is handed out is recorded in the audit log, so the development double-run of effects
  // (StrictMode) must not ask twice for the same opening.
  const requestedFor = useRef<string | null>(null);
  const retried = useRef(false);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await openAttachment(attachment.id)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [attachment.id]);

  useEffect(() => {
    if (requestedFor.current === attachment.id) return;
    requestedFor.current = attachment.id;
    void fetchLink();
  }, [attachment.id, fetchLink]);

  // The link lasts one hour. If the picture stops loading, ask once for a new link; a second failure is shown.
  function onImageError() {
    if (retried.current) {
      setSrc(null);
      setError(IMAGE_FAILED);
      return;
    }
    retried.current = true;
    void fetchLink();
  }

  if (error) {
    return (
      <>
        <Alert tone="error">{error}</Alert>
        <Button
          variant="secondary"
          onClick={() => {
            retried.current = false;
            setError(null);
            void fetchLink();
          }}
        >
          Try again
        </Button>
      </>
    );
  }
  if (src === null) return <Skeleton rows={2} />;
  return (
    <img
      className={styles.largeImage}
      src={src}
      alt={attachment.title}
      onError={onImageError}
      onLoad={() => {
        retried.current = false;
      }}
    />
  );
}
