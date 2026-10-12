import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

const MIGRATIONS = join(__dirname, '../../drizzle');

// A throwaway database next to the test database (named <test database without _test>_<suffix>_test), for tests that
// need a schema at an earlier migration.
export function scratchDatabase(suffix: string) {
  const base = new URL(process.env.DATABASE_URL as string);
  const name = `${base.pathname.slice(1).replace(/_test$/, '')}_${suffix}_test`;
  const databaseUrl = new URL(base);
  databaseUrl.pathname = `/${name}`;
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';

  async function drop(): Promise<void> {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  }

  async function recreate(): Promise<void> {
    await drop();
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${name}"`);
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

  return { url: databaseUrl.toString(), recreate, drop, migrateUpTo };
}
