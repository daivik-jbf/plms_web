import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { attachCoverViaApi, completeViaApi, mp4Bytes, pngBytes, putPieces, seedFolder, seedItem, signIn, startUploadViaApi, uploadVideo } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('cleaning up abandoned uploads', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;
  let cleanup: UploadCleanupService;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
    cleanup = app.get(UploadCleanupService);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const age = (fileId: string, hours: number) =>
    db.update(files).set({ createdAt: new Date(Date.now() - hours * HOUR) }).where(eq(files.id, fileId));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    return { owner, folder };
  }

  it('removes a pending upload older than 24 hours, aborts it in storage and records why', async () => {
    const { owner, folder } = await setup();
    const started = await startUploadViaApi(app, owner.session, folder.id);
    await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(100));
    await age(started.fileId, 25);
    const pending = storage.pendingUploadCount();

    const result = await cleanup.run();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(await itemRow(started.itemId)).toBeUndefined();
    expect(storage.pendingUploadCount()).toBe(pending - 1);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'file.upload_failed'), eq(auditLog.targetId, started.itemId)));
    expect(entry).toMatchObject({ actorId: null, metadata: expect.objectContaining({ reason: 'expired' }) });
  });

  it('removes the cover attached to an abandoned upload too, and records the expiry without any storage key', async () => {
    const { owner, folder } = await setup();
    const started = await startUploadViaApi(app, owner.session, folder.id);
    const coverId = await attachCoverViaApi(app, storage, owner.session, started.itemId);
    const coverKey = (await fileRow(coverId)).storageKey;
    expect(storage.has(coverKey)).toBe(true);
    await age(started.fileId, 25);

    await cleanup.run();
    expect(await itemRow(started.itemId)).toBeUndefined();
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(await fileRow(coverId)).toBeUndefined();
    expect(storage.has(coverKey)).toBe(false);
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.action, 'file.upload_failed'), eq(auditLog.targetId, started.itemId)));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, metadata: { fileId: started.fileId, reason: 'expired' } });
    expect(JSON.stringify(entries[0])).not.toMatch(/covers\/|videos\/|memory:/);
  });

  it('never touches the cover of a ready video', async () => {
    const { owner, folder } = await setup();
    const { itemId, fileId, coverFileId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage, withCover: true });
    const coverKey = (await fileRow(coverFileId as string)).storageKey;
    await age(fileId, 500);
    await age(coverFileId as string, 500);

    await cleanup.run();
    expect((await itemRow(itemId)).coverFileId).toBe(coverFileId);
    expect((await fileRow(coverFileId as string)).status).toBe('ready');
    expect(storage.has(coverKey)).toBe(true);
  });

  it('leaves recent uploads and ready videos alone', async () => {
    const { owner, folder } = await setup();
    const recent = await startUploadViaApi(app, owner.session, folder.id);
    await age(recent.fileId, 23);
    const ready = await uploadVideo(app, storage, owner.session, folder.id);
    await age(ready.fileId, 500);
    const readyKey = (await fileRow(ready.fileId)).storageKey;

    await cleanup.run();
    expect((await fileRow(recent.fileId)).status).toBe('pending');
    expect((await itemRow(ready.itemId)).status).toBe('ready');
    expect(storage.has(readyKey)).toBe(true);
  });

  it('is harmless to run twice', async () => {
    const { owner, folder } = await setup();
    const started = await startUploadViaApi(app, owner.session, folder.id);
    await age(started.fileId, 30);
    await cleanup.run();
    const second = await cleanup.run();
    expect(second.removed).toBe(0);
  });

  it('removes an abandoned cover file too', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const started = await http().post(`/api/media/items/${itemId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 100 }).expect(201);
    storage.putObject(started.body.url, pngBytes(100));
    const key = (await fileRow(started.body.fileId)).storageKey;
    await age(started.body.fileId, 48);
    await cleanup.run();
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await itemRow(itemId)).status).toBe('ready');
  });

  it('answers 404 to a later finish of a cleaned-up upload', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    await cleanup.run();
    await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
  });

  it('never damages an upload that finishes at the same moment: it ends fully ready or fully gone', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const [finish] = await Promise.all([completeViaApi(app, owner.session, started.fileId, parts), cleanup.run()]);
    const item = await itemRow(started.itemId);
    if (item) {
      expect(finish.status).toBe(200);
      expect(item.status).toBe('ready');
      expect((await fileRow(started.fileId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    } else {
      expect([404, 409]).toContain(finish.status);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
    }
  });

  // The test above lets the two requests race for real, so either valid ending may occur on a given run. These two
  // pin each ending down by forcing the order.
  it('ends fully gone when the cleanup lands between the stored checks and the finishing transaction', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const realRead = storage.readRange.bind(storage);
    const spy = jest.spyOn(storage, 'readRange').mockImplementationOnce(async (...args) => {
      const bytes = await realRead(...args);
      await cleanup.run();
      return bytes;
    });
    try {
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    } finally {
      spy.mockRestore();
    }
    expect(await itemRow(started.itemId)).toBeUndefined();
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
  });

  it('leaves a video that finished after the cleanup looked at it fully ready', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    const staleSnapshot = await fileRow(started.fileId);
    await completeViaApi(app, owner.session, started.fileId, parts).expect(200);

    expect(await cleanup['expire'](staleSnapshot)).toBeNull();
    expect((await itemRow(started.itemId)).status).toBe('ready');
    const ready = await fileRow(started.fileId);
    expect(ready.status).toBe('ready');
    expect(storage.has(ready.storageKey)).toBe(true);
  });
});
