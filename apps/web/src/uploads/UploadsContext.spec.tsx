import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpload } from '../api/media';
import type { MockResponse } from '../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../test/session';
import { FileMismatchError, UploadsProvider, useUploads } from './UploadsContext';
import * as xhr from './xhr';

vi.mock('./xhr', async (importOriginal) => ({ ...(await importOriginal<typeof import('./xhr')>()), sendPiece: vi.fn() }));
const sendPiece = vi.mocked(xhr.sendPiece);

const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
const cover = new File(['png'], 'cover.png', { type: 'image/png' });
const started = { itemId: 'v1', fileId: 'u1', partSize: 4, partCount: 3 };

type Handler = (body: Record<string, unknown>) => MockResponse;

function startServer(overrides: Record<string, Handler | MockResponse> = {}) {
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'POST /api/media/uploads') return { status: 201, body: started };
    const urls = /^POST \/api\/media\/uploads\/u1\/part-urls$/.exec(key);
    if (urls) return { body: { urls: { [String((body.partNumbers as number[])[0])]: `https://storage.test/p${(body.partNumbers as number[])[0]}` } } };
    if (key === 'POST /api/media/uploads/u1/complete') return { body: { id: 'v1', status: 'ready' } };
    if (key === 'DELETE /api/media/uploads/u1') return { status: 204 };
    return { status: 404, body: {} };
  });
  return calls;
}

let value: ReturnType<typeof useUploads>;
function Probe() {
  value = useUploads();
  return (
    <ul>
      {value.jobs.map((job) => (
        <li key={job.id}>{`${job.title}:${job.status}:${job.bytesSent}:${job.coverWarning}:${job.message ?? ''}`}</li>
      ))}
      <li>{`finished:${value.finishedCount}`}</li>
    </ul>
  );
}

const input = { file, folderId: 'f1', title: 'Fire exits', description: '', durationSeconds: 12, cover: null };

function setup() {
  return renderWithSession(
    <UploadsProvider>
      <Probe />
    </UploadsProvider>,
  );
}

