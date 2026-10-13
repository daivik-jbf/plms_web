import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files } from '../src/db/schema';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic } from './helpers/courses';
import { pngBytes, seedFolder, seedItem, signIn } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('cover images of lessons, topics and uploaded attachments', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const unknown = '00000000-0000-4000-8000-000000000000';
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  // The three steps the web takes: ask for a link, send the picture to it, then ask for it to be checked and attached.
  async function setCover(base: string, session: Session, bytes: Uint8Array = pngBytes(100)) {
    const started = await http().post(`${base}/cover`).set(...bearer(session)).send({ contentType: 'image/png', sizeBytes: bytes.length }).expect(201);
    storage.putObject(started.body.url, bytes);
    const done = await http().post(`${base}/cover/${started.body.fileId}/complete`).set(...bearer(session));
    return { fileId: started.body.fileId as string, done };
  }

  async function setup() {
    const owner = await signIn(app, db, 'staff');
    const admin = await signIn(app, db, 'admin');
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits', 0);
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits', 0);
    return { owner, admin, course, lesson, topic };
  }

  describe('a lesson', () => {
    it('gets a cover that the course tree then links, and replaces the old file when it changes', async () => {
      const { owner, course, lesson } = await setup();
      const first = await setCover(`/api/lessons/${lesson.id}`, owner.session);
      expect(first.done.status).toBe(200);
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].coverUrl).toEqual(expect.any(String));
      const [stored] = await db.select().from(files).where(eq(files.id, first.fileId));
      expect(storage.has(stored.storageKey)).toBe(true);

      const second = await setCover(`/api/lessons/${lesson.id}`, owner.session);
      expect(await db.select().from(files).where(eq(files.id, first.fileId))).toEqual([]);
      expect(storage.has(stored.storageKey)).toBe(false);
      expect(second.done.body.lessons[0].coverUrl).toEqual(expect.any(String));
      expect(await auditFor('content.lesson.cover_set', lesson.id)).toHaveLength(2);
    });

    it('has no cover link until one is set, and refuses what is not a picture', async () => {
      const { owner, course, lesson } = await setup();
      const before = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(before.body.lessons[0].coverUrl).toBeNull();
      const bad = await setCover(`/api/lessons/${lesson.id}`, owner.session, new Uint8Array(100).fill(7));
      expect(bad.done.status).toBe(422);
      const after = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(after.body.lessons[0].coverUrl).toBeNull();
    });

    it('needs a sign-in, a real lesson and a valid picture type', async () => {
      const { owner, lesson } = await setup();
      await http().post(`/api/lessons/${lesson.id}/cover`).send({ contentType: 'image/png', sizeBytes: 5 }).expect(401);
      await http().post(`/api/lessons/${unknown}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 5 }).expect(404);
      await http().post(`/api/lessons/${lesson.id}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/gif', sizeBytes: 5 }).expect(400);
    });
  });

  describe('a topic', () => {
    it('gets a cover that the topic and the course tree link', async () => {
      const { owner, course, topic } = await setup();
      const set = await setCover(`/api/topics/${topic.id}`, owner.session);
      expect(set.done.status).toBe(200);
      expect(set.done.body.coverUrl).toEqual(expect.any(String));
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.coverUrl).toEqual(expect.any(String));
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].topics[0].coverUrl).toEqual(expect.any(String));
      expect(await auditFor('content.topic.cover_set', topic.id)).toHaveLength(1);
    });

    it('cannot be given a cover while it is in the Trash', async () => {
      const { owner, admin, topic } = await setup();
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().post(`/api/topics/${topic.id}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 5 }).expect(404);
    });
  });

  describe('an uploaded attachment', () => {
    it('shows its cover as its thumbnail, even for a file that is not a picture', async () => {
      const { owner, topic } = await setup();
      const { attachmentId } = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', storage });
      const before = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(before.body.attachments[0].thumbnailUrl).toBeNull();
      const set = await setCover(`/api/attachments/${attachmentId}`, owner.session);
      expect(set.done.status).toBe(200);
      expect(set.done.body.thumbnailUrl).toEqual(expect.any(String));
      expect(await auditFor('content.attachment.cover_set', attachmentId)).toHaveLength(1);
    });

    it('is not offered for a file from the library, which uses the cover of its item', async () => {
      const { owner, topic } = await setup();
      const folder = await seedFolder(db, owner.user.id);
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id });
      const { attachmentId } = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId });
      await http().post(`/api/attachments/${attachmentId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 5 }).expect(409);
    });

    it("is not shown to, or changed by, someone else while it is still uploading", async () => {
      const { owner, topic } = await setup();
      const other = await signIn(app, db, 'staff');
      const { attachmentId } = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', status: 'uploading' });
      await http().post(`/api/attachments/${attachmentId}/cover`).set(...bearer(other.session)).send({ contentType: 'image/png', sizeBytes: 5 }).expect(404);
      const mine = await http().post(`/api/attachments/${attachmentId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 5 }).expect(201);
      expect(mine.body.fileId).toEqual(expect.any(String));
    });
  });

  it('removes every cover from the database and from storage when the Trash item is deleted for good', async () => {
    const { owner, admin, course, lesson, topic } = await setup();
    const { attachmentId } = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', storage });
    const covers = [
      await setCover(`/api/lessons/${lesson.id}`, owner.session),
      await setCover(`/api/topics/${topic.id}`, owner.session),
      await setCover(`/api/attachments/${attachmentId}`, owner.session),
    ];
    const keys: string[] = [];
    for (const cover of covers) {
      const [row] = await db.select().from(files).where(eq(files.id, cover.fileId));
      keys.push(row.storageKey);
      expect(storage.has(row.storageKey)).toBe(true);
    }
    await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
    await http().delete(`/api/trash/course/${course.id}`).set(...bearer(admin.session)).expect(204);
    for (const [index, cover] of covers.entries()) {
      expect(await db.select().from(files).where(eq(files.id, cover.fileId))).toEqual([]);
      expect(storage.has(keys[index] as string)).toBe(false);
    }
  });
});
