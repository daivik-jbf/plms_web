import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../../api/audit';
import type { Person } from '../../api/staff';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, LocationProbe, mockSession, renderWithSession } from '../../test/session';
import { AuditPage } from './AuditPage';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('../../lib/download', () => ({ saveBlob }));

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'e1',
  occurredAt: '2026-10-08T10:42:07.000Z',
  actor: { id: 'admin-1', role: 'admin', label: 'anita@jbf.org', name: 'Anita Rao' },
  action: 'user.role_changed',
  label: 'Role changed',
  tone: 'change',
  category: 'accounts',
  target: { type: 'user', id: 'staff-1', label: 'ben@jbf.org', name: 'Ben Okoye' },
  source: 'portal',
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  appVersion: null,
  requestId: 'req-7f3c',
  changes: { role: { before: 'staff', after: 'admin' } },
  metadata: null,
  summary: "Anita Rao changed Ben Okoye's role from Staff to Admin",
  ...overrides,
});

const signIn = entry({
  id: 'e2',
  occurredAt: '2026-10-08T10:31:00.000Z',
  actor: { id: 'staff-1', role: 'staff', label: 'ben@jbf.org', name: 'Ben Okoye' },
  action: 'auth.login.succeeded',
  label: 'Signed in',
  tone: 'success',
  target: null,
  source: 'mobile',
  appVersion: '2.0.1',
  changes: null,
  summary: 'Ben Okoye signed in from the app',
});

const failed = entry({
  id: 'e3',
  occurredAt: '2026-10-08T10:12:00.000Z',
  actor: { id: null, role: null, label: 'dev@jbf.org', name: null },
  action: 'auth.login.failed',
  label: 'Sign-in failed',
  tone: 'warning',
  target: null,
  changes: null,
  metadata: { reason: 'wrong_password', locked: false },
  summary: 'Failed sign-in for dev@jbf.org (wrong password)',
});

