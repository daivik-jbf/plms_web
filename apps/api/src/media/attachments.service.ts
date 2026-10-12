import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type FileRow, files, type MediaFolder, type MediaItem, mediaFolders, mediaItems, type TopicAttachment, topicAttachments, topics, users } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { MEDIA_CATEGORIES, type MediaCategory, type MediaKind } from './media-kinds';
import type { LibraryAttachmentInput } from './media.schemas';
import { applyOrder } from './reorder';

const NOT_FOUND = 'Attachment not found.';
const TOPIC_NOT_FOUND = 'Topic not found.';
const ownFile = alias(files, 'own_file');
const itemMedia = alias(files, 'item_media');
const itemCover = alias(files, 'item_cover');

export interface AttachmentView {
  id: string;
  topicId: string;
  position: number;
  kind: MediaKind;
  // The attachment's own title, or the library item's current title for a library attachment that has none of its own.
  title: string;
  source: 'upload' | 'library';
  status: TopicAttachment['status'];
  sizeBytes: number;
  durationSeconds: number | null;
  // A one-hour link to a small picture: a library item's cover, or the uploaded image itself. Null for everything else.
  thumbnailUrl: string | null;
  libraryItemId: string | null;
  category: MediaCategory | null;
  libraryFolderName: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface OpenLink {
  url: string;
  expiresAt: string;
  contentType: string;
  kind: MediaKind;
}

interface AttachmentRow {
  attachment: TopicAttachment;
  own: FileRow | null;
  item: MediaItem | null;
  media: FileRow | null;
  cover: FileRow | null;
  folder: MediaFolder | null;
  creator: { id: string; name: string };
}

// An attachment that is still uploading belongs to the person uploading it; to everyone else it does not exist yet.
const visibleTo = (attachment: Pick<TopicAttachment, 'status' | 'createdBy'>, actor: AuthUser): boolean =>
  attachment.status === 'ready' || attachment.createdBy === actor.id;

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(topicId: string, actor: AuthUser): Promise<AttachmentView[]> {
    const rows = await this.rows(
      this.db,
      and(eq(topicAttachments.topicId, topicId), or(eq(topicAttachments.status, 'ready'), eq(topicAttachments.createdBy, actor.id))),
    );
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async view(id: string, actor: AuthUser): Promise<AttachmentView> {
    const [row] = await this.rows(this.db, eq(topicAttachments.id, id));
    if (!row || !visibleTo(row.attachment, actor)) throw new NotFoundException(NOT_FOUND);
    return this.toView(row);
  }

  async addFromLibrary(actor: AuthUser, topicId: string, input: LibraryAttachmentInput): Promise<AttachmentView> {
    const id = await this.db.transaction(async (tx) => {
      // The topic row is locked, so two people adding at once get different positions.
      const [topic] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (!topic) throw new NotFoundException(TOPIC_NOT_FOUND);
      const [found] = await tx
        .select({ item: mediaItems, category: mediaFolders.category })
        .from(mediaItems)
        .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
        .where(eq(mediaItems.id, input.itemId));
      if (!found || (found.item.status !== 'ready' && found.item.createdBy !== actor.id)) throw new NotFoundException('Item not found.');
      if (found.item.status !== 'ready') throw new ConflictException('That item is still uploading.');
      const kind = MEDIA_CATEGORIES[found.category].kind;
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
        .from(topicAttachments)
        .where(and(eq(topicAttachments.topicId, topicId), eq(topicAttachments.status, 'ready')));
      const [attachment] = await tx
        .insert(topicAttachments)
        .values({ topicId, position: next, kind, title: input.title ?? null, libraryItemId: found.item.id, status: 'ready', createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.attachment.added',
        target: { type: 'attachment', id: attachment.id, label: input.title ?? found.item.title },
        metadata: { kind, source: 'library', topicId, topicTitle: topic.title, libraryItemId: found.item.id },
      });
      return attachment.id;
    });
    return this.view(id, actor);
  }

  async rename(actor: AuthUser, id: string, title: string): Promise<AttachmentView> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(topicAttachments).where(eq(topicAttachments.id, id)).for('update');
      if (!locked || !visibleTo(locked, actor)) throw new NotFoundException(NOT_FOUND);
      const [row] = await this.rows(tx, eq(topicAttachments.id, id));
      const before = row.attachment.title ?? row.item?.title ?? '';
      if (before === title) return;
      await tx.update(topicAttachments).set({ title, updatedAt: new Date() }).where(eq(topicAttachments.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.attachment.renamed',
        target: { type: 'attachment', id, label: title },
        changes: { title: { before, after: title } },
        metadata: { kind: locked.kind, topicId: locked.topicId },
      });
    });
    return this.view(id, actor);
  }

  async reorder(actor: AuthUser, topicId: string, ids: string[]): Promise<AttachmentView[]> {
    await this.db.transaction(async (tx) => {
      const [topic] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (!topic) throw new NotFoundException(TOPIC_NOT_FOUND);
      // Only ready attachments have a place in the order; one that is still uploading takes its place when it finishes.
      const ready = and(eq(topicAttachments.topicId, topicId), eq(topicAttachments.status, 'ready'));
      await tx.select({ id: topicAttachments.id }).from(topicAttachments).where(ready).orderBy(asc(topicAttachments.id)).for('update');
      const current = (
        await tx
          .select({ id: topicAttachments.id })
          .from(topicAttachments)
          .where(ready)
          .orderBy(asc(topicAttachments.position), asc(topicAttachments.createdAt), asc(topicAttachments.id))
      ).map((attachment) => attachment.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(topicAttachments).set({ position, updatedAt: new Date() }).where(eq(topicAttachments.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.attachment.reordered',
          target: { type: 'topic', id: topicId, label: topic.title },
        });
      }
    });
    return this.list(topicId, actor);
  }

  async open(actor: AuthUser, id: string): Promise<OpenLink> {
    const [row] = await this.rows(this.db, eq(topicAttachments.id, id));
    if (!row || !visibleTo(row.attachment, actor)) throw new NotFoundException(NOT_FOUND);
    if (row.attachment.status !== 'ready') throw new ConflictException('This is still uploading.');
    // A library attachment opens the library item's own file, and only while that item is ready.
    const file = row.own ?? row.media;
    if (!file || (row.item && row.item.status !== 'ready')) throw new ConflictException('This item is not available.');
    const url = await this.storage.presignGet(file.storageKey, LINK_TTL_SECONDS, { contentType: file.contentType });
    const { kind } = row.attachment;
    // Written only after the link exists, and every issued link is recorded. Video and audio are played, the rest viewed.
    await this.audit.record(this.db, {
      actor: actorOf(actor),
      action: kind === 'video' || kind === 'audio' ? 'playback.played' : 'playback.viewed',
      target: { type: 'attachment', id, label: row.attachment.title ?? row.item?.title ?? '' },
      metadata: { kind, source: row.own ? 'upload' : 'library', topicId: row.attachment.topicId },
    });
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), contentType: file.contentType, kind };
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<AttachmentRow[]> {
    return executor
      .select({
        attachment: topicAttachments,
        own: ownFile,
        item: mediaItems,
        media: itemMedia,
        cover: itemCover,
        folder: mediaFolders,
        creator: { id: users.id, name: users.name },
      })
      .from(topicAttachments)
      .leftJoin(ownFile, eq(ownFile.id, topicAttachments.fileId))
      .leftJoin(mediaItems, eq(mediaItems.id, topicAttachments.libraryItemId))
      .leftJoin(itemMedia, eq(itemMedia.id, mediaItems.mediaFileId))
      .leftJoin(itemCover, eq(itemCover.id, mediaItems.coverFileId))
      .leftJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .innerJoin(users, eq(users.id, topicAttachments.createdBy))
      .where(where)
      .orderBy(asc(topicAttachments.position), asc(topicAttachments.createdAt), asc(topicAttachments.id));
  }

  private async toView(row: AttachmentRow): Promise<AttachmentView> {
    const { attachment, own, item, media, cover, folder } = row;
    // The picture: a library item's cover, or an uploaded image shown as its own thumbnail once it is complete.
    const picture = item ? cover : attachment.kind === 'image' ? own : null;
    const thumbnailUrl =
      picture && picture.status === 'ready' ? await this.storage.presignGet(picture.storageKey, LINK_TTL_SECONDS, { contentType: picture.contentType }) : null;
    return {
      id: attachment.id,
      topicId: attachment.topicId,
      position: attachment.position,
      kind: attachment.kind,
      title: attachment.title ?? item?.title ?? '',
      source: item ? 'library' : 'upload',
      status: attachment.status,
      sizeBytes: (own ?? media)?.sizeBytes ?? 0,
      durationSeconds: attachment.durationSeconds ?? item?.durationSeconds ?? null,
      thumbnailUrl,
      libraryItemId: item?.id ?? null,
      category: folder?.category ?? null,
      libraryFolderName: folder?.name ?? null,
      createdBy: row.creator,
      createdAt: attachment.createdAt,
    };
  }
}
