import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { DB, type Database } from '../../src/db/db.module';
import { MAILER } from '../../src/mail/mailer';
import { MemoryMailer } from './memory-mailer';

export async function createTestApp() {
  const mailer = new MemoryMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, parseEnv(process.env), new AppLogger('silent'));
  await app.init();
  return { app, db: app.get<Database>(DB), mailer };
}
