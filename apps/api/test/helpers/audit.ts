import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/db/db.module';
import { type AuditChanges, auditLog, type Role } from '../../src/db/schema';

export interface SeedRow {
  occurredAt?: Date;
  actorId?: string | null;
  actorRole?: Role | null;
  actorLabel?: string | null;
  action?: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  source?: string;
  changes?: AuditChanges | null;
  metadata?: Record<string, unknown> | null;
}

export async function seedAudit(db: Database, rows: SeedRow[]): Promise<string[]> {
  const inserted = await db
    .insert(auditLog)
    .values(rows.map((row) => ({ action: 'auth.login.succeeded', source: 'portal', ...row })))
    .returning({ id: auditLog.id });
  return inserted.map((row) => row.id);
}

// Inserts one row at an exact timestamp string (microsecond precision), for paging tests.
export async function seedAuditAt(db: Database, occurredAt: string, row: { actorId?: string; action?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into audit_log (id, occurred_at, actor_id, action, source)
        values (${id}, ${occurredAt}::timestamptz, ${row.actorId ?? null}, ${row.action ?? 'auth.login.succeeded'}, 'portal')`,
  );
  return id;
}
