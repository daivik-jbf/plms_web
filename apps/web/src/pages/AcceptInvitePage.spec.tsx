import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { AcceptInvitePage } from './AcceptInvitePage';

const renderPage = (search = '?token=abc') =>
  render(
    <MemoryRouter initialEntries={[`/accept-invite${search}`]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/login" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const server = (accept: () => { status?: number; body?: unknown } = () => ({ status: 201, body: {} })) =>
  mockFetch((url) => {
    if (url.endsWith('/password-policy')) return { body: { minLength: 10, maxLength: 128 } };
    if (url.endsWith('/preview')) return { body: { name: 'Anita Rao', email: 'anita@example.com' } };
    return accept();
  });

describe('AcceptInvitePage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('greets the invited person and states the password rules before they type', async () => {
    server();
    renderPage();
    expect(await screen.findByText(/Welcome, Anita Rao/)).toBeInTheDocument();
    expect(screen.getByText('anita@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
  });

  it('rejects a short password and a mismatched confirmation without calling the server', async () => {
    const fetchMock = server();
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription(/do not match/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/accept'))).toHaveLength(0);
  });

  it('shows the server-side password problem, such as a common password', async () => {
    server(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { password: ['That password is too common. Choose something less guessable.'] } } }));
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
  });

  it('sends the person to sign in after success', async () => {
    server();
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'a long new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a long new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
  });

  it('explains a dead link instead of showing a form', async () => {
    mockFetch((url) =>
      url.endsWith('/password-policy')
        ? { body: { minLength: 10, maxLength: 128 } }
        : { status: 400, body: { message: 'This invite link is invalid or has expired.' } },
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite link is invalid or has expired.');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it.each([
    [429, 'ThrottlerException: Too Many Requests', 'Too many requests. Please try again in a minute.'],
    [500, 'Something went wrong. Please try again.', 'Something went wrong. Please try again.'],
  ])('keeps the form and what was typed after a %i', async (status, message, shown) => {
    server(() => ({ status, body: { message } }));
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'a long new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a long new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
    expect(screen.getByLabelText('New password')).toHaveValue('a long new passphrase');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('a long new passphrase');
  });

  it('keeps the form after a network failure', async () => {
    mockFetch((url) => {
      if (url.endsWith('/password-policy')) return { body: { minLength: 10, maxLength: 128 } };
      if (url.endsWith('/preview')) return { body: { name: 'Anita Rao', email: 'anita@example.com' } };
      throw new TypeError('Failed to fetch');
    });
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'a long new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a long new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByLabelText('New password')).toHaveValue('a long new passphrase');
  });

  it('moves focus to the first invalid field once its error is shown', async () => {
    server();
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'a long new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different words here');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    const confirm = screen.getByLabelText('Confirm password');
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(confirm).toHaveAccessibleDescription(/do not match/i);
  });

  it('does not treat a temporary failure while checking the invite as a dead link', async () => {
    mockFetch((url) =>
      url.endsWith('/password-policy') ? { body: { minLength: 10, maxLength: 128 } } : { status: 503, body: { message: 'Service Unavailable' } },
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByText(/reload this page/i)).toBeInTheDocument();
  });

  it('explains a missing token', async () => {
    server();
    renderPage('');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });
});
