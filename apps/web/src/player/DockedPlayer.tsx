import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../api/client';
import { playItem } from '../api/media';
import { Button } from '../components/Button';
import { formatDuration } from '../lib/format';
import styles from './DockedPlayer.module.css';
import { type PlayerSession, usePlayer } from './PlayerContext';

const PLAYBACK_FAILED = 'This could not be played. Please try again later.';

const clock = (seconds: number | null): string => formatDuration(seconds === null ? null : Math.floor(seconds));

export function DockedPlayer() {
  const { session, close } = usePlayer();
  if (!session) return null;
  // A new start is a new bar: fresh state, a fresh audio element and exactly one new link.
  return <PlayerBar key={session.id} session={session} onClose={close} />;
}

function PlayerBar({ session, onClose }: { session: PlayerSession; onClose: () => void }) {
  const { track } = session;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Every link handed out is recorded in the audit log, so the development double-run of effects (StrictMode) must not
  // ask twice for the same start.
  const requested = useRef(false);
  const retried = useRef(false);
  const resumeAt = useRef(0);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await playItem(track.itemId)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [track.itemId]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void fetchLink();
  }, [fetchLink]);

  // Stops the sound when the bar goes away: Close, another track replacing this one, or signing out.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  function syncDuration() {
    const value = audioRef.current?.duration ?? Number.NaN;
    // Some files report no usable length (NaN, Infinity or 0): the slider then stays off.
    setDuration(Number.isFinite(value) && value > 0 ? value : null);
  }

  function onLoadedMetadata() {
    syncDuration();
    const audio = audioRef.current;
    if (!audio || resumeAt.current <= 0) return;
    audio.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void audio.play().catch(() => undefined);
  }

  // The link lasts one hour. If the audio stops loading (for example the link expired during a long pause) ask once for
  // a new link and carry on from the same position; a second failure in a row is shown with Try again.
  function onMediaError() {
    if (retried.current) {
      setSrc(null);
      setError(PLAYBACK_FAILED);
      return;
    }
    retried.current = true;
    resumeAt.current = audioRef.current?.currentTime ?? 0;
    void fetchLink();
  }

  // One track at a time: at the end the bar stays on it, back at the start, with Play to hear it again.
  function onEnded() {
    const audio = audioRef.current;
    setPlaying(false);
    if (audio) audio.currentTime = 0;
    setPosition(0);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => undefined);
  }

  function onSeek(event: ChangeEvent<HTMLInputElement>) {
    const to = Number(event.target.value);
    if (audioRef.current) audioRef.current.currentTime = to;
    setPosition(to);
  }

  function onVolume(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const level = Number(event.target.value);
    audio.volume = level;
    audio.muted = level === 0;
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (audio) audio.muted = !audio.muted;
  }

  function onVolumeChange() {
    const audio = audioRef.current;
    if (!audio) return;
    setVolume(audio.volume);
    setMuted(audio.muted);
  }

  function tryAgain() {
    retried.current = false;
    setError(null);
    void fetchLink();
  }

  const level = muted ? 0 : volume;

  return (
    <section className={styles.bar} aria-label="Player">
      <audio
        ref={audioRef}
        src={src ?? undefined}
        autoPlay
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={syncDuration}
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onPlaying={() => {
          retried.current = false;
        }}
        onEnded={onEnded}
        onError={onMediaError}
        onVolumeChange={onVolumeChange}
      />
      <div className={styles.info}>
        {track.coverUrl ? (
          <img className={styles.cover} src={track.coverUrl} alt="" />
        ) : (
          <span className={styles.glyph} aria-hidden="true">
            ♪
          </span>
        )}
        <div className={styles.text}>
          <p className={styles.title}>{track.title}</p>
          <p className={styles.place}>{`${track.categoryLabel} › ${track.folderName}`}</p>
        </div>
      </div>
      <div className={styles.transport}>
        {error ? (
          <>
            <p className={styles.error} role="alert">
              {error}
            </p>
            <Button variant="secondary" size="small" onClick={tryAgain}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button size="small" disabled={src === null} onClick={togglePlay}>
              {playing ? 'Pause' : 'Play'}
            </Button>
            <span className={styles.time}>{clock(position)}</span>
            <input
              className={styles.seek}
              type="range"
              aria-label="Seek"
              min={0}
              max={duration === null ? 0 : Math.floor(duration)}
              step={1}
              value={Math.floor(position)}
              disabled={duration === null}
              aria-valuetext={`${clock(position)} of ${clock(duration)}`}
              onChange={onSeek}
            />
            <span className={styles.time}>{clock(duration)}</span>
          </>
        )}
      </div>
      <div className={styles.volume}>
        <Button variant="secondary" size="small" aria-pressed={muted} onClick={toggleMute}>
          Mute
        </Button>
        <input
          className={styles.level}
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={level}
          aria-valuetext={`${Math.round(level * 100)}%`}
          onChange={onVolume}
        />
      </div>
      <div className={styles.close}>
        <Button variant="secondary" size="small" aria-label="Close player" onClick={onClose}>
          ✕
        </Button>
      </div>
    </section>
  );
}
