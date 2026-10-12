import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database } from '../../src/db/db.module';
import { type Lesson, lessons, type Topic, topics } from '../../src/db/schema';
import type { InMemoryStorage } from '../support/in-memory-storage';
import { bearer, type Session } from './auth';
import { pngBytes, uniqueName } from './media';

export interface CourseBody {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessonCount: number;
  topicCount: number;
}

export async function createCourseViaApi(app: INestApplication, session: Session, body: object = {}): Promise<CourseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/courses')
    .set(...bearer(session))
    .send({ title: uniqueName('Course'), ...body })
    .expect(201);
  return res.body;
}

// Sets a real cover on a course through the cover endpoints, the way the web does.
export async function attachCourseCoverViaApi(app: INestApplication, storage: InMemoryStorage, session: Session, courseId: string): Promise<string> {
  const body = pngBytes(100);
  const started = await request(app.getHttpServer())
    .post(`/api/courses/${courseId}/cover`)
    .set(...bearer(session))
    .send({ contentType: 'image/png', sizeBytes: body.length })
    .expect(201);
  storage.putObject(started.body.url, body);
  await request(app.getHttpServer()).post(`/api/courses/${courseId}/cover/${started.body.fileId}/complete`).set(...bearer(session)).expect(200);
  return started.body.fileId;
}

export async function seedLesson(db: Database, courseId: string, createdBy: string, title = uniqueName('Lesson'), position = 0): Promise<Lesson> {
  const [lesson] = await db.insert(lessons).values({ courseId, title, position, createdBy }).returning();
  return lesson;
}

export async function seedTopic(db: Database, lessonId: string, createdBy: string, title = uniqueName('Topic'), position = 0): Promise<Topic> {
  const [topic] = await db.insert(topics).values({ lessonId, title, position, createdBy }).returning();
  return topic;
}
