import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export function mockFetch(handler: (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const { status = 200, body, text, headers } = await handler(String(input), init);
    const payload = status === 204 ? null : text !== undefined ? text : JSON.stringify(body ?? {});
    return new Response(payload, {
      status,
      headers: { 'Content-Type': text !== undefined ? 'text/csv' : 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
