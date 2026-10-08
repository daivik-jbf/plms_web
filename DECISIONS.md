# Decisions

Dated entries, newest last. Each has the reason. The spec (`docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`) holds the product decisions in full; they are repeated here so this file is a complete log.

## Product decisions (from discovery and the spec)

- **2026-10-08: Single organization.** One shared library for JBF. Reason: the deployment serves one organization of about 50 users; multi-tenancy would add cost and risk for no benefit.
- **2026-10-08: Admin and Staff only.** No learner accounts, no third parties. Reason: only staff use the portal and the mobile app in version 1, so two roles keep permissions simple to enforce and test.
- **2026-10-08: Staff can edit but not delete.** Staff can upload and edit content; only Admins delete, restore and purge. Reason: limits the damage a mistaken or compromised Staff account can do.
- **2026-10-08: Trash is a soft delete.** Deleting moves content to Trash; only Admins restore or purge. Reason: accidental deletion must be reversible.
- **2026-10-08: Option 2 stack: React + NestJS + PostgreSQL + S3-compatible storage.** Reason: a conventional, well-supported stack that one small team can maintain, with a typed API that the mobile app can consume and storage that scales without a rebuild.
- **2026-10-08: MP4-only in version 1.** H.264/AAC, no transcoding. Reason: transcoding is costly and complex; the content team can prepare MP4 files.
- **2026-10-08: Offline downloads are visible in the device file manager and unprotected.** No encryption or expiry. Reason: a product decision for version 1; the consequence (files cannot be revoked after deactivation) is accepted and recorded in the spec.
- **2026-10-08: Email-invite login, no self-signup, no 2FA yet.** Reason: Admins control exactly who has an account; two-factor authentication is out of scope for version 1.

## Engineering decisions (milestone 1)

- **2026-10-08: Drizzle over Prisma.** Reason: SQL-like queries, plain versioned SQL migrations, and it is easy to add custom migrations for the audit triggers.
- **2026-10-08: npm workspaces instead of pnpm.** Reason: Homebrew's pnpm depends on a different Node major than Node 24.
- **2026-10-08: Node 24 LTS.** Reason: the current long-term-support line, pinned in `.nvmrc` and `engines`.
- **2026-10-08: NestJS pinned to the 11 line.** Reason: NestJS 12 is ESM-only and breaks the CommonJS Jest setup.
- **2026-10-08: TypeScript 6 tsconfig uses `module: commonjs` with `moduleResolution: bundler`.** Reason: TypeScript 6 rejects `moduleResolution: node`, and `bundler` is the setting that still works with CommonJS output.
- **2026-10-08: Jest transpiles jose 6 through `apps/api/tsconfig.jest.json`.** Reason: jose 6 is ESM-only, so Jest has to transform it (`transformIgnorePatterns` lets `jose` through) for the CommonJS tests to import it.
- **2026-10-08: The access check hits the database on every request.** Reason: deactivation and role changes apply immediately instead of waiting for a 15-minute token to expire. The cost is one indexed lookup per request, which is fine at this scale.
- **2026-10-08: Web and API must be deployed under the same site** (for example `app.example.org` and `api.example.org`). Reason: the refresh cookie is `SameSite=Strict`, which protects against cross-site request forgery but is only sent to the same site.
- **2026-10-08: Audit append-only is enforced by database triggers now; the restricted database role (INSERT and SELECT only) is deferred to milestone 7.** Reason: triggers already block updates and deletes for every role, which makes tampering evident against the table owner; the separate role belongs with deployment hardening, when production roles exist.
- **2026-10-08: Shared types package deferred.** Reason: nothing in milestone 1 needs it, and an empty package would be unused structure. Add it when a milestone needs types in both web and API.
- **2026-10-08: Password blocklist derived from the SecLists NCSC 100k list, filtered to passwords of 10 or more characters.** Source: `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` in the SecLists project (https://github.com/danielmiessler/SecLists), which is published under the MIT licence; the list is lower-cased and de-duplicated. The build sandbox blocked the download, so a copy fetched earlier from the same URL was used. Reason: the length rule already rejects short passwords, so only the entries that could pass it are worth keeping.
- **2026-10-08: In-memory rate limiting.** Reason: simplest option for one API instance. Move the counters to a shared store (for example Redis or the database) if the API is ever scaled to several instances.
- **2026-10-08: OpenAPI document deferred; `docs/api/auth.md` is written by hand for now.** Reason: the mobile developer needs the contract now, and generating a full OpenAPI document is better done once, alongside the sync endpoints in milestone 6. Pending the user's confirmation (see `PROGRESS.md`).
- **2026-10-08: Added the design token `--color-border-strong` (`#6b8794`).** Reason: input borders must meet a 3:1 contrast ratio against the background (WCAG 2.1 non-text contrast); the original light border did not.
