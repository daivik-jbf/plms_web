import { z } from 'zod';
import { COVER_CONTENT_TYPES, MAX_COVER_BYTES, MAX_PART_URLS_PER_REQUEST, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';

// Postgres cannot store a NUL character in text, so refuse it up front rather than fail with a server error.
const hasNoNul = (value: string): boolean => !value.includes('\u0000');
const NUL_MESSAGE = 'Remove the invalid character.';

export const folderNameSchema = z
  .string('Enter a folder name.')
  .trim()
  .min(1, 'Enter a folder name.')
  .max(100, 'Folder name must be 100 characters or fewer.')
  .refine(hasNoNul, NUL_MESSAGE);

export const folderBodySchema = z.object({ name: folderNameSchema });

export const orderSchema = z.object({ ids: z.array(z.uuid()).max(2000) });

export const titleSchema = z
  .string('Enter a title.')
  .trim()
  .min(1, 'Enter a title.')
  .max(200, 'Title must be 200 characters or fewer.')
  .refine(hasNoNul, NUL_MESSAGE);

// An empty description means "no description".
export const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Description must be 2,000 characters or fewer.')
  .refine(hasNoNul, NUL_MESSAGE)
  .transform((value) => (value === '' ? null : value));

export const updateItemSchema = z
  .object({ title: titleSchema.optional(), description: descriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

const MAX_PARTS = partCountFor(MAX_VIDEO_BYTES);

export const startUploadSchema = z.object({
  folderId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema.nullish(),
  fileName: z.string().min(1, 'The file needs a name.').max(1000).refine(hasNoNul, NUL_MESSAGE),
  // Which types and sizes are allowed depends on the folder's category, so the service checks them (media-kinds.ts).
  contentType: z.string().min(1, 'Choose a file.').max(100, 'Choose a file.').refine(hasNoNul, NUL_MESSAGE),
  sizeBytes: z.number('Choose a file.').int('Choose a file.').min(1, 'That file is empty.'),
  durationSeconds: z.number().int().min(0).max(1_000_000).nullish(),
});

export const partUrlsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(MAX_PART_URLS_PER_REQUEST),
});

export const completeUploadSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(MAX_PARTS), etag: z.string().min(1).max(200) })).min(1).max(MAX_PARTS),
});

export const coverStartSchema = z.object({
  contentType: z.enum(COVER_CONTENT_TYPES, 'Covers must be JPEG, PNG or WebP images.'),
  sizeBytes: z.number().int().min(1, 'That file is empty.').max(MAX_COVER_BYTES, 'Covers can be at most 10 MB.'),
});

export const ORDER_CHANGED_MESSAGE = 'The list changed while you were editing it. Reload and try again.';

export type StartUploadInput = z.infer<typeof startUploadSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CoverStartInput = z.infer<typeof coverStartSchema>;
