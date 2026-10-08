import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { api, ApiError, setAccessToken, setSessionLostHandler } from './client';

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
