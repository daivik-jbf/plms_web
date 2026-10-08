import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, ilike, like, lte, not, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../db/db.module';
import { type AuditChanges, auditLog, type Role, users } from '../db/schema';
import { isInvalidInputValue } from '../db/errors';
import { type AuditCursor, decodeCursor, encodeCursor, invalidCursor } from './audit-cursor';
import {
  type AuditCategory,
  type AuditTone,
  CATEGORY_PREFIXES,
  presentAudit,
} from './audit-presentation';
import type { AuditFilters, AuditQuery } from './audit.schemas';

export interface AuditEntryView {
  id: string;
  occurredAt: Date;
  actor: { id: string | null; role: Role | null; label: string | null; name: string | null } | null;
  action: string;
  label: string;
  tone: AuditTone;
  category: AuditCategory;
  target: { type: string; id: string; label: string | null; name: string | null } | null;
  source: string;
  ip: string | null;
  userAgent: string | null;
  appVersion: string | null;
  requestId: string | null;
  changes: AuditChanges | null;
  metadata: Record<string, unknown> | null;
  summary: string;
}

const actorUser = alias(users, 'actor_user');
const targetUser = alias(users, 'target_user');

type Row = {
  entry: typeof auditLog.$inferSelect;
  actorName: string | null;
  targetName: string | null;
  occurredAtText: string;
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

const hasPrefix = (prefixes: readonly string[]): SQL =>
  or(...prefixes.map((prefix) => like(auditLog.action, `${prefix}.%`)))!;

function categoryCondition(category: AuditCategory): SQL {
  if (category === 'accounts') {
    return not(hasPrefix([...CATEGORY_PREFIXES.content, ...CATEGORY_PREFIXES.files, ...CATEGORY_PREFIXES.playback]));
  }
  return hasPrefix(CATEGORY_PREFIXES[category]);
}

function toView(row: Row): AuditEntryView {
  const { entry } = row;
  const presentation = presentAudit({
    action: entry.action,
    source: entry.source,
    actorLabel: entry.actorLabel,
    actorName: row.actorName,
    targetLabel: entry.targetLabel,
    targetName: row.targetName,
    changes: entry.changes,
    metadata: entry.metadata,
  });
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor:
      entry.actorId || entry.actorLabel || entry.actorRole
        ? { id: entry.actorId, role: entry.actorRole, label: entry.actorLabel, name: row.actorName }
        : null,
    action: entry.action,
    label: presentation.label,
    tone: presentation.tone,
    category: presentation.category,
    target:
      entry.targetType && entry.targetId
        ? { type: entry.targetType, id: entry.targetId, label: entry.targetLabel, name: row.targetName }
        : null,
    source: entry.source,
    ip: entry.ip,
    userAgent: entry.userAgent,
    appVersion: entry.appVersion,
    requestId: entry.requestId,
    changes: entry.changes,
    metadata: entry.metadata,
    summary: presentation.summary,
  };
}

@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.fetch(query, query.limit + 1, cursor);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toView),
      nextCursor: hasMore && last ? encodeCursor({ t: last.occurredAtText, id: last.entry.id }) : null,
    };
  }

  async count(filters: AuditFilters): Promise<number> {
    const [result] = await this.db
      .select({ total: count() })
      .from(auditLog)
      .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .leftJoin(targetUser, and(eq(auditLog.targetType, 'user'), sql`${targetUser.id}::text = ${auditLog.targetId}`))
      .where(and(...this.conditions(filters)));
    return result?.total ?? 0;
  }

  async *pages(filters: AuditFilters, size: number): AsyncGenerator<AuditEntryView[]> {
    let cursor: AuditCursor | undefined;
    for (;;) {
      const rows = await this.fetch(filters, size, cursor);
      if (rows.length === 0) return;
      yield rows.map(toView);
      const last = rows[rows.length - 1]!;
      if (rows.length < size) return;
      cursor = { t: last.occurredAtText, id: last.entry.id };
    }
  }

  private async fetch(filters: AuditFilters, limit: number, cursor?: AuditCursor): Promise<Row[]> {
    try {
      return await this.query(filters, limit, cursor);
    } catch (error) {
      // Belt and braces: the cursor is validated on decode, but never let Postgres reject it as a 500.
      if (cursor && isInvalidInputValue(error)) throw invalidCursor();
      throw error;
    }
  }

  private query(filters: AuditFilters, limit: number, cursor?: AuditCursor): Promise<Row[]> {
    return this.db
      .select({
        entry: auditLog,
        actorName: actorUser.name,
        targetName: targetUser.name,
        occurredAtText: sql<string>`${auditLog.occurredAt}::text`,
      })
      .from(auditLog)
      .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .leftJoin(targetUser, and(eq(auditLog.targetType, 'user'), sql`${targetUser.id}::text = ${auditLog.targetId}`))
      .where(
        and(
          ...this.conditions(filters),
          cursor ? sql`(${auditLog.occurredAt}, ${auditLog.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      // Must match audit_log_paging_idx (desc nulls last) for Postgres to use it.
      .orderBy(sql`${auditLog.occurredAt} desc nulls last`, sql`${auditLog.id} desc nulls last`)
      .limit(limit);
  }

  private conditions(filters: AuditFilters): (SQL | undefined)[] {
    const pattern = filters.q ? `%${escapeLike(filters.q)}%` : undefined;
    const showPlayback = filters.includePlayback || filters.category === 'playback';
    return [
      filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
      filters.involving
        ? or(
            eq(auditLog.actorId, filters.involving),
            and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, filters.involving)),
          )
        : undefined,
      filters.category ? categoryCondition(filters.category) : undefined,
      showPlayback ? undefined : not(categoryCondition('playback')),
      filters.action ? eq(auditLog.action, filters.action) : undefined,
      filters.from ? gte(auditLog.occurredAt, new Date(filters.from)) : undefined,
      filters.to ? lte(auditLog.occurredAt, new Date(filters.to)) : undefined,
      pattern
        ? or(
            ilike(auditLog.actorLabel, pattern),
            ilike(auditLog.targetLabel, pattern),
            ilike(auditLog.action, pattern),
            ilike(actorUser.name, pattern),
            ilike(targetUser.name, pattern),
          )
        : undefined,
    ];
  }
}
