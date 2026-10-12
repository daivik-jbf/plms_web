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
import type { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { imageMatches } from './file-checks';
import { type ItemView, ItemsService, type VisibleItem } from './items.service';
import type { CoverStartInput } from './media.schemas';

const NOT_UPLOADED = 'The cover image has not been uploaded yet. Try again.';
const REJECTED = 'That is not a valid JPEG, PNG or WebP image of the declared size, so it was discarded. Please choose another file.';

export interface CoverUpload {
  fileId: string;
  url: string;
  headers: { 'Content-Type': string };
}

// Whatever carries a cover image: a library item or a course. The checks and the attaching are the same; the owner says
// which row to lock, which column to set and what to write in the audit log.
export interface CoverOwner {
  id: string;
  title: string;
  coverFileId: string | null;
  // The audit target type of the owner (a category such as "song", or "course") and the entry written when a cover is set.
  targetType: string;
  action: AuditAction;
  metadata: Record<string, unknown>;
  // Locks the owner's row and returns what it holds now, or null when it is gone.
  lock: (tx: DbTransaction) => Promise<{ title: string; coverFileId: string | null } | null>;
  setCover: (tx: DbTransaction, fileId: string, at: Date) => Promise<void>;
}

const itemOwner = (item: VisibleItem): CoverOwner => ({
  id: item.id,
  title: item.title,
  coverFileId: item.coverFileId,
  targetType: item.category,
  action: 'content.video.cover_set',
  metadata: { category: item.category },
  lock: async (tx) => (await tx.select().from(mediaItems).where(eq(mediaItems.id, item.id)).for('update'))[0] ?? null,
  setCover: async (tx, fileId, at) => {
    await tx.update(mediaItems).set({ coverFileId: fileId, updatedAt: at }).where(eq(mediaItems.id, item.id));
  },
});

@Injectable()
export class CoversService {
  private readonly logger = new Logger(CoversService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
  ) {}

  async start(actor: AuthUser, itemId: string, input: CoverStartInput): Promise<CoverUpload> {
    await this.items.requireVisible(this.db, itemId, actor);
    return this.newCover(actor, input);
  }

  async complete(actor: AuthUser, itemId: string, fileId: string): Promise<ItemView> {
    const item = await this.items.requireVisible(this.db, itemId, actor);
    await this.setCover(actor, itemOwner(item), fileId);
    return this.items.view(item.id, actor);
  }

  // Step one for any owner (the caller has already found the owner): a one-time link to send the image to.
  async newCover(actor: AuthUser, input: CoverStartInput): Promise<CoverUpload> {
    const key = `covers/${randomUUID()}`;
    const url = await this.storage.presignPut(key, input.contentType, LINK_TTL_SECONDS);
    const [file] = await this.db
      .insert(files)
      .values({ purpose: 'cover', storageKey: key, originalName: 'cover', contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedBy: actor.id })
      .returning({ id: files.id });
    return { fileId: file.id, url, headers: { 'Content-Type': input.contentType } };
  }

  // Step two for any owner: check what was uploaded and make it the owner's cover.
  async setCover(actor: AuthUser, owner: CoverOwner, fileId: string): Promise<void> {
    const [file] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.purpose, 'cover')));
    if (!file) throw new NotFoundException('Cover upload not found.');
    if (file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    if (file.status === 'ready') {
      if (owner.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
      return;
    }

    const info = await this.storage.head(file.storageKey);
    if (!info) throw new UnprocessableEntityException(NOT_UPLOADED);
    if (info.size !== file.sizeBytes) return this.reject(actor, owner, file, 'size_mismatch');
    const head = await this.readHead(file.storageKey);
    if (info.contentType !== file.contentType || !imageMatches(head, file.contentType)) return this.reject(actor, owner, file, 'bad_image');
    await this.attach(actor, owner, file);
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

  private async reject(actor: AuthUser, owner: CoverOwner, file: FileRow, reason: 'size_mismatch' | 'bad_image'): Promise<never> {
    const removed = await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'file.upload_failed',
        target: { type: owner.targetType, id: owner.id, label: owner.title },
        metadata: { fileId: file.id, reason },
      });
      return true;
    });
    if (removed) await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
    throw new UnprocessableEntityException(REJECTED);
  }

  // Lock order everywhere: the owner's row first (the item or the course), then the file row.
  private async attach(actor: AuthUser, owner: CoverOwner, file: FileRow): Promise<void> {
    const replaced = await this.db.transaction(async (tx) => {
      const locked = await owner.lock(tx);
      const [lockedFile] = await tx.select().from(files).where(eq(files.id, file.id)).for('update');
      if (!locked || !lockedFile) throw new NotFoundException('Cover upload not found.');
      if (lockedFile.status === 'ready') {
        if (locked.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
        return null;
      }
      const now = new Date();
      await tx.update(files).set({ status: 'ready', completedAt: now }).where(eq(files.id, file.id));
      // The owner points at the new file before the old row is deleted, so the foreign key always holds.
      await owner.setCover(tx, file.id, now);
      let old: Pick<FileRow, 'id' | 'storageKey'> | null = null;
      if (locked.coverFileId) {
        [old] = await tx.delete(files).where(eq(files.id, locked.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: owner.action,
        target: { type: owner.targetType, id: owner.id, label: locked.title },
        metadata: { fileId: file.id, ...owner.metadata },
      });
      return old;
    });
    if (replaced) await discardStoredFile(this.storage, this.logger, { id: replaced.id, storageKey: replaced.storageKey, uploadId: null });
  }
}
