import { categoryOf, type AuditCategory } from './audit-presentation';

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

// What a content change did, in the words an Admin uses: add, edit, move, delete and so on.
export const OPERATIONS = ['created', 'edited', 'moved', 'deleted', 'restored', 'purged'] as const;
export type Operation = (typeof OPERATIONS)[number];

const OPERATION_BY_VERB: Record<string, Operation> = {
  added: 'created',
  created: 'created',
  edited: 'edited',
  renamed: 'edited',
  cover_set: 'edited',
  reordered: 'moved',
  deleted: 'deleted',
  restored: 'restored',
  purged: 'purged',
};

// Only `content.*` actions are changes to content; everything else (sign-ins, uploads, playback) has no operation.
export function operationOf(action: string): Operation | null {
  const [prefix, , verb] = action.split('.');
  if (prefix !== 'content' || !verb) return null;
  return Object.hasOwn(OPERATION_BY_VERB, verb) ? OPERATION_BY_VERB[verb]! : null;
}

// Actions an Admin should look at: possible account takeover, privilege changes and permanent loss of data.
export const SECURITY_ACTIONS = [
  'auth.login.failed',
  'auth.refresh.reuse_detected',
  'user.role_changed',
  'user.deactivated',
] as const;

export interface DateRange {
  from: Date;
  to: Date;
}

export function resolveRange(input: { from?: string; to?: string }, now: Date = new Date()): DateRange {
  const to = input.to ? new Date(input.to) : now;
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  return { from, to };
}

export function rangeError(range: DateRange): string | null {
  if (range.from.getTime() > range.to.getTime()) return 'The start must not be after the end.';
  if ((range.to.getTime() - range.from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    return `The period can be at most ${MAX_RANGE_DAYS} days.`;
  }
  return null;
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

export interface DayCount {
  day: string;
  total: number;
  changes: number;
  security: number;
}

// Days with no activity are returned as zeros, so a chart never silently skips a quiet day.
export function fillDays(range: DateRange, rows: DayCount[]): DayCount[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const days: DayCount[] = [];
  const last = Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate());
  for (
    let t = Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate());
    t <= last;
    t += DAY_MS
  ) {
    const day = utcDay(new Date(t));
    days.push(byDay.get(day) ?? { day, total: 0, changes: 0, security: 0 });
  }
  return days;
}

export function countByOperation(rows: { action: string; count: number }[]): Record<Operation, number> {
  const result = Object.fromEntries(OPERATIONS.map((operation) => [operation, 0])) as Record<Operation, number>;
  for (const row of rows) {
    const operation = operationOf(row.action);
    if (operation) result[operation] += row.count;
  }
  return result;
}

export function countByCategory(rows: { action: string; count: number }[]): Record<AuditCategory, number> {
  const result: Record<AuditCategory, number> = { accounts: 0, content: 0, files: 0, playback: 0 };
  for (const row of rows) result[categoryOf(row.action)] += row.count;
  return result;
}
