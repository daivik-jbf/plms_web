import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '../src/db/db.module';
import { isUniqueViolation } from '../src/db/errors';
import { files, mediaFolders, mediaItems } from '../src/db/schema';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

const isRejectedAsDuplicate = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, isUniqueViolation);

describe('media tables', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const folder = (createdBy: string, name: string, category: 'video' | 'movie' = 'video') =>
    db.insert(mediaFolders).values({ category, name, position: 0, createdBy }).returning();

  const videoFile = async (uploadedBy: string, sizeBytes = 1000) => {
    const [file] = await db
      .insert(files)
      .values({ purpose: 'video', storageKey: `videos/${randomUUID()}`, originalName: 'a.mp4', contentType: 'video/mp4', sizeBytes, uploadedBy })
      .returning();
    return file;
  };

  it('keeps folder names unique per category, ignoring case', async () => {
    const user = await createUser(db);
    const name = `Safety ${randomUUID()}`;
    await folder(user.id, name);
    expect(await isRejectedAsDuplicate(folder(user.id, name.toUpperCase()))).toBe(true);
    expect(await isRejectedAsDuplicate(folder(user.id, name.toLowerCase()))).toBe(true);
    await expect(folder(user.id, name, 'movie')).resolves.toHaveLength(1);
  });

  it('stores sizes above 2^31 without overflow', async () => {
    const user = await createUser(db);
    const file = await videoFile(user.id, 2_147_483_648);
    const [stored] = await db.select().from(files).where(eq(files.id, file.id));
    expect(stored.sizeBytes).toBe(2_147_483_648);
    expect(stored.status).toBe('pending');
  });

  it('refuses a second item for the same video file and a duplicate storage key', async () => {
    const user = await createUser(db);
    const [parent] = await folder(user.id, `Folder ${randomUUID()}`);
    const file = await videoFile(user.id);
    const item = { folderId: parent.id, title: 'T', position: 0, mediaFileId: file.id, status: 'uploading' as const, createdBy: user.id };
    await db.insert(mediaItems).values(item);
    expect(await isRejectedAsDuplicate(db.insert(mediaItems).values(item))).toBe(true);
    const sameKey = db
      .insert(files)
      .values({ purpose: 'video', storageKey: file.storageKey, originalName: 'b.mp4', contentType: 'video/mp4', sizeBytes: 1, uploadedBy: user.id });
    expect(await isRejectedAsDuplicate(sameKey)).toBe(true);
  });
});
