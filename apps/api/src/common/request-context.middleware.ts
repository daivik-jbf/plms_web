import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestMeta } from './request-context';

const readHeader = (req: Request, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
};

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  runWithRequestMeta(
    {
      requestId,
      ip: req.ip ?? null,
      userAgent: readHeader(req, 'user-agent'),
      source: readHeader(req, 'x-client') === 'mobile' ? 'mobile' : 'portal',
      appVersion: readHeader(req, 'x-app-version'),
    },
    () => next(),
  );
}
