import { getPartUrls } from '../api/media';
import type { EngineDeps } from './engine';
import { sendPiece } from './xhr';

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onOnline = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      window.removeEventListener('online', onOnline);
      reject(abortError());
    };
    window.addEventListener('online', onOnline, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createBrowserDeps(fileId: string): EngineDeps {
  return {
    getPartUrl: async (partNumber) => {
      const { urls } = await getPartUrls(fileId, [partNumber]);
      const url = urls[String(partNumber)];
      if (!url) throw new Error(`The server returned no link for piece ${partNumber}`);
      return url;
    },
    sendPart: sendPiece,
    sleep,
    isOnline: () => navigator.onLine,
    waitForOnline,
  };
}
