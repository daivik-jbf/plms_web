import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { createBrowserDeps } from './browser-deps';

describe('browser deps', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sleeps for the time asked and stops sleeping when cancelled', async () => {
    const deps = createBrowserDeps('u1');
    const done = vi.fn();
    void deps.sleep(1000, new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();

    const controller = new AbortController();
    const stopped = deps.sleep(60_000, controller.signal);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('waits until the browser says it is online again, or until cancelled', async () => {
    const deps = createBrowserDeps('u1');
    const resumed = vi.fn();
    void deps.waitForOnline(new AbortController().signal).then(resumed);
    await vi.advanceTimersByTimeAsync(10);
    expect(resumed).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(resumed).toHaveBeenCalled();

    const controller = new AbortController();
    const stopped = deps.waitForOnline(controller.signal);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('asks the API for the link of exactly one piece', async () => {
    const calls: { url: string; body: unknown }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { body: { urls: { '4': 'https://storage.test/4' } } };
    });
    expect(await createBrowserDeps('u1').getPartUrl(4)).toBe('https://storage.test/4');
    expect(calls).toEqual([{ url: '/api/media/uploads/u1/part-urls', body: { partNumbers: [4] } }]);
  });

  it('fails clearly if the API returns no link for the piece', async () => {
    mockFetch(() => ({ body: { urls: {} } }));
    await expect(createBrowserDeps('u1').getPartUrl(4)).rejects.toThrow(/link/i);
  });
});