describe('UploadsProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sendPiece.mockReset();
    sendPiece.mockImplementation(async (url, body, onProgress) => {
      onProgress(body.size);
      return `"etag-${url.at(-1)}"`;
    });
  });

  it('starts an upload, sends every piece with a fresh link, completes with the receipts and reports it finished', async () => {
    const calls = startServer();
    setup();
    await act(() => value.start(input));
    expect(calls.find((call) => call.key === 'POST /api/media/uploads')?.body).toMatchObject({
      folderId: 'f1',
      title: 'Fire exits',
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10,
      durationSeconds: 12,
    });
    expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
    expect(screen.getByText('finished:1')).toBeInTheDocument();
    expect(sendPiece).toHaveBeenCalledTimes(3);
    const sizes = sendPiece.mock.calls.map(([, body]) => body.size).sort();
    expect(sizes).toEqual([2, 4, 4]);
    expect(calls.find((call) => call.key === 'POST /api/media/uploads/u1/complete')?.body).toEqual({
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ],
    });
  });

  it('refuses to start when the server refuses, and records no job', async () => {
    startServer({ 'POST /api/media/uploads': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Enter a title.'] } } } });
    setup();
    await expect(act(() => value.start(input))).rejects.toMatchObject({ status: 400 });
    expect(value.jobs).toEqual([]);
  });

  it('uploads the cover first and still finishes the video if the cover fails', async () => {
    const calls = startServer({ 'POST /api/media/items/v1/cover': { status: 422, body: { message: 'Covers can be at most 10 MB.' } } });
    setup();
    await act(() => value.start({ ...input, cover }));
    expect(await screen.findByText('Fire exits:done:10:true:')).toBeInTheDocument();
    expect(calls.findIndex((call) => call.key === 'POST /api/media/items/v1/cover')).toBeLessThan(calls.findIndex((call) => call.key === 'POST /api/media/uploads/u1/complete'));
  });

  it('shows the server\'s explanation when finishing is refused, and keeps the job so it can be dismissed', async () => {
    startServer({ 'POST /api/media/uploads/u1/complete': { status: 422, body: { message: 'That file is not a valid MP4 video, so it was discarded.' } } });
    setup();
    await act(() => value.start(input));
    expect(await screen.findByText(/failed:.*not a valid MP4/)).toBeInTheDocument();
    expect(screen.getByText('finished:0')).toBeInTheDocument();
    act(() => value.dismiss('u1'));
    expect(screen.queryByText(/Fire exits/)).toBeNull();
  });

  it('cancels a running upload: stops sending and removes the upload on the server', async () => {
    const calls = startServer();
    sendPiece.mockImplementation((_url, _body, _progress, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    setup();
    await act(() => value.start(input));
    await screen.findByText(/Fire exits:sending/);
    await act(() => value.cancel('u1'));
    expect(calls.some((call) => call.key === 'DELETE /api/media/uploads/u1')).toBe(true);
    expect(screen.queryByText(/Fire exits/)).toBeNull();
    expect(calls.some((call) => call.key === 'POST /api/media/uploads/u1/complete')).toBe(false);
  });

  it('keeps a running upload in the panel as failed when the server refuses to cancel it', async () => {
    startServer({ 'DELETE /api/media/uploads/u1': { status: 500, body: {} } });
    sendPiece.mockImplementation((_url, _body, _progress, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    setup();
    await act(() => value.start(input));
    await screen.findByText(/Fire exits:sending/);
    await act(() => value.cancel('u1'));
    expect(await screen.findByText(/Fire exits:failed:.*Something went wrong/)).toBeInTheDocument();
  });

  it('tells the caller when the server refuses to cancel an upload that is not in the panel', async () => {
    startServer({ 'DELETE /api/media/uploads/u9': { status: 500, body: {} } });
    setup();
    await expect(act(() => value.cancel('u9'))).rejects.toThrow('Something went wrong');
    expect(value.jobs).toEqual([]);
  });

  it('warns before the tab is closed while sending, and stops warning afterwards', async () => {
    startServer();
    // The server announces three pieces, so three pieces are in flight at once; each is released separately.
    const releases: Array<(etag: string) => void> = [];
    sendPiece.mockImplementation(() => new Promise<string>((resolve) => releases.push(resolve)));
    setup();
    await act(() => value.start({ ...input, file: new File([new Uint8Array(3)], 'clip.mp4', { type: 'video/mp4' }) }));
    await waitFor(() => expect(releases).toHaveLength(3));
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    await act(async () => releases.forEach((release) => release('"e"')));
    await screen.findByText(/Fire exits:done/);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  describe('resuming', () => {
    const pending: PendingUpload = { fileId: 'u1', itemId: 'v1', folderId: 'f1', title: 'Fire exits', fileName: 'clip.mp4', sizeBytes: 10, createdAt: '2026-10-08T10:00:00Z' };

    it('refuses a different file and says which one is needed', async () => {
      startServer();
      setup();
      await expect(act(() => value.resume(pending, new File(['x'], 'other.mp4', { type: 'video/mp4' })))).rejects.toBeInstanceOf(FileMismatchError);
      await expect(act(() => value.resume(pending, new File([new Uint8Array(11)], 'clip.mp4', { type: 'video/mp4' })))).rejects.toThrow(/clip\.mp4/);
    });

    it.each([
      ['a narrow no-break space', 'Screen Recording 10.00.00\u202fAM.mp4', 'Screen Recording 10.00.00 AM.mp4'],
      ['a double space', 'My  talk.mp4', 'My talk.mp4'],
    ])('accepts the same file when its name differs only by %s that the server tidied', async (_label, rawName, storedName) => {
      const calls = startServer({
        'GET /api/media/uploads/u1': {
          body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [] },
        },
      });
      setup();
      await act(() => value.resume({ ...pending, fileName: storedName }, new File([new Uint8Array(10)], rawName, { type: 'video/mp4' })));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(calls.some((call) => call.key === 'POST /api/media/uploads/u1/complete')).toBe(true);
    });

    it('still refuses a name that differs after tidying, and shows the stored name', async () => {
      startServer();
      setup();
      const stored = { ...pending, fileName: 'My talk.mp4' };
      await expect(act(() => value.resume(stored, new File([new Uint8Array(10)], 'My  other talk.mp4', { type: 'video/mp4' })))).rejects.toThrow(/"My talk\.mp4"/);
    });

    it('sends only the missing pieces and completes with the stored receipts as well', async () => {
      const calls = startServer({
        'GET /api/media/uploads/u1': {
          body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [{ partNumber: 1, size: 4, etag: '"old-1"' }, { partNumber: 3, size: 2, etag: '"old-3"' }] },
        },
      });
      setup();
      await act(() => value.resume(pending, file));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(sendPiece).toHaveBeenCalledTimes(1);
      expect(calls.find((call) => call.key === 'POST /api/media/uploads/u1/complete')?.body).toEqual({
        parts: [
          { partNumber: 1, etag: '"old-1"' },
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 3, etag: '"old-3"' },
        ],
      });
    });

    it('lets Try again continue a failed upload from what the server holds', async () => {
      let attempt = 0;
      const calls = startServer({
        'POST /api/media/uploads/u1/complete': () => (++attempt === 1 ? { status: 500, body: {} } : { body: { id: 'v1', status: 'ready' } }),
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [{ partNumber: 1, size: 4, etag: '"s1"' }, { partNumber: 2, size: 4, etag: '"s2"' }, { partNumber: 3, size: 2, etag: '"s3"' }] } },
      });
      setup();
      await act(() => value.start(input));
      await screen.findByText(/Fire exits:failed/);
      sendPiece.mockClear();
      await act(() => value.retry('u1'));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(sendPiece).not.toHaveBeenCalled();
      expect(calls.filter((call) => call.key === 'POST /api/media/uploads/u1/complete')).toHaveLength(2);
    });

    it('starts only one run when Try again is pressed twice before the server has answered', async () => {
      let attempt = 0;
      const calls = startServer({
        'POST /api/media/uploads/u1/complete': () => (++attempt === 1 ? { status: 500, body: {} } : { body: { id: 'v1', status: 'ready' } }),
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [{ partNumber: 1, size: 4, etag: '"s1"' }, { partNumber: 2, size: 4, etag: '"s2"' }, { partNumber: 3, size: 2, etag: '"s3"' }] } },
      });
      setup();
      await act(() => value.start(input));
      await screen.findByText(/Fire exits:failed/);
      await act(async () => {
        await Promise.all([value.retry('u1'), value.retry('u1')]);
      });
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(calls.filter((call) => call.key === 'GET /api/media/uploads/u1')).toHaveLength(1);
      expect(calls.filter((call) => call.key === 'POST /api/media/uploads/u1/complete')).toHaveLength(2);
      expect(screen.getByText('finished:1')).toBeInTheDocument();
    });

    it('does not send anything again when Try again finds the server already finished the video', async () => {
      let attempt = 0;
      const calls = startServer({
        'POST /api/media/uploads/u1/complete': () => (++attempt === 1 ? { status: 500, body: {} } : { body: { id: 'v1', status: 'ready' } }),
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'ready', partSize: 4, partCount: 3, uploadedParts: [] } },
      });
      setup();
      await act(() => value.start(input));
      await screen.findByText(/Fire exits:failed/);
      sendPiece.mockClear();
      await act(() => value.retry('u1'));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(screen.getByText('finished:1')).toBeInTheDocument();
      expect(sendPiece).not.toHaveBeenCalled();
      expect(calls.filter((call) => call.key === 'POST /api/media/uploads/u1/complete')).toHaveLength(1);
    });

    it('keeps the cover warning when a failed upload is tried again', async () => {
      let attempt = 0;
      startServer({
        'POST /api/media/items/v1/cover': { status: 422, body: { message: 'Covers can be at most 10 MB.' } },
        'POST /api/media/uploads/u1/complete': () => (++attempt === 1 ? { status: 500, body: {} } : { body: { id: 'v1', status: 'ready' } }),
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [] } },
      });
      setup();
      await act(() => value.start({ ...input, cover }));
      await screen.findByText(/Fire exits:failed:10:true/);
      await act(() => value.retry('u1'));
      expect(await screen.findByText('Fire exits:done:10:true:')).toBeInTheDocument();
    });
  });

  it('keeps showing a finished upload until it is dismissed', async () => {
    startServer();
    setup();
    await act(() => value.start(input));
    await screen.findByText(/Fire exits:done/);
    await userEvent.click(document.body);
    expect(screen.getByText(/Fire exits:done/)).toBeInTheDocument();
  });
});
