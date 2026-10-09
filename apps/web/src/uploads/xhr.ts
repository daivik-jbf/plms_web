export class HttpPieceError extends Error {
  constructor(readonly status: number) {
    super(`The storage answered ${status}`);
  }
}

export class MissingReceiptError extends Error {
  constructor() {
    super('The storage did not return a receipt (ETag) for the piece');
  }
}

const PIECE_TIMEOUT_MS = 10 * 60 * 1000;

// XMLHttpRequest rather than fetch because only it reports upload progress. The piece's receipt (ETag) is read
// from the response; the bucket must expose that header to the browser (docs/storage.md).
export function sendPiece(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = (): void => xhr.abort();
    const finish = (): void => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });

    xhr.open('PUT', url);
    xhr.timeout = PIECE_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      finish();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new HttpPieceError(xhr.status));
        return;
      }
      const etag = xhr.getResponseHeader('ETag');
      if (etag) resolve(etag);
      else reject(new MissingReceiptError());
    };
    xhr.onerror = () => {
      finish();
      reject(new Error('Network error while sending a piece'));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error('Sending a piece took too long'));
    };
    xhr.onabort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send(body);
  });
}
