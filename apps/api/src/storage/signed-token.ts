import { createHmac, timingSafeEqual } from 'node:crypto';

export type LinkPayload =
  | { op: 'part'; key: string; uploadId: string; partNumber: number; exp: number }
  | { op: 'put'; key: string; contentType: string; exp: number }
  | { op: 'get'; key: string; contentType: string; exp: number };

const OPERATIONS = new Set(['part', 'put', 'get']);

const sign = (body: string, secret: string): string => createHmac('sha256', secret).update(body).digest('base64url');

export function signLink(payload: LinkPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyLink(token: string, secret: string, nowMs: number): LinkPayload | null {
  const pieces = token.split('.');
  const [body, signature] = pieces;
  if (pieces.length !== 2 || !body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: LinkPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkPayload;
  } catch {
    return null;
  }
  if (!OPERATIONS.has(payload.op) || typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
  return payload;
}
