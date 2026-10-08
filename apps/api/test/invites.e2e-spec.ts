import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, invites, users } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import type { MemoryMailer } from './helpers/memory-mailer';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('invites', () => {
  let app: NestExpressApplication;
  let db: Database;
  let mailer: MemoryMailer;
  let admin: Session;
  let adminId: string;
  let staff: Session;

  beforeAll(async () => {
    ({ app, db, mailer } = await createTestApp());
    const adminUser = await createUser(db, { role: 'admin', name: 'Admin One' });
    adminId = adminUser.id;
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const tokenFromMail = (): string => new URL(mailer.last()!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  const invite = (body: object) => http().post('/api/invites').set(...bearer(admin)).send(body);

  describe('creating', () => {
    it('lets an Admin invite, emails a single-use link and never returns the token', async () => {
      mailer.clear();
      const res = await invite({ email: 'new.person@example.com', name: 'New Person', role: 'staff' }).expect(201);
      expect(res.body).toMatchObject({ email: 'new.person@example.com', name: 'New Person', role: 'staff', status: 'pending' });
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      expect(mailer.last()!.to).toBe('new.person@example.com');
      expect(mailer.last()!.text).toContain('/accept-invite?token=');
      const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminId), eq(auditLog.action, 'invite.created'), eq(auditLog.targetId, res.body.id)));
      expect(rows).toHaveLength(1);
    });

    it('is Admin-only: Staff get 403 and anonymous callers get 401 on every invite-management route', async () => {
      const body = { email: 'x@example.com', name: 'X', role: 'staff' };
      await http().post('/api/invites').send(body).expect(401);
      await http().post('/api/invites').set(...bearer(staff)).send(body).expect(403);
      await http().get('/api/invites').set(...bearer(staff)).expect(403);
      await http().post('/api/invites/00000000-0000-4000-8000-000000000000/resend').set(...bearer(staff)).expect(403);
      await http().delete('/api/invites/00000000-0000-4000-8000-000000000000').set(...bearer(staff)).expect(403);
    });

    it('normalizes the email so a differently cased address is a duplicate, not a second account', async () => {
      await invite({ email: 'dup@example.com', name: 'Dup', role: 'staff' }).expect(201);
      await invite({ email: '  DUP@Example.com ', name: 'Dup Again', role: 'staff' }).expect(409);
    });

    it('refuses to invite an email that already has an account', async () => {
      const existing = await createUser(db);
      await invite({ email: existing.email, name: 'Existing', role: 'staff' }).expect(409);
    });

    it('validates name, email and role', async () => {
      const res = await invite({ email: 'bad', name: 'R2D2', role: 'owner' }).expect(400);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['email', 'name', 'role']);
    });

    it('tells the Admin when the email could not be sent, but keeps the invite for resending', async () => {
      mailer.failNext = true;
      const res = await invite({ email: 'mailfail@example.com', name: 'Mail Fail', role: 'staff' }).expect(502);
      expect(res.body.message).toMatch(/resend/i);
      const list = await http().get('/api/invites').set(...bearer(admin)).expect(200);
      expect(list.body.map((i: { email: string }) => i.email)).toContain('mailfail@example.com');
    });
  });

  describe('accepting', () => {
    it('previews the invite, then creates the account with the invited role and lets the person sign in', async () => {
      mailer.clear();
      await invite({ email: 'Accept.Me@example.com', name: 'Accept Me', role: 'admin' }).expect(201);
      const token = tokenFromMail();
      const preview = await http().post('/api/invites/preview').send({ token }).expect(200);
      expect(preview.body).toEqual({ name: 'Accept Me', email: 'accept.me@example.com' });

      await http().post('/api/invites/accept').send({ token, password: 'a brand new passphrase' }).expect(201);
      const session = await loginMobile(app, 'accept.me@example.com', 'a brand new passphrase');
      const me = await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      expect(me.body.role).toBe('admin');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'invite.accepted'), eq(auditLog.actorId, me.body.id)));
      expect(rows).toHaveLength(1);
    });

    it('cannot be used twice', async () => {
      mailer.clear();
      await invite({ email: 'once@example.com', name: 'Once', role: 'staff' }).expect(201);
      const token = tokenFromMail();
      await http().post('/api/invites/accept').send({ token, password: 'a brand new passphrase' }).expect(201);
      const again = await http().post('/api/invites/accept').send({ token, password: 'another passphrase here' }).expect(400);
      expect(again.body.message).toBe('This invite link is invalid or has expired.');
      await http().post('/api/invites/preview').send({ token }).expect(400);
    });

    it('rejects expired, cancelled and unknown tokens with the same message', async () => {
      mailer.clear();
      const created = await invite({ email: 'expiring@example.com', name: 'Expiring', role: 'staff' }).expect(201);
      const expiredToken = tokenFromMail();
      await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, created.body.id));
      const expired = await http().post('/api/invites/accept').send({ token: expiredToken, password: 'a brand new passphrase' }).expect(400);

      mailer.clear();
      const toCancel = await invite({ email: 'cancel.me@example.com', name: 'Cancel Me', role: 'staff' }).expect(201);
      const cancelledToken = tokenFromMail();
      await http().delete(`/api/invites/${toCancel.body.id}`).set(...bearer(admin)).expect(204);
      const cancelled = await http().post('/api/invites/accept').send({ token: cancelledToken, password: 'a brand new passphrase' }).expect(400);

      const unknown = await http().post('/api/invites/accept').send({ token: 'nope', password: 'a brand new passphrase' }).expect(400);
      expect(new Set([expired.body.message, cancelled.body.message, unknown.body.message]).size).toBe(1);
    });

    it('enforces the password policy and leaves the invite usable after a rejected password', async () => {
      mailer.clear();
      await invite({ email: 'policy@example.com', name: 'Policy', role: 'staff' }).expect(201);
      const token = tokenFromMail();
      for (const password of ['short', 'password123', ' '.repeat(12), 'a1'.repeat(64) + 'x']) {
        const res = await http().post('/api/invites/accept').send({ token, password }).expect(400);
        expect(res.body.fieldErrors.password).toBeDefined();
      }
      await http().post('/api/invites/accept').send({ token, password: '🔑'.repeat(10) }).expect(201);
    });
  });

  describe('resending and cancelling', () => {
    it('resend issues a new link, extends expiry and invalidates the old link', async () => {
      mailer.clear();
      const created = await invite({ email: 'resend@example.com', name: 'Resend', role: 'staff' }).expect(201);
      const oldToken = tokenFromMail();
      await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, created.body.id));

      mailer.clear();
      const res = await http().post(`/api/invites/${created.body.id}/resend`).set(...bearer(admin)).expect(200);
      expect(res.body.status).toBe('pending');
      const newToken = tokenFromMail();
      expect(newToken).not.toBe(oldToken);
      await http().post('/api/invites/accept').send({ token: oldToken, password: TEST_PASSWORD }).expect(400);
      await http().post('/api/invites/accept').send({ token: newToken, password: TEST_PASSWORD }).expect(201);
    });

    it('cannot resend or cancel an invite that was already accepted', async () => {
      mailer.clear();
      const created = await invite({ email: 'accepted.already@example.com', name: 'Accepted', role: 'staff' }).expect(201);
      await http().post('/api/invites/accept').send({ token: tokenFromMail(), password: TEST_PASSWORD }).expect(201);
      await http().post(`/api/invites/${created.body.id}/resend`).set(...bearer(admin)).expect(409);
      await http().delete(`/api/invites/${created.body.id}`).set(...bearer(admin)).expect(409);
    });

    it('returns 404 for an unknown invite id and 400 for a malformed one', async () => {
      await http().post('/api/invites/00000000-0000-4000-8000-000000000000/resend').set(...bearer(admin)).expect(404);
      await http().delete('/api/invites/not-a-uuid').set(...bearer(admin)).expect(400);
    });

    it('lists invites with derived status', async () => {
      const res = await http().get('/api/invites').set(...bearer(admin)).expect(200);
      const statuses = new Set(res.body.map((i: { status: string }) => i.status));
      expect(statuses).toContain('pending');
      expect(statuses).toContain('accepted');
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('expired');
      expect(await db.select().from(users).where(eq(users.email, 'accept.me@example.com'))).toHaveLength(1);
    });
  });
});
