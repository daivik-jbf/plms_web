import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { mp3Bytes, seedFolder, seedItem, signIn, uniqueName, uploadVideo } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('playing a video', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('needs a signed-in person', async () => {
    await http().post('/api/media/items/00000000-0000-4000-8000-000000000000/play').expect(401);
  });

  it('gives a one-hour link that reads the stored video, and audits the play', async () => {
    const owner = await signIn(app, db);
    const viewer = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Fire exits', sizeBytes: 300, storage });
    const before = Date.now();
    const res = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(viewer.session)).expect(200);
    expect(res.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType: 'video/mp4' });
    expect(Date.parse(res.body.expiresAt) - before).toBeGreaterThan(3_590_000);
    expect(Date.parse(res.body.expiresAt) - before).toBeLessThanOrEqual(3_601_000);
    const fetched = storage.get(res.body.url);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toHaveLength(300);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'playback.played'), eq(auditLog.targetId, itemId)));
    expect(entry).toMatchObject({ actorId: viewer.user.id, targetLabel: 'Fire exits' });
    expect(JSON.stringify(entry)).not.toMatch(/memory:|videos\//);
  });

  it('answers 404 for an unknown or malformed id, and for another person\'s uploading video', async () => {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    await http().post(`/api/media/items/${itemId}/play`).set(...bearer(other.session)).expect(404);
    await http().post('/api/media/items/00000000-0000-4000-8000-000000000000/play').set(...bearer(owner.session)).expect(404);
    await http().post('/api/media/items/nope/play').set(...bearer(owner.session)).expect(400);
    const mine = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(409);
    expect(mine.body.message).toMatch(/still uploading/i);
  });

  it('gives a link for a song with its audio type and records the song as what was played', async () => {
    const owner = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    const { itemId, res } = await uploadVideo(app, storage, owner.session, folder.id, mp3Bytes(120), { contentType: 'audio/mpeg', fileName: 's.mp3', title: 'Morning song' });
    expect(res.status).toBe(200);
    const play = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(200);
    expect(play.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType: 'audio/mpeg' });
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'playback.played'), eq(auditLog.targetId, itemId)));
    expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'song', targetLabel: 'Morning song' });
    expect(JSON.stringify(entry)).not.toMatch(/memory:|audio\/[0-9a-f]{8}-/);
  });
});
