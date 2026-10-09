import { z } from 'zod';

const booleanString = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    WEB_ORIGIN: z.string().url(),
    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().min(1).default('JBF Learning Management System <no-reply@localhost>'),
    SMTP_URL: z.string().min(1).optional(),
    LOG_LEVEL: z.string().min(1).default('info'),
    TRUST_PROXY: booleanString('false'),
    THROTTLE_ENABLED: booleanString('true'),
    AUDIT_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
    STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./.storage'),
    STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when MAIL_TRANSPORT=smtp' });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'MAIL_TRANSPORT=console is not allowed in production (it logs invite links)',
      });
    }
    if (env.STORAGE_DRIVER === 'r2') {
      for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
        if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required when STORAGE_DRIVER=r2` });
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'STORAGE_DRIVER=local is not allowed in production (it keeps files on the server disk with development links)',
      });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
