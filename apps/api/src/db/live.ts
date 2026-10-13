import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from './db.module';
import { courses, lessons, type Topic, topics } from './schema';

// A topic is live when neither it, nor its lesson, nor its course is in the Trash. Everything that reads or changes a
// topic or what is attached to it goes through this, so an item in the Trash cannot be reached by its address.
export const topicIsLive = and(isNull(topics.deletedAt), isNull(lessons.deletedAt), isNull(courses.deletedAt));

// The live topic with this id, or undefined. With lock the topic row is locked for the rest of the transaction.
export async function findLiveTopic(executor: DbExecutor, id: string, lock = false): Promise<Topic | undefined> {
  const query = executor
    .select({ topic: topics })
    .from(topics)
    .innerJoin(lessons, eq(lessons.id, topics.lessonId))
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(and(eq(topics.id, id), topicIsLive));
  const [row] = lock ? await query.for('update', { of: topics }) : await query;
  return row?.topic;
}
