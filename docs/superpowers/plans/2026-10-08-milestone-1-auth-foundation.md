# Milestone 1: Auth, Roles and Audit Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working JBF LMS where an Admin can be bootstrapped, invite Staff by email, and everyone can sign in on the web portal (and, via the same API, from the mobile app), with every action recorded in an append-only audit log.

**Architecture:** An npm-workspaces monorepo with `apps/api` (NestJS + Drizzle + PostgreSQL) and `apps/web` (React + Vite). The API is the single source of accounts for both clients. Every state-changing service writes its audit entry in the same database transaction as the change. Authorization is enforced by global guards that deny by default.

**Tech Stack:** Node 24 LTS, TypeScript, NestJS 11, Drizzle ORM + drizzle-kit, PostgreSQL 17, zod, argon2, jose, nodemailer, pino, Jest + supertest (API), React + Vite + Vitest + Testing Library (web), IBM Plex Sans via @fontsource.

**Spec:** `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md` (sections 3, 6, 7, 8, 9, 10 and milestone 1 of section 11). Read it before starting.

## Global Constraints

- Roles: exactly `admin` and `staff`. Admin can create other Admins. Staff cannot delete, manage users, or read the audit log.
- Every permission is enforced server-side on every request. Routes are **deny-by-default**: any route not marked `@Public()` requires a valid access token for an **active** user.
- Access token ~15 minutes. Refresh token is opaque, rotating, stored hashed, revocable; 30-day lifetime.
- Web: refresh token in a `Secure` (production), `HttpOnly`, `SameSite=Strict` cookie with `Path=/api/auth` plus a required `X-Requested-With: jbf-web` header (CSRF). Mobile: refresh token in the JSON body (`client: "mobile"`).
- Passwords: Argon2id via the `argon2` package. Minimum 10 characters (counted as Unicode code points), maximum 128, not whitespace-only, blocked if on the common-password list, **no** symbol/number composition rules. The rules are shown to the user before they submit.
- Invite link: single use, expires in **7 days**. Password-reset link: single use, expires in **1 hour**. Forgot-password returns an identical response whether or not the email exists.
- Failed logins: after 5 consecutive failures an account is locked for 15 minutes. Auth routes are rate-limited per IP.
- Names: letters (any script, including accents), spaces, hyphens, apostrophes; max 100 characters. Email: validated by the schema library, stored trimmed and lowercased. Input is never silently altered other than that normalization.
- Never delete the **last active Admin**: demoting or deactivating them is refused.
- Audit log: append-only (database triggers reject UPDATE, DELETE, TRUNCATE), written in the same transaction as the action, Admin-only to read (read API arrives in milestone 2). Audit entries never contain passwords, hashes or tokens.
- Secrets only from environment variables. No secrets in source. `.env` is git-ignored.
- All schema changes are versioned drizzle migrations. No hand-edited schema.
- Timeouts on every external call (database statement timeout, mail send timeout).
- No dead code, no commented-out blocks, no unused exports or imports. Delete code in the same change that makes it unused.
- Design tokens are defined once in `apps/web/src/styles/tokens.css`; no screen invents its own colors or spacing. Palette: white background, primary cyan blue `#0E7490`, accent cyan `#06B6D4` (non-text only), IBM Plex Sans, spacing scale 4/8/12/16/24/32/48.
- UI: responsive (mobile, tablet, desktop), visible keyboard focus, AA contrast, reduced-motion support, labels on every field.
- **Before styling any screen, show the user the design plan for it and wait for their go-ahead** (Task 12 has a gate step).
- Commit messages: `<type>: <what changed, plain language>` with type one of feat / fix / refactor / docs / test / chore / style; first line under ~72 characters. Add the attribution trailer your session instructions require.
- Git discipline: work on branch `milestone-1-auth`. Run `git pull --rebase origin main` and `git status` before starting and before the final handoff. Commit after every task. **Do not push or merge to `main` until the user approves the milestone** (Task 14). Never force-push; on a merge conflict stop and show the user.
- Do not install system software (`brew`, editing `~/.zshrc`) without the user's confirmation in this session.

## Review Focus

These inputs are implied by the spec but easy to miss. Each has a test in the task that owns the code.

1. Email typed as `  Anita@Example.COM ` must sign in, invite and reset exactly like `anita@example.com`, and must not create a duplicate account (Task 8, Task 7).
2. Password edge cases: exactly 10 characters accepted, 9 rejected, 128 accepted, 129 rejected; 10 emoji accepted (code points, not UTF-16 units); 10 spaces rejected; `Password123` style common entries rejected case-insensitively (Task 5, Task 8).
3. Single-use links: reusing an accepted invite, a used reset link, a cancelled invite or an expired link all fail with the same generic message (Tasks 8, 9).
4. Refresh-token replay: an old refresh token used again after rotation fails; used after the 10-second grace window it revokes the whole token family; two parallel refreshes from the same client must not log the user out (Task 7).
5. Last-Admin protection under concurrency: two Admins demoting each other at the same instant must leave exactly one Admin (Task 10).
6. Malformed JSON and oversized bodies return a clean JSON 4xx with a request id, never a 500 or a stack trace (Task 2).
7. A deactivated user's still-valid access token is rejected on the very next request (Task 7).

---

## File Structure

```
plms_web/
  package.json                      workspaces + root scripts
  .nvmrc  .gitignore  .env.example (in apps/api)
  eslint.config.mjs
  .github/workflows/ci.yml
  README.md  ARCHITECTURE.md  PROGRESS.md  TASKS.md  DECISIONS.md  CHANGELOG.md
  docs/api/auth.md                  contract for the mobile app developer
  apps/api/
    package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  drizzle.config.ts  .env.example
    drizzle/                        generated migrations (committed)
    src/
      main.ts  app.module.ts  app.setup.ts
      config/        load-env.ts  env.ts  config.module.ts
      common/        request-context.ts  request-context.middleware.ts  app-logger.ts
                     all-exceptions.filter.ts  zod.pipe.ts  fields.ts
      db/            schema.ts  db.module.ts  migrate.ts  errors.ts
      audit/         audit.actions.ts  audit.service.ts  audit.module.ts
      mail/          mailer.ts  console.mailer.ts  smtp.mailer.ts  templates.ts  mail.module.ts
      auth/          auth.types.ts  public.decorator.ts  roles.decorator.ts  current-user.decorator.ts
                     auth.guard.ts  roles.guard.ts  password-policy.ts  common-passwords.json
                     password.service.ts  token.service.ts  opaque-token.ts
                     session.service.ts  auth.service.ts  password-reset.service.ts
                     auth.schemas.ts  auth.controller.ts  auth.module.ts
      invites/       invites.service.ts  invites.schemas.ts  invites.controller.ts  invites.module.ts
      users/         users.service.ts  users.controller.ts  users.module.ts
      health/        health.controller.ts  health.module.ts
      cli/           migrate.ts  bootstrap-admin.ts  create-admin.ts
    test/            env.ts  global-setup.ts  helpers/{app,db,users,auth,memory-mailer}.ts  *.e2e-spec.ts
  apps/web/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/
      main.tsx  App.tsx
      styles/        tokens.css  base.css
      components/    Button  TextField  Alert  (each .tsx + .module.css)
      api/           client.ts  auth.ts
      auth/          AuthContext.tsx  ProtectedRoute.tsx
      pages/         LoginPage  AcceptInvitePage  ForgotPasswordPage  ResetPasswordPage  HomePage  NotFoundPage
      test/          setup.ts  fetch-mock.ts
```

Unit tests live next to their source as `*.spec.ts`; tests needing the database or the HTTP app live in `apps/api/test/` as `*.e2e-spec.ts`.

---

### Task 1: Dev environment and monorepo scaffold

**Files:**
- Create: `package.json`, `.nvmrc`, `.gitignore`, `eslint.config.mjs`
- No tests (tooling task). Verification is by command output.

**Interfaces:**
- Produces: npm workspaces `apps/*`; root scripts `test`, `lint`, `build`, `dev:api`, `dev:web`.

- [ ] **Step 1: Ask the user to confirm installing system software, then install**

Tell the user: "I need to install Node 24 (LTS) and PostgreSQL 17 with Homebrew and add them to your PATH in `~/.zshrc`. OK to proceed?" Only after a yes:

```bash
brew install node@24 postgresql@17
echo 'export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"' >> ~/.zshrc
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"
brew services start postgresql@17
```

- [ ] **Step 2: Verify the toolchain and create the dev database**

```bash
node --version      # Expected: v24.x.x
npm --version       # Expected: 11.x or similar
psql --version      # Expected: psql (PostgreSQL) 17.x
createdb jbf_lms
psql -d jbf_lms -c "select 1"   # Expected: one row with 1
```

If `createdb` fails because the server is not up yet, wait a few seconds and retry (`brew services list` should show `postgresql@17 started`).

- [ ] **Step 3: Sync and branch**

```bash
cd /Users/jbfit/Documents/GitHub/plms_web
git pull --rebase origin main
git status
git checkout -b milestone-1-auth
```

Expected: clean tree except the untracked `vibe-coding-master-prompt.md`; branch created.

- [ ] **Step 4: Create root files**

`package.json`:

```json
{
  "name": "jbf-lms",
  "private": true,
  "workspaces": ["apps/*"],
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev:api": "npm run start:dev -w @jbf/api",
    "dev:web": "npm run dev -w @jbf/web",
    "build": "npm run build -ws --if-present",
    "test": "npm run test -ws --if-present",
    "lint": "eslint apps"
  }
}
```

`.nvmrc`:

```
24
```

`.gitignore`:

```
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
.superpowers/
```

`eslint.config.mjs`:

```js
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/api/drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
```

- [ ] **Step 5: Install root dev tooling**

```bash
npm install -D eslint @eslint/js typescript typescript-eslint eslint-plugin-react-hooks
```

Expected: `node_modules/` and `package-lock.json` created; no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .nvmrc .gitignore eslint.config.mjs
git commit -m "chore: set up monorepo with lint tooling"
```

---

### Task 2: API scaffold — config, logging, error handling, health

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.env.example`
- Create: `apps/api/src/config/{load-env,env,config.module}.ts`
- Create: `apps/api/src/common/{request-context,request-context.middleware,app-logger,all-exceptions.filter,zod.pipe}.ts`
- Create: `apps/api/src/health/{health.controller,health.module}.ts`
- Create: `apps/api/src/{app.module,app.setup,main}.ts`
- Create: `apps/api/test/{env.ts,helpers/app.ts}`
- Test: `apps/api/src/config/env.spec.ts`, `apps/api/test/app.e2e-spec.ts`

**Interfaces:**
- Produces: `ENV` injection token and `Env` type (`parseEnv(raw)`); `configureApp(app, env, logger)`; `AppLogger(level)`; `ZodPipe(schema)`; `requestContext` helpers `runWithRequestMeta(meta, fn)` / `currentRequestMeta(): RequestMeta`; test helper `createTestApp()`.

- [ ] **Step 1: Create the API package and install dependencies**

`apps/api/package.json`:

```json
{
  "name": "@jbf/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest --runInBand",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "ts-node src/cli/migrate.ts",
    "db:migrate:prod": "node dist/cli/migrate.js",
    "admin:create": "ts-node src/cli/create-admin.ts"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "rootDir": ".",
    "roots": ["<rootDir>/src", "<rootDir>/test"],
    "testRegex": ".*\\.(spec|e2e-spec)\\.ts$",
    "setupFiles": ["<rootDir>/test/env.ts"],
    "globalSetup": "<rootDir>/test/global-setup.ts"
  }
}
```

```bash
npm install -w @jbf/api @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/throttler reflect-metadata rxjs zod drizzle-orm pg argon2 jose nodemailer cookie-parser helmet pino
npm install -D -w @jbf/api @nestjs/cli @nestjs/testing @types/node @types/express @types/pg @types/nodemailer @types/cookie-parser @types/supertest @types/jest supertest jest ts-jest ts-node drizzle-kit
```

Before running the install, check each package name exists on the npm registry (`npm view <name> name`) — the master prompt requires verifying dependencies are real.

