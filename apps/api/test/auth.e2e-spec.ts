import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { hashOpaqueToken } from '../src/auth/opaque-token';
import { auditLog, refreshTokens, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('authentication', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const refreshCookie = (setCookie: string[] | string | undefined): string => {
    const header = ([] as string[]).concat(setCookie ?? []).find((c) => c.startsWith('jbf_rt='));
    if (!header) throw new Error('no refresh cookie');
    return header.split(';')[0];
  };

  describe('login', () => {
    it('signs a web user in, sets an HttpOnly cookie and keeps the refresh token out of the body', async () => {
      const user = await createUser(db, { email: 'web@example.com' });
      const res = await http().post('/api/auth/login').send({ email: 'web@example.com', password: TEST_PASSWORD }).expect(200);
      expect(res.body.user).toEqual({ id: user.id, email: 'web@example.com', name: 'Test User', role: 'staff' });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toBeUndefined();
      const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('jbf_rt='))!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('returns the refresh token in the body for mobile and sets no cookie', async () => {
      const user = await createUser(db);
      const res = await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(200);
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('treats email case and surrounding whitespace as the same account', async () => {
      await createUser(db, { email: 'anita@example.com' });
      await http().post('/api/auth/login').send({ email: '  Anita@Example.COM ', password: TEST_PASSWORD }).expect(200);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const user = await createUser(db);
      const wrong = await http().post('/api/auth/login').send({ email: user.email, password: 'definitely wrong' }).expect(401);
      const unknown = await http().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'definitely wrong' }).expect(401);
      expect(wrong.body.message).toBe('Invalid email or password.');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('rejects a deactivated user even with the right password', async () => {
      const user = await createUser(db, { status: 'deactivated' });
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(401);
    });

    it('rejects malformed bodies with field errors', async () => {
      const res = await http().post('/api/auth/login').send({ email: 'nope', password: '' }).expect(400);
      expect(res.body.fieldErrors.email).toBeDefined();
    });

    it('locks the account after 5 failures, then allows login again once the lock has expired', async () => {
      const user = await createUser(db);
      for (let i = 0; i < 5; i += 1) {
        await http().post('/api/auth/login').send({ email: user.email, password: 'wrong wrong wrong' }).expect(401);
      }
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(429);
      await db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, user.id));
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    });

    it('records success and failure in the audit log without any secrets', async () => {
      const user = await createUser(db);
      await http().post('/api/auth/login').send({ email: user.email, password: 'nope nope nope' }).expect(401);
      await http().post('/api/auth/login').set('X-Client', 'mobile').set('X-App-Version', '2.0.1').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(200);
      const rows = await db.select().from(auditLog).where(eq(auditLog.actorId, user.id));
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.login.failed', 'auth.login.succeeded']));
      const success = rows.find((r) => r.action === 'auth.login.succeeded')!;
      expect(success).toMatchObject({ source: 'mobile', appVersion: '2.0.1', actorRole: 'staff' });
      expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(rows)).not.toContain(user.passwordHash);
    });

    it('records a failed login for an unknown email using the typed email as the label', async () => {
      await http().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope nope nope' }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'auth.login.failed'), eq(auditLog.actorLabel, 'ghost@example.com')));
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('access control', () => {
    it('requires a bearer token on /me and returns the current user', async () => {
      const user = await createUser(db, { role: 'admin' });
      await http().get('/api/auth/me').expect(401);
      const session = await loginMobile(app, user.email);
      const res = await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, name: 'Test User', role: 'admin' });
    });

    it('rejects a garbage bearer token', async () => {
      await http().get('/api/auth/me').set('Authorization', 'Bearer not-a-token').expect(401);
    });

    it('rejects a still-valid access token the moment the user is deactivated', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().get('/api/auth/me').set(...bearer(session)).expect(401);
    });

    it('keeps health public and the password policy public', async () => {
      await http().get('/api/health').expect(200);
      const res = await http().get('/api/auth/password-policy').expect(200);
      expect(res.body).toEqual({ minLength: 10, maxLength: 128 });
    });
  });

  describe('refresh tokens', () => {
    it('rotates on refresh for mobile', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const res = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await http().get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('refreshes a web session from the cookie and requires the CSRF header', async () => {
      const user = await createUser(db);
      const login = await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const cookie = refreshCookie(login.headers['set-cookie']);
      await http().post('/api/auth/refresh').set('Cookie', cookie).send({ client: 'web' }).expect(403);
      const res = await http().post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'jbf-web').send({ client: 'web' }).expect(200);
      expect(refreshCookie(res.headers['set-cookie'])).not.toBe(cookie);
    });

    it('rejects a replayed token inside the grace window without ending the session', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const rotated = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: rotated.body.refreshToken }).expect(200);
    });

    it('revokes the whole family when a rotated token is replayed after the grace window', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const rotated = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      await db.update(refreshTokens).set({ revokedAt: new Date(Date.now() - 60_000) }).where(eq(refreshTokens.tokenHash, hashOpaqueToken(first.refreshToken)));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: rotated.body.refreshToken }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.refresh.reuse_detected')));
      expect(rows).toHaveLength(1);
    });

    it('serves two parallel refreshes without logging the user out', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const results = await Promise.all([
        http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }),
        http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }),
      ]);
      const winner = results.find((r) => r.status === 200);
      expect(winner).toBeDefined();
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: winner!.body.refreshToken }).expect(200);
    });

    it('refuses to refresh for a deactivated user', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
    });

    it('rejects an expired or unknown refresh token', async () => {
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: 'unknown' }).expect(401);
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(refreshTokens.userId, user.id));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session and is idempotent', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await http().post('/api/auth/logout').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await http().post('/api/auth/logout').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(204);
      await http().post('/api/auth/logout').send({ client: 'mobile' }).expect(204);
    });

    it('logout-all revokes every session for the user', async () => {
      const user = await createUser(db);
      const a = await loginMobile(app, user.email);
      const b = await loginMobile(app, user.email);
      await http().post('/api/auth/logout-all').set(...bearer(a)).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: a.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: b.refreshToken }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.logout_all')));
      expect(rows).toHaveLength(1);
    });
  });
});
