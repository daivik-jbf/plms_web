export interface Receipt {
  partNumber: number;
  etag: string;
}

export interface EngineDeps {
  getPartUrl(partNumber: number): Promise<string>;
  sendPart(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  isOnline(): boolean;
  waitForOnline(signal: AbortSignal): Promise<void>;
}

export interface EngineInput {
  file: Blob;
  partSize: number;
  partCount: number;
  // Pieces the server already holds (piece number to receipt); they are not sent again.
  already: ReadonlyMap<number, string>;
  concurrency: number;
  maxAttempts: number;
  signal: AbortSignal;
  onProgress: (bytesSent: number) => void;
}

export class PieceFailedError extends Error {
  constructor(
    readonly partNumber: number,
    cause: unknown,
  ) {
    super(`Piece ${partNumber} could not be sent`, { cause });
  }
}

// After the first failure wait one second, then two, four, eight ... never more than thirty.
export const backoffMs = (failedAttempt: number): number => Math.min(30_000, 1000 * 2 ** (failedAttempt - 1));

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

export async function uploadPieces(input: EngineInput, deps: EngineDeps): Promise<Receipt[]> {
  const { file, partSize, partCount, already, concurrency, maxAttempts, onProgress } = input;
  const pieceBytes = (partNumber: number): number => Math.min(partSize, file.size - (partNumber - 1) * partSize);

  const receipts = new Map<number, string>(already);
  const inFlight = new Map<number, number>();
  let finishedBytes = 0;
  for (const partNumber of already.keys()) finishedBytes += pieceBytes(partNumber);
  // A piece that has to be sent again starts from zero, but the bar the person sees never moves backwards.
  let highest = 0;
  const report = (): void => {
    let sending = 0;
    for (const loaded of inFlight.values()) sending += loaded;
    highest = Math.max(highest, finishedBytes + sending);
    onProgress(highest);
  };
  report();

  const queue: number[] = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!already.has(partNumber)) queue.push(partNumber);
  }

  // One signal for the pieces in flight: stopped by the caller, or by the first piece that cannot be sent.
  const stopper = new AbortController();
  const stop = (): void => stopper.abort();
  if (input.signal.aborted) stop();
  input.signal.addEventListener('abort', stop, { once: true });
  let failure: unknown = null;

  async function sendOne(partNumber: number): Promise<void> {
    let attempts = 0;
    for (;;) {
      if (stopper.signal.aborted) throw abortError();
      if (!deps.isOnline()) await deps.waitForOnline(stopper.signal);
      attempts += 1;
      try {
        // A fresh link for every attempt: links last an hour and a long upload can outlive one.
        const url = await deps.getPartUrl(partNumber);
        const body = file.slice((partNumber - 1) * partSize, partNumber * partSize);
        inFlight.set(partNumber, 0);
        report();
        const etag = await deps.sendPart(
          url,
          body,
          (loaded) => {
            // Ignore reports that arrive after this attempt has ended.
            if (!inFlight.has(partNumber)) return;
            inFlight.set(partNumber, Math.min(loaded, body.size));
            report();
          },
          stopper.signal,
        );
        inFlight.delete(partNumber);
        finishedBytes += body.size;
        receipts.set(partNumber, etag);
        report();
        return;
      } catch (error) {
        inFlight.delete(partNumber);
        report();
        if (stopper.signal.aborted) throw error;
        // Losing the network is not the piece's fault: wait for it to come back without using up an attempt.
        if (!deps.isOnline()) {
          attempts -= 1;
          continue;
        }
        if (attempts >= maxAttempts) throw new PieceFailedError(partNumber, error);
        await deps.sleep(backoffMs(attempts), stopper.signal);
      }
    }
  }

  async function worker(): Promise<void> {
    while (!stopper.signal.aborted) {
      const partNumber = queue.shift();
      if (partNumber === undefined) return;
      try {
        await sendOne(partNumber);
      } catch (error) {
        failure ??= error;
        stop();
        return;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } finally {
    input.signal.removeEventListener('abort', stop);
  }
  // Whatever a piece reported while being torn down, a caller who asked to stop is told it was stopped.
  if (input.signal.aborted) throw abortError();
  if (failure !== null) throw failure;
  return [...receipts.entries()].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber);
}
