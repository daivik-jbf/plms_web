import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createFolderViaApi, seedFolder, seedItem, signIn, uniqueName } from './helpers/media';

describe('media folders', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  it('needs a signed-in person, and lets both Staff and Admin in', async () => {
    await http().get('/api/media/videos/folders').expect(401);
    await http().post('/api/media/videos/folders').send({ name: 'x' }).expect(401);
    for (const role of ['staff', 'admin'] as const) {
      const { session } = await signIn(app, db, role);
      await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200);
    }
  });

  it('creates a folder at the end, lists it with zero videos, and audits it', async () => {
    const { user, session } = await signIn(app, db);
    const first = await createFolderViaApi(app, session);
    const second = await createFolderViaApi(app, session);
    expect(second.position).toBeGreaterThan(first.position);
    expect(first).toMatchObject({ id: expect.any(String), name: expect.any(String), position: expect.any(Number), itemCount: 0, sizeBytes: 0, category: 'video' });
    const list = (await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body;
    const ids = list.map((folder: { id: string }) => folder.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    const [entry] = await auditFor('content.folder.created', first.id);
    expect(entry).toMatchObject({ actorId: user.id, targetType: 'folder', targetLabel: first.name });
  });

  it('trims the name, and rejects an empty, blank, over-long or non-text name', async () => {
    const { session } = await signIn(app, db);
    const trimmed = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: `  ${uniqueName()}  ` }).expect(201);
    expect(trimmed.body.name).toBe(trimmed.body.name.trim());
    for (const name of ['', '   ', 'x'.repeat(101), 5, null]) {
      const res = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name }).expect(400);
      expect(res.body.fieldErrors.name).toBeDefined();
    }
    await http().post('/api/media/videos/folders').set(...bearer(session)).send({}).expect(400);
    const nul = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: 'a\u0000b' }).expect(400);
    expect(nul.body.fieldErrors.name).toBeDefined();
    await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: 'x'.repeat(100) }).expect(201);
  });

  it('stores hostile names as inert text', async () => {
    const { session } = await signIn(app, db);
    const name = `<img src=x onerror=alert(1)> ${uniqueName()}`;
    const created = await createFolderViaApi(app, session, name);
    expect(created.name).toBe(name);
  });

  it('refuses a duplicate name ignoring case with 409', async () => {
    const { session } = await signIn(app, db);
    const name = uniqueName();
    await createFolderViaApi(app, session, name);
    const res = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: name.toUpperCase() }).expect(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('renames, records before and after, and does nothing when the name is unchanged', async () => {
    const { session } = await signIn(app, db);
    const folder = await createFolderViaApi(app, session);
    const newName = uniqueName('Renamed');
    const renamed = await http().patch(`/api/media/folders/${folder.id}`).set(...bearer(session)).send({ name: newName }).expect(200);
    expect(renamed.body).toMatchObject({ id: folder.id, name: newName });
    const [entry] = await auditFor('content.folder.renamed', folder.id);
    expect(entry.changes).toEqual({ name: { before: folder.name, after: newName } });
    await http().patch(`/api/media/folders/${folder.id}`).set(...bearer(session)).send({ name: newName }).expect(200);
    expect(await auditFor('content.folder.renamed', folder.id)).toHaveLength(1);
  });

  it('allows changing only the capitals of a name, and refuses another folder\'s name', async () => {
    const { session } = await signIn(app, db);
    const a = await createFolderViaApi(app, session, uniqueName('alpha'));
    const b = await createFolderViaApi(app, session);
    await http().patch(`/api/media/folders/${a.id}`).set(...bearer(session)).send({ name: a.name.toUpperCase() }).expect(200);
    await http().patch(`/api/media/folders/${a.id}`).set(...bearer(session)).send({ name: b.name.toLowerCase() }).expect(409);
  });

  it('shows who made a folder and who last changed it, with the dates', async () => {
    const creator = await signIn(app, db);
    const editor = await signIn(app, db, 'admin');
    const created = await createFolderViaApi(app, creator.session);
    expect(created).toMatchObject({ createdBy: { id: creator.user.id, name: creator.user.name }, updatedBy: { id: creator.user.id, name: creator.user.name } });
    expect(created.updatedAt).toBe(created.createdAt);

    const renamed = await http().patch(`/api/media/folders/${created.id}`).set(...bearer(editor.session)).send({ name: uniqueName('Renamed') }).expect(200);
    expect(renamed.body.createdBy).toEqual({ id: creator.user.id, name: creator.user.name });
    expect(renamed.body.updatedBy).toEqual({ id: editor.user.id, name: editor.user.name });
    expect(new Date(renamed.body.updatedAt).getTime()).toBeGreaterThan(new Date(renamed.body.createdAt).getTime());
    expect(renamed.body.createdAt).toBe(created.createdAt);
  });

  it('adds up the size of the ready videos and covers, and leaves out an upload in progress', async () => {
    const { user, session } = await signIn(app, db);
    const folder = await seedFolder(db, user.id);
    await seedItem(db, { folderId: folder.id, createdBy: user.id, sizeBytes: 1000 });
    await seedItem(db, { folderId: folder.id, createdBy: user.id, sizeBytes: 500, withCover: true });
    await seedItem(db, { folderId: folder.id, createdBy: user.id, sizeBytes: 9999, status: 'uploading' });
    const list = (await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string; itemCount: number; sizeBytes: number }[];
    const found = list.find((candidate) => candidate.id === folder.id);
    expect(found?.itemCount).toBe(2);
    expect(found?.sizeBytes).toBe(1000 + 500 + 64); // the 64-byte cover is counted too
  });

  it('answers 404 for an unknown folder and 400 for a malformed id', async () => {
    const { session } = await signIn(app, db);
    await http().patch('/api/media/folders/00000000-0000-4000-8000-000000000000').set(...bearer(session)).send({ name: 'x' }).expect(404);
    await http().patch('/api/media/folders/nope').set(...bearer(session)).send({ name: 'x' }).expect(400);
  });

  describe('categories', () => {
    it.each([
      ['videos', 'video'],
      ['movies', 'movie'],
      ['podcasts', 'podcast'],
      ['songs', 'song'],
    ] as const)('creates, lists and renames %s folders, each marked with its category', async (slug, category) => {
      const { session } = await signIn(app, db);
      const first = await createFolderViaApi(app, session, uniqueName(), slug);
      await createFolderViaApi(app, session, uniqueName(), slug);
      expect(first).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        position: expect.any(Number),
        itemCount: 0,
        sizeBytes: 0,
        category,
        createdAt: expect.any(String),
        createdBy: { id: expect.any(String), name: expect.any(String) },
        updatedAt: expect.any(String),
        updatedBy: { id: expect.any(String), name: expect.any(String) },
      });
      const list = (await http().get(`/api/media/${slug}/folders`).set(...bearer(session)).expect(200)).body as { id: string; category: string }[];
      expect(list.map((folder) => folder.id)).toContain(first.id);
      expect(new Set(list.map((folder) => folder.category))).toEqual(new Set([category]));
      const renamed = await http().patch(`/api/media/folders/${first.id}`).set(...bearer(session)).send({ name: uniqueName('Renamed') }).expect(200);
      expect(renamed.body.category).toBe(category);
    });

    it("keeps each category's folders apart, and lets the same name exist in two categories", async () => {
      const { session } = await signIn(app, db);
      const name = uniqueName('Shared');
      const song = await createFolderViaApi(app, session, name, 'songs');
      const movie = await createFolderViaApi(app, session, name, 'movies');
      const songs = ((await http().get('/api/media/songs/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id);
      const videos = ((await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id);
      expect(songs).toContain(song.id);
      expect(songs).not.toContain(movie.id);
      expect(videos).not.toContain(song.id);
      expect(videos).not.toContain(movie.id);
      await http().post('/api/media/songs/folders').set(...bearer(session)).send({ name: name.toUpperCase() }).expect(409);
    });

    it('answers 404 for any other category, after checking sign-in', async () => {
      const { session } = await signIn(app, db);
      for (const slug of ['music', 'video', 'Videos', 'SONGS', 'constructor', '__proto__', 'toString', 'folders']) {
        await http().get(`/api/media/${slug}/folders`).set(...bearer(session)).expect(404);
        await http().post(`/api/media/${slug}/folders`).set(...bearer(session)).send({ name: uniqueName() }).expect(404);
      }
      await http().get('/api/media/music/folders').expect(401);
    });

    it('records the category of every folder change', async () => {
      const { user, session } = await signIn(app, db);
      const created = await createFolderViaApi(app, session, uniqueName(), 'podcasts');
      const [entry] = await auditFor('content.folder.created', created.id);
      expect(entry).toMatchObject({ actorId: user.id, targetType: 'folder', metadata: { category: 'podcast' } });
      await http().patch(`/api/media/folders/${created.id}`).set(...bearer(session)).send({ name: uniqueName('Renamed') }).expect(200);
      expect((await auditFor('content.folder.renamed', created.id))[0].metadata).toEqual({ category: 'podcast' });
    });
  });
});
