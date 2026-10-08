import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { mockFetch } from '../test/fetch-mock';
import { LoginPage } from './LoginPage';

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Signed-in home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the server message when the credentials are wrong', async () => {
    mockFetch((url) =>
      url.endsWith('/refresh')
        ? { status: 401, body: {} }
        : { status: 401, body: { message: 'Invalid email or password.' } },
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('asks for both fields before calling the server', async () => {
    const fetchMock = mockFetch(() => ({ status: 401, body: {} }));
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/enter your email/i);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/enter your password/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/login'))).toHaveLength(0);
  });

  it('moves focus to the first invalid field so the error is announced', async () => {
    mockFetch(() => ({ status: 401, body: {} }));
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('goes to the home page after a successful sign in', async () => {
    mockFetch((url) => {
      if (url.endsWith('/refresh')) return { status: 401, body: {} };
      return { body: { accessToken: 't', user: { id: '1', email: 'a@example.com', name: 'Anita', role: 'staff' } } };
    });
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('Signed-in home')).toBeInTheDocument());
  });
});
