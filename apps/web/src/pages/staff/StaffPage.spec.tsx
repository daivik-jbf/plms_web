import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, Person, Role } from '../../api/staff';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, LocationProbe, mockSession, renderWithSession } from '../../test/session';
import { StaffPage } from './StaffPage';

const day = 86_400_000;
const peopleFixture: Person[] = [
  { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff', status: 'active', createdAt: '2026-01-02T00:00:00Z' },
  { id: 'staff-2', email: 'eli@jbf.org', name: 'Eli Brooks', role: 'staff', status: 'deactivated', createdAt: '2026-01-03T00:00:00Z' },
];
const invitesFixture: Invite[] = [
  { id: 'inv-1', email: 'carla@jbf.org', name: 'Carla Mendes', role: 'staff', status: 'pending', expiresAt: new Date(Date.now() + 5 * day).toISOString(), createdAt: '2026-01-04T00:00:00Z', invitedBy: 'admin-1' },
  { id: 'inv-2', email: 'dev@jbf.org', name: 'Dev Patel', role: 'staff', status: 'expired', expiresAt: new Date(Date.now() - day).toISOString(), createdAt: '2026-01-05T00:00:00Z', invitedBy: 'admin-1' },
  { id: 'inv-3', email: 'old@jbf.org', name: 'Old Timer', role: 'staff', status: 'accepted', expiresAt: '2026-01-06T00:00:00Z', createdAt: '2026-01-06T00:00:00Z', invitedBy: 'admin-1' },
];

interface RequestBody {
  role?: Role;
  name?: string;
  email?: string;
}

type Override = MockResponse | ((body: RequestBody) => MockResponse | Promise<MockResponse>);

function startServer(overrides: Record<string, Override> = {}, people: Person[] = peopleFixture) {
  const state = { people: structuredClone(people), invites: structuredClone(invitesFixture) };
  const calls: { method: string; url: string; body: RequestBody }[] = [];
  mockSession(ADMIN, (url, init) => {
    const method = init.method ?? 'GET';
    const body: RequestBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const key = `${method} ${url}`;
    calls.push({ method, url, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/users') return { body: state.people };
    if (key === 'GET /api/invites') return { body: state.invites };
    const person = (id: string | undefined) => state.people.find((p) => p.id === id)!;
    let match = /^PATCH \/api\/users\/([^/]+)\/role$/.exec(key);
    if (match) {
      person(match[1]).role = body.role ?? 'staff';
      return { body: person(match[1]) };
    }
    match = /^POST \/api\/users\/([^/]+)\/deactivate$/.exec(key);
    if (match) {
      person(match[1]).status = 'deactivated';
      return { body: person(match[1]) };
    }
    match = /^POST \/api\/users\/([^/]+)\/reactivate$/.exec(key);
    if (match) {
      person(match[1]).status = 'active';
      return { body: person(match[1]) };
    }
    if (key === 'POST /api/invites') {
      const invite: Invite = { id: 'inv-new', email: body.email ?? '', name: body.name ?? '', role: body.role ?? 'staff', status: 'pending', expiresAt: new Date(Date.now() + 7 * day).toISOString(), createdAt: new Date().toISOString(), invitedBy: 'admin-1' };
      state.invites.push(invite);
      return { status: 201, body: invite };
    }
    match = /^POST \/api\/invites\/([^/]+)\/resend$/.exec(key);
    if (match) return { body: state.invites.find((i) => i.id === match![1]) };
    match = /^DELETE \/api\/invites\/([^/]+)$/.exec(key);
    if (match) {
      state.invites = state.invites.filter((i) => i.id !== match![1]);
      return { status: 204 };
    }
    return { status: 404, body: {} };
  });
  return { state, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key).length };
}

function renderStaff() {
  return renderWithSession(
    <Routes>
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/audit" element={<LocationProbe />} />
    </Routes>,
    '/staff',
  );
}

const openInvitesTab = () => userEvent.click(screen.getByRole('tab', { name: /^Invites/ }));

describe('StaffPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  describe('People tab', () => {
    it('lists people with role and status and counts both tabs (accepted invites are not shown)', async () => {
      startServer();
      renderStaff();
      const table = await screen.findByRole('table', { name: 'People' });
      const ben = within(table).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('ben@jbf.org')).toBeInTheDocument();
      expect(within(ben).getByText('Staff')).toBeInTheDocument();
      expect(within(ben).getByText('Active')).toBeInTheDocument();
      expect(within(table).getByText('Deactivated')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Invites (2)' })).toBeInTheDocument();
    });

    it('disables role change and deactivate on the signed-in Admin\'s own row and explains why', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      expect(screen.getByRole('button', { name: 'Change role for Anita Rao' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deactivate Anita Rao' })).toBeDisabled();
      expect(screen.getByText('Ask another Admin to change your access.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change role for Ben Okoye' })).toBeEnabled();
    });

    it('filters by name or email', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await userEvent.type(screen.getByLabelText('Filter by name or email'), 'ELI');
      expect(screen.getByText('Eli Brooks')).toBeInTheDocument();
      expect(screen.queryByText('Ben Okoye')).not.toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText('Filter by name or email'));
      await userEvent.type(screen.getByLabelText('Filter by name or email'), 'nobody');
      expect(screen.getByText('No one matches that filter')).toBeInTheDocument();
    });

    it('links each person to their activity in the audit log', async () => {
      startServer();
      renderStaff();
      const link = await screen.findByRole('link', { name: 'View activity for Ben Okoye' });
      expect(link).toHaveAttribute('href', '/audit?involving=staff-1');
      await userEvent.click(link);
      expect(await screen.findByTestId('location')).toHaveTextContent('/audit?involving=staff-1');
    });

    it('shows names and emails as inert text, never as markup', async () => {
      const hostile = [{ ...peopleFixture[1]!, name: '<img src=x onerror=alert(1)>', email: 'x@jbf.org' }];
      startServer({}, hostile);
      const { container } = renderStaff();
      expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('changing a role', () => {
    it('saves the new role and refreshes the list', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Change role for Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Change role' });
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change role' })).not.toBeInTheDocument());
      expect(server.calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/users/staff-1/role', body: { role: 'admin' } });
      const ben = within(screen.getByRole('table', { name: 'People' })).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('Admin')).toBeInTheDocument();
    });

    it('shows the server\'s reason inside the dialog and keeps it open', async () => {
      startServer({ 'PATCH /api/users/staff-1/role': { status: 409, body: { message: 'At least one active Admin is required.' } } });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Change role for Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Change role' });
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('At least one active Admin is required.');
      expect(screen.getByRole('dialog', { name: 'Change role' })).toBeInTheDocument();
    });
  });

  describe('deactivating and reactivating', () => {
    it('asks for confirmation, explains the effect, and deactivates', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      expect(within(dialog).getByText(/signed out immediately/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(0);

      await userEvent.click(screen.getByRole('button', { name: 'Deactivate Ben Okoye' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' })).getByRole('button', { name: 'Deactivate' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument());
      const ben = within(screen.getByRole('table', { name: 'People' })).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('Deactivated')).toBeInTheDocument();
    });

    it('closing with Esc does not submit anything', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      fireEvent(screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' }), new Event('close'));
      expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument();
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(0);
    });

    it('shows the last-Admin message in plain words and keeps the dialog open', async () => {
      startServer({ 'POST /api/users/staff-1/deactivate': { status: 409, body: { message: 'At least one active Admin is required.' } } });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('At least one active Admin is required.');
    });

    it('disables the confirm button while the request is in flight so it cannot be sent twice', async () => {
      let release: (value: MockResponse) => void = () => undefined;
      const gate = new Promise<MockResponse>((resolve) => {
        release = resolve;
      });
      const server = startServer({ 'POST /api/users/staff-1/deactivate': () => gate });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeDisabled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      release({ body: { ...peopleFixture[1], status: 'deactivated' } });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument());
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(1);
    });

    it('reactivates straight from the row', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Reactivate Eli Brooks' }));
      await waitFor(() => expect(server.count('POST /api/users/staff-2/reactivate')).toBe(1));
      const eli = within(await screen.findByRole('table', { name: 'People' })).getByRole('row', { name: /Eli Brooks/ });
      await waitFor(() => expect(within(eli).getByText('Active')).toBeInTheDocument());
    });
  });

  describe('Invites tab', () => {
    it('lists pending and expired invites with Resend and Cancel, and supports arrow-key tab switching', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      screen.getByRole('tab', { name: 'People (3)' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      const table = await screen.findByRole('table', { name: 'Invites' });
      expect(within(table).getByText('Carla Mendes')).toBeInTheDocument();
      expect(within(table).getByText(/^Pending/)).toBeInTheDocument();
      expect(within(table).getByText('Dev Patel')).toBeInTheDocument();
      expect(within(table).getByText('Expired')).toBeInTheDocument();
      expect(within(table).queryByText('Old Timer')).not.toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Resend invite to Carla Mendes' })).toBeInTheDocument();
    });

    it('resends an invite and says so', async () => {
      const server = startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await openInvitesTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Resend invite to Dev Patel' }));
      await waitFor(() => expect(server.count('POST /api/invites/inv-2/resend')).toBe(1));
      expect(await screen.findByRole('status')).toHaveTextContent('Invite resent to dev@jbf.org.');
    });

    it('cancels an invite only after confirmation', async () => {
      const server = startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await openInvitesTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel invite for Carla Mendes' }));
      const dialog = screen.getByRole('dialog', { name: 'Cancel invite for Carla Mendes?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Keep invite' }));
      expect(server.count('DELETE /api/invites/inv-1')).toBe(0);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel invite for Carla Mendes' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Cancel invite for Carla Mendes?' })).getByRole('button', { name: 'Cancel invite' }));
      await waitFor(() => expect(screen.queryByText('Carla Mendes')).not.toBeInTheDocument());
      expect(server.count('DELETE /api/invites/inv-1')).toBe(1);
    });
  });

  describe('Invite person', () => {
    const openDialog = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite person' }));
      return screen.getByRole('dialog', { name: 'Invite person' });
    };

    it('asks for name and email before calling the server and focuses the first problem', async () => {
      const server = startServer();
      renderStaff();
      const dialog = await openDialog();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
      expect(within(dialog).getByLabelText('Email')).toHaveAccessibleDescription(/Enter an email address\./);
      expect(within(dialog).getByLabelText('Name')).toHaveFocus();
      expect(server.count('POST /api/invites')).toBe(0);
    });

    it('sends the invite with the chosen role, closes, shows the Invites tab and confirms', async () => {
      const server = startServer();
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'fiona@jbf.org');
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invite person' })).not.toBeInTheDocument());
      expect(server.calls.find((c) => c.method === 'POST' && c.url === '/api/invites')?.body).toEqual({ name: 'Fiona Quinn', email: 'fiona@jbf.org', role: 'admin' });
      expect(await screen.findByRole('table', { name: 'Invites' })).toBeInTheDocument();
      expect(screen.getByText('Fiona Quinn')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Invite sent to fiona@jbf.org.');
    });

    it('defaults the role to Staff', async () => {
      startServer();
      renderStaff();
      const dialog = await openDialog();
      expect(within(dialog).getByLabelText('Role')).toHaveValue('staff');
    });

    it('shows server field errors under the fields and keeps what was typed', async () => {
      startServer({ 'POST /api/invites': { status: 400, body: { message: 'Validation failed', fieldErrors: { email: ['Enter a valid email address.'] } } } });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'not-an-email');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Fiona Quinn');
      expect(within(dialog).getByLabelText('Email')).toHaveValue('not-an-email');
    });

    it('shows a conflict in the dialog', async () => {
      startServer({ 'POST /api/invites': { status: 409, body: { message: 'A user with this email already exists.' } } });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Ben Okoye');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'ben@jbf.org');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('A user with this email already exists.');
    });

    it('when the invite is saved but the email fails, closes, warns about Resend and shows the invite', async () => {
      const server = startServer({
        'POST /api/invites': { status: 502, body: { message: 'The invite was saved but the email could not be sent. Use Resend to try again.' } },
      });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'fiona@jbf.org');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The invite was saved but the email could not be sent. Use Resend to try again.');
      expect(screen.queryByRole('dialog', { name: 'Invite person' })).not.toBeInTheDocument();
      expect(server.count('GET /api/invites')).toBeGreaterThan(1);
      expect(screen.getByRole('tab', { name: /^Invites/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('loading and errors', () => {
    it('shows a skeleton while loading', () => {
      mockSession(ADMIN, () => new Promise<MockResponse>(() => undefined));
      renderStaff();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    });

    it('shows an error with Retry when the lists cannot be loaded', async () => {
      let failures = 1;
      startServer({
        'GET /api/users': () => (failures-- > 0 ? { status: 500, body: {} } : { body: peopleFixture }),
      });
      renderStaff();
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('table', { name: 'People' })).toBeInTheDocument();
    });
  });
});
