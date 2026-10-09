import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import {
  cancelUpload,
  completeUpload,
  getUploadStatus,
  type PendingUpload,
  startUpload,
  type UploadStatus as ServerUploadStatus,
  uploadCover,
} from '../api/media';
import { formatBytes } from '../lib/format';
import { createBrowserDeps } from './browser-deps';
import { describeUploadError } from './describe-upload-error';
import { uploadPieces } from './engine';

export type UploadStatus = 'sending' | 'finishing' | 'done' | 'failed';

export interface UploadJob {
  id: string;
  itemId: string;
  folderId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  bytesSent: number;
  status: UploadStatus;
  message: string | null;
  coverWarning: boolean;
}

export interface StartInput {
  file: File;
  folderId: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  cover: File | null;
}

export interface UploadsValue {
  jobs: UploadJob[];
  // Goes up by one each time a video finishes, so pages showing videos know to reload.
  finishedCount: number;
  start: (input: StartInput) => Promise<void>;
  resume: (pending: PendingUpload, file: File) => Promise<void>;
  retry: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
}

export class FileMismatchError extends Error {
  constructor(pending: PendingUpload) {
    super(`Choose the same file you started with: "${pending.fileName}" (${formatBytes(pending.sizeBytes)}).`);
  }
}

export const UploadsContext = createContext<UploadsValue | null>(null);

