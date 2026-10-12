import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import { formatDate } from '../../lib/format';
import styles from './Media.module.css';

const PLAYBACK_FAILED = 'This video could not be played. Please try again later.';

// A video to play in the pop-up: a library item, or a video attached to a topic.
export interface VideoTarget {
  id: string;
  title: string;
  description: string | null;
  addedBy: string;
  addedAt: string;
  // Asks for a one-hour link (every link is recorded in the audit log).
  link: () => Promise<{ url: string }>;
}

export function PlayerDialog({ video, onClose }: { video: VideoTarget | null; onClose: () => void }) {
  return (
    <Dialog open={video !== null} onClose={onClose} title={video?.title ?? 'Video'}>
      {video ? <Player video={video} /> : null}
    </Dialog>
  );
}

function Player({ video }: { video: VideoTarget }) {
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
      setSrc((await video.link()).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [video]);

  useEffect(() => {
    if (requestedFor.current === video.id) return;
    requestedFor.current = video.id;
    void fetchLink();
  }, [video.id, fetchLink]);

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
    const element = videoRef.current;
    if (!element || resumeAt.current <= 0) return;
    element.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void element.play().catch(() => undefined);
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
      {video.description ? <p className={styles.description}>{video.description}</p> : null}
      <p className={styles.muted}>
        Added by {video.addedBy} · {formatDate(video.addedAt)}
      </p>
    </>
  );
}
