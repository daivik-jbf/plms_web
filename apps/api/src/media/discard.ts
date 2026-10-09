import type { Logger } from '@nestjs/common';
import type { FileRow } from '../db/schema';
import { StorageError, type StoragePort } from '../storage/storage.port';

// Removes whatever storage holds for a file: an unfinished multipart upload and/or a finished object. Best effort:
// the database is the source of truth and a leftover object is harmless, so this never throws and logs ids only.
export async function discardStoredFile(
  storage: StoragePort,
  logger: Logger,
  file: Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>,
): Promise<void> {
  if (file.uploadId) {
    await storage.abortMultipartUpload(file.storageKey, file.uploadId).catch((error: unknown) => {
      if (!(error instanceof StorageError && error.code === 'no_such_upload')) {
        logger.warn(`Could not abort the unfinished upload for file ${file.id}`);
      }
    });
  }
  await storage.delete(file.storageKey).catch(() => logger.warn(`Could not delete the stored object for file ${file.id}`));
}
