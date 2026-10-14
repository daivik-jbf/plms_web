import { countByCategory, countByOperation, fillDays, operationOf, rangeError, resolveRange } from './audit-analytics';
import { buildSummaryCsv } from './audit-report';
import type { AnalyticsSummary } from './audit-analytics.service';

describe('operationOf', () => {
  it.each([
    ['content.course.created', 'created'],
    ['content.topic.added', 'created'],
    ['content.lesson.renamed', 'edited'],
    ['content.video.cover_set', 'edited'],
    ['content.folder.reordered', 'moved'],
    ['content.attachment.deleted', 'deleted'],
    ['content.course.restored', 'restored'],
    ['content.lesson.purged', 'purged'],
  ])('%s is %s', (action, operation) => {
    expect(operationOf(action)).toBe(operation);
  });

  it('has no operation for non-content actions or unknown verbs', () => {
    expect(operationOf('auth.login.failed')).toBeNull();
    expect(operationOf('file.upload_completed')).toBeNull();
    expect(operationOf('content.course.toString')).toBeNull();
    expect(operationOf('content')).toBeNull();
  });
});

describe('resolveRange and rangeError', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('defaults to the last 30 days', () => {
    const range = resolveRange({}, now);
    expect(range.to).toEqual(now);
    expect(range.from).toEqual(new Date('2026-09-13T12:00:00Z'));
    expect(rangeError(range)).toBeNull();
  });

  it('rejects a start after the end and a period over 366 days', () => {
    expect(rangeError(resolveRange({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }))).toMatch(/start/);
    expect(rangeError(resolveRange({ from: '2025-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }))).toMatch(/366/);
    expect(rangeError(resolveRange({ from: '2025-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }))).toBeNull();
  });
});

describe('fillDays', () => {
  it('returns every UTC day in the range, with zeros for quiet days', () => {
    const range = { from: new Date('2026-03-01T23:00:00Z'), to: new Date('2026-03-04T01:00:00Z') };
    const days = fillDays(range, [{ day: '2026-03-02', total: 5, changes: 2, security: 1 }]);
    expect(days.map((day) => day.day)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
    expect(days.map((day) => day.total)).toEqual([0, 5, 0, 0]);
  });
});

describe('counting', () => {
  const rows = [
    { action: 'content.course.created', count: 2 },
    { action: 'content.lesson.added', count: 3 },
    { action: 'content.lesson.reordered', count: 4 },
    { action: 'auth.login.failed', count: 7 },
    { action: 'playback.played', count: 11 },
    { action: 'file.upload_completed', count: 1 },
  ];

  it('groups content changes by operation', () => {
    expect(countByOperation(rows)).toEqual({ created: 5, edited: 0, moved: 4, deleted: 0, restored: 0, purged: 0 });
  });

  it('groups events by category', () => {
    expect(countByCategory(rows)).toEqual({ accounts: 7, content: 9, files: 1, playback: 11 });
  });
});

describe('buildSummaryCsv', () => {
  const summary: AnalyticsSummary = {
    range: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z' },
    totals: { events: 3, activePeople: 1, contentChanges: 1, uploadsFinished: 0, failedSignIns: 1, securityEvents: 1, exports: 0 },
    daily: [{ day: '2026-03-01', total: 3, changes: 1, security: 1 }],
    hourly: [],
    byCategory: { accounts: 2, content: 1, files: 0, playback: 0 },
    byOperation: { created: 1, edited: 0, moved: 0, deleted: 0, restored: 0, purged: 0 },
    byAction: [{ action: 'auth.login.failed', label: 'Sign-in failed', count: 1 }],
    topPeople: [{ id: 'x', name: '=HYPERLINK("evil")', label: 'a@b.org', role: 'admin', count: 3, lastActiveAt: '2026-03-01T10:00:00Z' }],
    bySource: [],
    security: { byAction: [], failedSignInAddresses: [] },
  };

  it('is sectioned, starts with a BOM and neutralizes formulas', () => {
    const csv = buildSummaryCsv(summary, new Date('2026-03-02T00:00:00Z'));
    expect(csv.startsWith('﻿Audit activity report')).toBe(true);
    expect(csv).toContain('Content changes by kind');
    expect(csv).toContain('Created,1');
    expect(csv).toContain('2026-03-01,3,1,1');
    expect(csv).not.toMatch(/^=HYPERLINK/m);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
  });
});
