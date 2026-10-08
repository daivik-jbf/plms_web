import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/auth';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { AppShell } from './AppShell';

function renderShell(user: User) {
  mockSession(user, (url) => (url === '/api/auth/logout' ? { status: 204 } : { status: 404, body: {} }));
  return renderWithSession(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<h1>Dashboard content</h1>} />
        </Route>
      </Route>
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
  );
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
    renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('opens the navigation as a drawer from the Menu button and closes it after choosing a page', async () => {
    renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Dashboard' }));
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });
});