`apps/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "types": ["node", "jest"]
  },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "types": ["node"] },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

`apps/api/nest-cli.json`:

```json
{ "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```

`apps/api/.env.example`:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://localhost:5432/jbf_lms
JWT_ACCESS_SECRET=change-me-to-a-random-string-of-at-least-32-characters
WEB_ORIGIN=http://localhost:5173
MAIL_TRANSPORT=console
MAIL_FROM=JBF Learning Management System <no-reply@localhost>
# SMTP_URL=smtps://user:pass@smtp.example.com:465
LOG_LEVEL=info
TRUST_PROXY=false
THROTTLE_ENABLED=true
```

Then create your local `.env` (git-ignored) with a real secret:

```bash
cd apps/api && cp .env.example .env && sed -i '' "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env && cd ../..
```

- [ ] **Step 2: Write the failing env test**

`apps/api/src/config/env.spec.ts`:

```ts
import { parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://localhost:5432/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.MAIL_TRANSPORT).toBe('console');
    expect(env.THROTTLE_ENABLED).toBe(true);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires SMTP_URL when the transport is smtp', () => {
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL/);
  });

  it('refuses the console mailer in production because it logs invite links', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'console' })).toThrow(
      /MAIL_TRANSPORT/,
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Create the minimal test support first so Jest can start: `apps/api/test/env.ts`:

```ts
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/jbf_lms_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
process.env.THROTTLE_ENABLED = 'false';
```

`apps/api/test/global-setup.ts` (placeholder replaced in Task 3, needed so Jest config resolves):

```ts
export default async function globalSetup(): Promise<void> {}
```

Run: `npm test -w @jbf/api -- env.spec`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 4: Implement env parsing**

`apps/api/src/config/env.ts`:

```ts
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
```

`apps/api/src/config/load-env.ts`:

```ts
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
```

`apps/api/src/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { parseEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
```

- [ ] **Step 5: Run the env test and watch it pass**

Run: `npm test -w @jbf/api -- env.spec`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing app e2e test**

`apps/api/test/helpers/app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, parseEnv(process.env), new AppLogger('silent'));
  await app.init();
  return { app };
}
```

`apps/api/test/app.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers/app';

describe('app basics', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the liveness check and sets a request id and security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a clean JSON 404 with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.statusCode).toBe(404);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns a clean 400 for malformed JSON instead of a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it('returns a clean 413 for an oversized body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(300_000) }))
      .expect(413);
    expect(res.body.statusCode).toBe(413);
  });
});
```

Run: `npm test -w @jbf/api -- app.e2e`
Expected: FAIL — cannot find `../../src/app.module`.

- [ ] **Step 7: Implement request context, logger, filter and pipe**

`apps/api/src/common/request-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  source: 'portal' | 'mobile' | 'system';
  appVersion: string | null;
}

const SYSTEM_META: RequestMeta = {
  requestId: 'system',
  ip: null,
  userAgent: null,
  source: 'system',
  appVersion: null,
};

const storage = new AsyncLocalStorage<RequestMeta>();

export const runWithRequestMeta = <T>(meta: RequestMeta, fn: () => T): T => storage.run(meta, fn);

export const currentRequestMeta = (): RequestMeta => storage.getStore() ?? SYSTEM_META;
```

`apps/api/src/common/request-context.middleware.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestMeta } from './request-context';

const readHeader = (req: Request, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
};

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  runWithRequestMeta(
    {
      requestId,
      ip: req.ip ?? null,
      userAgent: readHeader(req, 'user-agent'),
      source: readHeader(req, 'x-client') === 'mobile' ? 'mobile' : 'portal',
      appVersion: readHeader(req, 'x-app-version'),
    },
    () => next(),
  );
}
```

`apps/api/src/common/app-logger.ts`:

```ts
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import pino, { type Logger } from 'pino';
import { currentRequestMeta } from './request-context';

export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(level: string) {
    this.logger = pino({ level });
  }

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }

  event(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}

export function requestLogger(logger: AppLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = Date.now();
    const { requestId } = currentRequestMeta();
    res.on('finish', () => {
      logger.event(
        { requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started },
        'request',
      );
    });
    next();
  };
}
```

Note: `req.path` deliberately excludes the query string so tokens never reach the logs.

`apps/api/src/common/all-exceptions.filter.ts`:

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { AppLogger } from './app-logger';
import { currentRequestMeta } from './request-context';

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request.',
  413: 'Request body too large.',
  415: 'Unsupported content type.',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { requestId } = currentRequestMeta();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ ...payload, statusCode: status, requestId });
      return;
    }

    const status = (exception as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({
        statusCode: status,
        error: 'Bad Request',
        message: CLIENT_ERROR_MESSAGES[status] ?? CLIENT_ERROR_MESSAGES[400],
        requestId,
      });
      return;
    }

    this.logger.error(
      `Unhandled error (${requestId}): ${exception instanceof Error ? exception.message : String(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(500).json({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
      requestId,
    });
  }
}
```

`apps/api/src/common/zod.pipe.ts`:

```ts
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new BadRequestException({ error: 'Bad Request', message: 'Validation failed', fieldErrors });
  }
}
```

- [ ] **Step 8: Implement health, app setup, module and main**

`apps/api/src/health/health.controller.ts` (the malformed-body and oversized-body tests post to `/api/health`, which deliberately has no POST handler: the body parser fails before routing, which is what those tests exercise):

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

`apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/api/src/app.setup.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { type AppLogger, requestLogger } from './common/app-logger';
import { requestContextMiddleware } from './common/request-context.middleware';
import type { Env } from './config/env';

export function configureApp(app: NestExpressApplication, env: Env, logger: AppLogger): void {
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(requestLogger(logger));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client', 'X-App-Version'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();
}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [ConfigModule, HealthModule] })
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import './config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/app-logger';
import { parseEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = new AppLogger(env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  configureApp(app, env, logger);
  await app.listen(env.PORT);
  logger.event({ port: env.PORT }, 'API listening');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 9: Run the e2e tests and watch them pass**

Run: `npm test -w @jbf/api`
Expected: PASS — env.spec (4) and app.e2e (4).

If the malformed-JSON or 413 test returns an HTML body or a 500, the parser error is bypassing the filter: report to the user rather than weakening the test; the likely fix is registering the filter via `APP_FILTER` in `AppModule` instead of `useGlobalFilters`.

- [ ] **Step 10: Smoke-run the server**

```bash
npm run start:dev -w @jbf/api
```
In another terminal: `curl -s localhost:3000/api/health` → `{"status":"ok"}`. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add apps/api package.json package-lock.json
git commit -m "feat: add API scaffold with config, logging and error handling"
```

---

### Task 3: Database schema, migrations and append-only audit table

**Files:**
- Create: `apps/api/src/db/{schema,db.module,migrate,errors}.ts`, `apps/api/drizzle.config.ts`, `apps/api/src/cli/migrate.ts`
- Create: `apps/api/drizzle/*` (generated) including the custom append-only migration
- Create/Replace: `apps/api/test/global-setup.ts`, `apps/api/test/helpers/db.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/health/{health.controller,health.module}.ts`, `apps/api/test/helpers/app.ts`
- Test: `apps/api/test/audit-immutability.e2e-spec.ts`, `apps/api/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `ENV`, `Env` (Task 2).
- Produces: tables `users`, `invites`, `refreshTokens`, `passwordResets`, `auditLog`; enums `userRole`, `userStatus`; types `User`, `Invite`, `Role`; `DB` and `PG_POOL` tokens; types `Database`, `DbTransaction`, `DbExecutor`; `runMigrations(databaseUrl)`; `isUniqueViolation(error)`; test helper `createTestDb()`; `createTestApp()` now also returns `db`.

- [ ] **Step 1: Write the schema**

`apps/api/src/db/schema.ts`:

```ts
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
```

Note: `audit_log.actor_id` and `target_id` deliberately have **no foreign keys**, so audit rows survive any change to other tables.

- [ ] **Step 2: Drizzle config, then generate the schema migration**

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/jbf_lms' },
});
```

```bash
cd apps/api
npx drizzle-kit generate --name=initial_schema
npx drizzle-kit generate --custom --name=audit_log_append_only
cd ../..
```

Expected: `apps/api/drizzle/0000_initial_schema.sql`, `0001_audit_log_append_only.sql` (empty) and `drizzle/meta/`. Open `0000_initial_schema.sql` and confirm it creates both enums, five tables, the unique indexes and the **partial** unique index (`WHERE ... accepted_at is null and ... cancelled_at is null`).

- [ ] **Step 3: Write the append-only triggers**

Replace the contents of `apps/api/drizzle/0001_audit_log_append_only.sql` with:

```sql
CREATE FUNCTION audit_log_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
```

- [ ] **Step 4: DB module, migrator, error helper, CLI**

`apps/api/src/db/db.module.ts`:

```ts
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import * as schema from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 5000,
          statement_timeout: 15000,
        }),
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
    PoolShutdown,
  ],
  exports: [DB, PG_POOL],
})
export class DbModule {}
```

`apps/api/src/db/migrate.ts`:

```ts
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}
```

`apps/api/src/db/errors.ts`:

```ts
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}
```

`apps/api/src/cli/migrate.ts`:

```ts
import '../config/load-env';
import { parseEnv } from '../config/env';
import { runMigrations } from '../db/migrate';

runMigrations(parseEnv(process.env).DATABASE_URL)
  .then(() => console.log('Migrations applied.'))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 5: Test database setup and helpers**

`apps/api/test/global-setup.ts` (replaces the placeholder):

```ts
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/jbf_lms_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/i.test(dbName)) {
    throw new Error(`Refusing to reset database "${dbName}": its name must end in _test`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
```

`apps/api/test/helpers/db.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema';

export function createTestDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
```

- [ ] **Step 6: Write the failing immutability test**

`apps/api/test/audit-immutability.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { createTestDb } from './helpers/db';

describe('audit_log is append-only', () => {
  const { pool, close } = createTestDb();
  const id = randomUUID();

  beforeAll(async () => {
    await pool.query(`insert into audit_log (id, action, source) values ($1, 'test.created', 'system')`, [id]);
  });

  afterAll(close);

  it('accepts inserts and reads', async () => {
    const { rows } = await pool.query('select action from audit_log where id = $1', [id]);
    expect(rows).toEqual([{ action: 'test.created' }]);
  });

  it('rejects UPDATE', async () => {
    await expect(pool.query(`update audit_log set action = 'x' where id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE', async () => {
    await expect(pool.query('delete from audit_log where id = $1', [id])).rejects.toThrow(/append-only/);
  });

  it('rejects TRUNCATE', async () => {
    await expect(pool.query('truncate audit_log')).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 7: Run it**

Run: `npm test -w @jbf/api -- audit-immutability`
Expected: PASS (4 tests). If it fails with `database ... does not exist` the server isn't running; if the triggers aren't firing, re-check Step 3's file was saved and that `drizzle/meta/_journal.json` lists both migrations.

To prove the test can fail, temporarily comment out the trigger statements in the SQL, rerun (expect the UPDATE/DELETE/TRUNCATE tests to FAIL), then restore the file.

- [ ] **Step 8: Wire the database into the app and add a readiness check**

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [ConfigModule, DbModule, HealthModule] })
export class AppModule {}
```

`apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.pool.query('select 1');
    } catch {
      throw new ServiceUnavailableException('Database unavailable.');
    }
    return { status: 'ok' };
  }
}
```

`apps/api/test/helpers/app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { DB, type Database } from '../../src/db/db.module';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, parseEnv(process.env), new AppLogger('silent'));
  await app.init();
  return { app, db: app.get<Database>(DB) };
}
```

`apps/api/test/health.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers/app';

describe('GET /api/health/ready', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(() => app.close());

  it('reports ready when the database answers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

Run: `npm test -w @jbf/api`
Expected: PASS — all suites.

- [ ] **Step 9: Apply migrations to the dev database**

```bash
npm run db:migrate -w @jbf/api
psql -d jbf_lms -c "\dt"
```
Expected: "Migrations applied." and tables `users`, `invites`, `refresh_tokens`, `password_resets`, `audit_log`, plus drizzle's migration table.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat: add database schema, migrations and append-only audit table"
```

---

### Task 4: Audit service

**Files:**
- Create: `apps/api/src/audit/{audit.actions,audit.service,audit.module}.ts`
- Test: `apps/api/test/audit.service.e2e-spec.ts`

**Interfaces:**
- Consumes: `DbExecutor` (Task 3), `currentRequestMeta`/`runWithRequestMeta` (Task 2), `auditLog` table.
- Produces:

```ts
type AuditAction = 'auth.login.succeeded' | 'auth.login.failed' | 'auth.logout' | 'auth.logout_all'
  | 'auth.refresh.reuse_detected' | 'auth.password.changed' | 'auth.password.reset_requested'
  | 'auth.password.reset_completed' | 'invite.created' | 'invite.resent' | 'invite.cancelled'
  | 'invite.accepted' | 'user.deactivated' | 'user.reactivated' | 'user.role_changed';
interface AuditEntry {
  actor: { id?: string | null; role?: Role | null; label?: string | null } | null;
  action: AuditAction;
  target?: { type: string; id: string; label: string };
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}
AuditService.record(executor: DbExecutor, entry: AuditEntry): Promise<void>
AuditModule  // exports AuditService
```

- [ ] **Step 1: Write the failing test**

`apps/api/test/audit.service.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { AuditService } from '../src/audit/audit.service';
import { runWithRequestMeta } from '../src/common/request-context';
import { auditLog } from '../src/db/schema';
import { createTestDb } from './helpers/db';

describe('AuditService', () => {
  const { db, close } = createTestDb();
  const audit = new AuditService();

  afterAll(close);

  it('records who, what, where and the request metadata', async () => {
    const actorId = randomUUID();
    const targetId = randomUUID();

    await runWithRequestMeta(
      { requestId: 'req-1', ip: '203.0.113.9', userAgent: 'jest', source: 'mobile', appVersion: '1.2.3' },
      () =>
        audit.record(db, {
          actor: { id: actorId, role: 'admin', label: 'Anita Rao' },
          action: 'user.role_changed',
          target: { type: 'user', id: targetId, label: 'ben@example.com' },
          changes: { role: { before: 'staff', after: 'admin' } },
        }),
    );

    const [row] = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(row).toMatchObject({
      actorId,
      actorRole: 'admin',
      actorLabel: 'Anita Rao',
      action: 'user.role_changed',
      targetType: 'user',
      targetLabel: 'ben@example.com',
      source: 'mobile',
      ip: '203.0.113.9',
      userAgent: 'jest',
      appVersion: '1.2.3',
      requestId: 'req-1',
      changes: { role: { before: 'staff', after: 'admin' } },
    });
  });

  it('marks entries written outside a request as system', async () => {
    const targetId = randomUUID();
    await audit.record(db, {
      actor: null,
      action: 'invite.created',
      target: { type: 'invite', id: targetId, label: 'x@example.com' },
    });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(row.source).toBe('system');
    expect(row.actorId).toBeNull();
  });

  it('rolls back with the surrounding transaction, so an action cannot succeed without its entry or vice versa', async () => {
    const targetId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await audit.record(tx, {
          actor: null,
          action: 'user.deactivated',
          target: { type: 'user', id: targetId, label: 'gone@example.com' },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w @jbf/api -- audit.service`
Expected: FAIL — cannot find `../src/audit/audit.service`.

- [ ] **Step 3: Implement**

`apps/api/src/audit/audit.actions.ts`:

```ts
export type AuditAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.refresh.reuse_detected'
  | 'auth.password.changed'
  | 'auth.password.reset_requested'
  | 'auth.password.reset_completed'
  | 'invite.created'
  | 'invite.resent'
  | 'invite.cancelled'
  | 'invite.accepted'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'user.role_changed';
```

`apps/api/src/audit/audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { currentRequestMeta } from '../common/request-context';
import type { DbExecutor } from '../db/db.module';
import { type AuditChanges, auditLog, type Role } from '../db/schema';
import type { AuditAction } from './audit.actions';

export interface AuditEntry {
  actor: { id?: string | null; role?: Role | null; label?: string | null } | null;
  action: AuditAction;
  target?: { type: string; id: string; label: string };
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async record(executor: DbExecutor, entry: AuditEntry): Promise<void> {
    const meta = currentRequestMeta();
    await executor.insert(auditLog).values({
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      actorLabel: entry.actor?.label ?? null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      targetLabel: entry.target?.label ?? null,
      source: meta.source,
      ip: meta.ip,
      userAgent: meta.userAgent,
      appVersion: meta.appVersion,
      requestId: meta.requestId,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    });
  }
}
```

`apps/api/src/audit/audit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm test -w @jbf/api -- audit.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add audit service that records inside the caller's transaction"
```

---

### Task 5: Password policy, hashing and token primitives

**Files:**
- Create: `apps/api/src/common/fields.ts`
- Create: `apps/api/src/auth/{password-policy,password.service,token.service,opaque-token}.ts`, `apps/api/src/auth/common-passwords.json`
- Test: `apps/api/src/common/fields.spec.ts`, `apps/api/src/auth/{password-policy,password.service,token.service,opaque-token}.spec.ts`

**Interfaces:**
- Consumes: `ENV`/`Env` (Task 2).
- Produces:

```ts
// common/fields.ts
emailSchema: z.ZodType<string>      // trims, lowercases, validates, max 254
nameSchema: z.ZodType<string>
// auth/password-policy.ts
PASSWORD_MIN_LENGTH = 10; PASSWORD_MAX_LENGTH = 128
checkPassword(password: string): string[]      // empty array = acceptable
passwordSchema: z.ZodType<string>
// auth/password.service.ts
PasswordService.hash(password): Promise<string>
PasswordService.verify(hash: string, password: string): Promise<boolean>   // never throws
PasswordService.verifyDummy(password: string): Promise<void>               // timing equalizer
// auth/token.service.ts
TokenService.accessTtlSeconds: number
TokenService.signAccess(userId: string): Promise<string>
TokenService.verifyAccess(token: string): Promise<string | null>           // returns userId
// auth/opaque-token.ts
generateOpaqueToken(): { token: string; hash: string }
hashOpaqueToken(token: string): string
```

- [ ] **Step 1: Generate the common-password list**

Use a scratch directory outside the project for the download (it is untrusted data):

```bash
SCRATCH="$(mktemp -d)"
curl -sfL "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt" -o "$SCRATCH/ncsc.txt"
tr -d '\r' < "$SCRATCH/ncsc.txt" | awk 'length($0) >= 10 { print tolower($0) }' | sort -u \
  | node -e "const l=require('fs').readFileSync(0,'utf8').split('\n').filter(Boolean);process.stdout.write(JSON.stringify(l)+'\n')" \
  > apps/api/src/auth/common-passwords.json
node -e "const a=require('./apps/api/src/auth/common-passwords.json');console.log(a.length, a.includes('password123'), a.includes('qwertyuiop'), a.includes('1234567890'))"
```

Expected: about 9,000 entries, then `true true true`. Only entries of 10+ characters are kept because shorter ones already fail the length rule.

- [ ] **Step 2: Write the failing tests**

`apps/api/src/common/fields.spec.ts`:

```ts
import { emailSchema, nameSchema } from './fields';

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Anita@Example.COM ')).toBe('anita@example.com');
  });

  it.each(['', 'not-an-email', 'a@b', 'a b@example.com'])('rejects %p', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe('nameSchema', () => {
  it.each(["O'Brien", 'Anne-Marie', 'José Núñez', 'Zoë', 'Łukasz', '李小龍', 'D’Angelo'])('accepts %p', (value) => {
    expect(nameSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '   ', 'R2D2', 'Bob <script>', '-Leading', 'a'.repeat(101), 'Line\nBreak'])('rejects %p', (value) => {
    expect(nameSchema.safeParse(value).success).toBe(false);
  });
});
```

`apps/api/src/auth/password-policy.spec.ts`:

```ts
import { checkPassword, passwordSchema } from './password-policy';

describe('checkPassword', () => {
  it('accepts exactly 10 characters and rejects 9', () => {
    expect(checkPassword('abcdefghij')).toEqual([]);
    expect(checkPassword('abcdefghi')).toHaveLength(1);
  });

  it('accepts 128 characters and rejects 129', () => {
    expect(checkPassword('a1'.repeat(64))).toEqual([]);
    expect(checkPassword('a1'.repeat(64) + 'x')).toHaveLength(1);
  });

  it('counts emoji as one character each', () => {
    expect(checkPassword('🔑'.repeat(10))).toEqual([]);
    expect(checkPassword('🔑'.repeat(9))).toHaveLength(1);
  });

  it('rejects whitespace-only passwords', () => {
    expect(checkPassword(' '.repeat(12))).toHaveLength(1);
  });

  it.each(['password123', 'PASSWORD123', 'qwertyuiop', '1234567890'])('rejects common password %p case-insensitively', (value) => {
    expect(checkPassword(value)).toHaveLength(1);
  });

  it('accepts a long passphrase with no symbols or digits', () => {
    expect(checkPassword('correct horse battery')).toEqual([]);
  });

  it('exposes the same rules as a schema with per-rule messages', () => {
    const result = passwordSchema.safeParse('short');
    expect(result.success).toBe(false);
  });
});
```

`apps/api/src/auth/password.service.spec.ts`:

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and verifies', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, 'correct horse battery')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong horse battery')).resolves.toBe(false);
  });

  it('never throws on a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('can run a dummy verification', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
```

`apps/api/src/auth/token.service.spec.ts`:

```ts
import { SignJWT } from 'jose';
import { parseEnv } from '../config/env';
import { TokenService } from './token.service';

const env = parseEnv({
  DATABASE_URL: 'postgres://localhost/x',
  JWT_ACCESS_SECRET: 's'.repeat(40),
  WEB_ORIGIN: 'http://localhost:5173',
});
const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

describe('TokenService', () => {
  const service = new TokenService(env);

  it('round-trips the user id', async () => {
    const token = await service.signAccess('user-1');
    await expect(service.verifyAccess(token)).resolves.toBe('user-1');
  });

  it('rejects a tampered token', async () => {
    const token = await service.signAccess('user-1');
    await expect(service.verifyAccess(token.slice(0, -2) + 'xx')).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('jbf-lms')
      .setAudience('jbf-lms-api')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    await expect(service.verifyAccess(expired)).resolves.toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const other = new TextEncoder().encode('o'.repeat(40));
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('jbf-lms')
      .setAudience('jbf-lms-api')
      .setExpirationTime('15m')
      .sign(other);
    await expect(service.verifyAccess(forged)).resolves.toBeNull();
  });

  it('rejects garbage', async () => {
    await expect(service.verifyAccess('not.a.jwt')).resolves.toBeNull();
  });
});
```

`apps/api/src/auth/opaque-token.spec.ts`:

```ts
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

describe('opaque tokens', () => {
  it('generates unique url-safe tokens whose hash is reproducible', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashOpaqueToken(a.token)).toBe(a.hash);
    expect(a.hash).not.toContain(a.token);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npm test -w @jbf/api -- src/common src/auth`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/api/src/common/fields.ts`:

```ts
import { z } from 'zod';

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’-]*$/u;

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Name must be 100 characters or fewer.')
  .regex(NAME_PATTERN, 'Names can contain letters, spaces, hyphens and apostrophes.');
```

`apps/api/src/auth/password-policy.ts`:

```ts
import { z } from 'zod';
import commonPasswords from './common-passwords.json';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON = new Set<string>(commonPasswords);

export function checkPassword(password: string): string[] {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return [`Use at least ${PASSWORD_MIN_LENGTH} characters.`];
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return [`Use no more than ${PASSWORD_MAX_LENGTH} characters.`];
  }
  if (password.trim().length === 0) {
    return ['Password cannot be only spaces.'];
  }
  if (COMMON.has(password.toLowerCase())) {
    return ['That password is too common. Choose something less guessable.'];
  }
  return [];
}

export const passwordSchema = z.string().superRefine((password, ctx) => {
  for (const message of checkPassword(password)) {
    ctx.addIssue({ code: 'custom', message });
  }
});
```

`apps/api/src/auth/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash('dummy-password-used-only-to-equalize-timing');
    await this.verify(await this.dummyHash, password);
  }
}
```

`apps/api/src/auth/opaque-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}
```

`apps/api/src/auth/token.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const ISSUER = 'jbf-lms';
const AUDIENCE = 'jbf-lms-api';

@Injectable()
export class TokenService {
  readonly accessTtlSeconds = 15 * 60;
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run and watch them pass**

Run: `npm test -w @jbf/api -- src/common src/auth`
Expected: PASS. If a `fields.spec` case differs because of the installed zod version's wording or strictness (for example `a@b`), adjust only the test case after checking the library's behaviour, and tell the user which case changed.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: add password policy, hashing and token primitives"
```

---

### Task 6: Mail module

**Files:**
- Create: `apps/api/src/mail/{mailer,console.mailer,smtp.mailer,templates,mail.module}.ts`
- Create: `apps/api/test/helpers/memory-mailer.ts`
- Modify: `apps/api/test/helpers/app.ts`
- Test: `apps/api/src/mail/templates.spec.ts`, `apps/api/src/mail/smtp.mailer.spec.ts`

**Interfaces:**
- Consumes: `ENV` (Task 2).
- Produces:

```ts
interface MailMessage { to: string; subject: string; text: string; html: string }
interface Mailer { send(message: MailMessage): Promise<void> }
const MAILER: unique symbol
inviteEmail(input: { name: string; link: string; expiresAt: Date }): Omit<MailMessage, 'to'>
resetEmail(input: { name: string; link: string; expiresAt: Date }): Omit<MailMessage, 'to'>
class MemoryMailer implements Mailer { sent: MailMessage[]; last(): MailMessage | undefined; clear(): void }
MailModule  // exports MAILER
```

- [ ] **Step 1: Write the failing tests**

`apps/api/src/mail/templates.spec.ts`:

```ts
import { inviteEmail, resetEmail } from './templates';

const expiresAt = new Date('2026-10-15T10:00:00Z');

describe('email templates', () => {
  it('invite contains the link and expiry in both text and html', () => {
    const mail = inviteEmail({ name: 'Anita', link: 'https://app.example/accept-invite?token=abc', expiresAt });
    expect(mail.subject).toContain('JBF Learning Management System');
    expect(mail.text).toContain('https://app.example/accept-invite?token=abc');
    expect(mail.text).toContain('2026-10-15');
    expect(mail.html).toContain('href="https://app.example/accept-invite?token=abc"');
  });

  it('escapes the name in html so an Admin cannot inject markup', () => {
    const mail = inviteEmail({ name: '<script>alert(1)</script>', link: 'https://x.example/?t=1', expiresAt });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('reset email states that it expires', () => {
    const mail = resetEmail({ name: 'Anita', link: 'https://x.example/reset?token=t', expiresAt });
    expect(mail.text).toContain('https://x.example/reset?token=t');
    expect(mail.text.toLowerCase()).toContain('expires');
  });
});
```

`apps/api/src/mail/smtp.mailer.spec.ts`:

```ts
import { createTransport } from 'nodemailer';
import { SmtpMailer } from './smtp.mailer';

describe('SmtpMailer', () => {
  it('sends the message through the transport with the configured sender', async () => {
    const mailer = new SmtpMailer(createTransport({ jsonTransport: true }), 'JBF <no-reply@example.com>');
    await expect(
      mailer.send({ to: 'a@example.com', subject: 'Hi', text: 'text', html: '<p>html</p>' }),
    ).resolves.toBeUndefined();
  });

  it('fails instead of hanging when the transport never answers', async () => {
    const hanging = { sendMail: () => new Promise(() => undefined) } as never;
    const mailer = new SmtpMailer(hanging, 'JBF <no-reply@example.com>', 50);
    await expect(mailer.send({ to: 'a@example.com', subject: 'Hi', text: 't', html: 'h' })).rejects.toThrow(/timed out/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @jbf/api -- src/mail`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/mail/mailer.ts`:

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');
```

`apps/api/src/mail/console.mailer.ts`:

```ts
import { Logger } from '@nestjs/common';
import type { MailMessage, Mailer } from './mailer';

export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`Email to ${message.to} — ${message.subject}\n${message.text}`);
  }
}
```

`apps/api/src/mail/smtp.mailer.ts`:

```ts
import type { Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './mailer';

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async send(message: MailMessage): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sending email timed out')), this.timeoutMs);
    });
    try {
      await Promise.race([this.transport.sendMail({ from: this.from, ...message }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

`apps/api/src/mail/templates.ts`:

```ts
import type { MailMessage } from './mailer';

interface TemplateInput {
  name: string;
  link: string;
  expiresAt: Date;
}

type Template = Omit<MailMessage, 'to'>;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const expiryText = (expiresAt: Date): string => `${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function build(subject: string, intro: string, action: string, { name, link, expiresAt }: TemplateInput): Template {
  const expiry = expiryText(expiresAt);
  const text = `Hello ${name},\n\n${intro}\n\n${action}: ${link}\n\nThis link works once and expires on ${expiry}.\nIf you were not expecting this email, you can ignore it.`;
  const html = `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p><p>This link works once and expires on ${expiry}.<br>If you were not expecting this email, you can ignore it.</p>`;
  return { subject, text, html };
}

export const inviteEmail = (input: TemplateInput): Template =>
  build(
    'You have been invited to JBF Learning Management System',
    'You have been invited to join the JBF Learning Management System.',
    'Set your password',
    input,
  );

export const resetEmail = (input: TemplateInput): Template =>
  build(
    'Reset your JBF Learning Management System password',
    'We received a request to reset your password.',
    'Reset your password',
    input,
  );
```

`apps/api/src/mail/mail.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ConsoleMailer } from './console.mailer';
import { MAILER, type Mailer } from './mailer';
import { SmtpMailer } from './smtp.mailer';

@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer =>
        env.MAIL_TRANSPORT === 'smtp' && env.SMTP_URL
          ? new SmtpMailer(createTransport(env.SMTP_URL), env.MAIL_FROM)
          : new ConsoleMailer(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
```

`apps/api/test/helpers/memory-mailer.ts`:

```ts
import type { MailMessage, Mailer } from '../../src/mail/mailer';

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  failNext = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail failure (test)');
    }
    this.sent.push(message);
  }

  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }

  clear(): void {
    this.sent = [];
  }
}
```

`send` records synchronously before its first `await` could yield, so fire-and-forget callers are still observable in tests immediately after the request returns.

Replace `apps/api/test/helpers/app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { DB, type Database } from '../../src/db/db.module';
import { MAILER } from '../../src/mail/mailer';
import { MemoryMailer } from './memory-mailer';

export async function createTestApp() {
  const mailer = new MemoryMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, parseEnv(process.env), new AppLogger('silent'));
  await app.init();
  return { app, db: app.get<Database>(DB), mailer };
}
```

`overrideProvider(MAILER)` only works once `MailModule` is imported by something. It is imported in Task 7 (`AuthModule`); the helper is exercised first in Task 7. Until then no test calls it with the override, so it is safe to leave in place.

- [ ] **Step 4: Run and watch them pass**

Run: `npm test -w @jbf/api -- src/mail`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add mail module with console and SMTP senders"
```

---

### Task 7: Authentication — login, sessions, guards, lockout

**Files:**
- Create: `apps/api/src/auth/{auth.types,public.decorator,roles.decorator,current-user.decorator,auth.guard,roles.guard,session.service,auth.service,auth.schemas,auth.controller,auth.module}.ts`
- Create: `apps/api/test/helpers/{users,auth}.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/health/health.controller.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`, `apps/api/test/throttle.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordService`, `TokenService`, `generateOpaqueToken`, `hashOpaqueToken`, `emailSchema`, `passwordSchema`, `PASSWORD_MIN_LENGTH/MAX`, `AuditService`, `ZodPipe`, tables.
- Produces:

```ts
interface AuthUser { id: string; email: string; name: string; role: Role }
@Public()  @Roles(...roles: Role[])  @CurrentUser() user: AuthUser
SessionService.issue(executor: DbExecutor, userId: string, client: 'web'|'mobile', familyId?: string): Promise<string>  // returns the opaque token
SessionService.rotate(token: string, client: 'web'|'mobile'): Promise<{ userId: string; token: string } | null>
SessionService.revokeFamilyOf(token: string): Promise<{ userId: string } | null>
SessionService.revokeAllForUser(executor: DbExecutor, userId: string): Promise<void>
REFRESH_TTL_MS = 30 days
AuthService.login(input): Promise<LoginResult>   // { user: AuthUser; accessToken; expiresIn; refreshToken }
AuthService.refresh(token, client): Promise<LoginResult>
AuthService.logout(token): Promise<void>
AuthService.logoutAll(user: AuthUser): Promise<void>
HTTP: POST /api/auth/login, /refresh, /logout, /logout-all; GET /api/auth/me, /password-policy
cookie name REFRESH_COOKIE = 'jbf_rt'
```

Request/response contract:
- `POST /api/auth/login` body `{ email, password, client?: "web"|"mobile" }` (default web) → `200 { accessToken, expiresIn, user }`; web also sets the cookie, mobile also gets `refreshToken` in the body.
- `POST /api/auth/refresh` body `{ client?, refreshToken? }`; web needs the cookie and header `X-Requested-With: jbf-web`; same response shape as login.
- `POST /api/auth/logout` same inputs as refresh → `204`, always.
- Wrong credentials → `401 { message: "Invalid email or password." }`; locked → `429`.

- [ ] **Step 1: Types, decorators and test helpers**

`apps/api/src/auth/auth.types.ts`:

```ts
import type { Role } from '../db/schema';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ClientKind = 'web' | 'mobile';
```

`apps/api/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`apps/api/src/auth/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { Role } from '../db/schema';

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
```

`apps/api/src/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return (ctx.switchToHttp().getRequest<Request & { user: AuthUser }>()).user;
});
```

`apps/api/test/helpers/users.ts`:

```ts
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Database } from '../../src/db/db.module';
import { type Role, type User, users } from '../../src/db/schema';

export const TEST_PASSWORD = 'correct horse battery';

export async function createUser(
  db: Database,
  overrides: Partial<{ email: string; name: string; role: Role; status: 'active' | 'deactivated'; password: string }> = {},
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `user-${randomUUID()}@example.com`,
      name: overrides.name ?? 'Test User',
      role: overrides.role ?? 'staff',
      status: overrides.status ?? 'active',
      passwordHash: await argon2.hash(overrides.password ?? TEST_PASSWORD),
    })
    .returning();
  return user;
}
```

`apps/api/test/helpers/auth.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEST_PASSWORD } from './users';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export async function loginMobile(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password, client: 'mobile' })
    .expect(200);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

export const bearer = (session: Session): [string, string] => ['Authorization', `Bearer ${session.accessToken}`];
```

- [ ] **Step 2: Write the failing e2e tests**

`apps/api/test/auth.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { hashOpaqueToken } from '../src/auth/opaque-token';
import { auditLog, refreshTokens, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('authentication', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const refreshCookie = (setCookie: string[] | string | undefined): string => {
    const header = ([] as string[]).concat(setCookie ?? []).find((c) => c.startsWith('jbf_rt='));
    if (!header) throw new Error('no refresh cookie');
    return header.split(';')[0];
  };

  describe('login', () => {
    it('signs a web user in, sets an HttpOnly cookie and keeps the refresh token out of the body', async () => {
      const user = await createUser(db, { email: 'web@example.com' });
      const res = await http().post('/api/auth/login').send({ email: 'web@example.com', password: TEST_PASSWORD }).expect(200);
      expect(res.body.user).toEqual({ id: user.id, email: 'web@example.com', name: 'Test User', role: 'staff' });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toBeUndefined();
      const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('jbf_rt='))!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('returns the refresh token in the body for mobile and sets no cookie', async () => {
      const user = await createUser(db);
      const res = await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(200);
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('treats email case and surrounding whitespace as the same account', async () => {
      await createUser(db, { email: 'anita@example.com' });
      await http().post('/api/auth/login').send({ email: '  Anita@Example.COM ', password: TEST_PASSWORD }).expect(200);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const user = await createUser(db);
      const wrong = await http().post('/api/auth/login').send({ email: user.email, password: 'definitely wrong' }).expect(401);
      const unknown = await http().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'definitely wrong' }).expect(401);
      expect(wrong.body.message).toBe('Invalid email or password.');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('rejects a deactivated user even with the right password', async () => {
      const user = await createUser(db, { status: 'deactivated' });
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(401);
    });

    it('rejects malformed bodies with field errors', async () => {
      const res = await http().post('/api/auth/login').send({ email: 'nope', password: '' }).expect(400);
      expect(res.body.fieldErrors.email).toBeDefined();
    });

    it('locks the account after 5 failures, then allows login again once the lock has expired', async () => {
      const user = await createUser(db);
      for (let i = 0; i < 5; i += 1) {
        await http().post('/api/auth/login').send({ email: user.email, password: 'wrong wrong wrong' }).expect(401);
      }
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(429);
      await db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, user.id));
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    });

    it('records success and failure in the audit log without any secrets', async () => {
      const user = await createUser(db);
      await http().post('/api/auth/login').send({ email: user.email, password: 'nope nope nope' }).expect(401);
      await http().post('/api/auth/login').set('X-Client', 'mobile').set('X-App-Version', '2.0.1').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(200);
      const rows = await db.select().from(auditLog).where(eq(auditLog.actorId, user.id));
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.login.failed', 'auth.login.succeeded']));
      const success = rows.find((r) => r.action === 'auth.login.succeeded')!;
      expect(success).toMatchObject({ source: 'mobile', appVersion: '2.0.1', actorRole: 'staff' });
      expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(rows)).not.toContain(user.passwordHash);
    });

    it('records a failed login for an unknown email using the typed email as the label', async () => {
      await http().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope nope nope' }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'auth.login.failed'), eq(auditLog.actorLabel, 'ghost@example.com')));
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('access control', () => {
    it('requires a bearer token on /me and returns the current user', async () => {
      const user = await createUser(db, { role: 'admin' });
      await http().get('/api/auth/me').expect(401);
      const session = await loginMobile(app, user.email);
      const res = await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, name: 'Test User', role: 'admin' });
    });

    it('rejects a garbage bearer token', async () => {
      await http().get('/api/auth/me').set('Authorization', 'Bearer not-a-token').expect(401);
    });

    it('rejects a still-valid access token the moment the user is deactivated', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().get('/api/auth/me').set(...bearer(session)).expect(401);
    });

    it('keeps health public and the password policy public', async () => {
      await http().get('/api/health').expect(200);
      const res = await http().get('/api/auth/password-policy').expect(200);
      expect(res.body).toEqual({ minLength: 10, maxLength: 128 });
    });
  });

  describe('refresh tokens', () => {
    it('rotates on refresh for mobile', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const res = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await http().get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('refreshes a web session from the cookie and requires the CSRF header', async () => {
      const user = await createUser(db);
      const login = await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const cookie = refreshCookie(login.headers['set-cookie']);
      await http().post('/api/auth/refresh').set('Cookie', cookie).send({ client: 'web' }).expect(403);
      const res = await http().post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'jbf-web').send({ client: 'web' }).expect(200);
      expect(refreshCookie(res.headers['set-cookie'])).not.toBe(cookie);
    });

    it('rejects a replayed token inside the grace window without ending the session', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const rotated = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: rotated.body.refreshToken }).expect(200);
    });

    it('revokes the whole family when a rotated token is replayed after the grace window', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const rotated = await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(200);
      await db.update(refreshTokens).set({ revokedAt: new Date(Date.now() - 60_000) }).where(eq(refreshTokens.tokenHash, hashOpaqueToken(first.refreshToken)));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: rotated.body.refreshToken }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.refresh.reuse_detected')));
      expect(rows).toHaveLength(1);
    });

    it('serves two parallel refreshes without logging the user out', async () => {
      const user = await createUser(db);
      const first = await loginMobile(app, user.email);
      const results = await Promise.all([
        http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }),
        http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: first.refreshToken }),
      ]);
      const winner = results.find((r) => r.status === 200);
      expect(winner).toBeDefined();
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: winner!.body.refreshToken }).expect(200);
    });

    it('refuses to refresh for a deactivated user', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
    });

    it('rejects an expired or unknown refresh token', async () => {
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: 'unknown' }).expect(401);
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(refreshTokens.userId, user.id));
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session and is idempotent', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await http().post('/api/auth/logout').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await http().post('/api/auth/logout').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(204);
      await http().post('/api/auth/logout').send({ client: 'mobile' }).expect(204);
    });

    it('logout-all revokes every session for the user', async () => {
      const user = await createUser(db);
      const a = await loginMobile(app, user.email);
      const b = await loginMobile(app, user.email);
      await http().post('/api/auth/logout-all').set(...bearer(a)).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: a.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: b.refreshToken }).expect(401);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.logout_all')));
      expect(rows).toHaveLength(1);
    });
  });
});
```

`apps/api/test/throttle.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers/app';

describe('rate limiting', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.THROTTLE_ENABLED = 'true';
    ({ app } = await createTestApp());
  });

  afterAll(() => app.close());

  it('returns 429 after too many login attempts from one IP', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever whatever' });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      statuses.push((await attempt()).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toContain(429);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npm test -w @jbf/api -- auth.e2e throttle`
Expected: FAIL — `/api/auth/login` returns 404 / modules missing.

- [ ] **Step 4: Implement schemas, session and auth services**

`apps/api/src/auth/auth.schemas.ts`:

```ts
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
```

`apps/api/src/auth/session.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { refreshTokens, users } from '../db/schema';
import type { ClientKind } from './auth.types';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 10_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async issue(executor: DbExecutor, userId: string, client: ClientKind, familyId: string = randomUUID()): Promise<string> {
    const { token, hash } = generateOpaqueToken();
    await executor.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hash,
      client,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return token;
  }

  async rotate(token: string, client: ClientKind): Promise<{ userId: string; token: string } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)))
        .for('update');
      if (!row) {
        return null;
      }
      const now = Date.now();
      if (row.revokedAt) {
        if (now - row.revokedAt.getTime() > REUSE_GRACE_MS) {
          await this.revokeFamily(tx, row.familyId);
          await this.audit.record(tx, {
            actor: { id: row.userId },
            action: 'auth.refresh.reuse_detected',
            target: { type: 'user', id: row.userId, label: row.userId },
          });
        }
        return null;
      }
      if (row.expiresAt.getTime() <= now) {
        return null;
      }
      const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, row.userId));
      if (!user || user.status !== 'active') {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      return { userId: row.userId, token: await this.issue(tx, row.userId, client, row.familyId) };
    });
  }

  async revokeFamilyOf(token: string): Promise<{ userId: string } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)));
      if (!row) {
        return null;
      }
      await this.revokeFamily(tx, row.familyId);
      return { userId: row.userId };
    });
  }

  async revokeAllForUser(executor: DbExecutor, userId: string): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private async revokeFamily(executor: DbExecutor, familyId: string): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
```

`apps/api/src/auth/auth.service.ts`:

```ts
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, type Database } from '../db/db.module';
import { type User, users } from '../db/schema';
import type { AuthUser, ClientKind } from './auth.types';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export const toAuthUser = (user: Pick<User, 'id' | 'email' | 'name' | 'role'>): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

const invalidCredentials = () => new UnauthorizedException('Invalid email or password.');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: { email: string; password: string; client: ClientKind }): Promise<LoginResult> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));

    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record(this.db, {
        actor: { label: input.email },
        action: 'auth.login.failed',
        metadata: { reason: 'unknown_email' },
      });
      throw invalidCredentials();
    }

    const actor = { id: user.id, role: user.role, label: user.email };

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.record(this.db, { actor, action: 'auth.login.failed', metadata: { reason: 'locked' } });
      throw new HttpException(
        { error: 'Too Many Requests', message: 'Too many failed attempts. Try again in 15 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);

    if (user.status !== 'active') {
      await this.audit.record(this.db, { actor, action: 'auth.login.failed', metadata: { reason: 'deactivated' } });
      throw invalidCredentials();
    }

    if (!passwordOk) {
      await this.recordWrongPassword(user, actor);
      throw invalidCredentials();
    }

    const refreshToken = await this.db.transaction(async (tx) => {
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
      const token = await this.sessions.issue(tx, user.id, input.client);
      await this.audit.record(tx, { actor, action: 'auth.login.succeeded', metadata: { client: input.client } });
      return token;
    });

    return this.buildResult(user, refreshToken);
  }

  async refresh(token: string, client: ClientKind): Promise<LoginResult> {
    const rotated = await this.sessions.rotate(token, client);
    if (!rotated) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, rotated.userId));
    return this.buildResult(user, rotated.token);
  }

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }
    const revoked = await this.sessions.revokeFamilyOf(token);
    if (revoked) {
      await this.audit.record(this.db, { actor: { id: revoked.userId }, action: 'auth.logout' });
    }
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, { actor: { id: user.id, role: user.role, label: user.email }, action: 'auth.logout_all' });
    });
  }

  private async recordWrongPassword(
    user: User,
    actor: { id: string; role: User['role']; label: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, user.id))
        .returning({ count: users.failedLoginCount });
      const locked = updated.count >= MAX_FAILED_LOGINS;
      if (locked) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) })
          .where(eq(users.id, user.id));
      }
      await this.audit.record(tx, {
        actor,
        action: 'auth.login.failed',
        metadata: { reason: 'wrong_password', locked },
      });
    });
  }

  private async buildResult(user: User, refreshToken: string): Promise<LoginResult> {
    return {
      user: toAuthUser(user),
      accessToken: await this.tokens.signAccess(user.id),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
    };
  }
}
```

- [ ] **Step 5: Guards, controller and module**

`apps/api/src/auth/auth.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import type { AuthUser } from './auth.types';
import { IS_PUBLIC } from './public.decorator';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? await this.tokens.verifyAccess(token) : null;
    if (!userId) {
      throw new UnauthorizedException();
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    request.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return true;
  }
}
```

`apps/api/src/auth/roles.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../db/schema';
import type { AuthUser } from './auth.types';
import { ROLES } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to do that.');
    }
    return true;
  }
}
```

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { type LoginInput, loginSchema, type SessionTokenInput, sessionTokenSchema } from './auth.schemas';
import { type LoginResult, AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy';
import { Public } from './public.decorator';
import { REFRESH_TTL_MS } from './session.service';

export const REFRESH_COOKIE = 'jbf_rt';
const authThrottle = { default: { limit: 20, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(authThrottle)
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, body.client, await this.auth.login(body));
  }

  @Public()
  @Throttle(authThrottle)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body(new ZodPipe(sessionTokenSchema)) body: SessionTokenInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const token = this.readRefreshToken(req, body);
      if (!token) {
        throw new UnauthorizedException('Session expired. Please sign in again.');
      }
      return this.respond(res, body.client, await this.auth.refresh(token, body.client));
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.clearCookie(res, body.client);
      }
      throw error;
    }
  }

  @Public()
  @Throttle(authThrottle)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body(new ZodPipe(sessionTokenSchema)) body: SessionTokenInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshToken(req, body));
    this.clearCookie(res, body.client);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user);
    this.clearCookie(res, 'web');
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Public()
  @Get('password-policy')
  passwordPolicy(): { minLength: number; maxLength: number } {
    return { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH };
  }

  private readRefreshToken(req: Request, body: SessionTokenInput): string | null {
    if (body.client === 'mobile') {
      return body.refreshToken ?? null;
    }
    if (req.header('x-requested-with') !== 'jbf-web') {
      throw new ForbiddenException('Missing required header.');
    }
    const cookie: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof cookie === 'string' ? cookie : null;
  }

  private respond(res: Response, client: 'web' | 'mobile', result: LoginResult) {
    const { refreshToken, ...rest } = result;
    if (client === 'web') {
      res.cookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: REFRESH_TTL_MS,
      });
      return rest;
    }
    return { ...rest, refreshToken };
  }

  private clearCookie(res: Response, client: 'web' | 'mobile'): void {
    if (client === 'web') {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    }
  }
}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, TokenService, AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard, PasswordService, TokenService, SessionService],
})
export class AuthModule {}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './auth/roles.guard';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        skipIf: () => !env.THROTTLE_ENABLED,
      }),
    }),
    DbModule,
    AuditModule,
    MailModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

