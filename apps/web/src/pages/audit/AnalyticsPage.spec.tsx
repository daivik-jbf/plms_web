import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditAnalytics } from '../../api/audit';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, mockSession, renderWithSession } from '../../test/session';
import { AnalyticsPage } from './AnalyticsPage';
import { niceMax } from './charts';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('../../lib/download', () => ({ saveBlob }));

const noEvents = { events: 0, activePeople: 0, contentChanges: 0, uploadsFinished: 0, failedSignIns: 0, securityEvents: 0, exports: 0 };

const analytics = (overrides: Partial<AuditAnalytics> = {}): AuditAnalytics => ({
  range: { from: '2026-09-13T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' },
  totals: { events: 178, activePeople: 3, contentChanges: 143, uploadsFinished: 7, failedSignIns: 0, securityEvents: 0, exports: 1 },
  daily: [
    { day: '2026-10-11', total: 4, changes: 2, security: 0 },
    { day: '2026-10-12', total: 0, changes: 0, security: 0 },
    { day: '2026-10-13', total: 9, changes: 5, security: 0 },
  ],
  hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, total: hour === 9 ? 5 : 0 })),
  byCategory: { accounts: 7, content: 143, files: 14, playback: 14 },
  byOperation: { created: 42, edited: 54, moved: 39, deleted: 8, restored: 0, purged: 0 },
  byAction: [{ action: 'content.video.edited', label: 'Item edited', count: 54 }],
  topPeople: [{ id: 'u1', name: 'Anita Rao', label: 'anita@jbf.org', role: 'admin', count: 120, lastActiveAt: '2026-10-13T06:40:00Z' }],
  bySource: [{ source: 'portal', count: 178 }],
  security: { byAction: [], failedSignInAddresses: [] },
  ...overrides,
});

function startServer(respond: (url: URL) => MockResponse = () => ({ body: analytics() })) {
  const calls: URL[] = [];
  let opened = 0;
  mockSession(ADMIN, (rawUrl, init) => {
    const url = new URL(rawUrl, 'http://localhost');
    if (init.method === 'POST' && url.pathname === '/api/audit/opened') {
      opened += 1;
      return { status: 204 };
    }
    if (url.pathname === '/api/audit/analytics') {
      calls.push(url);
      return respond(url);
    }
    if (url.pathname === '/api/audit/report.csv') {
      calls.push(url);
      return { text: 'Audit activity report\r\n', headers: { 'Content-Disposition': 'attachment; filename="audit-report-2026-10-13.csv"' } };
    }
    return { status: 404, body: {} };
  });
  return { calls, opened: () => opened };
}

const renderPage = (route = '/audit/analytics') =>
  renderWithSession(
    <Routes>
      <Route path="/audit/analytics" element={<AnalyticsPage />} />
    </Routes>,
    route,
  );

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    saveBlob.mockReset();
  });

  it('shows the totals, the change kinds and a chart with a table view', async () => {
    const server = startServer();
    renderPage();
    const totals = await screen.findByRole('list', { name: 'Totals for the period' });
    expect(within(totals).getByText('178')).toBeInTheDocument();
    expect(within(totals).getByText('Content changes')).toBeInTheDocument();
    const ops = screen.getByRole('region', { name: 'What changed' });
    expect(within(ops).getByText('Moved or reordered')).toBeInTheDocument();
    expect(within(ops).getByText('39')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Events per day/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anita Rao' })).toHaveAttribute('href', '/audit?actorId=u1');
    expect(server.opened()).toBe(1);
  });

  it('says so, in words, when there are no security events', async () => {
    startServer();
    renderPage();
    expect(await screen.findByText('No security events in this period.')).toBeInTheDocument();
  });

  it('lists the security events and the addresses behind failed sign-ins', async () => {
    startServer(() => ({
      body: analytics({
        totals: { ...noEvents, events: 10, activePeople: 1, failedSignIns: 6, securityEvents: 6 },
        security: {
          byAction: [{ action: 'auth.login.failed', label: 'Sign-in failed', count: 6 }],
          failedSignInAddresses: [{ ip: '203.0.113.9', count: 6 }],
        },
      }),
    }));
    renderPage();
    const security = await screen.findByRole('region', { name: 'Security' });
    expect(within(security).getByText('Sign-in failed')).toBeInTheDocument();
    expect(within(security).getByText('203.0.113.9')).toBeInTheDocument();
  });

  it('asks for the chosen period and reloads when it changes', async () => {
    const server = startServer();
    renderPage('/audit/analytics?days=7');
    await screen.findByRole('list', { name: 'Totals for the period' });
    const spanOf = (url: URL) => new Date(url.searchParams.get('to')!).getTime() - new Date(url.searchParams.get('from')!).getTime();
    expect(spanOf(server.calls[0]!)).toBe(7 * 86_400_000);
    await userEvent.selectOptions(screen.getByLabelText('Period'), '90');
    await waitFor(() => expect(server.calls).toHaveLength(2));
    expect(spanOf(server.calls[1]!)).toBe(90 * 86_400_000);
  });

  it('shows an empty state when nothing happened in the period', async () => {
    startServer(() => ({ body: analytics({ totals: noEvents }) }));
    renderPage();
    expect(await screen.findByText('No activity in this period')).toBeInTheDocument();
  });

  it('shows the server error and retries', async () => {
    let fail = true;
    const server = startServer(() => (fail ? { status: 500, body: { message: 'Something went wrong.' } } : { body: analytics() }));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('list', { name: 'Totals for the period' });
    expect(server.calls).toHaveLength(2);
  });

  it('downloads the CSV report for the chosen period', async () => {
    const server = startServer();
    renderPage();
    await screen.findByRole('list', { name: 'Totals for the period' });
    await userEvent.click(screen.getByRole('button', { name: 'Download report (CSV)' }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(saveBlob.mock.calls[0]![1]).toBe('audit-report-2026-10-13.csv');
    expect(server.calls.some((url) => url.pathname === '/api/audit/report.csv')).toBe(true);
  });
});

describe('niceMax', () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 5],
    [9, 10],
    [11, 20],
    [143, 200],
    [501, 1000],
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceMax(value)).toBe(expected);
  });
});
