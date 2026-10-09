import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { DB, PG_POOL, type Database } from '../../src/db/db.module';
import { MAILER } from '../../src/mail/mailer';
import { STORAGE } from '../../src/storage/storage.port';
import { InMemoryStorage } from '../support/in-memory-storage';
import { MemoryMailer } from './memory-mailer';

export async function createTestApp() {
  const mailer = new MemoryMailer();
  const storage = new InMemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(STORAGE)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const logger = new AppLogger('silent');
  app.useLogger(logger);
  configureApp(app, parseEnv(process.env), logger);
  await app.init();
  // Listen once on an ephemeral port. Without this supertest starts a server per request and closes the
  // shared one when any request ends, which breaks requests that are built before an awaited login.
  await app.listen(0);
  // Open several pool connections up front so tests that fire requests concurrently do not skew timing
  // by one request waiting on a fresh connection.
  await Promise.all(Array.from({ length: 4 }, () => app.get<Pool>(PG_POOL).query('select 1')));
  return { app, db: app.get<Database>(DB), mailer, storage };
}
