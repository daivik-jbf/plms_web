import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { imageMatches } from './file-checks';
import { type ItemView, ItemsService, type VisibleItem } from './items.service';
import type { CoverStartInput } from './media.schemas';

const NOT_UPLOADED = 'The cover image has not been uploaded yet. Try again.';
const REJECTED = 'That is not a valid JPEG, PNG or WebP image of the declared size, so it was discarded. Please choose another file.';

@Injectable()
export class CoversService {
  private readonly logger = new Logger(CoversService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
  ) {}

  async start(
    actor: AuthUser,
    itemId: string,
    input: CoverStartInput,
  ): Promise<{ fileId: string; url: string; headers: { 'Content-Type': string } }> {
    await this.items.requireVisible(this.db, itemId, actor);
    const key = `covers/${randomUUID()}`;
    const url = await this.storage.presignPut(key, input.contentType, LINK_TTL_SECONDS);
    const [file] = await this.db
      .insert(files)
      .values({ purpose: 'cover', storageKey: key, originalName: 'cover', contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedBy: actor.id })
      .returning({ id: files.id });
    return { fileId: file.id, url, headers: { 'Content-Type': input.contentType } };
  }

  async complete(actor: AuthUser, itemId: string, fileId: string): Promise<ItemView> {
    const item = await this.items.requireVisible(this.db, itemId, actor);
    const [file] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.purpose, 'cover')));
    if (!file) throw new NotFoundException('Cover upload not found.');
    if (file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    if (file.status === 'ready') return this.alreadyAttached(actor, item, file);

    const info = await this.storage.head(file.storageKey);
    if (!info) throw new UnprocessableEntityException(NOT_UPLOADED);
    if (info.size !== file.sizeBytes) return this.reject(actor, item, file, 'size_mismatch');
    const head = await this.readHead(file.storageKey);
    if (info.contentType !== file.contentType || !imageMatches(head, file.contentType)) return this.reject(actor, item, file, 'bad_image');
    return this.attach(actor, item, file);
  }

  // The object can disappear between the size check and this read (for example cleanup of an abandoned cover):
  // that is the same as "not uploaded yet", not a server error.
  private async readHead(key: string): Promise<Uint8Array> {
    try {
      return await this.storage.readRange(key, 0, 15);
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not_found') throw new UnprocessableEntityException(NOT_UPLOADED);
      throw error;
    }
  }

  private alreadyAttached(actor: AuthUser, item: MediaItem, file: FileRow): Promise<ItemView> {
    if (item.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
    return this.items.view(item.id, actor);
  }

  private async reject(actor: AuthUser, item: VisibleItem, file: FileRow, reason: 'size_mismatch' | 'bad_image'): Promise<never> {
    const removed = await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'file.upload_failed',
        target: { type: item.category, id: item.id, label: item.title },
        metadata: { fileId: file.id, reason },
      });
      return true;
    });
    if (removed) await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
    throw new UnprocessableEntityException(REJECTED);
  }

  // Lock order everywhere: the media item row first, then the file row.
  private async attach(actor: AuthUser, item: VisibleItem, file: FileRow): Promise<ItemView> {
    const replaced = await this.db.transaction(async (tx) => {
      const [lockedItem] = await tx.select().from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
      const [lockedFile] = await tx.select().from(files).where(eq(files.id, file.id)).for('update');
      if (!lockedItem || !lockedFile) throw new NotFoundException('Cover upload not found.');
      if (lockedFile.status === 'ready') {
        if (lockedItem.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
        return null;
      }
      const now = new Date();
      await tx.update(files).set({ status: 'ready', completedAt: now }).where(eq(files.id, file.id));
      // The item points at the new file before the old row is deleted, so the foreign key always holds.
      await tx.update(mediaItems).set({ coverFileId: file.id, updatedAt: now }).where(eq(mediaItems.id, item.id));
      let old: Pick<FileRow, 'id' | 'storageKey'> | null = null;
      if (lockedItem.coverFileId) {
        [old] = await tx.delete(files).where(eq(files.id, lockedItem.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.cover_set',
        target: { type: item.category, id: item.id, label: lockedItem.title },
        metadata: { fileId: file.id, category: item.category },
      });
      return old;
    });
    if (replaced) await discardStoredFile(this.storage, this.logger, { id: replaced.id, storageKey: replaced.storageKey, uploadId: null });
    return this.items.view(item.id, actor);
  }
}
