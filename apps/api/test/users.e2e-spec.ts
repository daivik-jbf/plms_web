import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

describe('user management', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  // The suite shares one database, so each test starts from "exactly these admins are active".
  const isolateAdmins = async (keepIds: string[]) => {
    const all = await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    for (const a of all) {
      if (!keepIds.includes(a.id)) {
        await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, a.id));
      }
    }
  };

  it('is Admin-only on every route', async () => {
    const staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
    const id = '00000000-0000-4000-8000-000000000000';
    await http().get('/api/users').expect(401);
    await http().get('/api/users').set(...bearer(staff)).expect(403);
    await http().patch(`/api/users/${id}/role`).set(...bearer(staff)).send({ role: 'admin' }).expect(403);
    await http().post(`/api/users/${id}/deactivate`).set(...bearer(staff)).expect(403);
    await http().post(`/api/users/${id}/reactivate`).set(...bearer(staff)).expect(403);
  });

  it('lists users without any credential fields', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const res = await http().get('/api/users').set(...bearer(await loginMobile(app, admin.email))).expect(200);
    const row = res.body.find((u: { id: string }) => u.id === admin.id);
    expect(row).toEqual({ id: admin.id, email: admin.email, name: 'Test User', role: 'admin', status: 'active', createdAt: expect.any(String) });
  });

  it('changes a role and records before and after', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff' });
    const session = await loginMobile(app, admin.email);
    const res = await http().patch(`/api/users/${target.id}/role`).set(...bearer(session)).send({ role: 'admin' }).expect(200);
    expect(res.body.role).toBe('admin');
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, 'user.role_changed')));
    expect(row.changes).toEqual({ role: { before: 'staff', after: 'admin' } });
    expect(row.actorId).toBe(admin.id);
  });

  it('rejects an invalid role and an unknown user', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const session = await loginMobile(app, admin.email);
    await http().patch(`/api/users/${admin.id}/role`).set(...bearer(session)).send({ role: 'owner' }).expect(400);
    await http().patch('/api/users/00000000-0000-4000-8000-000000000000/role').set(...bearer(session)).send({ role: 'staff' }).expect(404);
    await http().post('/api/users/not-a-uuid/deactivate').set(...bearer(session)).expect(400);
  });

  it('deactivating locks the user out immediately and revokes their sessions', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff' });
    const adminSession = await loginMobile(app, admin.email);
    const targetSession = await loginMobile(app, target.email);

    await http().post(`/api/users/${target.id}/deactivate`).set(...bearer(adminSession)).expect(200);
    await http().get('/api/auth/me').set(...bearer(targetSession)).expect(401);
    await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: targetSession.refreshToken }).expect(401);
    await http().post('/api/auth/login').send({ email: target.email, password: 'correct horse battery', client: 'mobile' }).expect(401);

    await http().post(`/api/users/${target.id}/reactivate`).set(...bearer(adminSession)).expect(200);
    await loginMobile(app, target.email);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, target.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.deactivated', 'user.reactivated']));
  });

  it('is idempotent and does not write duplicate audit rows for a no-op', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff', status: 'deactivated' });
    const session = await loginMobile(app, admin.email);
    await http().post(`/api/users/${target.id}/deactivate`).set(...bearer(session)).expect(200);
    await http().patch(`/api/users/${target.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(200);
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, target.id))).toHaveLength(0);
  });

  describe('last active Admin', () => {
    it('cannot be demoted or deactivated', async () => {
      const only = await createUser(db, { role: 'admin' });
      await isolateAdmins([only.id]);
      const session = await loginMobile(app, only.email);
      const demote = await http().patch(`/api/users/${only.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(409);
      expect(demote.body.message).toBe('At least one active Admin is required.');
      await http().post(`/api/users/${only.id}/deactivate`).set(...bearer(session)).expect(409);
      expect((await db.select().from(users).where(eq(users.id, only.id)))[0]).toMatchObject({ role: 'admin', status: 'active' });
    });

    it('can be demoted once another active Admin exists', async () => {
      const a = await createUser(db, { role: 'admin' });
      const b = await createUser(db, { role: 'admin' });
      await isolateAdmins([a.id, b.id]);
      const session = await loginMobile(app, a.email);
      await http().patch(`/api/users/${b.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(200);
      await http().patch(`/api/users/${a.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(409);
    });

    it('leaves exactly one Admin when two Admins demote each other at the same instant', async () => {
      const a = await createUser(db, { role: 'admin' });
      const b = await createUser(db, { role: 'admin' });
      await isolateAdmins([a.id, b.id]);
      const sessionA = await loginMobile(app, a.email);
      const sessionB = await loginMobile(app, b.email);
      const results = await Promise.all([
        http().patch(`/api/users/${b.id}/role`).set(...bearer(sessionA)).send({ role: 'staff' }),
        http().patch(`/api/users/${a.id}/role`).set(...bearer(sessionB)).send({ role: 'staff' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const remaining = await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
      expect(remaining.filter((u) => [a.id, b.id].includes(u.id))).toHaveLength(1);
    });
  });
});
