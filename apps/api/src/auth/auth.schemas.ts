import { z } from 'zod';
import { emailSchema } from '../common/fields';
import { passwordSchema } from './password-policy';

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

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(1024),
  newPassword: passwordSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