Make health public. Modify `apps/api/src/health/health.controller.ts` — add `import { Public } from '../auth/public.decorator';` and put `@Public()` on the class:

```ts
@Public()
@Controller('health')
export class HealthController {
```

- [ ] **Step 6: Run and iterate until green**

Run: `npm test -w @jbf/api`
Expected: PASS for all suites (auth.e2e ~20 tests, throttle 1, earlier suites).

Likely first-run issues, and what they mean:
- `Nest can't resolve dependencies of AuthGuard` → `AuthGuard` needs `TokenService` and `DB`; confirm `AuthModule` exports `TokenService` and that `DbModule` is `@Global()`.
- Test "two parallel refreshes" flaky → the loser must get 401 while the winner's new token still works; if both 200 you lost the row lock — confirm `.for('update')` is on the select.
- Cookie assertions fail on `SameSite=Strict` casing → compare case-insensitively rather than weakening the rule.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat: add login, rotating sessions, role guards and account lockout"
```

---

### Task 8: Invites and accepting an invite

**Files:**
- Create: `apps/api/src/invites/{invites.schemas,invites.service,invites.controller,invites.module}.ts`
- Modify: `apps/api/src/app.module.ts` (import `InvitesModule`)
- Test: `apps/api/test/invites.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthUser`, `Roles`, `Public`, `CurrentUser`, `PasswordService`, `emailSchema`, `nameSchema`, `passwordSchema`, `generateOpaqueToken`, `hashOpaqueToken`, `inviteEmail`, `MAILER`, `AuditService`, `isUniqueViolation`.
- Produces:

```ts
InvitesService.create(actor: AuthUser | null, input: { email: string; name: string; role: Role }, options: { sendEmail: boolean }): Promise<{ invite: InviteView; link: string }>
InvitesService.resend(actor: AuthUser | null, id: string, options: { sendEmail: boolean }): Promise<{ invite: InviteView; link: string }>
InvitesService.cancel(actor: AuthUser, id: string): Promise<void>
InvitesService.list(): Promise<InviteView[]>
InvitesService.findPendingByEmail(email: string): Promise<Invite | null>
InvitesService.preview(token: string): Promise<{ name: string; email: string }>
InvitesService.accept(token: string, password: string): Promise<AuthUser>
interface InviteView { id; email; name; role; status: 'pending'|'expired'|'accepted'|'cancelled'; expiresAt: Date; createdAt: Date; invitedBy: string | null }
HTTP (Admin): POST /api/invites, GET /api/invites, POST /api/invites/:id/resend, DELETE /api/invites/:id
HTTP (public): POST /api/invites/preview {token}, POST /api/invites/accept {token, password}
INVITE_TTL_MS = 7 days
```

The invite link is `${WEB_ORIGIN}/accept-invite?token=<token>`. The HTTP responses never contain the token or its hash.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/invites.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, invites, users } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import type { MemoryMailer } from './helpers/memory-mailer';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('invites', () => {
  let app: NestExpressApplication;
  let db: Database;
  let mailer: MemoryMailer;
  let admin: Session;
  let adminId: string;
  let staff: Session;

  beforeAll(async () => {
    ({ app, db, mailer } = await createTestApp());
    const adminUser = await createUser(db, { role: 'admin', name: 'Admin One' });
    adminId = adminUser.id;
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const tokenFromMail = (): string => new URL(mailer.last()!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  const invite = (body: object) => http().post('/api/invites').set(...bearer(admin)).send(body);

  describe('creating', () => {
    it('lets an Admin invite, emails a single-use link and never returns the token', async () => {
      mailer.clear();
      const res = await invite({ email: 'new.person@example.com', name: 'New Person', role: 'staff' }).expect(201);
      expect(res.body).toMatchObject({ email: 'new.person@example.com', name: 'New Person', role: 'staff', status: 'pending' });
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      expect(mailer.last()!.to).toBe('new.person@example.com');
      expect(mailer.last()!.text).toContain('/accept-invite?token=');
      const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminId), eq(auditLog.action, 'invite.created'), eq(auditLog.targetId, res.body.id)));
      expect(rows).toHaveLength(1);
    });

    it('is Admin-only: Staff get 403 and anonymous callers get 401 on every invite-management route', async () => {
      const body = { email: 'x@example.com', name: 'X', role: 'staff' };
      await http().post('/api/invites').send(body).expect(401);
      await http().post('/api/invites').set(...bearer(staff)).send(body).expect(403);
      await http().get('/api/invites').set(...bearer(staff)).expect(403);
      await http().post('/api/invites/00000000-0000-4000-8000-000000000000/resend').set(...bearer(staff)).expect(403);
      await http().delete('/api/invites/00000000-0000-4000-8000-000000000000').set(...bearer(staff)).expect(403);
    });

    it('normalizes the email so a differently cased address is a duplicate, not a second account', async () => {
      await invite({ email: 'dup@example.com', name: 'Dup', role: 'staff' }).expect(201);
      await invite({ email: '  DUP@Example.com ', name: 'Dup Again', role: 'staff' }).expect(409);
    });

    it('refuses to invite an email that already has an account', async () => {
      const existing = await createUser(db);
      await invite({ email: existing.email, name: 'Existing', role: 'staff' }).expect(409);
    });

    it('validates name, email and role', async () => {
      const res = await invite({ email: 'bad', name: 'R2D2', role: 'owner' }).expect(400);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['email', 'name', 'role']);
    });

    it('tells the Admin when the email could not be sent, but keeps the invite for resending', async () => {
      mailer.failNext = true;
      const res = await invite({ email: 'mailfail@example.com', name: 'Mail Fail', role: 'staff' }).expect(502);
      expect(res.body.message).toMatch(/resend/i);
      const list = await http().get('/api/invites').set(...bearer(admin)).expect(200);
      expect(list.body.map((i: { email: string }) => i.email)).toContain('mailfail@example.com');
    });
  });

  describe('accepting', () => {
    it('previews the invite, then creates the account with the invited role and lets the person sign in', async () => {
      mailer.clear();
      await invite({ email: 'Accept.Me@example.com', name: 'Accept Me', role: 'admin' }).expect(201);
      const token = tokenFromMail();
      const preview = await http().post('/api/invites/preview').send({ token }).expect(200);
      expect(preview.body).toEqual({ name: 'Accept Me', email: 'accept.me@example.com' });

      await http().post('/api/invites/accept').send({ token, password: 'a brand new passphrase' }).expect(201);
      const session = await loginMobile(app, 'accept.me@example.com', 'a brand new passphrase');
      const me = await http().get('/api/auth/me').set(...bearer(session)).expect(200);
      expect(me.body.role).toBe('admin');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'invite.accepted'), eq(auditLog.actorId, me.body.id)));
      expect(rows).toHaveLength(1);
    });

    it('cannot be used twice', async () => {
      mailer.clear();
      await invite({ email: 'once@example.com', name: 'Once', role: 'staff' }).expect(201);
      const token = tokenFromMail();
      await http().post('/api/invites/accept').send({ token, password: 'a brand new passphrase' }).expect(201);
      const again = await http().post('/api/invites/accept').send({ token, password: 'another passphrase here' }).expect(400);
      expect(again.body.message).toBe('This invite link is invalid or has expired.');
      await http().post('/api/invites/preview').send({ token }).expect(400);
    });

    it('rejects expired, cancelled and unknown tokens with the same message', async () => {
      mailer.clear();
      const created = await invite({ email: 'expiring@example.com', name: 'Expiring', role: 'staff' }).expect(201);
      const expiredToken = tokenFromMail();
      await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, created.body.id));
      const expired = await http().post('/api/invites/accept').send({ token: expiredToken, password: 'a brand new passphrase' }).expect(400);

      mailer.clear();
      const toCancel = await invite({ email: 'cancel.me@example.com', name: 'Cancel Me', role: 'staff' }).expect(201);
      const cancelledToken = tokenFromMail();
      await http().delete(`/api/invites/${toCancel.body.id}`).set(...bearer(admin)).expect(204);
      const cancelled = await http().post('/api/invites/accept').send({ token: cancelledToken, password: 'a brand new passphrase' }).expect(400);

      const unknown = await http().post('/api/invites/accept').send({ token: 'nope', password: 'a brand new passphrase' }).expect(400);
      expect(new Set([expired.body.message, cancelled.body.message, unknown.body.message]).size).toBe(1);
    });

    it('enforces the password policy and leaves the invite usable after a rejected password', async () => {
      mailer.clear();
      await invite({ email: 'policy@example.com', name: 'Policy', role: 'staff' }).expect(201);
      const token = tokenFromMail();
      for (const password of ['short', 'password123', ' '.repeat(12), 'a1'.repeat(64) + 'x']) {
        const res = await http().post('/api/invites/accept').send({ token, password }).expect(400);
        expect(res.body.fieldErrors.password).toBeDefined();
      }
      await http().post('/api/invites/accept').send({ token, password: '🔑'.repeat(10) }).expect(201);
    });
  });

  describe('resending and cancelling', () => {
    it('resend issues a new link, extends expiry and invalidates the old link', async () => {
      mailer.clear();
      const created = await invite({ email: 'resend@example.com', name: 'Resend', role: 'staff' }).expect(201);
      const oldToken = tokenFromMail();
      await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, created.body.id));

      mailer.clear();
      const res = await http().post(`/api/invites/${created.body.id}/resend`).set(...bearer(admin)).expect(200);
      expect(res.body.status).toBe('pending');
      const newToken = tokenFromMail();
      expect(newToken).not.toBe(oldToken);
      await http().post('/api/invites/accept').send({ token: oldToken, password: TEST_PASSWORD }).expect(400);
      await http().post('/api/invites/accept').send({ token: newToken, password: TEST_PASSWORD }).expect(201);
    });

    it('cannot resend or cancel an invite that was already accepted', async () => {
      mailer.clear();
      const created = await invite({ email: 'accepted.already@example.com', name: 'Accepted', role: 'staff' }).expect(201);
      await http().post('/api/invites/accept').send({ token: tokenFromMail(), password: TEST_PASSWORD }).expect(201);
      await http().post(`/api/invites/${created.body.id}/resend`).set(...bearer(admin)).expect(409);
      await http().delete(`/api/invites/${created.body.id}`).set(...bearer(admin)).expect(409);
    });

    it('returns 404 for an unknown invite id and 400 for a malformed one', async () => {
      await http().post('/api/invites/00000000-0000-4000-8000-000000000000/resend').set(...bearer(admin)).expect(404);
      await http().delete('/api/invites/not-a-uuid').set(...bearer(admin)).expect(400);
    });

    it('lists invites with derived status', async () => {
      const res = await http().get('/api/invites').set(...bearer(admin)).expect(200);
      const statuses = new Set(res.body.map((i: { status: string }) => i.status));
      expect(statuses).toContain('pending');
      expect(statuses).toContain('accepted');
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('expired');
      expect(await db.select().from(users).where(eq(users.email, 'accept.me@example.com'))).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @jbf/api -- invites.e2e`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement**

