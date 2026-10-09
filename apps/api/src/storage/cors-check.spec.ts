import { evaluateCors } from './cors-check';

const ORIGIN = 'https://lms.example.org';

describe('evaluateCors', () => {
  it('accepts a bucket that allows the origin, PUT and exposes ETag', () => {
    expect(evaluateCors({ allowOrigin: ORIGIN, allowMethods: 'GET, PUT, HEAD', exposeHeaders: 'ETag' }, ORIGIN)).toEqual([]);
  });

  it('accepts a wildcard origin and different header casing', () => {
    expect(evaluateCors({ allowOrigin: '*', allowMethods: 'put', exposeHeaders: 'x-other, etag' }, ORIGIN)).toEqual([]);
  });

  it('reports every problem in plain words', () => {
    const problems = evaluateCors({ allowOrigin: null, allowMethods: null, exposeHeaders: null }, ORIGIN);
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/allow the web address/i);
    expect(problems.join(' ')).toMatch(/PUT/);
    expect(problems.join(' ')).toMatch(/ETag/);
  });

  it('reports a different origin and a missing ETag separately', () => {
    const problems = evaluateCors({ allowOrigin: 'https://other.example', allowMethods: 'PUT', exposeHeaders: 'x-amz-request-id' }, ORIGIN);
    expect(problems).toHaveLength(2);
  });
});
