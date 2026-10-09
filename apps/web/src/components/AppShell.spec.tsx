import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/auth';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { useUploads } from '../uploads/UploadsContext';
import { AppShell } from './AppShell';

function UploadsProbe() {
  return <p>{`Uploads in progress: ${useUploads().jobs.length}`}</p>;
}

function renderShell(user: User) {
  const fetchMock = mockSession(user, (url) => (url === '/api/auth/logout' ? { status: 204 } : { status: 404, body: {} }));
  const view = renderWithSession(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<h1>Dashboard content</h1>} />
        </Route>
      </Route>
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
  );
  return { ...view, fetchMock };
}

describe('AppShell', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows who is signed in with their role, and the page content', async () => {
    renderShell(ADMIN);
    expect(await screen.findByText('Anita Rao · Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard content' })).toBeInTheDocument();
  });

  it('labels a Staff member as Staff', async () => {
    renderShell(STAFF);
    expect(await screen.findByText('Ben Okoye · Staff')).toBeInTheDocument();
  });

  it('marks the current page in the sidebar navigation', async () => {
    renderShell(ADMIN);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('signs out and returns to the sign-in page', async () => {
    const { fetchMock } = renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    const logout = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/logout');
    expect(logout).toHaveLength(1);
    expect(logout[0]![1]).toMatchObject({ method: 'POST' });
  });

  it('opens the navigation as a drawer from the Menu button and closes it after choosing a page', async () => {
    renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Dashboard' }));
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('shows the Admin section only to Admins', async () => {
    renderShell(ADMIN);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/staff');
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/audit');
    expect(within(nav).getByText('Admin')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/account');
  });

  it('hides the Admin section from Staff', async () => {
    renderShell(STAFF);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    expect(within(nav).queryByText('Admin')).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/account');
  });

  it('has a place for upload progress that stays empty until an upload starts', async () => {
    renderShell(ADMIN);
    await screen.findByText('Anita Rao · Admin');
    expect(screen.queryByRole('region', { name: 'Uploads' })).toBeNull();
  });

  it('lets every page start and follow uploads', async () => {
    mockSession(ADMIN);
    renderWithSession(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<UploadsProbe />} />
          </Route>
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('Uploads in progress: 0')).toBeInTheDocument();
  });
});
