import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database } from '../../src/db/db.module';
import { files, type MediaFolder, mediaFolders, mediaItems, type Role, type User } from '../../src/db/schema';
import { PART_SIZE } from '../../src/storage/storage.constants';
import type { InMemoryStorage } from '../support/in-memory-storage';
import { bearer, loginMobile, type Session } from './auth';
import { createUser } from './users';

export async function signIn(app: INestApplication, db: Database, role: Role = 'staff'): Promise<{ user: User; session: Session }> {
  const user = await createUser(db, { role });
  return { user, session: await loginMobile(app, user.email) };
}

export const uniqueName = (prefix = 'Folder'): string => `${prefix} ${randomUUID().slice(0, 8)}`;

export async function createFolderViaApi(
  app: INestApplication,
  session: Session,
  name = uniqueName(),
): Promise<{ id: string; name: string; position: number; itemCount: number }> {
  const res = await request(app.getHttpServer()).post('/api/media/videos/folders').set(...bearer(session)).send({ name }).expect(201);
  return res.body;
}

export async function seedFolder(db: Database, createdBy: string, name = uniqueName()): Promise<MediaFolder> {
  const [folder] = await db.insert(mediaFolders).values({ category: 'video', name, position: 0, createdBy }).returning();
  return folder;
}

const bytes = (size: number, start: number[]): Uint8Array => {
  const out = new Uint8Array(Math.max(size, start.length)).fill(7);
  out.set(start);
  return out;
};

// The first bytes the server checks for, followed by filler.
export const mp4Bytes = (size = 64): Uint8Array => bytes(size, [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
export const jpegBytes = (size = 64): Uint8Array => bytes(size, [0xff, 0xd8, 0xff, 0xe0]);
export const pngBytes = (size = 64): Uint8Array => bytes(size, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const webpBytes = (size = 64): Uint8Array => bytes(size, [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

export interface SeedItemOptions {
  folderId: string;
  createdBy: string;
  title?: string;
  description?: string | null;
  status?: 'uploading' | 'ready';
  sizeBytes?: number;
  position?: number;
  durationSeconds?: number | null;
  storage?: InMemoryStorage; // when given, the video and cover bytes are put into it
  withCover?: boolean;
}

export async function seedItem(db: Database, options: SeedItemOptions) {
  const status = options.status ?? 'ready';
  const storageKey = `videos/${randomUUID()}`;
  const bytesToStore = mp4Bytes(options.sizeBytes ?? 64);
  const [video] = await db
    .insert(files)
    .values({
      purpose: 'video',
      storageKey,
      originalName: 'seed.mp4',
      contentType: 'video/mp4',
      sizeBytes: options.sizeBytes ?? 64,
      status: status === 'ready' ? 'ready' : 'pending',
      uploadId: status === 'ready' ? null : randomUUID(),
      partSize: status === 'ready' ? null : 16_777_216,
      partCount: status === 'ready' ? null : 1,
      uploadedBy: options.createdBy,
      completedAt: status === 'ready' ? new Date() : null,
    })
    .returning();
  if (status === 'ready') options.storage?.seed(storageKey, bytesToStore, 'video/mp4');
  let coverFileId: string | null = null;
  if (options.withCover) {
    const coverKey = `covers/${randomUUID()}`;
    const [cover] = await db
      .insert(files)
      .values({ purpose: 'cover', storageKey: coverKey, originalName: 'cover', contentType: 'image/png', sizeBytes: 64, status: 'ready', uploadedBy: options.createdBy, completedAt: new Date() })
      .returning();
    options.storage?.seed(coverKey, pngBytes(), 'image/png');
    coverFileId = cover.id;
  }
  const [item] = await db
    .insert(mediaItems)
    .values({
      folderId: options.folderId,
      title: options.title ?? `Video ${randomUUID().slice(0, 8)}`,
      description: options.description ?? null,
      position: options.position ?? 0,
      videoFileId: video.id,
      coverFileId,
      durationSeconds: options.durationSeconds ?? null,
      status,
      createdBy: options.createdBy,
    })
    .returning();
  return { itemId: item.id, fileId: video.id, storageKey, coverFileId };
}

export interface StartedUpload {
  itemId: string;
  fileId: string;
  partSize: number;
  partCount: number;
}

export async function startUploadViaApi(
  app: INestApplication,
  session: Session,
  folderId: string,
  overrides: Record<string, unknown> = {},
): Promise<StartedUpload> {
  const res = await request(app.getHttpServer())
    .post('/api/media/uploads')
    .set(...bearer(session))
    .send({ folderId, title: uniqueName('Video'), fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 100, ...overrides })
    .expect(201);
  return res.body;
}

// Asks for piece links and "uploads" the pieces to the in-memory storage; returns the receipts.
export async function putPieces(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  fileId: string,
  body: Uint8Array,
  only?: number[],
): Promise<{ partNumber: number; etag: string }[]> {
  const count = Math.max(1, Math.ceil(body.length / PART_SIZE));
  const numbers = only ?? Array.from({ length: count }, (_, index) => index + 1);
  const receipts: { partNumber: number; etag: string }[] = [];
  for (let start = 0; start < numbers.length; start += 16) {
    const batch = numbers.slice(start, start + 16);
    const res = await request(app.getHttpServer())
      .post(`/api/media/uploads/${fileId}/part-urls`)
      .set(...bearer(session))
      .send({ partNumbers: batch })
      .expect(200);
    for (const partNumber of batch) {
      const slice = body.subarray((partNumber - 1) * PART_SIZE, partNumber * PART_SIZE);
      receipts.push({ partNumber, etag: storage.putPart(res.body.urls[String(partNumber)], slice).etag });
    }
  }
  return receipts;
}

export const completeViaApi = (app: INestApplication, session: Session, fileId: string, parts: { partNumber: number; etag: string }[]) =>
  request(app.getHttpServer()).post(`/api/media/uploads/${fileId}/complete`).set(...bearer(session)).send({ parts });

// The happy path end to end. The declared size defaults to the real size.
export async function uploadVideo(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  folderId: string,
  body: Uint8Array = mp4Bytes(100),
  overrides: Record<string, unknown> = {},
) {
  const started = await startUploadViaApi(app, session, folderId, { sizeBytes: body.length, ...overrides });
  const parts = await putPieces(app, storage, session, started.fileId, body);
  const res = await completeViaApi(app, session, started.fileId, parts);
  return { ...started, parts, res };
}

// Attaches a real cover to an item through the cover endpoints, the way the web does before it sends the pieces.
export async function attachCoverViaApi(app: INestApplication, storage: InMemoryStorage, session: Session, itemId: string): Promise<string> {
  const http = () => request(app.getHttpServer());
  const body = pngBytes(100);
  const started = await http().post(`/api/media/items/${itemId}/cover`).set(...bearer(session)).send({ contentType: 'image/png', sizeBytes: body.length }).expect(201);
  storage.putObject(started.body.url, body);
  await http().post(`/api/media/items/${itemId}/cover/${started.body.fileId}/complete`).set(...bearer(session)).expect(200);
  return started.body.fileId;
}
