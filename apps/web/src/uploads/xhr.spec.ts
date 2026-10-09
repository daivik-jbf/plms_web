import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPieceError, MissingReceiptError, sendPiece } from './xhr';

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  sent: unknown = null;
  aborted = false;
  status = 0;
  timeout = 0;
  headers: Record<string, string> = {};
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  getResponseHeader(name: string) {
    return name.toLowerCase() === 'etag' ? this.headers.etag ?? null : null;
  }
}

describe('sendPiece', () => {
  beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr));
  afterEach(() => vi.unstubAllGlobals());

  const blob = new Blob(['abc']);

  it('PUTs the piece, reports progress and resolves with the receipt', async () => {
    const progress: number[] = [];
    const done = sendPiece('https://s.test/p', blob, (loaded) => progress.push(loaded), new AbortController().signal);
    const xhr = FakeXhr.last;
    expect([xhr.method, xhr.url, xhr.sent]).toEqual(['PUT', 'https://s.test/p', blob]);
    xhr.upload.onprogress?.({ loaded: 2 });
    xhr.upload.onprogress?.({ loaded: 3 });
    xhr.status = 200;
    xhr.headers.etag = '"abc123"';
    xhr.onload?.();
    await expect(done).resolves.toBe('"abc123"');
    expect(progress).toEqual([2, 3]);
  });

  it('rejects with the status when the storage refuses', async () => {
    const done = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(done).rejects.toMatchObject({ status: 403 });
    await expect(done).rejects.toBeInstanceOf(HttpPieceError);
  });

  it('explains a missing receipt (the usual sign of wrong browser permissions on the bucket)', async () => {
    const done = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.status = 200;
    FakeXhr.last.onload?.();
    await expect(done).rejects.toBeInstanceOf(MissingReceiptError);
  });

  it('rejects on network errors and timeouts', async () => {
    const first = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.onerror?.();
    await expect(first).rejects.toThrow(/network/i);
    const second = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.ontimeout?.();
    await expect(second).rejects.toThrow(/too long/i);
  });

  it('stops the request when asked, and never starts one that is already cancelled', async () => {
    const controller = new AbortController();
    const done = sendPiece('https://s.test/p', blob, () => undefined, controller.signal);
    controller.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    const before = FakeXhr.last;
    await expect(sendPiece('https://s.test/p', blob, () => undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last).toBe(before);
  });
});
