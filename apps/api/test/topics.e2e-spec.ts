import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, lessons, topics } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { addLessonViaApi, addTopicViaApi, createCourseViaApi, seedLesson, seedTopic, whileHolding } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('topics', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const unknown = '00000000-0000-4000-8000-000000000000';

  async function setup() {
    const owner = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    return { owner, course, lesson };
  }

  it('needs a signed-in person on every route', async () => {
    await http().post(`/api/lessons/${unknown}/topics`).send({ title: 'x' }).expect(401);
    await http().put(`/api/lessons/${unknown}/topics/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/topics/${unknown}`).send({ title: 'x' }).expect(401);
  });

  describe('adding', () => {
    it('adds a topic at the end with trimmed text and answers the whole tree', async () => {
      const { owner, course, lesson } = await setup();
      const first = await http()
        .post(`/api/lessons/${lesson.id}/topics`)
        .set(...bearer(owner.session))
        .send({ title: '  Fire exits ', description: '  Keep them clear.\nNever lock them.  ' })
        .expect(201);
      expect(first.body.id).toBe(course.id);
      expect(first.body.lessons[0].topics).toEqual([{ id: expect.any(String), title: 'Fire exits', position: 0, coverUrl: null, attachmentCount: 0 }]);
      const second = await addTopicViaApi(app, owner.session, lesson.id, { title: 'Alarms' });
      expect(second.lessons[0].topics.map((topic) => [topic.title, topic.position])).toEqual([
        ['Fire exits', 0],
        ['Alarms', 1],
      ]);
      const id = first.body.lessons[0].topics[0].id;
      const [stored] = await db.select().from(topics).where(eq(topics.id, id));
      expect(stored.description).toBe('Keep them clear.\nNever lock them.');
      const [entry] = await auditFor('content.topic.added', id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'topic',
        targetLabel: 'Fire exits',
        metadata: { lessonId: lesson.id, lessonTitle: 'Exits', courseId: course.id },
      });
    });

    it('treats an empty description as none, accepts exactly 10,000 characters and refuses one more', async () => {
      const { owner, lesson } = await setup();
      await addTopicViaApi(app, owner.session, lesson.id, { description: '   ' });
      const longest = 'D'.repeat(10_000);
      await addTopicViaApi(app, owner.session, lesson.id, { description: longest });
      const stored = await db.select().from(topics).where(eq(topics.lessonId, lesson.id));
      expect(stored.map((topic) => topic.description).sort()).toEqual([null, longest].sort());
      const res = await http()
        .post(`/api/lessons/${lesson.id}/topics`)
        .set(...bearer(owner.session))
        .send({ title: 'Too much', description: 'D'.repeat(10_001) })
        .expect(400);
      expect(res.body.fieldErrors.description[0]).toMatch(/10,000/);
      expect(await db.select().from(topics).where(eq(topics.lessonId, lesson.id))).toHaveLength(2);
    });

    it.each([
      ['no title', {}, 'title'],
      ['a blank title', { title: ' ' }, 'title'],
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a NUL character in the title', { title: 'a\u0000b' }, 'title'],
      ['a NUL character in the description', { title: 'Ok', description: 'a\u0000b' }, 'description'],
      ['a description that is not text', { title: 'Ok', description: 5 }, 'description'],
    ])('refuses %s with the field named and adds nothing', async (_name, body, field) => {
      const { owner, lesson } = await setup();
      const res = await http().post(`/api/lessons/${lesson.id}/topics`).set(...bearer(owner.session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await db.select().from(topics).where(eq(topics.lessonId, lesson.id))).toEqual([]);
    });

    it('takes the lesson row first, so additions that wait for each other still get different positions', async () => {
      const { owner, lesson } = await setup();
      const add = (title: string) => http().post(`/api/lessons/${lesson.id}/topics`).set(...bearer(owner.session)).send({ title });
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(lessons).where(eq(lessons.id, lesson.id)).for('update'),
        () => Promise.all([add('First'), add('Second')]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(topics).where(eq(topics.lessonId, lesson.id));
      expect(stored.map((topic) => topic.position).sort()).toEqual([0, 1]);
    });

    it('keeps hostile text as it is', async () => {
      const { owner, course, lesson } = await setup();
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      await addTopicViaApi(app, owner.session, lesson.id, { title: hostile, description: '<script>alert(1)</script>' });
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].topics[0].title).toBe(hostile);
    });

    it('answers 404 for an unknown lesson and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().post(`/api/lessons/${unknown}/topics`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().post('/api/lessons/nope/topics').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('editing', () => {
    it('changes title and description, trims them, records before and after and answers the topic', async () => {
      const { owner, course, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Old title');
      await db.update(topics).set({ description: 'Before' }).where(eq(topics.id, topic.id));
      const res = await http()
        .patch(`/api/topics/${topic.id}`)
        .set(...bearer(owner.session))
        .send({ title: '  New title ', description: '  After\nlines ' })
        .expect(200);
      expect(res.body).toEqual({ id: topic.id, lessonId: lesson.id, courseId: course.id, title: 'New title', description: 'After\nlines', position: 0, coverUrl: null });
      const [entry] = await auditFor('content.topic.edited', topic.id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'topic',
        targetLabel: 'New title',
        changes: { title: { before: 'Old title', after: 'New title' }, description: { before: 'Before', after: 'After\nlines' } },
      });
    });

    it('clears the description with an empty string, edits one field at a time, and does not audit a change that changes nothing', async () => {
      const { owner, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Same');
      await db.update(topics).set({ description: 'Words' }).where(eq(topics.id, topic.id));
      const cleared = await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ description: '' }).expect(200);
      expect(cleared.body).toMatchObject({ title: 'Same', description: null });
      expect(await auditFor('content.topic.edited', topic.id)).toHaveLength(1);
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ title: 'Same', description: null }).expect(200);
      expect(await auditFor('content.topic.edited', topic.id)).toHaveLength(1);
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ title: 'Renamed' }).expect(200);
      expect((await auditFor('content.topic.edited', topic.id))[1].changes).toEqual({ title: { before: 'Same', after: 'Renamed' } });
    });

    it.each([
      ['an empty change', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'a\u0000b' }],
      ['a description of 10,001 characters', { description: 'D'.repeat(10_001) }],
      ['a NUL character in the description', { description: 'a\u0000b' }],
    ])('refuses %s and changes nothing', async (_name, body) => {
      const { owner, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Stay');
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await db.select().from(topics).where(eq(topics.id, topic.id)))[0]).toMatchObject({ title: 'Stay', description: null });
    });

    it('answers 404 for an unknown topic and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().patch(`/api/topics/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/topics/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the topics in the order given, answers the tree and records one entry on the lesson', async () => {
      const { owner, course, lesson } = await setup();
      for (const title of ['One', 'Two', 'Three']) await addTopicViaApi(app, owner.session, lesson.id, { title });
      const before = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[];
      const reversed = before.map((topic) => topic.id).reverse();
      const res = await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: reversed }).expect(200);
      expect(res.body.lessons[0].topics.map((topic: { title: string }) => topic.title)).toEqual(['Three', 'Two', 'One']);
      const [entry] = await auditFor('content.topic.reordered', lesson.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'lesson', targetLabel: 'Exits' });
      expect(await auditFor('content.topic.reordered', lesson.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts a lesson without topics', async () => {
      const { owner, lesson } = await setup();
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const tree = await addTopicViaApi(app, owner.session, lesson.id);
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: tree.lessons[0].topics.map((topic) => topic.id) }).expect(200);
      expect(await auditFor('content.topic.reordered', lesson.id)).toHaveLength(0);
    });

    it('refuses an order that is missing a topic, repeats one, invents one or names a topic of another lesson', async () => {
      const { owner, course, lesson } = await setup();
      const sibling = await addLessonViaApi(app, owner.session, course.id, 'Other lesson');
      const foreign = (await addTopicViaApi(app, owner.session, sibling.lessons.at(-1)?.id as string)).lessons.at(-1)?.topics[0].id as string;
      await addTopicViaApi(app, owner.session, lesson.id, { title: 'One' });
      await addTopicViaApi(app, owner.session, lesson.id, { title: 'Two' });
      const ids = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[]).map((topic) => topic.id);
      const attempts = [ids.slice(1), [...ids, randomUUID()], [ids[0], ids[0]], [ids[0], foreign], [...ids, foreign], []];
      for (const attempt of attempts) {
        await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      const after = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[]).map((topic) => topic.id);
      expect(after).toEqual(ids);
    });

    it('answers 404 for an unknown lesson, 400 for a malformed id or body', async () => {
      const { owner, lesson } = await setup();
      await http().put(`/api/lessons/${unknown}/topics/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/lessons/nope/topics/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: 'x' }).expect(400);
    });
  });

  it('counts the topics in the course list and writes the audit sentences with the lesson', async () => {
    const { owner, course, lesson } = await setup();
    const admin = await signIn(app, db, 'admin');
    const name = uniqueName('Fire exits');
    await addTopicViaApi(app, owner.session, lesson.id, { title: name });
    const list = (await http().get('/api/courses').set(...bearer(owner.session)).expect(200)).body as { id: string; lessonCount: number; topicCount: number }[];
    expect(list.find((candidate) => candidate.id === course.id)).toMatchObject({ lessonCount: 1, topicCount: 1 });
    const items = (await http().get(`/api/audit?q=${encodeURIComponent(name)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'content.topic.added')).toMatchObject({
      label: 'Topic added',
      summary: `Test User added the topic '${name}' to the lesson 'Exits'`,
    });
  });
});
