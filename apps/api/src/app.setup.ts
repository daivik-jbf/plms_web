import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { type AppLogger, requestLogger } from './common/app-logger';
import { requestContextMiddleware } from './common/request-context.middleware';
import type { Env } from './config/env';

export function configureApp(app: NestExpressApplication, env: Env, logger: AppLogger): void {
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(requestLogger(logger));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client', 'X-App-Version'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();
}
