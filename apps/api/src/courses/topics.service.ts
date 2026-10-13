import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { findLiveTopic, topicIsLive } from '../db/live';
import { type AuditChanges, courses, files, lessons, type Topic, topics } from '../db/schema';
import { type CoverOwner, type CoverUpload, CoversService } from '../media/covers.service';
import type { CoverStartInput } from '../media/media.schemas';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from '../media/actor';
import { type AttachmentView, AttachmentsService } from '../media/attachments.service';
import { applyOrder } from '../media/reorder';
import type { CreateTopicInput, UpdateTopicInput } from './courses.schemas';
import { type CourseTree, CoursesService } from './courses.service';
import { LessonsService } from './lessons.service';

const NOT_FOUND = 'Topic not found.';

export interface TopicView {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
  // A one-hour link to the cover image, or null.
  coverUrl: string | null;
}

// A topic with the attachments the person may see: every ready one, and their own that are still uploading.
export interface TopicDetail extends TopicView {
  attachments: AttachmentView[];
}

@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly attachments: AttachmentsService,
    private readonly covers: CoversService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async detail(actor: AuthUser, id: string): Promise<TopicDetail> {
    const topic = await this.view(id);
    return { ...topic, attachments: await this.attachments.list(id, actor) };
  }

  async add(actor: AuthUser, lessonId: string, input: CreateTopicInput): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      // The lesson row is locked, so two people adding at once get different positions.
      const lesson = await this.lessons.requireLesson(tx, lessonId, true);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topics.position}), -1) + 1`.mapWith(Number) })
        .from(topics)
        .where(eq(topics.lessonId, lessonId));
      const [topic] = await tx
        .insert(topics)
        .values({ lessonId, title: input.title, description: input.description ?? null, position: next, createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.added',
        target: { type: 'topic', id: topic.id, label: topic.title },
        metadata: { lessonId, lessonTitle: lesson.title, courseId: lesson.courseId },
      });
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  async edit(actor: AuthUser, id: string, input: UpdateTopicInput): Promise<TopicView> {
    await this.db.transaction(async (tx) => {
      const topic = await findLiveTopic(tx, id, true);
      if (!topic) throw new NotFoundException(NOT_FOUND);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== topic.title) changes.title = { before: topic.title, after: input.title };
      if (input.description !== undefined && input.description !== topic.description) {
        changes.description = { before: topic.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(topics).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(topics.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.edited',
        target: { type: 'topic', id, label: input.title ?? topic.title },
        changes,
      });
    });
    return this.view(id);
  }

  async reorder(actor: AuthUser, lessonId: string, ids: string[]): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      const lesson = await this.lessons.requireLesson(tx, lessonId, true);
      const live = and(eq(topics.lessonId, lessonId), isNull(topics.deletedAt));
      await tx.select({ id: topics.id }).from(topics).where(live).orderBy(asc(topics.id)).for('update');
      const current = (
        await tx
          .select({ id: topics.id })
          .from(topics)
          .where(live)
          .orderBy(asc(topics.position), asc(topics.createdAt), asc(topics.id))
      ).map((topic) => topic.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(topics).set({ position, updatedAt: new Date() }).where(eq(topics.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.topic.reordered',
          target: { type: 'lesson', id: lessonId, label: lesson.title },
        });
      }
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  async startCover(actor: AuthUser, id: string, input: CoverStartInput): Promise<CoverUpload> {
    if (!(await findLiveTopic(this.db, id))) throw new NotFoundException(NOT_FOUND);
    return this.covers.newCover(actor, input);
  }

  async completeCover(actor: AuthUser, id: string, fileId: string): Promise<TopicView> {
    const topic = await findLiveTopic(this.db, id);
    if (!topic) throw new NotFoundException(NOT_FOUND);
    await this.covers.setCover(actor, this.coverOwner(topic), fileId);
    return this.view(id);
  }

  private coverOwner(topic: Topic): CoverOwner {
    return {
      id: topic.id,
      title: topic.title,
      coverFileId: topic.coverFileId,
      targetType: 'topic',
      action: 'content.topic.cover_set',
      metadata: { lessonId: topic.lessonId },
      lock: async (tx) => (await tx.select().from(topics).where(eq(topics.id, topic.id)).for('update'))[0] ?? null,
      setCover: async (tx, fileId, at) => {
        await tx.update(topics).set({ coverFileId: fileId, updatedAt: at }).where(eq(topics.id, topic.id));
      },
    };
  }

  // Moves the topic, with its files, to the Trash.
  async remove(actor: AuthUser, id: string): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      const topic = await findLiveTopic(tx, id, true);
      if (!topic) throw new NotFoundException(NOT_FOUND);
      const [lesson] = await tx.select().from(lessons).where(eq(lessons.id, topic.lessonId));
      await tx.update(topics).set({ deletedAt: new Date(), deletedBy: actor.id }).where(eq(topics.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.deleted',
        target: { type: 'topic', id, label: topic.title },
        metadata: { lessonId: lesson.id, lessonTitle: lesson.title, courseId: lesson.courseId },
      });
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  private async view(id: string): Promise<TopicView> {
    const [row] = await this.db
      .select({ topic: topics, courseId: lessons.courseId, cover: files })
      .from(topics)
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .leftJoin(files, eq(files.id, topics.coverFileId))
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .where(and(eq(topics.id, id), topicIsLive));
    if (!row) throw new NotFoundException(NOT_FOUND);
    return {
      id: row.topic.id,
      lessonId: row.topic.lessonId,
      courseId: row.courseId,
      title: row.topic.title,
      description: row.topic.description,
      position: row.topic.position,
      coverUrl:
        row.cover && row.cover.status === 'ready'
          ? await this.storage.presignGet(row.cover.storageKey, LINK_TTL_SECONDS, { contentType: row.cover.contentType })
          : null,
    };
  }
}
