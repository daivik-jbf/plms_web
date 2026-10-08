import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../../auth/ProtectedRoute';
import type { MockResponse } from '../../test/fetch-mock';
import { useAuth } from '../../auth/AuthContext';
import { ADMIN, mockSession, renderWithSession } from '../../test/session';
import { LoginPage } from '../LoginPage';
import { AccountPage } from './AccountPage';

type Override = MockResponse | (() => MockResponse | Promise<MockResponse>);

function start(overrides: Record<string, Override> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  mockSession(ADMIN, (url, init) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const key = `${method} ${url}`;
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override() : override;
    if (key === 'GET /api/auth/password-policy') return { body: { minLength: 10, maxLength: 128 } };
    if (key === 'POST /api/auth/change-password' || key === 'POST /api/auth/logout-all' || key === 'POST /api/auth/logout') return { status: 204 };
    if (key === 'POST /api/auth/login') return { body: { accessToken: 'test-token-2', user: ADMIN } };
    return { status: 404, body: {} };
  });
  return { calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key).length };
}

function HomeWithSignOut() {
  const { signOut } = useAuth();
  return (
    <>
      <h1>Home</h1>
      <button type="button" onClick={() => void signOut()}>
        Plain sign out
      </button>
    </>
  );
}

function renderAccount() {
  return renderWithSession(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/" element={<HomeWithSignOut />} />
      </Route>
    </Routes>,
    '/account',
  );
}

const fill = async (current: string, next: string, confirm: string) => {
  await userEvent.type(await screen.findByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
};

describe('AccountPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the password rules and the sign-out warning before anything is typed', async () => {
    start();
    renderAccount();
    expect(await screen.findByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
    expect(screen.getByText(/signs you out of every device/i)).toBeInTheDocument();
  });

  it('asks for every field and moves focus to the first problem without calling the server', async () => {
    const server = start();
    renderAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription('Enter your current password.');
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(server.count('POST /api/auth/change-password')).toBe(0);
  });

  it('rejects a short or mismatched new password before calling the server', async () => {
    const server = start();
    renderAccount();
    await fill('current password!', 'short', 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/use at least 10 characters/i);
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription(/do not match/i);
    expect(server.count('POST /api/auth/change-password')).toBe(0);
  });

  it('changes the password, signs out locally and shows a notice on the sign-in page', async () => {
    const server = start();
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your password was changed. Sign in again with the new one.');
    expect(server.calls.find((c) => c.url === '/api/auth/change-password')?.body).toEqual({
      currentPassword: 'current password!',
      newPassword: 'a brand new passphrase',
    });
  });

  it('shows the server\'s complaint under the right field and keeps what was typed', async () => {
    start({
      'POST /api/auth/change-password': { status: 400, body: { message: 'Validation failed', fieldErrors: { currentPassword: ['Current password is incorrect.'] } } },
    });
    renderAccount();
    await fill('wrong current', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription('Current password is incorrect.');
    expect(screen.getByLabelText('New password')).not.toHaveAccessibleDescription(/incorrect/);
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(screen.getByLabelText('New password')).toHaveValue('a brand new passphrase');
  });

  it('shows both server complaints when the current and the new password are both rejected, focusing the first', async () => {
    start({
      'POST /api/auth/change-password': {
        status: 400,
        body: {
          message: 'Validation failed',
          fieldErrors: { currentPassword: ['Current password is incorrect.'], newPassword: ['That password is too common. Choose something less guessable.'] },
        },
      },
    });
    renderAccount();
    await fill('wrong current', 'password123', 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription('Current password is incorrect.'));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/too common/);
    expect(screen.getByLabelText('Current password')).toHaveFocus();
  });

  it('moves focus to the same invalid field again on a second attempt', async () => {
    start();
    renderAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    const currentField = screen.getByLabelText('Current password');
    expect(currentField).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('button', { name: 'Change password' })).not.toHaveFocus();
    expect(currentField).toHaveFocus();
  });

  it('shows a common-password complaint from the server under the new password field', async () => {
    start({
      'POST /api/auth/change-password': {
        status: 400,
        body: { message: 'Validation failed', fieldErrors: { newPassword: ['That password is too common. Choose something less guessable.'] } },
      },
    });
    renderAccount();
    await fill('current password!', 'password123', 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/That password is too common\. Choose something less guessable\./);
    expect(screen.getByLabelText('Current password')).not.toHaveAccessibleDescription(/too common/);
    expect(screen.getByLabelText('New password')).toHaveFocus();
  });

  it('keeps the form and shows an alert for rate limits and server errors', async () => {
    start({ 'POST /api/auth/change-password': { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } } });
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please try again in a minute.');
    expect(screen.getByLabelText('New password')).toHaveValue('a brand new passphrase');
  });

  it('disables the button while the request is in flight so it cannot be sent twice', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const gate = new Promise<MockResponse>((resolve) => {
      release = resolve;
    });
    const server = start({ 'POST /api/auth/change-password': () => gate });
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    release({ status: 204 });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(server.count('POST /api/auth/change-password')).toBe(1);
  });

  describe('sign out of all devices', () => {
    it('asks first, then ends every session and shows a notice on the sign-in page', async () => {
      const server = start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      const dialog = screen.getByRole('dialog', { name: 'Sign out of all devices?' });
      expect(server.count('POST /api/auth/logout-all')).toBe(0);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('You were signed out of all devices.');
      expect(server.count('POST /api/auth/logout-all')).toBe(1);
    });

    it('does nothing when cancelled', async () => {
      const server = start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Sign out of all devices?' })).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out of all devices?' })).not.toBeInTheDocument());
      expect(server.count('POST /api/auth/logout-all')).toBe(0);
      expect(server.count('POST /api/auth/logout')).toBe(0);
      expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeInTheDocument();
    });

    it('does nothing when closed with Esc (the native close event)', async () => {
      const server = start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      fireEvent(screen.getByRole('dialog', { name: 'Sign out of all devices?' }), new Event('close'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out of all devices?' })).not.toBeInTheDocument());
      expect(server.count('POST /api/auth/logout-all')).toBe(0);
      expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeInTheDocument();
      // It can be opened again afterwards.
      await userEvent.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
      expect(screen.getByRole('dialog', { name: 'Sign out of all devices?' })).toBeInTheDocument();
    });

    it('keeps the dialog open with the error and does not sign out when the request fails', async () => {
      const server = start({ 'POST /api/auth/logout-all': { status: 500, body: {} } });
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      const dialog = screen.getByRole('dialog', { name: 'Sign out of all devices?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      expect(within(dialog).getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(server.count('POST /api/auth/logout')).toBe(0);
      expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    });

    it('does not show the sign-out notice again after the next sign-in', async () => {
      start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Sign out of all devices?' })).getByRole('button', { name: 'Sign out everywhere' }));
      expect(await screen.findByRole('status')).toHaveTextContent('You were signed out of all devices.');
      await userEvent.type(screen.getByLabelText('Email'), 'anita@jbf.org');
      await userEvent.type(screen.getByLabelText('Password'), 'a good passphrase');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Plain sign out' }));
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.queryByText('You were signed out of all devices.')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
