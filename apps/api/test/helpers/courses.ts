import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database, DbTransaction } from '../../src/db/db.module';
import { files, type Lesson, lessons, topicAttachments, type Topic, topics } from '../../src/db/schema';
import type { InMemoryStorage } from '../support/in-memory-storage';
import { bearer, type Session } from './auth';
import { completeViaApi, m4aBytes, mp4Bytes, pdfBytes, pngBytes, putPieces, type StartedUpload, uniqueName } from './media';

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

// Runs `start` (a request) while a transaction holds the lock taken by `lock`, and says whether the request had finished
// before the lock was released. A request that takes the same lock must wait: this pins that it does.
export async function whileHolding<T>(
  db: Database,
  lock: (tx: DbTransaction) => PromiseLike<unknown>,
  start: () => PromiseLike<T>,
): Promise<{ result: T; finishedWhileHeld: boolean }> {
  const state: { pending?: Promise<T>; finished: boolean; finishedWhileHeld: boolean } = { finished: false, finishedWhileHeld: false };
  await db.transaction(async (tx) => {
    await lock(tx);
    state.pending = Promise.resolve(start()).then((value) => {
      state.finished = true;
      return value;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    state.finishedWhileHeld = state.finished;
  });
  return { result: await (state.pending as Promise<T>), finishedWhileHeld: state.finishedWhileHeld };
}

export interface TreeBody {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessons: { id: string; title: string; position: number; topics: { id: string; title: string; position: number; attachmentCount: number }[] }[];
}

export async function addLessonViaApi(app: INestApplication, session: Session, courseId: string, title = uniqueName('Lesson')): Promise<TreeBody> {
  const res = await request(app.getHttpServer()).post(`/api/courses/${courseId}/lessons`).set(...bearer(session)).send({ title }).expect(201);
  return res.body;
}

export async function addTopicViaApi(app: INestApplication, session: Session, lessonId: string, body: object = {}): Promise<TreeBody> {
  const res = await request(app.getHttpServer())
    .post(`/api/lessons/${lessonId}/topics`)
    .set(...bearer(session))
    .send({ title: uniqueName('Topic'), ...body })
    .expect(201);
  return res.body;
}

const SEED_FILES = {
  video: { prefix: 'videos', contentType: 'video/mp4', bytes: mp4Bytes },
  audio: { prefix: 'audio', contentType: 'audio/mp4', bytes: m4aBytes },
  pdf: { prefix: 'documents', contentType: 'application/pdf', bytes: pdfBytes },
  image: { prefix: 'images', contentType: 'image/png', bytes: pngBytes },
} as const;

export interface SeedAttachmentOptions {
  topicId: string;
  createdBy: string;
  kind?: keyof typeof SEED_FILES;
  title?: string;
  status?: 'uploading' | 'ready';
  position?: number;
  sizeBytes?: number;
  durationSeconds?: number | null;
  // A library item to follow instead of an uploaded file.
  libraryItemId?: string;
  // The attachment's own title; null (the default for a library attachment) follows the item's title.
  libraryTitle?: string | null;
  storage?: InMemoryStorage; // when given, the bytes of a ready uploaded file are put into it
}

// An attachment straight in the database: an uploaded file (ready or still uploading) or a library item.
export async function seedAttachment(db: Database, options: SeedAttachmentOptions) {
  const status = options.status ?? 'ready';
  const kind = options.kind ?? 'pdf';
  if (options.libraryItemId) {
    const [row] = await db
      .insert(topicAttachments)
      .values({
        topicId: options.topicId,
        position: options.position ?? 0,
        kind,
        title: options.libraryTitle ?? null,
        libraryItemId: options.libraryItemId,
        status: 'ready',
        createdBy: options.createdBy,
      })
      .returning();
    return { attachmentId: row.id, fileId: null, storageKey: null };
  }
  const seed = SEED_FILES[kind];
  const sizeBytes = options.sizeBytes ?? 64;
  const storageKey = `${seed.prefix}/${randomUUID()}`;
  const [file] = await db
    .insert(files)
    .values({
      purpose: kind,
      storageKey,
      originalName: `seed.${kind}`,
      contentType: seed.contentType,
      sizeBytes,
      status: status === 'ready' ? 'ready' : 'pending',
      uploadId: status === 'ready' ? null : randomUUID(),
      partSize: status === 'ready' ? null : 16_777_216,
      partCount: status === 'ready' ? null : 1,
      uploadedBy: options.createdBy,
      completedAt: status === 'ready' ? new Date() : null,
    })
    .returning();
  if (status === 'ready') options.storage?.seed(storageKey, seed.bytes(sizeBytes), seed.contentType);
  const [row] = await db
    .insert(topicAttachments)
    .values({
      topicId: options.topicId,
      position: options.position ?? 0,
      kind,
      title: options.title ?? `Attachment ${randomUUID().slice(0, 8)}`,
      fileId: file.id,
      durationSeconds: options.durationSeconds ?? null,
      status,
      createdBy: options.createdBy,
    })
    .returning();
  return { attachmentId: row.id, fileId: file.id, storageKey };
}

export async function startAttachmentUploadViaApi(
  app: INestApplication,
  session: Session,
  topicId: string,
  overrides: Record<string, unknown> = {},
): Promise<StartedUpload> {
  const res = await request(app.getHttpServer())
    .post(`/api/topics/${topicId}/attachments/uploads`)
    .set(...bearer(session))
    .send({ fileName: 'Exit map.pdf', contentType: 'application/pdf', sizeBytes: 100, ...overrides })
    .expect(201);
  return res.body;
}

// The happy path end to end for an attachment (a PDF unless the body and overrides say otherwise). The declared size
// defaults to the real size. `itemId` in the answer is the attachment's id.
export async function uploadAttachment(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  topicId: string,
  body: Uint8Array = pdfBytes(100),
  overrides: Record<string, unknown> = {},
) {
  const started = await startAttachmentUploadViaApi(app, session, topicId, { sizeBytes: body.length, ...overrides });
  const parts = await putPieces(app, storage, session, started.fileId, body);
  const res = await completeViaApi(app, session, started.fileId, parts);
  return { ...started, parts, res };
}
