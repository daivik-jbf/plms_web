import { SignJWT } from 'jose';
import { parseEnv } from '../config/env';
import { TokenService } from './token.service';

const env = parseEnv({
  DATABASE_URL: 'postgres://localhost/x',
  JWT_ACCESS_SECRET: 's'.repeat(40),
  WEB_ORIGIN: 'http://localhost:5173',
});
const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

describe('TokenService', () => {
  const service = new TokenService(env);

  it('round-trips the user id', async () => {
    const token = await service.signAccess('user-1');
    await expect(service.verifyAccess(token)).resolves.toBe('user-1');
  });

  it('rejects a tampered token', async () => {
    const token = await service.signAccess('user-1');
    await expect(service.verifyAccess(token.slice(0, -2) + 'xx')).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('jbf-lms')
      .setAudience('jbf-lms-api')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    await expect(service.verifyAccess(expired)).resolves.toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const other = new TextEncoder().encode('o'.repeat(40));
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('jbf-lms')
      .setAudience('jbf-lms-api')
      .setExpirationTime('15m')
      .sign(other);
    await expect(service.verifyAccess(forged)).resolves.toBeNull();
  });

  it('rejects garbage', async () => {
    await expect(service.verifyAccess('not.a.jwt')).resolves.toBeNull();
  });
});
