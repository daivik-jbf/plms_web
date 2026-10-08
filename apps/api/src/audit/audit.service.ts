import { Injectable } from '@nestjs/common';
import { currentRequestMeta } from '../common/request-context';
import type { DbExecutor } from '../db/db.module';
import { type AuditChanges, auditLog, type Role } from '../db/schema';
import type { AuditAction } from './audit.actions';

interface AuditEntry {
  actor: { id?: string | null; role?: Role | null; label?: string | null } | null;
  action: AuditAction;
  target?: { type: string; id: string; label: string };
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async record(executor: DbExecutor, entry: AuditEntry): Promise<void> {
    const meta = currentRequestMeta();
    await executor.insert(auditLog).values({
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      actorLabel: entry.actor?.label ?? null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      targetLabel: entry.target?.label ?? null,
      source: meta.source,
      ip: meta.ip,
      userAgent: meta.userAgent,
      appVersion: meta.appVersion,
      requestId: meta.requestId,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    });
  }
}
