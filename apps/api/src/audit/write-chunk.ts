// The parts of a response that streaming needs; an Express Response fits, and so does a small test double.
export interface ChunkSink {
  readonly destroyed: boolean;
  write(chunk: string): boolean;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
}

// Writes one chunk and honours backpressure. Resolves true when it is safe to write the next chunk, or false when the
// client has gone (the response closed), so the caller stops streaming. Waiting for 'drain' alone would hang forever
// on a disconnect, so it is raced against 'close'.
export function writeChunk(res: ChunkSink, chunk: string): Promise<boolean> {
  if (res.destroyed) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (ok: boolean): void => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(ok);
    };
    const onDrain = (): void => settle(true);
    const onClose = (): void => settle(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}
