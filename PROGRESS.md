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

## In progress

Nothing.

## Next: milestone 2

Staff management screens (invite, list, change role, deactivate and reactivate in the portal) and the Audit log screen (Admin only, with the read API).

## Open items and questions

1. OpenAPI: the spec asks for a published OpenAPI document. This milestone ships `docs/api/auth.md` by hand instead. Generating OpenAPI is proposed for milestone 6, alongside the sync endpoints. Needs confirmation.
2. Audit log database role: the restricted database role (INSERT and SELECT only) is deferred to milestone 7 deployment hardening. The append-only triggers already block updates and deletes for every role, but until then they are tamper-evident rather than tamper-proof against the table owner.
3. Storage provider (Cloudflare R2 vs AWS S3) and the real upload size limits are still to be decided before milestone 3.
4. Which SMTP provider will send invites and reset emails in production.
5. The mobile app's framework, to confirm that the login contract in `docs/api/auth.md` fits it.
6. Web sign-in and refresh need the web app and the API to be hosted under the same site (for example `app.example.org` and `api.example.org`), because the refresh cookie is `SameSite=Strict`.
7. Development machine only: npm needs `NODE_EXTRA_CA_CERTS` pointing at an exported keychain certificate bundle (a local TLS-inspection issue on this machine, not a project issue). CI does not need it.
8. The first Admin has NOT been created yet in the development database. Create it with `npm run admin:create -w @jbf/api -- <email> "<Full Name>"`.
9. The manual browser check of the screens (responsive layout, focus ring) has not been done yet.
