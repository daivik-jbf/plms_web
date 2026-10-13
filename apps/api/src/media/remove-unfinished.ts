import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaFolders, mediaItems, topicAttachments } from '../db/schema';

export interface RemovedUpload {
  // What was removed, as the audit log names it: a library item by its category, or an attachment.
  target: { type: string; id: string; label: string };
  // The cover attached to a library item, if any: the caller discards its stored object after the transaction commits.
  cover: Pick<FileRow, 'id' | 'storageKey'> | null;
}

// Removes whatever the unfinished file belongs to, inside the caller's transaction: a library item (with its media file
// row and its cover) or a topic attachment (with its file row). The owner's row goes first, taking its lock, then the file
// rows: the same order as everywhere else. Returns null when nothing unfinished owned the file (it finished or was
// removed meanwhile), so a ready item or attachment is never removed.
export async function removeUnfinished(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  return (await removeItem(tx, fileId)) ?? (await removeAttachment(tx, fileId));
}

// The cover is read from the deleted row, not from an earlier snapshot, because one can be attached at any time.
async function removeItem(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const [item] = await tx
    .delete(mediaItems)
    .where(and(eq(mediaItems.mediaFileId, fileId), eq(mediaItems.status, 'uploading')))
    .returning({ id: mediaItems.id, title: mediaItems.title, folderId: mediaItems.folderId, coverFileId: mediaItems.coverFileId });
  if (!item) return null;
  // Folders are never deleted, so the item's folder still says which category it belonged to (for the audit entry).
  const [folder] = await tx.select({ category: mediaFolders.category }).from(mediaFolders).where(eq(mediaFolders.id, item.folderId));
  await tx.delete(files).where(eq(files.id, fileId));
  let cover: RemovedUpload['cover'] = null;
  if (item.coverFileId) {
    [cover = null] = await tx.delete(files).where(eq(files.id, item.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
  }
  return { target: { type: folder.category, id: item.id, label: item.title }, cover };
}

async function removeAttachment(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const [attachment] = await tx
    .delete(topicAttachments)
    .where(and(eq(topicAttachments.fileId, fileId), eq(topicAttachments.status, 'uploading')))
    .returning({ id: topicAttachments.id, title: topicAttachments.title, coverFileId: topicAttachments.coverFileId });
  if (!attachment) return null;
  await tx.delete(files).where(eq(files.id, fileId));
  let cover: RemovedUpload['cover'] = null;
  if (attachment.coverFileId) {
    [cover = null] = await tx.delete(files).where(eq(files.id, attachment.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
  }
  return { target: { type: 'attachment', id: attachment.id, label: attachment.title ?? '' }, cover };
}
