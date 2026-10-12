import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/db/migrate';
import type { User } from '../src/db/schema';
import { PART_SIZE } from '../src/storage/storage.constants';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { completeViaApi, m4aBytes, mp4Bytes, pngBytes, putPieces } from './helpers/media';
import { scratchDatabase } from './helpers/migrations';
import { createUser } from './helpers/users';
import type { InMemoryStorage } from './support/in-memory-storage';

const { url: databaseUrl, recreate, drop, migrateUpTo } = scratchDatabase('courses_migration');

describe('migration 0005 on a database that already holds a video with a cover, a song and an upload in progress', () => {
  const originalUrl = process.env.DATABASE_URL;
  let app: NestExpressApplication;
  let storage: InMemoryStorage;
  let sql: Pool;
  let owner: User;
  let session: Session;
  const ids = { folder: '', songFolder: '', readyItem: '', readyFile: '', cover: '', song: '', songFile: '', pendingItem: '', pendingFile: '' };

  const insertFile = async (purpose: 'video' | 'cover' | 'audio', key: string, contentType: string, size: number, pending: { uploadId: string } | null) => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into files (purpose, storage_key, original_name, content_type, size_bytes, status, upload_id, part_size, part_count, uploaded_by, completed_at)
       values ($1, $2, 'old.bin', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [purpose, key, contentType, size, pending ? 'pending' : 'ready', pending?.uploadId ?? null, pending ? PART_SIZE : null, pending ? 1 : null, owner.id, pending ? null : new Date()],
    );
    return rows[0].id;
  };

  const insertItem = async (folderId: string, title: string, fileId: string, coverId: string | null, status: 'ready' | 'uploading') => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into media_items (folder_id, title, position, media_file_id, cover_file_id, status, created_by)
       values ($1, $2, 0, $3, $4, $5, $6) returning id`,
      [folderId, title, fileId, coverId, status, owner.id],
    );
    return rows[0].id;
  };

  const insertFolder = async (category: 'video' | 'song', name: string) =>
    (await sql.query<{ id: string }>(`insert into media_folders (category, name, position, created_by) values ($1, $2, 0, $3) returning id`, [category, name, owner.id])).rows[0].id;

  beforeAll(async () => {
    await recreate();
    await migrateUpTo(4);
    process.env.DATABASE_URL = databaseUrl;
    const created = await createTestApp();
    app = created.app;
    storage = created.storage;
    sql = new Pool({ connectionString: databaseUrl });
    owner = await createUser(created.db);
    session = await loginMobile(app, owner.email);

    ids.folder = await insertFolder('video', 'Old folder');
    ids.songFolder = await insertFolder('song', 'Old songs');

    const readyKey = `videos/${randomUUID()}`;
    storage.seed(readyKey, mp4Bytes(64), 'video/mp4');
    ids.readyFile = await insertFile('video', readyKey, 'video/mp4', 64, null);
    const coverKey = `covers/${randomUUID()}`;
    storage.seed(coverKey, pngBytes(64), 'image/png');
    ids.cover = await insertFile('cover', coverKey, 'image/png', 64, null);
    ids.readyItem = await insertItem(ids.folder, 'Old ready video', ids.readyFile, ids.cover, 'ready');

    const songKey = `audio/${randomUUID()}`;
    storage.seed(songKey, m4aBytes(64), 'audio/mp4');
    ids.songFile = await insertFile('audio', songKey, 'audio/mp4', 64, null);
    ids.song = await insertItem(ids.songFolder, 'Old song', ids.songFile, null, 'ready');

    const pendingKey = `videos/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(pendingKey, 'video/mp4');
    ids.pendingFile = await insertFile('video', pendingKey, 'video/mp4', 100, { uploadId });
    ids.pendingItem = await insertItem(ids.folder, 'Old unfinished video', ids.pendingFile, null, 'uploading');

    await runMigrations(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    process.env.DATABASE_URL = originalUrl;
    await drop();
  });

  const http = () => request(app.getHttpServer());

  it('adds the purposes and the four tables and keeps every existing row as it was', async () => {
    const purposes = (await sql.query<{ value: string }>(`select unnest(enum_range(null::file_purpose))::text as value`)).rows.map((row) => row.value);
    expect(purposes).toEqual(['video', 'cover', 'audio', 'pdf', 'image']);
    const tables = (await sql.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('courses', 'lessons', 'topics', 'topic_attachments') order by table_name`)).rows;
    expect(tables.map((row) => row.table_name)).toEqual(['courses', 'lessons', 'topic_attachments', 'topics']);
    for (const table of ['courses', 'lessons', 'topics', 'topic_attachments']) {
      expect((await sql.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);
    }
    const { rows } = await sql.query(`select id, media_file_id, cover_file_id, status from media_items order by title`);
    expect(rows).toEqual([
      { id: ids.readyItem, media_file_id: ids.readyFile, cover_file_id: ids.cover, status: 'ready' },
      { id: ids.song, media_file_id: ids.songFile, cover_file_id: null, status: 'ready' },
      { id: ids.pendingItem, media_file_id: ids.pendingFile, cover_file_id: null, status: 'uploading' },
    ]);
    const kept = await sql.query(`select purpose, status from files order by purpose, status`);
    expect(kept.rows).toEqual([
      { purpose: 'video', status: 'pending' },
      { purpose: 'video', status: 'ready' },
      { purpose: 'cover', status: 'ready' },
      { purpose: 'audio', status: 'ready' },
    ]);
  });

  it('has the one-source and unique-file rules on the attachments table', async () => {
    const constraints = (await sql.query<{ conname: string }>(`select conname from pg_constraint where conrelid = 'topic_attachments'::regclass and contype = 'c' order by conname`)).rows.map(
      (row) => row.conname,
    );
    expect(constraints).toEqual(['topic_attachments_one_source', 'topic_attachments_title_present']);
    const indexes = (await sql.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'topic_attachments'`)).rows.map((row) => row.indexname);
    expect(indexes).toContain('topic_attachments_file_unique');
  });

  it('still lists and plays the old ready video with its cover and the old song', async () => {
    const list = await http().get(`/api/media/folders/${ids.folder}/items`).set(...bearer(session)).expect(200);
    expect(list.body.find((item: { id: string }) => item.id === ids.readyItem)).toMatchObject({ title: 'Old ready video', status: 'ready', sizeBytes: 64, coverUrl: expect.stringMatching(/^memory:\/\/get\//) });
    await http().post(`/api/media/items/${ids.readyItem}/play`).set(...bearer(session)).expect(200);
    const song = await http().post(`/api/media/items/${ids.song}/play`).set(...bearer(session)).expect(200);
    expect(song.body.contentType).toBe('audio/mp4');
  });

  it('can still finish the upload that was in progress before the migration', async () => {
    const parts = await putPieces(app, storage, session, ids.pendingFile, mp4Bytes(100));
    const res = await completeViaApi(app, session, ids.pendingFile, parts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.pendingItem, status: 'ready', sizeBytes: 100 });
    const { rows } = await sql.query(`select status, upload_id from files where id = $1`, [ids.pendingFile]);
    expect(rows).toEqual([{ status: 'ready', upload_id: null }]);
  });

  it('lets a new attachment point at an old library item and an old file, once', async () => {
    const { rows: course } = await sql.query<{ id: string }>(`insert into courses (title, position, created_by) values ('Safety', 0, $1) returning id`, [owner.id]);
    const { rows: lesson } = await sql.query<{ id: string }>(`insert into lessons (course_id, title, position, created_by) values ($1, 'Exits', 0, $2) returning id`, [course[0].id, owner.id]);
    const { rows: topic } = await sql.query<{ id: string }>(`insert into topics (lesson_id, title, position, created_by) values ($1, 'Fire exits', 0, $2) returning id`, [lesson[0].id, owner.id]);
    await sql.query(`insert into topic_attachments (topic_id, position, kind, library_item_id, status, created_by) values ($1, 0, 'video', $2, 'ready', $3)`, [topic[0].id, ids.readyItem, owner.id]);
    await sql.query(`insert into topic_attachments (topic_id, position, kind, title, file_id, status, created_by) values ($1, 1, 'video', 'Same file', $2, 'ready', $3)`, [topic[0].id, ids.readyFile, owner.id]);
    await expect(
      sql.query(`insert into topic_attachments (topic_id, position, kind, title, file_id, status, created_by) values ($1, 2, 'video', 'Again', $2, 'ready', $3)`, [topic[0].id, ids.readyFile, owner.id]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
