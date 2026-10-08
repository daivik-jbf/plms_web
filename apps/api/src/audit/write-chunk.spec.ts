import { EventEmitter } from 'node:events';
import { writeChunk } from './write-chunk';

class FakeResponse extends EventEmitter {
  destroyed = false;
  chunks: string[] = [];
  constructor(private readonly accepts: boolean) {
    super();
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.accepts;
  }
}

describe('writeChunk', () => {
  it('resolves true at once when the write is accepted', async () => {
    const res = new FakeResponse(true);
    await expect(writeChunk(res, 'a')).resolves.toBe(true);
    expect(res.chunks).toEqual(['a']);
  });

  it('waits for drain under backpressure, then resolves true and removes its listeners', async () => {
    const res = new FakeResponse(false);
    let settled = false;
    const result = writeChunk(res, 'a').then((ok) => {
      settled = true;
      return ok;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    res.emit('drain');
    await expect(result).resolves.toBe(true);
    expect(res.listenerCount('drain')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('resolves false (and does not hang) when the response closes while waiting for drain', async () => {
    const res = new FakeResponse(false);
    const result = writeChunk(res, 'a');
    res.destroyed = true;
    res.emit('close');
    await expect(result).resolves.toBe(false);
    expect(res.listenerCount('drain')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('writes nothing and resolves false when the response is already gone', async () => {
    const res = new FakeResponse(true);
    res.destroyed = true;
    await expect(writeChunk(res, 'a')).resolves.toBe(false);
    expect(res.chunks).toEqual([]);
  });
});
