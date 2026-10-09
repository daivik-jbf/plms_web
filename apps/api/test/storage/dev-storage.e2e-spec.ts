import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('development storage routes without the local driver', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(() => app.close());

  it('answer 404 for every method, so nothing is exposed when another driver is in use', async () => {
    await request(app.getHttpServer()).put('/api/dev-storage/anything.signature').send('x').expect(404);
    await request(app.getHttpServer()).get('/api/dev-storage/anything.signature').expect(404);
  });
});
