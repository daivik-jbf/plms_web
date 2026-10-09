# Progress

Last updated: 2026-10-09

## Done: milestone 1 (project setup, auth and audit foundation)

- npm workspaces monorepo (`apps/api`, `apps/web`), Node 24, shared ESLint config, CI workflow (lint, build, test, dependency audit) on every push.
- API: configuration and validation, structured logging with request IDs, one exception filter with a stable error shape, health endpoints.
- Database: Drizzle schema and versioned SQL migrations; the audit table is append-only, enforced by triggers.
- Audit service that writes inside the caller's transaction and never stores secrets.
- Sign-in with email and password for both web and mobile: 15-minute access tokens, rotating refresh tokens with reuse detection, account lockout (5 failures, 15 minutes), rate limits.
- Password rules (10 to 128 characters, common-password blocklist), forgot, reset and change password.
- Admin invites (create, list, resend, cancel, preview, accept); no self-signup. First-Admin command-line bootstrap.
- Admin and Staff roles enforced on the server, deny by default; user list, role change, deactivate and reactivate with last-Admin protection. Deactivation and role changes take effect on the next request.
- Web: sign in, accept invite, forgot password and reset password screens, with design tokens and accessibility checks.
- API contract for the mobile developer in `docs/api/auth.md`.
- Tests: 118 API tests and 19 web tests, all passing.

## Done: milestone 2 (Staff and Audit log screens), approved and merged 2026-10-08

- Audit read API (Admin only): `GET /api/audit` with filters (person, involving, category, action, dates, text search, "Changes only"), newest-first keyset paging with microsecond-exact cursors, and server-generated labels, tones, categories and plain-English summaries for all 17 known actions; unknown actions still display.
- `GET /api/audit/export.csv`: streamed UTF-8 CSV with a BOM, spreadsheet-formula neutralizing, a database-clock snapshot so the cap, the recorded row count and the rows are one set, a cap (`AUDIT_EXPORT_MAX_ROWS`, default 50,000, otherwise 413) and a 10-per-minute limit.
- Use of the log is logged: one `audit.viewed` per page open (`POST /api/audit/opened`) and one `audit.exported` per export (filters and row count only).
- Migration `0002`: paging index and a target index on the audit table. New action names added to the known set.
- Web app shell: sidebar (mobile slide-in menu), top bar with sign out, Admin-only pages hidden in the navigation and behind an Admin route guard (the server enforces it regardless); the Dashboard replaces the milestone 1 home page.
- Staff page (Admin): People and Invites tabs; invite, resend, cancel, change role, deactivate, reactivate, with confirmations and server errors shown in the dialogs; "View activity" opens the audit log for one person.
- Audit log page (Admin): filters kept in the URL, Load more, details drawer with before/after changes, CSV export with the current filters, loading, empty and error states.
- My account page (everyone): change password (signs out everywhere, with a notice on the sign-in screen) and sign out of all devices.
- Shared components: Dialog (native `<dialog>`, modal and drawer), ConfirmDialog, Tabs, Table, Badge, Select, EmptyState, Skeleton.
- API contract for the audit log in `docs/api/audit.md`.
- Tests at the end of the build (before the final fix wave): 219 API tests and 146 web tests, all passing.
- Final fix wave (after the whole-branch review): audit filters and cursor hardened (years 0001-9999, microsecond-exact date bounds, uppercase ids, a fixed UTC cursor text), export backpressure and client-disconnect handling, keyboard focus kept on the Audit log page, plain words for a bad address, and dialog, tabs, Staff and My account polish. Tests after the final fix wave: 243 API tests and 184 web tests, all passing.

## Done: milestone 3 (Videos: upload, storage and playback; built and merged to `main` 2026-10-09)

