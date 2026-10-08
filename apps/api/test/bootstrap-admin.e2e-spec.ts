import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { bootstrapAdmin } from '../src/cli/bootstrap-admin';
import type { Database } from '../src/db/db.module';
import { auditLog, invites, users } from '../src/db/schema';
import { InvitesService } from '../src/invites/invites.service';
import { createTestApp } from './helpers/app';
import type { MemoryMailer } from './helpers/memory-mailer';

describe('bootstrapAdmin', () => {
  let app: NestExpressApplication;
  let db: Database;
  let invitesService: InvitesService;
  let mailer: MemoryMailer;

  beforeAll(async () => {
    ({ app, db, mailer } = await createTestApp());
    invitesService = app.get(InvitesService);
  });

  afterAll(() => app.close());

  it('refuses when an Admin already exists', async () => {
    await db.insert(users).values({ email: 'existing.admin@example.com', name: 'Existing', role: 'admin', passwordHash: 'x' });
    await expect(bootstrapAdmin({ invites: invitesService, db }, 'first@example.com', 'First Admin')).rejects.toThrow(
      'An Admin already exists',
    );
  });

  describe('on a system with no Admin', () => {
    beforeAll(async () => {
      await db.update(users).set({ role: 'staff' }).where(eq(users.role, 'admin'));
    });

    it('creates an Admin invite and returns a link that works, without sending email', async () => {
      mailer.clear();
      const link = await bootstrapAdmin({ invites: invitesService, db }, 'First@Example.com', 'First Admin');
      expect(mailer.sent).toHaveLength(0);
      const token = new URL(link).searchParams.get('token')!;
      await request(app.getHttpServer()).post('/api/invites/accept').send({ token, password: 'a long first passphrase' }).expect(201);
      const [created] = await db.select().from(users).where(eq(users.email, 'first@example.com'));
      expect(created.role).toBe('admin');
      const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'invite.created'), eq(auditLog.targetLabel, 'first@example.com')));
      expect(entry.source).toBe('system');
    });

    it('re-running for the same email issues a fresh link instead of failing', async () => {
      await db.update(users).set({ role: 'staff' }).where(eq(users.role, 'admin'));
      const first = await bootstrapAdmin({ invites: invitesService, db }, 'second@example.com', 'Second Admin');
      const second = await bootstrapAdmin({ invites: invitesService, db }, 'second@example.com', 'Second Admin');
      expect(second).not.toBe(first);
      expect(await db.select().from(invites).where(eq(invites.email, 'second@example.com'))).toHaveLength(1);
    });

    it('refuses to turn a pending Staff invite into an Admin invite', async () => {
      await db.update(users).set({ role: 'staff' }).where(eq(users.role, 'admin'));
      await db.insert(invites).values({
        email: 'pending.staff@example.com',
        name: 'Pending Staff',
        role: 'staff',
        tokenHash: 'not-a-real-hash-pending-staff',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(bootstrapAdmin({ invites: invitesService, db }, 'pending.staff@example.com', 'Pending Staff')).rejects.toThrow(
        /pending staff invite already exists/i,
      );
      const [invite] = await db.select().from(invites).where(eq(invites.email, 'pending.staff@example.com'));
      expect(invite).toMatchObject({ role: 'staff', tokenHash: 'not-a-real-hash-pending-staff' });
    });

    it('validates the email and name', async () => {
      await expect(bootstrapAdmin({ invites: invitesService, db }, 'nope', 'R2D2')).rejects.toThrow(/email|name/i);
    });
  });
});