export function useUploads(): UploadsValue {
  const value = useContext(UploadsContext);
  if (!value) throw new Error('useUploads must be used inside UploadsProvider');
  return value;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 5;
const PAINT_INTERVAL_MS = 200;

interface Source {
  file: File;
  itemId: string;
  partSize: number;
  partCount: number;
}

// Lives for as long as the person is signed in and the app is open, so uploads keep going while they browse
// other pages. A page reload ends them; the folder page then offers to resume (see PendingUploads).
export function UploadsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [finishedCount, setFinishedCount] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const sources = useRef(new Map<string, Source>());
  const lastPaint = useRef(new Map<string, number>());
  // Uploads being resumed or retried: asking the server for their state takes a moment, and a second press of
  // Try again in that moment must not start a second run of the same upload.
  const resuming = useRef(new Set<string>());

  const patch = useCallback((id: string, changes: Partial<UploadJob>) => {
    setJobs((list) => list.map((job) => (job.id === id ? { ...job, ...changes } : job)));
  }, []);

  // Progress events arrive many times a second; painting them all would only make the page work harder.
  const paint = useCallback(
    (id: string, sent: number, total: number) => {
      const now = Date.now();
      if (sent < total && now - (lastPaint.current.get(id) ?? 0) < PAINT_INTERVAL_MS) return;
      lastPaint.current.set(id, now);
      patch(id, { bytesSent: sent });
    },
    [patch],
  );

  const run = useCallback(
    async (id: string, already: Map<number, string>, cover: File | null) => {
      const source = sources.current.get(id);
      if (!source) return;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      patch(id, { status: 'sending', message: null });
      try {
        if (cover) {
          try {
            await uploadCover(source.itemId, cover);
          } catch {
            patch(id, { coverWarning: true });
          }
        }
        const receipts = await uploadPieces(
          {
            file: source.file,
            partSize: source.partSize,
            partCount: source.partCount,
            already,
            concurrency: CONCURRENCY,
            maxAttempts: MAX_ATTEMPTS,
            signal: controller.signal,
            onProgress: (sent) => paint(id, sent, source.file.size),
          },
          createBrowserDeps(id),
        );
        patch(id, { status: 'finishing', bytesSent: source.file.size });
        await completeUpload(id, receipts);
        patch(id, { status: 'done', bytesSent: source.file.size });
        sources.current.delete(id);
        setFinishedCount((count) => count + 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(id, { status: 'failed', message: describeUploadError(error) });
      } finally {
        controllers.current.delete(id);
        lastPaint.current.delete(id);
      }
    },
    [patch, paint],
  );

  // Starts (or restarts) sending from whatever the server already holds.
  const begin = useCallback(
    (pending: Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'title' | 'fileName' | 'sizeBytes'>, file: File, status: ServerUploadStatus) => {
      sources.current.set(pending.fileId, { file, itemId: pending.itemId, partSize: status.partSize, partCount: status.partCount });
      const bytesSent = status.uploadedParts.reduce((sum, part) => sum + part.size, 0);
      const job: UploadJob = {
        id: pending.fileId,
        itemId: pending.itemId,
        folderId: pending.folderId,
        title: pending.title,
        fileName: pending.fileName,
        sizeBytes: pending.sizeBytes,
        bytesSent,
        status: 'sending',
        message: null,
        coverWarning: false,
      };
      setJobs((list) => [
        ...list.filter((existing) => existing.id !== pending.fileId),
        { ...job, coverWarning: list.find((existing) => existing.id === pending.fileId)?.coverWarning ?? false },
      ]);
      void run(pending.fileId, new Map(status.uploadedParts.map((part) => [part.partNumber, part.etag])), null);
    },
    [run],
  );

  const start = useCallback(
    async (input: StartInput) => {
      const created = await startUpload({
        folderId: input.folderId,
        title: input.title,
        description: input.description,
        fileName: input.file.name,
        contentType: 'video/mp4',
        sizeBytes: input.file.size,
        durationSeconds: input.durationSeconds,
      });
      sources.current.set(created.fileId, { file: input.file, itemId: created.itemId, partSize: created.partSize, partCount: created.partCount });
      setJobs((list) => [
        ...list,
        {
          id: created.fileId,
          itemId: created.itemId,
          folderId: input.folderId,
          title: input.title.trim(),
          fileName: input.file.name,
          sizeBytes: input.file.size,
          bytesSent: 0,
          status: 'sending',
          message: null,
          coverWarning: false,
        },
      ]);
      void run(created.fileId, new Map(), input.cover);
    },
    [run],
  );

  // Resumes or retries from what the server holds. An upload the server already finished only needs to be shown as done.
  const continueFromServer = useCallback(
    async (pending: Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'title' | 'fileName' | 'sizeBytes'>, file: File) => {
      const status = await getUploadStatus(pending.fileId);
      if (status.status === 'ready') {
        sources.current.delete(pending.fileId);
        patch(pending.fileId, { status: 'done', message: null, bytesSent: pending.sizeBytes });
        setFinishedCount((count) => count + 1);
        return;
      }
      begin(pending, file, status);
    },
    [begin, patch],
  );

  const resume = useCallback(
    async (pending: PendingUpload, file: File) => {
      if (file.name !== pending.fileName || file.size !== pending.sizeBytes) throw new FileMismatchError(pending);
      if (controllers.current.has(pending.fileId) || resuming.current.has(pending.fileId)) return;
      resuming.current.add(pending.fileId);
      try {
        await continueFromServer(pending, file);
      } finally {
        resuming.current.delete(pending.fileId);
      }
    },
    [continueFromServer],
  );

  const retry = useCallback(
    async (id: string) => {
      const source = sources.current.get(id);
      const job = jobs.find((candidate) => candidate.id === id);
      if (!source || !job || controllers.current.has(id) || resuming.current.has(id)) return;
      resuming.current.add(id);
      try {
        await continueFromServer({ fileId: id, itemId: job.itemId, folderId: job.folderId, title: job.title, fileName: job.fileName, sizeBytes: job.sizeBytes }, source.file);
      } catch (error) {
        patch(id, { status: 'failed', message: describeUploadError(error) });
      } finally {
        resuming.current.delete(id);
      }
    },
    [continueFromServer, jobs, patch],
  );

  const cancel = useCallback(
    async (id: string) => {
      controllers.current.get(id)?.abort();
      try {
        await cancelUpload(id);
      } catch (error) {
        // Already gone on the server is the outcome we wanted.
        if (!(error instanceof ApiError && error.status === 404)) {
          patch(id, { status: 'failed', message: describeUploadError(error) });
          return;
        }
      }
      sources.current.delete(id);
      setJobs((list) => list.filter((job) => job.id !== id));
    },
    [patch],
  );

  const dismiss = useCallback((id: string) => {
    sources.current.delete(id);
    setJobs((list) => list.filter((job) => job.id !== id || (job.status !== 'done' && job.status !== 'failed')));
  }, []);

  // Leaving (signing out) stops everything still being sent.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const active = jobs.some((job) => job.status === 'sending' || job.status === 'finishing');
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const value = useMemo(
    () => ({ jobs, finishedCount, start, resume, retry, cancel, dismiss }),
    [jobs, finishedCount, start, resume, retry, cancel, dismiss],
  );
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}
