import { describe, expect, it, vi } from 'vitest';
import { backoffMs, type EngineDeps, type EngineInput, PieceFailedError, uploadPieces } from './engine';

const MB = 1024 * 1024;

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps & { sent: number[]; sizes: Map<number, number> } {
  const sent: number[] = [];
  const sizes = new Map<number, number>();
  const urls = new Map<string, number>();
  return {
    sent,
    sizes,
    getPartUrl: async (partNumber) => {
      const url = `https://storage.test/part/${partNumber}/${urls.size}`;
      urls.set(url, partNumber);
      return url;
    },
    sendPart: async (url, body, onProgress) => {
      const partNumber = urls.get(url) as number;
      sent.push(partNumber);
      sizes.set(partNumber, body.size);
      onProgress(body.size);
      return `"etag-${partNumber}"`;
    },
    sleep: async () => undefined,
    isOnline: () => true,
    waitForOnline: async () => undefined,
    ...overrides,
  };
}

const input = (overrides: Partial<EngineInput> = {}): EngineInput => ({
  file: new Blob([new Uint8Array(40 * MB)]),
  partSize: 16 * MB,
  partCount: 3,
  already: new Map(),
  concurrency: 3,
  maxAttempts: 5,
  signal: new AbortController().signal,
  onProgress: () => undefined,
  ...overrides,
});

describe('backoffMs', () => {
  it('grows from one second and stops at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('uploadPieces', () => {
  it('cuts the file into full pieces and a smaller last one, and returns the receipts in order', async () => {
    const deps = makeDeps();
    const receipts = await uploadPieces(input(), deps);
    expect(receipts).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect([...deps.sizes.entries()].sort()).toEqual([[1, 16 * MB], [2, 16 * MB], [3, 8 * MB]]);
  });

  it('never sends more pieces at once than allowed', async () => {
    let active = 0;
    let peak = 0;
    const deps = makeDeps({
      sendPart: async (_url, body, onProgress) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        onProgress(body.size);
        active -= 1;
        return '"e"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(100 * MB)]), partCount: 7 }), deps);
    expect(peak).toBe(3);
  });

  it('skips pieces the server already has and counts their bytes from the start', async () => {
    const deps = makeDeps();
    const progress: number[] = [];
    const receipts = await uploadPieces(input({ already: new Map([[1, '"old-1"'], [3, '"old-3"']]), onProgress: (bytes) => progress.push(bytes) }), deps);
    expect(deps.sent).toEqual([2]);
    expect(progress[0]).toBe(16 * MB + 8 * MB);
    expect(progress.at(-1)).toBe(40 * MB);
    expect(receipts.map((receipt) => receipt.etag)).toEqual(['"old-1"', '"etag-2"', '"old-3"']);
  });

  it('reports bytes sent, never more than the file and ending at the whole file', async () => {
    const progress: number[] = [];
    await uploadPieces(input({ onProgress: (bytes) => progress.push(bytes) }), makeDeps());
    expect(Math.max(...progress)).toBe(40 * MB);
    expect(progress.every((bytes) => bytes >= 0 && bytes <= 40 * MB)).toBe(true);
    expect(progress.at(-1)).toBe(40 * MB);
  });

  it('asks for a fresh link on every attempt, waits longer each time, and then succeeds', async () => {
    let failures = 0;
    const sleeps: number[] = [];
    const getPartUrl = vi.fn(async (partNumber: number) => `https://storage.test/${partNumber}/${failures}`);
    const deps = makeDeps({
      getPartUrl,
      sleep: async (ms) => void sleeps.push(ms),
      sendPart: async (_url, body, onProgress) => {
        if (failures < 4) {
          failures += 1;
          throw new Error('network');
        }
        onProgress(body.size);
        return '"ok"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(getPartUrl).toHaveBeenCalledTimes(5);
  });

  it('gives up after five failed attempts with an error that names the piece', async () => {
    const sleeps: number[] = [];
    const deps = makeDeps({
      sleep: async (ms) => void sleeps.push(ms),
      sendPart: async () => {
        throw new Error('network');
      },
    });
    const failure = await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PieceFailedError);
    expect((failure as PieceFailedError).partNumber).toBe(1);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it('waits for the network instead of using up attempts while offline', async () => {
    let online = false;
    let attempts = 0;
    let waited = 0;
    const deps = makeDeps({
      isOnline: () => online,
      waitForOnline: async () => {
        waited += 1;
        online = true;
      },
      sendPart: async (_url, body, onProgress) => {
        attempts += 1;
        if (attempts <= 7) {
          online = false;
          throw new Error('offline');
        }
        onProgress(body.size);
        return '"ok"';
      },
    });
    const receipts = await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps);
    expect(receipts).toEqual([{ partNumber: 1, etag: '"ok"' }]);
    expect(waited).toBeGreaterThanOrEqual(8);
  });

  it('stops everything when asked, without sending further pieces', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      sendPart: async (_url, _body, _onProgress, signal) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        throw new DOMException('Aborted', 'AbortError');
      },
    });
    await expect(uploadPieces(input({ signal: controller.signal }), deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.sent).toEqual([]);
  });

  it('stops the other pieces when one piece cannot be sent', async () => {
    const started: number[] = [];
    const deps = makeDeps({
      sendPart: async (url, body, onProgress, signal) => {
        const partNumber = Number(/part\/(\d+)\//.exec(url)?.[1]);
        started.push(partNumber);
        if (partNumber === 1) throw new Error('boom');
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          setTimeout(resolve, 50);
        });
        onProgress(body.size);
        return '"e"';
      },
    });
    const failure = await uploadPieces(input({ maxAttempts: 1, concurrency: 2, partCount: 5, file: new Blob([new Uint8Array(70 * MB)]) }), deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PieceFailedError);
    expect(started).not.toContain(4);
    expect(started).not.toContain(5);
  });
  it('keeps reporting bytes that never go backwards, even when a piece has to be sent again', async () => {
    const progress: number[] = [];
    let failedOnce = false;
    const deps = makeDeps({
      sendPart: async (_url, body, onProgress) => {
        if (!failedOnce) {
          failedOnce = true;
          onProgress(body.size - 1);
          throw new Error('network');
        }
        onProgress(body.size);
        return '"ok"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1, onProgress: (bytes) => progress.push(bytes) }), deps);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(5);
  });

  it('ignores progress reported after an attempt has ended and never counts more than the piece', async () => {
    const progress: number[] = [];
    const late: Array<(loaded: number) => void> = [];
    let attempt = 0;
    const deps = makeDeps({
      sendPart: async (_url, body, onProgress) => {
        late.push(onProgress);
        attempt += 1;
        if (attempt === 1) throw new Error('network');
        onProgress(body.size * 10);
        return '"ok"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1, onProgress: (bytes) => progress.push(bytes) }), deps);
    const seen = progress.length;
    late[0]!(3);
    late[1]!(4);
    expect(progress).toHaveLength(seen);
    expect(Math.max(...progress)).toBe(5);
  });

  it('reports a stop, not a piece error, when the caller stopped and a piece failed in the meantime', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      sendPart: async () => {
        controller.abort();
        throw new Error('network went away as we stopped');
      },
    });
    await expect(uploadPieces(input({ signal: controller.signal }), deps)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('removes its listener from the caller\'s signal when it is done', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await uploadPieces(input({ signal: controller.signal }), makeDeps());
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