- Storage: a `StoragePort` interface with three drivers: Cloudflare R2 (production, AWS SDK v3), a local development driver (files under `STORAGE_LOCAL_DIR`, signed expiring links served by public `/api/dev-storage/*` routes, refused in production) and an in-memory fake for tests. `npm run storage:check` proves a real bucket works (uploads, reads, pieces and the browser CORS permissions); `npm run storage:cleanup` and an hourly timer remove uploads left unfinished for 24 hours.
- Database (migration `0003`): `files`, `media_folders`, `media_items`. 12 new audit actions (folders, videos, uploads, playback; the `content`, `files` and `playback` categories are now used), 29 known actions in all.
- Media API under `/api/media` (15 routes, any signed-in person): video folders (create, rename, list, reorder), videos (list, edit, reorder), resumable uploads of MP4 files up to 2 GiB in 16 MiB pieces (start, piece links, resume, complete with server-side verification of size, type and first bytes, cancel, own unfinished uploads), cover images (JPEG, PNG or WebP up to 10 MiB) and one-hour playback links (every issued link is audited). A video is invisible to everyone but its uploader until it is ready.
- Web: a Videos page (folders), a folder page (videos table with covers, player dialog, edit dialog, move up and down, unfinished uploads with Resume), an upload dialog, and an app-wide upload manager with a progress panel (three pieces at a time, retries with waits, offline waiting, warning before closing the tab).
- Documentation: `docs/storage.md` (the Cloudflare setup guide, written for a first-time user), `docs/api/media.md` (the contract) and the 12 new actions in `docs/api/audit.md`.
- Tests at the end of the build: 453 API tests (44 suites) and 325 web tests (38 files), all passing. Lint and both builds are clean. `npm audit --audit-level=high` exits 0 (24 moderate advisories, all in development tooling: `esbuild` through `drizzle-kit` and `sprintf-js` through `jest`/`ts-jest`).

## Done: milestone 4 (Movies, Podcasts, Songs and the docked player; built, awaiting approval)

- Four fixed categories on one implementation: Videos, Movies, Podcasts and Songs. A kinds table (`apps/api/src/media/media-kinds.ts`, with a web copy in `apps/web/src/uploads/limits.ts` and `apps/web/src/media/categories.ts`) holds each category's content types, largest size, first-bytes check, storage prefix and words. The folder decides the kind; the declared type and size are checked against it.
- Audio uploads: MP3 (`audio/mpeg`) and M4A (`audio/mp4`) up to 500 MiB (at most 32 pieces), checked on completion by the stored type and the first bytes (`ID3` or an MPEG frame for MP3, `ftyp` for M4A), with a new `not_audio` failure reason. Audio files are stored as `audio/<uuid>` with the file purpose `audio`. Videos and movies are unchanged (MP4, 2 GiB).
- Database (migration `0004`): `media_items.video_file_id` renamed to `media_file_id` and `audio` added to `file_purpose`. Tested on a database that already holds a video, a cover and an unfinished upload.
- API: folder routes take the category (`/api/media/:category/folders`, an unknown slug is 404); folders and items report their `category`; the other media routes are unchanged. Three error messages lost the word "video".
- Audit: action names are unchanged, labels are neutral ("Item added"), sentences take the word (video, movie, podcast, song) from `metadata.category` and fall back to "video" for older entries; the target type of an item is its category.
- Web: sidebar entries and pages for the four categories (the milestone 3 pages now serve all of them), an upload dialog and file rules per kind, and the docked audio player: one track at a time, seek, volume, mute and Close, mounted in the app shell so it keeps playing while the person browses and stops on sign-out, with room left at the bottom of every page and the upload panel above it. Videos and movies still play in the pop-up.
- Documentation: the media and audit API pages, `docs/storage.md`, the README and the architecture notes.
- Tests at the end of the build: 539 API tests (48 suites) and 388 web tests (40 files), all passing. Lint and both builds are clean.

## In progress

Nothing in the build. Milestone 4 is built and waiting for the user's approval (see open items 23 to 26). Milestone 3 was built and merged to `main` on 2026-10-09 (commit 827e0d6); it has not been formally approved yet. `TASKS.md` is unchanged.

## Next: milestone 5

Courses and attachments.

## Open items and questions