const people: Person[] = [
  { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff', status: 'active', createdAt: '2026-01-02T00:00:00Z' },
];

type Page = { items: AuditEntry[]; nextCursor: string | null };

function startServer(
  pages: Record<string, Page> | ((url: URL) => MockResponse | Promise<MockResponse>) = {},
  exportResponse: MockResponse = {
    text: 'Time (UTC)\r\n',
    headers: { 'Content-Disposition': 'attachment; filename="audit-log-2026-10-08.csv"' },
  },
) {
  const calls: { method: string; url: URL }[] = [];
  mockSession(ADMIN, (rawUrl, init) => {
    const url = new URL(rawUrl, 'http://localhost');
    const method = init.method ?? 'GET';
    calls.push({ method, url });
    if (method === 'GET' && url.pathname === '/api/users') return { body: people };
    if (method === 'POST' && url.pathname === '/api/audit/opened') return { status: 204 };
    if (method === 'GET' && url.pathname === '/api/audit') {
      if (typeof pages === 'function') return pages(url);
      return { body: pages[url.searchParams.get('cursor') ?? ''] ?? { items: [], nextCursor: null } };
    }
    if (method === 'GET' && url.pathname === '/api/audit/export.csv') return exportResponse;
    return { status: 404, body: {} };
  });
  const auditCalls = () => calls.filter((c) => c.method === 'GET' && c.url.pathname === '/api/audit');
  return { calls, auditCalls, opened: () => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/api/audit/opened').length };
}

function renderAudit(route = '/audit') {
  return renderWithSession(
    <>
      <Routes>
        <Route path="/audit" element={<AuditPage />} />
      </Routes>
      <LocationProbe />
    </>,
    route,
  );
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    saveBlob.mockReset();
  });

  describe('list', () => {
    it('shows each entry with its time, person, badge, plain-English summary and source', async () => {
      startServer({ '': { items: [entry(), signIn, failed], nextCursor: null } });
      renderAudit();
      const table = await screen.findByRole('table', { name: 'Audit log' });
      const first = within(table).getByRole('row', { name: /Role changed/ });
      expect(within(first).getByText('Anita Rao')).toBeInTheDocument();
      expect(within(first).getByText('Role changed')).toBeInTheDocument();
      expect(within(first).getByText("Anita Rao changed Ben Okoye's role from Staff to Admin")).toBeInTheDocument();
      expect(within(first).getByText('Portal')).toBeInTheDocument();
      expect(within(table).getByText('App')).toBeInTheDocument();
      expect(within(table).getByText('dev@jbf.org')).toBeInTheDocument();
      expect(within(table).getByText('Sign-in failed')).toBeInTheDocument();
    });

    it('asks for "Changes only" by default (no includePlayback) and lets the Admin include plays and downloads', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      const toggle = await screen.findByRole('checkbox', { name: 'Changes only' });
      expect(toggle).toBeChecked();
      expect(server.auditCalls()[0]!.url.searchParams.get('includePlayback')).toBeNull();
      await userEvent.click(toggle);
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('includePlayback')).toBe('true'));
      expect(screen.getByRole('checkbox', { name: 'Changes only' })).not.toBeChecked();
      expect(screen.getByTestId('location')).toHaveTextContent('/audit?includePlayback=true');
    });

    it('records one "opened" marker per visit, not per filter change', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      await userEvent.selectOptions(screen.getByLabelText('Category'), 'accounts');
      await waitFor(() => expect(server.auditCalls().length).toBeGreaterThan(1));
      expect(server.opened()).toBe(1);
    });

    it('loads more with the cursor, appends, and hides the button on the last page', async () => {
      const older = entry({ id: 'e9', summary: 'An older thing happened', label: 'Reactivated', tone: 'success' });
      const server = startServer({
        '': { items: [entry()], nextCursor: 'CURSOR-1' },
        'CURSOR-1': { items: [older], nextCursor: null },
      });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
      expect(await screen.findByText('An older thing happened')).toBeInTheDocument();
      expect(screen.getByText("Anita Rao changed Ben Okoye's role from Staff to Admin")).toBeInTheDocument();
      expect(server.auditCalls().at(-1)!.url.searchParams.get('cursor')).toBe('CURSOR-1');
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('shows an empty state with Clear filters when nothing matches', async () => {
      startServer({});
      renderAudit('/audit?q=zzz');
      expect(await screen.findByText('No activity matches these filters')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/audit$/));
    });

    it('shows a loading skeleton, then an error with Retry', async () => {
      let attempts = 0;
      startServer(() => (attempts++ === 0 ? { status: 500, body: {} } : { body: { items: [entry()], nextCursor: null } }));
      renderAudit();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('table', { name: 'Audit log' })).toBeInTheDocument();
    });

    it('explains a rejected filter from a hand-edited address and offers to clear it', async () => {
      startServer(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { involving: ['Invalid UUID'] } } }));
      renderAudit('/audit?involving=not-a-uuid');
      expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    it('renders hostile labels as inert text, never as markup', async () => {
      const hostile = entry({
        id: 'x1',
        actor: { id: null, role: null, label: '<img src=x onerror=alert(1)>', name: null },
        summary: 'Failed sign-in for <img src=x onerror=alert(1)> (wrong password)',
        label: 'Sign-in failed',
        tone: 'warning',
      });
      startServer({ '': { items: [hostile], nextCursor: null } });
      const { container } = renderAudit();
      expect(await screen.findByText('Failed sign-in for <img src=x onerror=alert(1)> (wrong password)')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('filters', () => {
    it('filters by person, category and date range and reflects them in the address', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      await userEvent.selectOptions(screen.getByLabelText('Person'), 'staff-1');
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('actorId')).toBe('staff-1'));
      await userEvent.selectOptions(screen.getByLabelText('Category'), 'content');
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('category')).toBe('content'));
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-02' } });
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('from')).not.toBeNull());
      expect(screen.getByTestId('location')).toHaveTextContent('actorId=staff-1');
      expect(screen.getByTestId('location')).toHaveTextContent('category=content');
      expect(screen.getByTestId('location')).toHaveTextContent('from=2026-03-02');
    });

    it('searches only when submitted, not on every keystroke', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      const before = server.auditCalls().length;
      await userEvent.type(screen.getByLabelText('Search'), 'ben');
      expect(server.auditCalls().length).toBe(before);
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('q')).toBe('ben'));
    });

    it('shows a removable chip for activity of one person when arriving from the Staff page', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit('/audit?involving=staff-1');
      expect(await screen.findByText('Activity of Ben Okoye')).toBeInTheDocument();
      expect(server.auditCalls()[0]!.url.searchParams.get('involving')).toBe('staff-1');
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Activity of Ben Okoye' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/audit$/));
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('involving')).toBeNull());
    });
  });

  describe('details drawer', () => {
    it('opens from a row with the full record and a before/after comparison, and closes again', async () => {
      startServer({ '': { items: [entry(), signIn], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: "Anita Rao changed Ben Okoye's role from Staff to Admin" }));
      const drawer = screen.getByRole('dialog', { name: 'Role changed' });
      expect(within(drawer).getByText('2026-10-08 10:42:07 UTC')).toBeInTheDocument();
      expect(within(drawer).getByText('Anita Rao (Admin)')).toBeInTheDocument();
      expect(within(drawer).getByText('User: Ben Okoye')).toBeInTheDocument();
      expect(within(drawer).getByText('Portal · 203.0.113.9')).toBeInTheDocument();
      expect(within(drawer).getByText('req-7f3c')).toBeInTheDocument();
      const diff = within(drawer).getByRole('table', { name: 'Changes' });
      expect(within(diff).getByText('role')).toBeInTheDocument();
      expect(within(diff).getByText('staff')).toBeInTheDocument();
      expect(within(diff).getByText('admin')).toBeInTheDocument();
      await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Role changed' })).not.toBeInTheDocument();
    });

    it('opens from the keyboard (focus the summary, press Enter)', async () => {
      startServer({ '': { items: [signIn], nextCursor: null } });
      renderAudit();
      const summary = await screen.findByRole('button', { name: 'Ben Okoye signed in from the app' });
      summary.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('dialog', { name: 'Signed in' })).toBeInTheDocument();
    });

    it('shows app version for mobile entries, and a typed label for failed sign-ins with no person', async () => {
      startServer({ '': { items: [signIn, failed], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Failed sign-in for dev@jbf.org (wrong password)' }));
      const drawer = screen.getByRole('dialog', { name: 'Sign-in failed' });
      expect(within(drawer).getByText('dev@jbf.org')).toBeInTheDocument();
      expect(within(drawer).queryByRole('table', { name: 'Changes' })).not.toBeInTheDocument();
      expect(within(drawer).getByText(/wrong_password/)).toBeInTheDocument();
    });

    it('links to everything involving that person', async () => {
      startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: "Anita Rao changed Ben Okoye's role from Staff to Admin" }));
      const link = within(screen.getByRole('dialog', { name: 'Role changed' })).getByRole('link', { name: "View all of Anita Rao's activity" });
      expect(link).toHaveAttribute('href', '/audit?involving=admin-1');
      await userEvent.click(link);
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/audit?involving=admin-1'));
      expect(screen.queryByRole('dialog', { name: 'Role changed' })).not.toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('downloads the CSV for the current filters', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit('/audit?category=accounts');
      await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
      await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
      expect(saveBlob.mock.calls[0]![1]).toBe('audit-log-2026-10-08.csv');
      const exportCall = server.calls.find((c) => c.url.pathname === '/api/audit/export.csv')!;
      expect(exportCall.url.searchParams.get('category')).toBe('accounts');
      expect(exportCall.url.searchParams.get('limit')).toBeNull();
    });

    it('shows the server\'s message when there are too many rows and lets the Admin try again', async () => {
      startServer(
        { '': { items: [entry()], nextCursor: null } },
        { status: 413, body: { message: 'Too many rows to export (limit 50000). Narrow the filters.' } },
      );
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Too many rows to export (limit 50000). Narrow the filters.');
      expect(saveBlob).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    });
  });
});
