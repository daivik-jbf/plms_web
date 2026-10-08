import { api, apiDownload } from './client';
import type { Role } from './staff';

export type AuditTone = 'change' | 'danger' | 'warning' | 'success' | 'neutral';
export type AuditCategory = 'accounts' | 'content' | 'files' | 'playback';

export interface AuditEntry {
  id: string;
  occurredAt: string;
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
  changes: Record<string, { before: unknown; after: unknown }> | null;
  metadata: Record<string, unknown> | null;
  summary: string;
}

// `from` and `to` are plain dates ("YYYY-MM-DD") in the person's own time zone.
export interface AuditFilters {
  involving?: string;
  actorId?: string;
  category?: string;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  includePlayback?: boolean;
}

const TEXT_KEYS = ['involving', 'actorId', 'category', 'action', 'from', 'to', 'q'] as const;

export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const filters: AuditFilters = {};
  for (const key of TEXT_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  if (params.get('includePlayback') === 'true') filters.includePlayback = true;
  return filters;
}

export function filtersToParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.includePlayback) params.set('includePlayback', 'true');
  return params;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Only real calendar dates count: 2026-02-31 is ignored rather than rolled over into March. Years below 1000 are
// ignored too: Chrome's date input emits values such as 0002-03-02 while the year is still being typed.
function instant(date: string | undefined, time: string): string | undefined {
  if (!date || !DATE_ONLY.test(date)) return undefined;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (year < 1000) return undefined;
  const parsed = new Date(`${date}T${time}`);
  const sameDay = parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  return Number.isNaN(parsed.getTime()) || !sameDay ? undefined : parsed.toISOString();
}

export function auditQueryString(filters: AuditFilters, extra: { limit?: number; cursor?: string } = {}): string {
  const params = filtersToParams(filters);
  params.delete('from');
  params.delete('to');
  const from = instant(filters.from, '00:00:00');
  const to = instant(filters.to, '23:59:59.999');
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (extra.limit) params.set('limit', String(extra.limit));
  if (extra.cursor) params.set('cursor', extra.cursor);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const listAudit = (filters: AuditFilters, cursor?: string): Promise<{ items: AuditEntry[]; nextCursor: string | null }> =>
  api(`/api/audit${auditQueryString(filters, { limit: 50, cursor })}`);

export const markAuditOpened = (): Promise<void> => api<void>('/api/audit/opened', { method: 'POST' });

export const exportAudit = (filters: AuditFilters): Promise<{ blob: Blob; filename: string }> =>
  apiDownload(`/api/audit/export.csv${auditQueryString(filters)}`);
