import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaFolders, mediaItems, topicAttachments } from '../db/schema';
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


export interface RemovedUpload {
  // What was removed, as the audit log names it: a library item by its category, or an attachment.
  target: { type: string; id: string; label: string };
  cover: RemovedUnfinished['cover'];
}

// Removes whatever the unfinished file belongs to, inside the caller's transaction: a library item (with its cover) or a
// topic attachment. The owner's row goes first, taking its lock, then the file row: the same order as everywhere else.
// Returns null when nothing unfinished owned the file (it finished or was removed meanwhile), so a ready one is never removed.
export async function removeUnfinished(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const item = await removeUnfinishedItem(tx, fileId);
  if (item) return { target: { type: item.item.category, id: item.item.id, label: item.item.title }, cover: item.cover };
  const [attachment] = await tx
    .delete(topicAttachments)
    .where(and(eq(topicAttachments.fileId, fileId), eq(topicAttachments.status, 'uploading')))
    .returning({ id: topicAttachments.id, title: topicAttachments.title });
  if (!attachment) return null;
  await tx.delete(files).where(eq(files.id, fileId));
  return { target: { type: 'attachment', id: attachment.id, label: attachment.title ?? '' }, cover: null };
}
