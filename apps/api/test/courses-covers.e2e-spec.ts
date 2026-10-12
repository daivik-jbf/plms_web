import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses, files } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { MAX_COVER_BYTES } from '../src/storage/storage.constants';
import { StorageError } from '../src/storage/storage.port';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { attachCourseCoverViaApi, createCourseViaApi } from './helpers/courses';
import { jpegBytes, mp4Bytes, pngBytes, signIn, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('course covers', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const courseRow = async (id: string) => (await db.select().from(courses).where(eq(courses.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const startCover = (session: Parameters<typeof bearer>[0], courseId: string, body: object) =>
    http().post(`/api/courses/${courseId}/cover`).set(...bearer(session)).send(body);
  const completeCover = (session: Parameters<typeof bearer>[0], courseId: string, fileId: string) =>
    http().post(`/api/courses/${courseId}/cover/${fileId}/complete`).set(...bearer(session));

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session);
    return { owner, other, course };
  }

  it('sets a cover end to end, shows it as a link in the list and the tree, and records it without any storage key', async () => {
    const { owner, other, course } = await setup();
    const body = pngBytes(200);
    const started = await startCover(other.session, course.id, { contentType: 'image/png', sizeBytes: body.length }).expect(201);
    expect(started.body).toEqual({ fileId: expect.any(String), url: expect.stringMatching(/^memory:\/\/put\//), headers: { 'Content-Type': 'image/png' } });
    storage.putObject(started.body.url, body);
    const done = await completeCover(other.session, course.id, started.body.fileId).expect(200);
    expect(done.body).toMatchObject({ id: course.id, coverUrl: expect.stringMatching(/^memory:\/\/get\//), lessons: [] });
    expect((await fileRow(started.body.fileId)).status).toBe('ready');
    expect((await courseRow(course.id)).coverFileId).toBe(started.body.fileId);
    const list = await http().get('/api/courses').set(...bearer(owner.session)).expect(200);
    expect(list.body.find((candidate: { id: string }) => candidate.id === course.id).coverUrl).toMatch(/^memory:\/\/get\//);
    const [entry] = await auditFor('content.course.cover_set', course.id);
    expect(entry).toMatchObject({ actorId: other.user.id, targetType: 'course', targetLabel: course.title });
    expect(JSON.stringify(entry)).not.toMatch(/covers\/|memory:/);
  });

  it.each([
    ['image/jpeg', jpegBytes],
    ['image/webp', webpBytes],
  ] as const)('accepts %s', async (contentType, make) => {
    const { owner, course } = await setup();
    const body = make(100);
    const started = await startCover(owner.session, course.id, { contentType, sizeBytes: body.length }).expect(201);
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
  });

  it('replaces an earlier cover and removes the old file and object', async () => {
    const { owner, course } = await setup();
    const first = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    const firstKey = (await fileRow(first)).storageKey;
    const second = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    expect(await fileRow(first)).toBeUndefined();
    expect(storage.has(firstKey)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBe(second);
    expect(await auditFor('content.course.cover_set', course.id)).toHaveLength(2);
  });

  it('is safe to complete twice', async () => {
    const { owner, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
    expect(await auditFor('content.course.cover_set', course.id)).toHaveLength(1);
  });

  it.each([
    ['an unsupported type', { contentType: 'image/gif', sizeBytes: 10 }],
    ['an empty file', { contentType: 'image/png', sizeBytes: 0 }],
    ['a file over 10 MB', { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES + 1 }],
    ['no type', { sizeBytes: 10 }],
  ])('refuses %s when starting', async (_name, body) => {
    const { owner, course } = await setup();
    await startCover(owner.session, course.id, body).expect(400);
  });

  it('accepts exactly 10 MB when starting', async () => {
    const { owner, course } = await setup();
    await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES }).expect(201);
  });

  it('discards a cover whose bytes are not the declared image type and keeps the old cover', async () => {
    const { owner, course } = await setup();
    const kept = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    const body = mp4Bytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    const key = (await fileRow(started.body.fileId)).storageKey;
    storage.putObject(started.body.url, body);
    const res = await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/JPEG, PNG or WebP/);
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBe(kept);
    expect((await auditFor('file.upload_failed', course.id))[0]).toMatchObject({ targetType: 'course', metadata: { reason: 'bad_image' } });
  });

  it('discards a cover whose size differs from the declared size', async () => {
    const { owner, course } = await setup();
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: 500 });
    storage.putObject(started.body.url, pngBytes(100));
    await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect((await auditFor('file.upload_failed', course.id))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
  });

  it('asks the browser to try again when nothing was uploaded yet, and when the object vanishes during the check', async () => {
    const { owner, course } = await setup();
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: 10 });
    const res = await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/not been uploaded/i);
    expect((await fileRow(started.body.fileId)).status).toBe('pending');

    const body = pngBytes(100);
    const second = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(second.body.url, body);
    const spy = jest.spyOn(storage, 'readRange').mockRejectedValueOnce(new StorageError('not_found', 'No such object.'));
    try {
      await completeCover(owner.session, course.id, second.body.fileId).expect(422);
    } finally {
      spy.mockRestore();
    }
    expect((await fileRow(second.body.fileId)).status).toBe('pending');
    await completeCover(owner.session, course.id, second.body.fileId).expect(200);
  });

  it('is limited to the uploader of the cover (or an Admin), and refuses unknown courses, foreign files and used covers', async () => {
    const { owner, other, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(other.session, course.id, started.body.fileId).expect(403);
    const admin = await signIn(app, db, 'admin');
    await completeCover(admin.session, course.id, started.body.fileId).expect(200);

    const unknown = '00000000-0000-4000-8000-000000000000';
    await startCover(owner.session, unknown, { contentType: 'image/png', sizeBytes: 5 }).expect(404);
    await completeCover(owner.session, unknown, started.body.fileId).expect(404);
    await completeCover(owner.session, course.id, unknown).expect(404);
    await completeCover(owner.session, 'nope', started.body.fileId).expect(400);

    const second = await createCourseViaApi(app, owner.session);
    await completeCover(owner.session, second.id, started.body.fileId).expect(409);
  });

  it('refuses the file of a video or an attachment in place of a cover file', async () => {
    const { owner, course } = await setup();
    const [video] = await db
      .insert(files)
      .values({ purpose: 'video', storageKey: `videos/${randomUUID()}`, originalName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 10, uploadedBy: owner.user.id })
      .returning();
    await completeCover(owner.session, course.id, video.id).expect(404);
  });

  it('removes a cover that was never finished after 24 hours, like any abandoned upload', async () => {
    const { owner, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    const key = (await fileRow(started.body.fileId)).storageKey;
    await db.update(files).set({ createdAt: new Date(Date.now() - 48 * HOUR) }).where(eq(files.id, started.body.fileId));
    await app.get(UploadCleanupService).run();
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBeNull();
  });

  it('never touches the cover of a course during cleanup', async () => {
    const { owner, course } = await setup();
    const cover = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    await db.update(files).set({ createdAt: new Date(Date.now() - 500 * HOUR) }).where(eq(files.id, cover));
    await app.get(UploadCleanupService).run();
    expect((await fileRow(cover)).status).toBe('ready');
    expect((await courseRow(course.id)).coverFileId).toBe(cover);
  });
});