`apps/api/src/invites/invites.schemas.ts`:

```ts
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
```

`apps/api/src/invites/invites.service.ts`:

```ts
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/opaque-token';
import { PasswordService } from '../auth/password.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { type Invite, invites, type Role, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { inviteEmail } from '../mail/templates';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_LINK = 'This invite link is invalid or has expired.';

export interface InviteView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'cancelled';
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
}

export const toInviteView = (invite: Invite): InviteView => ({
  id: invite.id,
  email: invite.email,
  name: invite.name,
  role: invite.role,
  status: invite.acceptedAt
    ? 'accepted'
    : invite.cancelledAt
      ? 'cancelled'
      : invite.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'pending',
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
  invitedBy: invite.invitedBy,
});

const actorOf = (actor: AuthUser | null) => (actor ? { id: actor.id, role: actor.role, label: actor.email } : null);

@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async create(
    actor: AuthUser | null,
    input: { email: string; name: string; role: Role },
    options: { sendEmail: boolean },
  ): Promise<{ invite: InviteView; link: string }> {
    const { token, hash } = generateOpaqueToken();
    let created: Invite;
    try {
      created = await this.db.transaction(async (tx) => {
        const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
        if (existingUser) {
          throw new ConflictException('A user with this email already exists.');
        }
        const [row] = await tx
          .insert(invites)
          .values({
            email: input.email,
            name: input.name,
            role: input.role,
            tokenHash: hash,
            invitedBy: actor?.id ?? null,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning();
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'invite.created',
          target: { type: 'invite', id: row.id, label: row.email },
          metadata: { role: row.role },
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An invite for this email is already pending. Resend or cancel it instead.');
      }
      throw error;
    }
    return this.deliver(created, token, options.sendEmail);
  }

  async resend(
    actor: AuthUser | null,
    id: string,
    options: { sendEmail: boolean },
  ): Promise<{ invite: InviteView; link: string }> {
    const { token, hash } = generateOpaqueToken();
    const updated = await this.db.transaction(async (tx) => {
      const invite = await this.requirePending(tx, id);
      const [row] = await tx
        .update(invites)
        .set({ tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        .where(eq(invites.id, invite.id))
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'invite.resent',
        target: { type: 'invite', id: row.id, label: row.email },
      });
      return row;
    });
    return this.deliver(updated, token, options.sendEmail);
  }

  async cancel(actor: AuthUser, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const invite = await this.requirePending(tx, id);
      await tx.update(invites).set({ cancelledAt: new Date() }).where(eq(invites.id, invite.id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'invite.cancelled',
        target: { type: 'invite', id: invite.id, label: invite.email },
      });
    });
  }

  async list(): Promise<InviteView[]> {
    const rows = await this.db.select().from(invites).orderBy(desc(invites.createdAt));
    return rows.map(toInviteView);
  }

  async findPendingByEmail(email: string): Promise<Invite | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.cancelledAt)));
    return row ?? null;
  }

  async preview(token: string): Promise<{ name: string; email: string }> {
    const [invite] = await this.db.select().from(invites).where(eq(invites.tokenHash, hashOpaqueToken(token)));
    if (!invite || toInviteView(invite).status !== 'pending') {
      throw new BadRequestException(INVALID_LINK);
    }
    return { name: invite.name, email: invite.email };
  }

  async accept(token: string, password: string): Promise<AuthUser> {
    const passwordHash = await this.passwords.hash(password);
    try {
      return await this.db.transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(invites)
          .where(eq(invites.tokenHash, hashOpaqueToken(token)))
          .for('update');
        if (!invite || toInviteView(invite).status !== 'pending') {
          throw new BadRequestException(INVALID_LINK);
        }
        const [user] = await tx
          .insert(users)
          .values({ email: invite.email, name: invite.name, role: invite.role, passwordHash })
          .returning();
        await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
        await this.audit.record(tx, {
          actor: { id: user.id, role: user.role, label: user.email },
          action: 'invite.accepted',
          target: { type: 'invite', id: invite.id, label: invite.email },
        });
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(INVALID_LINK);
      }
      throw error;
    }
  }

  private async requirePending(executor: DbExecutor, id: string): Promise<Invite> {
    const [invite] = await executor.select().from(invites).where(eq(invites.id, id)).for('update');
    if (!invite) {
      throw new NotFoundException('Invite not found.');
    }
    if (invite.acceptedAt || invite.cancelledAt) {
      throw new ConflictException('This invite has already been accepted or cancelled.');
    }
    return invite;
  }

  private async deliver(invite: Invite, token: string, sendEmail: boolean): Promise<{ invite: InviteView; link: string }> {
    const link = `${this.env.WEB_ORIGIN}/accept-invite?token=${token}`;
    if (sendEmail) {
      try {
        await this.mailer.send({
          to: invite.email,
          ...inviteEmail({ name: invite.name, link, expiresAt: invite.expiresAt }),
        });
      } catch {
        throw new BadGatewayException('The invite was saved but the email could not be sent. Use Resend to try again.');
      }
    }
    return { invite: toInviteView(invite), link };
  }
}
```

