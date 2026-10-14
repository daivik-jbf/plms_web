import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses, lessons } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { addLessonViaApi, createCourseViaApi, seedLesson, whileHolding } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('lessons', () => {
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
    return { owner, course };
  }

  it('needs a signed-in person on every route', async () => {
    await http().post(`/api/courses/${unknown}/lessons`).send({ title: 'x' }).expect(401);
    await http().put(`/api/courses/${unknown}/lessons/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/lessons/${unknown}`).send({ title: 'x' }).expect(401);
  });

  describe('adding', () => {
    it('adds a lesson at the end, trimmed, and answers the whole tree', async () => {
      const { owner, course } = await setup();
      const first = await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send({ title: '  Exits  ' }).expect(201);
      expect(first.body.lessons).toEqual([{ id: expect.any(String), title: 'Exits', description: null, position: 0, coverUrl: null, topics: [] }]);
      const second = await addLessonViaApi(app, owner.session, course.id, 'Alarms');
      expect(second.lessons.map((lesson) => [lesson.title, lesson.position])).toEqual([
        ['Exits', 0],
        ['Alarms', 1],
      ]);
      const [entry] = await auditFor('content.lesson.added', second.lessons[1].id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'lesson',
        targetLabel: 'Alarms',
        metadata: { courseId: course.id, courseTitle: course.title },
      });
    });

    it('keeps a trimmed description, and treats an empty one as none', async () => {
      const { owner, course } = await setup();
      const add = (body: object) => http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send(body).expect(201);
      expect((await add({ title: 'With', description: '  What it covers  ' })).body.lessons[0].description).toBe('What it covers');
      expect((await add({ title: 'Blank', description: '   ' })).body.lessons[1].description).toBeNull();
      const tooLong = await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send({ title: 'x', description: 'D'.repeat(2001) }).expect(400);
      expect(tooLong.body.fieldErrors).toHaveProperty('description');
    });

    it('takes the course row first, so additions that wait for each other still get different positions', async () => {
      const { owner, course } = await setup();
      const add = (title: string) => http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send({ title });
      // Both requests are in flight while another transaction holds the course row. Without the row lock both would read
      // the same "next position" before waiting and write the same one.
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(courses).where(eq(courses.id, course.id)).for('update'),
        () => Promise.all([add('First'), add('Second')]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(lessons).where(eq(lessons.courseId, course.id));
      expect(stored.map((lesson) => lesson.position).sort()).toEqual([0, 1]);
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '   ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'Ex\u0000its' }],
      ['a title that is not text', { title: { x: 1 } }],
    ])('refuses %s with the field named and adds nothing', async (_name, body) => {
      const { owner, course } = await setup();
      const res = await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty('title');
      expect(await db.select().from(lessons).where(eq(lessons.courseId, course.id))).toEqual([]);
    });

    it('accepts a title of exactly 200 characters and keeps hostile text as it is', async () => {
      const { owner, course } = await setup();
      const hostile = `<script>alert(1)</script> ${randomUUID().slice(0, 4)}`;
      const tree = await addLessonViaApi(app, owner.session, course.id, 'L'.repeat(200));
      expect(tree.lessons[0].title).toHaveLength(200);
      const second = await addLessonViaApi(app, owner.session, course.id, hostile);
      expect(second.lessons[1].title).toBe(hostile);
    });

    it('answers 404 for an unknown course and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().post(`/api/courses/${unknown}/lessons`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().post('/api/courses/nope/lessons').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('renaming', () => {
    it('renames a lesson, records before and after, and does not audit the same name', async () => {
      const { owner, course } = await setup();
      const tree = await addLessonViaApi(app, owner.session, course.id, 'Exist');
      const id = tree.lessons[0].id;
      const res = await http().patch(`/api/lessons/${id}`).set(...bearer(owner.session)).send({ title: '  Exits ' }).expect(200);
      expect(res.body.lessons[0]).toMatchObject({ id, title: 'Exits' });
      const [entry] = await auditFor('content.lesson.renamed', id);
      expect(entry).toMatchObject({ targetLabel: 'Exits', changes: { title: { before: 'Exist', after: 'Exits' } }, metadata: { courseId: course.id } });
      await http().patch(`/api/lessons/${id}`).set(...bearer(owner.session)).send({ title: 'Exits' }).expect(200);
      expect(await auditFor('content.lesson.renamed', id)).toHaveLength(1);
    });

    it('edits the description and records it as an edit, not a rename', async () => {
      const { owner, course } = await setup();
      const tree = await addLessonViaApi(app, owner.session, course.id, 'Exits');
      const id = tree.lessons[0].id;
      const res = await http().patch(`/api/lessons/${id}`).set(...bearer(owner.session)).send({ description: ' All the exits ' }).expect(200);
      expect(res.body.lessons[0]).toMatchObject({ id, title: 'Exits', description: 'All the exits' });
      const [entry] = await auditFor('content.lesson.edited', id);
      expect(entry).toMatchObject({ targetLabel: 'Exits', changes: { description: { before: null, after: 'All the exits' } } });
      expect(await auditFor('content.lesson.renamed', id)).toHaveLength(0);
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character', { title: 'a\u0000b' }],
    ])('refuses %s and keeps the name', async (_name, body) => {
      const { owner, course } = await setup();
      const lesson = await seedLesson(db, course.id, owner.user.id, 'Keep');
      await http().patch(`/api/lessons/${lesson.id}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await db.select().from(lessons).where(eq(lessons.id, lesson.id)))[0].title).toBe('Keep');
    });

    it('answers 404 for an unknown lesson and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().patch(`/api/lessons/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/lessons/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the lessons in the order given, answers the tree and records one entry on the course', async () => {
      const { owner, course } = await setup();
      for (const title of ['One', 'Two', 'Three']) await addLessonViaApi(app, owner.session, course.id, title);
      const before = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string; title: string }[];
      const reversed = before.map((lesson) => lesson.id).reverse();
      const res = await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: reversed }).expect(200);
      expect(res.body.lessons.map((lesson: { title: string }) => lesson.title)).toEqual(['Three', 'Two', 'One']);
      expect(res.body.lessons.map((lesson: { position: number }) => lesson.position)).toEqual([0, 1, 2]);
      const [entry] = await auditFor('content.lesson.reordered', course.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'course', targetLabel: course.title });
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts an empty course', async () => {
      const { owner, course } = await setup();
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const tree = await addLessonViaApi(app, owner.session, course.id);
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: tree.lessons.map((lesson) => lesson.id) }).expect(200);
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(0);
    });

    it('refuses an order that is missing a lesson, repeats one, invents one or names a lesson of another course', async () => {
      const { owner, course } = await setup();
      const other = await createCourseViaApi(app, owner.session);
      const foreign = (await addLessonViaApi(app, owner.session, other.id)).lessons[0].id;
      await addLessonViaApi(app, owner.session, course.id, 'One');
      await addLessonViaApi(app, owner.session, course.id, 'Two');
      const ids = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string }[]).map((lesson) => lesson.id);
      const attempts = [ids.slice(1), [...ids, randomUUID()], [ids[0], ids[0]], [ids[0], foreign], [...ids, foreign], []];
      for (const attempt of attempts) {
        await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      const after = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string }[];
      expect(after.map((lesson) => lesson.id)).toEqual(ids);
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown course, 400 for a malformed id or body', async () => {
      const { owner, course } = await setup();
      await http().put(`/api/courses/${unknown}/lessons/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/courses/nope/lessons/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: ['nope'] }).expect(400);
    });
  });

  it('writes the audit sentences with the course and the old name', async () => {
    const { owner, course } = await setup();
    const admin = await signIn(app, db, 'admin');
    const name = uniqueName('Exits');
    const tree = await addLessonViaApi(app, owner.session, course.id, name);
    await http().patch(`/api/lessons/${tree.lessons[0].id}`).set(...bearer(owner.session)).send({ title: `${name} renamed` }).expect(200);
    const items = (await http().get(`/api/audit?q=${encodeURIComponent(name)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'content.lesson.added')).toMatchObject({
      label: 'Lesson added',
      summary: `Test User added the lesson '${name}' to the course '${course.title}'`,
    });
    expect(items.find((item) => item.action === 'content.lesson.renamed')).toMatchObject({
      label: 'Lesson renamed',
      summary: `Test User renamed the lesson from '${name}' to '${name} renamed'`,
    });
  });
});
