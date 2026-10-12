import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession, STAFF } from '../test/session';
import { createCourse, listCourses, reorderCourses, updateCourse } from './courses';

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
