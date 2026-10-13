import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses, files, lessons, mediaItems, topicAttachments, topics } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { addLessonViaApi, attachCourseCoverViaApi, createCourseViaApi, seedAttachment, seedLesson, seedTopic } from './helpers/courses';
import { seedFolder, seedItem, signIn } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('deleting, the Trash, restoring and deleting for good', () => {
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

  // A course with a lesson holding a topic that has an uploaded file, made by an Admin, plus a Staff session.
  async function setup() {
    const admin = await signIn(app, db, 'admin');
    const staff = await signIn(app, db, 'staff');
    const course = await createCourseViaApi(app, admin.session);
    const lesson = await seedLesson(db, course.id, admin.user.id, 'Exits', 0);
    const topic = await seedTopic(db, lesson.id, admin.user.id, 'Fire exits', 0);
    const attachment = await seedAttachment(db, { topicId: topic.id, createdBy: admin.user.id, kind: 'pdf', storage });
    return { admin, staff, course, lesson, topic, attachment };
  }

  const trashOf = async (session: { accessToken: string; refreshToken: string }) =>
    (await http().get('/api/trash').set(...bearer(session)).expect(200)).body as { type: string; id: string; title: string; courseTitle: string | null; lessonTitle: string | null; lessonCount: number | null; topicCount: number | null }[];

  it('needs a signed-in Admin on every route; Staff and visitors are turned away', async () => {
    const { staff, course, lesson, topic } = await setup();
    for (const path of [`/api/courses/${course.id}`, `/api/lessons/${lesson.id}`, `/api/topics/${topic.id}`]) {
      await http().delete(path).expect(401);
      await http().delete(path).set(...bearer(staff.session)).expect(403);
    }
    await http().get('/api/trash').expect(401);
    await http().get('/api/trash').set(...bearer(staff.session)).expect(403);
    await http().post(`/api/trash/course/${course.id}/restore`).set(...bearer(staff.session)).expect(403);
    await http().delete(`/api/trash/course/${course.id}`).set(...bearer(staff.session)).expect(403);
    // Nothing was touched.
    const [stored] = await db.select().from(courses).where(eq(courses.id, course.id));
    expect(stored.deletedAt).toBeNull();
  });

  describe('deleting', () => {
    it('moves a topic to the Trash, answers the tree without it, and records who and what', async () => {
      const { admin, course, lesson, topic } = await setup();
      const res = await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      expect(res.body.lessons[0].topics).toEqual([]);
      await http().get(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(404);
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(admin.session)).send({ title: 'x' }).expect(404);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(404);
      const [entry] = await auditFor('content.topic.deleted', topic.id);
      expect(entry).toMatchObject({
        actorId: admin.user.id,
        targetType: 'topic',
        targetLabel: 'Fire exits',
        metadata: { lessonId: lesson.id, lessonTitle: 'Exits', courseId: course.id },
      });
      const list = await http().get('/api/courses').set(...bearer(admin.session)).expect(200);
      expect(list.body.find((candidate: { id: string }) => candidate.id === course.id)).toMatchObject({ lessonCount: 1, topicCount: 0 });
    });

    it('moves a lesson to the Trash with its topics and hides them', async () => {
      const { admin, course, lesson, topic } = await setup();
      const res = await http().delete(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).expect(200);
      expect(res.body.lessons).toEqual([]);
      await http().get(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(404);
      await http().patch(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).send({ title: 'x' }).expect(404);
      await http().post(`/api/lessons/${lesson.id}/topics`).set(...bearer(admin.session)).send({ title: 'x' }).expect(404);
      expect(await auditFor('content.lesson.deleted', lesson.id)).toHaveLength(1);
      const list = await http().get('/api/courses').set(...bearer(admin.session)).expect(200);
      expect(list.body.find((candidate: { id: string }) => candidate.id === course.id)).toMatchObject({ lessonCount: 0, topicCount: 0 });
    });

    it('moves a course to the Trash with everything in it and hides it', async () => {
      const { admin, course, lesson, topic, attachment } = await setup();
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      const list = await http().get('/api/courses').set(...bearer(admin.session)).expect(200);
      expect(list.body.map((candidate: { id: string }) => candidate.id)).not.toContain(course.id);
      await http().get(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(admin.session)).send({ title: 'x' }).expect(404);
      await http().patch(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).send({ title: 'x' }).expect(404);
      await http().get(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/attachments/${attachment.attachmentId}/open`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/topics/${topic.id}/attachments/uploads`).set(...bearer(admin.session)).send({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 }).expect(404);
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(404);
      expect(await auditFor('content.course.deleted', course.id)).toHaveLength(1);
    });

    it('leaves the order of the other courses alone', async () => {
      const { admin, course } = await setup();
      const other = await createCourseViaApi(app, admin.session);
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      const res = await http().put('/api/courses/order').set(...bearer(admin.session)).send({ ids: (await http().get('/api/courses').set(...bearer(admin.session))).body.map((c: { id: string }) => c.id) }).expect(200);
      expect(res.body.map((c: { id: string }) => c.id)).toContain(other.id);
      expect(res.body.map((c: { id: string }) => c.id)).not.toContain(course.id);
    });

    it('answers 404 for an unknown id and 400 for one that is not an id', async () => {
      const { admin } = await setup();
      for (const kind of ['courses', 'lessons', 'topics']) {
        await http().delete(`/api/${kind}/${unknown}`).set(...bearer(admin.session)).expect(404);
        await http().delete(`/api/${kind}/nope`).set(...bearer(admin.session)).expect(400);
      }
    });
  });

  describe('the Trash', () => {
    it('lists what was deleted itself, newest first, with where it was and what goes with it', async () => {
      const { admin, course, lesson, topic } = await setup();
      const second = await seedLesson(db, course.id, admin.user.id, 'Alarms', 1);
      await seedTopic(db, second.id, admin.user.id, 'Bells', 0);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/lessons/${second.id}`).set(...bearer(admin.session)).expect(200);
      const entries = (await trashOf(admin.session)).filter((entry) => [topic.id, second.id].includes(entry.id));
      expect(entries.map((entry) => [entry.type, entry.title])).toEqual([
        ['lesson', 'Alarms'],
        ['topic', 'Fire exits'],
      ]);
      expect(entries[0]).toMatchObject({ courseTitle: course.title, topicCount: 1 });
      expect(entries[1]).toMatchObject({ courseTitle: course.title, lessonTitle: lesson.title });
    });

    it('lists a deleted course but not what was in it', async () => {
      const { admin, course, lesson, topic } = await setup();
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      const ids = (await trashOf(admin.session)).map((entry) => entry.id);
      expect(ids).toContain(course.id);
      expect(ids).not.toContain(lesson.id);
      expect(ids).not.toContain(topic.id);
      const entry = (await trashOf(admin.session)).find((candidate) => candidate.id === course.id);
      expect(entry).toMatchObject({ type: 'course', lessonCount: 1, topicCount: 0 });
    });
  });

  describe('restoring', () => {
    it('brings a topic back at the end of its lesson', async () => {
      const { admin, lesson, topic } = await setup();
      await seedTopic(db, lesson.id, admin.user.id, 'Second', 1);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().post(`/api/trash/topic/${topic.id}/restore`).set(...bearer(admin.session)).expect(204);
      const [stored] = await db.select().from(topics).where(eq(topics.id, topic.id));
      expect(stored).toMatchObject({ deletedAt: null, deletedBy: null, position: 2 });
      await http().get(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      expect(await auditFor('content.topic.restored', topic.id)).toHaveLength(1);
      expect((await trashOf(admin.session)).map((entry) => entry.id)).not.toContain(topic.id);
    });

    it('brings a course back with its lessons, topics and files, and a topic deleted before stays deleted', async () => {
      const { admin, course, lesson, topic } = await setup();
      const gone = await seedTopic(db, lesson.id, admin.user.id, 'Gone', 1);
      await http().delete(`/api/topics/${gone.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      await http().post(`/api/trash/course/${course.id}/restore`).set(...bearer(admin.session)).expect(204);
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(200);
      expect(tree.body.lessons[0].topics.map((entry: { id: string }) => entry.id)).toEqual([topic.id]);
      expect(tree.body.lessons[0].topics[0].attachmentCount).toBe(1);
      expect((await trashOf(admin.session)).map((entry) => entry.id)).toContain(gone.id);
    });

    it('refuses to restore a lesson or topic while what holds it is in the Trash, and says which to restore first', async () => {
      const { admin, course, lesson, topic } = await setup();
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).expect(200);
      const blocked = await http().post(`/api/trash/topic/${topic.id}/restore`).set(...bearer(admin.session)).expect(409);
      expect(blocked.body.message).toBe('Restore the lesson "Exits" first.');
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      const lessonBlocked = await http().post(`/api/trash/lesson/${lesson.id}/restore`).set(...bearer(admin.session)).expect(409);
      expect(lessonBlocked.body.message).toBe(`Restore the course "${course.title}" first.`);
    });

    it('answers 404 for something that is not in the Trash, and 400 for a type that does not exist', async () => {
      const { admin, course, topic } = await setup();
      await http().post(`/api/trash/course/${course.id}/restore`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/trash/topic/${topic.id}/restore`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/trash/course/${unknown}/restore`).set(...bearer(admin.session)).expect(404);
      await http().post(`/api/trash/folder/${course.id}/restore`).set(...bearer(admin.session)).expect(400);
    });
  });

  describe('deleting for good', () => {
    it('removes a course, its lessons, topics, attachments, files and cover from the database and from storage', async () => {
      const { admin, course, lesson, topic, attachment } = await setup();
      const coverFileId = await attachCourseCoverViaApi(app, storage, admin.session, course.id);
      const [cover] = await db.select().from(files).where(eq(files.id, coverFileId));
      expect(storage.has(attachment.storageKey as string)).toBe(true);
      expect(storage.has(cover.storageKey)).toBe(true);

      await http().delete(`/api/trash/course/${course.id}`).set(...bearer(admin.session)).expect(404);
      await http().delete(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(204);
      await http().delete(`/api/trash/course/${course.id}`).set(...bearer(admin.session)).expect(204);

      expect(await db.select().from(courses).where(eq(courses.id, course.id))).toEqual([]);
      expect(await db.select().from(lessons).where(eq(lessons.id, lesson.id))).toEqual([]);
      expect(await db.select().from(topics).where(eq(topics.id, topic.id))).toEqual([]);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.id, attachment.attachmentId))).toEqual([]);
      expect(await db.select().from(files).where(eq(files.id, attachment.fileId as string))).toEqual([]);
      expect(await db.select().from(files).where(eq(files.id, coverFileId))).toEqual([]);
      expect(storage.has(attachment.storageKey as string)).toBe(false);
      expect(storage.has(cover.storageKey)).toBe(false);
      const [entry] = await auditFor('content.course.purged', course.id);
      expect(entry).toMatchObject({ actorId: admin.user.id, targetLabel: course.title });
      expect((await trashOf(admin.session)).map((candidate) => candidate.id)).not.toContain(course.id);
    });

    it('removes a lesson and a topic the same way, and leaves the rest of the course', async () => {
      const { admin, course, lesson, topic, attachment } = await setup();
      const keep = await seedLesson(db, course.id, admin.user.id, 'Keep', 1);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/trash/topic/${topic.id}`).set(...bearer(admin.session)).expect(204);
      expect(await db.select().from(topics).where(eq(topics.id, topic.id))).toEqual([]);
      expect(storage.has(attachment.storageKey as string)).toBe(false);
      await http().delete(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/trash/lesson/${lesson.id}`).set(...bearer(admin.session)).expect(204);
      expect(await db.select().from(lessons).where(eq(lessons.id, lesson.id))).toEqual([]);
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(200);
      expect(tree.body.lessons.map((entry: { id: string }) => entry.id)).toEqual([keep.id]);
      expect(await auditFor('content.topic.purged', topic.id)).toHaveLength(1);
      expect(await auditFor('content.lesson.purged', lesson.id)).toHaveLength(1);
    });

    it('does not remove a library item that an attachment pointed at', async () => {
      const { admin, topic } = await setup();
      const folder = await seedFolder(db, admin.user.id);
      const item = await seedItem(db, { folderId: folder.id, createdBy: admin.user.id });
      await seedAttachment(db, { topicId: topic.id, createdBy: admin.user.id, kind: 'video', libraryItemId: item.itemId });
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/trash/topic/${topic.id}`).set(...bearer(admin.session)).expect(204);
      expect(await db.select().from(mediaItems).where(eq(mediaItems.id, item.itemId))).toHaveLength(1);
    });

    it('answers 404 for something that is not in the Trash', async () => {
      const { admin, lesson, topic } = await setup();
      await http().delete(`/api/trash/lesson/${lesson.id}`).set(...bearer(admin.session)).expect(404);
      await http().delete(`/api/trash/topic/${topic.id}`).set(...bearer(admin.session)).expect(404);
      await http().delete(`/api/trash/topic/${unknown}`).set(...bearer(admin.session)).expect(404);
      expect(await db.select().from(topics).where(eq(topics.id, topic.id))).toHaveLength(1);
    });
  });

  describe('an attachment', () => {
    const topicBody = async (session: { accessToken: string; refreshToken: string }, topicId: string) =>
      (await http().get(`/api/topics/${topicId}`).set(...bearer(session)).expect(200)).body as { attachments: { id: string }[] };

    it('is moved to the Trash by an Admin only, and leaves the topic and its count', async () => {
      const { admin, staff, course, topic, attachment } = await setup();
      await http().delete(`/api/attachments/${attachment.attachmentId}`).expect(401);
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(staff.session)).expect(403);
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
      expect((await topicBody(admin.session, topic.id)).attachments).toEqual([]);
      await http().post(`/api/attachments/${attachment.attachmentId}/open`).set(...bearer(admin.session)).expect(404);
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(404);
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(admin.session)).expect(200);
      expect(tree.body.lessons[0].topics[0].attachmentCount).toBe(0);
      const [entry] = await auditFor('content.attachment.deleted', attachment.attachmentId);
      expect(entry).toMatchObject({ actorId: admin.user.id, targetType: 'attachment', metadata: { kind: 'pdf', topicId: topic.id, topicTitle: 'Fire exits' } });
    });

    it('cannot be deleted while it is still uploading', async () => {
      const { admin, topic } = await setup();
      const { attachmentId } = await seedAttachment(db, { topicId: topic.id, createdBy: admin.user.id, kind: 'pdf', status: 'uploading' });
      await http().delete(`/api/attachments/${attachmentId}`).set(...bearer(admin.session)).expect(409);
    });

    it('is listed in the Trash with where it was, and comes back at the end of the topic', async () => {
      const { admin, lesson, topic, attachment } = await setup();
      const second = await seedAttachment(db, { topicId: topic.id, createdBy: admin.user.id, kind: 'pdf', position: 1, storage });
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
      const entry = (await trashOf(admin.session)).find((candidate) => candidate.id === attachment.attachmentId);
      expect(entry).toMatchObject({ type: 'attachment', topicTitle: 'Fire exits', lessonTitle: lesson.title });
      await http().post(`/api/trash/attachment/${attachment.attachmentId}/restore`).set(...bearer(admin.session)).expect(204);
      const ids = (await topicBody(admin.session, topic.id)).attachments.map((candidate) => candidate.id);
      expect(ids).toEqual([second.attachmentId, attachment.attachmentId]);
      expect(await auditFor('content.attachment.restored', attachment.attachmentId)).toHaveLength(1);
    });

    it('is not restored while its topic is in the Trash, and the answer says which to restore first', async () => {
      const { admin, topic, attachment } = await setup();
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      const blocked = await http().post(`/api/trash/attachment/${attachment.attachmentId}/restore`).set(...bearer(admin.session)).expect(409);
      expect(blocked.body.message).toBe('Restore the topic "Fire exits" first.');
      expect((await trashOf(admin.session)).map((candidate) => candidate.id)).not.toContain(attachment.attachmentId);
    });

    it('is deleted for good with its file, and a library attachment leaves the library item alone', async () => {
      const { admin, topic, attachment } = await setup();
      const folder = await seedFolder(db, admin.user.id);
      const item = await seedItem(db, { folderId: folder.id, createdBy: admin.user.id });
      const library = await seedAttachment(db, { topicId: topic.id, createdBy: admin.user.id, kind: 'video', libraryItemId: item.itemId, position: 1 });
      await http().delete(`/api/trash/attachment/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(404);
      for (const id of [attachment.attachmentId, library.attachmentId]) await http().delete(`/api/attachments/${id}`).set(...bearer(admin.session)).expect(204);
      expect(storage.has(attachment.storageKey as string)).toBe(true);
      await http().delete(`/api/trash/attachment/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
      await http().delete(`/api/trash/attachment/${library.attachmentId}`).set(...bearer(admin.session)).expect(204);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.id, attachment.attachmentId))).toEqual([]);
      expect(await db.select().from(files).where(eq(files.id, attachment.fileId as string))).toEqual([]);
      expect(storage.has(attachment.storageKey as string)).toBe(false);
      expect(await db.select().from(mediaItems).where(eq(mediaItems.id, item.itemId))).toHaveLength(1);
      expect(await auditFor('content.attachment.purged', attachment.attachmentId)).toHaveLength(1);
    });

    it('goes with its topic when the topic is deleted for good, even if it was in the Trash on its own', async () => {
      const { admin, topic, attachment } = await setup();
      await http().delete(`/api/attachments/${attachment.attachmentId}`).set(...bearer(admin.session)).expect(204);
      await http().delete(`/api/topics/${topic.id}`).set(...bearer(admin.session)).expect(200);
      await http().delete(`/api/trash/topic/${topic.id}`).set(...bearer(admin.session)).expect(204);
      expect(await db.select().from(files).where(eq(files.id, attachment.fileId as string))).toEqual([]);
      expect(storage.has(attachment.storageKey as string)).toBe(false);
    });
  });

  it('adding a lesson after one was deleted still gives the next free position', async () => {
    const { admin, course, lesson } = await setup();
    await http().delete(`/api/lessons/${lesson.id}`).set(...bearer(admin.session)).expect(200);
    const tree = await addLessonViaApi(app, admin.session, course.id, 'New');
    expect(tree.lessons.map((entry) => [entry.title, entry.position])).toEqual([['New', 1]]);
  });
});
