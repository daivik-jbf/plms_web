# Changelog

One line per meaningful change, newest last.

- 2026-10-08: Added the design spec and the milestone 1 implementation plan.
- 2026-10-08: Set up the npm workspaces monorepo with Node 24 and shared lint tooling.
- 2026-10-08: Added the API scaffold: validated configuration, structured logging with request IDs, and a single error format.
- 2026-10-08: Added the database schema, versioned migrations and the append-only audit table.
- 2026-10-08: Added the audit service, which records inside the caller's transaction.
- 2026-10-08: Added password rules, password hashing and token primitives.
- 2026-10-08: Added the mail module with console and SMTP senders.
- 2026-10-08: Added sign-in, rotating sessions, role guards and account lockout.
- 2026-10-08: Added Admin invites and invite acceptance.
- 2026-10-08: Added forgot, reset and change password.
- 2026-10-08: Added user management (change role, deactivate, reactivate) with last-Admin protection.
- 2026-10-08: Added the command that creates the first Admin.
- 2026-10-08: Added the web foundation with design tokens and the API client.
- 2026-10-08: Added the sign-in, invite acceptance and password reset screens.
- 2026-10-08: Added CI, the README, the mobile API contract and the working-memory files.
- 2026-10-08: Fixed review findings: a losing refresh no longer clears the web cookie and the web app serialises refresh across tabs; logout is audited in its own transaction and only once; refresh locks the user row so a password change or deactivation cannot miss a new token; forgot-password requests are serialised; pool errors are logged instead of crashing; SMTP timeouts; the forgot, invite and reset screens show real errors; docs corrected for lockout, hosting and the refresh cookie.
- 2026-10-08: Added the milestone 2 design spec (Staff and Audit log screens) and implementation plan.
- 2026-10-08: Added audit labels, tones, categories and plain-English summaries for every known action, with a safe fallback for unknown actions.
- 2026-10-08: Added the Admin-only audit read API (`GET /api/audit`) with filters, text search, "Changes only" and newest-first keyset paging, plus the paging and per-person indexes (migration 0002).
- 2026-10-08: Hardened the audit cursor (calendar and clock range checks, a 400 instead of a 500) and made the list query use the paging index.
- 2026-10-08: Added the audit CSV export (BOM, formula neutralizing, 50,000-row cap, 10 per minute) and the page-opened marker; reading the log is itself logged (`audit.viewed`, `audit.exported`).
- 2026-10-08: Made the export a consistent snapshot using the database clock, so the cap, the recorded row count and the streamed rows are one set.
- 2026-10-08: Added shared web components: dialog and drawer, confirm dialog, tabs, table, badge, select, empty state and loading skeleton.
- 2026-10-08: Added the web app shell (sidebar, top bar, mobile menu) and the Dashboard; removed the milestone 1 home page; Admin-only pages are hidden for Staff.
- 2026-10-08: Added the Staff page with People and Invites tabs, invite, resend, cancel, change role, deactivate and reactivate.
- 2026-10-08: Dialogs now stay open while a request is running, and a late result is shown on the page instead of in a stale or different dialog.
- 2026-10-08: Added the Audit log page with filters kept in the URL, Load more, a details drawer and CSV export.
- 2026-10-08: The Audit log page now ignores a late "Load more" result after the filters change.
- 2026-10-08: Added the My account page (change password, sign out of all devices) and the sign-out notice on the sign-in screen.
- 2026-10-08: Documented the audit API in `docs/api/audit.md` and updated the README, architecture notes and working-memory files.
