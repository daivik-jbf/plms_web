import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from '../src/storage/storage.constants';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import {
  attachCoverViaApi,
  completeViaApi,
  jpegBytes,
  m4aBytes,
  mp3Bytes,
  mp3FrameBytes,
  mp4Bytes,
  putPieces,
  seedFolder,
  signIn,
  startUploadViaApi,
  uniqueName,
  uploadVideo,
} from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;
const MP3 = { contentType: 'audio/mpeg', fileName: 'song.mp3' };
const M4A = { contentType: 'audio/mp4', fileName: 'talk.m4a' };
const NOT_AUDIO = 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.';
const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);

describe('uploading to every media category', () => {
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
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];
  const start = (session: Session, folderId: string, overrides: object) =>
    http()
      .post('/api/media/uploads')
      .set(...bearer(session))
      .send({ folderId, title: 'T', fileName: 'a.bin', contentType: 'audio/mpeg', sizeBytes: 100, ...overrides });

  async function setup() {
    const owner = await signIn(app, db);
    return {
      owner,
      songs: await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song'),
      podcasts: await seedFolder(db, owner.user.id, uniqueName('Podcasts'), 'podcast'),
      movies: await seedFolder(db, owner.user.id, uniqueName('Movies'), 'movie'),
      videos: await seedFolder(db, owner.user.id, uniqueName('Videos')),
    };
  }

  describe('starting', () => {
    it('stores a song as an audio file under a random audio/ key that never uses the file name', async () => {
      const { owner, songs } = await setup();
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, fileName: '../../etc/passwd.mp3', sizeBytes: 100 });
      expect(started.partCount).toBe(1);
      const row = await fileRow(started.fileId);
      expect(row).toMatchObject({ purpose: 'audio', contentType: 'audio/mpeg', status: 'pending', originalName: 'etc passwd.mp3' });
      expect(row.storageKey).toMatch(/^audio\/[0-9a-f-]{36}$/);
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'song' });
      expect(JSON.stringify(entry)).not.toContain(row.storageKey);
    });

    it.each([
      ['song', 'songs', 'audio/mpeg', MAX_AUDIO_BYTES, 32],
      ['podcast', 'podcasts', 'audio/mp4', MAX_AUDIO_BYTES, 32],
      ['movie', 'movies', 'video/mp4', MAX_VIDEO_BYTES, 128],
    ] as const)('accepts a %s of exactly the largest size', async (_name, key, contentType, sizeBytes, partCount) => {
      const folders = await setup();
      const started = await startUploadViaApi(app, folders.owner.session, folders[key].id, { contentType, sizeBytes });
      expect(started.partCount).toBe(partCount);
    });

    it.each([
      ['a song one byte over 500 MB', 'songs', { contentType: 'audio/mpeg', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB \(MP3 or M4A\)/],
      ['a podcast one byte over 500 MB', 'podcasts', { contentType: 'audio/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB/],
      ['a movie one byte over 2 GB', 'movies', { contentType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes', /2 GB \(MP4\)/],
      ['an empty song', 'songs', { contentType: 'audio/mpeg', sizeBytes: 0 }, 'sizeBytes', /empty/],
      ['an MP4 video in Songs', 'songs', { contentType: 'video/mp4' }, 'contentType', /MP3 or M4A/],
      ['an MP4 video in Podcasts', 'podcasts', { contentType: 'video/mp4' }, 'contentType', /MP3 or M4A/],
      ['an MP3 in Videos', 'videos', { contentType: 'audio/mpeg' }, 'contentType', /MP4.*HandBrake/],
      ['an M4A in Movies', 'movies', { contentType: 'audio/mp4' }, 'contentType', /MP4.*HandBrake/],
      ['the audio/x-m4a alias', 'songs', { contentType: 'audio/x-m4a' }, 'contentType', /MP3 or M4A/],
      ['the audio/mp3 alias', 'songs', { contentType: 'audio/mp3' }, 'contentType', /MP3 or M4A/],
      ['raw AAC', 'songs', { contentType: 'audio/aac' }, 'contentType', /MP3 or M4A/],
      ['a WAV file', 'podcasts', { contentType: 'audio/wav' }, 'contentType', /MP3 or M4A/],
    ] as const)('refuses %s in plain words and creates nothing', async (_name, key, overrides, field, message) => {
      const folders = await setup();
      const pending = storage.pendingUploadCount();
      const res = await start(folders.owner.session, folders[key].id, overrides).expect(400);
      expect(res.body.fieldErrors[field][0]).toMatch(message);
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(mediaItems).where(eq(mediaItems.folderId, folders[key].id))).toEqual([]);
    });

    it('reports a wrong type and a wrong size together', async () => {
      const { owner, songs } = await setup();
      const res = await start(owner.session, songs.id, { contentType: 'video/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }).expect(400);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['contentType', 'sizeBytes']);
    });

    it('answers 404 for an unknown folder whatever is declared', async () => {
      const { owner } = await setup();
      await start(owner.session, '00000000-0000-4000-8000-000000000000', { contentType: 'video/mp4' }).expect(404);
    });
  });

  describe('finishing', () => {
    it('makes a song with an ID3 tag ready and plays it as audio', async () => {
      const { owner, songs } = await setup();
      const { itemId, fileId, res } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(300), { ...MP3, title: 'Morning song' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, title: 'Morning song', status: 'ready', category: 'song', sizeBytes: 300 });
      expect(await storage.head((await fileRow(fileId)).storageKey)).toEqual({ size: 300, contentType: 'audio/mpeg' });
      expect(await auditFor('content.video.added', itemId)).toEqual([
        expect.objectContaining({ targetType: 'song', metadata: { folderId: songs.id, category: 'song' } }),
      ]);
      expect(await auditFor('file.upload_completed', itemId)).toEqual([expect.objectContaining({ targetType: 'song' })]);
      const play = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(200);
      expect(play.body.contentType).toBe('audio/mpeg');
      expect(storage.get(play.body.url).body).toHaveLength(300);
    });

    it.each([
      ['FF FB', 0xfb],
      ['FF F3', 0xf3],
      ['FF E3', 0xe3],
    ])('accepts an MP3 that starts straight with a frame (%s)', async (_name, second) => {
      const { owner, podcasts } = await setup();
      const { res } = await uploadVideo(app, storage, owner.session, podcasts.id, mp3FrameBytes(second, 200), MP3);
      expect(res.status).toBe(200);
      expect(res.body.category).toBe('podcast');
    });

    it('makes an M4A ready in Songs and an MP4 ready in Movies, each with its own purpose and key', async () => {
      const { owner, songs, movies } = await setup();
      const song = await uploadVideo(app, storage, owner.session, songs.id, m4aBytes(200), M4A);
      expect(song.res.status).toBe(200);
      expect(song.res.body.category).toBe('song');
      expect(await fileRow(song.fileId)).toMatchObject({ purpose: 'audio', contentType: 'audio/mp4' });
      const movie = await uploadVideo(app, storage, owner.session, movies.id, mp4Bytes(200));
      expect(movie.res.body).toMatchObject({ status: 'ready', category: 'movie' });
      const movieFile = await fileRow(movie.fileId);
      expect(movieFile).toMatchObject({ purpose: 'video', contentType: 'video/mp4' });
      expect(movieFile.storageKey).toMatch(/^videos\/[0-9a-f-]{36}$/);
    });

    it.each([
      ['a JPEG declared as MP3', 'songs', MP3, jpegBytes(64)],
      ['a WAV file declared as MP3', 'podcasts', MP3, wavBytes],
      ['an MP3 declared as M4A', 'songs', M4A, mp3Bytes(64)],
      ['a frame sync with only two bits (FF C0)', 'songs', MP3, mp3FrameBytes(0xc0, 64)],
    ] as const)('discards %s, removes its rows and object, and records not_audio', async (_name, key, declared, body) => {
      const folders = await setup();
      const started = await startUploadViaApi(app, folders.owner.session, folders[key].id, { ...declared, sizeBytes: body.length });
      const storageKey = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, folders.owner.session, started.fileId, body);
      const res = await completeViaApi(app, folders.owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(NOT_AUDIO);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(storage.has(storageKey)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry).toMatchObject({ targetType: folders[key].category, metadata: { fileId: started.fileId, reason: 'not_audio' } });
    });

    it('also removes the cover of a song it discards', async () => {
      const { owner, songs } = await setup();
      const body = jpegBytes(64);
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, sizeBytes: body.length });
      const coverId = await attachCoverViaApi(app, storage, owner.session, started.itemId);
      const coverKey = (await fileRow(coverId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(422);
      expect(await fileRow(coverId)).toBeUndefined();
      expect(storage.has(coverKey)).toBe(false);
    });
  });

  describe('resume, cancel and cleanup', () => {
    it('reports, lists and cancels an unfinished song like a video', async () => {
      const { owner, songs } = await setup();
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, title: 'Half a song', sizeBytes: 100 });
      const status = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(status.body).toMatchObject({ fileId: started.fileId, status: 'pending', partCount: 1 });
      const mine = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(mine.body.map((entry: { fileId: string }) => entry.fileId)).toContain(started.fileId);
      const pending = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(pending - 1);
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(await auditFor('file.upload_cancelled', started.itemId)).toEqual([expect.objectContaining({ targetType: 'song' })]);
    });

    it('refuses to cancel a ready song and keeps it', async () => {
      const { owner, songs } = await setup();
      const { itemId, fileId } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
      const res = await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toBe('This upload has already finished. Finished uploads cannot be cancelled here.');
      expect((await itemRow(itemId)).status).toBe('ready');
    });

    it('cleans up an abandoned song and its cover after 24 hours, and never a ready song', async () => {
      const { owner, songs } = await setup();
      const abandoned = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, sizeBytes: 100 });
      const coverId = await attachCoverViaApi(app, storage, owner.session, abandoned.itemId);
      const coverKey = (await fileRow(coverId)).storageKey;
      const ready = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
      await db
        .update(files)
        .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
        .where(inArray(files.id, [abandoned.fileId, ready.fileId]));
      const pending = storage.pendingUploadCount();

      await cleanup.run();
      expect(await itemRow(abandoned.itemId)).toBeUndefined();
      expect(await fileRow(abandoned.fileId)).toBeUndefined();
      expect(await fileRow(coverId)).toBeUndefined();
      expect(storage.has(coverKey)).toBe(false);
      expect(storage.pendingUploadCount()).toBe(pending - 1);
      expect(await auditFor('file.upload_failed', abandoned.itemId)).toEqual([
        expect.objectContaining({ actorId: null, targetType: 'song', metadata: { fileId: abandoned.fileId, reason: 'expired' } }),
      ]);
      expect((await itemRow(ready.itemId)).status).toBe('ready');
    });
  });

  it('never puts links or storage keys in the audit entries of an audio upload', async () => {
    const { owner, songs } = await setup();
    const { itemId, fileId } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rows)).not.toContain((await fileRow(fileId)).storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|audio\/[0-9a-f]{8}-|dev-storage|X-Amz/);
  });
});
