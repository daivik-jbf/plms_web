import { describeError } from '../api/client';
import { PieceFailedError } from './engine';
import { MissingReceiptError } from './xhr';

export function describeUploadError(error: unknown): string {
  if (error instanceof PieceFailedError) {
    if (error.cause instanceof MissingReceiptError) {
      return 'Uploads are not set up correctly: the storage did not return a receipt for a piece. Ask an Admin to check docs/storage.md.';
    }
    return 'The connection kept failing. Check your internet connection, then press Try again.';
  }
  return describeError(error);
}
