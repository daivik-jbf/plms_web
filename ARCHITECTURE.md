# Architecture

The source of truth is the design spec: `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md` (section 10 covers architecture and operations). This page is only a pointer and a map of the code; it does not repeat the spec.

## Stack in one paragraph

An npm workspaces monorepo. `apps/web` is a React + TypeScript single-page app built with Vite. `apps/api` is a NestJS 11 API (TypeScript, Express) that stores data in PostgreSQL 17 through Drizzle ORM with plain, versioned SQL migrations. One login serves both the portal and the mobile app: a short-lived access token (JWT, 15 minutes) plus a rotating refresh token (HttpOnly cookie for web, response body for mobile). Permissions are enforced on the server only: every route is private unless marked public, and role checks are explicit. Videos, movies, podcasts, songs and cover images live in private S3-compatible storage (Cloudflare R2 in production); see "Files and storage" below.

## Module map (`apps/api/src`)

| Folder | Responsibility |
| --- | --- |
| `config/` | Environment loading and validation (`load-env.ts`, `env.ts`, `config.module.ts`) |
| `common/` | Request context and request IDs, structured logger, the one exception filter that shapes every error body, Zod validation pipe, shared field schemas |
| `db/` | Drizzle schema, database module and connection pool, migration runner, database error helpers |
| `audit/` | Write side: `AuditService` writes audit entries inside the caller's transaction; `audit.actions.ts` lists the known action names; the table is append-only (database triggers). Read side (Admin only, milestone 2): `audit.controller.ts` (list, page-opened marker, CSV export), `audit-query.service.ts` (filters, keyset paging, names joined at read time), `audit-cursor.ts` (opaque, validated cursors), `audit-presentation.ts` (labels, tones, categories and summaries; the words for a media entry come from `metadata.category`), `audit-export.service.ts` and `csv.ts` (streamed, formula-safe CSV), `audit.schemas.ts` (query validation) |
| `mail/` | `Mailer` interface with console and SMTP implementations, email templates |
| `auth/` | Password policy and hashing, access tokens, opaque tokens, sessions (rotating refresh tokens), login with lockout, password reset and change, the global auth guard and roles guard, `auth.controller.ts` |
| `invites/` | Admin invites, preview and accept (no self-signup) |
| `users/` | Admin user management: list, change role, deactivate, reactivate, with last-Admin protection |
| `health/` | Liveness and readiness endpoints |
| `storage/` | `StoragePort` (the one interface the rest of the API uses for files) and its drivers: `R2Storage` (AWS SDK v3 against R2's S3 API), `LocalStorage` (development only: files under `STORAGE_LOCAL_DIR`, signed expiring links) and, for tests, an in-memory fake kept under `apps/api/test/`. `dev-storage.controller.ts` serves the local driver's links (public routes under `/api/dev-storage/`, 404 unless the local driver is active). `signed-token.ts` signs and checks those links, `cors-check.ts` judges a bucket's browser permissions for the check script, `storage.module.ts` picks the driver from the environment |
| `media/` | Videos, movies, podcasts and songs (milestones 3 and 4): `media-kinds.ts` (the kinds and categories table: content types, sizes, first-bytes checks, key prefixes, words), `category.pipe.ts` (turns the route's category slug into a category, else 404), `folders.service.ts` (folders of a category and their order), `items.service.ts` (items: list, edit, reorder, playback links), `uploads.service.ts` and `uploads.controller.ts` (the resumable upload flow with verification, resume and cancel), `covers.service.ts` (cover images), `upload-cleanup.service.ts` (abandoned uploads: an hourly timer inside the API), `discard.ts` and `file-checks.ts` (best-effort removal from storage; first-bytes checks for MP4, MP3 and images, and file-name cleaning), `media.schemas.ts` (request validation) |
| `cli/` | Command-line entry points: `migrate`, `create-admin` (first-Admin bootstrap), `storage-check` (proves a real R2 bucket works), `storage-cleanup` (removes abandoned uploads now) |

Global guards run in this order: rate limiting (`ThrottlerGuard`), authentication (`AuthGuard`, checks the database on every request), roles (`RolesGuard`).

Tests: unit tests sit beside their source as `*.spec.ts`; database and HTTP tests live in `apps/api/test/` as `*.e2e-spec.ts`.

## Module map (`apps/web/src`)

| Folder | Responsibility |
| --- | --- |
| `styles/` | Design tokens (`tokens.css`) and base styles |
| `components/` | Shared components: `Button`, `TextField`, `Select`, `Alert`, `Badge`, `Tabs`, `Table`, `EmptyState`, `Skeleton`, `Dialog` (native `<dialog>`, modal or drawer) and `ConfirmDialog`; the app shell (`AppShell` with sidebar and top bar, `NavLinks`, `nav-items.ts`) and `AdminRoute` |
| `api/` | `client.ts` (fetch wrapper, token refresh, error shape, file download) and typed calls: `auth.ts`, `staff.ts`, `audit.ts`, `media.ts` |
| `auth/` | `AuthContext` (session state and the sign-out notice) and `ProtectedRoute` |
| `lib/` | Date and value formatting, file download helper |
| `pages/` | Public: sign in, accept invite, forgot password, reset password, not found. Inside the shell: `DashboardPage`, `staff/` (Staff page), `audit/` (Audit log page, filters, table, details drawer), `account/` (My account), `media/` (was `videos/`: `CategoryPage`, `FolderPage`, `ItemsTable`, the upload, edit and folder dialogs, the pop-up player dialog and the resume list for unfinished uploads, for every category) |
| `media/` | `categories.ts`: the four categories (slug, kind, and the words the pages use) |
| `player/` | The docked audio player: `PlayerContext.tsx` (which track is playing) and `DockedPlayer.tsx` (the bar); mounted once in the app shell next to the upload panel; memory only |
| `uploads/` | The upload engine and the app-wide upload manager: `engine.ts` (pieces sent three at a time with retries, waits and resume), `xhr.ts` (one piece sent with progress and its receipt read), `UploadsContext.tsx` (state that keeps uploads going while the person browses; memory only), `UploadPanel.tsx` (the progress panel in the corner), `limits.ts`, `duration.ts`, `describe-upload-error.ts`, `browser-deps.ts` |
| `test/` | Test setup (dialog stand-ins for jsdom), a fetch mock and session helpers |

Routes: `/login`, `/accept-invite`, `/forgot-password`, `/reset-password` are public. Everything else is inside `ProtectedRoute` and the `AppShell`: `/`, `/account`, `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId` (for example `/songs/:folderId`) for everyone, `/staff` and `/audit` behind `AdminRoute` (Staff are redirected to `/`; the server enforces the rule regardless).

## Files and storage

Videos, movies, podcasts, songs and cover images are not kept on the API server. The browser sends a file straight to private storage in 16 MiB pieces, using temporary links (valid one hour) that the API hands out; it plays files and shows covers through temporary links too. Video files are stored as `videos/<uuid>`, audio files as `audio/<uuid>` and covers as `covers/<uuid>`. Videos and movies play in a pop-up; podcasts and songs play in the docked player. The API never carries file bytes: it owns the database rows (`files`, `media_folders`, `media_items`) and every check. When an upload is completed the API verifies the stored file itself (size, type and first bytes) and discards a mismatch, so nothing the browser claims is trusted. Storage calls happen outside database transactions, in an order that can be compensated, and the audit entry is written in the same transaction as the change it describes. In development a local driver stands in for Cloudflare R2 (and is refused in production); only `npm run storage:check` proves the real service. See `docs/storage.md` (setup) and `docs/api/media.md` (contract).

## Related documents

- API contracts: `docs/api/auth.md`, `docs/api/audit.md`, `docs/api/media.md`
- Setting up file storage (Cloudflare R2): `docs/storage.md`
- Decisions and their reasons: `DECISIONS.md`
- Status: `PROGRESS.md`, `TASKS.md`
