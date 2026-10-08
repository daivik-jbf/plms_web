import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/opaque-token';
import { PasswordService } from '../auth/password.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { type Invite, invites, type Role, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { inviteEmail } from '../mail/templates';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_LINK = 'This invite link is invalid or has expired.';

export interface InviteView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'cancelled';
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
}

export const toInviteView = (invite: Invite): InviteView => ({
  id: invite.id,
  email: invite.email,
  name: invite.name,
  role: invite.role,
  status: invite.acceptedAt
    ? 'accepted'
    : invite.cancelledAt
      ? 'cancelled'
      : invite.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'pending',
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
  invitedBy: invite.invitedBy,
});

const actorOf = (actor: AuthUser | null) => (actor ? { id: actor.id, role: actor.role, label: actor.email } : null);

@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async create(
    actor: AuthUser | null,
    input: { email: string; name: string; role: Role },
    options: { sendEmail: boolean },
  ): Promise<{ invite: InviteView; link: string }> {
    const { token, hash } = generateOpaqueToken();
    let created: Invite;
    try {
      created = await this.db.transaction(async (tx) => {
        const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
        if (existingUser) {
          throw new ConflictException('A user with this email already exists.');
        }
        const [row] = await tx
          .insert(invites)
          .values({
            email: input.email,
            name: input.name,
            role: input.role,
            tokenHash: hash,
            invitedBy: actor?.id ?? null,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning();
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'invite.created',
          target: { type: 'invite', id: row.id, label: row.email },
          metadata: { role: row.role },
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An invite for this email is already pending. Resend or cancel it instead.');
      }
      throw error;
    }
    return this.deliver(created, token, options.sendEmail);
  }

  async resend(
    actor: AuthUser | null,
    id: string,
    options: { sendEmail: boolean },
  ): Promise<{ invite: InviteView; link: string }> {
    const { token, hash } = generateOpaqueToken();
    const updated = await this.db.transaction(async (tx) => {
      const invite = await this.requirePending(tx, id);
      const [row] = await tx
        .update(invites)
        .set({ tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        .where(eq(invites.id, invite.id))
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'invite.resent',
        target: { type: 'invite', id: row.id, label: row.email },
      });
      return row;
    });
    return this.deliver(updated, token, options.sendEmail);
  }

  async cancel(actor: AuthUser, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const invite = await this.requirePending(tx, id);
      await tx.update(invites).set({ cancelledAt: new Date() }).where(eq(invites.id, invite.id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'invite.cancelled',
        target: { type: 'invite', id: invite.id, label: invite.email },
      });
    });
  }

  async list(): Promise<InviteView[]> {
    const rows = await this.db.select().from(invites).orderBy(desc(invites.createdAt));
    return rows.map(toInviteView);
  }

  async findPendingByEmail(email: string): Promise<Invite | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.cancelledAt)));
    return row ?? null;
  }

  async preview(token: string): Promise<{ name: string; email: string }> {
    const [invite] = await this.db.select().from(invites).where(eq(invites.tokenHash, hashOpaqueToken(token)));
    if (!invite || toInviteView(invite).status !== 'pending') {
      throw new BadRequestException(INVALID_LINK);
    }
    return { name: invite.name, email: invite.email };
  }

  async accept(token: string, password: string): Promise<AuthUser> {
    const passwordHash = await this.passwords.hash(password);
    try {
      return await this.db.transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(invites)
          .where(eq(invites.tokenHash, hashOpaqueToken(token)))
          .for('update');
        if (!invite || toInviteView(invite).status !== 'pending') {
          throw new BadRequestException(INVALID_LINK);
        }
        const [user] = await tx
          .insert(users)
          .values({ email: invite.email, name: invite.name, role: invite.role, passwordHash })
          .returning();
        await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
        await this.audit.record(tx, {
          actor: { id: user.id, role: user.role, label: user.email },
          action: 'invite.accepted',
          target: { type: 'invite', id: invite.id, label: invite.email },
        });
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(INVALID_LINK);
      }
      throw error;
    }
  }

  private async requirePending(executor: DbExecutor, id: string): Promise<Invite> {
    const [invite] = await executor.select().from(invites).where(eq(invites.id, id)).for('update');
    if (!invite) {
      throw new NotFoundException('Invite not found.');
    }
    if (invite.acceptedAt || invite.cancelledAt) {
      throw new ConflictException('This invite has already been accepted or cancelled.');
    }
    return invite;
  }

  private async deliver(invite: Invite, token: string, sendEmail: boolean): Promise<{ invite: InviteView; link: string }> {
    const link = `${this.env.WEB_ORIGIN}/accept-invite?token=${token}`;
    if (sendEmail) {
      try {
        await this.mailer.send({
          to: invite.email,
          ...inviteEmail({ name: invite.name, link, expiresAt: invite.expiresAt }),
        });
      } catch {
        throw new BadGatewayException('The invite was saved but the email could not be sent. Use Resend to try again.');
      }
    }
    return { invite: toInviteView(invite), link };
  }
}
