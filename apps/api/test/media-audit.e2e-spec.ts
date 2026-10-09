import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files } from '../src/db/schema';
import { seedAudit } from './helpers/audit';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { attachCoverViaApi, completeViaApi, createFolderViaApi, jpegBytes, mp3Bytes, putPieces, signIn, startUploadViaApi, uniqueName, uploadVideo } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const MP3 = { contentType: 'audio/mpeg', fileName: 'song.mp3' };

describe('audit entries for every media category', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;
  let admin: Session;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
    admin = (await signIn(app, db, 'admin')).session;
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const presented = async (q: string) =>
    (await http().get(`/api/audit?q=${encodeURIComponent(q)}&includePlayback=true&limit=100`).set(...bearer(admin)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];

  it('records the category on every change to a song and words the log with it', async () => {
    const folder = await createFolderViaApi(app, admin, uniqueName('Road trip'), 'songs');
    const title = uniqueName('Morning song');
    const first = await uploadVideo(app, storage, admin, folder.id, mp3Bytes(100), { ...MP3, title });
    expect(first.res.status).toBe(200);
    await http().patch(`/api/media/items/${first.itemId}`).set(...bearer(admin)).send({ description: 'Sung softly' }).expect(200);
    await attachCoverViaApi(app, storage, admin, first.itemId);
    const second = await uploadVideo(app, storage, admin, folder.id, mp3Bytes(100), { ...MP3, title: uniqueName('Evening song') });
    await http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(admin)).send({ ids: [second.itemId, first.itemId] }).expect(200);
    await http().post(`/api/media/items/${first.itemId}/play`).set(...bearer(admin)).expect(200);

    const rows = await db.select().from(auditLog).where(inArray(auditLog.targetId, [first.itemId, folder.id]));
    const of = (action: string) => rows.filter((row) => row.action === action);
    for (const action of ['content.video.added', 'content.video.edited', 'content.video.cover_set']) {
      expect(of(action)).toEqual([expect.objectContaining({ targetType: 'song', metadata: expect.objectContaining({ category: 'song' }) })]);
    }
    expect(of('content.video.reordered')).toEqual([expect.objectContaining({ targetType: 'folder', metadata: { category: 'song' } })]);
    expect(of('playback.played')).toEqual([expect.objectContaining({ targetType: 'song' })]);
    const [{ storageKey }] = await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.id, first.fileId));
    expect(JSON.stringify(rows)).not.toContain(storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|covers\/|dev-storage/);

    const items = await presented(title);
    const sentence = (action: string) => items.find((item) => item.action === action);
    expect(sentence('content.video.added')).toMatchObject({ label: 'Item added', summary: `Test User added the song ${title}` });
    expect(sentence('content.video.edited')).toMatchObject({ label: 'Item edited', summary: `Test User edited the song ${title}` });
    expect(sentence('content.video.cover_set')).toMatchObject({ label: 'Cover set', summary: `Test User set the cover image of the song ${title}` });
    expect(sentence('playback.played')).toMatchObject({ label: 'Played', summary: `Test User played ${title}` });
    expect((await presented(folder.name)).find((item) => item.action === 'content.video.reordered')).toMatchObject({
      label: 'Items reordered',
      summary: `Test User changed the order of the songs in ${folder.name}`,
    });
  });

  it('still describes entries written before this milestone as videos', async () => {
    const label = uniqueName('Old');
    await seedAudit(db, [
      { action: 'content.video.added', actorLabel: 'old@example.org', targetType: 'video', targetId: randomUUID(), targetLabel: label, metadata: { folderId: randomUUID() } },
      { action: 'content.video.reordered', actorLabel: 'old@example.org', targetType: 'folder', targetId: randomUUID(), targetLabel: label },
    ]);
    const items = await presented(label);
    expect(items.map((item) => item.summary).sort()).toEqual(
      [`old@example.org added the video ${label}`, `old@example.org changed the order of the videos in ${label}`].sort(),
    );
    expect(items.map((item) => item.label).sort()).toEqual(['Item added', 'Items reordered']);
  });

  it('explains a podcast that was not really audio', async () => {
    const folder = await createFolderViaApi(app, admin, uniqueName('Weekly'), 'podcasts');
    const title = uniqueName('Episode');
    const body = jpegBytes(64);
    const started = await startUploadViaApi(app, admin, folder.id, { ...MP3, title, sizeBytes: body.length });
    const parts = await putPieces(app, storage, admin, started.fileId, body);
    expect((await completeViaApi(app, admin, started.fileId, parts)).status).toBe(422);
    const failed = (await presented(title)).find((item) => item.action === 'file.upload_failed');
    expect(failed).toMatchObject({ label: 'Upload failed', summary: `The upload of ${title} failed (the file is not a valid MP3 or M4A)` });
  });
});
