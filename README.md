# JBF Learning Management System

A web portal (and the backend for the existing mobile app) for managing and playing learning and media content. It is used by the staff of one organization, Jack Brewer Foundation (JBF), who work with a prison population. There are two roles, Admin and Staff, and every sensitive action is written to an append-only audit log.

Milestone 1 (this repository today) delivers the foundation: project setup, the database, sign-in, email invites, Admin/Staff roles, password reset, and the audit-logging foundation. Content features come in later milestones (see `TASKS.md`).

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

## Running

```bash
npm run dev:api    # API on http://localhost:3000 (routes start with /api)
npm run dev:web    # web portal on http://localhost:5173
```

## Testing and checks

```bash
npm test           # API (Jest, needs PostgreSQL running) and web (Vitest) tests
npm run lint
npm run build
npm audit --audit-level=high
```

The API tests drop and recreate a separate database named `jbf_lms_test` on the local PostgreSQL server on every run (set `TEST_DATABASE_URL` to use a different server; the database name must end in `_test`). Your development database is never touched. CI runs the same four commands on every push.

## Where things are

- Design spec (source of truth): `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`
- Implementation plan for milestone 1: `docs/superpowers/plans/2026-10-08-milestone-1-auth-foundation.md`
- API contract for the mobile developer: `docs/api/auth.md`
- Architecture summary: `ARCHITECTURE.md`
- Working memory: `TASKS.md`, `PROGRESS.md`, `DECISIONS.md`, `CHANGELOG.md`
