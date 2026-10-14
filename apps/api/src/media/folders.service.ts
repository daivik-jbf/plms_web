import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { files, mediaFolders, mediaItems, topicAttachments, users } from '../db/schema';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import type { MediaCategory } from './media-kinds';

const NAME_TAKEN = 'A folder with that name already exists.';

export interface FolderView {
  id: string;
  name: string;
  position: number;
  itemCount: number;
  // The bytes of every ready item's file and cover.
  sizeBytes: number;
  category: MediaCategory;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedAt: string;
  // The creator until someone changes the folder.
  updatedBy: { id: string; name: string };
}

const mediaFile = alias(files, 'media_file');
const coverFile = alias(files, 'cover_file');
const creator = alias(users, 'creator');
const updater = alias(users, 'updater');

@Injectable()
export class FoldersService {
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(category: MediaCategory, executor: DbExecutor = this.db): Promise<FolderView[]> {
    const rows = await executor
      .select({
        id: mediaFolders.id,
        name: mediaFolders.name,
        position: mediaFolders.position,
        itemCount: sql<number>`count(${mediaItems.id}) filter (where ${mediaItems.status} = 'ready')`.mapWith(Number),
        sizeBytes: sql<number>`coalesce(sum(${mediaFile.sizeBytes} + coalesce(${coverFile.sizeBytes}, 0)) filter (where ${mediaItems.status} = 'ready'), 0)`.mapWith(Number),
        category: mediaFolders.category,
        createdAt: mediaFolders.createdAt,
        createdBy: { id: creator.id, name: creator.name },
        updatedAt: mediaFolders.updatedAt,
        updatedBy: { id: updater.id, name: updater.name },
      })
      .from(mediaFolders)
      .innerJoin(creator, eq(creator.id, mediaFolders.createdBy))
      .leftJoin(updater, eq(updater.id, mediaFolders.updatedBy))
      .leftJoin(mediaItems, eq(mediaItems.folderId, mediaFolders.id))
      .leftJoin(mediaFile, eq(mediaFile.id, mediaItems.mediaFileId))
      .leftJoin(coverFile, eq(coverFile.id, mediaItems.coverFileId))
      .where(eq(mediaFolders.category, category))
      .groupBy(mediaFolders.id, creator.id, updater.id)
      .orderBy(asc(mediaFolders.position), asc(mediaFolders.createdAt), asc(mediaFolders.id));
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy ?? row.createdBy,
    }));
  }

  private async view(executor: DbExecutor, category: MediaCategory, id: string): Promise<FolderView> {
    const view = (await this.list(category, executor)).find((candidate) => candidate.id === id);
    if (!view) throw new NotFoundException('Folder not found.');
    return view;
  }

  create(actor: AuthUser, category: MediaCategory, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mediaFolders.position}), -1) + 1`.mapWith(Number) })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, category));
      let folder;
      try {
        [folder] = await tx.insert(mediaFolders).values({ category, name, position: next, createdBy: actor.id }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
        throw error;
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.folder.created',
        target: { type: 'folder', id: folder.id, label: folder.name },
        metadata: { category },
      });
      return this.view(tx, category, folder.id);
    });
  }

  rename(actor: AuthUser, id: string, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [folder] = await tx.select().from(mediaFolders).where(eq(mediaFolders.id, id)).for('update');
      if (!folder) throw new NotFoundException('Folder not found.');
      if (folder.name !== name) {
        try {
          await tx.update(mediaFolders).set({ name, updatedAt: new Date(), updatedBy: actor.id }).where(eq(mediaFolders.id, id));
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
          throw error;
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.folder.renamed',
          target: { type: 'folder', id, label: name },
          changes: { name: { before: folder.name, after: name } },
          metadata: { category: folder.category },
        });
      }
      return this.view(tx, folder.category, id);
    });
  }

  // Deletes the folder for good, with every item in it and their files and covers. A folder with something still uploading, or with
  // an item that a course topic uses, stays: the person has to finish the upload, or take the item out of the course, first.
  async remove(actor: AuthUser, id: string): Promise<void> {
    const removedFiles = await this.db.transaction(async (tx) => {
      const [folder] = await tx.select().from(mediaFolders).where(eq(mediaFolders.id, id)).for('update');
      if (!folder) throw new NotFoundException('Folder not found.');
      const items = await tx.select().from(mediaItems).where(eq(mediaItems.folderId, id)).orderBy(asc(mediaItems.id)).for('update');
      if (items.some((item) => item.status !== 'ready')) {
        throw new ConflictException('Something in this folder is still uploading. Finish or cancel the upload first.');
      }
      const itemIds = items.map((item) => item.id);
      if (itemIds.length > 0) {
        const [{ total }] = await tx.select({ total: count() }).from(topicAttachments).where(inArray(topicAttachments.libraryItemId, itemIds));
        if (total > 0) {
          throw new ConflictException(`${total === 1 ? 'An item in this folder is' : `${total} items in this folder are`} used in course topics. Remove ${total === 1 ? 'it' : 'them'} from the courses first.`);
        }
      }
      let removed: { id: string; storageKey: string; uploadId: string | null }[] = [];
      if (itemIds.length > 0) {
        await tx.delete(mediaItems).where(eq(mediaItems.folderId, id));
        const fileIds = items.flatMap((item) => [item.mediaFileId, item.coverFileId]).filter((fileId): fileId is string => fileId !== null);
        removed = await tx.delete(files).where(inArray(files.id, fileIds)).returning({ id: files.id, storageKey: files.storageKey, uploadId: files.uploadId });
      }
      await tx.delete(mediaFolders).where(eq(mediaFolders.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.folder.deleted',
        target: { type: 'folder', id, label: folder.name },
        metadata: { category: folder.category, itemCount: items.length },
      });
      return removed;
    });
    // The database is the source of truth: a stored object that cannot be removed now is only waste.
    await Promise.all(removedFiles.map((file) => discardStoredFile(this.storage, this.logger, file)));
  }
}
