import { z } from 'zod';
import { AUDIT_ACTIONS } from './audit.actions';

export const auditFilterSchema = z.object({
  actorId: z.uuid().optional(),
  involving: z.uuid().optional(),
  category: z.enum(['accounts', 'content', 'files', 'playback']).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  includePlayback: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const auditQuerySchema = auditFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
