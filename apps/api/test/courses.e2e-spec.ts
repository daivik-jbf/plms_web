import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedLesson, seedTopic } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('courses', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const listIds = async (session: Parameters<typeof bearer>[0]) =>
    ((await http().get('/api/courses').set(...bearer(session)).expect(200)).body as { id: string }[]).map((course) => course.id);

  it('needs a signed-in person on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await http().get('/api/courses').expect(401);
    await http().post('/api/courses').send({ title: 'x' }).expect(401);
    await http().put('/api/courses/order').send({ ids: [] }).expect(401);
    await http().get(`/api/courses/${id}`).expect(401);
    await http().patch(`/api/courses/${id}`).send({ title: 'x' }).expect(401);
    await http().post(`/api/courses/${id}/cover`).send({}).expect(401);
    await http().post(`/api/courses/${id}/cover/${id}/complete`).expect(401);
  });

  describe('creating and listing', () => {
    it('creates a course at the end with trimmed text, and lists it with its counts', async () => {
      const { user, session } = await signIn(app, db);
      const before = await listIds(session);
      const created = await http()
        .post('/api/courses')
        .set(...bearer(session))
        .send({ title: '  Fire safety  ', description: '  Know the exits.\nPractise them.  ' })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        title: 'Fire safety',
        description: 'Know the exits.\nPractise them.',
        position: expect.any(Number),
        coverUrl: null,
        lessonCount: 0,
        topicCount: 0,
        createdBy: { id: user.id, name: 'Test User' },
        createdAt: expect.any(String),
      });
      const lesson = await seedLesson(db, created.body.id, user.id);
      await seedLesson(db, created.body.id, user.id, uniqueName('Lesson'), 1);
      await seedTopic(db, lesson.id, user.id);
      await seedTopic(db, lesson.id, user.id, uniqueName('Topic'), 1);
      await seedTopic(db, lesson.id, user.id, uniqueName('Topic'), 2);
      const list = (await http().get('/api/courses').set(...bearer(session)).expect(200)).body as { id: string; lessonCount: number; topicCount: number }[];
      expect(list.map((course) => course.id)).toEqual([...before, created.body.id]);
      expect(list.at(-1)).toMatchObject({ lessonCount: 2, topicCount: 3 });
      const [entry] = await auditFor('content.course.created', created.body.id);
      expect(entry).toMatchObject({ actorId: user.id, targetType: 'course', targetLabel: 'Fire safety' });
    });

    it('keeps the order of creation and lets titles repeat', async () => {
      const { session } = await signIn(app, db);
      const title = uniqueName('Same');
      const first = await createCourseViaApi(app, session, { title });
      const second = await createCourseViaApi(app, session, { title });
      expect(second.position).toBeGreaterThan(first.position);
      const ids = await listIds(session);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    it('treats an empty description as none and accepts the largest title and description', async () => {
      const { session } = await signIn(app, db);
      expect((await createCourseViaApi(app, session, { description: '   ' })).description).toBeNull();
      const longest = await createCourseViaApi(app, session, { title: 'T'.repeat(200), description: 'D'.repeat(2000) });
      expect(longest.title).toHaveLength(200);
      expect(longest.description).toHaveLength(2000);
    });

    it.each([
      ['no title', {}, 'title'],
      ['a blank title', { title: '   ' }, 'title'],
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a NUL character in the title', { title: 'Fire\u0000safety' }, 'title'],
      ['a description of 2001 characters', { title: 'Ok', description: 'D'.repeat(2001) }, 'description'],
      ['a NUL character in the description', { title: 'Ok', description: 'a\u0000b' }, 'description'],
      ['a title that is not text', { title: 5 }, 'title'],
    ])('refuses %s with the field named', async (_name, body, field) => {
      const { session } = await signIn(app, db);
      const before = await listIds(session);
      const res = await http().post('/api/courses').set(...bearer(session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await listIds(session)).toEqual(before);
    });

    it('stores hostile text as it is and returns it as plain text', async () => {
      const { session } = await signIn(app, db);
      const title = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 6)}`;
      const created = await createCourseViaApi(app, session, { title, description: '<script>alert(1)</script>' });
      expect(created).toMatchObject({ title, description: '<script>alert(1)</script>' });
      const [entry] = await auditFor('content.course.created', created.id);
      expect(entry.targetLabel).toBe(title);
    });
  });

  describe('the tree', () => {
    it('answers the course with its lessons and their topics in order, in one answer', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Tree', description: 'About trees' });
      const second = await seedLesson(db, course.id, user.id, 'Second lesson', 1);
      const first = await seedLesson(db, course.id, user.id, 'First lesson', 0);
      const t2 = await seedTopic(db, first.id, user.id, 'Topic B', 1);
      const t1 = await seedTopic(db, first.id, user.id, 'Topic A', 0);
      const res = await http().get(`/api/courses/${course.id}`).set(...bearer(session)).expect(200);
      expect(res.body).toEqual({
        id: course.id,
        title: 'Tree',
        description: 'About trees',
        position: course.position,
        coverUrl: null,
        createdBy: { id: user.id, name: 'Test User' },
        createdAt: expect.any(String),
        lessons: [
          {
            id: first.id,
            title: 'First lesson',
            position: 0,
            coverUrl: null,
            topics: [
              { id: t1.id, title: 'Topic A', position: 0, coverUrl: null, attachmentCount: 0, attachments: [] },
              { id: t2.id, title: 'Topic B', position: 1, coverUrl: null, attachmentCount: 0, attachments: [] },
            ],
          },
          { id: second.id, title: 'Second lesson', description: null, position: 1, coverUrl: null, topics: [] },
        ],
      });
    });

    it('is the same for every signed-in person and answers 404 or 400 for a bad id', async () => {
      const owner = await signIn(app, db);
      const other = await signIn(app, db, 'admin');
      const course = await createCourseViaApi(app, owner.session);
      await http().get(`/api/courses/${course.id}`).set(...bearer(other.session)).expect(200);
      await http().get('/api/courses/00000000-0000-4000-8000-000000000000').set(...bearer(owner.session)).expect(404);
      await http().get('/api/courses/nope').set(...bearer(owner.session)).expect(400);
    });
  });

  describe('editing', () => {
    it('changes title and description, trims them, and records before and after', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Old', description: 'Before' });
      const res = await http()
        .patch(`/api/courses/${course.id}`)
        .set(...bearer(session))
        .send({ title: '  New title ', description: ' After ' })
        .expect(200);
      expect(res.body).toMatchObject({ id: course.id, title: 'New title', description: 'After', lessons: [] });
      const [entry] = await auditFor('content.course.edited', course.id);
      expect(entry).toMatchObject({
        actorId: user.id,
        targetType: 'course',
        targetLabel: 'New title',
        changes: { title: { before: 'Old', after: 'New title' }, description: { before: 'Before', after: 'After' } },
      });
    });

    it('clears the description with an empty string and does not audit a change that changes nothing', async () => {
      const { session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Keep', description: 'Words' });
      const cleared = await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send({ description: '' }).expect(200);
      expect(cleared.body.description).toBeNull();
      expect(await auditFor('content.course.edited', course.id)).toHaveLength(1);
      await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send({ title: 'Keep', description: null }).expect(200);
      expect(await auditFor('content.course.edited', course.id)).toHaveLength(1);
    });

    it.each([
      ['an empty change', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'a\u0000b' }],
      ['a description of 2001 characters', { description: 'D'.repeat(2001) }],
      ['a NUL character in the description', { description: 'a\u0000b' }],
    ])('refuses %s and changes nothing', async (_name, body) => {
      const { session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Stay', description: 'Same' });
      await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send(body).expect(400);
      const [stored] = await db.select().from(courses).where(eq(courses.id, course.id));
      expect(stored).toMatchObject({ title: 'Stay', description: 'Same' });
    });

    it('answers 404 for an unknown course and 400 for a malformed id', async () => {
      const { session } = await signIn(app, db);
      await http().patch('/api/courses/00000000-0000-4000-8000-000000000000').set(...bearer(session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/courses/nope').set(...bearer(session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the courses in the order given and records one entry', async () => {
      const { user, session } = await signIn(app, db);
      await createCourseViaApi(app, session);
      await createCourseViaApi(app, session);
      const reversed = (await listIds(session)).reverse();
      const res = await http().put('/api/courses/order').set(...bearer(session)).send({ ids: reversed }).expect(200);
      expect(res.body.map((course: { id: string }) => course.id)).toEqual(reversed);
      expect(await listIds(session)).toEqual(reversed);
      const entries = await db.select().from(auditLog).where(and(eq(auditLog.action, 'content.course.reordered'), eq(auditLog.actorId, user.id)));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ targetType: 'courses', targetId: 'courses', targetLabel: 'Courses' });
    });

    it('does not audit an order that did not change', async () => {
      const { user, session } = await signIn(app, db);
      await createCourseViaApi(app, session);
      await http().put('/api/courses/order').set(...bearer(session)).send({ ids: await listIds(session) }).expect(200);
      expect(await db.select().from(auditLog).where(and(eq(auditLog.action, 'content.course.reordered'), eq(auditLog.actorId, user.id)))).toHaveLength(0);
    });

    it('refuses an order that is missing a course, repeats one, invents one or names something that is not a course', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session);
      await createCourseViaApi(app, session);
      const lesson = await seedLesson(db, course.id, user.id);
      const ids = await listIds(session);
      const before = ids.join();
      const attempts: string[][] = [
        ids.slice(1),
        [...ids, randomUUID()],
        [ids[0], ...ids.slice(0, -1)],
        [...ids.slice(0, -1), lesson.id],
        [],
      ];
      for (const attempt of attempts) {
        await http().put('/api/courses/order').set(...bearer(session)).send({ ids: attempt }).expect(409);
      }
      expect((await listIds(session)).join()).toBe(before);
    });

    it('refuses a body that is not a list of ids', async () => {
      const { session } = await signIn(app, db);
      await http().put('/api/courses/order').set(...bearer(session)).send({ ids: ['nope'] }).expect(400);
      await http().put('/api/courses/order').set(...bearer(session)).send({}).expect(400);
    });
  });
});
