import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import type { Database } from '../src/db/db.module';
import { auditLog, files, topicAttachments } from '../src/db/schema';
import { MAX_AUDIO_BYTES, MAX_COVER_BYTES, MAX_PDF_BYTES, MAX_VIDEO_BYTES, PART_SIZE } from '../src/storage/storage.constants';
import { StorageError } from '../src/storage/storage.port';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedLesson, seedTopic, startAttachmentUploadViaApi, uploadAttachment } from './helpers/courses';
import { completeViaApi, jpegBytes, m4aBytes, mp3Bytes, mp4Bytes, pdfBytes, pngBytes, putPieces, seedFolder, startUploadViaApi, signIn, uniqueName, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const KINDS = {
  video: { contentType: 'video/mp4', fileName: 'Safety film.mp4', bytes: mp4Bytes, max: MAX_VIDEO_BYTES, pieces: 128, prefix: /^videos\//, words: 'video' },
  audio: { contentType: 'audio/mpeg', fileName: 'Briefing.mp3', bytes: mp3Bytes, max: MAX_AUDIO_BYTES, pieces: 32, prefix: /^audio\//, words: 'audio file' },
  pdf: { contentType: 'application/pdf', fileName: 'Exit map.pdf', bytes: pdfBytes, max: MAX_PDF_BYTES, pieces: 4, prefix: /^documents\//, words: 'PDF' },
  image: { contentType: 'image/png', fileName: 'Floor plan.png', bytes: pngBytes, max: MAX_COVER_BYTES, pieces: 1, prefix: /^images\//, words: 'image' },
} as const;

describe('uploading files into a topic', () => {
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
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];
  const start = (session: Session, topicId: string, body: object) =>
    http().post(`/api/topics/${topicId}/attachments/uploads`).set(...bearer(session)).send(body);

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const course = await createCourseViaApi(app, owner.session, { title: 'Fire safety' });
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    return { owner, other, admin, course, topic };
  }

  it('needs a signed-in person', async () => {
    await http().post(`/api/topics/${unknown}/attachments/uploads`).send({}).expect(401);
  });

  describe('starting', () => {
    it.each(Object.entries(KINDS))('creates an uploading %s attachment and a pending file under a random key that never uses the file name', async (kind, rule) => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { fileName: '../../etc/passwd.bin', contentType: rule.contentType, sizeBytes: 100 });
      expect(started).toEqual({ itemId: expect.any(String), fileId: expect.any(String), partSize: PART_SIZE, partCount: 1 });
      const file = await fileRow(started.fileId);
      expect(file).toMatchObject({ purpose: kind, contentType: rule.contentType, status: 'pending', originalName: 'etc passwd.bin', uploadedBy: owner.user.id });
      expect(file.storageKey).toMatch(rule.prefix);
      expect(file.storageKey).toMatch(/\/[0-9a-f-]{36}$/);
      expect(await attachmentRow(started.itemId)).toMatchObject({ topicId: topic.id, kind, status: 'uploading', fileId: started.fileId, libraryItemId: null, title: 'etc passwd', durationSeconds: null });
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'attachment', targetLabel: 'etc passwd', metadata: { fileId: started.fileId, sizeBytes: 100, partCount: 1 } });
      expect(JSON.stringify(entry)).not.toContain(file.storageKey);
    });

    it.each(Object.entries(KINDS))('accepts a %s of exactly the largest size and counts its pieces', async (_kind, rule) => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType: rule.contentType, sizeBytes: rule.max });
      expect(started.partCount).toBe(rule.pieces);
    });

    it.each([
      ['a video one byte over 2 GB', { contentType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes', /2 GB \(MP4\)/],
      ['an audio file one byte over 500 MB', { contentType: 'audio/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB \(MP3 or M4A\)/],
      ['a PDF one byte over 50 MB', { contentType: 'application/pdf', sizeBytes: 52_428_801 }, 'sizeBytes', /PDF files can be at most 50 MB/],
      ['a PNG one byte over 10 MB', { contentType: 'image/png', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB \(JPEG, PNG or WebP\)/],
      ['a JPEG one byte over 10 MB', { contentType: 'image/jpeg', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB/],
      ['a WebP one byte over 10 MB', { contentType: 'image/webp', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB/],
      ['an empty file', { contentType: 'application/pdf', sizeBytes: 0 }, 'sizeBytes', /empty/],
      ['a GIF', { contentType: 'image/gif' }, 'contentType', /MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images/],
      ['a ZIP archive', { contentType: 'application/zip' }, 'contentType', /PDF files/],
      ['the audio/x-m4a alias', { contentType: 'audio/x-m4a' }, 'contentType', /MP3 or M4A/],
      ['a QuickTime movie', { contentType: 'video/quicktime' }, 'contentType', /MP4 videos/],
      ['a type in capital letters', { contentType: 'APPLICATION/PDF' }, 'contentType', /PDF files/],
    ])('refuses %s in plain words and creates nothing', async (_name, overrides, field, message) => {
      const { owner, topic } = await setup();
      const pending = storage.pendingUploadCount();
      const res = await start(owner.session, topic.id, { fileName: 'a.bin', sizeBytes: 100, ...overrides }).expect(400);
      expect(res.body.fieldErrors[field][0]).toMatch(message);
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it('reports a type that is not allowed alone, whatever the size', async () => {
      const { owner, topic } = await setup();
      const res = await start(owner.session, topic.id, { fileName: 'a.zip', contentType: 'application/zip', sizeBytes: 5 * 1024 ** 4 }).expect(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(['contentType']);
    });

    it('makes the title from the file name unless one is given, and keeps hostile text as it is', async () => {
      const { owner, topic } = await setup();
      const fromName = await startAttachmentUploadViaApi(app, owner.session, topic.id, { fileName: 'Exit map.pdf' });
      expect((await attachmentRow(fromName.itemId)).title).toBe('Exit map');
      const given = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: '  Our map ', fileName: 'x.pdf' });
      expect((await attachmentRow(given.itemId)).title).toBe('Our map');
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      const inert = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: hostile });
      expect((await attachmentRow(inert.itemId)).title).toBe(hostile);
      expect((await auditFor('file.upload_started', inert.itemId))[0].targetLabel).toBe(hostile);
      const longest = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'T'.repeat(200) });
      expect((await attachmentRow(longest.itemId)).title).toHaveLength(200);
    });

    it('stores the length when one is given', async () => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType: 'audio/mpeg', fileName: 'a.mp3', durationSeconds: 125 });
      expect((await attachmentRow(started.itemId)).durationSeconds).toBe(125);
    });

    it.each([
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a blank title', { title: '   ' }, 'title'],
      ['a NUL character in the title', { title: 'a\u0000b' }, 'title'],
      ['a NUL character in the file name', { fileName: 'a\u0000.pdf' }, 'fileName'],
      ['a NUL character in the type', { contentType: 'application/pdf\u0000' }, 'contentType'],
      ['no file name', { fileName: '' }, 'fileName'],
      ['no type', { contentType: '' }, 'contentType'],
      ['a fractional size', { sizeBytes: 1.5 }, 'sizeBytes'],
      ['a negative length', { durationSeconds: -1 }, 'durationSeconds'],
    ])('refuses %s with the field named', async (_name, overrides, field) => {
      const { owner, topic } = await setup();
      const res = await start(owner.session, topic.id, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100, ...overrides }).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it('answers 404 for an unknown topic whatever is declared, and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await start(owner.session, unknown, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(404);
      await start(owner.session, unknown, { fileName: 'a.zip', contentType: 'application/zip', sizeBytes: 100 }).expect(404);
      await start(owner.session, 'nope', { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(400);
    });

    it('aborts the storage upload and leaves no rows when the database refuses to start it', async () => {
      const { owner, topic } = await setup();
      const pending = storage.pendingUploadCount();
      const spy = jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('the audit write failed'));
      try {
        await start(owner.session, topic.id, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });
  });

  describe('finishing', () => {
    it.each(Object.entries(KINDS))('makes a %s ready for everyone at the end of the topic, with two audit entries and a sentence', async (kind, rule) => {
      const { owner, other, admin, topic } = await setup();
      const title = uniqueName('Exit file');
      const { itemId, fileId, res } = await uploadAttachment(app, storage, owner.session, topic.id, rule.bytes(300), { contentType: rule.contentType, fileName: rule.fileName, title });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, topicId: topic.id, kind, title, source: 'upload', status: 'ready', sizeBytes: 300, position: 0, libraryItemId: null });
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|uploadId|fileId/);
      expect(await fileRow(fileId)).toMatchObject({ status: 'ready', uploadId: null, completedAt: expect.any(Date) });
      const key = (await fileRow(fileId)).storageKey;
      expect(await storage.head(key)).toEqual({ size: 300, contentType: rule.contentType });
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(detail.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([itemId]);
      expect(await auditFor('file.upload_completed', itemId)).toEqual([expect.objectContaining({ actorId: owner.user.id, targetType: 'attachment', targetLabel: title })]);
      const [added] = await auditFor('content.attachment.added', itemId);
      expect(added).toMatchObject({ metadata: { kind, source: 'upload', topicId: topic.id, topicTitle: 'Fire exits' } });
      expect(JSON.stringify([added, ...(await auditFor('file.upload_completed', itemId))])).not.toMatch(/memory:|videos\/|audio\/|documents\/|images\//);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'content.attachment.added')?.summary).toBe(`Test User added the ${rule.words} '${title}' to the topic 'Fire exits'`);
    });

    it('puts a finished attachment after the ready ones even when it started before them', async () => {
      const { owner, topic } = await setup();
      const slow = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Slow' });
      const first = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'First' });
      const second = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'Second' });
      expect([first.res.body.position, second.res.body.position]).toEqual([0, 1]);
      const parts = await putPieces(app, storage, owner.session, slow.fileId, pdfBytes(100));
      const done = await completeViaApi(app, owner.session, slow.fileId, parts);
      expect(done.body).toMatchObject({ title: 'Slow', position: 2 });
    });

    it('joins several pieces, including a small last piece', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 1024);
      const { fileId, parts, res } = await uploadAttachment(app, storage, owner.session, topic.id, body);
      expect(parts).toHaveLength(2);
      expect(res.status).toBe(200);
      expect(await storage.head((await fileRow(fileId)).storageKey)).toEqual({ size: body.length, contentType: 'application/pdf' });
    });

    it('accepts a PDF that is only its five marker bytes and refuses near misses', async () => {
      const { owner, topic } = await setup();
      const ascii = (text: string) => new Uint8Array([...text].map((character) => character.charCodeAt(0)));
      expect((await uploadAttachment(app, storage, owner.session, topic.id, ascii('%PDF-'))).res.status).toBe(200);
      for (const body of [ascii('%PDF'), ascii(' %PDF-1.4'), ascii('%pdf-1.4'), ascii('%PDF1.4'), new Uint8Array([0x25, 0x50, 0x44, 0x46])]) {
        const attempt = await uploadAttachment(app, storage, owner.session, topic.id, body);
        expect(attempt.res.status).toBe(422);
        expect(attempt.res.body.message).toMatch(/not a valid PDF/);
        expect(await fileRow(attempt.fileId)).toBeUndefined();
        expect(await attachmentRow(attempt.itemId)).toBeUndefined();
      }
    });

    it.each([
      ['a video that is really a PDF', 'video/mp4', 'a.mp4', pdfBytes, 'not_mp4', /MP4/],
      ['an MP3 that is really a JPEG', 'audio/mpeg', 'a.mp3', jpegBytes, 'not_audio', /MP3 or M4A/],
      ['an M4A that is really a PDF', 'audio/mp4', 'a.m4a', pdfBytes, 'not_audio', /MP3 or M4A/],
      ['a PDF that is really an MP4', 'application/pdf', 'a.pdf', mp4Bytes, 'not_pdf', /not a valid PDF/],
      ['a PDF that is really a JPEG', 'application/pdf', 'a.pdf', jpegBytes, 'not_pdf', /not a valid PDF/],
      ['a PNG that is really a PDF', 'image/png', 'a.png', pdfBytes, 'not_image', /JPEG, PNG or WebP/],
      ['a JPEG that is really a PNG', 'image/jpeg', 'a.jpg', pngBytes, 'not_image', /JPEG, PNG or WebP/],
      ['a WebP that is really a JPEG', 'image/webp', 'a.webp', jpegBytes, 'not_image', /JPEG, PNG or WebP/],
    ])('discards %s, removes its rows and its object and records why', async (_name, contentType, fileName, make, reason, message) => {
      const { owner, admin, topic } = await setup();
      const title = uniqueName('Wrong bytes');
      const body = make(64);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType, fileName, title, sizeBytes: body.length });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(message);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await attachmentRow(started.itemId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry).toMatchObject({ targetType: 'attachment', metadata: { fileId: started.fileId, reason } });
      expect(JSON.stringify(entry)).not.toContain(key);
      expect(await auditFor('content.attachment.added', started.itemId)).toEqual([]);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments).toEqual([]);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'file.upload_failed')?.summary).toMatch(/^The upload of .* failed \(the file is not a valid /);
    });

    it('discards a file whose size differs from the declared size', async () => {
      const { owner, topic } = await setup();
      for (const actual of [99, 101]) {
        const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: 100 });
        const parts = await putPieces(app, storage, owner.session, started.fileId, pdfBytes(actual));
        const res = await completeViaApi(app, owner.session, started.fileId, parts);
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/size/i);
        expect(await attachmentRow(started.itemId)).toBeUndefined();
        expect((await auditFor('file.upload_failed', started.itemId))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
      }
    });

    it('is safe to repeat: the second call returns the ready attachment and adds nothing', async () => {
      const { owner, topic } = await setup();
      const { itemId, fileId, parts } = await uploadAttachment(app, storage, owner.session, topic.id);
      const again = await completeViaApi(app, owner.session, fileId, parts);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
      expect(await auditFor('content.attachment.added', itemId)).toHaveLength(1);
    });

    it('is safe when three requests finish the same upload at once', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(300);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const results = await Promise.all([1, 2, 3].map(() => completeViaApi(app, owner.session, started.fileId, parts)));
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(await auditFor('file.upload_completed', started.itemId)).toHaveLength(1);
      expect(await auditFor('content.attachment.added', started.itemId)).toHaveLength(1);
      expect((await attachmentRow(started.itemId)).status).toBe('ready');
    });

    it('refuses while pieces are missing, keeps the upload, and works after the missing piece arrives', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 10);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const first = await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const refused = await completeViaApi(app, owner.session, started.fileId, first);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/missing/i);
      expect((await fileRow(started.fileId)).status).toBe('pending');
      const second = await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      expect((await completeViaApi(app, owner.session, started.fileId, [...second, ...first])).status).toBe(200);
    });

    it('is for the uploader or an Admin only, and 404s once the upload is gone', async () => {
      const { owner, other, admin, topic } = await setup();
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, other.session, started.fileId, parts)).status).toBe(403);
      expect((await completeViaApi(app, admin.session, started.fileId, parts)).status).toBe(200);
      await http().post(`/api/media/uploads/${unknown}/complete`).set(...bearer(owner.session)).send({ parts }).expect(404);
    });

    describe('when the stored file disappears between the size check and the signature check', () => {
      const prepare = async () => {
        const { owner, topic } = await setup();
        const body = pdfBytes(100);
        const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
        const parts = await putPieces(app, storage, owner.session, started.fileId, body);
        return { owner, started, parts };
      };

      it('answers 409 and keeps a pending upload that is still there', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'readRange').mockRejectedValueOnce(new StorageError('not_found', 'No such object.'));
        try {
          const res = await completeViaApi(app, owner.session, started.fileId, parts);
          expect(res.status).toBe(409);
          expect(res.body.message).toMatch(/no longer be continued/);
          expect((await fileRow(started.fileId)).status).toBe('pending');
          expect((await attachmentRow(started.itemId)).status).toBe('uploading');
        } finally {
          spy.mockRestore();
        }
      });

      it('answers 404 when the upload was cancelled in that moment', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'readRange').mockImplementationOnce(async () => {
          await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
          throw new StorageError('not_found', 'No such object.');
        });
        try {
          await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
          expect(await attachmentRow(started.itemId)).toBeUndefined();
        } finally {
          spy.mockRestore();
        }
      });

      it('answers 409, never 500, when the object is gone before the size check', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'head').mockResolvedValueOnce(null);
        try {
          await completeViaApi(app, owner.session, started.fileId, parts).expect(409);
        } finally {
          spy.mockRestore();
        }
        expect((await attachmentRow(started.itemId)).status).toBe('uploading');
      });
    });
  });

  describe('resuming and listing', () => {
    it('reports the pieces, hands out links and refuses a piece number past the end, for the uploader or an Admin', async () => {
      const { owner, other, admin, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 10);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const status = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(status.body).toMatchObject({ fileId: started.fileId, itemId: started.itemId, status: 'pending', partSize: PART_SIZE, partCount: 2, uploadedParts: [{ partNumber: 1, size: PART_SIZE }] });
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(other.session)).expect(403);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(admin.session)).expect(200);
      const links = await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [2] }).expect(200);
      expect(links.body.urls['2']).toMatch(/^memory:\/\/part\//);
      await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [3] }).expect(400);
    });

    it('lists my unfinished attachment uploads with their topic and no folder, newest first, beside library uploads', async () => {
      const { owner, other, topic } = await setup();
      const folder = await seedFolder(db, owner.user.id);
      const library = await startUploadViaApi(app, owner.session, folder.id, { title: 'Library one', sizeBytes: 50 });
      const first = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'First', fileName: 'first.pdf', sizeBytes: 321 });
      const second = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Second', fileName: 'second.pdf', sizeBytes: 123 });
      await startAttachmentUploadViaApi(app, other.session, topic.id);
      await uploadAttachment(app, storage, owner.session, topic.id);
      const res = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(res.body).toEqual([
        { fileId: second.fileId, itemId: second.itemId, folderId: null, topicId: topic.id, title: 'Second', fileName: 'second.pdf', sizeBytes: 123, createdAt: expect.any(String) },
        { fileId: first.fileId, itemId: first.itemId, folderId: null, topicId: topic.id, title: 'First', fileName: 'first.pdf', sizeBytes: 321, createdAt: expect.any(String) },
        { fileId: library.fileId, itemId: library.itemId, folderId: folder.id, topicId: null, title: 'Library one', fileName: 'clip.mp4', sizeBytes: 50, createdAt: expect.any(String) },
      ]);
    });

    it('keeps an attachment that is still uploading out of view of everyone else', async () => {
      const { owner, other, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id);
      const theirs = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(theirs.body.attachments).toEqual([]);
      await http().post(`/api/attachments/${started.itemId}/open`).set(...bearer(other.session)).expect(404);
    });
  });

  describe('cancelling', () => {
    it('removes a pending upload, aborts it in storage and audits it with the attachment as the target', async () => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Half a map' });
      await putPieces(app, storage, owner.session, started.fileId, pdfBytes(100));
      const key = (await fileRow(started.fileId)).storageKey;
      const before = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(before - 1);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await attachmentRow(started.itemId)).toBeUndefined();
      const [entry] = await auditFor('file.upload_cancelled', started.itemId);
      expect(entry).toMatchObject({ targetType: 'attachment', targetLabel: 'Half a map', metadata: { fileId: started.fileId } });
      expect(JSON.stringify(entry)).not.toContain(key);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(404);
    });

    it('never touches a finished attachment', async () => {
      const { owner, topic } = await setup();
      const { itemId, fileId } = await uploadAttachment(app, storage, owner.session, topic.id);
      const key = (await fileRow(fileId)).storageKey;
      const res = await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toMatch(/already finished/);
      expect((await attachmentRow(itemId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    });

    it('lets an Admin cancel anyone\'s upload but not another Staff member', async () => {
      const { owner, other, admin, topic } = await setup();
      const first = await startAttachmentUploadViaApi(app, owner.session, topic.id);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(other.session)).expect(403);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(admin.session)).expect(204);
    });

    it('stops a later finish with 404 instead of resurrecting the attachment', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    });
  });

  it('never puts links or storage keys in any audit entry of these uploads', async () => {
    const { owner, topic } = await setup();
    const { itemId, fileId } = await uploadAttachment(app, storage, owner.session, topic.id);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rows)).not.toContain((await fileRow(fileId)).storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|documents\/|X-Amz|dev-storage/);
  });

  it('keeps an attachment of one topic out of another topic\'s list', async () => {
    const { owner, course, topic } = await setup();
    const lesson = await seedLesson(db, course.id, owner.user.id, 'More', 1);
    const sibling = await seedTopic(db, lesson.id, owner.user.id, 'Other topic');
    const { itemId } = await uploadAttachment(app, storage, owner.session, topic.id);
    const detail = await http().get(`/api/topics/${sibling.id}`).set(...bearer(owner.session)).expect(200);
    expect(detail.body.attachments).toEqual([]);
    expect((await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200)).body.attachments[0].id).toBe(itemId);
  });

  it.each([
    ['webp', webpBytes, 'image/webp', 'Plan.webp'],
    ['m4a', m4aBytes, 'audio/mp4', 'Briefing.m4a'],
  ])('also finishes a %s declared with its own type', async (_name, make, contentType, fileName) => {
    const { owner, topic } = await setup();
    const { res } = await uploadAttachment(app, storage, owner.session, topic.id, make(100), { contentType, fileName });
    expect(res.status).toBe(200);
  });
});
