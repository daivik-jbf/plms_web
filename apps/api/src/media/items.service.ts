import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type AuditChanges, type FileRow, files, type MediaItem, mediaFolders, mediaItems, users } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { ORDER_CHANGED_MESSAGE, type UpdateItemInput } from './media.schemas';

export interface ItemView {
  id: string;
  folderId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  status: MediaItem['status'];
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  position: number;
}

interface ItemRow {
  item: MediaItem;
  media: FileRow;
  cover: FileRow | null;
  creator: { id: string; name: string };
}

const NOT_FOUND = 'Video not found.';
const coverFile = alias(files, 'cover_file');

// A video that is still uploading belongs to the person uploading it; to everyone else it does not exist yet.
const visibleTo = (item: Pick<MediaItem, 'status' | 'createdBy'>, actor: AuthUser): boolean =>
  item.status === 'ready' || item.createdBy === actor.id;

@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, folderId: string): Promise<ItemView[]> {
    await this.requireFolder(this.db, folderId);
    const rows = await this.rows(
      this.db,
      and(eq(mediaItems.folderId, folderId), or(eq(mediaItems.status, 'ready'), eq(mediaItems.createdBy, actor.id))),
    );
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async view(itemId: string, actor: AuthUser): Promise<ItemView> {
    const [row] = await this.rows(this.db, eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    return this.toView(row);
  }

  async requireVisible(executor: DbExecutor, itemId: string, actor: AuthUser): Promise<MediaItem> {
    const [item] = await executor.select().from(mediaItems).where(eq(mediaItems.id, itemId));
    if (!item || !visibleTo(item, actor)) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  async update(actor: AuthUser, id: string, input: UpdateItemInput): Promise<ItemView> {
    await this.db.transaction(async (tx) => {
      const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, id)).for('update');
      if (!item || !visibleTo(item, actor)) throw new NotFoundException(NOT_FOUND);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== item.title) changes.title = { before: item.title, after: input.title };
      if (input.description !== undefined && input.description !== item.description) {
        changes.description = { before: item.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(mediaItems).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(mediaItems.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.edited',
        target: { type: 'video', id, label: input.title ?? item.title },
        changes,
      });
    });
    return this.view(id, actor);
  }

  async reorder(actor: AuthUser, folderId: string, ids: string[]): Promise<ItemView[]> {
    await this.db.transaction(async (tx) => {
      const folder = await this.requireFolder(tx, folderId, true);
      const readyOfFolder = and(eq(mediaItems.folderId, folderId), eq(mediaItems.status, 'ready'));
      // Lock in id order so two people reordering at once cannot deadlock, then read the order in SQL.
      await tx.select({ id: mediaItems.id }).from(mediaItems).where(readyOfFolder).orderBy(asc(mediaItems.id)).for('update');
      const current = (
        await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(readyOfFolder)
          .orderBy(asc(mediaItems.position), asc(mediaItems.createdAt), asc(mediaItems.id))
      ).map((item) => item.id);
      const known = new Set(current);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new ConflictException(ORDER_CHANGED_MESSAGE);
      }
      if (ids.some((id, index) => id !== current[index])) {
        for (const [index, id] of ids.entries()) {
          await tx.update(mediaItems).set({ position: index, updatedAt: new Date() }).where(eq(mediaItems.id, id));
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.video.reordered',
          target: { type: 'folder', id: folderId, label: folder.name },
        });
      }
    });
    return this.list(actor, folderId);
  }

  async play(actor: AuthUser, itemId: string): Promise<{ url: string; expiresAt: string; contentType: string }> {
    const [row] = await this.rows(this.db, eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    if (row.item.status !== 'ready') throw new ConflictException('This video is still uploading.');
    const url = await this.storage.presignGet(row.media.storageKey, LINK_TTL_SECONDS, { contentType: row.media.contentType });
    // Written only after the link exists, and every issued link is recorded (including a renewal while watching).
    await this.audit.record(this.db, {
      actor: actorOf(actor),
      action: 'playback.played',
      target: { type: 'video', id: itemId, label: row.item.title },
    });
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), contentType: row.media.contentType };
  }

  private async requireFolder(executor: DbExecutor, folderId: string, lock = false) {
    const query = executor.select().from(mediaFolders).where(eq(mediaFolders.id, folderId));
    const [folder] = lock ? await query.for('update') : await query;
    if (!folder) throw new NotFoundException('Folder not found.');
    return folder;
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<ItemRow[]> {
    return executor
      .select({ item: mediaItems, media: files, cover: coverFile, creator: { id: users.id, name: users.name } })
      .from(mediaItems)
      .innerJoin(files, eq(files.id, mediaItems.mediaFileId))
      .leftJoin(coverFile, eq(coverFile.id, mediaItems.coverFileId))
      .innerJoin(users, eq(users.id, mediaItems.createdBy))
      .where(where)
      .orderBy(asc(mediaItems.position), asc(mediaItems.createdAt), asc(mediaItems.id));
  }

  private async toView(row: ItemRow): Promise<ItemView> {
    const coverUrl =
      row.cover && row.cover.status === 'ready'
        ? await this.storage.presignGet(row.cover.storageKey, LINK_TTL_SECONDS, { contentType: row.cover.contentType })
        : null;
    return {
      id: row.item.id,
      folderId: row.item.folderId,
      title: row.item.title,
      description: row.item.description,
      durationSeconds: row.item.durationSeconds,
      sizeBytes: row.media.sizeBytes,
      status: row.item.status,
      coverUrl,
      createdBy: row.creator,
      createdAt: row.item.createdAt,
      position: row.item.position,
    };
  }
}
