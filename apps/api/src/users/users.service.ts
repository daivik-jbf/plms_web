import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { SessionService } from '../auth/session.service';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { type Role, type User, users } from '../db/schema';

export interface UserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: User['status'];
  createdAt: Date;
}

const toView = (user: User): UserView => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});

const actorOf = (actor: AuthUser) => ({ id: actor.id, role: actor.role, label: actor.email });

const LAST_ADMIN_MESSAGE = 'At least one active Admin is required.';

const hasAnotherAdmin = (admins: { id: string }[], targetId: string): boolean =>
  admins.some((admin) => admin.id !== targetId);

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async list(): Promise<UserView[]> {
    const rows = await this.db.select().from(users).orderBy(asc(users.name));
    return rows.map(toView);
  }

  changeRole(actor: AuthUser, id: string, role: Role): Promise<UserView> {
    return this.db.transaction(async (tx) => {
      const { target, admins } = await this.lockAdminsThenTarget(tx, id);
      if (target.role === role) {
        return toView(target);
      }
      if (target.role === 'admin' && target.status === 'active' && !hasAnotherAdmin(admins, target.id)) {
        throw new ConflictException(LAST_ADMIN_MESSAGE);
      }
      const [updated] = await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'user.role_changed',
        target: { type: 'user', id, label: target.email },
        changes: { role: { before: target.role, after: role } },
      });
      return toView(updated);
    });
  }

  deactivate(actor: AuthUser, id: string): Promise<UserView> {
    return this.db.transaction(async (tx) => {
      const { target, admins } = await this.lockAdminsThenTarget(tx, id);
      if (target.status === 'deactivated') {
        return toView(target);
      }
      if (target.role === 'admin' && !hasAnotherAdmin(admins, target.id)) {
        throw new ConflictException(LAST_ADMIN_MESSAGE);
      }
      const [updated] = await tx
        .update(users)
        .set({ status: 'deactivated', updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      await this.sessions.revokeAllForUser(tx, id);
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'user.deactivated',
        target: { type: 'user', id, label: target.email },
        changes: { status: { before: 'active', after: 'deactivated' } },
      });
      return toView(updated);
    });
  }

  reactivate(actor: AuthUser, id: string): Promise<UserView> {
    return this.db.transaction(async (tx) => {
      const target = await this.lockUser(tx, id);
      if (target.status === 'active') {
        return toView(target);
      }
      const [updated] = await tx
        .update(users)
        .set({ status: 'active', failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'user.reactivated',
        target: { type: 'user', id, label: target.email },
        changes: { status: { before: 'deactivated', after: 'active' } },
      });
      return toView(updated);
    });
  }

  // Always locks the active Admin rows first, in id order, and the target second. A fixed lock order
  // lets two concurrent demotions queue up instead of deadlocking, and the second one then sees the
  // first one's result.
  private async lockAdminsThenTarget(tx: DbTransaction, id: string): Promise<{ target: User; admins: { id: string }[] }> {
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
      .orderBy(asc(users.id))
      .for('update');
    return { target: await this.lockUser(tx, id), admins };
  }

  private async lockUser(tx: DbTransaction, id: string): Promise<User> {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }
}
