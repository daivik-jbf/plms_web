import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// `t` is the row's timestamp as Postgres prints it (microseconds), not a JS Date, so paging is exact.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/;

// Shape alone is not enough: Postgres rejects out-of-range values with an error, so check the calendar and clock too.
function isValidTimestamp(value: string): boolean {
  const match = TIMESTAMP.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part))) as [
    number, number, number, number, number, number, number, number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  const realDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return realDate && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 15 && offsetMinute <= 59;
}

const cursorSchema = z.object({
  t: z.string().refine(isValidTimestamp),
  id: z.uuid(),
});

export type AuditCursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (cursor: AuditCursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export const invalidCursor = (): BadRequestException =>
  new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    fieldErrors: { cursor: ['Invalid cursor.'] },
  });

export function decodeCursor(token: string): AuditCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    throw invalidCursor();
  }
}
