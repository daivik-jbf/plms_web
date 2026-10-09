import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import type { InMemoryStorage } from './support/in-memory-storage';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedFolder, seedItem, signIn } from './helpers/media';

describe('videos in a folder', () => {
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

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    return { owner, other, admin, folder };
  }

  it('needs a signed-in person', async () => {
    const { folder } = await setup();
    await http().get(`/api/media/folders/${folder.id}/items`).expect(401);
    await http().patch('/api/media/items/00000000-0000-4000-8000-000000000000').send({ title: 'x' }).expect(401);
  });

  it('lists videos in order with size, uploader and a cover link, and never exposes storage keys', async () => {
    const { owner, folder } = await setup();
    const second = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Second', position: 1, sizeBytes: 2048, storage });
    const first = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'First', position: 0, withCover: true, durationSeconds: 90, description: 'Hello', storage });
    const res = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(res.body.map((item: { id: string }) => item.id)).toEqual([first.itemId, second.itemId]);
    expect(res.body[0]).toEqual({
      id: first.itemId,
      folderId: folder.id,
      title: 'First',
      description: 'Hello',
      durationSeconds: 90,
      sizeBytes: 64,
      status: 'ready',
      coverUrl: expect.stringMatching(/^memory:\/\/get\//),
      createdBy: { id: owner.user.id, name: 'Test User' },
      createdAt: expect.any(String),
      position: 0,
    });
    expect(res.body[1].coverUrl).toBeNull();
    expect(res.body[1].sizeBytes).toBe(2048);
    expect(JSON.stringify(res.body)).not.toMatch(/videos\/|covers\/|storageKey/);
  });

  it('hides other people\'s uploading videos, including from Admins, but shows your own', async () => {
    const { owner, other, admin, folder } = await setup();
    const ready = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Ready' });
    const uploading = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Mine', status: 'uploading' });
    const idsFor = async (who: { session: Parameters<typeof bearer>[0] }) =>
      ((await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(who.session)).expect(200)).body as { id: string }[]).map((item) => item.id);
    expect(await idsFor(owner)).toEqual([ready.itemId, uploading.itemId]);
    expect(await idsFor(other)).toEqual([ready.itemId]);
    expect(await idsFor(admin)).toEqual([ready.itemId]);
    const own = (await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session))).body[1];
    expect(own.status).toBe('uploading');
  });

  it('answers 404 for an unknown folder and 400 for a malformed id', async () => {
    const { owner } = await setup();
    await http().get('/api/media/folders/00000000-0000-4000-8000-000000000000/items').set(...bearer(owner.session)).expect(404);
    await http().get('/api/media/folders/nope/items').set(...bearer(owner.session)).expect(400);
  });

  it('counts only ready videos in the folder list', async () => {
    const { owner, folder } = await setup();
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id });
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    const folders = (await http().get('/api/media/videos/folders').set(...bearer(owner.session)).expect(200)).body as { id: string; itemCount: number }[];
    expect(folders.find((candidate) => candidate.id === folder.id)?.itemCount).toBe(1);
  });

  it('edits title and description, trims them, and records before and after', async () => {
    const { owner, other, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Old', description: 'Old text' });
    const res = await http().patch(`/api/media/items/${itemId}`).set(...bearer(other.session)).send({ title: '  New  ', description: ' New text ' }).expect(200);
    expect(res.body).toMatchObject({ id: itemId, title: 'New', description: 'New text' });
    const [entry] = await auditFor('content.video.edited', itemId);
    expect(entry.actorId).toBe(other.user.id);
    expect(entry.changes).toEqual({ title: { before: 'Old', after: 'New' }, description: { before: 'Old text', after: 'New text' } });
    expect(entry.targetLabel).toBe('New');
  });

  it('clears the description with an empty string and does not audit an unchanged edit', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Same', description: 'Text' });
    const cleared = await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ description: '' }).expect(200);
    expect(cleared.body.description).toBeNull();
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ title: 'Same', description: null }).expect(200);
    expect(await auditFor('content.video.edited', itemId)).toHaveLength(1);
  });

  it('rejects an empty, over-long or missing change, and keeps hostile text inert', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id });
    const patch = (body: object) => http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send(body);
    expect((await patch({ title: '' }).expect(400)).body.fieldErrors.title).toBeDefined();
    await patch({ title: '   ' }).expect(400);
    await patch({ title: 'x'.repeat(201) }).expect(400);
    await patch({ description: 'x'.repeat(2001) }).expect(400);
    await patch({}).expect(400);
    await patch({ title: 'x'.repeat(200) }).expect(200);
    const hostile = '<script>alert(1)</script>';
    expect((await patch({ title: hostile, description: hostile }).expect(200)).body).toMatchObject({ title: hostile, description: hostile });
  });

  it('treats another person\'s uploading video as not found for edits', async () => {
    const { owner, other, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(other.session)).send({ title: 'x' }).expect(404);
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ title: 'Mine' }).expect(200);
    await http().patch('/api/media/items/00000000-0000-4000-8000-000000000000').set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
    await http().patch('/api/media/items/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
  });

  it('reorders exactly the ready videos of the folder and leaves uploading ones out', async () => {
    const { owner, folder } = await setup();
    const a = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 0 });
    const b = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 1 });
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 2, status: 'uploading' });
    const put = (body: object) => http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(owner.session)).send(body);
    const res = await put({ ids: [b.itemId, a.itemId] }).expect(200);
    expect(res.body.map((item: { id: string }) => item.id).slice(0, 2)).toEqual([b.itemId, a.itemId]);
    const [entry] = await auditFor('content.video.reordered', folder.id);
    expect(entry.targetLabel).toBe(folder.name);
    await put({ ids: [b.itemId, a.itemId] }).expect(200);
    expect(await auditFor('content.video.reordered', folder.id)).toHaveLength(1);
  });

  it('refuses an order that is missing, repeats, invents or includes another folder\'s video', async () => {
    const { owner, folder } = await setup();
    const a = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 0 });
    const b = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 1 });
    const elsewhere = await seedItem(db, { folderId: (await seedFolder(db, owner.user.id)).id, createdBy: owner.user.id });
    const put = (body: object) => http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(owner.session)).send(body);
    await put({ ids: [a.itemId] }).expect(409);
    await put({ ids: [a.itemId, a.itemId] }).expect(409);
    await put({ ids: [a.itemId, b.itemId, elsewhere.itemId] }).expect(409);
    await put({ ids: [a.itemId, elsewhere.itemId] }).expect(409);
    await put({ ids: ['x'] }).expect(400);
    await http().put('/api/media/folders/00000000-0000-4000-8000-000000000000/items/order').set(...bearer(owner.session)).send({ ids: [] }).expect(404);
  });
});
