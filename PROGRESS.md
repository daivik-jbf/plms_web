# Progress

Last updated: 2026-10-08

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

## Done: milestone 2 (Staff and Audit log screens)

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

## In progress

Nothing in the build. The whole-branch review and a final fix wave for the minor review findings come before the branch is merged.

## Next: milestone 3

Media upload and playback, end to end, on Videos (storage provider, upload limits and playback; see open item 3).

## Open items and questions

1. OpenAPI: the spec asks for a published OpenAPI document. Milestones 1 and 2 ship `docs/api/auth.md` and `docs/api/audit.md` by hand instead. Generating OpenAPI is proposed for milestone 6, alongside the sync endpoints. Needs confirmation.
2. Audit log database role: the restricted database role (INSERT and SELECT only) is deferred to milestone 7 deployment hardening. The append-only triggers already block updates and deletes for every role, but until then they are tamper-evident rather than tamper-proof against the table owner.
3. Storage provider (Cloudflare R2 vs AWS S3) and the real upload size limits are still to be decided before milestone 3.
4. Which SMTP provider will send invites and reset emails in production.
5. The mobile app's framework, to confirm that the login contract in `docs/api/auth.md` fits it.
6. Hosting: as built, the web app calls relative `/api/...` URLs, so the web app and the API must be served from the same origin (one host name with a reverse proxy sending `/api` to the API). Separate `app.` and `api.` subdomains are not supported yet; a `VITE_API_BASE` setting is future work.
7. Development machine only: npm needs `NODE_EXTRA_CA_CERTS` pointing at an exported keychain certificate bundle (a local TLS-inspection issue on this machine, not a project issue). CI does not need it.
8. The first Admin has NOT been created yet in the development database. Create it with `npm run admin:create -w @jbf/api -- <email> "<Full Name>"`.
9. The manual browser check of the screens (responsive layout, focus ring, the Staff, Audit log and My account pages, dialogs and the drawer in Chrome and Safari) has not been done yet.
10. Milestone 7 (deployment): production deployments MUST set `NODE_ENV=production`. The `Secure` flag on the refresh cookie and the ban on the console mailer both depend on it.
11. Login lockout reveals account existence: a locked real account answers 429 while an unknown email keeps answering 401, so existence can be inferred after 5 wrong guesses. Accepted trade-off; throttled per IP.
12. Minor review notes from milestone 2 are tracked in the final fix wave and recorded here when it completes.
13. The parked milestone 1 review minors that remain open (none block use; they were noted during the milestone 1 review and not fixed in the milestone 1 fix commits).
14. The audit `q` search is a sequential scan. Fine at this size; add trigram indexes if audit volume grows.
15. Audit archiving is not designed. The log only grows; decide on retention and archiving before it becomes large.
16. Names in the audit log are joined at read time from the users table. This breaks (names disappear, labels remain) if users are ever hard-deleted; today users are only deactivated.
