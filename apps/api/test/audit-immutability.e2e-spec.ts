import { randomUUID } from 'node:crypto';
import { createTestDb } from './helpers/db';

describe('audit_log is append-only', () => {
  const { pool, close } = createTestDb();
  const id = randomUUID();

  beforeAll(async () => {
    await pool.query(`insert into audit_log (id, action, source) values ($1, 'test.created', 'system')`, [id]);
  });

  afterAll(close);

  it('accepts inserts and reads', async () => {
    const { rows } = await pool.query('select action from audit_log where id = $1', [id]);
    expect(rows).toEqual([{ action: 'test.created' }]);
  });

  it('rejects UPDATE', async () => {
    await expect(pool.query(`update audit_log set action = 'x' where id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE', async () => {
    await expect(pool.query('delete from audit_log where id = $1', [id])).rejects.toThrow(/append-only/);
  });

  it('rejects TRUNCATE', async () => {
    await expect(pool.query('truncate audit_log')).rejects.toThrow(/append-only/);
  });
});
