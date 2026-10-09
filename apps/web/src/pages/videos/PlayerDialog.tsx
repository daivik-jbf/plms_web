import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { playItem, type VideoItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import { formatDate } from '../../lib/format';
import styles from './Videos.module.css';

const PLAYBACK_FAILED = 'This video could not be played. Please try again later.';

export function PlayerDialog({ item, onClose }: { item: VideoItem | null; onClose: () => void }) {
  return (
    <Dialog open={item !== null} onClose={onClose} title={item?.title ?? 'Video'}>
      {item ? <Player item={item} /> : null}
    </Dialog>
  );
}

function Player({ item }: { item: VideoItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every link that is handed out is recorded in the audit log, so the development double-run of effects
  // (StrictMode) must not ask twice for the same opening.
  const requestedFor = useRef<string | null>(null);
  const retried = useRef(false);
  const resumeAt = useRef(0);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await playItem(item.id)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [item.id]);

  useEffect(() => {
    if (requestedFor.current === item.id) return;
    requestedFor.current = item.id;
    void fetchLink();
  }, [item.id, fetchLink]);

  // The link lasts one hour. If the browser fails to read the video (for example the link expired during a long
  // pause) ask once for a new link and carry on from the same position.
  function onVideoError() {
    if (retried.current) {
      setError(PLAYBACK_FAILED);
      return;
    }
    retried.current = true;
    resumeAt.current = videoRef.current?.currentTime ?? 0;
    void fetchLink();
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video || resumeAt.current <= 0) return;
    video.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void video.play().catch(() => undefined);
  }

  return (
    <>
      {error ? (
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
      ) : src === null ? (
        <Skeleton rows={2} />
      ) : (
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          controls
          autoPlay
          preload="metadata"
          onError={onVideoError}
          onLoadedMetadata={onLoadedMetadata}
          onPlaying={() => {
            retried.current = false;
          }}
        />
      )}
      {item.description ? <p className={styles.description}>{item.description}</p> : null}
      <p className={styles.muted}>
        Added by {item.createdBy.name} · {formatDate(item.createdAt)}
      </p>
    </>
  );
}
