import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    index('audit_log_paging_idx').on(table.occurredAt.desc(), table.id.desc()),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_target_idx').on(table.targetId),
    index('audit_log_action_idx').on(table.action),
  ],
);

export const filePurpose = pgEnum('file_purpose', ['video', 'cover']);
export const fileStatus = pgEnum('file_status', ['pending', 'ready']);
export const mediaCategory = pgEnum('media_category', ['video', 'movie', 'podcast', 'song']);
export const mediaItemStatus = pgEnum('media_item_status', ['uploading', 'ready']);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: filePurpose('purpose').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: fileStatus('status').notNull().default('pending'),
    uploadId: text('upload_id'),
    partSize: integer('part_size'),
    partCount: integer('part_count'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
  },
  (table) => [uniqueIndex('files_storage_key_unique').on(table.storageKey), index('files_pending_idx').on(table.status, table.createdAt)],
);

export const mediaFolders = pgTable(
  'media_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: mediaCategory('category').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('media_folders_name_unique').on(table.category, sql`lower(${table.name})`)],
);

export const mediaItems = pgTable(
  'media_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => mediaFolders.id),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    videoFileId: uuid('video_file_id')
      .notNull()
      .references(() => files.id),
    coverFileId: uuid('cover_file_id').references(() => files.id),
    durationSeconds: integer('duration_seconds'),
    status: mediaItemStatus('status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('media_items_video_file_unique').on(table.videoFileId),
    index('media_items_folder_idx').on(table.folderId, table.position),
  ],
);

export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type MediaFolder = typeof mediaFolders.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
