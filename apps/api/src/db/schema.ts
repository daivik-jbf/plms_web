import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const userRole = pgEnum('user_role', ['admin', 'staff']);
export const userStatus = pgEnum('user_status', ['active', 'deactivated']);

export type Role = (typeof userRole.enumValues)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    status: userStatus('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by'),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    cancelledAt: timestamptz('cancelled_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invites_token_hash_unique').on(table.tokenHash),
    uniqueIndex('invites_pending_email_unique')
      .on(table.email)
      .where(sql`${table.acceptedAt} is null and ${table.cancelledAt} is null`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    client: text('client').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('password_resets_token_hash_unique').on(table.tokenHash)],
);

export type AuditChanges = Record<string, { before: unknown; after: unknown }>;

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorRole: userRole('actor_role'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    targetLabel: text('target_label'),
    source: text('source').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    appVersion: text('app_version'),
    requestId: text('request_id'),
    changes: jsonb('changes').$type<AuditChanges>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_action_idx').on(table.action),
  ],
);

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
