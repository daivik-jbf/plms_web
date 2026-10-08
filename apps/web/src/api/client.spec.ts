import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { api, ApiError, describeError, refreshSession, setAccessToken, setSessionLostHandler, TOO_MANY_REQUESTS } from './client';

describe('api client', () => {
  beforeEach(() => {
    setAccessToken(null);
    setSessionLostHandler(() => undefined);
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and parses JSON', async () => {
    setAccessToken('abc');
    const fetchMock = mockFetch(() => ({ body: { hello: 'world' } }));
    await expect(api('/api/thing')).resolves.toEqual({ hello: 'world' });
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('turns an error response into an ApiError carrying field errors', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { email: ['Enter a valid email address.'] } } }));
    await expect(api('/api/x', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { email: ['Enter a valid email address.'] },
    });
    await expect(api('/api/x', { method: 'POST', body: {}, auth: false })).rejects.toBeInstanceOf(ApiError);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('old');
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(url);
      if (url === '/api/auth/refresh') return { body: { accessToken: 'new' } };
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? { body: { ok: true } } : { status: 401, body: { message: 'Unauthorized' } };
    });
    await expect(api('/api/thing')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['/api/thing', '/api/auth/refresh', '/api/thing']);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    setAccessToken('old');
    let refreshCalls = 0;
    mockFetch(async (url, init) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { body: { accessToken: 'new' } };
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer new'
        ? { body: { ok: true } }
        : { status: 401, body: {} };
    });
    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('serialises the refresh across tabs with a Web Lock and still shares it within the tab', async () => {
    setAccessToken('old');
    const request = vi.fn((name: string, callback: () => Promise<boolean>) => {
      expect(name).toBe('jbf-refresh');
      return callback();
    });
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    let refreshCalls = 0;
    mockFetch(async (url, init) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { body: { accessToken: 'new' } };
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer new'
        ? { body: { ok: true } }
        : { status: 401, body: {} };
    });
    await expect(Promise.all([api('/api/a'), api('/api/b')])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(refreshCalls).toBe(1);
  });

  it('does not send the refresh until the cross-tab lock is granted', async () => {
    setAccessToken('old');
    let grant: () => void = () => undefined;
    const granted = new Promise<void>((resolve) => {
      grant = resolve;
    });
    const request = vi.fn(async (_name: string, callback: () => Promise<boolean>) => {
      await granted;
      return callback();
    });
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return url === '/api/auth/refresh' ? { body: { accessToken: 'new' } } : { body: {} };
    });
    const pending = refreshSession();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([]);
    grant();
    await expect(pending).resolves.toBe(true);
    expect(calls).toEqual(['/api/auth/refresh']);
  });

  it('signals session loss and throws when the refresh fails', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    setSessionLostHandler(lost);
    mockFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    await expect(api('/api/thing')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh for public calls such as login', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { status: 401, body: { message: 'Invalid email or password.' } };
    });
    await expect(api('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      message: 'Invalid email or password.',
    });
    expect(calls).toEqual(['/api/auth/login']);
  });
});

describe('describeError', () => {
  it('shows server messages for client errors and for the 502 "email failed" answer', () => {
    expect(describeError(new ApiError(409, 'At least one active Admin is required.'))).toBe('At least one active Admin is required.');
    expect(describeError(new ApiError(502, 'The invite was saved but the email could not be sent. Use Resend to try again.'))).toBe(
      'The invite was saved but the email could not be sent. Use Resend to try again.',
    );
  });

  it('hides internals of other server errors and network failures, and words rate limiting fixedly', () => {
    expect(describeError(new ApiError(500, 'stack trace here'))).toBe('Something went wrong. Please try again.');
    expect(describeError(new ApiError(429, 'x'))).toBe(TOO_MANY_REQUESTS);
    expect(describeError(new TypeError('Failed to fetch'))).toBe('Something went wrong. Please try again.');
  });
});
