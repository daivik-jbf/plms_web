import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuditAction } from '../audit/audit.actions';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaFolders, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS, PART_SIZE, partCountFor, VIDEO_CONTENT_TYPE } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort, type StoredPart } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { hasMp4Signature, sanitizeFileName } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import type { StartUploadInput } from './media.schemas';

const GONE = 'This upload no longer exists.';
const LOST_UPLOAD = 'This upload can no longer be continued. Cancel it and start again.';
const MISSING_PIECES = 'Some pieces are missing. Resume the upload to send them.';
const BAD_PIECES = 'Some pieces are missing or damaged. Resume the upload to send them again.';
const FINISHED = 'This video has already finished uploading.';

const FAILURE_MESSAGES = {
  size_mismatch: 'The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.',
  not_mp4: 'That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).',
} as const;

type FailureReason = keyof typeof FAILURE_MESSAGES;
type UploadRow = { file: FileRow; item: MediaItem };

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
  ) {}

  async start(actor: AuthUser, input: StartUploadInput): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const [folder] = await this.db
      .select({ id: mediaFolders.id })
      .from(mediaFolders)
      .where(and(eq(mediaFolders.id, input.folderId), eq(mediaFolders.category, 'video')));
    if (!folder) throw new NotFoundException('Folder not found.');

    const key = `videos/${randomUUID()}`;
    const partCount = partCountFor(input.sizeBytes);
    // Storage first, then the database: if the transaction fails the storage side is rolled back below.
    const uploadId = await this.storage.createMultipartUpload(key, VIDEO_CONTENT_TYPE);
    try {
      return await this.db.transaction(async (tx) => {
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
          .from(mediaItems)
          .where(eq(mediaItems.folderId, folder.id));
        const [file] = await tx
          .insert(files)
          .values({
            purpose: 'video',
            storageKey: key,
            originalName: sanitizeFileName(input.fileName),
            contentType: VIDEO_CONTENT_TYPE,
            sizeBytes: input.sizeBytes,
            uploadId,
            partSize: PART_SIZE,
            partCount,
            uploadedBy: actor.id,
          })
          .returning();
        const [item] = await tx
          .insert(mediaItems)
          .values({
            folderId: folder.id,
            title: input.title,
            description: input.description ?? null,
            position: next,
            videoFileId: file.id,
            durationSeconds: input.durationSeconds ?? null,
            status: 'uploading',
            createdBy: actor.id,
          })
          .returning();
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'file.upload_started',
          target: { type: 'video', id: item.id, label: item.title },
          metadata: { fileId: file.id, sizeBytes: input.sizeBytes, partCount },
        });
        return { itemId: item.id, fileId: file.id, partSize: PART_SIZE, partCount };
      });
    } catch (error) {
      await this.storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  async partUrls(actor: AuthUser, fileId: string, partNumbers: number[]): Promise<{ urls: Record<string, string> }> {
    const { file } = await this.load(fileId, actor);
    if (file.status !== 'pending' || !file.uploadId) throw new ConflictException(FINISHED);
    const { uploadId, partCount } = { uploadId: file.uploadId, partCount: file.partCount ?? 0 };
    const wanted = [...new Set(partNumbers)];
    if (wanted.some((number) => number > partCount)) {
      throw new BadRequestException(`Piece numbers must be between 1 and ${partCount}.`);
    }
    const links = await Promise.all(wanted.map((number) => this.storage.presignUploadPart(file.storageKey, uploadId, number, LINK_TTL_SECONDS)));
    return { urls: Object.fromEntries(wanted.map((number, index) => [String(number), links[index]])) };
  }

  async status(
    actor: AuthUser,
    fileId: string,
  ): Promise<{ fileId: string; itemId: string; status: FileRow['status']; partSize: number; partCount: number; uploadedParts: StoredPart[] }> {
    const { file, item } = await this.load(fileId, actor);
    const base = { fileId: file.id, itemId: item.id, status: file.status, partSize: file.partSize ?? PART_SIZE, partCount: file.partCount ?? 0 };
    if (file.status === 'ready' || !file.uploadId) return { ...base, uploadedParts: [] };
    try {
      return { ...base, uploadedParts: await this.storage.listParts(file.storageKey, file.uploadId) };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'no_such_upload') throw new ConflictException(LOST_UPLOAD);
      throw error;
    }
  }

  async complete(actor: AuthUser, fileId: string, parts: { partNumber: number; etag: string }[]): Promise<ItemView> {
    const { file, item } = await this.load(fileId, actor);
    if (file.status === 'ready') return this.items.view(item.id, actor);
    if (!file.uploadId) throw new ConflictException(LOST_UPLOAD);

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (sorted.length !== file.partCount || sorted.some((part, index) => part.partNumber !== index + 1)) {
      throw new UnprocessableEntityException(MISSING_PIECES);
    }
    try {
      await this.storage.completeMultipartUpload(file.storageKey, file.uploadId, sorted);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      if (error.code === 'invalid_part' || error.code === 'part_too_small') throw new UnprocessableEntityException(BAD_PIECES);
      if (error.code !== 'no_such_upload') throw error;
      // Someone else (or an earlier attempt that failed after storage finished) already joined the pieces:
      // carry on and judge what is stored.
    }

    const info = await this.storage.head(file.storageKey);
    if (!info) return this.afterVanish(actor, fileId);
    if (info.size !== file.sizeBytes) return this.fail(actor, { file, item }, 'size_mismatch');
    const head = await this.storage.readRange(file.storageKey, 0, 15);
    if (info.contentType !== VIDEO_CONTENT_TYPE || !hasMp4Signature(head)) return this.fail(actor, { file, item }, 'not_mp4');
    return this.finish(actor, { file, item });
  }

  async cancel(actor: AuthUser, fileId: string): Promise<void> {
    const row = await this.load(fileId, actor);
    if (row.file.status === 'ready') throw new ConflictException(`${FINISHED} Finished videos cannot be cancelled here.`);
    const removed = await this.removePending(row, { actor, action: 'file.upload_cancelled', metadata: { fileId } });
    if (!removed) {
      const [current] = await this.db.select({ status: files.status }).from(files).where(eq(files.id, fileId));
      if (current?.status === 'ready') throw new ConflictException(`${FINISHED} Finished videos cannot be cancelled here.`);
      return;
    }
    await discardStoredFile(this.storage, this.logger, row.file);
  }

  mine(actor: AuthUser) {
    return this.db
      .select({
        fileId: files.id,
        itemId: mediaItems.id,
        folderId: mediaItems.folderId,
        title: mediaItems.title,
        fileName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(and(eq(files.uploadedBy, actor.id), eq(files.purpose, 'video'), eq(files.status, 'pending')))
      .orderBy(desc(files.createdAt));
  }

  private async load(fileId: string, actor: AuthUser): Promise<UploadRow> {
    const [row] = await this.db
      .select({ file: files, item: mediaItems })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(and(eq(files.id, fileId), eq(files.purpose, 'video')));
    if (!row) throw new NotFoundException('Upload not found.');
    if (row.file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    return row;
  }

  // The object is not in storage any more: either another request finished the job, or the upload was cancelled.
  private async afterVanish(actor: AuthUser, fileId: string): Promise<ItemView> {
    const [row] = await this.db
      .select({ status: files.status, itemId: mediaItems.id })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(eq(files.id, fileId));
    if (!row) throw new NotFoundException(GONE);
    if (row.status === 'ready') return this.items.view(row.itemId, actor);
    throw new ConflictException(LOST_UPLOAD);
  }

  // Removes the rows of a still-pending upload and records why. Returns false when someone else already did
  // (or the upload finished meanwhile), so a ready video can never be removed by this path.
  private async removePending(
    { file, item }: UploadRow,
    outcome: { actor: AuthUser; action: AuditAction; metadata: Record<string, unknown> },
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(mediaItems)
        .where(and(eq(mediaItems.id, item.id), eq(mediaItems.status, 'uploading')))
        .returning({ id: mediaItems.id });
      if (!gone) return false;
      await tx.delete(files).where(eq(files.id, file.id));
      await this.audit.record(tx, {
        actor: actorOf(outcome.actor),
        action: outcome.action,
        target: { type: 'video', id: item.id, label: item.title },
        metadata: outcome.metadata,
      });
      return true;
    });
  }

  private async fail(actor: AuthUser, row: UploadRow, reason: FailureReason): Promise<never> {
    const removed = await this.removePending(row, { actor, action: 'file.upload_failed', metadata: { fileId: row.file.id, reason } });
    if (removed) await discardStoredFile(this.storage, this.logger, row.file);
    throw new UnprocessableEntityException(FAILURE_MESSAGES[reason]);
  }

  private async finish(actor: AuthUser, { file, item }: UploadRow): Promise<ItemView> {
    const outcome = await this.db.transaction(async (tx) => {
      // Lock the video row first, as removePending does (it deletes the video row, then the file row): taking the
      // locks in the same order is what keeps a cancel and a finish that overlap from deadlocking.
      const [locked] = await tx.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
      if (!locked) return 'gone' as const;
      if (locked.status === 'ready') return 'done' as const;
      const [{ end }] = await tx
        .select({ end: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
        .from(mediaItems)
        .where(and(eq(mediaItems.folderId, item.folderId), eq(mediaItems.status, 'ready')));
      const now = new Date();
      await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
      await tx.update(mediaItems).set({ status: 'ready', position: end, updatedAt: now }).where(eq(mediaItems.id, item.id));
      const target = { type: 'video', id: item.id, label: item.title };
      await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
      await this.audit.record(tx, { actor: actorOf(actor), action: 'content.video.added', target, metadata: { folderId: item.folderId } });
      return 'done' as const;
    });
    if (outcome === 'gone') {
      // Cancelled while the pieces were being joined: the stored object has no owner any more.
      await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
      throw new NotFoundException(GONE);
    }
    return this.items.view(item.id, actor);
  }
}