`apps/api/src/invites/invites.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import {
  type AcceptInviteInput,
  acceptInviteSchema,
  type CreateInviteInput,
  createInviteSchema,
  tokenSchema,
} from './invites.schemas';
import { type InviteView, InvitesService } from './invites.service';

const publicThrottle = { default: { limit: 10, ttl: 60_000 } };

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Roles('admin')
  @Post()
  async create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createInviteSchema)) body: CreateInviteInput,
  ): Promise<InviteView> {
    return (await this.invites.create(actor, body, { sendEmail: true })).invite;
  }

  @Roles('admin')
  @Get()
  list(): Promise<InviteView[]> {
    return this.invites.list();
  }

  @Roles('admin')
  @Post(':id/resend')
  @HttpCode(200)
  async resend(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<InviteView> {
    return (await this.invites.resend(actor, id, { sendEmail: true })).invite;
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async cancel(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.invites.cancel(actor, id);
  }

  @Public()
  @Throttle(publicThrottle)
  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(tokenSchema)) body: { token: string }): Promise<{ name: string; email: string }> {
    return this.invites.preview(body.token);
  }

  @Public()
  @Throttle(publicThrottle)
  @Post('accept')
  async accept(@Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput): Promise<AuthUser> {
    return this.invites.accept(body.token, body.password);
  }
}
```

`apps/api/src/invites/invites.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [AuditModule, AuthModule, MailModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
```

Add `InvitesModule` to the `imports` array in `apps/api/src/app.module.ts` (and the matching `import { InvitesModule } from './invites/invites.module';` line).

- [ ] **Step 4: Run and watch them pass**

Run: `npm test -w @jbf/api`
Expected: PASS for all suites.

If the "validates name, email and role" test lists `role` missing from `fieldErrors`, the zod enum error path is `role` — check the pipe joins `issue.path` correctly before touching the test.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add Admin invites and invite acceptance"
```

---

### Task 9: Password reset and password change

**Files:**
- Create: `apps/api/src/auth/password-reset.service.ts`
- Modify: `apps/api/src/auth/auth.schemas.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/test/password.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordService`, `SessionService`, `passwordSchema`, `emailSchema`, `resetEmail`, `MAILER`, `AuditService`, `generateOpaqueToken`, `hashOpaqueToken`.
- Produces:

```ts
PasswordResetService.request(email: string): Promise<void>                       // never reveals whether the email exists
PasswordResetService.reset(token: string, newPassword: string): Promise<void>
PasswordResetService.change(user: AuthUser, currentPassword: string, newPassword: string): Promise<void>
HTTP: POST /api/auth/forgot-password {email} -> 202 { message }
      POST /api/auth/reset-password {token, newPassword} -> 204
      POST /api/auth/change-password {currentPassword, newPassword} -> 204   (authenticated)
