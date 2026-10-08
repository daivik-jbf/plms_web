import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export function mockFetch(handler: (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const { status = 200, body } = await handler(String(input), init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
