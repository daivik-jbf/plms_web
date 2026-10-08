import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, passwordResets, refreshTokens, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import type { MemoryMailer } from './helpers/memory-mailer';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('password reset and change', () => {
  let app: NestExpressApplication;
  let db: Database;
  let mailer: MemoryMailer;

  beforeAll(async () => {
    ({ app, db, mailer } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const tokenFromMail = (): string => new URL(mailer.last()!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

  describe('forgot password', () => {
    it('emails a link to a real account, case-insensitively', async () => {
      const user = await createUser(db, { email: 'forgetful@example.com' });
      mailer.clear();
      await http().post('/api/auth/forgot-password').send({ email: ' Forgetful@Example.COM ' }).expect(202);
      expect(mailer.last()!.to).toBe('forgetful@example.com');
      expect(mailer.last()!.text).toContain('/reset-password?token=');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.reset_requested')));
      expect(rows).toHaveLength(1);
    });

    it('answers identically for unknown and deactivated accounts and sends nothing', async () => {
      const deactivated = await createUser(db, { status: 'deactivated' });
      mailer.clear();
      const real = await http().post('/api/auth/forgot-password').send({ email: (await createUser(db)).email }).expect(202);
      const unknown = await http().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(202);
      mailer.clear();
      const off = await http().post('/api/auth/forgot-password').send({ email: deactivated.email }).expect(202);
      expect(unknown.body).toEqual(real.body);
      expect(off.body).toEqual(real.body);
      expect(mailer.sent).toHaveLength(0);
    });

    it('leaves exactly one live link when two requests for one account race', async () => {
      const user = await createUser(db);
      await Promise.all([
        http().post('/api/auth/forgot-password').send({ email: user.email }).expect(202),
        http().post('/api/auth/forgot-password').send({ email: user.email }).expect(202),
      ]);
      const live = await db.select().from(passwordResets).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
      expect(live).toHaveLength(1);
      expect(await db.select().from(passwordResets).where(eq(passwordResets.userId, user.id))).toHaveLength(2);
    });

    it('still answers 202 when the mail server is down', async () => {
      const user = await createUser(db);
      mailer.failNext = true;
      await http().post('/api/auth/forgot-password').send({ email: user.email }).expect(202);
    });
  });

  describe('reset password', () => {
    const requestReset = async (email: string): Promise<string> => {
      mailer.clear();
      await http().post('/api/auth/forgot-password').send({ email }).expect(202);
      return tokenFromMail();
    };

    it('sets the new password, ends all sessions, clears lockout and works once only', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(users).set({ failedLoginCount: 3, lockedUntil: new Date(Date.now() + 60_000) }).where(eq(users.id, user.id));
      const token = await requestReset(user.email);

      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(401);
      await loginMobile(app, user.email, 'a fresh new passphrase');

      const again = await http().post('/api/auth/reset-password').send({ token, newPassword: 'yet another passphrase' }).expect(400);
      expect(again.body.message).toBe('This reset link is invalid or has expired.');

      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.reset_completed')));
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain('fresh new passphrase');
    });

    it('rejects expired and unknown tokens with the same message', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.userId, user.id));
      const expired = await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(400);
      const unknown = await http().post('/api/auth/reset-password').send({ token: 'nope', newPassword: 'a fresh new passphrase' }).expect(400);
      expect(expired.body.message).toBe(unknown.body.message);
    });

    it('a newer request invalidates the older link', async () => {
      const user = await createUser(db);
      const first = await requestReset(user.email);
      const second = await requestReset(user.email);
      await http().post('/api/auth/reset-password').send({ token: first, newPassword: 'a fresh new passphrase' }).expect(400);
      await http().post('/api/auth/reset-password').send({ token: second, newPassword: 'a fresh new passphrase' }).expect(204);
    });

    it('enforces the password policy and keeps the link usable after a rejected password', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      for (const newPassword of ['short', 'qwertyuiop', '1234567890']) {
        const res = await http().post('/api/auth/reset-password').send({ token, newPassword }).expect(400);
        expect(res.body.fieldErrors.newPassword).toBeDefined();
      }
      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(204);
    });

    it('does not let a deactivated user reset their way back in', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(400);
    });
  });

  describe('change password', () => {
    it('requires the current password, applies the policy and ends all sessions', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);

      await http().post('/api/auth/change-password').send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }).expect(401);

      const wrong = await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: 'not it at all', newPassword: 'a fresh new passphrase' }).expect(400);
      expect(wrong.body.fieldErrors.currentPassword).toBeDefined();

      const weak = await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'password123' }).expect(400);
      expect(weak.body.fieldErrors.newPassword).toBeDefined();

      await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await loginMobile(app, user.email, 'a fresh new passphrase');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.changed')));
      expect(rows).toHaveLength(1);
    });

    it('invalidates outstanding reset links', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      mailer.clear();
      await http().post('/api/auth/forgot-password').send({ email: user.email }).expect(202);
      const token = tokenFromMail();
      await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }).expect(204);
      await http().post('/api/auth/reset-password').send({ token, newPassword: 'yet another passphrase' }).expect(400);
    });

    it('never leaves a live refresh token when a refresh races a password change', async () => {
      for (let i = 0; i < 10; i += 1) {
        const user = await createUser(db);
        const session = await loginMobile(app, user.email);
        const [change, refresh] = await Promise.all([
          http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }),
          http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }),
        ]);
        expect(change.status).toBe(204);
        expect([200, 401]).toContain(refresh.status);
        const live = await db.select().from(refreshTokens).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
        expect(live).toHaveLength(0);
      }
    });
  });
});
