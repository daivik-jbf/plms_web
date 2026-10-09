import { signLink, verifyLink } from './signed-token';

const SECRET = 's'.repeat(40);
const now = Date.UTC(2026, 9, 8, 12, 0, 0);
const exp = Math.floor(now / 1000) + 3600;
const part = { op: 'part', key: 'videos/4c0d6f0e-5a49-4c0b-8f43-8a4a9d6a0f11', uploadId: 'u-1', partNumber: 3, exp } as const;

describe('signed links', () => {
  it('round-trips a payload', () => {
    expect(verifyLink(signLink(part, SECRET), SECRET, now)).toEqual(part);
  });

  it('rejects a tampered body, a tampered signature and another secret', () => {
    const token = signLink(part, SECRET);
    const [body, signature] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...part, partNumber: 4 })).toString('base64url');
    expect(verifyLink(`${forgedBody}.${signature}`, SECRET, now)).toBeNull();
    expect(verifyLink(`${body}.${signature.slice(0, -2)}xx`, SECRET, now)).toBeNull();
    expect(verifyLink(token, 'o'.repeat(40), now)).toBeNull();
  });

  it('rejects an expired link (the expiry second itself is already too late)', () => {
    expect(verifyLink(signLink({ ...part, exp: Math.floor(now / 1000) }, SECRET), SECRET, now)).toBeNull();
    expect(verifyLink(signLink({ ...part, exp: Math.floor(now / 1000) + 1 }, SECRET), SECRET, now)).not.toBeNull();
  });

  it.each(['', 'garbage', 'a.b.c', '.', 'a.', '.b'])('rejects malformed token %p', (token) => {
    expect(verifyLink(token, SECRET, now)).toBeNull();
  });

  it('rejects a payload with an unknown operation even when correctly signed', () => {
    const odd = signLink({ op: 'delete', key: 'x', exp } as never, SECRET);
    expect(verifyLink(odd, SECRET, now)).toBeNull();
  });
});
