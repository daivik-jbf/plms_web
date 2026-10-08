import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { AdminRoute } from './AdminRoute';

const routes = (
  <Routes>
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<p>Dashboard home</p>} />
      <Route element={<AdminRoute />}>
        <Route path="/staff" element={<p>Staff admin page</p>} />
      </Route>
    </Route>
  </Routes>
);

describe('AdminRoute', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lets an Admin through', async () => {
    mockSession(ADMIN);
    renderWithSession(routes, '/staff');
    expect(await screen.findByText('Staff admin page')).toBeInTheDocument();
  });

  it('sends Staff to the dashboard instead', async () => {
    mockSession(STAFF);
    renderWithSession(routes, '/staff');
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    expect(screen.queryByText('Staff admin page')).not.toBeInTheDocument();
  });
});
