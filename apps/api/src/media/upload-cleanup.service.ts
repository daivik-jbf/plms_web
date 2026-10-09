import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, mediaItems } from '../db/schema';
import { PENDING_UPLOAD_MAX_AGE_MS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { discardStoredFile } from './discard';

const INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Tests call run() directly; a background timer would only add noise to them.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runSafely(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<{ removed: number }> {
    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS);
    const stale = await this.db.select().from(files).where(and(eq(files.status, 'pending'), lt(files.createdAt, cutoff)));
    let removed = 0;
    for (const file of stale) {
      if (await this.expire(file)) {
        removed += 1;
        await discardStoredFile(this.storage, this.logger, file);
      }
    }
    return { removed };
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { removed } = await this.run();
      if (removed > 0) this.logger.log(`Removed ${removed} abandoned upload(s)`);
    } catch (error) {
      this.logger.error(`Cleanup of abandoned uploads failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  // Deletes the rows only if the file is still pending, so a video that finished a moment ago is never touched.
  // The video row goes before the file row, the same order as a cancel and a finish use, so they cannot deadlock.
  private expire(file: FileRow): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (file.purpose === 'video') {
        const [item] = await tx
          .delete(mediaItems)
          .where(and(eq(mediaItems.videoFileId, file.id), eq(mediaItems.status, 'uploading')))
          .returning({ id: mediaItems.id, title: mediaItems.title });
        if (!item) return false;
        await tx.delete(files).where(eq(files.id, file.id));
        await this.audit.record(tx, {
          actor: null,
          action: 'file.upload_failed',
          target: { type: 'video', id: item.id, label: item.title },
          metadata: { fileId: file.id, reason: 'expired' },
        });
        return true;
      }
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: null,
        action: 'file.upload_failed',
        target: { type: 'cover', id: file.id, label: 'a cover image' },
        metadata: { fileId: file.id, reason: 'expired' },
      });
      return true;
    });
  }
}
