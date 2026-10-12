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
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuditAction } from '../audit/audit.actions';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaFolders, mediaItems, type TopicAttachment, topicAttachments, topics } from '../db/schema';
import { LINK_TTL_SECONDS, PART_SIZE, partCountFor } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort, type StoredPart } from '../storage/storage.port';
import { actorOf } from './actor';
import { type AttachmentView, AttachmentsService } from './attachments.service';
import { discardStoredFile } from './discard';
import { sanitizeFileName, titleFromFileName } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import { attachmentFieldErrors, attachmentKindFor, type KindRule, kindOf, MEDIA_KINDS, type MediaCategory, type MediaKind, uploadFieldErrors } from './media-kinds';
import type { StartAttachmentUploadInput, StartUploadInput } from './media.schemas';
import { removeUnfinished, type RemovedUpload } from './remove-unfinished';

const GONE = 'This upload no longer exists.';
const LOST_UPLOAD = 'This upload can no longer be continued. Cancel it and start again.';
const MISSING_PIECES = 'Some pieces are missing. Resume the upload to send them.';
const BAD_PIECES = 'Some pieces are missing or damaged. Resume the upload to send them again.';
const FINISHED = 'This upload has already finished.';

const FAILURE_MESSAGES = {
  size_mismatch: 'The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.',
  not_mp4: 'That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).',
  not_audio: 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.',
  not_pdf: 'That file is not a valid PDF, so it was discarded. Please choose another file.',
  not_image: 'That file is not a valid JPEG, PNG or WebP image, so it was discarded. Please choose another file.',
} as const;

type FailureReason = keyof typeof FAILURE_MESSAGES;

