import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaFolders, mediaItems } from '../db/schema';
import type { MediaCategory } from './media-kinds';

export interface RemovedUnfinished {
  item: { id: string; title: string; category: MediaCategory };
  // The cover attached to the item, if any: the caller discards its stored object after the transaction commits.
  cover: Pick<FileRow, 'id' | 'storageKey'> | null;
}

// Deletes an unfinished item (a video or an audio file) with its media file row and its cover, inside the caller's
// transaction. Returns null when the item is no longer unfinished (it finished or was removed meanwhile), so a ready
// item is never removed. The item goes first (taking its row lock), then the file rows, the same order as everywhere
// else. The cover is read from the deleted row, not from an earlier snapshot, because one can be attached at any time.
export async function removeUnfinishedItem(tx: DbTransaction, mediaFileId: string): Promise<RemovedUnfinished | null> {
  const [item] = await tx
    .delete(mediaItems)
    .where(and(eq(mediaItems.mediaFileId, mediaFileId), eq(mediaItems.status, 'uploading')))
    .returning({ id: mediaItems.id, title: mediaItems.title, folderId: mediaItems.folderId, coverFileId: mediaItems.coverFileId });
  if (!item) return null;
  // Folders are never deleted, so the item's folder still says which category it belonged to (for the audit entry).
  const [folder] = await tx.select({ category: mediaFolders.category }).from(mediaFolders).where(eq(mediaFolders.id, item.folderId));
  await tx.delete(files).where(eq(files.id, mediaFileId));
  let cover: RemovedUnfinished['cover'] = null;
  if (item.coverFileId) {
    [cover = null] = await tx.delete(files).where(eq(files.id, item.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
  }
  return { item: { id: item.id, title: item.title, category: folder.category }, cover };
}
