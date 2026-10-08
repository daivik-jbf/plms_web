import { z } from 'zod';
import { emailSchema, nameSchema } from '../common/fields';
import { passwordSchema } from '../auth/password-policy';

export const createInviteSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  role: z.enum(['admin', 'staff']),
});

export const tokenSchema = z.object({ token: z.string().min(1).max(200) });

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
