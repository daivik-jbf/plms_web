import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/db.module';
import { isUniqueViolation } from '../src/db/errors';
import { courses, files, lessons, mediaFolders, mediaItems, topicAttachments, topics } from '../src/db/schema';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

const isRejected = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, () => true);
const isRejectedAsDuplicate = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, isUniqueViolation);

describe('course tables', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  async function setup() {
    const user = await createUser(db);
    const [course] = await db.insert(courses).values({ title: 'Safety', position: 0, createdBy: user.id }).returning();
    const [lesson] = await db.insert(lessons).values({ courseId: course.id, title: 'Exits', position: 0, createdBy: user.id }).returning();
    const [topic] = await db.insert(topics).values({ lessonId: lesson.id, title: 'Fire exits', position: 0, createdBy: user.id }).returning();
    const file = async (purpose: 'pdf' | 'image' | 'video' = 'pdf') => {
      const [row] = await db
        .insert(files)
        .values({ purpose, storageKey: `documents/${randomUUID()}`, originalName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 10, uploadedBy: user.id })
        .returning();
      return row;
    };
    const [folder] = await db.insert(mediaFolders).values({ category: 'video', name: `Folder ${randomUUID()}`, position: 0, createdBy: user.id }).returning();
    const libraryItem = async () => {
      const media = await file('video');
      const [item] = await db
        .insert(mediaItems)
        .values({ folderId: folder.id, title: 'Library video', position: 0, mediaFileId: media.id, status: 'ready', createdBy: user.id })
        .returning();
      return item;
    };
    const attachment = (overrides: Partial<typeof topicAttachments.$inferInsert>) =>
      db.insert(topicAttachments).values({ topicId: topic.id, position: 0, kind: 'pdf', title: 'Exit map', status: 'ready', createdBy: user.id, ...overrides });
    return { user, course, lesson, topic, file, libraryItem, attachment };
  }

  it('stores files with the pdf and image purposes', async () => {
    const { file } = await setup();
    expect((await file('pdf')).purpose).toBe('pdf');
    expect((await file('image')).purpose).toBe('image');
  });

  it('takes an uploaded file or a library item as the source of an attachment, never both and never neither', async () => {
    const { file, libraryItem, attachment } = await setup();
    const uploaded = await file();
    const item = await libraryItem();
    expect(await isRejected(attachment({ fileId: uploaded.id }))).toBe(false);
    expect(await isRejected(attachment({ kind: 'video', title: null, libraryItemId: item.id }))).toBe(false);
    expect(await isRejected(attachment({}))).toBe(true);
    expect(await isRejected(attachment({ fileId: (await file()).id, libraryItemId: item.id }))).toBe(true);
  });

  it('refuses an uploaded attachment without a title but lets a library attachment follow its item', async () => {
    const { file, libraryItem, attachment } = await setup();
    expect(await isRejected(attachment({ fileId: (await file()).id, title: null }))).toBe(true);
    expect(await isRejected(attachment({ kind: 'audio', libraryItemId: (await libraryItem()).id, title: null }))).toBe(false);
  });

  it('refuses a second attachment for the same file and a duplicate storage key, but not a second one for the same library item', async () => {
    const { file, libraryItem, attachment } = await setup();
    const uploaded = await file();
    await attachment({ fileId: uploaded.id });
    expect(await isRejectedAsDuplicate(attachment({ fileId: uploaded.id }))).toBe(true);
    const item = await libraryItem();
    await attachment({ kind: 'video', libraryItemId: item.id, title: null });
    expect(await isRejected(attachment({ kind: 'video', libraryItemId: item.id, title: null, position: 1 }))).toBe(false);
  });

  it('stores kinds, statuses, positions and an optional length, and refuses a kind that does not exist', async () => {
    const { file, attachment, topic } = await setup();
    const [stored] = await attachment({ fileId: (await file()).id, kind: 'image', status: 'uploading', position: 4, durationSeconds: null }).returning();
    expect(stored).toMatchObject({ kind: 'image', status: 'uploading', position: 4, durationSeconds: null, topicId: topic.id });
    expect(await isRejected(attachment({ fileId: (await file()).id, kind: 'spreadsheet' as 'pdf' }))).toBe(true);
    const [again] = await db.select().from(topicAttachments).where(eq(topicAttachments.id, stored.id));
    expect(again.createdAt).toBeInstanceOf(Date);
  });

  it('keeps lessons with their course, topics with their lesson and attachments with their topic', async () => {
    const { user, course, lesson, topic, file, attachment } = await setup();
    const missing = randomUUID();
    expect(await isRejected(db.insert(lessons).values({ courseId: missing, title: 'L', position: 0, createdBy: user.id }))).toBe(true);
    expect(await isRejected(db.insert(topics).values({ lessonId: missing, title: 'T', position: 0, createdBy: user.id }))).toBe(true);
    expect(await isRejected(attachment({ topicId: missing, fileId: (await file()).id }))).toBe(true);
    await attachment({ fileId: (await file()).id });
    expect(await isRejected(db.delete(courses).where(eq(courses.id, course.id)))).toBe(true);
    expect(await isRejected(db.delete(lessons).where(eq(lessons.id, lesson.id)))).toBe(true);
    expect(await isRejected(db.delete(topics).where(eq(topics.id, topic.id)))).toBe(true);
  });

  it('lets a course point at a cover file and keeps titles that repeat', async () => {
    const { user, file } = await setup();
    const cover = await file('image');
    const [first] = await db.insert(courses).values({ title: 'Same', position: 1, coverFileId: cover.id, createdBy: user.id }).returning();
    const [second] = await db.insert(courses).values({ title: 'Same', position: 2, createdBy: user.id }).returning();
    expect(first.coverFileId).toBe(cover.id);
    expect(second.coverFileId).toBeNull();
  });
});
