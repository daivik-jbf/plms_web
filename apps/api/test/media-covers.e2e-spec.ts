import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { StorageError } from '../src/storage/storage.port';
import { MAX_COVER_BYTES } from '../src/storage/storage.constants';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { jpegBytes, mp4Bytes, pngBytes, seedFolder, seedItem, signIn, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('cover images', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    return { owner, other, folder, item };
  }

  const startCover = (session: Parameters<typeof bearer>[0], itemId: string, body: object) =>
    http().post(`/api/media/items/${itemId}/cover`).set(...bearer(session)).send(body);
  const completeCover = (session: Parameters<typeof bearer>[0], itemId: string, fileId: string) =>
    http().post(`/api/media/items/${itemId}/cover/${fileId}/complete`).set(...bearer(session));

  it('needs a signed-in person', async () => {
    const { item } = await setup();
    await http().post(`/api/media/items/${item.itemId}/cover`).send({}).expect(401);
    await http().post(`/api/media/items/${item.itemId}/cover/${item.fileId}/complete`).expect(401);
  });

  it('sets a cover end to end and shows it as a link in the list', async () => {
    const { owner, other, folder, item } = await setup();
    const body = pngBytes(200);
    const started = await startCover(other.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length }).expect(201);
    expect(started.body).toEqual({ fileId: expect.any(String), url: expect.stringMatching(/^memory:\/\/put\//), headers: { 'Content-Type': 'image/png' } });
    storage.putObject(started.body.url, body);
    const done = await completeCover(other.session, item.itemId, started.body.fileId).expect(200);
    expect(done.body.coverUrl).toMatch(/^memory:\/\/get\//);
    expect((await fileRow(started.body.fileId)).status).toBe('ready');
    const [entry] = await auditFor('content.video.cover_set', item.itemId);
    expect(entry.actorId).toBe(other.user.id);
    expect(JSON.stringify(entry)).not.toMatch(/covers\/|memory:/);
    const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(list.body.find((candidate: { id: string }) => candidate.id === item.itemId).coverUrl).toMatch(/^memory:\/\/get\//);
  });

  it.each([
    ['image/jpeg', jpegBytes],
    ['image/webp', webpBytes],
  ] as const)('accepts %s', async (contentType, make) => {
    const { owner, item } = await setup();
    const body = make(100);
    const started = await startCover(owner.session, item.itemId, { contentType, sizeBytes: body.length }).expect(201);
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
  });

  it('replaces an earlier cover and removes the old file', async () => {
    const { owner, item } = await setup();
    const put = async (bytes: Uint8Array) => {
      const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: bytes.length });
      storage.putObject(started.body.url, bytes);
      await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
      return started.body.fileId as string;
    };
    const first = await put(pngBytes(100));
    const firstKey = (await fileRow(first)).storageKey;
    const second = await put(pngBytes(120));
    expect(await fileRow(first)).toBeUndefined();
    expect(storage.has(firstKey)).toBe(false);
    expect((await db.select().from(mediaItems).where(eq(mediaItems.id, item.itemId)))[0].coverFileId).toBe(second);
  });

  it('is safe to complete twice', async () => {
    const { owner, item } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    expect(await auditFor('content.video.cover_set', item.itemId)).toHaveLength(1);
  });

  it.each([
    ['an unsupported type', { contentType: 'image/gif', sizeBytes: 10 }],
    ['an empty file', { contentType: 'image/png', sizeBytes: 0 }],
    ['a file over 10 MB', { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES + 1 }],
    ['a fractional size', { contentType: 'image/png', sizeBytes: 1.5 }],
    ['no type', { sizeBytes: 10 }],
  ])('refuses %s when starting', async (_name, body) => {
    const { owner, item } = await setup();
    await startCover(owner.session, item.itemId, body).expect(400);
  });

  it('accepts exactly 10 MB when starting', async () => {
    const { owner, item } = await setup();
    await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES }).expect(201);
  });

  it('discards a cover whose bytes are not the declared image type', async () => {
    const { owner, item } = await setup();
    const body = mp4Bytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    const key = (await fileRow(started.body.fileId)).storageKey;
    storage.putObject(started.body.url, body);
    const res = await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/JPEG, PNG or WebP/);
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await auditFor('file.upload_failed', item.itemId))[0].metadata).toMatchObject({ reason: 'bad_image' });
  });

  it('discards a cover whose size differs from the declared size', async () => {
    const { owner, item } = await setup();
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: 500 });
    storage.putObject(started.body.url, pngBytes(100));
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect((await auditFor('file.upload_failed', item.itemId))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
  });

  it('asks the browser to try again when nothing was uploaded yet, and keeps the file', async () => {
    const { owner, item } = await setup();
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: 10 });
    const res = await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/not been uploaded/i);
    expect((await fileRow(started.body.fileId)).status).toBe('pending');
  });

  it('treats an object that vanishes between the size check and the read as not uploaded yet', async () => {
    const { owner, item } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    const spy = jest.spyOn(storage, 'readRange').mockRejectedValueOnce(new StorageError('not_found', 'No such object.'));
    try {
      const res = await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
      expect(res.body.message).toMatch(/not been uploaded/i);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect((await fileRow(started.body.fileId)).status).toBe('pending');
    expect(await auditFor('file.upload_failed', item.itemId)).toHaveLength(0);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
  });

  it('is limited to the uploader of the cover (or an Admin), and to videos you can see', async () => {
    const { owner, other, item } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(other.session, item.itemId, started.body.fileId).expect(403);
    const admin = await signIn(app, db, 'admin');
    await completeCover(admin.session, item.itemId, started.body.fileId).expect(200);

    const hidden = await seedItem(db, { folderId: (await seedFolder(db, owner.user.id)).id, createdBy: owner.user.id, status: 'uploading' });
    await startCover(other.session, hidden.itemId, { contentType: 'image/png', sizeBytes: 5 }).expect(404);
    await startCover(owner.session, hidden.itemId, { contentType: 'image/png', sizeBytes: 5 }).expect(201);
    await completeCover(owner.session, item.itemId, '00000000-0000-4000-8000-000000000000').expect(404);
    await completeCover(owner.session, 'nope', started.body.fileId).expect(400);
  });

  it('will not attach one cover file to a second video', async () => {
    const { owner, folder, item } = await setup();
    const second = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    await completeCover(owner.session, second.itemId, started.body.fileId).expect(409);
  });

  it('refuses a video file id in place of a cover file id', async () => {
    const { owner, item } = await setup();
    await completeCover(owner.session, item.itemId, item.fileId).expect(404);
  });
});
