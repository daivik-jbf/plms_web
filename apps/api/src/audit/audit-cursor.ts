import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// `t` is the row's timestamp as Postgres prints it (microseconds), not a JS Date, so paging is exact.
const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
  id: z.uuid(),
});

export type AuditCursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (cursor: AuditCursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeCursor(token: string): AuditCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException({
      error: 'Bad Request',
      message: 'Validation failed',
      fieldErrors: { cursor: ['Invalid cursor.'] },
    });
  }
}