RESET_TTL_MS = 1 hour
```

Reset and change both revoke every refresh token for the user and clear any lockout, so the user must sign in again everywhere. The reset link is `${WEB_ORIGIN}/reset-password?token=<token>`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/password.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, passwordResets, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import type { MemoryMailer } from './helpers/memory-mailer';
import { createUser, TEST_PASSWORD } from './helpers/users';

describe('password reset and change', () => {
  let app: NestExpressApplication;
  let db: Database;
  let mailer: MemoryMailer;

  beforeAll(async () => {
    ({ app, db, mailer } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const tokenFromMail = (): string => new URL(mailer.last()!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

  describe('forgot password', () => {
    it('emails a link to a real account, case-insensitively', async () => {
      const user = await createUser(db, { email: 'forgetful@example.com' });
      mailer.clear();
      await http().post('/api/auth/forgot-password').send({ email: ' Forgetful@Example.COM ' }).expect(202);
      expect(mailer.last()!.to).toBe('forgetful@example.com');
      expect(mailer.last()!.text).toContain('/reset-password?token=');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.reset_requested')));
      expect(rows).toHaveLength(1);
    });

    it('answers identically for unknown and deactivated accounts and sends nothing', async () => {
      const deactivated = await createUser(db, { status: 'deactivated' });
      mailer.clear();
      const real = await http().post('/api/auth/forgot-password').send({ email: (await createUser(db)).email }).expect(202);
      const unknown = await http().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(202);
      mailer.clear();
      const off = await http().post('/api/auth/forgot-password').send({ email: deactivated.email }).expect(202);
      expect(unknown.body).toEqual(real.body);
      expect(off.body).toEqual(real.body);
      expect(mailer.sent).toHaveLength(0);
    });

    it('still answers 202 when the mail server is down', async () => {
      const user = await createUser(db);
      mailer.failNext = true;
      await http().post('/api/auth/forgot-password').send({ email: user.email }).expect(202);
    });
  });

  describe('reset password', () => {
    const requestReset = async (email: string): Promise<string> => {
      mailer.clear();
      await http().post('/api/auth/forgot-password').send({ email }).expect(202);
      return tokenFromMail();
    };

    it('sets the new password, ends all sessions, clears lockout and works once only', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);
      await db.update(users).set({ failedLoginCount: 3, lockedUntil: new Date(Date.now() + 60_000) }).where(eq(users.id, user.id));
      const token = await requestReset(user.email);

      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await http().post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' }).expect(401);
      await loginMobile(app, user.email, 'a fresh new passphrase');

      const again = await http().post('/api/auth/reset-password').send({ token, newPassword: 'yet another passphrase' }).expect(400);
      expect(again.body.message).toBe('This reset link is invalid or has expired.');

      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.reset_completed')));
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain('fresh new passphrase');
    });

    it('rejects expired and unknown tokens with the same message', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.userId, user.id));
      const expired = await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(400);
      const unknown = await http().post('/api/auth/reset-password').send({ token: 'nope', newPassword: 'a fresh new passphrase' }).expect(400);
      expect(expired.body.message).toBe(unknown.body.message);
    });

    it('a newer request invalidates the older link', async () => {
      const user = await createUser(db);
      const first = await requestReset(user.email);
      const second = await requestReset(user.email);
      await http().post('/api/auth/reset-password').send({ token: first, newPassword: 'a fresh new passphrase' }).expect(400);
      await http().post('/api/auth/reset-password').send({ token: second, newPassword: 'a fresh new passphrase' }).expect(204);
    });

    it('enforces the password policy and keeps the link usable after a rejected password', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      for (const newPassword of ['short', 'qwertyuiop', '1234567890']) {
        const res = await http().post('/api/auth/reset-password').send({ token, newPassword }).expect(400);
        expect(res.body.fieldErrors.newPassword).toBeDefined();
      }
      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(204);
    });

    it('does not let a deactivated user reset their way back in', async () => {
      const user = await createUser(db);
      const token = await requestReset(user.email);
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
      await http().post('/api/auth/reset-password').send({ token, newPassword: 'a fresh new passphrase' }).expect(400);
    });
  });

  describe('change password', () => {
    it('requires the current password, applies the policy and ends all sessions', async () => {
      const user = await createUser(db);
      const session = await loginMobile(app, user.email);

      await http().post('/api/auth/change-password').send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }).expect(401);

      const wrong = await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: 'not it at all', newPassword: 'a fresh new passphrase' }).expect(400);
      expect(wrong.body.fieldErrors.currentPassword).toBeDefined();

      const weak = await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'password123' }).expect(400);
      expect(weak.body.fieldErrors.newPassword).toBeDefined();

      await http().post('/api/auth/change-password').set(...bearer(session)).send({ currentPassword: TEST_PASSWORD, newPassword: 'a fresh new passphrase' }).expect(204);
      await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken }).expect(401);
      await loginMobile(app, user.email, 'a fresh new passphrase');
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, user.id), eq(auditLog.action, 'auth.password.changed')));
      expect(rows).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @jbf/api -- password.e2e`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement**

Append to `apps/api/src/auth/auth.schemas.ts` (add the import at the top: `import { passwordSchema } from './password-policy';`):

```ts
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
```

`apps/api/src/auth/password-reset.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { passwordResets, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { resetEmail } from '../mail/templates';
import type { AuthUser } from './auth.types';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

export const RESET_TTL_MS = 60 * 60 * 1000;
const INVALID_LINK = 'This reset link is invalid or has expired.';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async request(email: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user || user.status !== 'active') {
      return;
    }
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.db.transaction(async (tx) => {
      await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({ userId: user.id, tokenHash: hash, expiresAt });
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.reset_requested',
      });
    });
    const link = `${this.env.WEB_ORIGIN}/reset-password?token=${token}`;
    this.mailer.send({ to: user.email, ...resetEmail({ name: user.name, link, expiresAt }) }).catch((error: unknown) => {
      this.logger.error(`Could not send reset email: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      const [reset] = await tx
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, hashOpaqueToken(token)))
        .for('update');
      if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException(INVALID_LINK);
      }
      const [user] = await tx.select().from(users).where(eq(users.id, reset.userId));
      if (!user || user.status !== 'active') {
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
      await tx
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.reset_completed',
      });
    });
  }

  async change(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row || !(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        fieldErrors: { currentPassword: ['Current password is incorrect.'] },
      });
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.audit.record(tx, {
        actor: { id: user.id, role: user.role, label: user.email },
        action: 'auth.password.changed',
      });
    });
  }
}
```

In `apps/api/src/auth/auth.controller.ts`: add `PasswordResetService` to the constructor (`private readonly resets: PasswordResetService`), import the three new schemas/types, then add these handlers (all three use `@Throttle` the same way as login; the `change-password` one is authenticated so has no `@Public()`):

```ts
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput): Promise<{ message: string }> {
    await this.resets.request(body.email);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput): Promise<void> {
    await this.resets.reset(body.token, body.newPassword);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.resets.change(user, body.currentPassword, body.newPassword);
  }
```

In `apps/api/src/auth/auth.module.ts`: add `MailModule` to `imports` and `PasswordResetService` to `providers`.

- [ ] **Step 4: Run and watch them pass**

Run: `npm test -w @jbf/api`
Expected: PASS for all suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add forgot, reset and change password"
```

---

### Task 10: User management API with last-Admin protection

