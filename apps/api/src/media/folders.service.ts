import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { mediaFolders, mediaItems } from '../db/schema';
import { actorOf } from './actor';
import { MEDIA_CATEGORIES, type MediaCategory } from './media-kinds';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';

const NAME_TAKEN = 'A folder with that name already exists.';

export interface FolderView {
  id: string;
  name: string;
  position: number;
  itemCount: number;
  category: MediaCategory;
}

@Injectable()
export class FoldersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(category: MediaCategory, executor: DbExecutor = this.db): Promise<FolderView[]> {
    return executor
      .select({
        id: mediaFolders.id,
        name: mediaFolders.name,
        position: mediaFolders.position,
        itemCount: sql<number>`count(${mediaItems.id}) filter (where ${mediaItems.status} = 'ready')`.mapWith(Number),
        category: mediaFolders.category,
      })
      .from(mediaFolders)
      .leftJoin(mediaItems, eq(mediaItems.folderId, mediaFolders.id))
      .where(eq(mediaFolders.category, category))
      .groupBy(mediaFolders.id)
      .orderBy(asc(mediaFolders.position), asc(mediaFolders.createdAt), asc(mediaFolders.id));
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
      return { id: folder.id, name: folder.name, position: folder.position, itemCount: 0, category };
    });
  }

  rename(actor: AuthUser, id: string, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [folder] = await tx.select().from(mediaFolders).where(eq(mediaFolders.id, id)).for('update');
      if (!folder) throw new NotFoundException('Folder not found.');
      if (folder.name !== name) {
        try {
          await tx.update(mediaFolders).set({ name, updatedAt: new Date() }).where(eq(mediaFolders.id, id));
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
      const view = (await this.list(folder.category, tx)).find((candidate) => candidate.id === id);
      if (!view) throw new NotFoundException('Folder not found.');
      return view;
    });
  }

  reorder(actor: AuthUser, category: MediaCategory, ids: string[]): Promise<FolderView[]> {
    return this.db.transaction(async (tx) => {
      // Locked in id order so two people reordering at once cannot deadlock.
      const locked = await tx
        .select({ id: mediaFolders.id, position: mediaFolders.position, createdAt: mediaFolders.createdAt })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, category))
        .orderBy(asc(mediaFolders.id))
        .for('update');
      const current = [...locked]
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((folder) => folder.id);
      const known = new Set(current);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new ConflictException(ORDER_CHANGED_MESSAGE);
      }
      if (ids.some((id, index) => id !== current[index])) {
        for (const [index, id] of ids.entries()) {
          await tx.update(mediaFolders).set({ position: index, updatedAt: new Date() }).where(eq(mediaFolders.id, id));
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.folder.reordered',
          target: { type: 'category', id: category, label: `${MEDIA_CATEGORIES[category].label} folders` },
          metadata: { category },
        });
      }
      return this.list(category, tx);
    });
  }
}
