import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database } from '../../src/db/db.module';
import { type MediaFolder, mediaFolders, type Role, type User } from '../../src/db/schema';
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
