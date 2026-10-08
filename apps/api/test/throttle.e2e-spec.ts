import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers/app';

describe('rate limiting', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.THROTTLE_ENABLED = 'true';
    ({ app } = await createTestApp());
  });

  afterAll(() => app.close());

  it('returns 429 after too many login attempts from one IP', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever whatever' });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      statuses.push((await attempt()).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toContain(429);
  });
});
