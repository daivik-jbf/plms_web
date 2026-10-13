import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, mediaItems, topicAttachments, topics } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { startAttachmentUploadViaApi, createCourseViaApi, seedAttachment, seedLesson, seedTopic, whileHolding } from './helpers/courses';
import { seedFolder, seedItem, signIn, uniqueName } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('topic attachments', () => {
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
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session, { title: 'Fire safety' });
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    const folder = await seedFolder(db, owner.user.id);
    const songs = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    return { owner, other, course, lesson, topic, folder, songs };
  }

  const libraryAttach = (session: Parameters<typeof bearer>[0], topicId: string, body: object) =>
    http().post(`/api/topics/${topicId}/attachments/library`).set(...bearer(session)).send(body);

  it('needs a signed-in person on every route', async () => {
    await http().get(`/api/topics/${unknown}`).expect(401);
    await http().post(`/api/topics/${unknown}/attachments/library`).send({}).expect(401);
    await http().put(`/api/topics/${unknown}/attachments/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/attachments/${unknown}`).send({ title: 'x' }).expect(401);
    await http().post(`/api/attachments/${unknown}/open`).expect(401);
  });

  describe('the topic with its attachments', () => {
    it('answers the topic and its attachments in order, with the facts a page needs and no storage keys', async () => {
      const { owner, course, lesson, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library video', sizeBytes: 300, durationSeconds: 90, withCover: true, storage });
      const pdf = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', title: 'Exit map', position: 1, sizeBytes: 2048, storage });
      const image = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'image', title: 'Plan', position: 2, storage });
      const library = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId, position: 0 });
      const res = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ id: topic.id, lessonId: lesson.id, courseId: course.id, title: 'Fire exits', description: null, position: 0 });
      expect(res.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([library.attachmentId, pdf.attachmentId, image.attachmentId]);
      expect(res.body.attachments[0]).toEqual({
        id: library.attachmentId,
        topicId: topic.id,
        position: 0,
        kind: 'video',
        title: 'Library video',
        description: null,
        source: 'library',
        status: 'ready',
        sizeBytes: 300,
        durationSeconds: 90,
        thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//),
        libraryItemId: item.itemId,
        category: 'video',
        libraryFolderName: folder.name,
        createdBy: { id: owner.user.id, name: 'Test User' },
        createdAt: expect.any(String),
      });
      expect(res.body.attachments[1]).toMatchObject({ kind: 'pdf', title: 'Exit map', source: 'upload', sizeBytes: 2048, thumbnailUrl: null, libraryItemId: null, category: null, libraryFolderName: null });
      expect(res.body.attachments[2]).toMatchObject({ kind: 'image', source: 'upload', thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//) });
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|storage_key|uploadId|upload_id|fileId/);
    });

    it('lists an attachment that is still uploading to its creator only', async () => {
      const { owner, other, topic } = await setup();
      const ready = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Ready', storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Unfinished', status: 'uploading', position: 1 });
      const mine = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(mine.body.attachments.map((attachment: { id: string; status: string }) => [attachment.id, attachment.status])).toEqual([
        [ready.attachmentId, 'ready'],
        [unfinished.attachmentId, 'uploading'],
      ]);
      const theirs = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(theirs.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([ready.attachmentId]);
    });

    it('counts only ready attachments in the course tree', async () => {
      const { owner, course, topic } = await setup();
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading', position: 1 });
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].topics[0]).toMatchObject({ id: topic.id, attachmentCount: 1 });
    });

    it('answers 404 for an unknown topic and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().get(`/api/topics/${unknown}`).set(...bearer(owner.session)).expect(404);
      await http().get('/api/topics/nope').set(...bearer(owner.session)).expect(400);
    });
  });

  describe('attaching a library item', () => {
    it('attaches a ready item that follows the library: its title, cover and later edits show in the topic', async () => {
      const { owner, other, topic, songs } = await setup();
      const item = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, title: 'Morning song', sizeBytes: 500, durationSeconds: 61, storage });
      const res = await libraryAttach(other.session, topic.id, { itemId: item.itemId }).expect(201);
      expect(res.body).toMatchObject({
        topicId: topic.id,
        kind: 'audio',
        title: 'Morning song',
        source: 'library',
        status: 'ready',
        sizeBytes: 500,
        durationSeconds: 61,
        thumbnailUrl: null,
        libraryItemId: item.itemId,
        category: 'song',
        libraryFolderName: songs.name,
        createdBy: { id: other.user.id, name: 'Test User' },
      });
      expect((await attachmentRow(res.body.id)).title).toBeNull();

      await http().patch(`/api/media/items/${item.itemId}`).set(...bearer(owner.session)).send({ title: 'Evening song' }).expect(200);
      const cover = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
      const started = await http().post(`/api/media/items/${item.itemId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: cover.length }).expect(201);
      storage.putObject(started.body.url, cover);
      await http().post(`/api/media/items/${item.itemId}/cover/${started.body.fileId}/complete`).set(...bearer(owner.session)).expect(200);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments[0]).toMatchObject({ title: 'Evening song', thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//) });
    });

    it('keeps its own title when one was given at attach time or by a rename, whatever happens to the item', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', storage });
      const named = await libraryAttach(owner.session, topic.id, { itemId: item.itemId, title: '  Our title ' }).expect(201);
      expect(named.body.title).toBe('Our title');
      const followed = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await http().patch(`/api/attachments/${followed.body.id}`).set(...bearer(owner.session)).send({ title: 'Renamed here' }).expect(200);
      await http().patch(`/api/media/items/${item.itemId}`).set(...bearer(owner.session)).send({ title: 'Changed in the library' }).expect(200);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments.map((attachment: { title: string }) => attachment.title)).toEqual(['Our title', 'Renamed here']);
    });

    it('puts a new attachment at the end, takes the kind from the item and allows the same item twice', async () => {
      const { owner, topic, folder, songs } = await setup();
      const video = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const song = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, storage });
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 4, storage });
      const first = await libraryAttach(owner.session, topic.id, { itemId: video.itemId }).expect(201);
      const second = await libraryAttach(owner.session, topic.id, { itemId: video.itemId }).expect(201);
      const third = await libraryAttach(owner.session, topic.id, { itemId: song.itemId }).expect(201);
      expect([first, second, third].map((res) => [res.body.position, res.body.kind])).toEqual([
        [5, 'video'],
        [6, 'video'],
        [7, 'audio'],
      ]);
    });

    it('refuses an item that is still uploading, hides another person\'s unfinished item, and knows no unknown item', async () => {
      const { owner, other, topic, folder } = await setup();
      const unfinished = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
      const refused = await libraryAttach(owner.session, topic.id, { itemId: unfinished.itemId }).expect(409);
      expect(refused.body.message).toMatch(/still uploading/i);
      await libraryAttach(other.session, topic.id, { itemId: unfinished.itemId }).expect(404);
      await libraryAttach(owner.session, topic.id, { itemId: unknown }).expect(404);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it.each([
      ['no item', {}],
      ['an item id that is not an id', { itemId: 'nope' }],
      ['a blank title', { itemId: unknown, title: '  ' }],
      ['a title of 201 characters', { itemId: unknown, title: 'T'.repeat(201) }],
      ['a NUL character in the title', { itemId: unknown, title: 'a\u0000b' }],
    ])('refuses %s', async (_name, body) => {
      const { owner, topic } = await setup();
      await libraryAttach(owner.session, topic.id, body).expect(400);
    });

    it('answers 404 for an unknown topic and 400 for a malformed topic id', async () => {
      const { owner, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      await libraryAttach(owner.session, unknown, { itemId: item.itemId }).expect(404);
      await libraryAttach(owner.session, 'nope', { itemId: item.itemId }).expect(400);
    });

    it('takes the topic row first, so additions that wait for each other still get different positions', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const add = () => libraryAttach(owner.session, topic.id, { itemId: item.itemId });
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(topics).where(eq(topics.id, topic.id)).for('update'),
        () => Promise.all([add(), add()]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id));
      expect(stored.map((attachment) => attachment.position).sort()).toEqual([0, 1]);
    });

    it('records the addition with the topic and no storage key, and words it for the audit log', async () => {
      const { owner, topic, folder } = await setup();
      const admin = await signIn(app, db, 'admin');
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: uniqueName('Exit film'), storage });
      const res = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      const [entry] = await auditFor('content.attachment.added', res.body.id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'attachment',
        targetLabel: res.body.title,
        metadata: { kind: 'video', source: 'library', topicId: topic.id, topicTitle: 'Fire exits', libraryItemId: item.itemId },
      });
      expect(JSON.stringify(entry)).not.toMatch(/videos\/|memory:/);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(res.body.title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((candidate) => candidate.action === 'content.attachment.added')?.summary).toBe(`Test User added the video '${res.body.title}' to the topic 'Fire exits'`);
    });
  });

  describe('renaming', () => {
    it('renames an attachment, records before and after, and does not audit the same name', async () => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Map', storage });
      const res = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ title: '  Exit map ' }).expect(200);
      expect(res.body).toMatchObject({ id: seeded.attachmentId, title: 'Exit map' });
      const [entry] = await auditFor('content.attachment.renamed', seeded.attachmentId);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'attachment',
        targetLabel: 'Exit map',
        changes: { title: { before: 'Map', after: 'Exit map' } },
        metadata: { kind: 'pdf', topicId: topic.id },
      });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ title: 'Exit map' }).expect(200);
      expect(await auditFor('content.attachment.renamed', seeded.attachmentId)).toHaveLength(1);
    });

    it('changes the description, records before and after, and an empty one clears it', async () => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Map', storage });
      const res = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ description: '  Where to go.  ' }).expect(200);
      expect(res.body).toMatchObject({ title: 'Map', description: 'Where to go.' });
      const [entry] = await auditFor('content.attachment.edited', seeded.attachmentId);
      expect(entry).toMatchObject({ targetLabel: 'Map', changes: { description: { before: null, after: 'Where to go.' } } });
      expect(await auditFor('content.attachment.renamed', seeded.attachmentId)).toHaveLength(0);
      const cleared = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ description: '' }).expect(200);
      expect(cleared.body.description).toBeNull();
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ description: null }).expect(200);
      expect(await auditFor('content.attachment.edited', seeded.attachmentId)).toHaveLength(2);
    });

    it('changes title and description together in one entry, and refuses an empty change or a description that is too long', async () => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Map', storage });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ title: 'Exit map', description: 'Text' }).expect(200);
      const [entry] = await auditFor('content.attachment.edited', seeded.attachmentId);
      expect(entry.changes).toEqual({ title: { before: 'Map', after: 'Exit map' }, description: { before: null, after: 'Text' } });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({}).expect(400);
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ description: 'x'.repeat(2001) }).expect(400);
    });

    it('shows the description of the library item until the attachment has one of its own', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', description: 'From the library', storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      expect(attached.body.description).toBe('From the library');
      const own = await http().patch(`/api/attachments/${attached.body.id}`).set(...bearer(owner.session)).send({ description: 'Our words' }).expect(200);
      expect(own.body.description).toBe('Our words');
    });

    it('takes a description when a library item is attached', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId, description: 'Watch this first.' }).expect(201);
      expect(attached.body.description).toBe('Watch this first.');
    });

    it('takes a description when an upload into the topic is started', async () => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { description: 'The floor plan.' });
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments.find((entry: { id: string }) => entry.id === started.itemId)).toMatchObject({ description: 'The floor plan.' });
    });

    it('records the library title as the old name when a library attachment is renamed first', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await http().patch(`/api/attachments/${attached.body.id}`).set(...bearer(owner.session)).send({ title: 'Our title' }).expect(200);
      expect((await auditFor('content.attachment.renamed', attached.body.id))[0].changes).toEqual({ title: { before: 'Library title', after: 'Our title' } });
      await http().patch(`/api/attachments/${attached.body.id}`).set(...bearer(owner.session)).send({ title: 'Library title' }).expect(200);
      expect((await attachmentRow(attached.body.id)).title).toBe('Library title');
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character', { title: 'a\u0000b' }],
    ])('refuses %s and keeps the name', async (_name, body) => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Keep', storage });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await attachmentRow(seeded.attachmentId)).title).toBe('Keep');
    });

    it('keeps hostile text as it is, and answers 404 for unknown or another person\'s unfinished attachments and 400 for a malformed id', async () => {
      const { owner, other, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      const res = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(other.session)).send({ title: hostile }).expect(200);
      expect(res.body.title).toBe(hostile);
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading', position: 1 });
      await http().patch(`/api/attachments/${unfinished.attachmentId}`).set(...bearer(other.session)).send({ title: 'x' }).expect(404);
      await http().patch(`/api/attachments/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/attachments/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the ready attachments in the order given, leaves an unfinished one out and records one entry on the topic', async () => {
      const { owner, topic } = await setup();
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'A', position: 0, storage });
      const b = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'B', position: 1, storage });
      const c = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'C', position: 2, storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'U', position: 3, status: 'uploading' });
      const res = await http()
        .put(`/api/topics/${topic.id}/attachments/order`)
        .set(...bearer(owner.session))
        .send({ ids: [c.attachmentId, a.attachmentId, b.attachmentId] })
        .expect(200);
      expect(res.body.map((attachment: { title: string }) => attachment.title)).toEqual(['C', 'A', 'B', 'U']);
      expect((await attachmentRow(unfinished.attachmentId)).position).toBe(3);
      const [entry] = await auditFor('content.attachment.reordered', topic.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'topic', targetLabel: 'Fire exits' });
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts a topic without attachments', async () => {
      const { owner, topic } = await setup();
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: [a.attachmentId] }).expect(200);
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(0);
    });

    it('refuses an order that is missing one, repeats one, invents one, names an unfinished one or one of another topic', async () => {
      const { owner, lesson, topic } = await setup();
      const sibling = await seedTopic(db, lesson.id, owner.user.id, 'Other topic', 1);
      const foreign = await seedAttachment(db, { topicId: sibling.id, createdBy: owner.user.id, storage });
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 0, storage });
      const b = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 1, storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 2, status: 'uploading' });
      const ids = [a.attachmentId, b.attachmentId];
      const attempts = [[a.attachmentId], [...ids, randomUUID()], [a.attachmentId, a.attachmentId], [a.attachmentId, foreign.attachmentId], [...ids, unfinished.attachmentId], []];
      for (const attempt of attempts) {
        await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      expect((await attachmentRow(a.attachmentId)).position).toBe(0);
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown topic, 400 for a malformed id or body', async () => {
      const { owner, topic } = await setup();
      await http().put(`/api/topics/${unknown}/attachments/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/topics/nope/attachments/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: ['nope'] }).expect(400);
    });
  });

  describe('opening', () => {
    it.each([
      ['video', 'video/mp4', 'playback.played'],
      ['audio', 'audio/mp4', 'playback.played'],
      ['pdf', 'application/pdf', 'playback.viewed'],
      ['image', 'image/png', 'playback.viewed'],
    ] as const)('gives a one-hour link to an uploaded %s and records %s without any link or key', async (kind, contentType, action) => {
      const { owner, other, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind, title: 'Exit map', sizeBytes: 300, storage });
      const before = Date.now();
      const res = await http().post(`/api/attachments/${seeded.attachmentId}/open`).set(...bearer(other.session)).expect(200);
      expect(res.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType, kind });
      expect(Date.parse(res.body.expiresAt) - before).toBeGreaterThan(3_590_000);
      expect(Date.parse(res.body.expiresAt) - before).toBeLessThanOrEqual(3_601_000);
      const fetched = storage.get(res.body.url);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toHaveLength(300);
      const [entry] = await auditFor(action, seeded.attachmentId);
      expect(entry).toMatchObject({ actorId: other.user.id, targetType: 'attachment', targetLabel: 'Exit map', metadata: { kind, source: 'upload', topicId: topic.id } });
      expect(JSON.stringify(entry)).not.toMatch(/memory:|videos\/|audio\/|documents\/|images\//);
    });

    it('opens a library attachment with the library item\'s file and records the play', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library video', sizeBytes: 200, storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      const res = await http().post(`/api/attachments/${attached.body.id}/open`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ contentType: 'video/mp4', kind: 'video' });
      expect(storage.get(res.body.url).body).toHaveLength(200);
      expect((await auditFor('playback.played', attached.body.id))[0]).toMatchObject({ targetType: 'attachment', targetLabel: 'Library video', metadata: { kind: 'video', source: 'library' } });
    });

    it('cannot open an attachment whose library item is not ready', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await db.update(mediaItems).set({ status: 'uploading' }).where(eq(mediaItems.id, item.itemId));
      const res = await http().post(`/api/attachments/${attached.body.id}/open`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toMatch(/not available/i);
      expect(await auditFor('playback.played', attached.body.id)).toHaveLength(0);
    });

    it('answers 409 for your own unfinished attachment, 404 for another person\'s, an unknown one and a malformed id', async () => {
      const { owner, other, topic } = await setup();
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading' });
      const mine = await http().post(`/api/attachments/${unfinished.attachmentId}/open`).set(...bearer(owner.session)).expect(409);
      expect(mine.body.message).toMatch(/still uploading/i);
      await http().post(`/api/attachments/${unfinished.attachmentId}/open`).set(...bearer(other.session)).expect(404);
      await http().post(`/api/attachments/${unknown}/open`).set(...bearer(owner.session)).expect(404);
      await http().post('/api/attachments/nope/open').set(...bearer(owner.session)).expect(400);
      expect(await db.select().from(auditLog).where(eq(auditLog.targetId, unfinished.attachmentId))).toEqual([]);
    });

    it('words viewing a PDF for the audit log', async () => {
      const { owner, topic } = await setup();
      const admin = await signIn(app, db, 'admin');
      const title = uniqueName('Exit map');
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', title, storage });
      await http().post(`/api/attachments/${seeded.attachmentId}/open`).set(...bearer(admin.session)).expect(200);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&includePlayback=true&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        label: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'playback.viewed')).toMatchObject({ label: 'Viewed', summary: `Test User opened the PDF '${title}'` });
    });
  });
});
