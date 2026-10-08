import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/jbf_lms_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/i.test(dbName)) {
    throw new Error(`Refusing to reset database "${dbName}": its name must end in _test`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
