import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type AuditChanges, lessons, topics } from '../db/schema';
import { actorOf } from '../media/actor';
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
}

@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}

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
      const [topic] = await tx.select().from(topics).where(eq(topics.id, id)).for('update');
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
      await tx.select({ id: topics.id }).from(topics).where(eq(topics.lessonId, lessonId)).orderBy(asc(topics.id)).for('update');
      const current = (
        await tx
          .select({ id: topics.id })
          .from(topics)
          .where(eq(topics.lessonId, lessonId))
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

  private async view(id: string): Promise<TopicView> {
    const [row] = await this.db
      .select({ topic: topics, courseId: lessons.courseId })
      .from(topics)
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .where(eq(topics.id, id));
    if (!row) throw new NotFoundException(NOT_FOUND);
    return {
      id: row.topic.id,
      lessonId: row.topic.lessonId,
      courseId: row.courseId,
      title: row.topic.title,
      description: row.topic.description,
      position: row.topic.position,
    };
  }
}
