import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { User } from '../api/auth';
import { AuthProvider } from '../auth/AuthContext';
import { mockFetch, type MockResponse } from './fetch-mock';

export const ADMIN: User = { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin' };
export const STAFF: User = { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff' };

type Handler = (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>;

// Stubs fetch so the app restores a session as `user` (or as signed out when null); every other request goes
// to `handler`.
export function mockSession(user: User | null, handler: Handler = () => ({ status: 404, body: {} })) {
  return mockFetch((url, init) => {
    if (url === '/api/auth/refresh') return user ? { body: { accessToken: 'test-token' } } : { status: 401, body: {} };
    if (url === '/api/auth/me') return { body: user };
    return handler(url, init);
  });
}

export function renderWithSession(ui: ReactElement, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}
