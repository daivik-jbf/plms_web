import { z } from 'zod';
import { emailSchema } from '../common/fields';

const client = z.enum(['web', 'mobile']).default('web');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(1024),
  client,
});

export const sessionTokenSchema = z.object({
  client,
  refreshToken: z.string().min(1).max(200).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SessionTokenInput = z.infer<typeof sessionTokenSchema>;
