import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaFolders, mediaItems } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic } from './helpers/courses';
import { seedFolder, seedItem, signIn, uniqueName } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('deleting a folder from the library', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const folderRow = async (id: string) => (await db.select().from(mediaFolders).where(eq(mediaFolders.id, id)))[0];
  const itemRow = async (id: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0];
  const fileRow = async (id: string) => (await db.select().from(files).where(eq(files.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  it('needs a signed-in person, and lets Staff and Admin delete', async () => {
    const owner = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    await http().delete(`/api/media/folders/${folder.id}`).expect(401);
    await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(owner.session)).expect(204);
    const admin = await signIn(app, db, 'admin');
    const other = await seedFolder(db, owner.user.id);
    await http().delete(`/api/media/folders/${other.id}`).set(...bearer(admin.session)).expect(204);
  });

  it('removes an empty folder and records it', async () => {
    const { user, session } = await signIn(app, db);
    const folder = await seedFolder(db, user.id, uniqueName('Empty'));
    await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(session)).expect(204);
    expect(await folderRow(folder.id)).toBeUndefined();
    const [entry] = await auditFor('content.folder.deleted', folder.id);
    expect(entry).toMatchObject({ actorId: user.id, targetType: 'folder', targetLabel: folder.name, metadata: { category: 'video', itemCount: 0 } });
    await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(session)).expect(404);
  });

  it('removes every item in it with its file and cover, in the database and in storage', async () => {
    const { user, session } = await signIn(app, db);
    const folder = await seedFolder(db, user.id);
    const first = await seedItem(db, { folderId: folder.id, createdBy: user.id, withCover: true, storage });
    const second = await seedItem(db, { folderId: folder.id, createdBy: user.id, storage });
    const coverKey = (await fileRow(first.coverFileId as string)).storageKey;
    await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(session)).expect(204);
    for (const item of [first, second]) {
      expect(await itemRow(item.itemId)).toBeUndefined();
      expect(await fileRow(item.fileId)).toBeUndefined();
      expect(storage.has(item.storageKey)).toBe(false);
    }
    expect(storage.has(coverKey)).toBe(false);
    const [entry] = await auditFor('content.folder.deleted', folder.id);
    expect(entry?.metadata).toMatchObject({ itemCount: 2 });
    expect(JSON.stringify(entry)).not.toMatch(/videos\/|covers\/|memory:/);
  });

  it('keeps the folder and everything in it when an item is used by a course topic', async () => {
    const { user, session } = await signIn(app, db);
    const folder = await seedFolder(db, user.id);
    const item = await seedItem(db, { folderId: folder.id, createdBy: user.id, storage });
    const free = await seedItem(db, { folderId: folder.id, createdBy: user.id, storage });
    const course = await createCourseViaApi(app, session);
    const lesson = await seedLesson(db, course.id, user.id);
    const topic = await seedTopic(db, lesson.id, user.id);
    await seedAttachment(db, { topicId: topic.id, createdBy: user.id, kind: 'video', libraryItemId: item.itemId });
    const refused = await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(session)).expect(409);
    expect(refused.body.message).toMatch(/used in course topics|is used in course topics/);
    expect(await folderRow(folder.id)).toBeDefined();
    expect(await itemRow(item.itemId)).toBeDefined();
    expect(await itemRow(free.itemId)).toBeDefined();
    expect(storage.has(free.storageKey)).toBe(true);
    expect(await auditFor('content.folder.deleted', folder.id)).toHaveLength(0);
  });

  it('keeps the folder while something in it is still uploading', async () => {
    const { user, session } = await signIn(app, db);
    const folder = await seedFolder(db, user.id);
    await seedItem(db, { folderId: folder.id, createdBy: user.id, status: 'uploading' });
    await http().delete(`/api/media/folders/${folder.id}`).set(...bearer(session)).expect(409);
    expect(await folderRow(folder.id)).toBeDefined();
  });

  it('answers 404 for an unknown folder and 400 for a malformed id', async () => {
    const { session } = await signIn(app, db);
    await http().delete(`/api/media/folders/${UNKNOWN}`).set(...bearer(session)).expect(404);
    await http().delete('/api/media/folders/not-a-uuid').set(...bearer(session)).expect(400);
  });
});
