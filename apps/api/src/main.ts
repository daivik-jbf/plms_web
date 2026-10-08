import './config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/app-logger';
import { parseEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = new AppLogger(env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  configureApp(app, env, logger);
  await app.listen(env.PORT);
  logger.event({ port: env.PORT }, 'API listening');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
