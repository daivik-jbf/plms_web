import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { refreshTokens, users } from '../db/schema';
import type { ClientKind } from './auth.types';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 10_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async issue(executor: DbExecutor, userId: string, client: ClientKind, familyId: string = randomUUID()): Promise<string> {
    const { token, hash } = generateOpaqueToken();
    await executor.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hash,
      client,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return token;
  }

  // Lock order: the user row first (FOR SHARE), then the token row (FOR UPDATE). Password change, password
  // reset and deactivation update or lock the user row before they revoke the user's tokens, so they wait
  // for an in-flight rotation to commit (and then revoke its new token), or the rotation waits for them and
  // then sees its token revoked. Without the user lock a rotation could insert a fresh token that the
  // concurrent revoke statement never sees.
  async rotate(token: string, client: ClientKind): Promise<{ userId: string; token: string } | null> {
    const tokenHash = hashOpaqueToken(token);
    return this.db.transaction(async (tx) => {
      const [unlocked] = await tx
        .select({ userId: refreshTokens.userId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash));
      if (!unlocked) {
        return null;
      }
      const [user] = await tx
        .select({ status: users.status, role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, unlocked.userId))
        .for('share');
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).for('update');
      if (!row || !user) {
        return null;
      }
      const now = Date.now();
      if (row.revokedAt) {
        if (now - row.revokedAt.getTime() > REUSE_GRACE_MS) {
          await this.revokeFamily(tx, row.familyId);
          if (await this.wasRotated(tx, row)) {
            await this.audit.record(tx, {
              actor: { id: row.userId, role: user.role, label: user.email },
              action: 'auth.refresh.reuse_detected',
              target: { type: 'user', id: row.userId, label: user.email },
            });
          }
        }
        return null;
      }
      if (row.expiresAt.getTime() <= now) {
        return null;
      }
      if (user.status !== 'active') {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      return { userId: row.userId, token: await this.issue(tx, row.userId, client, row.familyId) };
    });
  }

  // Revokes the family of the presented token. Returns the owner only when this call actually revoked
  // something, so a repeated logout with an already-dead token is a silent no-op.
  async revokeFamilyOf(executor: DbExecutor, token: string): Promise<{ userId: string } | null> {
    const [row] = await executor
      .select({ userId: refreshTokens.userId, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)));
    if (!row) {
      return null;
    }
    const revoked = await this.revokeFamily(executor, row.familyId);
    return revoked > 0 ? { userId: row.userId } : null;
  }

  async revokeAllForUser(executor: DbExecutor, userId: string): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  // A revoked token counts as "reused" only if it was rotated, i.e. its family holds a newer token. A token
  // that was revoked by logout, a password change or deactivation and is presented later is just stale.
  // The timestamp comparison stays in SQL because a JS Date would drop the microseconds.
  private async wasRotated(executor: DbExecutor, row: { id: string; familyId: string }): Promise<boolean> {
    const [newer] = await executor
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.familyId, row.familyId),
          ne(refreshTokens.id, row.id),
          sql`${refreshTokens.createdAt} > (select created_at from refresh_tokens where id = ${row.id})`,
        ),
      )
      .limit(1);
    return Boolean(newer);
  }

  private async revokeFamily(executor: DbExecutor, familyId: string): Promise<number> {
    const revoked = await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return revoked.length;
  }
}
