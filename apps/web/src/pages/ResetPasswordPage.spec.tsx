import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { ResetPasswordPage } from './ResetPasswordPage';

function SignIn() {
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  return <p>Sign in page: {notice}</p>;
}

const renderPage = (search = '?token=abc') =>
  render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<SignIn />} />
      </Routes>
    </MemoryRouter>,
  );

const server = (reset: () => { status?: number; body?: unknown } = () => ({ status: 204 })) =>
  mockFetch((url) => (url.endsWith('/password-policy') ? { body: { minLength: 12, maxLength: 128 } } : reset()));

const fillAndSubmit = async (password: string, confirm = password) => {
  await userEvent.type(screen.getByLabelText('New password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
};

describe('ResetPasswordPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('states the minimum length from the server policy', async () => {
    server();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 12 characters/i));
  });

  it('rejects a mismatched confirmation without calling the server and focuses it', async () => {
    const fetchMock = server();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 12/i));
    await fillAndSubmit('a long new passphrase', 'something else entirely');
    const confirm = screen.getByLabelText('Confirm password');
    expect(confirm).toHaveAccessibleDescription(/do not match/i);
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/reset-password'))).toHaveLength(0);
  });

  it('shows the server-side newPassword error under the field', async () => {
    server(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { newPassword: ['That password is too common. Choose something less guessable.'] } } }));
    renderPage();
    await fillAndSubmit('password1234');
    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
    const field = screen.getByLabelText('New password');
    expect(field).toHaveAccessibleDescription(/too common/i);
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('sends the person to sign in after success', async () => {
    server();
    renderPage();
    await fillAndSubmit('a long new passphrase');
    expect(await screen.findByText(/Sign in page: Your password has been changed/)).toBeInTheDocument();
  });

  it('explains a dead link and offers a new one', async () => {
    server(() => ({ status: 400, body: { message: 'This reset link is invalid or has expired.' } }));
    renderPage();
    await fillAndSubmit('a long new passphrase');
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is invalid or has expired.');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('explains a missing token', () => {
    server();
    renderPage('');
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it.each([
    [429, 'ThrottlerException: Too Many Requests', 'Too many requests. Please try again in a minute.'],
    [500, 'Something went wrong. Please try again.', 'Something went wrong. Please try again.'],
  ])('keeps the form and what was typed after a %i', async (status, message, shown) => {
    server(() => ({ status, body: { message } }));
    renderPage();
    await fillAndSubmit('a long new passphrase');
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
    expect(screen.getByLabelText('New password')).toHaveValue('a long new passphrase');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('a long new passphrase');
  });

  it('keeps the form after a network failure', async () => {
    mockFetch((url) => {
      if (url.endsWith('/password-policy')) return { body: { minLength: 12, maxLength: 128 } };
      throw new TypeError('Failed to fetch');
    });
    renderPage();
    await fillAndSubmit('a long new passphrase');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByLabelText('New password')).toHaveValue('a long new passphrase');
  });
});
