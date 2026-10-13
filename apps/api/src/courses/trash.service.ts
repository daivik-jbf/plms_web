import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { courses, type FileRow, files, lessons, mediaItems, topicAttachments, topics, users } from '../db/schema';
import { actorOf } from '../media/actor';
import { discardStoredFile } from '../media/discard';
import { STORAGE, type StoragePort } from '../storage/storage.port';

export const TRASH_TYPES = ['course', 'lesson', 'topic', 'attachment'] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export interface TrashEntry {
  type: TrashType;
  id: string;
  title: string;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
  // Where it was: a lesson names its course, a topic its lesson and course.
  courseTitle: string | null;
  lessonTitle: string | null;
  topicTitle: string | null;
  // What goes with it (those not in the Trash themselves): a course its lessons and topics, a lesson its topics.
  lessonCount: number | null;
  topicCount: number | null;
}

const NOT_IN_TRASH = 'That is not in the Trash.';

// The Trash of the course tree. An item is listed when it was deleted itself and nothing above it is in the Trash: what is
// under a deleted course comes back with it, and cannot be restored or deleted for good on its own.
@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TrashEntry[]> {
    const trashedCourses = await this.db
      .select({ course: courses, by: { id: users.id, name: users.name } })
      .from(courses)
      .leftJoin(users, eq(users.id, courses.deletedBy))
      .where(isNotNull(courses.deletedAt));
    const trashedLessons = await this.db
      .select({ lesson: lessons, courseTitle: courses.title, by: { id: users.id, name: users.name } })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .leftJoin(users, eq(users.id, lessons.deletedBy))
      .where(and(isNotNull(lessons.deletedAt), isNull(courses.deletedAt)));
    const trashedTopics = await this.db
      .select({ topic: topics, lessonTitle: lessons.title, courseTitle: courses.title, by: { id: users.id, name: users.name } })
      .from(topics)
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .leftJoin(users, eq(users.id, topics.deletedBy))
      .where(and(isNotNull(topics.deletedAt), isNull(lessons.deletedAt), isNull(courses.deletedAt)));

    const trashedAttachments = await this.db
      .select({ attachment: topicAttachments, itemTitle: mediaItems.title, topicTitle: topics.title, lessonTitle: lessons.title, courseTitle: courses.title, by: { id: users.id, name: users.name } })
      .from(topicAttachments)
      .innerJoin(topics, eq(topics.id, topicAttachments.topicId))
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .leftJoin(mediaItems, eq(mediaItems.id, topicAttachments.libraryItemId))
      .leftJoin(users, eq(users.id, topicAttachments.deletedBy))
      .where(and(isNotNull(topicAttachments.deletedAt), isNull(topics.deletedAt), isNull(lessons.deletedAt), isNull(courses.deletedAt)));

    const lessonCounts = await this.countByCourse(trashedCourses.map((row) => row.course.id));
    const topicCountsOfCourse = await this.topicCountByCourse(trashedCourses.map((row) => row.course.id));
    const topicCountsOfLesson = await this.topicCountByLesson(trashedLessons.map((row) => row.lesson.id));

    const entries: TrashEntry[] = [
      ...trashedCourses.map(
        (row): TrashEntry => ({
          type: 'course',
          id: row.course.id,
          title: row.course.title,
          deletedAt: row.course.deletedAt as Date,
          deletedBy: row.by,
          courseTitle: null,
          lessonTitle: null,
          topicTitle: null,
          lessonCount: lessonCounts.get(row.course.id) ?? 0,
          topicCount: topicCountsOfCourse.get(row.course.id) ?? 0,
        }),
      ),
      ...trashedLessons.map(
        (row): TrashEntry => ({
          type: 'lesson',
          id: row.lesson.id,
          title: row.lesson.title,
          deletedAt: row.lesson.deletedAt as Date,
          deletedBy: row.by,
          courseTitle: row.courseTitle,
          lessonTitle: null,
          topicTitle: null,
          lessonCount: null,
          topicCount: topicCountsOfLesson.get(row.lesson.id) ?? 0,
        }),
      ),
      ...trashedTopics.map(
        (row): TrashEntry => ({
          type: 'topic',
          id: row.topic.id,
          title: row.topic.title,
          deletedAt: row.topic.deletedAt as Date,
          deletedBy: row.by,
          courseTitle: row.courseTitle,
          lessonTitle: row.lessonTitle,
          topicTitle: null,
          lessonCount: null,
          topicCount: null,
        }),
      ),
      ...trashedAttachments.map(
        (row): TrashEntry => ({
          type: 'attachment',
          id: row.attachment.id,
          title: row.attachment.title ?? row.itemTitle ?? '',
          deletedAt: row.attachment.deletedAt as Date,
          deletedBy: row.by,
          courseTitle: row.courseTitle,
          lessonTitle: row.lessonTitle,
          topicTitle: row.topicTitle,
          lessonCount: null,
          topicCount: null,
        }),
      ),
    ];
    return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  }

  async restore(actor: AuthUser, type: TrashType, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (type === 'course') {
        const course = await this.lockCourse(tx, id);
        if (!course.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${courses.position}), -1) + 1`.mapWith(Number) }).from(courses);
        await tx.update(courses).set({ deletedAt: null, deletedBy: null, position: next, updatedAt: new Date() }).where(eq(courses.id, id));
        await this.audit.record(tx, { actor: actorOf(actor), action: 'content.course.restored', target: { type: 'course', id, label: course.title } });
        return;
      }
      if (type === 'lesson') {
        const { lesson, course } = await this.lockLesson(tx, id);
        if (!lesson.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        if (course.deletedAt) throw new ConflictException(`Restore the course "${course.title}" first.`);
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${lessons.position}), -1) + 1`.mapWith(Number) })
          .from(lessons)
          .where(eq(lessons.courseId, course.id));
        await tx.update(lessons).set({ deletedAt: null, deletedBy: null, position: next, updatedAt: new Date() }).where(eq(lessons.id, id));
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.lesson.restored',
          target: { type: 'lesson', id, label: lesson.title },
          metadata: { courseId: course.id, courseTitle: course.title },
        });
        return;
      }
      if (type === 'attachment') {
        const { attachment, topic, lesson, course } = await this.lockAttachment(tx, id);
        if (!attachment.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        if (course.deletedAt) throw new ConflictException(`Restore the course "${course.title}" first.`);
        if (lesson.deletedAt) throw new ConflictException(`Restore the lesson "${lesson.title}" first.`);
        if (topic.deletedAt) throw new ConflictException(`Restore the topic "${topic.title}" first.`);
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
          .from(topicAttachments)
          .where(eq(topicAttachments.topicId, topic.id));
        await tx.update(topicAttachments).set({ deletedAt: null, deletedBy: null, position: next, updatedAt: new Date() }).where(eq(topicAttachments.id, id));
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.attachment.restored',
          target: { type: 'attachment', id, label: attachment.title ?? '' },
          metadata: { kind: attachment.kind, topicId: topic.id, topicTitle: topic.title },
        });
        return;
      }
      const { topic, lesson, course } = await this.lockTopic(tx, id);
      if (!topic.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
      if (course.deletedAt) throw new ConflictException(`Restore the course "${course.title}" first.`);
      if (lesson.deletedAt) throw new ConflictException(`Restore the lesson "${lesson.title}" first.`);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topics.position}), -1) + 1`.mapWith(Number) })
        .from(topics)
        .where(eq(topics.lessonId, lesson.id));
      await tx.update(topics).set({ deletedAt: null, deletedBy: null, position: next, updatedAt: new Date() }).where(eq(topics.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.restored',
        target: { type: 'topic', id, label: topic.title },
        metadata: { lessonId: lesson.id, lessonTitle: lesson.title, courseId: course.id },
      });
    });
  }

  // Removes the item and everything under it from the database, then its stored files. Only what is in the Trash can go.
  async purge(actor: AuthUser, type: TrashType, id: string): Promise<void> {
    const stored = await this.db.transaction(async (tx) => {
      if (type === 'attachment') return this.purgeAttachment(tx, actor, id);
      let topicIds: string[];
      let lessonIds: string[] = [];
      const coverFileIds: (string | null)[] = [];
      let label: string;
      let metadata: Record<string, unknown> = {};

      if (type === 'course') {
        const course = await this.lockCourse(tx, id);
        if (!course.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        label = course.title;
        coverFileIds.push(course.coverFileId);
        lessonIds = (await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, id))).map((row) => row.id);
        topicIds = await this.topicIdsOf(tx, lessonIds);
      } else if (type === 'lesson') {
        const { lesson, course } = await this.lockLesson(tx, id);
        if (!lesson.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        label = lesson.title;
        metadata = { courseId: course.id, courseTitle: course.title };
        lessonIds = [id];
        topicIds = await this.topicIdsOf(tx, lessonIds);
      } else {
        const { topic, lesson, course } = await this.lockTopic(tx, id);
        if (!topic.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
        label = topic.title;
        metadata = { lessonId: lesson.id, lessonTitle: lesson.title, courseId: course.id };
        topicIds = [id];
      }

      // The files that belong to the attachments, and every cover: removed with their rows (a library attachment owns no file).
      if (lessonIds.length > 0) {
        const rows = await tx.select({ coverFileId: lessons.coverFileId }).from(lessons).where(inArray(lessons.id, lessonIds));
        coverFileIds.push(...rows.map((row) => row.coverFileId));
      }
      if (topicIds.length > 0) {
        const rows = await tx.select({ coverFileId: topics.coverFileId }).from(topics).where(inArray(topics.id, topicIds));
        coverFileIds.push(...rows.map((row) => row.coverFileId));
      }
      const attachmentFiles =
        topicIds.length === 0
          ? []
          : await tx
              .delete(topicAttachments)
              .where(inArray(topicAttachments.topicId, topicIds))
              .returning({ fileId: topicAttachments.fileId, coverFileId: topicAttachments.coverFileId });
      if (topicIds.length > 0) await tx.delete(topics).where(inArray(topics.id, topicIds));
      if (lessonIds.length > 0) await tx.delete(lessons).where(inArray(lessons.id, lessonIds));
      if (type === 'course') await tx.delete(courses).where(eq(courses.id, id));

      const fileIds = [...attachmentFiles.flatMap((row) => [row.fileId, row.coverFileId]), ...coverFileIds].filter((fileId): fileId is string => fileId !== null);
      const removedFiles: Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>[] =
        fileIds.length === 0
          ? []
          : await tx.delete(files).where(inArray(files.id, fileIds)).returning({ id: files.id, storageKey: files.storageKey, uploadId: files.uploadId });

      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: `content.${type}.purged`,
        target: { type, id, label },
        metadata,
      });
      return removedFiles;
    });
    // The database is the source of truth: a stored object that cannot be removed now is only waste.
    await Promise.all(stored.map((file) => discardStoredFile(this.storage, this.logger, file)));
  }

  // An attachment: its row, then its own file and cover (a library attachment has no file of its own: the item stays).
  private async purgeAttachment(tx: DbTransaction, actor: AuthUser, id: string): Promise<Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>[]> {
    const { attachment, topic } = await this.lockAttachment(tx, id);
    if (!attachment.deletedAt) throw new NotFoundException(NOT_IN_TRASH);
    await tx.delete(topicAttachments).where(eq(topicAttachments.id, id));
    const fileIds = [attachment.fileId, attachment.coverFileId].filter((fileId): fileId is string => fileId !== null);
    const removed: Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>[] =
      fileIds.length === 0 ? [] : await tx.delete(files).where(inArray(files.id, fileIds)).returning({ id: files.id, storageKey: files.storageKey, uploadId: files.uploadId });
    await this.audit.record(tx, {
      actor: actorOf(actor),
      action: 'content.attachment.purged',
      target: { type: 'attachment', id, label: attachment.title ?? '' },
      metadata: { kind: attachment.kind, topicId: topic.id, topicTitle: topic.title },
    });
    return removed;
  }

  // The rows are locked from the top down (course, lesson, topic), the order every other change uses.
  private async lockCourse(tx: DbTransaction, id: string) {
    const [course] = await tx.select().from(courses).where(eq(courses.id, id)).for('update');
    if (!course) throw new NotFoundException(NOT_IN_TRASH);
    return course;
  }

  private async lockLesson(tx: DbTransaction, id: string) {
    const [found] = await tx.select({ courseId: lessons.courseId }).from(lessons).where(eq(lessons.id, id));
    if (!found) throw new NotFoundException(NOT_IN_TRASH);
    const course = await this.lockCourse(tx, found.courseId);
    const [lesson] = await tx.select().from(lessons).where(eq(lessons.id, id)).for('update');
    if (!lesson) throw new NotFoundException(NOT_IN_TRASH);
    return { lesson, course };
  }

  private async lockTopic(tx: DbTransaction, id: string) {
    const [found] = await tx.select({ lessonId: topics.lessonId }).from(topics).where(eq(topics.id, id));
    if (!found) throw new NotFoundException(NOT_IN_TRASH);
    const { lesson, course } = await this.lockLesson(tx, found.lessonId);
    const [topic] = await tx.select().from(topics).where(eq(topics.id, id)).for('update');
    if (!topic) throw new NotFoundException(NOT_IN_TRASH);
    return { topic, lesson, course };
  }

  private async lockAttachment(tx: DbTransaction, id: string) {
    const [found] = await tx.select({ topicId: topicAttachments.topicId }).from(topicAttachments).where(eq(topicAttachments.id, id));
    if (!found) throw new NotFoundException(NOT_IN_TRASH);
    const { topic, lesson, course } = await this.lockTopic(tx, found.topicId);
    const [attachment] = await tx.select().from(topicAttachments).where(eq(topicAttachments.id, id)).for('update');
    if (!attachment) throw new NotFoundException(NOT_IN_TRASH);
    return { attachment, topic, lesson, course };
  }

  private async topicIdsOf(tx: DbTransaction, lessonIds: string[]): Promise<string[]> {
    if (lessonIds.length === 0) return [];
    return (await tx.select({ id: topics.id }).from(topics).where(inArray(topics.lessonId, lessonIds))).map((row) => row.id);
  }

  private async countByCourse(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ courseId: lessons.courseId, total: count() })
      .from(lessons)
      .where(and(inArray(lessons.courseId, ids), isNull(lessons.deletedAt)))
      .groupBy(lessons.courseId);
    return new Map(rows.map((row) => [row.courseId, row.total]));
  }

  private async topicCountByCourse(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ courseId: lessons.courseId, total: count() })
      .from(topics)
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .where(and(inArray(lessons.courseId, ids), isNull(lessons.deletedAt), isNull(topics.deletedAt)))
      .groupBy(lessons.courseId);
    return new Map(rows.map((row) => [row.courseId, row.total]));
  }

  private async topicCountByLesson(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ lessonId: topics.lessonId, total: count() })
      .from(topics)
      .where(and(inArray(topics.lessonId, ids), isNull(topics.deletedAt)))
      .groupBy(topics.lessonId);
    return new Map(rows.map((row) => [row.lessonId, row.total]));
  }
}

