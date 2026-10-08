# Architecture

The source of truth is the design spec: `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md` (section 10 covers architecture and operations). This page is only a pointer and a map of the code; it does not repeat the spec.

## Stack in one paragraph

An npm workspaces monorepo. `apps/web` is a React + TypeScript single-page app built with Vite. `apps/api` is a NestJS 11 API (TypeScript, Express) that stores data in PostgreSQL 17 through Drizzle ORM with plain, versioned SQL migrations. One login serves both the portal and the mobile app: a short-lived access token (JWT, 15 minutes) plus a rotating refresh token (HttpOnly cookie for web, response body for mobile). Permissions are enforced on the server only: every route is private unless marked public, and role checks are explicit. Storage (S3-compatible) arrives in milestone 3.

## Module map (`apps/api/src`)

| Folder | Responsibility |
| --- | --- |
| `config/` | Environment loading and validation (`load-env.ts`, `env.ts`, `config.module.ts`) |
| `common/` | Request context and request IDs, structured logger, the one exception filter that shapes every error body, Zod validation pipe, shared field schemas |
| `db/` | Drizzle schema, database module and connection pool, migration runner, database error helpers |
| `audit/` | `AuditService`: writes audit entries inside the caller's transaction; action names; the table is append-only (database triggers) |
| `mail/` | `Mailer` interface with console and SMTP implementations, email templates |
| `auth/` | Password policy and hashing, access tokens, opaque tokens, sessions (rotating refresh tokens), login with lockout, password reset and change, the global auth guard and roles guard, `auth.controller.ts` |
| `invites/` | Admin invites, preview and accept (no self-signup) |
| `users/` | Admin user management: list, change role, deactivate, reactivate, with last-Admin protection |
| `health/` | Liveness and readiness endpoints |
| `cli/` | Command-line entry points: `migrate`, `create-admin` (first-Admin bootstrap) |

Global guards run in this order: rate limiting (`ThrottlerGuard`), authentication (`AuthGuard`, checks the database on every request), roles (`RolesGuard`).

Tests: unit tests sit beside their source as `*.spec.ts`; database and HTTP tests live in `apps/api/test/` as `*.e2e-spec.ts`.

## Module map (`apps/web/src`)

| Folder | Responsibility |
| --- | --- |
| `styles/` | Design tokens (`tokens.css`) and base styles |
| `components/` | Small shared components: `Button`, `TextField`, `Alert` |
| `api/` | `client.ts` (fetch wrapper, token refresh, error shape) and `auth.ts` (typed calls) |
| `auth/` | `AuthContext` (session state) and `ProtectedRoute` |
| `pages/` | Sign in, accept invite, forgot password, reset password, home, not found |
| `test/` | Test setup and a fetch mock |

## Related documents

- API contract: `docs/api/auth.md`
- Decisions and their reasons: `DECISIONS.md`
- Status: `PROGRESS.md`, `TASKS.md`
