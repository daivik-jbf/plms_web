import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic } from './helpers/courses';
import { seedFolder, seedItem, signIn, uniqueName } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('deleting an item from the library', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const itemRow = async (id: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0];
  const fileRow = async (id: string) => (await db.select().from(files).where(eq(files.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    return { owner, admin, folder };
  }

  it('needs a signed-in person, and an Admin', async () => {
    const { owner, folder } = await setup();
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    await http().delete(`/api/media/items/${item.itemId}`).expect(401);
    await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(owner.session)).expect(403);
    expect(await itemRow(item.itemId)).toBeDefined();
  });

  it('removes the item, its file and its cover, in the database and in storage, and records it', async () => {
    const { owner, admin, folder } = await setup();
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Fire exits', withCover: true, storage });
    const coverKey = (await fileRow(item.coverFileId as string)).storageKey;
    expect(storage.has(item.storageKey)).toBe(true);

    await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(admin.session)).expect(204);

    expect(await itemRow(item.itemId)).toBeUndefined();
    expect(await fileRow(item.fileId)).toBeUndefined();
    expect(await fileRow(item.coverFileId as string)).toBeUndefined();
    expect(storage.has(item.storageKey)).toBe(false);
    expect(storage.has(coverKey)).toBe(false);
    const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(list.body).toEqual([]);
    const [entry] = await auditFor('content.video.deleted', item.itemId);
    expect(entry).toMatchObject({ actorId: admin.user.id, targetType: 'video', targetLabel: 'Fire exits', metadata: { category: 'video', folderId: folder.id } });
    expect(JSON.stringify(entry)).not.toMatch(/videos\/|covers\/|memory:/);
    await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(admin.session)).expect(404);
  });

  it('uses the category of the folder as the audit target type', async () => {
    const { owner, admin } = await setup();
    const songs = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    const item = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, storage });
    await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(admin.session)).expect(204);
    const [entry] = await auditFor('content.video.deleted', item.itemId);
    expect(entry).toMatchObject({ targetType: 'song', metadata: { category: 'song' } });
  });

  it('keeps an item that a course topic still uses, and lets it go once the topic lets go', async () => {
    const { owner, admin, folder } = await setup();
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id);
    const topic = await seedTopic(db, lesson.id, owner.user.id);
    const attachment = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId });

    const refused = await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(admin.session)).expect(409);
    expect(refused.body.message).toMatch(/used in a course topic/);
    expect(await itemRow(item.itemId)).toBeDefined();
    expect(storage.has(item.storageKey)).toBe(true);
    expect(await auditFor('content.video.deleted', item.itemId)).toHaveLength(0);

    await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
    await http().delete(`/api/trash/attachment/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
    await http().delete(`/api/media/items/${item.itemId}`).set(...bearer(admin.session)).expect(204);
  });

  it('refuses an item that is still uploading and an unknown one', async () => {
    const { owner, admin, folder } = await setup();
    const uploading = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    await http().delete(`/api/media/items/${uploading.itemId}`).set(...bearer(admin.session)).expect(409);
    expect(await itemRow(uploading.itemId)).toBeDefined();
    await http().delete(`/api/media/items/${UNKNOWN}`).set(...bearer(admin.session)).expect(404);
    await http().delete('/api/media/items/not-a-uuid').set(...bearer(admin.session)).expect(400);
  });
});
