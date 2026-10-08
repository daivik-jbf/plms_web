import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './audit-cursor';

describe('audit cursor', () => {
  const cursor = { t: '2026-10-08 10:42:07.123456+00', id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' };

  it('round-trips and is url-safe', () => {
    const token = encodeCursor(cursor);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(cursor);
  });

  it('accepts timestamps without fractional seconds and with half-hour offsets', () => {
    const odd = { t: '2026-10-08 10:42:07+05:30', id: cursor.id };
    expect(decodeCursor(encodeCursor(odd))).toEqual(odd);
  });

  it('accepts a leap day', () => {
    const leap = { t: '2028-02-29 23:59:59.999999-12:30', id: cursor.id };
    expect(decodeCursor(encodeCursor(leap))).toEqual(leap);
  });

  it.each([
    'garbage',
    '',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify({ t: 'yesterday', id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: '2026-10-08 10:42:07+00', id: 'nope' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: "2026-10-08'; drop table audit_log;--", id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })).toString('base64url'),
    ...['2026-13-45 99:99:99+00', '2026-02-30 00:00:00+00', '2026-10-08 24:00:00+00', '2026-10-08 10:42:60+00', '2026-10-08 10:42:07+16', '2026-10-08 10:42:07+05:60'].map(
      (t) => Buffer.from(JSON.stringify({ t, id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })).toString('base64url'),
    ),
  ])('rejects %p with a 400 about the cursor', (token) => {
    expect(() => decodeCursor(token)).toThrow(BadRequestException);
  });
});
