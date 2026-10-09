# JBF Learning Management System

A web portal (and the backend for the existing mobile app) for managing and playing learning and media content. It is used by the staff of one organization, Jack Brewer Foundation (JBF), who work with a prison population. There are two roles, Admin and Staff, and every sensitive action is written to an append-only audit log.

Milestones 1 to 3 (this repository today) deliver the foundation, the first screens and the first content: project setup, the database, sign-in, email invites, Admin/Staff roles, password reset, the audit-logging foundation, the portal shell, the Staff page, the Audit log page, My account, and Videos (folders, resumable uploads of MP4 files up to 2 GB with cover images, and playback). Milestone 3 is built and awaiting approval. The other content features come in later milestones (see `TASKS.md`).

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

Optional and storage settings of the API (all are listed in `apps/api/.env.example`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `AUDIT_EXPORT_MAX_ROWS` | `50000` | The largest number of rows one audit log CSV export may contain; a larger export is refused with a message asking to narrow the filters |
| `STORAGE_DRIVER` | `local` | Where videos and covers are kept: `local` (development only; the API refuses it when `NODE_ENV=production`) or `r2` (Cloudflare R2) |
| `STORAGE_LOCAL_DIR` | `./.storage` | Folder the local driver keeps files in (git-ignored) |
| `STORAGE_SIGNING_SECRET` | random at start-up | Signs the local driver's temporary links (at least 32 characters). Optional; if it is missing, links stop working when the API restarts |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | none | Required when `STORAGE_DRIVER=r2`. Treat the key and secret like passwords |

## Storage

By default (`STORAGE_DRIVER=local`) files are kept under `apps/api/.storage` on your machine, so the whole Videos flow works in development without any account. Production needs Cloudflare R2: follow `docs/storage.md` step by step, then run `npm run storage:check -w @jbf/api`, which proves the real bucket works (uploads, reads, pieces and the browser permissions) and cleans up after itself. It is the only proof; the local driver does not test Cloudflare.

Two commands run against storage:

```bash
npm run storage:check -w @jbf/api     # checks a real R2 bucket (needs STORAGE_DRIVER=r2); exits 1 with a message otherwise
npm run storage:cleanup -w @jbf/api   # removes uploads left unfinished for 24 hours; prints "Removed N abandoned uploads."
```

The API also runs the cleanup by itself every hour.

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
| Videos | `/videos`, `/videos/:folderId` | Everyone signed in. Create and rename folders, reorder folders and videos, upload an MP4 (up to 2 GB, with an optional cover) with a progress panel and Resume for unfinished uploads, play videos, edit titles, descriptions and covers. Nothing can be deleted yet (the Trash arrives in milestone 6) |
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
- Design and plan for milestone 3: `docs/superpowers/specs/2026-10-08-milestone-3-videos-design.md` and `docs/superpowers/plans/2026-10-08-milestone-3-videos.md`
- API contract for the mobile developer: `docs/api/auth.md` (sign-in, invites, users), `docs/api/audit.md` (audit log) and `docs/api/media.md` (videos, uploads, covers, playback)
- Setting up file storage (Cloudflare R2) and checking it: `docs/storage.md`
- Architecture summary: `ARCHITECTURE.md`
- Working memory: `TASKS.md`, `PROGRESS.md`, `DECISIONS.md`, `CHANGELOG.md`