1. OpenAPI: the spec asks for a published OpenAPI document. Milestones 1 to 3 ship `docs/api/auth.md`, `docs/api/audit.md` and `docs/api/media.md` by hand instead; the generated document is still deferred to milestone 6. Generating OpenAPI is proposed for milestone 6, alongside the sync endpoints. Needs confirmation.
2. Audit log database role: the restricted database role (INSERT and SELECT only) is deferred to milestone 7 deployment hardening. The append-only triggers already block updates and deletes for every role, but until then they are tamper-evident rather than tamper-proof against the table owner.
3. Storage provider and limits: decided in milestone 3 (Cloudflare R2, 2 GiB per video, MP4 only; see `DECISIONS.md`). The Cloudflare account and bucket do not exist yet; see open item 19.
4. Which SMTP provider will send invites and reset emails in production.
5. The mobile app's framework, to confirm that the login contract in `docs/api/auth.md` fits it.
6. Hosting: as built, the web app calls relative `/api/...` URLs, so the web app and the API must be served from the same origin (one host name with a reverse proxy sending `/api` to the API). Separate `app.` and `api.` subdomains are not supported yet; a `VITE_API_BASE` setting is future work.
7. Development machine only: npm needs `NODE_EXTRA_CA_CERTS` pointing at an exported keychain certificate bundle (a local TLS-inspection issue on this machine, not a project issue). CI does not need it.
8. The first Admin has NOT been created yet in the development database. Create it with `npm run admin:create -w @jbf/api -- <email> "<Full Name>"`.
9. The manual browser check of the screens (responsive layout, focus ring, the Staff, Audit log, My account and Videos pages, dialogs and the drawer in Chrome and Safari) has not been done yet.
10. Milestone 7 (deployment): production deployments MUST set `NODE_ENV=production`. The `Secure` flag on the refresh cookie and the ban on the console mailer both depend on it.
11. Login lockout reveals account existence: a locked real account answers 429 while an unknown email keeps answering 401, so existence can be inferred after 5 wrong guesses. Accepted trade-off; throttled per IP.
12. Minor review notes from milestone 2: the final fix wave is complete. The review notes that were deliberately parked (not fixed) are listed in the milestone 2 review records.
13. The parked milestone 1 review minors that remain open (none block use; they were noted during the milestone 1 review and not fixed in the milestone 1 fix commits).
14. The audit `q` search is a sequential scan. Fine at this size; add trigram indexes if audit volume grows.
15. Audit archiving is not designed. The log only grows; decide on retention and archiving before it becomes large.
16. Names in the audit log are joined at read time from the users table. This breaks (names disappear, labels remain) if users are ever hard-deleted; today users are only deactivated.
17. CI (`.github/workflows/ci.yml`) has not run remotely yet for milestones 2 and 3 (nothing has been pushed). Lint, build and tests pass locally.
18. On narrow screens tables switch to a stacked layout with CSS. Safari with VoiceOver may then stop treating them as tables (lost row and column semantics); consider explicit ARIA table roles later.
19. The Cloudflare account and the R2 bucket do not exist yet, so `npm run storage:check -w @jbf/api` has never been run against real R2. Follow `docs/storage.md` and run it before relying on production uploads. Until then only the local and in-memory drivers have been exercised.
20. The browser parts of milestone 3 (real `<video>` playback and seeking, `XMLHttpRequest` upload progress, the local development links through the Vite proxy, drag and keyboard use of the dialogs) were verified only with automated tests, not in a real browser. The user should try an upload (with a cover) and a playback in a browser, and the manual check in the milestone 3 plan.
21. Accepted risk (ruling R8): a cover upload link, valid for one hour, stays usable after the cover is verified, so whoever obtained it (only a signed-in Staff or Admin can) can overwrite the stored cover until it expires. A later server-side copy on completion would close it. See `docs/storage.md` and `DECISIONS.md`.
22. Milestone 3 has no delete: cancelling an unfinished upload and replacing a cover are the only removals. Deleting videos, the Trash and restore arrive in milestone 6; replacing a video's file is later.
23. The browser parts of milestone 4 (real `<audio>` playback, seeking, volume and mute, the browser's autoplay rules, the dock layout on a phone and above the upload panel, and a video pop-up over a playing dock) were verified only with automated (jsdom) tests, not in a real browser. The user should try the manual check in the milestone 4 plan.
24. Some MP3 and HE-AAC encodings play in some browsers and not in others: the server checks the file format (type and first bytes), not the codec.
25. A video MP4 declared as `audio/mp4` and uploaded into a Songs or Podcasts folder passes the `ftyp` check and is accepted (spec risk 4); the browser's audio element plays the audio track, if there is one.
26. The Cloudflare account and R2 bucket are still not connected (item 19 stays); audio uploads have only been exercised with the local and in-memory drivers.
