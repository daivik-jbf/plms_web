# JBF Learning Management System

A web portal (and the backend for the existing mobile app) for managing and playing learning and media content. It is used by the staff of one organization, Jack Brewer Foundation (JBF), who work with a prison population. There are two roles, Admin and Staff, and every sensitive action is written to an append-only audit log.

Milestones 1 and 2 (this repository today) deliver the foundation and the first screens: project setup, the database, sign-in, email invites, Admin/Staff roles, password reset, the audit-logging foundation, the portal shell, the Staff page, the Audit log page and My account. Content features come in later milestones (see `TASKS.md`).

## Prerequisites

- Node 24 (the version is pinned in `.nvmrc`; with nvm run `nvm use`)
- PostgreSQL 17
- npm (comes with Node). The repository is an npm workspaces monorepo: `apps/api` (NestJS) and `apps/web` (React + Vite).

## First-time setup

```bash
npm install

# API configuration
cp apps/api/.env.example apps/api/.env
# then edit apps/api/.env and set JWT_ACCESS_SECRET to a random string of at least 32 characters

# Database
createdb jbf_lms
npm run db:migrate -w @jbf/api

# First Admin: prints a link to open in the browser to set the password
npm run admin:create -w @jbf/api -- <email> "<Full Name>"
```

`.env` files are never committed. In development `MAIL_TRANSPORT=console` prints invite and reset links in the API's terminal instead of sending email.

Optional API setting: `AUDIT_EXPORT_MAX_ROWS` (default `50000`) is the largest number of rows one audit log CSV export may contain; a larger export is refused with a message asking to narrow the filters. It is listed in `apps/api/.env.example`.

## Running

```bash
npm run dev:api    # API on http://localhost:3000 (routes start with /api)
npm run dev:web    # web portal on http://localhost:5173
```

## Pages

| Page | Address | Who can see it |
| --- | --- | --- |
| Dashboard | `/` | Everyone signed in (a welcome page for now; the library arrives in later milestones) |
| Staff | `/staff` | Admin only. People and Invites tabs: invite someone, resend or cancel an invite, change a role, deactivate or reactivate a person, jump to a person's activity |
| Audit log | `/audit` | Admin only. Everything that has happened, newest first, with filters, a details drawer and CSV export. Opening the page and each export are themselves logged |
| My account | `/account` | Everyone signed in. Change your password (this signs you out everywhere) or sign out of all devices |

Staff do not see the Staff and Audit log links, and the server refuses their requests to those APIs (403) even if they type the address. Sign in, accept invite, forgot password and reset password pages are public.

## Testing and checks

```bash
npm test           # API (Jest, needs PostgreSQL running) and web (Vitest) tests
npm run lint
npm run build
npm audit --audit-level=high
```

The API tests drop and recreate a separate database named `jbf_lms_test` on the local PostgreSQL server on every run (set `TEST_DATABASE_URL` to use a different server; the database name must end in `_test`). Your development database is never touched. CI runs the same four commands on every push.

## Deployment notes

Full deployment hardening is milestone 7. Until then, keep these in mind:

- Serve the web app and the API from the same origin (one host name, with a reverse proxy sending `/api` to the API). The web app calls relative `/api/...` URLs and the refresh cookie is `SameSite=Strict`, so separate `app.` and `api.` subdomains do not work yet (a `VITE_API_BASE` setting is future work).
- Production MUST set `NODE_ENV=production`. The `Secure` flag on the refresh cookie and the ban on the console mailer depend on it.
- Login lockout (5 wrong passwords, 15 minutes) applies only to real accounts: a locked account answers 429 while an unknown email keeps answering 401, so account existence can be inferred after 5 wrong guesses. This is an accepted trade-off, slowed by the per-IP rate limit.

## Where things are

- Design spec (source of truth): `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`
- Implementation plan for milestone 1: `docs/superpowers/plans/2026-10-08-milestone-1-auth-foundation.md`
- Design and plan for milestone 2: `docs/superpowers/specs/2026-10-08-milestone-2-staff-and-audit-design.md` and `docs/superpowers/plans/2026-10-08-milestone-2-staff-and-audit.md`
- API contract for the mobile developer: `docs/api/auth.md` (sign-in, invites, users) and `docs/api/audit.md` (audit log)
- Architecture summary: `ARCHITECTURE.md`
- Working memory: `TASKS.md`, `PROGRESS.md`, `DECISIONS.md`, `CHANGELOG.md`
