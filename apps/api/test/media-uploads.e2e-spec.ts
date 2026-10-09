import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { MAX_VIDEO_BYTES, MIN_PART_SIZE, PART_SIZE } from '../src/storage/storage.constants';
import { StorageError } from '../src/storage/storage.port';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import {
  completeViaApi,
  mp4Bytes,
  pngBytes,
  putPieces,
  seedFolder,
  seedItem,
  signIn,
  startUploadViaApi,
  uploadVideo,
} from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('uploading videos', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    return { owner, other, admin, folder };
  }

  it('needs a signed-in person on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await http().post('/api/media/uploads').send({}).expect(401);
    await http().get('/api/media/uploads/mine').expect(401);
    await http().get(`/api/media/uploads/${id}`).expect(401);
    await http().post(`/api/media/uploads/${id}/part-urls`).send({}).expect(401);
    await http().post(`/api/media/uploads/${id}/complete`).send({}).expect(401);
    await http().delete(`/api/media/uploads/${id}`).expect(401);
  });

  describe('starting', () => {
    it('creates an uploading video and a pending file, audits it, and reports the piece arithmetic', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { title: '  Fire exits ', description: 'About exits', sizeBytes: 100, durationSeconds: 12 });
      expect(started).toEqual({ itemId: expect.any(String), fileId: expect.any(String), partSize: PART_SIZE, partCount: 1 });
      expect(await itemRow(started.itemId)).toMatchObject({ title: 'Fire exits', description: 'About exits', status: 'uploading', durationSeconds: 12, createdBy: owner.user.id });
      expect(await fileRow(started.fileId)).toMatchObject({ purpose: 'video', status: 'pending', sizeBytes: 100, partCount: 1, partSize: PART_SIZE, contentType: 'video/mp4' });
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetLabel: 'Fire exits' });
      expect(JSON.stringify(entry)).not.toMatch(/videos\/|memory:/);
    });

    it.each([
      [1, 1],
      [PART_SIZE, 1],
      [PART_SIZE + 1, 2],
      [MAX_VIDEO_BYTES, 128],
    ])('a %i byte video is %i piece(s), and exactly 2 GiB is accepted', async (sizeBytes, partCount) => {
      const { owner, folder } = await setup();
      expect((await startUploadViaApi(app, owner.session, folder.id, { sizeBytes })).partCount).toBe(partCount);
    });

    it.each([
      ['empty file', { sizeBytes: 0 }, 'sizeBytes'],
      ['negative size', { sizeBytes: -5 }, 'sizeBytes'],
      ['over 2 GiB', { sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes'],
      ['fractional size', { sizeBytes: 1.5 }, 'sizeBytes'],
      ['text size', { sizeBytes: '100' }, 'sizeBytes'],
      ['not an MP4', { contentType: 'video/webm' }, 'contentType'],
      ['blank type', { contentType: '' }, 'contentType'],
      ['empty title', { title: '  ' }, 'title'],
      ['long title', { title: 'x'.repeat(201) }, 'title'],
      ['long description', { description: 'x'.repeat(2001) }, 'description'],
      ['no file name', { fileName: '' }, 'fileName'],
      ['negative length', { durationSeconds: -1 }, 'durationSeconds'],
    ])('refuses %s', async (_name, overrides, field) => {
      const { owner, folder } = await setup();
      const res = await http()
        .post('/api/media/uploads')
        .set(...bearer(owner.session))
        .send({ folderId: folder.id, title: 'T', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100, ...overrides })
        .expect(400);
      expect(res.body.fieldErrors[field]).toBeDefined();
    });

    it('explains how to convert a non-MP4 file', async () => {
      const { owner, folder } = await setup();
      const res = await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ folderId: folder.id, title: 'T', fileName: 'a.mov', contentType: 'video/quicktime', sizeBytes: 5 }).expect(400);
      expect(res.body.fieldErrors.contentType[0]).toMatch(/HandBrake/);
    });

    it('404s for an unknown folder and 400s for a malformed folder id', async () => {
      const { owner } = await setup();
      const body = { title: 'T', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 5 };
      await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ ...body, folderId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ ...body, folderId: 'nope' }).expect(400);
    });

    it('stores a sanitized display name and never lets it near the storage key', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { fileName: '../../etc/passwd' });
      const row = await fileRow(started.fileId);
      expect(row.originalName).toBe('etc passwd');
      expect(row.storageKey).toMatch(/^videos\/[0-9a-f-]{36}$/);
    });

    it('puts a new video at the end of the folder', async () => {
      const { owner, folder } = await setup();
      await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 4 });
      const started = await startUploadViaApi(app, owner.session, folder.id);
      expect((await itemRow(started.itemId)).position).toBe(5);
    });
  });

  describe('piece links', () => {
    it('hands out links for the pieces asked for, and not for pieces that cannot exist', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: PART_SIZE * 2 + 1 });
      const post = (partNumbers: unknown) => http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers });
      const ok = await post([1, 3]).expect(200);
      expect(Object.keys(ok.body.urls)).toEqual(['1', '3']);
      await post([4]).expect(400);
      await post([0]).expect(400);
      await post([]).expect(400);
      await post(Array.from({ length: 17 }, (_, index) => (index % 3) + 1)).expect(400);
      await post(['1']).expect(400);
      await post(Array.from({ length: 16 }, (_, index) => (index % 3) + 1)).expect(200);
    });

    it('is for the uploader or an Admin only', async () => {
      const { owner, other, admin, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      const post = (session: typeof owner.session) => http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(session)).send({ partNumbers: [1] });
      await post(other.session).expect(403);
      await post(admin.session).expect(200);
      await post(owner.session).expect(200);
      await http().post('/api/media/uploads/00000000-0000-4000-8000-000000000000/part-urls').set(...bearer(owner.session)).send({ partNumbers: [1] }).expect(404);
      await http().post('/api/media/uploads/nope/part-urls').set(...bearer(owner.session)).send({ partNumbers: [1] }).expect(400);
    });
  });

  describe('resuming', () => {
    it('reports the pieces storage holds, even if the browser forgot them', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 10);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      const res = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ fileId: started.fileId, itemId: started.itemId, status: 'pending', partSize: PART_SIZE, partCount: 2 });
      expect(res.body.uploadedParts).toEqual([{ partNumber: 2, size: 10, etag: expect.any(String) }]);
    });

    it('is for the uploader or an Admin only', async () => {
      const { owner, other, admin, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(other.session)).expect(403);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(admin.session)).expect(200);
    });

    it('lists only my unfinished uploads', async () => {
      const { owner, other, folder } = await setup();
      const mine = await startUploadViaApi(app, owner.session, folder.id, { title: 'Mine', fileName: 'mine.mp4', sizeBytes: 321 });
      await startUploadViaApi(app, other.session, folder.id);
      const finished = await uploadVideo(app, storage, owner.session, folder.id);
      expect(finished.res.status).toBe(200);
      const res = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(res.body).toEqual([
        { fileId: mine.fileId, itemId: mine.itemId, folderId: folder.id, title: 'Mine', fileName: 'mine.mp4', sizeBytes: 321, createdAt: expect.any(String) },
      ]);
    });
  });

  describe('finishing', () => {
    it('makes the video ready for everyone, at the end of the folder, with two audit entries', async () => {
      const { owner, other, folder } = await setup();
      await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 3 });
      const { itemId, fileId, res } = await uploadVideo(app, storage, owner.session, folder.id, mp4Bytes(200), { title: 'Fire exits' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, title: 'Fire exits', status: 'ready', sizeBytes: 200, position: 4 });
      expect(await fileRow(fileId)).toMatchObject({ status: 'ready', uploadId: null, completedAt: expect.any(Date) });
      const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(other.session)).expect(200);
      expect(list.body.map((item: { id: string }) => item.id)).toContain(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
      expect(await auditFor('content.video.added', itemId)).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/videos\/|storageKey|uploadId/);
    });

    it('joins several pieces, including a small last piece', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 1024);
      const { fileId, parts, res } = await uploadVideo(app, storage, owner.session, folder.id, body);
      expect(parts).toHaveLength(2);
      expect(res.status).toBe(200);
      const key = (await fileRow(fileId)).storageKey;
      expect(await storage.head(key)).toEqual({ size: body.length, contentType: 'video/mp4' });
    });

    it('is safe to repeat: the second call returns the ready video and adds nothing', async () => {
      const { owner, folder } = await setup();
      const { itemId, fileId, parts } = await uploadVideo(app, storage, owner.session, folder.id);
      const again = await completeViaApi(app, owner.session, fileId, parts);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
    });

    it('is safe when two requests finish the same upload at once', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(300);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const results = await Promise.all([
        completeViaApi(app, owner.session, started.fileId, parts),
        completeViaApi(app, owner.session, started.fileId, parts),
        completeViaApi(app, owner.session, started.fileId, parts),
      ]);
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(await auditFor('file.upload_completed', started.itemId)).toHaveLength(1);
      expect(await auditFor('content.video.added', started.itemId)).toHaveLength(1);
      expect((await itemRow(started.itemId)).status).toBe('ready');
    });

    it('refuses while pieces are missing, keeps the upload, and works after the missing piece arrives', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 10);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const first = await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const refused = await completeViaApi(app, owner.session, started.fileId, first);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/missing/i);
      expect((await fileRow(started.fileId)).status).toBe('pending');
      const second = await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      expect((await completeViaApi(app, owner.session, started.fileId, [...second, ...first])).status).toBe(200);
    });

    it('refuses a wrong receipt without damaging the upload', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const wrong = await completeViaApi(app, owner.session, started.fileId, [{ partNumber: 1, etag: '"wrong"' }]);
      expect(wrong.status).toBe(422);
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(200);
    });

    it('refuses a first piece under 5 MiB when there are two pieces, and keeps the upload', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: PART_SIZE + 10 });
      const urls = (await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [1, 2] })).body.urls;
      const parts = [
        { partNumber: 1, etag: storage.putPart(urls['1'], mp4Bytes(MIN_PART_SIZE - 1)).etag },
        { partNumber: 2, etag: storage.putPart(urls['2'], new Uint8Array(10)).etag },
      ];
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(422);
      expect((await fileRow(started.fileId)).status).toBe('pending');
    });

    it.each([
      ['more bytes than declared', 150, 100, 'size_mismatch'],
      ['fewer bytes than declared', 60, 100, 'size_mismatch'],
    ])('discards a file with %s, removes its rows and records why', async (_name, actualSize, declaredSize, reason) => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: declaredSize });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(actualSize));
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/size/i);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry.metadata).toMatchObject({ reason });
      const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session));
      expect(list.body.map((item: { id: string }) => item.id)).not.toContain(started.itemId);
    });

    it('discards a file that is not an MP4 even though it was declared as one', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: 64 });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, pngBytes(64));
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/MP4/);
      expect(storage.has(key)).toBe(false);
      expect((await auditFor('file.upload_failed', started.itemId))[0].metadata).toMatchObject({ reason: 'not_mp4' });
    });

    it('is for the uploader or an Admin only, and 404s once the upload is gone', async () => {
      const { owner, other, admin, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, other.session, started.fileId, parts)).status).toBe(403);
      expect((await completeViaApi(app, admin.session, started.fileId, parts)).status).toBe(200);
      await http().post('/api/media/uploads/00000000-0000-4000-8000-000000000000/complete').set(...bearer(owner.session)).send({ parts }).expect(404);
    });

    describe('when the stored file disappears between the size check and the signature check', () => {
      const prepare = async () => {
        const { owner, folder } = await setup();
        const body = mp4Bytes(100);
        const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
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
          expect((await itemRow(started.itemId)).status).toBe('uploading');
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
          expect(await itemRow(started.itemId)).toBeUndefined();
        } finally {
          spy.mockRestore();
        }
      });
    });

    it('rejects a malformed list of pieces', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      const post = (body: object) => http().post(`/api/media/uploads/${started.fileId}/complete`).set(...bearer(owner.session)).send(body);
      await post({}).expect(400);
      await post({ parts: [] }).expect(400);
      await post({ parts: [{ partNumber: 1 }] }).expect(400);
      await post({ parts: [{ partNumber: 0, etag: 'x' }] }).expect(400);
      await post({ parts: [{ partNumber: 1, etag: 'x' }, { partNumber: 1, etag: 'x' }] }).expect(422);
    });
  });

  describe('cancelling', () => {
    it('removes a pending upload, aborts it in storage and audits it', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(100));
      const before = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(before - 1);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(await auditFor('file.upload_cancelled', started.itemId)).toHaveLength(1);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(404);
    });

    it('lets an Admin cancel anyone\'s upload but not another Staff member', async () => {
      const { owner, other, admin, folder } = await setup();
      const first = await startUploadViaApi(app, owner.session, folder.id);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(other.session)).expect(403);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(admin.session)).expect(204);
    });

    it('never touches a finished video', async () => {
      const { owner, folder } = await setup();
      const { itemId, fileId } = await uploadVideo(app, storage, owner.session, folder.id);
      const key = (await fileRow(fileId)).storageKey;
      await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect((await itemRow(itemId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    });

    it('stops a later finish with 404 instead of resurrecting the video', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    });
  });

  it('settles cleanly when a cancel and a finish race: either the video is ready or everything is gone', async () => {
    const { owner, folder } = await setup();
    for (let round = 0; round < 12; round += 1) {
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const [finish, cancel] = await Promise.all([
        completeViaApi(app, owner.session, started.fileId, parts),
        http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)),
      ]);
      if (finish.status === 200) {
        expect(cancel.status).toBe(409);
        expect((await itemRow(started.itemId)).status).toBe('ready');
        expect(storage.has(key)).toBe(true);
      } else {
        expect([finish.status, cancel.status]).toEqual([404, 204]);
        expect(await itemRow(started.itemId)).toBeUndefined();
        expect(await fileRow(started.fileId)).toBeUndefined();
        expect(storage.has(key)).toBe(false);
      }
    }
  });

  it('never puts links or storage keys in any audit entry of these uploads', async () => {
    const { owner, folder } = await setup();
    const { itemId, fileId } = await uploadVideo(app, storage, owner.session, folder.id);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const key = (await fileRow(fileId)).storageKey;
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|videos\/|X-Amz|dev-storage/);
  });
});
