import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { AuditService } from '../src/audit/audit.service';
import { runWithRequestMeta } from '../src/common/request-context';
import { auditLog } from '../src/db/schema';
import { createTestDb } from './helpers/db';

describe('AuditService', () => {
  const { db, close } = createTestDb();
  const audit = new AuditService();

  afterAll(close);

  it('records who, what, where and the request metadata', async () => {
    const actorId = randomUUID();
    const targetId = randomUUID();

    await runWithRequestMeta(
      { requestId: 'req-1', ip: '203.0.113.9', userAgent: 'jest', source: 'mobile', appVersion: '1.2.3' },
      () =>
        audit.record(db, {
          actor: { id: actorId, role: 'admin', label: 'Anita Rao' },
          action: 'user.role_changed',
          target: { type: 'user', id: targetId, label: 'ben@example.com' },
          changes: { role: { before: 'staff', after: 'admin' } },
        }),
    );

    const [row] = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(row).toMatchObject({
      actorId,
      actorRole: 'admin',
      actorLabel: 'Anita Rao',
      action: 'user.role_changed',
      targetType: 'user',
      targetLabel: 'ben@example.com',
      source: 'mobile',
      ip: '203.0.113.9',
      userAgent: 'jest',
      appVersion: '1.2.3',
      requestId: 'req-1',
      changes: { role: { before: 'staff', after: 'admin' } },
    });
  });

  it('marks entries written outside a request as system', async () => {
    const targetId = randomUUID();
    await audit.record(db, {
      actor: null,
      action: 'invite.created',
      target: { type: 'invite', id: targetId, label: 'x@example.com' },
    });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(row.source).toBe('system');
    expect(row.actorId).toBeNull();
  });

  it('rolls back with the surrounding transaction, so an action cannot succeed without its entry or vice versa', async () => {
    const targetId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await audit.record(tx, {
          actor: null,
          action: 'user.deactivated',
          target: { type: 'user', id: targetId, label: 'gone@example.com' },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(rows).toHaveLength(0);
  });
});
