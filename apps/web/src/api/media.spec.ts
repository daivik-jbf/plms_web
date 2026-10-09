import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { ApiError } from './client';
import {
  cancelUpload,
  completeUpload,
  createFolder,
  getPartUrls,
  getUploadStatus,
  listFolders,
  listItems,
  listMyUploads,
  playItem,
  renameFolder,
  reorderFolders,
  reorderItems,
  startUpload,
  updateItem,
  uploadCover,
} from './media';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function record(responses: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const method = init.method ?? 'GET';
    calls.push({
      method,
      url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const key = `${method} ${url}`;
    return key in responses ? { body: responses[key] } : { status: 204 };
  });
  return calls;
}

describe('media api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the folder endpoints', async () => {
    const calls = record({ 'GET /api/media/videos/folders': [], 'POST /api/media/videos/folders': { id: 'f1' } });
    await listFolders();
    await createFolder('Safety');
    await renameFolder('f1', 'Safe');
    await reorderFolders(['b', 'a']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/media/videos/folders',
      'POST /api/media/videos/folders',
      'PATCH /api/media/folders/f1',
      'PUT /api/media/videos/folders/order',
    ]);
    expect(calls[1]?.body).toEqual({ name: 'Safety' });
    expect(calls[2]?.body).toEqual({ name: 'Safe' });
    expect(calls[3]?.body).toEqual({ ids: ['b', 'a'] });
  });

  it('talks to the video endpoints', async () => {
    const calls = record();
    await listItems('f1');
    await updateItem('v1', { title: 'New' });
    await reorderItems('f1', ['v2', 'v1']);
    await playItem('v1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/media/folders/f1/items',
      'PATCH /api/media/items/v1',
      'PUT /api/media/folders/f1/items/order',
      'POST /api/media/items/v1/play',
    ]);
    expect(calls[1]?.body).toEqual({ title: 'New' });
    expect(calls[2]?.body).toEqual({ ids: ['v2', 'v1'] });
  });

  it('talks to the upload endpoints', async () => {
    const calls = record();
    await startUpload({ folderId: 'f1', title: 'T', description: '', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 5, durationSeconds: null });
    await getPartUrls('u1', [1, 2]);
    await getUploadStatus('u1');
    await completeUpload('u1', [{ partNumber: 1, etag: '"a"' }]);
    await cancelUpload('u1');
    await listMyUploads();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/media/uploads',
      'POST /api/media/uploads/u1/part-urls',
      'GET /api/media/uploads/u1',
      'POST /api/media/uploads/u1/complete',
      'DELETE /api/media/uploads/u1',
      'GET /api/media/uploads/mine',
    ]);
    expect(calls[0]?.body).toMatchObject({ contentType: 'video/mp4', sizeBytes: 5, durationSeconds: null });
    expect(calls[1]?.body).toEqual({ partNumbers: [1, 2] });
    expect(calls[3]?.body).toEqual({ parts: [{ partNumber: 1, etag: '"a"' }] });
  });

  it('uploads a cover in three steps and sends the file straight to the returned link without the sign-in header', async () => {
    const cover = new File(['png'], 'cover.png', { type: 'image/png' });
    const calls = record({
      'POST /api/media/items/v1/cover': { fileId: 'c1', url: 'https://bucket.example/covers/x?sig=1', headers: { 'Content-Type': 'image/png' } },
      'POST /api/media/items/v1/cover/c1/complete': { id: 'v1' },
    });
    await uploadCover('v1', cover);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/media/items/v1/cover',
      'PUT https://bucket.example/covers/x?sig=1',
      'POST /api/media/items/v1/cover/c1/complete',
    ]);
    expect(calls[0]?.body).toEqual({ contentType: 'image/png', sizeBytes: cover.size });
    expect(calls[1]?.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(calls[1]?.body).toBe(cover);
  });

  it('stops without completing when the storage refuses the cover', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url === '/api/media/items/v1/cover') return { body: { fileId: 'c1', url: 'https://bucket.example/x', headers: { 'Content-Type': 'image/png' } } };
      return { status: 403, body: {} };
    });
    await expect(uploadCover('v1', new File(['x'], 'c.png', { type: 'image/png' }))).rejects.toBeInstanceOf(ApiError);
    expect(calls).toEqual(['POST /api/media/items/v1/cover', 'PUT https://bucket.example/x']);
  });
});
