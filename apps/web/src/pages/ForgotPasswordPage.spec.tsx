import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );

const submit = async (email = 'anyone@example.com') => {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
};

describe('ForgotPasswordPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the same neutral confirmation whatever the server says about the account', async () => {
    mockFetch(() => ({ status: 202, body: { message: 'If an account exists for that email, a reset link has been sent.' } }));
    renderPage();
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists/i);
  });

  it('shows the neutral confirmation when the server fails', async () => {
    mockFetch(() => ({ status: 500, body: { message: 'Something went wrong. Please try again.' } }));
    renderPage();
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists/i);
  });

  it('shows the neutral confirmation when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPage();
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists/i);
  });

  it('shows the email field error from a 400 and keeps the form', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { email: ['Enter a valid email address.'] } } }));
    renderPage();
    await submit('not-an-email');
    const field = screen.getByLabelText('Email');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('Enter a valid email address.');
    expect(field).toHaveValue('not-an-email');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains a rate limit and keeps the form', async () => {
    mockFetch(() => ({ status: 429, body: { message: 'ThrottlerException: Too Many Requests' } }));
    renderPage();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please try again in a minute.');
    expect(screen.getByLabelText('Email')).toHaveValue('anyone@example.com');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
