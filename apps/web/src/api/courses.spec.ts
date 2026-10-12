import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession, STAFF } from '../test/session';
import {
  addLesson,
  addTopic,
  createCourse,
  getCourse,
  getTopic,
  listCourses,
  renameLesson,
  reorderCourses,
  reorderLessons,
  reorderTopics,
  updateCourse,
  updateTopic,
  uploadCourseCover,
} from './courses';

describe('courses api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the course endpoints', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`.trim());
      return { body: [] };
    });
    await listCourses();
    await createCourse({ title: 'Fire safety', description: 'About fire' });
    await reorderCourses(['b', 'a']);
    await updateCourse('c1', { title: 'New' });
    expect(calls.filter((call) => call.includes('/api/courses'))).toEqual([
      'GET /api/courses',
      'POST /api/courses {"title":"Fire safety","description":"About fire"}',
      'PUT /api/courses/order {"ids":["b","a"]}',
      'PATCH /api/courses/c1 {"title":"New"}',
    ]);
  });
});

describe('course page api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('reads a course and a topic', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      return { body: {} };
    });
    await getCourse('c1');
    await getTopic('t1');
    expect(calls.filter((call) => call.includes('/api/courses') || call.includes('/api/topics'))).toEqual(['GET /api/courses/c1', 'GET /api/topics/t1']);
  });

  it('uploads a course cover in three steps, sending the file to the returned link without the sign-in header', async () => {
    const calls: { key: string; headers: Record<string, string> }[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push({ key: `${init.method ?? 'GET'} ${url}`, headers: (init.headers ?? {}) as Record<string, string> });
      if (url === '/api/courses/c1/cover') return { status: 201, body: { fileId: 'f1', url: 'https://storage.example/put?sig=1', headers: { 'Content-Type': 'image/png' } } };
      if (url === 'https://storage.example/put?sig=1') return { status: 200, body: {} };
      return { body: { id: 'c1', lessons: [] } };
    });
    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    await expect(uploadCourseCover('c1', file)).resolves.toMatchObject({ id: 'c1' });
    const steps = calls.filter((call) => /cover|storage\.example/.test(call.key));
    expect(steps.map((call) => call.key)).toEqual(['POST /api/courses/c1/cover', 'PUT https://storage.example/put?sig=1', 'POST /api/courses/c1/cover/f1/complete']);
    expect(steps[1]!.headers).not.toHaveProperty('Authorization');
  });
});

describe('lesson and topic api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the lesson and topic endpoints', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`.trim());
      return { body: {} };
    });
    await addLesson('c1', 'Exits');
    await renameLesson('l1', 'Exit routes');
    await reorderLessons('c1', ['l2', 'l1']);
    await addTopic('l1', 'Fire exits');
    await reorderTopics('l1', ['t2', 't1']);
    await updateTopic('t1', { description: 'Words' });
    expect(calls.filter((call) => /\/api\/(courses|lessons|topics)\//.test(call))).toEqual([
      'POST /api/courses/c1/lessons {"title":"Exits"}',
      'PATCH /api/lessons/l1 {"title":"Exit routes"}',
      'PUT /api/courses/c1/lessons/order {"ids":["l2","l1"]}',
      'POST /api/lessons/l1/topics {"title":"Fire exits"}',
      'PUT /api/lessons/l1/topics/order {"ids":["t2","t1"]}',
      'PATCH /api/topics/t1 {"description":"Words"}',
    ]);
  });
});
