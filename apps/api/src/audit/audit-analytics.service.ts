import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import {
  countByCategory,
  countByOperation,
  type DateRange,
  type DayCount,
  fillDays,
  type Operation,
  SECURITY_ACTIONS,
} from './audit-analytics';
import { type AuditCategory, presentAudit } from './audit-presentation';

export interface AnalyticsSummary {
  range: { from: string; to: string };
  totals: {
    events: number;
    activePeople: number;
    contentChanges: number;
    uploadsFinished: number;
    failedSignIns: number;
    securityEvents: number;
    exports: number;
  };
  daily: DayCount[];
  // Hours are UTC, 0 to 23, all present.
  hourly: { hour: number; total: number }[];
  byCategory: Record<AuditCategory, number>;
  byOperation: Record<Operation, number>;
  byAction: { action: string; label: string; count: number }[];
  topPeople: { id: string; name: string | null; label: string | null; role: string | null; count: number; lastActiveAt: string }[];
  bySource: { source: string; count: number }[];
  security: {
    byAction: { action: string; label: string; count: number }[];
    failedSignInAddresses: { ip: string; count: number }[];
  };
}

const labelOf = (action: string): string =>
  presentAudit({ action, source: '', actorLabel: null, actorName: null, targetLabel: null, targetName: null, changes: null, metadata: null })
    .label;

// Bound as text so the casts keep full precision, as the audit list does.
const bounds = (range: DateRange) =>
  sql`occurred_at >= ${range.from.toISOString()}::timestamptz and occurred_at <= ${range.to.toISOString()}::timestamptz`;

const securityList = sql.join(
  SECURITY_ACTIONS.map((action) => sql`${action}`),
  sql`, `,
);

@Injectable()
export class AuditAnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async summary(range: DateRange): Promise<AnalyticsSummary> {
    const where = bounds(range);
    const [actions, daily, hourly, people, sources, addresses, totals] = await Promise.all([
      this.db.execute<{ action: string; count: number }>(
        sql`select action, count(*)::int as count from audit_log where ${where} group by action order by count desc, action`,
      ),
      this.db.execute<{ day: string; total: number; changes: number; security: number }>(
        sql`select to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day,
                   count(*)::int as total,
                   (count(*) filter (where split_part(action, '.', 1) = 'content'))::int as changes,
                   (count(*) filter (where action in (${securityList})))::int as security
            from audit_log where ${where} group by 1 order by 1`,
      ),
      this.db.execute<{ hour: number; total: number }>(
        sql`select extract(hour from occurred_at at time zone 'UTC')::int as hour, count(*)::int as total
            from audit_log where ${where} group by 1 order by 1`,
      ),
      this.db.execute<{ id: string; name: string | null; label: string | null; role: string | null; count: number; last_active_at: string }>(
        sql`select a.actor_id::text as id, u.name as name, max(a.actor_label) as label, u.role::text as role,
                   count(*)::int as count, to_char(max(a.occurred_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_active_at
            from audit_log a left join users u on u.id = a.actor_id
            where a.actor_id is not null and ${where}
            group by a.actor_id, u.name, u.role order by count desc, last_active_at desc limit 10`,
      ),
      this.db.execute<{ source: string; count: number }>(
        sql`select source, count(*)::int as count from audit_log where ${where} group by source order by count desc, source`,
      ),
      this.db.execute<{ ip: string; count: number }>(
        sql`select ip, count(*)::int as count from audit_log
            where action = 'auth.login.failed' and ip is not null and ${where}
            group by ip order by count desc, ip limit 5`,
      ),
      this.db.execute<{ events: number; active_people: number }>(
        sql`select count(*)::int as events, count(distinct actor_id)::int as active_people from audit_log where ${where}`,
      ),
    ]);

    const counts = actions.rows;
    const count = (action: string): number => counts.find((row) => row.action === action)?.count ?? 0;
    const byOperation = countByOperation(counts);
    const securityByAction = SECURITY_ACTIONS.map((action) => ({ action, label: labelOf(action), count: count(action) })).filter(
      (row) => row.count > 0,
    );

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totals: {
        events: totals.rows[0]?.events ?? 0,
        activePeople: totals.rows[0]?.active_people ?? 0,
        contentChanges: Object.values(byOperation).reduce((sum, value) => sum + value, 0),
        uploadsFinished: count('file.upload_completed'),
        failedSignIns: count('auth.login.failed'),
        securityEvents: securityByAction.reduce((sum, row) => sum + row.count, 0),
        exports: count('audit.exported'),
      },
      daily: fillDays(range, daily.rows),
      hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, total: hourly.rows.find((row) => row.hour === hour)?.total ?? 0 })),
      byCategory: countByCategory(counts),
      byOperation,
      byAction: counts.slice(0, 15).map((row) => ({ action: row.action, label: labelOf(row.action), count: row.count })),
      topPeople: people.rows.map((row) => ({
        id: row.id,
        name: row.name,
        label: row.label,
        role: row.role,
        count: row.count,
        lastActiveAt: row.last_active_at,
      })),
      bySource: sources.rows,
      security: { byAction: securityByAction, failedSignInAddresses: addresses.rows },
    };
  }
}
