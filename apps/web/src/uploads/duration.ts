import type { MediaKind } from './limits';

const TIMEOUT_MS = 10_000;

// The length is read by the browser from the file's own header; it is only shown to people, never trusted.
export function readDuration(file: File, kind: MediaKind): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    media.preload = 'metadata';
    const finish = (seconds: number | null): void => {
      clearTimeout(timer);
      media.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    // Some files report no usable length (NaN or Infinity); that is shown as unknown.
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? Math.round(media.duration) : null);
    media.onerror = () => finish(null);
    media.src = url;
  });
}