**Files:**
- Create: `apps/api/src/users/{users.service,users.controller,users.module}.ts`
- Modify: `apps/api/src/app.module.ts` (import `UsersModule`)
- Test: `apps/api/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `SessionService.revokeAllForUser`, `AuditService`, `Roles`, `CurrentUser`.
- Produces:

```ts
interface UserView { id; email; name; role: Role; status: 'active'|'deactivated'; createdAt: Date }
UsersService.list(): Promise<UserView[]>
UsersService.changeRole(actor: AuthUser, id: string, role: Role): Promise<UserView>
UsersService.deactivate(actor: AuthUser, id: string): Promise<UserView>
UsersService.reactivate(actor: AuthUser, id: string): Promise<UserView>
HTTP (Admin only): GET /api/users, PATCH /api/users/:id/role {role}, POST /api/users/:id/deactivate, POST /api/users/:id/reactivate
```

Refusal message when it would leave no active Admin: `409 "At least one active Admin is required."`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/users.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, users } from '../src/db/schema';
import { bearer, loginMobile } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

describe('user management', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  // The suite shares one database, so each test starts from "exactly these admins are active".
  const isolateAdmins = async (keepIds: string[]) => {
    const all = await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    for (const a of all) {
      if (!keepIds.includes(a.id)) {
        await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, a.id));
      }
    }
  };

  it('is Admin-only on every route', async () => {
    const staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
    const id = '00000000-0000-4000-8000-000000000000';
    await http().get('/api/users').expect(401);
    await http().get('/api/users').set(...bearer(staff)).expect(403);
    await http().patch(`/api/users/${id}/role`).set(...bearer(staff)).send({ role: 'admin' }).expect(403);
    await http().post(`/api/users/${id}/deactivate`).set(...bearer(staff)).expect(403);
    await http().post(`/api/users/${id}/reactivate`).set(...bearer(staff)).expect(403);
  });

  it('lists users without any credential fields', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const res = await http().get('/api/users').set(...bearer(await loginMobile(app, admin.email))).expect(200);
    const row = res.body.find((u: { id: string }) => u.id === admin.id);
    expect(row).toEqual({ id: admin.id, email: admin.email, name: 'Test User', role: 'admin', status: 'active', createdAt: expect.any(String) });
  });

  it('changes a role and records before and after', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff' });
    const session = await loginMobile(app, admin.email);
    const res = await http().patch(`/api/users/${target.id}/role`).set(...bearer(session)).send({ role: 'admin' }).expect(200);
    expect(res.body.role).toBe('admin');
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, 'user.role_changed')));
    expect(row.changes).toEqual({ role: { before: 'staff', after: 'admin' } });
    expect(row.actorId).toBe(admin.id);
  });

  it('rejects an invalid role and an unknown user', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const session = await loginMobile(app, admin.email);
    await http().patch(`/api/users/${admin.id}/role`).set(...bearer(session)).send({ role: 'owner' }).expect(400);
    await http().patch('/api/users/00000000-0000-4000-8000-000000000000/role').set(...bearer(session)).send({ role: 'staff' }).expect(404);
    await http().post('/api/users/not-a-uuid/deactivate').set(...bearer(session)).expect(400);
  });

  it('deactivating locks the user out immediately and revokes their sessions', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff' });
    const adminSession = await loginMobile(app, admin.email);
    const targetSession = await loginMobile(app, target.email);

    await http().post(`/api/users/${target.id}/deactivate`).set(...bearer(adminSession)).expect(200);
    await http().get('/api/auth/me').set(...bearer(targetSession)).expect(401);
    await http().post('/api/auth/refresh').send({ client: 'mobile', refreshToken: targetSession.refreshToken }).expect(401);
    await http().post('/api/auth/login').send({ email: target.email, password: 'correct horse battery', client: 'mobile' }).expect(401);

    await http().post(`/api/users/${target.id}/reactivate`).set(...bearer(adminSession)).expect(200);
    await loginMobile(app, target.email);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, target.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.deactivated', 'user.reactivated']));
  });

  it('is idempotent and does not write duplicate audit rows for a no-op', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const target = await createUser(db, { role: 'staff', status: 'deactivated' });
    const session = await loginMobile(app, admin.email);
    await http().post(`/api/users/${target.id}/deactivate`).set(...bearer(session)).expect(200);
    await http().patch(`/api/users/${target.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(200);
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, target.id))).toHaveLength(0);
  });

  describe('last active Admin', () => {
    it('cannot be demoted or deactivated', async () => {
      const only = await createUser(db, { role: 'admin' });
      await isolateAdmins([only.id]);
      const session = await loginMobile(app, only.email);
      const demote = await http().patch(`/api/users/${only.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(409);
      expect(demote.body.message).toBe('At least one active Admin is required.');
      await http().post(`/api/users/${only.id}/deactivate`).set(...bearer(session)).expect(409);
      expect((await db.select().from(users).where(eq(users.id, only.id)))[0]).toMatchObject({ role: 'admin', status: 'active' });
    });

    it('can be demoted once another active Admin exists', async () => {
      const a = await createUser(db, { role: 'admin' });
      const b = await createUser(db, { role: 'admin' });
      await isolateAdmins([a.id, b.id]);
      const session = await loginMobile(app, a.email);
      await http().patch(`/api/users/${b.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(200);
      await http().patch(`/api/users/${a.id}/role`).set(...bearer(session)).send({ role: 'staff' }).expect(409);
    });

    it('leaves exactly one Admin when two Admins demote each other at the same instant', async () => {
      const a = await createUser(db, { role: 'admin' });
      const b = await createUser(db, { role: 'admin' });
      await isolateAdmins([a.id, b.id]);
      const sessionA = await loginMobile(app, a.email);
      const sessionB = await loginMobile(app, b.email);
      const results = await Promise.all([
        http().patch(`/api/users/${b.id}/role`).set(...bearer(sessionA)).send({ role: 'staff' }),
        http().patch(`/api/users/${a.id}/role`).set(...bearer(sessionB)).send({ role: 'staff' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const remaining = await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
      expect(remaining.filter((u) => [a.id, b.id].includes(u.id))).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @jbf/api -- users.e2e`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement**

`apps/api/src/users/users.service.ts`:

```ts
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
```

`apps/api/src/users/users.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type UserView, UsersService } from './users.service';

const roleSchema = z.object({ role: z.enum(['admin', 'staff']) });

@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserView[]> {
    return this.users.list();
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>,
  ): Promise<UserView> {
    return this.users.changeRole(actor, id, body.role);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.deactivate(actor, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.reactivate(actor, id);
  }
}
```

`apps/api/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

Add `UsersModule` to `imports` in `apps/api/src/app.module.ts`.

- [ ] **Step 4: Run and watch them pass**

Run: `npm test -w @jbf/api`
Expected: PASS for all suites.

The concurrency test is the important one. If it returns `[200, 200]`, the second transaction did not wait for the first's row locks: confirm both `lock()` and `assertAnotherActiveAdmin()` use `.for('update')`, and that `this.db.transaction` is used (not the bare `db`).

The earlier tests deactivate other Admins through `isolateAdmins`, so run the file on its own as well as in the full suite: `npm test -w @jbf/api -- users.e2e`.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add user management with last-Admin protection"
```

---

### Task 11: Bootstrap the first Admin

**Files:**
- Create: `apps/api/src/cli/bootstrap-admin.ts`, `apps/api/src/cli/create-admin.ts`
- Test: `apps/api/test/bootstrap-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `InvitesService.create / resend / findPendingByEmail`, `emailSchema`, `nameSchema`, `users` table.
- Produces: `bootstrapAdmin(deps: { invites: InvitesService; db: Database }, email: string, name: string): Promise<string>` — returns the accept-invite link. Throws `Error('An Admin already exists. Invite more people from the portal.')` when any Admin account exists.

CLI usage: `npm run admin:create -w @jbf/api -- anita@example.com "Anita Rao"` prints the link. No email is sent.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap-admin.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { bootstrapAdmin } from '../src/cli/bootstrap-admin';
import type { Database } from '../src/db/db.module';
import { auditLog, invites, users } from '../src/db/schema';
import { InvitesService } from '../src/invites/invites.service';
import { createTestApp } from './helpers/app';

describe('bootstrapAdmin', () => {
  let app: NestExpressApplication;
  let db: Database;
  let invitesService: InvitesService;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    invitesService = app.get(InvitesService);
  });

  afterAll(() => app.close());

  it('refuses when an Admin already exists', async () => {
    await db.insert(users).values({ email: 'existing.admin@example.com', name: 'Existing', role: 'admin', passwordHash: 'x' });
    await expect(bootstrapAdmin({ invites: invitesService, db }, 'first@example.com', 'First Admin')).rejects.toThrow(
      'An Admin already exists',
    );
  });

  describe('on a system with no Admin', () => {
    beforeAll(async () => {
      await db.update(users).set({ role: 'staff' }).where(eq(users.role, 'admin'));
    });

    it('creates an Admin invite and returns a link that works, without sending email', async () => {
      const link = await bootstrapAdmin({ invites: invitesService, db }, 'First@Example.com', 'First Admin');
      const token = new URL(link).searchParams.get('token')!;
      await request(app.getHttpServer()).post('/api/invites/accept').send({ token, password: 'a long first passphrase' }).expect(201);
      const [created] = await db.select().from(users).where(eq(users.email, 'first@example.com'));
      expect(created.role).toBe('admin');
      const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'invite.created'), eq(auditLog.targetLabel, 'first@example.com')));
      expect(entry.source).toBe('system');
    });

    it('re-running for the same email issues a fresh link instead of failing', async () => {
      await db.update(users).set({ role: 'staff' }).where(eq(users.role, 'admin'));
      const first = await bootstrapAdmin({ invites: invitesService, db }, 'second@example.com', 'Second Admin');
      const second = await bootstrapAdmin({ invites: invitesService, db }, 'second@example.com', 'Second Admin');
      expect(second).not.toBe(first);
      expect(await db.select().from(invites).where(eq(invites.email, 'second@example.com'))).toHaveLength(1);
    });

    it('validates the email and name', async () => {
      await expect(bootstrapAdmin({ invites: invitesService, db }, 'nope', 'R2D2')).rejects.toThrow(/email|name/i);
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @jbf/api -- bootstrap-admin`
Expected: FAIL — cannot find `../src/cli/bootstrap-admin`.

- [ ] **Step 3: Implement**

`apps/api/src/cli/bootstrap-admin.ts`:

```ts
import { eq } from 'drizzle-orm';
import { emailSchema, nameSchema } from '../common/fields';
import type { Database } from '../db/db.module';
import { users } from '../db/schema';
import type { InvitesService } from '../invites/invites.service';

export async function bootstrapAdmin(
  deps: { invites: InvitesService; db: Database },
  rawEmail: string,
  rawName: string,
): Promise<string> {
  const email = emailSchema.safeParse(rawEmail);
  const name = nameSchema.safeParse(rawName);
  if (!email.success || !name.success) {
    const problems = [...(email.success ? [] : email.error.issues), ...(name.success ? [] : name.error.issues)];
    throw new Error(`Invalid email or name: ${problems.map((issue) => issue.message).join(' ')}`);
  }

  const [existingAdmin] = await deps.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (existingAdmin) {
    throw new Error('An Admin already exists. Invite more people from the portal.');
  }

  const pending = await deps.invites.findPendingByEmail(email.data);
  const result = pending
    ? await deps.invites.resend(null, pending.id, { sendEmail: false })
    : await deps.invites.create(null, { email: email.data, name: name.data, role: 'admin' }, { sendEmail: false });
  return result.link;
}
```

`apps/api/src/cli/create-admin.ts`:

```ts
import '../config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DB, type Database } from '../db/db.module';
import { InvitesService } from '../invites/invites.service';
import { bootstrapAdmin } from './bootstrap-admin';

async function main(): Promise<void> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run admin:create -w @jbf/api -- <email> "<Full Name>"');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const link = await bootstrapAdmin({ invites: app.get(InvitesService), db: app.get<Database>(DB) }, email, name);
    console.log(`Open this link to set the first Admin's password (valid for 7 days):\n${link}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```


- [ ] **Step 4: Run and watch it pass**

Run: `npm test -w @jbf/api`
Expected: PASS for all suites.

- [ ] **Step 5: Try the real thing on the dev database**

```bash
npm run admin:create -w @jbf/api -- your.email@example.com "Your Name"
```
Expected: a link starting with `http://localhost:5173/accept-invite?token=`. Keep it for the manual check in Task 13.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: add command to create the first Admin"
```

---

### Task 12: Web foundation — tokens, components, API client, session state

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `apps/web/src/{main.tsx,App.tsx}`, `src/styles/{tokens,base}.css`
- Create: `apps/web/src/components/{Button,TextField,Alert}.tsx` and matching `.module.css`
- Create: `apps/web/src/api/{client,auth}.ts`, `apps/web/src/auth/{AuthContext,ProtectedRoute}.tsx`
- Create: `apps/web/src/test/{setup.ts,fetch-mock.ts}`
- Test: `apps/web/src/api/client.spec.ts`, `apps/web/src/components/TextField.spec.tsx`

**Interfaces:**
- Consumes: the API contract from Tasks 7–9.
- Produces:

```ts
// api/client.ts
class ApiError extends Error { status: number; fieldErrors: Record<string, string[]> }
api<T>(path: string, options?: { method?: string; body?: unknown; auth?: boolean }): Promise<T>
setSessionLostHandler(handler: () => void): void
setAccessToken(token: string | null): void
refreshSession(): Promise<boolean>         // single-flight
// api/auth.ts
interface User { id: string; email: string; name: string; role: 'admin' | 'staff' }
login(email, password): Promise<User>; logout(): Promise<void>; fetchMe(): Promise<User>
previewInvite(token): Promise<{ name: string; email: string }>
acceptInvite(token, password): Promise<void>
forgotPassword(email): Promise<void>; resetPassword(token, newPassword): Promise<void>
fetchPasswordPolicy(): Promise<{ minLength: number; maxLength: number }>
// auth/AuthContext.tsx
useAuth(): { state: { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: User }; signIn(email, password): Promise<void>; signOut(): Promise<void> }
// components
<Button variant?: 'primary'|'secondary' busy?: boolean ...button props>
<TextField label hint? error? ...input props>
<Alert tone: 'error'|'success'|'info'>
```

- [ ] **Step 1: Design plan gate — show the user before styling anything**

Present this plan to the user and **wait for their go-ahead** before writing any CSS in this task:

> **Login and account screens — design plan**
> - **Palette:** white page; pale cool-grey panels `#F4F8FA`; primary cyan blue `#0E7490` (buttons, links, active state — white text on it passes AA); bright cyan `#06B6D4` only for non-text accents; deep blue-slate text `#0F2A33`; muted text `#4A6572`; red `#B42318` only for errors/destructive; green `#15803D` only for success.
> - **Type:** IBM Plex Sans (self-hosted, so no external font requests), weights 400/500/600; scale 14 / 16 / 20 / 28 px.
> - **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48 only.
> - **Layout concept (desktop):** two columns. Left, a solid cyan-blue brand panel with the "JBF Learning Management System" wordmark and one plain sentence about what the portal is for. Right, white, with a single labelled form — fields stacked, hint text under each field before the person types, 1px borders instead of drop shadows, no gradient or decorative blob. On mobile the brand panel collapses to a slim bar above the form.
> - **Behavior:** validation on submit (and on blur for the confirm-password match), never per keystroke; errors appear under the field in words, not just red; visible keyboard focus ring; respects reduced-motion.
> - **Screens covered:** Sign in, Accept invite, Forgot password, Reset password, a minimal signed-in home, and a designed 404.

If the user asks for changes, update the tokens in Step 5 and the layout in Task 13 accordingly.

- [ ] **Step 2: Create the web package and install dependencies**

`apps/web/package.json`:

```json
{
  "name": "@jbf/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

```bash
npm install -w @jbf/web react react-dom react-router-dom @fontsource/ibm-plex-sans
npm install -D -w @jbf/web vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom
```

Verify each package name on the registry first (`npm view <name> name`).

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JBF Learning Management System</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

`apps/web/src/test/fetch-mock.ts`:

```ts
import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export function mockFetch(handler: (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const { status = 200, body } = await handler(String(input), init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
```

- [ ] **Step 3: Write the failing API client tests**

`apps/web/src/api/client.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { api, ApiError, setAccessToken, setSessionLostHandler } from './client';

describe('api client', () => {
  beforeEach(() => {
    setAccessToken(null);
    setSessionLostHandler(() => undefined);
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and parses JSON', async () => {
    setAccessToken('abc');
    const fetchMock = mockFetch(() => ({ body: { hello: 'world' } }));
    await expect(api('/api/thing')).resolves.toEqual({ hello: 'world' });
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('turns an error response into an ApiError carrying field errors', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { email: ['Enter a valid email address.'] } } }));
    await expect(api('/api/x', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { email: ['Enter a valid email address.'] },
    });
    await expect(api('/api/x', { method: 'POST', body: {}, auth: false })).rejects.toBeInstanceOf(ApiError);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('old');
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(url);
      if (url === '/api/auth/refresh') return { body: { accessToken: 'new' } };
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? { body: { ok: true } } : { status: 401, body: { message: 'Unauthorized' } };
    });
    await expect(api('/api/thing')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['/api/thing', '/api/auth/refresh', '/api/thing']);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    setAccessToken('old');
    let refreshCalls = 0;
    mockFetch(async (url, init) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { body: { accessToken: 'new' } };
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer new'
        ? { body: { ok: true } }
        : { status: 401, body: {} };
    });
    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('signals session loss and throws when the refresh fails', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    setSessionLostHandler(lost);
    mockFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    await expect(api('/api/thing')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh for public calls such as login', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { status: 401, body: { message: 'Invalid email or password.' } };
    });
    await expect(api('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      message: 'Invalid email or password.',
    });
    expect(calls).toEqual(['/api/auth/login']);
  });
});
```

`apps/web/src/components/TextField.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('connects the label, hint and error to the input for assistive technology', () => {
    render(<TextField label="Email" hint="Use your work email" error="Enter a valid email address." />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use your work email Enter a valid email address.');
  });

  it('is not marked invalid without an error', () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
```

- [ ] **Step 4: Run and watch them fail**

Run: `npm test -w @jbf/web`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement tokens, base styles and components**

`apps/web/src/styles/tokens.css`:

```css
:root {
  --color-bg: #ffffff;
  --color-surface: #f4f8fa;
  --color-border: #c9d8df;
  --color-text: #0f2a33;
  --color-text-muted: #4a6572;
  --color-primary: #0e7490;
  --color-primary-hover: #0b5f77;
  --color-primary-contrast: #ffffff;
  --color-accent: #06b6d4;
  --color-danger: #b42318;
  --color-danger-surface: #fef3f2;
  --color-success: #15803d;
  --color-success-surface: #f0fdf4;
  --color-info-surface: #ecfeff;

  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.75rem;
  --leading: 1.5;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --radius: 6px;
  --focus-outline: 2px solid var(--color-primary);
}
```

`apps/web/src/styles/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading);
}

h1,
h2 {
  margin: 0 0 var(--space-4);
  line-height: 1.25;
  font-weight: 600;
}

h1 {
  font-size: var(--text-xl);
}

h2 {
  font-size: var(--text-lg);
}

p {
  margin: 0 0 var(--space-4);
}

a {
  color: var(--color-primary);
}

:focus-visible {
  outline: var(--focus-outline);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

`apps/web/src/components/Button.module.css`:

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--space-2) var(--space-6);
  border: 1px solid transparent;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s;
}

.primary {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.secondary {
  background: var(--color-bg);
  border-color: var(--color-border);
  color: var(--color-text);
}

.secondary:hover:not(:disabled) {
  background: var(--color-surface);
}

.button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

`apps/web/src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  busy?: boolean;
};

export function Button({ variant = 'primary', busy = false, disabled, type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
    />
  );
}
```

`apps/web/src/components/TextField.module.css`:

```css
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}

.label {
  font-weight: 500;
}

.input {
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}

.input[aria-invalid='true'] {
  border-color: var(--color-danger);
}

.hint {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.error {
  color: var(--color-danger);
  font-size: var(--text-sm);
}
```

`apps/web/src/components/TextField.tsx`:

```tsx
import { type InputHTMLAttributes, useId } from 'react';
import styles from './TextField.module.css';

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, id, ...rest }: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input {...rest} id={inputId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/Alert.module.css`:

```css
.alert {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid;
  border-radius: var(--radius);
}

.error {
  background: var(--color-danger-surface);
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.success {
  background: var(--color-success-surface);
  border-color: var(--color-success);
  color: var(--color-success);
}

.info {
  background: var(--color-info-surface);
  border-color: var(--color-primary);
  color: var(--color-text);
}
```

`apps/web/src/components/Alert.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Alert.module.css';

export function Alert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Implement the API client**

`apps/web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

const REFRESH_PATH = '/api/auth/refresh';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: () => void = () => undefined;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const setSessionLostHandler = (handler: () => void): void => {
  onSessionLost = handler;
};

async function send(path: string, { method = 'GET', body, auth = true }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'jbf-web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { message?: unknown; fieldErrors?: Record<string, string[]> };
    throw new ApiError(
      response.status,
      typeof payload.message === 'string' ? payload.message : 'Something went wrong. Please try again.',
      payload.fieldErrors ?? {},
    );
  }
  return data as T;
}

export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await send(REFRESH_PATH, { method: 'POST', body: { client: 'web' }, auth: false });
      if (!response.ok) return false;
      const data = await parse<{ accessToken: string }>(response);
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  let response = await send(path, options);
  if (response.status === 401 && auth && path !== REFRESH_PATH) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      accessToken = null;
      onSessionLost();
    }
  }
  return parse<T>(response);
}
```

`apps/web/src/api/auth.ts`:

```ts
import { api, refreshSession, setAccessToken } from './client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
}

export async function login(email: string, password: string): Promise<User> {
  const result = await api<{ accessToken: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: { email, password, client: 'web' },
    auth: false,
  });
  setAccessToken(result.accessToken);
  return result.user;
}

export async function restoreSession(): Promise<User | null> {
  if (!(await refreshSession())) return null;
  return fetchMe();
}

export async function logout(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST', body: { client: 'web' }, auth: false });
  } finally {
    setAccessToken(null);
  }
}

export const fetchMe = (): Promise<User> => api<User>('/api/auth/me');

export const previewInvite = (token: string): Promise<{ name: string; email: string }> =>
  api('/api/invites/preview', { method: 'POST', body: { token }, auth: false });

export const acceptInvite = (token: string, password: string): Promise<void> =>
  api('/api/invites/accept', { method: 'POST', body: { token, password }, auth: false });

export const forgotPassword = (email: string): Promise<void> =>
  api('/api/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

export const resetPassword = (token: string, newPassword: string): Promise<void> =>
  api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword }, auth: false });

export const fetchPasswordPolicy = (): Promise<{ minLength: number; maxLength: number }> =>
  api('/api/auth/password-policy', { auth: false });
```

`apps/web/src/auth/AuthContext.tsx`:

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { login, logout, restoreSession, type User } from '../api/auth';
import { setSessionLostHandler } from '../api/client';

type AuthState = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: User };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    setSessionLostHandler(() => setState({ status: 'anonymous' }));
    let cancelled = false;
    restoreSession()
      .then((user) => {
        if (!cancelled) setState(user ? { status: 'authenticated', user } : { status: 'anonymous' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anonymous' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await login(email, password);
    setState({ status: 'authenticated', user });
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => undefined);
    setState({ status: 'anonymous' });
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
```

`apps/web/src/auth/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { state } = useAuth();
  if (state.status === 'loading') return <p role="status">Loading…</p>;
  if (state.status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 7: Run and watch the tests pass**

Run: `npm test -w @jbf/web`
Expected: PASS — client.spec (6) and TextField.spec (2).

- [ ] **Step 8: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat: add web foundation with design tokens and API client"
```

---

### Task 13: Web screens — sign in, accept invite, forgot and reset password, home, 404

**Files:**
- Create: `apps/web/src/pages/{AuthLayout.module.css,AuthLayout.tsx,LoginPage.tsx,AcceptInvitePage.tsx,ForgotPasswordPage.tsx,ResetPasswordPage.tsx,HomePage.tsx,HomePage.module.css,NotFoundPage.tsx}`
- Modify: `apps/web/src/App.tsx` (create), `apps/web/src/main.tsx` (create)
- Test: `apps/web/src/pages/LoginPage.spec.tsx`, `apps/web/src/pages/AcceptInvitePage.spec.tsx`, `apps/web/src/pages/ForgotPasswordPage.spec.tsx`

**Interfaces:**
- Consumes: Task 12 components, `useAuth`, `api/auth.ts` functions, `ApiError`.
- Produces: routes `/login`, `/accept-invite?token=`, `/forgot-password`, `/reset-password?token=`, `/` (protected), `*` (404).

Only build these after the user has approved the design plan in Task 12 Step 1.

- [ ] **Step 1: Write the failing page tests**

`apps/web/src/pages/LoginPage.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { mockFetch } from '../test/fetch-mock';
import { LoginPage } from './LoginPage';

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Signed-in home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the server message when the credentials are wrong', async () => {
    mockFetch((url) =>
      url.endsWith('/refresh')
        ? { status: 401, body: {} }
        : { status: 401, body: { message: 'Invalid email or password.' } },
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('asks for both fields before calling the server', async () => {
    const fetchMock = mockFetch(() => ({ status: 401, body: {} }));
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/enter your email/i);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/enter your password/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/login'))).toHaveLength(0);
  });

  it('goes to the home page after a successful sign in', async () => {
    mockFetch((url) => {
      if (url.endsWith('/refresh')) return { status: 401, body: {} };
      return { body: { accessToken: 't', user: { id: '1', email: 'a@example.com', name: 'Anita', role: 'staff' } } };
    });
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('Signed-in home')).toBeInTheDocument());
  });
});
```

