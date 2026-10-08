import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
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

  async rotate(token: string, client: ClientKind): Promise<{ userId: string; token: string } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)))
        .for('update');
      if (!row) {
        return null;
      }
      const now = Date.now();
      if (row.revokedAt) {
        if (now - row.revokedAt.getTime() > REUSE_GRACE_MS) {
          await this.revokeFamily(tx, row.familyId);
          await this.audit.record(tx, {
            actor: { id: row.userId },
            action: 'auth.refresh.reuse_detected',
            target: { type: 'user', id: row.userId, label: row.userId },
          });
        }
        return null;
      }
      if (row.expiresAt.getTime() <= now) {
        return null;
      }
      const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, row.userId));
      if (!user || user.status !== 'active') {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      return { userId: row.userId, token: await this.issue(tx, row.userId, client, row.familyId) };
    });
  }

  async revokeFamilyOf(token: string): Promise<{ userId: string } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)));
      if (!row) {
        return null;
      }
      await this.revokeFamily(tx, row.familyId);
      return { userId: row.userId };
    });
  }

  async revokeAllForUser(executor: DbExecutor, userId: string): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private async revokeFamily(executor: DbExecutor, familyId: string): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
