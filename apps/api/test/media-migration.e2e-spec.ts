import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/db/migrate';
import type { User } from '../src/db/schema';
import { PART_SIZE } from '../src/storage/storage.constants';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { completeViaApi, mp4Bytes, pngBytes, putPieces } from './helpers/media';
import { createUser } from './helpers/users';
import type { InMemoryStorage } from './support/in-memory-storage';

const MIGRATIONS = join(__dirname, '../drizzle');
const base = new URL(process.env.DATABASE_URL as string);
const dbName = `${base.pathname.slice(1).replace(/_test$/, '')}_migration_test`;
const databaseUrl = new URL(base);
databaseUrl.pathname = `/${dbName}`;
const adminUrl = new URL(base);
adminUrl.pathname = '/postgres';

async function recreateDatabase(drop: boolean): Promise<void> {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    if (!drop) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

// Applies the migrations up to and including `lastIdx` from a copy of the migrations folder.
async function migrateUpTo(lastIdx: number): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'jbf-migrations-'));
  try {
    const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
    await mkdir(join(folder, 'meta'));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    const pool = new Pool({ connectionString: databaseUrl.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('migration 0004 on a database that already holds videos, covers and an upload in progress', () => {
  const originalUrl = process.env.DATABASE_URL;
  let app: NestExpressApplication;
  let storage: InMemoryStorage;
  let sql: Pool;
  let owner: User;
  let session: Session;
  const ids = { folder: '', readyItem: '', readyFile: '', cover: '', pendingItem: '', pendingFile: '' };

  const insertFile = async (purpose: 'video' | 'cover', key: string, contentType: string, size: number, pending: { uploadId: string } | null) => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into files (purpose, storage_key, original_name, content_type, size_bytes, status, upload_id, part_size, part_count, uploaded_by, completed_at)
       values ($1, $2, 'old.mp4', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [purpose, key, contentType, size, pending ? 'pending' : 'ready', pending?.uploadId ?? null, pending ? PART_SIZE : null, pending ? 1 : null, owner.id, pending ? null : new Date()],
    );
    return rows[0].id;
  };

  const insertItem = async (title: string, fileId: string, coverId: string | null, status: 'ready' | 'uploading') => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into media_items (folder_id, title, position, video_file_id, cover_file_id, status, created_by)
       values ($1, $2, 0, $3, $4, $5, $6) returning id`,
      [ids.folder, title, fileId, coverId, status, owner.id],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    await recreateDatabase(false);
    await migrateUpTo(3);
    process.env.DATABASE_URL = databaseUrl.toString();
    const created = await createTestApp();
    app = created.app;
    storage = created.storage;
    sql = new Pool({ connectionString: databaseUrl.toString() });
    owner = await createUser(created.db);
    session = await loginMobile(app, owner.email);

    ids.folder = (await sql.query<{ id: string }>(`insert into media_folders (category, name, position, created_by) values ('video', 'Old folder', 0, $1) returning id`, [owner.id])).rows[0].id;

    const readyKey = `videos/${randomUUID()}`;
    storage.seed(readyKey, mp4Bytes(64), 'video/mp4');
    ids.readyFile = await insertFile('video', readyKey, 'video/mp4', 64, null);
    const coverKey = `covers/${randomUUID()}`;
    storage.seed(coverKey, pngBytes(64), 'image/png');
    ids.cover = await insertFile('cover', coverKey, 'image/png', 64, null);
    ids.readyItem = await insertItem('Old ready video', ids.readyFile, ids.cover, 'ready');

    const pendingKey = `videos/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(pendingKey, 'video/mp4');
    ids.pendingFile = await insertFile('video', pendingKey, 'video/mp4', 100, { uploadId });
    ids.pendingItem = await insertItem('Old unfinished video', ids.pendingFile, null, 'uploading');

    await runMigrations(databaseUrl.toString());
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    process.env.DATABASE_URL = originalUrl;
    await recreateDatabase(true);
  });

  const http = () => request(app.getHttpServer());

  it('renames the column and keeps every value, with the foreign key and unique index renamed too', async () => {
    const columns = (await sql.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'media_items'`)).rows.map(
      (row) => row.column_name,
    );
    expect(columns).toContain('media_file_id');
    expect(columns).not.toContain('video_file_id');
    const { rows } = await sql.query(`select id, media_file_id, cover_file_id, status from media_items order by title`);
    expect(rows).toEqual([
      { id: ids.readyItem, media_file_id: ids.readyFile, cover_file_id: ids.cover, status: 'ready' },
      { id: ids.pendingItem, media_file_id: ids.pendingFile, cover_file_id: null, status: 'uploading' },
    ]);
    const keys = (await sql.query<{ conname: string }>(`select conname from pg_constraint where conrelid = 'media_items'::regclass and contype = 'f'`)).rows.map(
      (row) => row.conname,
    );
    expect(keys).toContain('media_items_media_file_id_files_id_fk');
    expect(keys).not.toContain('media_items_video_file_id_files_id_fk');
    const indexes = (await sql.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'media_items'`)).rows.map((row) => row.indexname);
    expect(indexes).toContain('media_items_media_file_unique');
    expect(indexes).not.toContain('media_items_video_file_unique');
    const purposes = (await sql.query<{ value: string }>(`select unnest(enum_range(null::file_purpose))::text as value`)).rows.map((row) => row.value);
    expect(purposes).toEqual(['video', 'cover', 'audio']);
  });

  it('still lists and plays the ready video with its cover', async () => {
    const list = await http().get(`/api/media/folders/${ids.folder}/items`).set(...bearer(session)).expect(200);
    const ready = list.body.find((item: { id: string }) => item.id === ids.readyItem);
    expect(ready).toMatchObject({ title: 'Old ready video', status: 'ready', sizeBytes: 64, coverUrl: expect.stringMatching(/^memory:\/\/get\//) });
    const play = await http().post(`/api/media/items/${ids.readyItem}/play`).set(...bearer(session)).expect(200);
    expect(play.body.contentType).toBe('video/mp4');
  });

  it('can still finish the upload that was in progress before the migration', async () => {
    const parts = await putPieces(app, storage, session, ids.pendingFile, mp4Bytes(100));
    const res = await completeViaApi(app, session, ids.pendingFile, parts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.pendingItem, status: 'ready', sizeBytes: 100 });
    const { rows } = await sql.query(`select status, upload_id from files where id = $1`, [ids.pendingFile]);
    expect(rows).toEqual([{ status: 'ready', upload_id: null }]);
  });

  it('still refuses a second item for the same file', async () => {
    await expect(
      sql.query(`insert into media_items (folder_id, title, position, media_file_id, status, created_by) values ($1, 'Copy', 1, $2, 'ready', $3)`, [
        ids.folder,
        ids.readyFile,
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