`apps/web/src/pages/AcceptInvitePage.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { AcceptInvitePage } from './AcceptInvitePage';

const renderPage = (search = '?token=abc') =>
  render(
    <MemoryRouter initialEntries={[`/accept-invite${search}`]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/login" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const server = (accept: () => { status?: number; body?: unknown } = () => ({ status: 201, body: {} })) =>
  mockFetch((url) => {
    if (url.endsWith('/password-policy')) return { body: { minLength: 10, maxLength: 128 } };
    if (url.endsWith('/preview')) return { body: { name: 'Anita Rao', email: 'anita@example.com' } };
    return accept();
  });

describe('AcceptInvitePage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('greets the invited person and states the password rules before they type', async () => {
    server();
    renderPage();
    expect(await screen.findByText(/Welcome, Anita Rao/)).toBeInTheDocument();
    expect(screen.getByText('anita@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
  });

  it('rejects a short password and a mismatched confirmation without calling the server', async () => {
    const fetchMock = server();
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription(/do not match/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/accept'))).toHaveLength(0);
  });

  it('shows the server-side password problem, such as a common password', async () => {
    server(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { password: ['That password is too common. Choose something less guessable.'] } } }));
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
  });

  it('sends the person to sign in after success', async () => {
    server();
    renderPage();
    await userEvent.type(await screen.findByLabelText('New password'), 'a long new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a long new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
  });

  it('explains a dead link instead of showing a form', async () => {
    mockFetch((url) =>
      url.endsWith('/password-policy')
        ? { body: { minLength: 10, maxLength: 128 } }
        : { status: 400, body: { message: 'This invite link is invalid or has expired.' } },
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite link is invalid or has expired.');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('explains a missing token', async () => {
    server();
    renderPage('');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });
});
```

`apps/web/src/pages/ForgotPasswordPage.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { ForgotPasswordPage } from './ForgotPasswordPage';

describe('ForgotPasswordPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the same neutral confirmation whatever the server says about the account', async () => {
    mockFetch(() => ({ status: 202, body: { message: 'If an account exists for that email, a reset link has been sent.' } }));
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText('Email'), 'anyone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists/i);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @jbf/web -- pages`
Expected: FAIL — page modules not found.

- [ ] **Step 3: Implement the shared layout**

`apps/web/src/pages/AuthLayout.module.css`:

```css
.layout {
  display: grid;
  grid-template-columns: minmax(280px, 5fr) 7fr;
  min-height: 100vh;
}

.brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-12);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.wordmark {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  line-height: 1.2;
}

.tagline {
  margin: 0;
  max-width: 28ch;
}

.main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) var(--space-6);
}

.panel {
  width: 100%;
  max-width: 400px;
}

@media (max-width: 760px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .brand {
    padding: var(--space-4) var(--space-6);
  }

  .tagline {
    display: none;
  }

  .wordmark {
    font-size: var(--text-lg);
  }
}
```

`apps/web/src/pages/AuthLayout.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.brand}>
        <p className={styles.wordmark}>JBF Learning Management System</p>
        <p className={styles.tagline}>Courses, video, film, podcasts and music, all in one place.</p>
      </aside>
      <main className={styles.main}>
        <div className={styles.panel}>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Implement the pages**

`apps/web/src/pages/LoginPage.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { state, signIn } = useAuth();
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      email: email.trim() ? undefined : 'Enter your email address.',
      password: password ? undefined : 'Enter your password.',
    };
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Button type="submit" busy={busy}>
          Sign in
        </Button>
      </form>
      <p>
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
    </AuthLayout>
  );
}
```

`apps/web/src/pages/AcceptInvitePage.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite, fetchPasswordPolicy, previewInvite } from '../api/auth';
import { ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

const DEAD_LINK = 'This invite link is invalid or has expired.';

export function AcceptInvitePage() {
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null);
  const [minLength, setMinLength] = useState(10);
  const [linkError, setLinkError] = useState<string | null>(token ? null : DEAD_LINK);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
    previewInvite(token)
      .then(setInvite)
      .catch((error: unknown) => setLinkError(error instanceof ApiError ? error.message : DEAD_LINK));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: [...password].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: password === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(next);
    if (next.password || next.confirm || !token) return;
    setBusy(true);
    try {
      await acceptInvite(token, password);
      navigate('/login', { replace: true, state: { notice: 'Your password is set. Sign in to continue.' } });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.password) {
        setErrors({ password: error.fieldErrors.password.join(' ') });
      } else {
        setLinkError(error instanceof ApiError ? error.message : DEAD_LINK);
      }
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <AuthLayout title="Set your password">
        <Alert tone="error">{linkError}</Alert>
        <p>Ask an Admin to send you a new invite.</p>
      </AuthLayout>
    );
  }

  if (!invite) {
    return (
      <AuthLayout title="Set your password">
        <p role="status">Checking your invite…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set your password">
      <p>
        Welcome, {invite.name}. You are signing up as <strong>{invite.email}</strong>.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${minLength} characters. A short sentence works well. Common passwords are not allowed.`}
          error={errors.password}
        />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" busy={busy}>
          Set password
        </Button>
      </form>
    </AuthLayout>
  );
}
```

`apps/web/src/pages/ForgotPasswordPage.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/auth';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await forgotPassword(email);
    } catch {
      // The same confirmation is shown on failure so the page never reveals anything about accounts.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <Alert tone="info">If an account exists for that email, a reset link has been sent. The link works once and expires in 1 hour.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" busy={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
```

`apps/web/src/pages/ResetPasswordPage.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchPasswordPolicy, resetPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

const DEAD_LINK = 'This reset link is invalid or has expired.';

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const [minLength, setMinLength] = useState(10);
  const [linkError, setLinkError] = useState<string | null>(token ? null : DEAD_LINK);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: [...password].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: password === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(next);
    if (next.password || next.confirm || !token) return;
    setBusy(true);
    try {
      await resetPassword(token, password);
      navigate('/login', { replace: true, state: { notice: 'Your password has been changed. Sign in with the new one.' } });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.newPassword) {
        setErrors({ password: error.fieldErrors.newPassword.join(' ') });
      } else {
        setLinkError(error instanceof ApiError ? error.message : DEAD_LINK);
      }
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <AuthLayout title="Choose a new password">
        <Alert tone="error">{linkError}</Alert>
        <p>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${minLength} characters. Common passwords are not allowed.`}
          error={errors.password}
        />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
```

`apps/web/src/pages/HomePage.module.css`:

```css
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.brand {
  margin: 0;
  color: var(--color-primary);
  font-weight: 600;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.content {
  padding: var(--space-8) var(--space-6);
  max-width: 720px;
}
```

`apps/web/src/pages/HomePage.tsx`:

```tsx
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import styles from './HomePage.module.css';

export function HomePage() {
  const { state, signOut } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <>
      <header className={styles.bar}>
        <p className={styles.brand}>JBF Learning Management System</p>
        <div className={styles.who}>
          <span>
            {state.user.name} ({state.user.role === 'admin' ? 'Admin' : 'Staff'})
          </span>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.content}>
        <h1>Welcome, {state.user.name}</h1>
        <p>Your library will appear here as soon as content features arrive in the next milestones.</p>
      </main>
    </>
  );
}
```

`apps/web/src/pages/NotFoundPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

export function NotFoundPage() {
  return (
    <AuthLayout title="Page not found">
      <p>We could not find that page. It may have moved, or the link may be wrong.</p>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </AuthLayout>
  );
}
```

`apps/web/src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

`apps/web/src/main.tsx`:

```tsx
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: Run and watch the tests pass**

Run: `npm test -w @jbf/web && npm run build -w @jbf/web`
Expected: all web tests PASS; the build completes with no type errors.

- [ ] **Step 6: Manual end-to-end check with the user**

Two terminals: `npm run dev:api` and `npm run dev:web`. Use the link printed in Task 11 Step 5.

1. Open the link, set a password shorter than 10 characters → see the message under the field; then use `password123` → see the "too common" message; then a real passphrase → land on Sign in with the success notice.
2. Sign in → see the home page with name and role. Refresh the browser → still signed in.
3. Sign out → back at Sign in. Visit `/` → redirected to `/login`.
4. Try a wrong password → the red alert; try 5 wrong passwords → the lockout message.
5. Resize the window to phone width → the brand panel becomes a slim bar and nothing overflows. Tab through the form → focus ring visible on every control.
6. Check the audit trail: `psql -d jbf_lms -c "select occurred_at, action, actor_label, source from audit_log order by occurred_at"`.

Report what you saw to the user, including anything that looked wrong.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add sign in, invite, and password reset screens"
```

---

### Task 14: CI, documentation and milestone handoff

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md` (replace the stub from the remote), `ARCHITECTURE.md`, `PROGRESS.md`, `TASKS.md`, `DECISIONS.md`, `CHANGELOG.md`, `docs/api/auth.md`
- Verification only otherwise.

**Interfaces:**
- Consumes: everything above.
- Produces: green CI, the five working-memory files from the master prompt, and the API contract the mobile developer needs.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/jbf_lms_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
      - run: npm audit --audit-level=high
```

- [ ] **Step 2: Run the whole pipeline locally**

```bash
npm run lint && npm run build && npm test && npm audit --audit-level=high
```

Expected: lint clean, builds succeed, every API and web test passes, and no high-severity advisories. Fix lint errors by correcting the code, not by loosening the rules. If `npm audit` reports a high-severity issue in a dependency, show it to the user with the proposed upgrade instead of silently ignoring it.

Also run a dead-code check by eye: no unused exports in `apps/api/src` (for example `REFRESH_TTL_MS`, `INVITE_TTL_MS` and `RESET_TTL_MS` must each be used outside their own file or tests, otherwise un-export them) and no leftover `console.log` outside `src/cli/`.

- [ ] **Step 3: Write the API contract for the mobile developer**

`docs/api/auth.md` — write a concise reference containing, for each endpoint in Tasks 7–10: method and path, auth requirement (public / any signed-in user / Admin), request body, success response, and error responses. Include these specifics verbatim:
- Mobile always sends `"client": "mobile"` in login/refresh/logout bodies and the headers `X-Client: mobile` and `X-App-Version: <version>`.
- Access token lifetime is 900 seconds; call refresh when a request returns 401, then retry once.
- Refresh tokens rotate on every refresh: always store the newest one. Two refreshes with the same token in quick succession will fail for the second one, so serialize refresh calls.
- Error bodies look like `{ statusCode, error, message, fieldErrors?, requestId }`; show `message`, and quote `requestId` in support requests.
- A deactivated user receives 401 on every call and on refresh; the app should sign out, but downloaded files remain on the device.

- [ ] **Step 4: Write the working-memory files**

`README.md`: what the project is; prerequisites (Node 24 via `.nvmrc`, PostgreSQL 17); first-time setup (`npm install`, create `apps/api/.env` from `.env.example`, `createdb jbf_lms`, `npm run db:migrate -w @jbf/api`, `npm run admin:create -w @jbf/api -- <email> "<name>"`); running (`npm run dev:api`, `npm run dev:web`); testing (`npm test`); where the spec, plan and API contract live.

`ARCHITECTURE.md`: a one-page summary of the stack and module boundaries, linking to `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md` as the source of truth. Keep it as a pointer plus the module map from this plan's File Structure section; do not duplicate the spec.

`TASKS.md`: the seven milestones from spec section 11 as checkboxes, with milestone 1 checked.

`PROGRESS.md`: done (milestone 1 contents), in progress (none), next (milestone 2: Staff management screens and the Audit log screen), open questions (below).

`CHANGELOG.md`: one dated line per meaningful change in this milestone (`2026-10-08` or the actual date), newest last.

`DECISIONS.md`: dated entries, each with the reason, for: single organization; Admin/Staff only; Staff can edit but not delete; Trash is a soft delete; Option 2 stack (React + NestJS + Postgres + S3-compatible storage); MP4-only in version 1; offline downloads visible in the file manager, unprotected; email-invite login, no self-signup, no 2FA yet; Drizzle over Prisma (SQL-like, plain versioned SQL migrations, easy custom migrations for the audit triggers); npm workspaces instead of pnpm (Homebrew's pnpm depends on a different Node major); Node 24 LTS; access check hits the database on every request (immediate deactivation, immediate role changes); web and API must be deployed under the same site (for example `app.example.org` and `api.example.org`) because the refresh cookie is `SameSite=Strict`; audit append-only enforced by triggers now, with the restricted database role deferred to milestone 7; shared types package deferred until a milestone needs it; password blocklist derived from the SecLists NCSC 100k list (filtered to 10+ characters), with source and licence noted; in-memory rate limiting (move to a shared store if the API is ever scaled to several instances); OpenAPI document deferred (see below).

Open questions to record in `PROGRESS.md`: (1) The spec asks for a published OpenAPI document; this milestone ships `docs/api/auth.md` by hand instead, and generating OpenAPI is proposed for milestone 6 alongside the sync endpoints — confirm with the user. (2) The audit log's restricted database role (INSERT/SELECT only) is deferred to milestone 7 deployment hardening; the append-only triggers already block changes for every role. (3) Storage provider choice (R2 vs S3) and the real size limits are still to be decided before milestone 3. (4) Which SMTP provider will send invites in production. (5) The mobile app's framework, to confirm the login contract fits.

- [ ] **Step 5: Final review and handoff — STOP here**

Dispatch one fresh reviewer (or use `superpowers:requesting-code-review`) over the whole branch diff against `main`, with the Global Constraints and Review Focus sections of this plan as the checklist. Fix anything real they find, rerun Step 2, and commit:

```bash
git add -A
git commit -m "docs: add CI, README, API contract and working-memory files"
git status
```

Expected: clean working tree on `milestone-1-auth` (apart from the untracked `vibe-coding-master-prompt.md` unless the user asked for it to be committed).

Then tell the user, in plain language: what was built, how to run it, what was tested, which assumptions were made (the DECISIONS.md list), and the open questions. **Wait for their approval.** Only after approval:

```bash
git pull --rebase origin main
git checkout main
git merge --ff-only milestone-1-auth
git push origin main
```

If the pull shows a conflict, stop and show the user exactly what conflicts and why.

---

## Self-Review

**Spec coverage (section 11, milestone 1: "Project setup, database, login, invites, Admin/Staff roles, and the audit-logging foundation"):**
- Project setup — Tasks 1, 2, 14 (monorepo, config, logging, error handling, CI, docs).
- Database — Task 3 (schema, versioned migrations, append-only triggers).
- Login, sessions, lockout, rate limits, same login for both clients — Task 7; password rules — Task 5; reset and change — Task 9.
- Invites and enrollment, no self-signup — Task 8; first-Admin bootstrap — Task 11.
- Admin/Staff roles enforced server-side, deny-by-default, last-Admin protection, deactivation cutting off access — Tasks 7 and 10.
- Audit foundation, same-transaction writes, no secrets, Admin-only read — Tasks 3, 4 and every service; the read API and screen are milestone 2 as the spec says.
- Portal sign-in, invite acceptance and reset screens with tokens, accessibility and responsiveness — Tasks 12 and 13.
- Deviations from the spec are listed in `DECISIONS.md` and `PROGRESS.md` (OpenAPI timing, database-role split timing, shared-types package) rather than hidden.

**Placeholder scan:** no TBD/TODO steps; every code step shows the final file contents.

**Type consistency:** `AuthUser`, `ClientKind`, `LoginResult`, `DbExecutor`, `InviteView`, `UserView`, `AuditEntry` and the service method signatures match between the Interfaces blocks and the code. `fieldErrors` keys used by the web (`password`, `newPassword`) match the API schemas (`password` on invite accept, `newPassword` on reset and change).

**Review Focus coverage:** items 1–7 map to tests in Tasks 7, 8, 9, 10 and 2 as noted in the list.
