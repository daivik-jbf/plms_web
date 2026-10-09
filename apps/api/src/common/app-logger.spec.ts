import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { type AppLogger, requestLogger } from './app-logger';

function run(path: string): Record<string, unknown> {
  const logged: Record<string, unknown>[] = [];
  const logger = { event: (fields: Record<string, unknown>) => logged.push(fields) } as unknown as AppLogger;
  const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
  requestLogger(logger)({ method: 'PUT', path } as Request, res, () => undefined);
  res.emit('finish');
  return logged[0] as Record<string, unknown>;
}

describe('requestLogger', () => {
  it('logs the path of ordinary requests', () => {
    expect(run('/api/audit').path).toBe('/api/audit');
  });

  it('never logs the signed link inside a development storage path', () => {
    const entry = run('/api/dev-storage/eyJvcCI6InB1dCJ9.c2lnbmF0dXJl');
    expect(entry.path).toBe('/api/dev-storage/[link]');
    expect(JSON.stringify(entry)).not.toContain('eyJ');
  });

  it.each(['/API/DEV-STORAGE/eyJvcCI6InB1dCJ9.c2lnbmF0dXJl', '/Api/Dev-Storage/eyJvcCI6InB1dCJ9.c2lnbmF0dXJl'])(
    'redacts the link whatever the letter case of the path (%s)',
    (path) => {
      const entry = run(path);
      expect(entry.path).toBe('/api/dev-storage/[link]');
      expect(JSON.stringify(entry)).not.toContain('eyJ');
    },
  );
});
