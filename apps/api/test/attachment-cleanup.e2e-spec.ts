import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, topicAttachments } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic, startAttachmentUploadViaApi, uploadAttachment } from './helpers/courses';
import { completeViaApi, pdfBytes, putPieces, seedFolder, seedItem, signIn } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('cleaning up abandoned attachment uploads', () => {
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
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id);
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    return { owner, admin, topic };
  }

  it('removes a pending attachment upload older than 24 hours, aborts it in storage and records why without any key', async () => {
    const { owner, admin, topic } = await setup();
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Old map' });
    await putPieces(app, storage, owner.session, started.fileId, pdfBytes(100));
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 25);
    const pending = storage.pendingUploadCount();

    const result = await cleanup.run();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(await attachmentRow(started.itemId)).toBeUndefined();
    expect(storage.pendingUploadCount()).toBe(pending - 1);
    const entries = await auditFor('file.upload_failed', started.itemId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, targetType: 'attachment', targetLabel: 'Old map', metadata: { fileId: started.fileId, reason: 'expired' } });
    expect(JSON.stringify(entries[0])).not.toContain(key);
    const items = (await http().get(`/api/audit?q=${encodeURIComponent('Old map')}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'file.upload_failed')?.summary).toBe('The upload of Old map failed (it was not finished within 24 hours)');
  });

  it('leaves recent uploads and every ready attachment alone, however old their file is', async () => {
    const { owner, topic } = await setup();
    const recent = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(recent.fileId, 23);
    const ready = await uploadAttachment(app, storage, owner.session, topic.id);
    await age(ready.fileId, 500);
    const readyKey = (await fileRow(ready.fileId)).storageKey;
    const folder = await seedFolder(db, owner.user.id);
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const library = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId, position: 5 });

    await cleanup.run();
    expect((await fileRow(recent.fileId)).status).toBe('pending');
    expect((await attachmentRow(recent.itemId)).status).toBe('uploading');
    expect((await attachmentRow(ready.itemId)).status).toBe('ready');
    expect((await fileRow(ready.fileId)).status).toBe('ready');
    expect(storage.has(readyKey)).toBe(true);
    expect(await attachmentRow(library.attachmentId)).toBeDefined();
  });

  it('removes only the expired upload of a topic and leaves the topic and its other attachments', async () => {
    const { owner, topic } = await setup();
    const kept = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'Keep me' });
    const gone = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(gone.fileId, 30);
    await cleanup.run();
    const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
    expect(detail.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([kept.itemId]);
  });

  it('is harmless to run twice', async () => {
    const { owner, topic } = await setup();
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(started.fileId, 30);
    await cleanup.run();
    expect((await cleanup.run()).removed).toBe(0);
    expect(await auditFor('file.upload_failed', started.itemId)).toHaveLength(1);
  });

  it('answers 404 to a later finish of a cleaned-up upload', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    await cleanup.run();
    await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
  });

  it('never damages an upload that finishes at the same moment: it ends fully ready or fully gone', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const [finish] = await Promise.all([completeViaApi(app, owner.session, started.fileId, parts), cleanup.run()]);
    const attachment = await attachmentRow(started.itemId);
    if (attachment) {
      expect(finish.status).toBe(200);
      expect(attachment.status).toBe('ready');
      expect((await fileRow(started.fileId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    } else {
      expect([404, 409]).toContain(finish.status);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
    }
  });

  // The test above lets the two requests race for real, so either valid ending may occur on a given run. These pin each
  // ending down by forcing the order.
  it('ends fully gone when the cleanup lands between the stored checks and the finishing transaction', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
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
    expect(await attachmentRow(started.itemId)).toBeUndefined();
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect(await auditFor('content.attachment.added', started.itemId)).toEqual([]);
  });

  it('leaves an attachment that finished after the cleanup looked at it fully ready', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    const staleSnapshot = await fileRow(started.fileId);
    await completeViaApi(app, owner.session, started.fileId, parts).expect(200);

    expect(await cleanup['expire'](staleSnapshot)).toBeNull();
    expect((await attachmentRow(started.itemId)).status).toBe('ready');
    const ready = await fileRow(started.fileId);
    expect(ready.status).toBe('ready');
    expect(storage.has(ready.storageKey)).toBe(true);
    expect(await auditFor('file.upload_failed', started.itemId)).toEqual([]);
  });

  it('settles cleanly when a cancel and a finish race: either the attachment is ready or everything is gone', async () => {
    const { owner, topic } = await setup();
    for (let round = 0; round < 12; round += 1) {
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const [finish, cancel] = await Promise.all([
        completeViaApi(app, owner.session, started.fileId, parts),
        http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)),
      ]);
      if (finish.status === 200) {
        expect(cancel.status).toBe(409);
        expect((await attachmentRow(started.itemId)).status).toBe('ready');
        expect(storage.has(key)).toBe(true);
      } else {
        expect([finish.status, cancel.status]).toEqual([404, 204]);
        expect(await attachmentRow(started.itemId)).toBeUndefined();
        expect(await fileRow(started.fileId)).toBeUndefined();
        expect(storage.has(key)).toBe(false);
      }
    }
  });

  it('refuses to cancel a ready attachment even when a stale cancel arrives after the finish', async () => {
    const { owner, topic } = await setup();
    const { itemId, fileId, parts } = await uploadAttachment(app, storage, owner.session, topic.id);
    const key = (await fileRow(fileId)).storageKey;
    await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
    await completeViaApi(app, owner.session, fileId, parts).expect(200);
    expect((await attachmentRow(itemId)).status).toBe('ready');
    expect(storage.has(key)).toBe(true);
    expect(await auditFor('file.upload_cancelled', itemId)).toEqual([]);
  });
});
