import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, type Database } from '../db/db.module';
import { type User, users } from '../db/schema';
import type { AuthUser, ClientKind } from './auth.types';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export const toAuthUser = (user: Pick<User, 'id' | 'email' | 'name' | 'role'>): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

const invalidCredentials = () => new UnauthorizedException('Invalid email or password.');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: { email: string; password: string; client: ClientKind }): Promise<LoginResult> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));

    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record(this.db, {
        actor: { label: input.email },
        action: 'auth.login.failed',
        metadata: { reason: 'unknown_email' },
      });
      throw invalidCredentials();
    }

    const actor = { id: user.id, role: user.role, label: user.email };

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.record(this.db, { actor, action: 'auth.login.failed', metadata: { reason: 'locked' } });
      throw new HttpException(
        { error: 'Too Many Requests', message: 'Too many failed attempts. Try again in 15 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);

    if (user.status !== 'active') {
      await this.audit.record(this.db, { actor, action: 'auth.login.failed', metadata: { reason: 'deactivated' } });
      throw invalidCredentials();
    }

    if (!passwordOk) {
      await this.recordWrongPassword(user, actor);
      throw invalidCredentials();
    }

    const refreshToken = await this.db.transaction(async (tx) => {
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
      const token = await this.sessions.issue(tx, user.id, input.client);
      await this.audit.record(tx, { actor, action: 'auth.login.succeeded', metadata: { client: input.client } });
      return token;
    });

    return this.buildResult(user, refreshToken);
  }

  async refresh(token: string, client: ClientKind): Promise<LoginResult> {
    const rotated = await this.sessions.rotate(token, client);
    if (!rotated) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, rotated.userId));
    return this.buildResult(user, rotated.token);
  }

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }
    const revoked = await this.sessions.revokeFamilyOf(token);
    if (revoked) {
      await this.audit.record(this.db, { actor: { id: revoked.userId }, action: 'auth.logout' });
    }
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, { actor: { id: user.id, role: user.role, label: user.email }, action: 'auth.logout_all' });
    });
  }

  private async recordWrongPassword(
    user: User,
    actor: { id: string; role: User['role']; label: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, user.id))
        .returning({ count: users.failedLoginCount });
      const locked = updated.count >= MAX_FAILED_LOGINS;
      if (locked) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) })
          .where(eq(users.id, user.id));
      }
      await this.audit.record(tx, {
        actor,
        action: 'auth.login.failed',
        metadata: { reason: 'wrong_password', locked },
      });
    });
  }

  private async buildResult(user: User, refreshToken: string): Promise<LoginResult> {
    return {
      user: toAuthUser(user),
      accessToken: await this.tokens.signAccess(user.id),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
    };
  }
}
