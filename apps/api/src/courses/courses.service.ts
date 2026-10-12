import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type AuditChanges, type Course, courses, type FileRow, files, lessons, topicAttachments, topics, users } from '../db/schema';
import { actorOf } from '../media/actor';
import { type CoverOwner, type CoverUpload, CoversService } from '../media/covers.service';
import type { CoverStartInput } from '../media/media.schemas';
import { applyOrder } from '../media/reorder';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import type { CreateCourseInput, UpdateCourseInput } from './courses.schemas';

const NOT_FOUND = 'Course not found.';

interface CourseBase {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface CourseView extends CourseBase {
  lessonCount: number;
  topicCount: number;
}

export interface TopicSummary {
  id: string;
  title: string;
  position: number;
  // Ready attachments only: one that is still uploading is not part of the topic yet.
  attachmentCount: number;
}

export interface LessonView {
  id: string;
  title: string;
  position: number;
  topics: TopicSummary[];
}

// The whole course in one answer: its lessons in order, each with its topics in order.
export interface CourseTree extends CourseBase {
  lessons: LessonView[];
}

interface CourseRow {
  course: Course;
  cover: FileRow | null;
  creator: { id: string; name: string };
}

@Injectable()
export class CoursesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly covers: CoversService,
  ) {}

  async list(): Promise<CourseView[]> {
    return this.views(await this.rows(this.db, undefined));
  }

  async create(actor: AuthUser, input: CreateCourseInput): Promise<CourseView> {
    const id = await this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${courses.position}), -1) + 1`.mapWith(Number) })
        .from(courses);
      const [course] = await tx
        .insert(courses)
        .values({ title: input.title, description: input.description ?? null, position: next, createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.course.created',
        target: { type: 'course', id: course.id, label: course.title },
      });
      return course.id;
    });
    const [view] = await this.views(await this.rows(this.db, eq(courses.id, id)));
    return view;
  }

  async reorder(actor: AuthUser, ids: string[]): Promise<CourseView[]> {
    await this.db.transaction(async (tx) => {
      // Locked in id order so two people reordering at once cannot deadlock, then the order is read in SQL.
      await tx.select({ id: courses.id }).from(courses).orderBy(asc(courses.id)).for('update');
      const current = (
        await tx.select({ id: courses.id }).from(courses).orderBy(asc(courses.position), asc(courses.createdAt), asc(courses.id))
      ).map((course) => course.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(courses).set({ position, updatedAt: new Date() }).where(eq(courses.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.course.reordered',
          target: { type: 'courses', id: 'courses', label: 'Courses' },
        });
      }
    });
    return this.list();
  }

  async tree(id: string, executor: DbExecutor = this.db): Promise<CourseTree> {
    const [row] = await this.rows(executor, eq(courses.id, id));
    if (!row) throw new NotFoundException(NOT_FOUND);
    const lessonRows = await executor
      .select()
      .from(lessons)
      .where(eq(lessons.courseId, id))
      .orderBy(asc(lessons.position), asc(lessons.createdAt), asc(lessons.id));
    const topicRows =
      lessonRows.length === 0
        ? []
        : await executor
            .select()
            .from(topics)
            .where(
              inArray(
                topics.lessonId,
                lessonRows.map((lesson) => lesson.id),
              ),
            )
            .orderBy(asc(topics.position), asc(topics.createdAt), asc(topics.id));
    const attachmentCounts =
      topicRows.length === 0
        ? []
        : await executor
            .select({ topicId: topicAttachments.topicId, total: count() })
            .from(topicAttachments)
            .where(
              and(
                inArray(
                  topicAttachments.topicId,
                  topicRows.map((topic) => topic.id),
                ),
                eq(topicAttachments.status, 'ready'),
              ),
            )
            .groupBy(topicAttachments.topicId);
    const countOf = new Map(attachmentCounts.map((entry) => [entry.topicId, entry.total]));
    return {
      ...(await this.toBase(row)),
      lessons: lessonRows.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        topics: topicRows
          .filter((topic) => topic.lessonId === lesson.id)
          .map((topic) => ({ id: topic.id, title: topic.title, position: topic.position, attachmentCount: countOf.get(topic.id) ?? 0 })),
      })),
    };
  }

  async update(actor: AuthUser, id: string, input: UpdateCourseInput): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      const course = await this.requireCourse(tx, id, true);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== course.title) changes.title = { before: course.title, after: input.title };
      if (input.description !== undefined && input.description !== course.description) {
        changes.description = { before: course.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(courses).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(courses.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.course.edited',
        target: { type: 'course', id, label: input.title ?? course.title },
        changes,
      });
    });
    return this.tree(id);
  }

  async startCover(actor: AuthUser, id: string, input: CoverStartInput): Promise<CoverUpload> {
    await this.requireCourse(this.db, id);
    return this.covers.newCover(actor, input);
  }

  async completeCover(actor: AuthUser, id: string, fileId: string): Promise<CourseTree> {
    const course = await this.requireCourse(this.db, id);
    await this.covers.setCover(actor, this.coverOwner(course), fileId);
    return this.tree(id);
  }

  async requireCourse(executor: DbExecutor, id: string, lock = false): Promise<Course> {
    const query = executor.select().from(courses).where(eq(courses.id, id));
    const [course] = lock ? await query.for('update') : await query;
    if (!course) throw new NotFoundException(NOT_FOUND);
    return course;
  }

  private coverOwner(course: Course): CoverOwner {
    return {
      id: course.id,
      title: course.title,
      coverFileId: course.coverFileId,
      targetType: 'course',
      action: 'content.course.cover_set',
      metadata: {},
      lock: async (tx) => (await tx.select().from(courses).where(eq(courses.id, course.id)).for('update'))[0] ?? null,
      setCover: async (tx, fileId, at) => {
        await tx.update(courses).set({ coverFileId: fileId, updatedAt: at }).where(eq(courses.id, course.id));
      },
    };
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<CourseRow[]> {
    return executor
      .select({ course: courses, cover: files, creator: { id: users.id, name: users.name } })
      .from(courses)
      .leftJoin(files, eq(files.id, courses.coverFileId))
      .innerJoin(users, eq(users.id, courses.createdBy))
      .where(where)
      .orderBy(asc(courses.position), asc(courses.createdAt), asc(courses.id));
  }

  // The lesson and topic counts of the courses, each from one grouped query.
  private async views(rows: CourseRow[]): Promise<CourseView[]> {
    const ids = rows.map((row) => row.course.id);
    const lessonCounts =
      ids.length === 0
        ? []
        : await this.db.select({ courseId: lessons.courseId, total: count() }).from(lessons).where(inArray(lessons.courseId, ids)).groupBy(lessons.courseId);
    const topicCounts =
      ids.length === 0
        ? []
        : await this.db
            .select({ courseId: lessons.courseId, total: count() })
            .from(topics)
            .innerJoin(lessons, eq(lessons.id, topics.lessonId))
            .where(inArray(lessons.courseId, ids))
            .groupBy(lessons.courseId);
    const lessonsOf = new Map(lessonCounts.map((entry) => [entry.courseId, entry.total]));
    const topicsOf = new Map(topicCounts.map((entry) => [entry.courseId, entry.total]));
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.toBase(row)),
        lessonCount: lessonsOf.get(row.course.id) ?? 0,
        topicCount: topicsOf.get(row.course.id) ?? 0,
      })),
    );
  }

  private async toBase(row: CourseRow): Promise<CourseBase> {
    const coverUrl =
      row.cover && row.cover.status === 'ready'
        ? await this.storage.presignGet(row.cover.storageKey, LINK_TTL_SECONDS, { contentType: row.cover.contentType })
        : null;
    return {
      id: row.course.id,
      title: row.course.title,
      description: row.course.description,
      position: row.course.position,
      coverUrl,
      createdBy: row.creator,
      createdAt: row.course.createdAt,
    };
  }
}
