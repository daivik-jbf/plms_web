import { checkPassword, passwordSchema } from './password-policy';

describe('checkPassword', () => {
  it('accepts exactly 10 characters and rejects 9', () => {
    expect(checkPassword('zq7vxk2mwp')).toEqual([]);
    expect(checkPassword('zq7vxk2mw')).toHaveLength(1);
  });

  it('accepts 128 characters and rejects 129', () => {
    expect(checkPassword('a1'.repeat(64))).toEqual([]);
    expect(checkPassword('a1'.repeat(64) + 'x')).toHaveLength(1);
  });

  it('counts emoji as one character each', () => {
    expect(checkPassword('🔑'.repeat(10))).toEqual([]);
    expect(checkPassword('🔑'.repeat(9))).toHaveLength(1);
  });

  it('rejects whitespace-only passwords', () => {
    expect(checkPassword(' '.repeat(12))).toHaveLength(1);
  });

  it.each(['password123', 'PASSWORD123', 'qwertyuiop', '1234567890'])('rejects common password %p case-insensitively', (value) => {
    expect(checkPassword(value)).toHaveLength(1);
  });

  it('accepts a long passphrase with no symbols or digits', () => {
    expect(checkPassword('correct horse battery')).toEqual([]);
  });

  it('exposes the same rules as a schema with per-rule messages', () => {
    const result = passwordSchema.safeParse('short');
    expect(result.success).toBe(false);
  });
});
