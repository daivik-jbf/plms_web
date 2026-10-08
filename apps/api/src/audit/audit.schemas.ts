import { z } from 'zod';
import { AUDIT_ACTIONS } from './audit.actions';

// Postgres has no year 0 (and JS dates go further than Postgres), so only years 0001-9999 are accepted. The value is
// later bound as text with a ::timestamptz cast, which keeps its full (microsecond) precision.
const instant = () =>
  z.iso
    .datetime({ offset: true })
    .refine((value) => value.slice(0, 4) !== '0000', { message: 'The year must be between 0001 and 9999.' });

// target_id is a text column, so ids are compared lowercased (an uppercase UUID is still the same person).
const personId = () => z.uuid().transform((value) => value.toLowerCase());

export const auditFilterSchema = z.object({
  actorId: personId().optional(),
  involving: personId().optional(),
  category: z.enum(['accounts', 'content', 'files', 'playback']).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: instant().optional(),
  to: instant().optional(),
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