// An unfinished upload of the person asking, for the resume list: it belongs to a folder (library) or to a topic (attachment).
export interface PendingUpload {
  fileId: string;
  itemId: string;
  folderId: string | null;
  topicId: string | null;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

type AuditTarget = { type: string; id: string; label: string };

// What an upload belongs to: a library item (its folder's category decides what kind of file it is and how it is checked)
// or an attachment of a topic (which carries its own kind).
type UploadOwner = { type: 'item'; item: MediaItem; category: MediaCategory } | { type: 'attachment'; attachment: TopicAttachment };
type UploadRow = { file: FileRow; owner: UploadOwner };

const kindRuleOf = (owner: UploadOwner): KindRule => (owner.type === 'item' ? kindOf(owner.category) : MEDIA_KINDS[owner.attachment.kind]);

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
    private readonly attachments: AttachmentsService,
  ) {}

  async start(actor: AuthUser, input: StartUploadInput): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const [folder] = await this.db
      .select({ id: mediaFolders.id, category: mediaFolders.category })
      .from(mediaFolders)
      .where(eq(mediaFolders.id, input.folderId));
    if (!folder) throw new NotFoundException('Folder not found.');
    // The folder decides what may be uploaded; nothing the browser says about the kind is trusted.
    const fieldErrors = uploadFieldErrors(folder.category, input.contentType, input.sizeBytes);
    if (fieldErrors) throw new BadRequestException({ error: 'Bad Request', message: 'Validation failed', fieldErrors });

    return this.begin(actor, kindOf(folder.category), input, async (tx, file) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
        .from(mediaItems)
        .where(eq(mediaItems.folderId, folder.id));
      const [item] = await tx
        .insert(mediaItems)
        .values({
          folderId: folder.id,
          title: input.title,
          description: input.description ?? null,
          position: next,
          mediaFileId: file.id,
          durationSeconds: input.durationSeconds ?? null,
          status: 'uploading',
          createdBy: actor.id,
        })
        .returning();
      return { id: item.id, target: { type: folder.category, id: item.id, label: item.title } };
    });
  }

  async startAttachment(
    actor: AuthUser,
    topicId: string,
    input: StartAttachmentUploadInput,
  ): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const [topic] = await this.db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
    if (!topic) throw new NotFoundException('Topic not found.');
    // An attachment has no folder: the declared type decides the kind, and the size limit is that kind's.
    const fieldErrors = attachmentFieldErrors(input.contentType, input.sizeBytes);
    if (fieldErrors) throw new BadRequestException({ error: 'Bad Request', message: 'Validation failed', fieldErrors });
    // No field error means the declared type belongs to a kind.
    const kindName = attachmentKindFor(input.contentType) as MediaKind;
    const title = input.title ?? titleFromFileName(input.fileName);

    return this.begin(actor, MEDIA_KINDS[kindName], input, async (tx, file) => {
      // The topic row is locked (parent before child), so two uploads started at once get different positions.
      await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).for('update');
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
        .from(topicAttachments)
        .where(eq(topicAttachments.topicId, topicId));
      const [attachment] = await tx
        .insert(topicAttachments)
        .values({
          topicId,
          position: next,
          kind: kindName,
          title,
          fileId: file.id,
          durationSeconds: input.durationSeconds ?? null,
          status: 'uploading',
          createdBy: actor.id,
        })
        .returning();
      return { id: attachment.id, target: { type: 'attachment', id: attachment.id, label: title } };
    });
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
    const { file, owner } = await this.load(fileId, actor);
    const base = {
      fileId: file.id,
      itemId: owner.type === 'item' ? owner.item.id : owner.attachment.id,
      status: file.status,
      partSize: file.partSize ?? PART_SIZE,
      partCount: file.partCount ?? 0,
    };
    if (file.status === 'ready' || !file.uploadId) return { ...base, uploadedParts: [] };
    try {
      return { ...base, uploadedParts: await this.storage.listParts(file.storageKey, file.uploadId) };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'no_such_upload') throw new ConflictException(LOST_UPLOAD);
      throw error;
    }
  }

  async complete(actor: AuthUser, fileId: string, parts: { partNumber: number; etag: string }[]): Promise<ItemView | AttachmentView> {
    const row = await this.load(fileId, actor);
    const { file, owner } = row;
    if (file.status === 'ready') return this.viewOf(owner, actor);
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
    if (info.size !== file.sizeBytes) return this.fail(actor, row, 'size_mismatch');
    // A cancel or the cleanup job can remove the object between the size check and this read.
    const head = await this.storage.readRange(file.storageKey, 0, 15).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === 'not_found') return null;
      throw error;
    });
    if (!head) return this.afterVanish(actor, fileId);
    // The stored type must be the declared one, and the first bytes must match it (an MP4 "ftyp", an MP3 frame or ID3 tag,
    // the "%PDF-" marker, an image signature).
    const kind = kindRuleOf(owner);
    if (info.contentType !== file.contentType || !kind.matches(head, file.contentType)) return this.fail(actor, row, kind.failureReason);
    return this.finish(actor, row);
  }

  async cancel(actor: AuthUser, fileId: string): Promise<void> {
    const row = await this.load(fileId, actor);
    if (row.file.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
    const removed = await this.removePending(row.file, { actor, action: 'file.upload_cancelled', metadata: { fileId } });
    if (!removed) {
      const [current] = await this.db.select({ status: files.status }).from(files).where(eq(files.id, fileId));
      if (current?.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
      return;
    }
    await this.discardRemoved(row.file, removed);
  }

  // My unfinished uploads, newest first: library uploads belong to a folder, attachment uploads to a topic.
  async mine(actor: AuthUser): Promise<PendingUpload[]> {
    const pending = and(eq(files.uploadedBy, actor.id), ne(files.purpose, 'cover'), eq(files.status, 'pending'));
    const libraryRows = await this.db
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
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .where(pending);
    const attachmentRows = await this.db
      .select({
        fileId: files.id,
        itemId: topicAttachments.id,
        topicId: topicAttachments.topicId,
        title: topicAttachments.title,
        fileName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      })
      .from(files)
      .innerJoin(topicAttachments, eq(topicAttachments.fileId, files.id))
      .where(pending);
    return [
      ...libraryRows.map((row): PendingUpload => ({ ...row, topicId: null })),
      ...attachmentRows.map((row): PendingUpload => ({ ...row, title: row.title ?? '', folderId: null })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Storage first, then the database in one transaction: if the transaction fails the storage side is rolled back.
  private async begin(
    actor: AuthUser,
    kind: KindRule,
    input: { fileName: string; contentType: string; sizeBytes: number },
    createOwner: (tx: DbTransaction, file: FileRow) => Promise<{ id: string; target: AuditTarget }>,
  ): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const key = `${kind.keyPrefix}/${randomUUID()}`;
    const partCount = partCountFor(input.sizeBytes);
    const uploadId = await this.storage.createMultipartUpload(key, input.contentType);
    try {
      return await this.db.transaction(async (tx) => {
        const [file] = await tx
          .insert(files)
          .values({
            purpose: kind.purpose,
            storageKey: key,
            originalName: sanitizeFileName(input.fileName),
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            uploadId,
            partSize: PART_SIZE,
            partCount,
            uploadedBy: actor.id,
          })
          .returning();
        const owner = await createOwner(tx, file);
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'file.upload_started',
          target: owner.target,
          metadata: { fileId: file.id, sizeBytes: input.sizeBytes, partCount },
        });
        return { itemId: owner.id, fileId: file.id, partSize: PART_SIZE, partCount };
      });
    } catch (error) {
      await this.storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  // The owner of a file, whoever is asking: the library item whose main file it is, or the attachment it was uploaded for.
  // Never a cover (covers have their own routes).
  private async find(fileId: string): Promise<UploadRow | null> {
    const [asItem] = await this.db
      .select({ file: files, item: mediaItems, category: mediaFolders.category })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .where(and(eq(files.id, fileId), ne(files.purpose, 'cover')));
    if (asItem) return { file: asItem.file, owner: { type: 'item', item: asItem.item, category: asItem.category } };
    const [asAttachment] = await this.db
      .select({ file: files, attachment: topicAttachments })
      .from(files)
      .innerJoin(topicAttachments, eq(topicAttachments.fileId, files.id))
      .where(and(eq(files.id, fileId), ne(files.purpose, 'cover')));
    return asAttachment ? { file: asAttachment.file, owner: { type: 'attachment', attachment: asAttachment.attachment } } : null;
  }

  private async load(fileId: string, actor: AuthUser): Promise<UploadRow> {
    const row = await this.find(fileId);
    if (!row) throw new NotFoundException('Upload not found.');
    if (row.file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    return row;
  }

  private viewOf(owner: UploadOwner, actor: AuthUser): Promise<ItemView | AttachmentView> {
    return owner.type === 'item' ? this.items.view(owner.item.id, actor) : this.attachments.view(owner.attachment.id, actor);
  }

  // The object is not in storage any more: either another request finished the job, or the upload was cancelled.
  private async afterVanish(actor: AuthUser, fileId: string): Promise<ItemView | AttachmentView> {
    const row = await this.find(fileId);
    if (!row) throw new NotFoundException(GONE);
    if (row.file.status === 'ready') return this.viewOf(row.owner, actor);
    throw new ConflictException(LOST_UPLOAD);
  }

  // Removes the rows of a still-pending upload (and a library item's cover) and records why. Returns null when someone
  // else already removed it (or the upload finished meanwhile), so a ready item or attachment is never removed.
  private async removePending(
    file: FileRow,
    outcome: { actor: AuthUser; action: AuditAction; metadata: Record<string, unknown> },
  ): Promise<RemovedUpload | null> {
    return this.db.transaction(async (tx) => {
      const removed = await removeUnfinished(tx, file.id);
      if (!removed) return null;
      await this.audit.record(tx, { actor: actorOf(outcome.actor), action: outcome.action, target: removed.target, metadata: outcome.metadata });
      return removed;
    });
  }

  // Storage calls stay outside the transaction and are best effort.
  private async discardRemoved(file: FileRow, removed: RemovedUpload): Promise<void> {
    await discardStoredFile(this.storage, this.logger, file);
    if (removed.cover) await discardStoredFile(this.storage, this.logger, { ...removed.cover, uploadId: null });
  }

  private async fail(actor: AuthUser, row: UploadRow, reason: FailureReason): Promise<never> {
    const removed = await this.removePending(row.file, { actor, action: 'file.upload_failed', metadata: { fileId: row.file.id, reason } });
    if (removed) await this.discardRemoved(row.file, removed);
    throw new UnprocessableEntityException(FAILURE_MESSAGES[reason]);
  }

  private async finish(actor: AuthUser, { file, owner }: UploadRow): Promise<ItemView | AttachmentView> {
    const outcome = await this.db.transaction((tx) =>
      owner.type === 'item' ? this.finishItem(tx, actor, file, owner) : this.finishAttachment(tx, actor, file, owner.attachment),
    );
    if (outcome === 'gone') {
      // Cancelled while the pieces were being joined: the stored object has no owner any more.
      await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
      throw new NotFoundException(GONE);
    }
    return this.viewOf(owner, actor);
  }

  private async finishItem(tx: DbTransaction, actor: AuthUser, file: FileRow, owner: Extract<UploadOwner, { type: 'item' }>): Promise<'gone' | 'done'> {
    const { item, category } = owner;
    // Lock the item row first, as removePending does (it deletes the item row, then the file row): taking the
    // locks in the same order is what keeps a cancel and a finish that overlap from deadlocking.
    const [locked] = await tx.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
    if (!locked) return 'gone';
    if (locked.status === 'ready') return 'done';
    const [{ end }] = await tx
      .select({ end: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
      .from(mediaItems)
      .where(and(eq(mediaItems.folderId, item.folderId), eq(mediaItems.status, 'ready')));
    const now = new Date();
    await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
    await tx.update(mediaItems).set({ status: 'ready', position: end, updatedAt: now }).where(eq(mediaItems.id, item.id));
    const target = { type: category, id: item.id, label: item.title };
    await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
    await this.audit.record(tx, { actor: actorOf(actor), action: 'content.video.added', target, metadata: { folderId: item.folderId, category } });
    return 'done';
  }

  private async finishAttachment(tx: DbTransaction, actor: AuthUser, file: FileRow, attachment: TopicAttachment): Promise<'gone' | 'done'> {
    // The attachment row first, then the file row, exactly as removePending does.
    const [locked] = await tx.select({ status: topicAttachments.status }).from(topicAttachments).where(eq(topicAttachments.id, attachment.id)).for('update');
    if (!locked) return 'gone';
    if (locked.status === 'ready') return 'done';
    const [{ end }] = await tx
      .select({ end: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
      .from(topicAttachments)
      .where(and(eq(topicAttachments.topicId, attachment.topicId), eq(topicAttachments.status, 'ready')));
    const [topic] = await tx.select({ title: topics.title }).from(topics).where(eq(topics.id, attachment.topicId));
    const now = new Date();
    await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
    await tx.update(topicAttachments).set({ status: 'ready', position: end, updatedAt: now }).where(eq(topicAttachments.id, attachment.id));
    const target = { type: 'attachment', id: attachment.id, label: attachment.title ?? '' };
    await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
    await this.audit.record(tx, {
      actor: actorOf(actor),
      action: 'content.attachment.added',
      target,
      metadata: { kind: attachment.kind, source: 'upload', topicId: attachment.topicId, topicTitle: topic.title },
    });
    return 'done';
  }
}
