import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

describe('opaque tokens', () => {
  it('generates unique url-safe tokens whose hash is reproducible', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashOpaqueToken(a.token)).toBe(a.hash);
    expect(a.hash).not.toContain(a.token);
  });
});
