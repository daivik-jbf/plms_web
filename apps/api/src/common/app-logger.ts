import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import pino, { type Logger } from 'pino';
import { currentRequestMeta } from './request-context';

export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(level: string) {
    this.logger = pino({ level });
  }

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }

  event(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}

// Links for the development storage routes carry a signed token in the path; it must never reach the logs.
const loggablePath = (path: string): string => (path.startsWith('/api/dev-storage/') ? '/api/dev-storage/[link]' : path);

export function requestLogger(logger: AppLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = Date.now();
    const { requestId } = currentRequestMeta();
    res.on('finish', () => {
      logger.event(
        { requestId, method: req.method, path: loggablePath(req.path), status: res.statusCode, ms: Date.now() - started },
        'request',
      );
    });
    next();
  };
}
