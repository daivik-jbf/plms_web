import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type Lesson, lessons } from '../db/schema';
import { actorOf } from '../media/actor';
import { applyOrder } from '../media/reorder';
import type { LessonInput } from './courses.schemas';
import { type CourseTree, CoursesService } from './courses.service';

const NOT_FOUND = 'Lesson not found.';

// Lock order for the course tree: the parent row before its children (course, then lesson, then topic).
@Injectable()
export class LessonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
  ) {}

  async add(actor: AuthUser, courseId: string, input: LessonInput): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      // The course row is locked, so two people adding at once get different positions.
      const course = await this.courses.requireCourse(tx, courseId, true);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${lessons.position}), -1) + 1`.mapWith(Number) })
        .from(lessons)
        .where(eq(lessons.courseId, courseId));
      const [lesson] = await tx.insert(lessons).values({ courseId, title: input.title, position: next, createdBy: actor.id }).returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.lesson.added',
        target: { type: 'lesson', id: lesson.id, label: lesson.title },
        metadata: { courseId, courseTitle: course.title },
      });
    });
    return this.courses.tree(courseId);
  }

  async rename(actor: AuthUser, id: string, input: LessonInput): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      const lesson = await this.requireLesson(tx, id, true);
      if (lesson.title !== input.title) {
        await tx.update(lessons).set({ title: input.title, updatedAt: new Date() }).where(eq(lessons.id, id));
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.lesson.renamed',
          target: { type: 'lesson', id, label: input.title },
          changes: { title: { before: lesson.title, after: input.title } },
          metadata: { courseId: lesson.courseId },
        });
      }
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  async reorder(actor: AuthUser, courseId: string, ids: string[]): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      const course = await this.courses.requireCourse(tx, courseId, true);
      // Locked in id order so two people reordering at once cannot deadlock, then the order is read in SQL.
      await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.id)).for('update');
      const current = (
        await tx
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.courseId, courseId))
          .orderBy(asc(lessons.position), asc(lessons.createdAt), asc(lessons.id))
      ).map((lesson) => lesson.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(lessons).set({ position, updatedAt: new Date() }).where(eq(lessons.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.lesson.reordered',
          target: { type: 'course', id: courseId, label: course.title },
        });
      }
    });
    return this.courses.tree(courseId);
  }

  async requireLesson(executor: DbExecutor, id: string, lock = false): Promise<Lesson> {
    const query = executor.select().from(lessons).where(eq(lessons.id, id));
    const [lesson] = lock ? await query.for('update') : await query;
    if (!lesson) throw new NotFoundException(NOT_FOUND);
    return lesson;
  }
}
