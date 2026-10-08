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
