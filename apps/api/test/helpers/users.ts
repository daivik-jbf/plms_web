import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Database } from '../../src/db/db.module';
import { type Role, type User, users } from '../../src/db/schema';

export const TEST_PASSWORD = 'correct horse battery';

export async function createUser(
  db: Database,
  overrides: Partial<{ email: string; name: string; role: Role; status: 'active' | 'deactivated'; password: string }> = {},
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `user-${randomUUID()}@example.com`,
      name: overrides.name ?? 'Test User',
      role: overrides.role ?? 'staff',
      status: overrides.status ?? 'active',
      passwordHash: await argon2.hash(overrides.password ?? TEST_PASSWORD),
    })
    .returning();
  return user;
}
