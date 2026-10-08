import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and verifies', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, 'correct horse battery')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong horse battery')).resolves.toBe(false);
  });

  it('never throws on a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('can run a dummy verification', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
