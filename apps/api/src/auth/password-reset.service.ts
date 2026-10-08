import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { passwordResets, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { resetEmail } from '../mail/templates';
import type { AuthUser } from './auth.types';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const RESET_TTL_MS = 60 * 60 * 1000;
const INVALID_LINK = 'This reset link is invalid or has expired.';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async request(email: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user || user.status !== 'active') {
      return;
    }
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.db.transaction(async (tx) => {
      await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({ userId: user.id, tokenHash: hash, expiresAt });
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.reset_requested',
      });
    });
    const link = `${this.env.WEB_ORIGIN}/reset-password?token=${token}`;
    this.mailer.send({ to: user.email, ...resetEmail({ name: user.name, link, expiresAt }) }).catch((error: unknown) => {
      this.logger.error(`Could not send reset email: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      const [reset] = await tx
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, hashOpaqueToken(token)))
        .for('update');
      if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException(INVALID_LINK);
      }
      const [user] = await tx.select().from(users).where(eq(users.id, reset.userId));
      if (!user || user.status !== 'active') {
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
      await tx
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.reset_completed',
      });
    });
  }

  async change(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row || !(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        fieldErrors: { currentPassword: ['Current password is incorrect.'] },
      });
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.changed',
      });
    });
  }
}
