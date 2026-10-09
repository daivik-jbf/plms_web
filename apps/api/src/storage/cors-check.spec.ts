import { evaluateCors } from './cors-check';

const ORIGIN = 'https://lms.example.org';

describe('evaluateCors', () => {
  it('accepts a bucket that allows the origin, PUT and exposes ETag', () => {
    expect(evaluateCors({ allowOrigin: ORIGIN, allowMethods: 'GET, PUT, HEAD', allowHeaders: 'Content-Type', exposeHeaders: 'ETag' }, ORIGIN)).toEqual([]);
  });

  it('accepts a wildcard origin and different header casing', () => {
    expect(evaluateCors({ allowOrigin: '*', allowMethods: 'put', allowHeaders: 'x-other, content-type', exposeHeaders: 'x-other, etag' }, ORIGIN)).toEqual([]);
  });

  it('reports every problem in plain words', () => {
    const problems = evaluateCors({ allowOrigin: null, allowMethods: null, allowHeaders: null, exposeHeaders: null }, ORIGIN);
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/allow the web address/i);
    expect(problems.join(' ')).toMatch(/PUT/);
    expect(problems.join(' ')).toMatch(/Content-Type/);
    expect(problems.join(' ')).toMatch(/ETag/);
  });

  it('reports a different origin and a missing ETag separately', () => {
    const problems = evaluateCors({ allowOrigin: 'https://other.example', allowMethods: 'PUT', allowHeaders: '*', exposeHeaders: 'x-amz-request-id' }, ORIGIN);
    expect(problems).toHaveLength(2);
  });

  it('reports a missing Content-Type permission, but accepts any casing or a wildcard', () => {
    const base = { allowOrigin: ORIGIN, allowMethods: 'PUT', exposeHeaders: 'ETag' };
    const missing = evaluateCors({ ...base, allowHeaders: 'x-amz-meta-foo' }, ORIGIN);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Content-Type/);
    expect(evaluateCors({ ...base, allowHeaders: null }, ORIGIN)).toHaveLength(1);
    expect(evaluateCors({ ...base, allowHeaders: 'CONTENT-TYPE' }, ORIGIN)).toEqual([]);
    expect(evaluateCors({ ...base, allowHeaders: '*' }, ORIGIN)).toEqual([]);
  });
});
