import type { AnalyticsSummary } from './audit-analytics.service';
import { csvRow } from './csv';

// Lets Excel detect UTF-8.
const BOM = '﻿';

const TITLE_CASE = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

// A plain, sectioned CSV that opens in Excel or Sheets: each block has a heading row, a column row and its data.
export function buildSummaryCsv(summary: AnalyticsSummary, generatedAt: Date): string {
  const { totals } = summary;
  const rows: unknown[][] = [
    ['Audit activity report'],
    ['Period start (UTC)', summary.range.from],
    ['Period end (UTC)', summary.range.to],
    ['Generated (UTC)', generatedAt.toISOString()],
    [],
    ['Overview'],
    ['Measure', 'Value'],
    ['All recorded events', totals.events],
    ['People who were active', totals.activePeople],
    ['Content changes', totals.contentChanges],
    ['Uploads finished', totals.uploadsFinished],
    ['Failed sign-ins', totals.failedSignIns],
    ['Security events', totals.securityEvents],
    ['Audit log exports', totals.exports],
    [],
    ['Content changes by kind'],
    ['Kind', 'Count'],
    ...Object.entries(summary.byOperation).map(([operation, count]) => [TITLE_CASE(operation), count]),
    [],
    ['Events by category'],
    ['Category', 'Count'],
    ...Object.entries(summary.byCategory).map(([category, count]) => [TITLE_CASE(category), count]),
    [],
    ['Most common actions'],
    ['Action', 'Name', 'Count'],
    ...summary.byAction.map((row) => [row.action, row.label, row.count]),
    [],
    ['Most active people'],
    ['Name', 'Email', 'Role', 'Events', 'Last active (UTC)'],
    ...summary.topPeople.map((row) => [row.name, row.label, row.role, row.count, row.lastActiveAt]),
    [],
    ['Security events'],
    ['Action', 'Name', 'Count'],
    ...summary.security.byAction.map((row) => [row.action, row.label, row.count]),
    [],
    ['Addresses with the most failed sign-ins'],
    ['IP address', 'Failed sign-ins'],
    ...summary.security.failedSignInAddresses.map((row) => [row.ip, row.count]),
    [],
    ['Events by day (UTC)'],
    ['Day', 'All events', 'Content changes', 'Security events'],
    ...summary.daily.map((row) => [row.day, row.total, row.changes, row.security]),
  ];
  return BOM + rows.map(csvRow).join('');
}
