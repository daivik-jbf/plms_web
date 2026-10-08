# Milestone 2: Staff Management and Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins get an app shell, a Staff page (People and Invites tabs), and an Admin-only Audit log page with a detail drawer, filters and CSV export; everyone gets a My account page.

**Architecture:** The API gains a read side for the existing append-only `audit_log` (keyset-paged list, CSV export, "page opened" marker), with all labels, colors and plain-English summaries produced by one tested server module. The web app gains a shell (sidebar + top bar), native-`<dialog>`-based dialogs and drawers, and four pages that use the milestone 1 API client.

**Tech Stack:** Unchanged from milestone 1 (NestJS 11, Drizzle, PostgreSQL 17, zod 4; React 19, react-router-dom 7, Vite, Vitest + Testing Library). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-milestone-2-staff-and-audit-design.md` (binding). Parent spec: `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`. Milestone 1 plan and code are the baseline.

**Planned simplifications of the spec (the user may overrule):** (1) the People table uses inline small action buttons instead of an overflow "row menu" (simpler, fully keyboard-accessible, wraps on phones); (2) `Dialog` is a single component with a `side` prop that serves as modal and drawer, rather than separate `Modal` and `Drawer` components.

## Global Constraints

- Branch `milestone-2-staff-audit` (already created from `main`; the spec is committed on it). Work only on this branch. Run `git status` before starting and before the final handoff. **Do not push or merge to `main`** until the user approves the milestone. Never force-push; on a conflict stop and show the user.
- Environment for every shell command: `export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"`. For `npm install/audit/view` (not needed for this milestone: **no new dependencies**) use `NODE_EXTRA_CA_CERTS=/private/tmp/claude-501/-Users-jbfit-Documents-GitHub-plms-web/54da702a-c25d-4d71-afc1-e140ab238f7f/scratchpad/ca.pem` and never disable strict SSL.
- Decisions inherited from milestone 1 (do not undo): NestJS on the 11 line; TypeScript 6 with `module: commonjs` + `moduleResolution: bundler` for the API; zod 4; drizzle-orm 0.45; API tests run serially (`jest --runInBand`) against one shared database that is recreated per run, so tests must create their own users/rows with unique ids and filter by them.
- Every audit endpoint is **Admin-only** (class-level `@Roles('admin')`; Staff 403, anonymous 401). Routes remain deny-by-default.
- Audit read paths **never write or expose** passwords, hashes or tokens (the log contains none; the views add none). Audit labels are attacker-influenced (failed sign-ins store the typed email): the web renders them as **text only** (React escaping, never `dangerouslySetInnerHTML`) and the CSV export neutralizes spreadsheet formulas.
- Audit entries for new actions are written like all others: `audit.viewed` once per Admin opening the Audit page (not per filter or page change) and `audit.exported` per CSV export (filters and row count only, never the exported data).
- Paging is keyset on `(occurred_at desc, id desc)` with microsecond-exact cursors: no duplicates or gaps even with identical timestamps.
- CSV export: cap `AUDIT_EXPORT_MAX_ROWS` (default 50,000, configurable); over the cap returns 413 `Too many rows to export (limit N). Narrow the filters.`
- Web: modals and drawers use native `<dialog>` opened with `showModal()`, `aria-labelledby`, `closedby="any"` plus the documented click-outside fallback for browsers without `closedby` (Safari); slide animation only under `prefers-reduced-motion: no-preference`. Keyboard operable, focus returns to the trigger on close (native behaviour), visible focus, AA contrast, labels on every field, responsive at phone/tablet/desktop widths.
- Design tokens are the single source of color and spacing (`apps/web/src/styles/tokens.css`); new colors only as tokens (Task 4 adds `--color-warning`, `--color-warning-surface`, `--color-danger-hover`, `--color-overlay`). No ALL-CAPS section labels, no per-screen one-off colors. Palette and type from milestone 1 stay.
- Errors shown to people: server `message`/`fieldErrors` for 4xx, a generic message for 5xx/network, a fixed message for 429 (`describeError` in `apps/web/src/api/client.ts`).
- No dead code: delete code in the same change that makes it unused (Task 5 deletes `HomePage`). No unused exports/imports, no commented-out code, no `console.log`.
- Commit messages: `<type>: <what changed, plain language>` (feat/fix/refactor/docs/test/chore/style), first line under ~72 characters, followed by a blank line and the attribution trailer your session instructions require. Commit after every task.
- The audit log's own append-only triggers and all milestone 1 behaviour must keep working (the full existing suites must stay green).

## Review Focus

Inputs and failure modes the spec implies but a happy-path test would miss. Each has a test in the task that owns the code.

1. **Keyset paging with identical and microsecond-different timestamps:** rows sharing a timestamp, rows differing only below the millisecond, and a new row inserted between page 1 and page 2 must give every row exactly once, in a stable order (Task 2).
2. **Hostile labels:** a failed-sign-in label such as `=HYPERLINK("http://evil")`, `+1+1`, `@SUM(1)`, or text containing quotes, commas, newlines or `<img src=x onerror=...>` must be neutralized in the CSV and rendered as inert text in the page (Tasks 3 and 7).
3. **LIKE wildcards in search:** a search for `%` or `_` must match those literal characters only (Task 2).
4. **Export boundaries:** exactly the cap succeeds, cap + 1 gives 413, an empty result gives a header-only file (Task 3).
5. **Own-row safety and last Admin:** an Admin cannot change their own role or deactivate themselves from the UI; a server 409 about the last Admin is shown in plain words and keeps the dialog open (Task 6).
6. **Double submit and Esc:** buttons are disabled while a request is in flight; Esc closes dialogs without submitting; a rejected request leaves the dialog open with the typed values (Tasks 4 and 6).
7. **Bad URLs:** `/audit?involving=not-a-uuid` or garbage filters show a clear error with a way to clear filters, not a blank page or a crash (Task 7).
8. **Staff reaching Admin pages:** typing `/staff` or `/audit` as Staff redirects to the dashboard; the API answers 403 regardless (Tasks 2, 5, 6, 7).

---

## File Structure

```
apps/api/
  drizzle/0002_audit_log_read_indexes.sql        (generated)
  src/
    config/env.ts                                 + AUDIT_EXPORT_MAX_ROWS
    db/schema.ts                                  + two indexes on audit_log
    audit/
      audit.actions.ts                            AUDIT_ACTIONS const + AuditAction type (+ audit.viewed, audit.exported)
      audit-presentation.ts (+ .spec.ts)          label/tone/category/summary for every action
      audit.schemas.ts                            zod query/filter schemas
      audit-cursor.ts (+ .spec.ts)                opaque keyset cursor
      audit-query.service.ts                      list / count / pages (keyset, joins, filters)
      audit-export.service.ts                     CSV streaming + audit.exported
      csv.ts (+ .spec.ts)                         csvCell / csvRow with formula neutralizing
      audit.controller.ts                         GET /audit, POST /audit/opened, GET /audit/export.csv
      audit.module.ts
  test/ helpers/audit.ts, helpers/csv.ts, audit.e2e-spec.ts, audit-export.e2e-spec.ts

apps/web/src/
  styles/tokens.css, base.css                     + tokens, body scroll lock
  components/
    Button (+ danger variant, small size)         Dialog, ConfirmDialog, Badge, Tabs, Table, Select, EmptyState, Skeleton
    AppShell, NavLinks, nav-items.ts, AdminRoute
  lib/ format.ts, download.ts
  api/ client.ts (+ apiDownload), staff.ts, audit.ts, auth.ts (+ changePassword, logoutAll)
  auth/AuthContext.tsx                            anonymous state can carry a sign-out notice
  pages/ DashboardPage (replaces HomePage), staff/*, audit/*, AccountPage
  test/ setup.ts (dialog polyfill), fetch-mock.ts (+ text/headers), session.tsx
```

Unit tests live next to their source as `*.spec.ts(x)`; database/HTTP tests live in `apps/api/test/*.e2e-spec.ts`.

---

### Task 1: Audit actions and presentation (labels, tones, categories, summaries)

**Files:**
- Modify: `apps/api/src/audit/audit.actions.ts`
- Create: `apps/api/src/audit/audit-presentation.ts`
- Test: `apps/api/src/audit/audit-presentation.spec.ts`

**Interfaces:**
- Consumes: `AuditChanges` from `apps/api/src/db/schema.ts`.
- Produces:

```ts
export const AUDIT_ACTIONS: readonly [...17 action names]; export type AuditAction
export type AuditTone = 'change' | 'danger' | 'warning' | 'success' | 'neutral'
export type AuditCategory = 'accounts' | 'content' | 'files' | 'playback'
export interface PresentableEntry { action: string; source: string; actorLabel: string | null; actorName: string | null; targetLabel: string | null; targetName: string | null; changes: AuditChanges | null; metadata: Record<string, unknown> | null }
export interface Presentation { label: string; tone: AuditTone; category: AuditCategory; summary: string }
export function presentAudit(entry: PresentableEntry): Presentation
export function categoryOf(action: string): AuditCategory
export const CATEGORY_PREFIXES: { content: readonly string[]; files: readonly string[]; playback: readonly string[] }   // 'accounts' = everything else
```

- [ ] **Step 1: Write the failing test**

`apps/api/src/audit/audit-presentation.spec.ts`:

```ts
import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, presentAudit, type PresentableEntry } from './audit-presentation';

const base: PresentableEntry = {
  action: 'auth.login.succeeded',
  source: 'portal',
  actorLabel: 'anita@jbf.org',
  actorName: 'Anita Rao',
  targetLabel: 'ben@jbf.org',
  targetName: 'Ben Okoye',
  changes: null,
  metadata: null,
};

const present = (overrides: Partial<PresentableEntry>) => presentAudit({ ...base, ...overrides });

describe('presentAudit', () => {
  it.each([
    ['auth.login.succeeded', {}, 'Signed in', 'success', 'Anita Rao signed in from the portal'],
    ['auth.login.succeeded', { source: 'mobile' }, 'Signed in', 'success', 'Anita Rao signed in from the app'],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'dev@jbf.org', metadata: { reason: 'wrong_password', locked: false } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for dev@jbf.org (wrong password)',
    ],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'dev@jbf.org', metadata: { reason: 'wrong_password', locked: true } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for dev@jbf.org (wrong password, account now locked)',
    ],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'ghost@jbf.org', metadata: { reason: 'unknown_email' } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for ghost@jbf.org (no account with that email)',
    ],
    ['auth.login.failed', { actorName: null, actorLabel: 'x@jbf.org' }, 'Sign-in failed', 'warning', 'Failed sign-in for x@jbf.org'],
    ['auth.logout', {}, 'Signed out', 'neutral', 'Anita Rao signed out'],
    ['auth.logout_all', {}, 'Signed out everywhere', 'neutral', 'Anita Rao signed out of all devices'],
    [
      'auth.refresh.reuse_detected',
      {},
      'Session reuse detected',
      'warning',
      "Anita Rao's session was ended because an old session token was used again",
    ],
    ['auth.password.changed', {}, 'Password changed', 'change', 'Anita Rao changed their password'],
    ['auth.password.reset_requested', {}, 'Password reset requested', 'neutral', 'Anita Rao requested a password reset'],
    ['auth.password.reset_completed', {}, 'Password reset', 'change', 'Anita Rao reset their password'],
    [
      'invite.created',
      { targetName: null, metadata: { role: 'staff' } },
      'Invite sent',
      'change',
      'Anita Rao invited ben@jbf.org as Staff',
    ],
    ['invite.resent', { targetName: null }, 'Invite resent', 'change', 'Anita Rao resent the invite to ben@jbf.org'],
    ['invite.cancelled', { targetName: null }, 'Invite cancelled', 'danger', 'Anita Rao cancelled the invite for ben@jbf.org'],
    [
      'invite.accepted',
      { actorName: 'Ben Okoye', actorLabel: 'ben@jbf.org' },
      'Invite accepted',
      'success',
      'Ben Okoye accepted their invite and joined',
    ],
    [
      'user.role_changed',
      { changes: { role: { before: 'staff', after: 'admin' } } },
      'Role changed',
      'change',
      "Anita Rao changed Ben Okoye's role from Staff to Admin",
    ],
    ['user.deactivated', {}, 'Deactivated', 'danger', 'Anita Rao deactivated Ben Okoye'],
    ['user.reactivated', {}, 'Reactivated', 'success', 'Anita Rao reactivated Ben Okoye'],
    ['audit.viewed', {}, 'Viewed audit log', 'neutral', 'Anita Rao opened the audit log'],
    ['audit.exported', { metadata: { rowCount: 42 } }, 'Exported audit log', 'neutral', 'Anita Rao exported 42 audit log rows'],
    ['audit.exported', { metadata: { rowCount: 1 } }, 'Exported audit log', 'neutral', 'Anita Rao exported 1 audit log row'],
  ] as const)('%s %j', (action, overrides, label, tone, summary) => {
    const result = present({ action, ...overrides } as Partial<PresentableEntry>);
    expect(result).toEqual({ label, tone, category: 'accounts', summary });
  });

  it('covers every known action with a specific presentation (no generic fallback)', () => {
    for (const action of AUDIT_ACTIONS) {
      const result = present({ action });
      expect(result.label).not.toBe(action);
      expect(result.summary).not.toMatch(/performed/);
    }
  });

  it('names the system when there is no actor', () => {
    const result = present({ action: 'invite.created', actorName: null, actorLabel: null, targetName: null, metadata: { role: 'admin' } });
    expect(result.summary).toBe('The system invited ben@jbf.org as Admin');
  });

  it('falls back to labels when names are unknown and to "someone" when there is no target', () => {
    expect(present({ action: 'user.deactivated', actorName: null, targetName: null }).summary).toBe('anita@jbf.org deactivated ben@jbf.org');
    expect(present({ action: 'user.deactivated', targetName: null, targetLabel: null }).summary).toBe('Anita Rao deactivated someone');
  });

  it('shows "unknown" for a role change with missing before/after values', () => {
    expect(present({ action: 'user.role_changed', changes: null }).summary).toBe(
      "Anita Rao changed Ben Okoye's role from unknown to unknown",
    );
  });

  it('presents an unknown future action without failing', () => {
    expect(present({ action: 'content.created' })).toEqual({
      label: 'content.created',
      tone: 'neutral',
      category: 'content',
      summary: 'Anita Rao performed content.created',
    });
    expect(present({ action: 'playback.played' }).category).toBe('playback');
  });
});

describe('categoryOf', () => {
  it.each([
    ['auth.login.succeeded', 'accounts'],
    ['invite.created', 'accounts'],
    ['user.role_changed', 'accounts'],
    ['audit.viewed', 'accounts'],
    ['content.deleted', 'content'],
    ['file.uploaded', 'files'],
    ['playback.played', 'playback'],
    ['download.completed', 'playback'],
    ['something', 'accounts'],
  ])('%s -> %s', (action, category) => {
    expect(categoryOf(action)).toBe(category);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w @jbf/api -- audit-presentation`
Expected: FAIL — cannot find module `./audit-presentation` and `AUDIT_ACTIONS`.

- [ ] **Step 3: Implement**

`apps/api/src/audit/audit.actions.ts` (replace the whole file):

```ts
export const AUDIT_ACTIONS = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh.reuse_detected',
  'auth.password.changed',
  'auth.password.reset_requested',
  'auth.password.reset_completed',
  'invite.created',
  'invite.resent',
  'invite.cancelled',
  'invite.accepted',
  'user.deactivated',
  'user.reactivated',
  'user.role_changed',
  'audit.viewed',
  'audit.exported',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
```

`apps/api/src/audit/audit-presentation.ts`:

```ts
import type { AuditChanges } from '../db/schema';
import type { AuditAction } from './audit.actions';

export type AuditTone = 'change' | 'danger' | 'warning' | 'success' | 'neutral';
export type AuditCategory = 'accounts' | 'content' | 'files' | 'playback';

export interface PresentableEntry {
  action: string;
  source: string;
  actorLabel: string | null;
  actorName: string | null;
  targetLabel: string | null;
  targetName: string | null;
  changes: AuditChanges | null;
  metadata: Record<string, unknown> | null;
}

export interface Presentation {
  label: string;
  tone: AuditTone;
  category: AuditCategory;
  summary: string;
}

// 'accounts' is every action that does not start with one of these prefixes.
export const CATEGORY_PREFIXES = {
  content: ['content'],
  files: ['file'],
  playback: ['playback', 'download'],
} as const;

export function categoryOf(action: string): AuditCategory {
  const prefix = action.split('.')[0] ?? '';
  if ((CATEGORY_PREFIXES.content as readonly string[]).includes(prefix)) return 'content';
  if ((CATEGORY_PREFIXES.files as readonly string[]).includes(prefix)) return 'files';
  if ((CATEGORY_PREFIXES.playback as readonly string[]).includes(prefix)) return 'playback';
  return 'accounts';
}

interface Context {
  actor: string;
  target: string;
  entry: PresentableEntry;
}

interface ActionSpec {
  label: string;
  tone: AuditTone;
  summary: (context: Context) => string;
}

const roleLabel = (value: unknown): string => {
  if (value === 'admin') return 'Admin';
  if (value === 'staff') return 'Staff';
  return String(value ?? 'unknown');
};

const FAILURE_REASONS: Record<string, string> = {
  unknown_email: 'no account with that email',
  wrong_password: 'wrong password',
  locked: 'account is locked',
  deactivated: 'account is deactivated',
};

function failedSignIn({ entry }: Context): string {
  const who = entry.actorName ?? entry.actorLabel ?? 'an unknown email';
  const reason = typeof entry.metadata?.reason === 'string' ? FAILURE_REASONS[entry.metadata.reason] : undefined;
  if (!reason) return `Failed sign-in for ${who}`;
  const lockedNow = entry.metadata?.locked === true ? ', account now locked' : '';
  return `Failed sign-in for ${who} (${reason}${lockedNow})`;
}

function exportedRows({ actor, entry }: Context): string {
  const count = entry.metadata?.rowCount;
  if (typeof count !== 'number') return `${actor} exported audit log rows`;
  return `${actor} exported ${count} audit log row${count === 1 ? '' : 's'}`;
}

const SPECS: Record<AuditAction, ActionSpec> = {
  'auth.login.succeeded': {
    label: 'Signed in',
    tone: 'success',
    summary: ({ actor, entry }) => `${actor} signed in from the ${entry.source === 'mobile' ? 'app' : 'portal'}`,
  },
  'auth.login.failed': { label: 'Sign-in failed', tone: 'warning', summary: failedSignIn },
  'auth.logout': { label: 'Signed out', tone: 'neutral', summary: ({ actor }) => `${actor} signed out` },
  'auth.logout_all': {
    label: 'Signed out everywhere',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} signed out of all devices`,
  },
  'auth.refresh.reuse_detected': {
    label: 'Session reuse detected',
    tone: 'warning',
    summary: ({ actor }) => `${actor}'s session was ended because an old session token was used again`,
  },
  'auth.password.changed': {
    label: 'Password changed',
    tone: 'change',
    summary: ({ actor }) => `${actor} changed their password`,
  },
  'auth.password.reset_requested': {
    label: 'Password reset requested',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} requested a password reset`,
  },
  'auth.password.reset_completed': {
    label: 'Password reset',
    tone: 'change',
    summary: ({ actor }) => `${actor} reset their password`,
  },
  'invite.created': {
    label: 'Invite sent',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} invited ${target} as ${roleLabel(entry.metadata?.role)}`,
  },
  'invite.resent': {
    label: 'Invite resent',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} resent the invite to ${target}`,
  },
  'invite.cancelled': {
    label: 'Invite cancelled',
    tone: 'danger',
    summary: ({ actor, target }) => `${actor} cancelled the invite for ${target}`,
  },
  'invite.accepted': {
    label: 'Invite accepted',
    tone: 'success',
    summary: ({ actor }) => `${actor} accepted their invite and joined`,
  },
  'user.role_changed': {
    label: 'Role changed',
    tone: 'change',
    summary: ({ actor, target, entry }) =>
      `${actor} changed ${target}'s role from ${roleLabel(entry.changes?.role?.before)} to ${roleLabel(entry.changes?.role?.after)}`,
  },
  'user.deactivated': {
    label: 'Deactivated',
    tone: 'danger',
    summary: ({ actor, target }) => `${actor} deactivated ${target}`,
  },
  'user.reactivated': {
    label: 'Reactivated',
    tone: 'success',
    summary: ({ actor, target }) => `${actor} reactivated ${target}`,
  },
  'audit.viewed': {
    label: 'Viewed audit log',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} opened the audit log`,
  },
  'audit.exported': { label: 'Exported audit log', tone: 'neutral', summary: exportedRows },
};

export function presentAudit(entry: PresentableEntry): Presentation {
  const context: Context = {
    actor: entry.actorName ?? entry.actorLabel ?? 'The system',
    target: entry.targetName ?? entry.targetLabel ?? 'someone',
    entry,
  };
  const category = categoryOf(entry.action);
  const spec = (SPECS as Record<string, ActionSpec | undefined>)[entry.action];
  if (!spec) {
    return { label: entry.action, tone: 'neutral', category, summary: `${context.actor} performed ${entry.action}` };
  }
  return { label: spec.label, tone: spec.tone, category, summary: spec.summary(context) };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -w @jbf/api && npm run lint && npm run build -w @jbf/api`
Expected: all PASS; no unused-export complaints. (`CATEGORY_PREFIXES` is consumed by Task 2.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit
git commit -m "feat: add audit labels, tones, categories and plain-English summaries"
```

---

### Task 2: Audit read API (indexes, filters, keyset paging, names)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (two indexes), `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/drizzle/0002_audit_log_read_indexes.sql` (generated), `apps/api/src/audit/{audit.schemas,audit-cursor,audit-query.service,audit.controller}.ts`
- Create: `apps/api/test/helpers/audit.ts`
- Test: `apps/api/src/audit/audit-cursor.spec.ts`, `apps/api/test/audit.e2e-spec.ts`

**Interfaces:**
- Consumes: `presentAudit`, `CATEGORY_PREFIXES`, `AuditCategory` (Task 1); `auditLog`, `users`; `ZodPipe`; `Roles`, `CurrentUser`.
- Produces:

```ts
// audit.schemas.ts
auditFilterSchema, auditQuerySchema; type AuditFilters, AuditQuery   // see code
// audit-cursor.ts
type AuditCursor = { t: string; id: string }; encodeCursor(c): string; decodeCursor(token): AuditCursor   // 400 on invalid
// audit-query.service.ts
interface AuditEntryView { id; occurredAt: Date; actor: {id: string|null; role: Role|null; label: string|null; name: string|null} | null; action: string; label: string; tone: AuditTone; category: AuditCategory; target: {type: string; id: string; label: string|null; name: string|null} | null; source: string; ip: string|null; userAgent: string|null; appVersion: string|null; requestId: string|null; changes: AuditChanges|null; metadata: Record<string,unknown>|null; summary: string }
AuditQueryService.list(query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }>
AuditQueryService.count(filters: AuditFilters): Promise<number>
AuditQueryService.pages(filters: AuditFilters, size: number): AsyncGenerator<AuditEntryView[]>
// HTTP: GET /api/audit  (Admin only)
```

- [ ] **Step 1: Add the indexes and generate the migration**

In `apps/api/src/db/schema.ts`, change the `audit_log` index list from

```ts
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_action_idx').on(table.action),
  ],
```

to

```ts
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_paging_idx').on(table.occurredAt.desc(), table.id.desc()),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_target_idx').on(table.targetId),
    index('audit_log_action_idx').on(table.action),
  ],
```

```bash
cd apps/api && npx drizzle-kit generate --name=audit_log_read_indexes && cd ../..
```

Expected: `apps/api/drizzle/0002_audit_log_read_indexes.sql` containing two `CREATE INDEX` statements (`audit_log_paging_idx` with `"occurred_at" DESC NOT NULL, "id" DESC NOT NULL` and `audit_log_target_idx`), plus a new snapshot and journal entry. Open the SQL and confirm it creates nothing else. If drizzle-kit does not accept `.desc()` in `index().on()` for the installed version, use `` sql`${table.occurredAt} desc` `` / `` sql`${table.id} desc` `` expressions instead and say so in your report.

- [ ] **Step 2: Test helpers and the failing cursor unit test**

`apps/api/test/helpers/audit.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/db/db.module';
import { type AuditChanges, auditLog, type Role } from '../../src/db/schema';

export interface SeedRow {
  occurredAt?: Date;
  actorId?: string | null;
  actorRole?: Role | null;
  actorLabel?: string | null;
  action?: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  source?: string;
  changes?: AuditChanges | null;
  metadata?: Record<string, unknown> | null;
}

export async function seedAudit(db: Database, rows: SeedRow[]): Promise<string[]> {
  const inserted = await db
    .insert(auditLog)
    .values(rows.map((row) => ({ action: 'auth.login.succeeded', source: 'portal', ...row })))
    .returning({ id: auditLog.id });
  return inserted.map((row) => row.id);
}

// Inserts one row at an exact timestamp string (microsecond precision), for paging tests.
export async function seedAuditAt(db: Database, occurredAt: string, row: { actorId?: string; action?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into audit_log (id, occurred_at, actor_id, action, source)
        values (${id}, ${occurredAt}::timestamptz, ${row.actorId ?? null}, ${row.action ?? 'auth.login.succeeded'}, 'portal')`,
  );
  return id;
}
```

`apps/api/src/audit/audit-cursor.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './audit-cursor';

describe('audit cursor', () => {
  const cursor = { t: '2026-10-08 10:42:07.123456+00', id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' };

  it('round-trips and is url-safe', () => {
    const token = encodeCursor(cursor);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(cursor);
  });

  it('accepts timestamps without fractional seconds and with half-hour offsets', () => {
    const odd = { t: '2026-10-08 10:42:07+05:30', id: cursor.id };
    expect(decodeCursor(encodeCursor(odd))).toEqual(odd);
  });

  it.each([
    'garbage',
    '',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify({ t: 'yesterday', id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: '2026-10-08 10:42:07+00', id: 'nope' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: "2026-10-08'; drop table audit_log;--", id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })).toString('base64url'),
  ])('rejects %p with a 400 about the cursor', (token) => {
    expect(() => decodeCursor(token)).toThrow(BadRequestException);
  });
});
```

Run: `npm test -w @jbf/api -- audit-cursor` → FAIL (module not found).

- [ ] **Step 3: Implement the cursor and the schemas**

`apps/api/src/audit/audit-cursor.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// `t` is the row's timestamp as Postgres prints it (microseconds), not a JS Date, so paging is exact.
const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
  id: z.uuid(),
});

export type AuditCursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (cursor: AuditCursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeCursor(token: string): AuditCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException({
      error: 'Bad Request',
      message: 'Validation failed',
      fieldErrors: { cursor: ['Invalid cursor.'] },
    });
  }
}
```

`apps/api/src/audit/audit.schemas.ts`:

```ts
import { z } from 'zod';
import { AUDIT_ACTIONS } from './audit.actions';

export const auditFilterSchema = z.object({
  actorId: z.uuid().optional(),
  involving: z.uuid().optional(),
  category: z.enum(['accounts', 'content', 'files', 'playback']).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  includePlayback: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const auditQuerySchema = auditFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
```

If the installed zod does not expose `z.iso.datetime` or `z.uuid`, use the closest equivalents (`z.string().datetime({ offset: true })`, `z.string().uuid()`), keep the same accepted inputs, and list the adaptation in your report.

Run: `npm test -w @jbf/api -- audit-cursor` → PASS.

- [ ] **Step 4: Write the failing e2e tests**

`apps/api/test/audit.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import type { User } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedAudit, seedAuditAt } from './helpers/audit';
import { createUser } from './helpers/users';

describe('GET /api/audit', () => {
  let app: NestExpressApplication;
  let db: Database;
  let adminUser: User;
  let admin: Session;
  let staff: Session;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    adminUser = await createUser(db, { role: 'admin', name: 'Anita Rao' });
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  const get = (query = '') => request(app.getHttpServer()).get(`/api/audit${query}`).set(...bearer(admin));
  const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  it('is Admin-only', async () => {
    await request(app.getHttpServer()).get('/api/audit').expect(401);
    await request(app.getHttpServer()).get('/api/audit').set(...bearer(staff)).expect(403);
  });

  describe('paging', () => {
    it('returns every row exactly once, in a stable newest-first order, across identical and microsecond-different timestamps', async () => {
      const actorId = randomUUID();
      const stamps = [
        '2026-01-01 10:00:00.000300+00',
        '2026-01-01 10:00:00.000300+00',
        '2026-01-01 10:00:00.000200+00',
        '2026-01-01 10:00:00.000100+00',
        '2026-01-01 09:59:59+00',
        '2026-01-01 09:59:59+00',
        '2026-01-01 09:00:00+00',
      ];
      const seeded: string[] = [];
      for (const stamp of stamps) seeded.push(await seedAuditAt(db, stamp, { actorId }));

      const all = await get(`?actorId=${actorId}&limit=100`).expect(200);
      expect(all.body.nextCursor).toBeNull();
      const expectedOrder = ids(all.body);
      expect(new Set(expectedOrder)).toEqual(new Set(seeded));

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await get(`?actorId=${actorId}&limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
        seen.push(...ids(res.body));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual(expectedOrder);
      expect(new Set(seen).size).toBe(7);
    });

    it('is not disturbed by newer rows arriving between pages', async () => {
      const actorId = randomUUID();
      for (const stamp of ['2026-02-01 10:00:05+00', '2026-02-01 10:00:04+00', '2026-02-01 10:00:03+00', '2026-02-01 10:00:02+00']) {
        await seedAuditAt(db, stamp, { actorId });
      }
      const first = await get(`?actorId=${actorId}&limit=2`).expect(200);
      const secondBefore = await get(`?actorId=${actorId}&limit=2&cursor=${first.body.nextCursor}`).expect(200);

      await seedAuditAt(db, '2026-02-01 10:00:09+00', { actorId });
      const secondAfter = await get(`?actorId=${actorId}&limit=2&cursor=${first.body.nextCursor}`).expect(200);
      expect(ids(secondAfter.body)).toEqual(ids(secondBefore.body));
    });

    it('defaults to 50 per page and rejects out-of-range limits', async () => {
      const res = await get().expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(50);
      for (const limit of ['0', '101', 'abc']) {
        const bad = await get(`?limit=${limit}`).expect(400);
        expect(bad.body.fieldErrors.limit).toBeDefined();
      }
    });
  });

  describe('filters', () => {
    it('filters by actor and by involving (performed by OR done to)', async () => {
      const person = randomUUID();
      const other = randomUUID();
      const [byPerson, toPerson, unrelated] = await seedAudit(db, [
        { actorId: person, action: 'user.deactivated', targetType: 'user', targetId: other },
        { actorId: other, action: 'user.reactivated', targetType: 'user', targetId: person },
        { actorId: other, action: 'user.role_changed', targetType: 'user', targetId: other },
      ]);
      expect(ids((await get(`?actorId=${person}`).expect(200)).body)).toEqual([byPerson]);
      expect(new Set(ids((await get(`?involving=${person}`).expect(200)).body))).toEqual(new Set([byPerson, toPerson]));
      expect(ids((await get(`?involving=${person}`).expect(200)).body)).not.toContain(unrelated);
    });

    it('does not treat an invite target id as a user target for involving', async () => {
      const id = randomUUID();
      await seedAudit(db, [{ actorId: randomUUID(), action: 'invite.created', targetType: 'invite', targetId: id }]);
      expect((await get(`?involving=${id}`).expect(200)).body.items).toEqual([]);
    });

    it('filters by category and action', async () => {
      const actorId = randomUUID();
      const [account, content, file] = await seedAudit(db, [
        { actorId, action: 'auth.logout' },
        { actorId, action: 'content.created' },
        { actorId, action: 'file.uploaded' },
      ]);
      expect(ids((await get(`?actorId=${actorId}&category=accounts`).expect(200)).body)).toEqual([account]);
      expect(ids((await get(`?actorId=${actorId}&category=content`).expect(200)).body)).toEqual([content]);
      expect(ids((await get(`?actorId=${actorId}&category=files`).expect(200)).body)).toEqual([file]);
      expect(ids((await get(`?actorId=${actorId}&action=auth.logout`).expect(200)).body)).toEqual([account]);
    });

    it('hides playback by default ("Changes only") and shows it with includePlayback or category=playback', async () => {
      const actorId = randomUUID();
      const [signIn, played, downloaded] = await seedAudit(db, [
        { actorId, action: 'auth.login.succeeded' },
        { actorId, action: 'playback.played' },
        { actorId, action: 'download.completed' },
      ]);
      expect(ids((await get(`?actorId=${actorId}`).expect(200)).body)).toEqual([signIn]);
      expect(new Set(ids((await get(`?actorId=${actorId}&includePlayback=true`).expect(200)).body))).toEqual(
        new Set([signIn, played, downloaded]),
      );
      expect(new Set(ids((await get(`?actorId=${actorId}&category=playback`).expect(200)).body))).toEqual(
        new Set([played, downloaded]),
      );
    });

    it('filters by date range (inclusive)', async () => {
      const actorId = randomUUID();
      await seedAuditAt(db, '2026-03-01 08:00:00+00', { actorId });
      const middle = await seedAuditAt(db, '2026-03-02 12:00:00+00', { actorId });
      await seedAuditAt(db, '2026-03-03 18:00:00+00', { actorId });
      const res = await get(`?actorId=${actorId}&from=2026-03-02T00:00:00.000Z&to=2026-03-02T23:59:59.999Z`).expect(200);
      expect(ids(res.body)).toEqual([middle]);
    });

    it('searches labels, action and names case-insensitively, and treats % and _ literally', async () => {
      const tag = randomUUID();
      const named = await createUser(db, { name: `Zelda ${tag.slice(0, 8)}` });
      const [byLabel, byName, percent, plain] = await seedAudit(db, [
        { actorLabel: `needle-${tag}@example.com` },
        { actorId: named.id, actorLabel: named.email },
        { actorLabel: `100%-${tag}` },
        { actorLabel: `100x-${tag}` },
      ]);
      expect(ids((await get(`?q=NEEDLE-${tag}`).expect(200)).body)).toEqual([byLabel]);
      expect(ids((await get(`?q=zelda ${tag.slice(0, 8)}`).expect(200)).body)).toEqual([byName]);
      expect(ids((await get(`?q=${encodeURIComponent(`100%-${tag}`)}`).expect(200)).body)).toEqual([percent]);
      expect(ids((await get(`?q=${encodeURIComponent(`100_-${tag}`)}`).expect(200)).body)).toEqual([]);
      expect(plain).toBeDefined();
    });

    it('rejects invalid filter values with field errors', async () => {
      const cases: [string, string][] = [
        ['actorId=nope', 'actorId'],
        ['involving=nope', 'involving'],
        ['category=other', 'category'],
        ['action=made.up', 'action'],
        ['from=yesterday', 'from'],
        ['to=tomorrow', 'to'],
        ['cursor=garbage', 'cursor'],
        [`q=${'x'.repeat(101)}`, 'q'],
        ['includePlayback=maybe', 'includePlayback'],
      ];
      for (const [query, field] of cases) {
        const res = await get(`?${query}`).expect(400);
        expect(res.body.fieldErrors[field]).toBeDefined();
      }
    });
  });

  describe('entries', () => {
    it('presents people by name with the plain-English summary, tone, label and category', async () => {
      const target = await createUser(db, { name: 'Ben Okoye' });
      const [rowId] = await seedAudit(db, [
        {
          actorId: adminUser.id,
          actorRole: 'admin',
          actorLabel: adminUser.email,
          action: 'user.role_changed',
          targetType: 'user',
          targetId: target.id,
          targetLabel: target.email,
          changes: { role: { before: 'staff', after: 'admin' } },
          source: 'portal',
        },
      ]);
      const res = await get(`?involving=${target.id}`).expect(200);
      const entry = res.body.items.find((item: { id: string }) => item.id === rowId);
      expect(entry).toMatchObject({
        action: 'user.role_changed',
        label: 'Role changed',
        tone: 'change',
        category: 'accounts',
        summary: "Anita Rao changed Ben Okoye's role from Staff to Admin",
        actor: { id: adminUser.id, role: 'admin', label: adminUser.email, name: 'Anita Rao' },
        target: { type: 'user', id: target.id, label: target.email, name: 'Ben Okoye' },
        changes: { role: { before: 'staff', after: 'admin' } },
      });
    });

    it('returns the full record fields and a null actor/target when there are none', async () => {
      const marker = randomUUID();
      await seedAudit(db, [{ actorLabel: null, actorId: null, action: 'auth.logout', metadata: { marker } }]);
      const res = await get('?q=auth.logout&limit=100').expect(200);
      const entry = res.body.items.find((item: { metadata: { marker?: string } | null }) => item.metadata?.marker === marker);
      expect(entry.actor).toBeNull();
      expect(entry.target).toBeNull();
      expect(Object.keys(entry).sort()).toEqual(
        [
          'action', 'actor', 'appVersion', 'category', 'changes', 'id', 'ip', 'label', 'metadata', 'occurredAt',
          'requestId', 'source', 'summary', 'target', 'tone', 'userAgent',
        ].sort(),
      );
    });

    it('shows the typed label for failed sign-ins of unknown emails', async () => {
      const label = `ghost-${randomUUID()}@example.com`;
      await seedAudit(db, [{ actorLabel: label, action: 'auth.login.failed', metadata: { reason: 'unknown_email' } }]);
      const res = await get(`?q=${label}`).expect(200);
      expect(res.body.items[0]).toMatchObject({
        tone: 'warning',
        summary: `Failed sign-in for ${label} (no account with that email)`,
      });
    });
  });
});
```

Run: `npm test -w @jbf/api -- audit.e2e` → FAIL (404s).

- [ ] **Step 5: Implement the query service, controller and module**

`apps/api/src/audit/audit-query.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, like, lte, not, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../db/db.module';
import { type AuditChanges, auditLog, type Role, users } from '../db/schema';
import { type AuditCursor, decodeCursor, encodeCursor } from './audit-cursor';
import {
  type AuditCategory,
  type AuditTone,
  CATEGORY_PREFIXES,
  presentAudit,
} from './audit-presentation';
import type { AuditFilters, AuditQuery } from './audit.schemas';

export interface AuditEntryView {
  id: string;
  occurredAt: Date;
  actor: { id: string | null; role: Role | null; label: string | null; name: string | null } | null;
  action: string;
  label: string;
  tone: AuditTone;
  category: AuditCategory;
  target: { type: string; id: string; label: string | null; name: string | null } | null;
  source: string;
  ip: string | null;
  userAgent: string | null;
  appVersion: string | null;
  requestId: string | null;
  changes: AuditChanges | null;
  metadata: Record<string, unknown> | null;
  summary: string;
}

const actorUser = alias(users, 'actor_user');
const targetUser = alias(users, 'target_user');

type Row = {
  entry: typeof auditLog.$inferSelect;
  actorName: string | null;
  targetName: string | null;
  occurredAtText: string;
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

const hasPrefix = (prefixes: readonly string[]): SQL =>
  or(...prefixes.map((prefix) => like(auditLog.action, `${prefix}.%`)))!;

function categoryCondition(category: AuditCategory): SQL {
  if (category === 'accounts') {
    return not(hasPrefix([...CATEGORY_PREFIXES.content, ...CATEGORY_PREFIXES.files, ...CATEGORY_PREFIXES.playback]));
  }
  return hasPrefix(CATEGORY_PREFIXES[category]);
}

function toView(row: Row): AuditEntryView {
  const { entry } = row;
  const presentation = presentAudit({
    action: entry.action,
    source: entry.source,
    actorLabel: entry.actorLabel,
    actorName: row.actorName,
    targetLabel: entry.targetLabel,
    targetName: row.targetName,
    changes: entry.changes,
    metadata: entry.metadata,
  });
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor:
      entry.actorId || entry.actorLabel || entry.actorRole
        ? { id: entry.actorId, role: entry.actorRole, label: entry.actorLabel, name: row.actorName }
        : null,
    action: entry.action,
    label: presentation.label,
    tone: presentation.tone,
    category: presentation.category,
    target:
      entry.targetType && entry.targetId
        ? { type: entry.targetType, id: entry.targetId, label: entry.targetLabel, name: row.targetName }
        : null,
    source: entry.source,
    ip: entry.ip,
    userAgent: entry.userAgent,
    appVersion: entry.appVersion,
    requestId: entry.requestId,
    changes: entry.changes,
    metadata: entry.metadata,
    summary: presentation.summary,
  };
}

@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.fetch(query, query.limit + 1, cursor);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toView),
      nextCursor: hasMore && last ? encodeCursor({ t: last.occurredAtText, id: last.entry.id }) : null,
    };
  }

  async count(filters: AuditFilters): Promise<number> {
    const [result] = await this.db
      .select({ total: count() })
      .from(auditLog)
      .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .leftJoin(targetUser, and(eq(auditLog.targetType, 'user'), sql`${targetUser.id}::text = ${auditLog.targetId}`))
      .where(and(...this.conditions(filters)));
    return result?.total ?? 0;
  }

  async *pages(filters: AuditFilters, size: number): AsyncGenerator<AuditEntryView[]> {
    let cursor: AuditCursor | undefined;
    for (;;) {
      const rows = await this.fetch(filters, size, cursor);
      if (rows.length === 0) return;
      yield rows.map(toView);
      const last = rows[rows.length - 1]!;
      if (rows.length < size) return;
      cursor = { t: last.occurredAtText, id: last.entry.id };
    }
  }

  private fetch(filters: AuditFilters, limit: number, cursor?: AuditCursor): Promise<Row[]> {
    return this.db
      .select({
        entry: auditLog,
        actorName: actorUser.name,
        targetName: targetUser.name,
        occurredAtText: sql<string>`${auditLog.occurredAt}::text`,
      })
      .from(auditLog)
      .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .leftJoin(targetUser, and(eq(auditLog.targetType, 'user'), sql`${targetUser.id}::text = ${auditLog.targetId}`))
      .where(
        and(
          ...this.conditions(filters),
          cursor ? sql`(${auditLog.occurredAt}, ${auditLog.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(limit);
  }

  private conditions(filters: AuditFilters): (SQL | undefined)[] {
    const pattern = filters.q ? `%${escapeLike(filters.q)}%` : undefined;
    const showPlayback = filters.includePlayback || filters.category === 'playback';
    return [
      filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
      filters.involving
        ? or(
            eq(auditLog.actorId, filters.involving),
            and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, filters.involving)),
          )
        : undefined,
      filters.category ? categoryCondition(filters.category) : undefined,
      showPlayback ? undefined : not(categoryCondition('playback')),
      filters.action ? eq(auditLog.action, filters.action) : undefined,
      filters.from ? gte(auditLog.occurredAt, new Date(filters.from)) : undefined,
      filters.to ? lte(auditLog.occurredAt, new Date(filters.to)) : undefined,
      pattern
        ? or(
            ilike(auditLog.actorLabel, pattern),
            ilike(auditLog.targetLabel, pattern),
            ilike(auditLog.action, pattern),
            ilike(actorUser.name, pattern),
            ilike(targetUser.name, pattern),
          )
        : undefined,
    ];
  }
}
```

`apps/api/src/audit/audit.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { type AuditQuery, auditQuerySchema } from './audit.schemas';

@Roles('admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly queries: AuditQueryService) {}

  @Get()
  list(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    return this.queries.list(query);
  }
}
```

`apps/api/src/audit/audit.module.ts` (replace):

```ts
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
```

- [ ] **Step 6: Run everything and iterate to green**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS for all suites (milestone 1's 131 tests plus the new ones). Things to verify if a test fails, not to loosen: (a) the paging test's third assertion (`seen` equals the single-request order) fails if the cursor is built from a JS `Date` instead of `occurredAtText`; (b) `q=100%-…` fails if `%` is not escaped; (c) `involving` must match only `target_type = 'user'`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat: add audit log read API with filters, keyset paging and names"
```

---

### Task 3: Audit export, "page opened" marker, and CSV safety

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`, `apps/api/.env.example`, `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/src/audit/{csv.ts,csv.spec.ts,audit-export.service.ts}`, `apps/api/test/helpers/csv.ts`, `apps/api/test/audit-export.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuditQueryService.count/pages`, `AuditFilters`, `auditFilterSchema`, `AuditService.record`, `ENV`.
- Produces:

```ts
csvCell(value: unknown): string; csvRow(values: unknown[]): string      // CRLF-terminated
AuditExportService.writeCsv(admin: AuthUser, filters: AuditFilters, res: Response): Promise<void>
Env.AUDIT_EXPORT_MAX_ROWS: number (default 50000)
HTTP: POST /api/audit/opened -> 204 (records audit.viewed); GET /api/audit/export.csv?<filters> -> text/csv
```

- [ ] **Step 1: Write the failing unit tests (csv and env)**

`apps/api/src/audit/csv.spec.ts`:

```ts
import { csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it('leaves plain text alone and renders null/undefined as empty', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('quotes cells containing commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it.each(['=1+1', '+1+1', '-2+3', '@SUM(1)', '\tcmd', '\rcmd'])('neutralizes the formula-leading cell %j with a leading apostrophe', (value) => {
    expect(csvCell(value).startsWith("'") || csvCell(value).startsWith('"\'')).toBe(true);
    expect(csvCell(value)).not.toMatch(/^"?[=+\-@\t\r]/);
  });

  it('neutralizes first and then quotes', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it('serializes objects as JSON', () => {
    expect(csvCell({ role: { before: 'staff', after: 'admin' } })).toBe('"{""role"":{""before"":""staff"",""after"":""admin""}}"');
  });
});

describe('csvRow', () => {
  it('joins cells with commas and ends with CRLF', () => {
    expect(csvRow(['a', 'b,c', null])).toBe('a,"b,c",\r\n');
  });
});
```

In `apps/api/src/config/env.spec.ts` add inside the existing `describe('parseEnv', …)`:

```ts
  it('defaults the audit export cap to 50,000 rows and accepts an override', () => {
    expect(parseEnv(base).AUDIT_EXPORT_MAX_ROWS).toBe(50_000);
    expect(parseEnv({ ...base, AUDIT_EXPORT_MAX_ROWS: '5' }).AUDIT_EXPORT_MAX_ROWS).toBe(5);
    expect(() => parseEnv({ ...base, AUDIT_EXPORT_MAX_ROWS: '0' })).toThrow(/AUDIT_EXPORT_MAX_ROWS/);
  });
```

Run: `npm test -w @jbf/api -- csv env.spec` → FAIL.

- [ ] **Step 2: Implement csv and env**

`apps/api/src/audit/csv.ts`:

```ts
// Cells that start with these characters are executed as formulas by spreadsheet programs. Audit labels can
// contain attacker-typed text (failed sign-ins store the typed email), so such cells get a leading apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (values: unknown[]): string => `${values.map(csvCell).join(',')}\r\n`;
```

`apps/api/src/config/env.ts`: add to the zod object (after `THROTTLE_ENABLED`):

```ts
    AUDIT_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
```

`apps/api/.env.example`: append `AUDIT_EXPORT_MAX_ROWS=50000`.

Run: `npm test -w @jbf/api -- csv env.spec` → PASS.

- [ ] **Step 3: Write the failing e2e tests**

`apps/api/test/helpers/csv.ts`:

```ts
// Minimal RFC 4180 parser for tests: returns rows of cells; handles quoted cells, doubled quotes and CRLF.
export function parseCsv(text: string): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
```

`apps/api/test/audit-export.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, type User } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedAudit } from './helpers/audit';
import { parseCsv } from './helpers/csv';
import { createUser } from './helpers/users';

describe('audit export and page-opened marker', () => {
  let app: NestExpressApplication;
  let db: Database;
  let adminUser: User;
  let admin: Session;
  let staff: Session;

  beforeAll(async () => {
    process.env.AUDIT_EXPORT_MAX_ROWS = '5';
    ({ app, db } = await createTestApp());
    adminUser = await createUser(db, { role: 'admin', name: 'Anita Rao' });
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const exportCsv = (query: string) =>
    http()
      .get(`/api/audit/export.csv?${query}`)
      .set(...bearer(admin))
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => callback(null, data));
      });

  it('is Admin-only for both endpoints', async () => {
    await http().post('/api/audit/opened').expect(401);
    await http().post('/api/audit/opened').set(...bearer(staff)).expect(403);
    await http().get('/api/audit/export.csv').expect(401);
    await http().get('/api/audit/export.csv').set(...bearer(staff)).expect(403);
  });

  describe('POST /api/audit/opened', () => {
    it('records one audit.viewed entry per call for the signed-in Admin', async () => {
      const before = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.viewed')));
      await http().post('/api/audit/opened').set(...bearer(admin)).expect(204);
      const after = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.viewed')));
      expect(after.length).toBe(before.length + 1);
      expect(after.at(-1)).toMatchObject({ actorRole: 'admin', actorLabel: adminUser.email });
    });
  });

  describe('GET /api/audit/export.csv', () => {
    it('streams a UTF-8 CSV with a BOM, a header row and the filtered rows newest first', async () => {
      const actorId = randomUUID();
      await seedAudit(db, [
        { actorId, actorRole: 'staff', actorLabel: 'a@example.com', action: 'auth.logout', occurredAt: new Date('2026-04-01T10:00:00Z') },
        { actorId, actorRole: 'staff', actorLabel: 'a@example.com', action: 'auth.login.succeeded', occurredAt: new Date('2026-04-01T09:00:00Z') },
      ]);
      const res = await exportCsv(`actorId=${actorId}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.body.startsWith('﻿')).toBe(true);
      const rows = parseCsv(res.body);
      expect(rows[0]).toEqual([
        'Time (UTC)', 'Person', 'Role', 'Action', 'Label', 'Target type', 'Target', 'Source', 'IP', 'App version', 'Request id', 'Summary', 'Changes',
      ]);
      expect(rows).toHaveLength(3);
      expect(rows[1]![0]).toBe('2026-04-01T10:00:00.000Z');
      expect(rows[1]![3]).toBe('auth.logout');
      expect(rows[1]![11]).toBe('a@example.com signed out');
      expect(rows[2]![3]).toBe('auth.login.succeeded');
    });

    it('neutralizes spreadsheet formulas and quotes awkward text', async () => {
      const actorId = randomUUID();
      const labels = ['=HYPERLINK("http://evil")', '+1+1', '@SUM(1)', 'comma, "quote"\nnewline'];
      await seedAudit(
        db,
        labels.map((label, index) => ({
          actorId,
          actorLabel: label,
          action: 'auth.login.failed',
          occurredAt: new Date(Date.UTC(2026, 4, 1, 10, index)),
        })),
      );
      const rows = parseCsv((await exportCsv(`actorId=${actorId}`).expect(200)).body);
      const people = rows.slice(1).map((row) => row[1]);
      expect(people).toEqual(["comma, \"quote\"\nnewline", "'@SUM(1)", "'+1+1", "'=HYPERLINK(\"http://evil\")"]);
    });

    it('exports a header-only file when nothing matches', async () => {
      const rows = parseCsv((await exportCsv(`actorId=${randomUUID()}`).expect(200)).body);
      expect(rows).toHaveLength(1);
    });

    it('allows exactly the cap and refuses cap + 1 with a clear 413', async () => {
      const exactly = randomUUID();
      await seedAudit(db, Array.from({ length: 5 }, () => ({ actorId: exactly })));
      expect(parseCsv((await exportCsv(`actorId=${exactly}`).expect(200)).body)).toHaveLength(6);

      const tooMany = randomUUID();
      await seedAudit(db, Array.from({ length: 6 }, () => ({ actorId: tooMany })));
      const res = await http().get(`/api/audit/export.csv?actorId=${tooMany}`).set(...bearer(admin)).expect(413);
      expect(res.body.message).toBe('Too many rows to export (limit 5). Narrow the filters.');
      expect(res.body.requestId).toBeDefined();
    });

    it('records audit.exported with the filters and row count but never the exported data', async () => {
      const actorId = randomUUID();
      const secretLabel = `secret-label-${randomUUID()}`;
      await seedAudit(db, [{ actorId, actorLabel: secretLabel }, { actorId, actorLabel: secretLabel }]);
      await exportCsv(`actorId=${actorId}`).expect(200);
      const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.exported')));
      const entry = rows.at(-1)!;
      expect(entry.metadata).toMatchObject({ rowCount: 2, filters: { actorId } });
      expect(JSON.stringify(entry)).not.toContain(secretLabel);
    });

    it('rejects invalid filters before streaming anything', async () => {
      const res = await http().get('/api/audit/export.csv?actorId=nope').set(...bearer(admin)).expect(400);
      expect(res.body.fieldErrors.actorId).toBeDefined();
    });
  });
});
```

Run: `npm test -w @jbf/api -- audit-export` → FAIL (404s).

- [ ] **Step 4: Implement the export service and endpoints**

`apps/api/src/audit/audit-export.service.ts`:

```ts
import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { csvRow } from './csv';
import type { AuditFilters } from './audit.schemas';
import { AuditService } from './audit.service';

const COLUMNS = [
  'Time (UTC)', 'Person', 'Role', 'Action', 'Label', 'Target type', 'Target', 'Source', 'IP', 'App version', 'Request id', 'Summary', 'Changes',
];
const CHUNK = 1000;

const toRow = (view: AuditEntryView): unknown[] => [
  view.occurredAt.toISOString(),
  view.actor?.name ?? view.actor?.label,
  view.actor?.role,
  view.action,
  view.label,
  view.target?.type,
  view.target?.name ?? view.target?.label,
  view.source,
  view.ip,
  view.appVersion,
  view.requestId,
  view.summary,
  view.changes,
];

@Injectable()
export class AuditExportService {
  private readonly logger = new Logger(AuditExportService.name);

  constructor(
    private readonly queries: AuditQueryService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async writeCsv(admin: AuthUser, filters: AuditFilters, res: Response): Promise<void> {
    const max = this.env.AUDIT_EXPORT_MAX_ROWS;
    const total = await this.queries.count(filters);
    if (total > max) {
      throw new PayloadTooLargeException(`Too many rows to export (limit ${max}). Narrow the filters.`);
    }
    await this.audit.record(this.db, {
      actor: { id: admin.id, role: admin.role, label: admin.email },
      action: 'audit.exported',
      metadata: { filters, rowCount: total },
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(`﻿${csvRow([...COLUMNS])}`);
    try {
      for await (const page of this.queries.pages(filters, CHUNK)) {
        res.write(page.map((view) => csvRow(toRow(view))).join(''));
      }
      res.end();
    } catch (error) {
      this.logger.error(`Audit export failed part-way: ${error instanceof Error ? error.message : String(error)}`);
      res.destroy(error instanceof Error ? error : undefined);
    }
  }
}
```

`apps/api/src/audit/audit.controller.ts` (replace):

```ts
import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { DB, type Database } from '../db/db.module';
import { AuditExportService } from './audit-export.service';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { type AuditFilters, type AuditQuery, auditFilterSchema, auditQuerySchema } from './audit.schemas';
import { AuditService } from './audit.service';

@Roles('admin')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly queries: AuditQueryService,
    private readonly exporter: AuditExportService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  list(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    return this.queries.list(query);
  }

  // The Audit page calls this once when it opens; filter and page changes do not.
  @Post('opened')
  @HttpCode(204)
  async opened(@CurrentUser() user: AuthUser): Promise<void> {
    await this.audit.record(this.db, {
      actor: { id: user.id, role: user.role, label: user.email },
      action: 'audit.viewed',
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('export.csv')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(auditFilterSchema)) filters: AuditFilters,
    @Res() res: Response,
  ): Promise<void> {
    await this.exporter.writeCsv(user, filters, res);
  }
}
```

`apps/api/src/audit/audit.module.ts` (replace):

```ts
import { Module } from '@nestjs/common';
import { AuditExportService } from './audit-export.service';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditExportService],
  exports: [AuditService],
})
export class AuditModule {}
```

(`AuditQueryService` is no longer exported: only this module uses it.)

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS everywhere. Run `npm test -w @jbf/api -- audit` three times in a row to make sure the new suites are not order-dependent (they use unique actor ids). If streaming tests hang, check that `res.end()` is reached and that the `.parse(...)` callback in the test helper receives the whole body.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: add audit CSV export and the page-opened marker"
```

---

### Task 4: UI primitives (dialog and drawer, confirm, badge, tabs, table, select, states)

**Files:**
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/components/Button.tsx`, `Button.module.css`, `TextField.tsx`, `apps/web/src/test/setup.ts`
- Create: `apps/web/src/components/{use-field-ids.ts,Dialog.tsx,Dialog.module.css,ConfirmDialog.tsx,ConfirmDialog.module.css,Badge.tsx,Badge.module.css,Tabs.tsx,Tabs.module.css,Table.tsx,Table.module.css,Select.tsx,EmptyState.tsx,EmptyState.module.css,Skeleton.tsx,Skeleton.module.css}`
- Test: `Button.spec.tsx`, `Dialog.spec.tsx`, `ConfirmDialog.spec.tsx`, `Badge.spec.tsx`, `Tabs.spec.tsx`, `Table.spec.tsx`, `Select.spec.tsx`, `EmptyState.spec.tsx` (all under `apps/web/src/components/`)

**Interfaces:**
- Produces:

```ts
// Button: variant 'primary' | 'secondary' | 'danger'; size 'default' | 'small'; busy -> disabled + aria-busy
<Dialog open onClose title side?: 'center' | 'right' | 'left'>children</Dialog>   // children are mounted only while open
<ConfirmDialog open title confirmLabel cancelLabel?: string (default 'Cancel') tone?: 'primary' | 'danger' busy? error?: string | null onConfirm onCancel>message</ConfirmDialog>
<Badge tone: 'change' | 'danger' | 'warning' | 'success' | 'neutral'>text</Badge>
<Tabs label tabs: {id; label; count?}[] value onChange>active panel</Tabs>
<Table caption>thead/tbody (cells carry data-label for the stacked phone layout)</Table>
<Select label hint? error? ...select props>options</Select>
<EmptyState title>explanation / actions</EmptyState>      <Skeleton rows? />
useFieldIds(id, hint?, error?) -> { inputId, hintId, errorId, describedBy }
```

Dialog behaviour contract (from the modern-web-guidance dialog guides): open with `showModal()`; `aria-labelledby` the title; `closedby="any"`; where `HTMLDialogElement.prototype` lacks `closedBy` (Safari), a click whose target is the `<dialog>` itself and whose coordinates fall outside its rectangle closes it; Esc and platform close requests fire the native `close` event, which calls `onClose`; an element inside with `data-autofocus` receives focus after opening; children are rendered only while open so forms reset on every open; slide animation only under `prefers-reduced-motion: no-preference`; the page behind does not scroll while a modal dialog is open.

- [ ] **Step 1: Test setup for dialogs in jsdom**

Replace `apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no working <dialog> modal behaviour. These stand-ins mirror the parts the app relies on:
// showModal() opens the dialog; close() closes it and fires the `close` event once.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

afterEach(() => cleanup());
```

- [ ] **Step 2: Write the failing component tests**

`apps/web/src/components/Button.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('is disabled and marked busy while busy, and does not fire clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not marked busy when idle', () => {
    render(<Button variant="danger" size="small">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveAttribute('aria-busy');
  });
});
```

`apps/web/src/components/Dialog.spec.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ onClose = () => undefined, side }: { onClose?: () => void; side?: 'center' | 'right' | 'left' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Edit thing"
        side={side}
      >
        <p>Inside the dialog</p>
        <input aria-label="First field" data-autofocus />
        <button type="button">Inner button</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing inside while closed', () => {
    render(<Harness />);
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('opens as a labelled modal dialog and focuses the marked field', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('closedby', 'any');
    expect(screen.getByText('Inside the dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('First field')).toHaveFocus();
  });

  it('closes from the Close button and removes its content so forms start fresh next time', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('reports the native close event (Esc, back gesture) to onClose', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent(screen.getByRole('dialog'), new Event('close'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('light-dismisses on a click outside the dialog box (fallback for browsers without closedby)', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('dialog'), { clientX: 500, clientY: 500 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the click lands on something inside the dialog', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inner button' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Inside the dialog')).toBeInTheDocument();
  });

  it('can be a side drawer', async () => {
    render(<Harness side="right" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeInTheDocument();
  });
});
```

`apps/web/src/components/ConfirmDialog.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const renderDialog = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog open title="Deactivate Ben?" confirmLabel="Deactivate" tone="danger" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      Ben will be signed out immediately.
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel };
};

describe('ConfirmDialog', () => {
  it('shows the message and calls the right handler for each button', async () => {
    const { onConfirm, onCancel } = renderDialog();
    expect(screen.getByRole('dialog', { name: 'Deactivate Ben?' })).toBeInTheDocument();
    expect(screen.getByText('Ben will be signed out immediately.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy so a second click cannot submit twice', async () => {
    const { onConfirm } = renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Deactivate' });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('can word the cancel button differently', () => {
    renderDialog({ cancelLabel: 'Keep invite' });
    expect(screen.getByRole('button', { name: 'Keep invite' })).toBeInTheDocument();
  });

  it('shows a server error inside the dialog', () => {
    renderDialog({ error: 'At least one active Admin is required.' });
    expect(screen.getByRole('alert')).toHaveTextContent('At least one active Admin is required.');
  });
});
```

`apps/web/src/components/Badge.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it.each(['change', 'danger', 'warning', 'success', 'neutral'] as const)('shows its text label for the %s tone (color is never the only signal)', (tone) => {
    render(<Badge tone={tone}>Role changed</Badge>);
    expect(screen.getByText('Role changed')).toBeInTheDocument();
  });
});
```

`apps/web/src/components/Tabs.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

function Harness() {
  const [value, setValue] = useState('people');
  return (
    <Tabs
      label="Staff sections"
      tabs={[
        { id: 'people', label: 'People', count: 3 },
        { id: 'invites', label: 'Invites', count: 2 },
        { id: 'other', label: 'Other' },
      ]}
      value={value}
      onChange={setValue}
    >
      <p>Panel for {value}</p>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('exposes the tab pattern with counts, a selected tab and a labelled panel', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Staff sections' })).toBeInTheDocument();
    const people = screen.getByRole('tab', { name: 'People (3)' });
    expect(people).toHaveAttribute('aria-selected', 'true');
    expect(people).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'People (3)' })).toHaveTextContent('Panel for people');
  });

  it('switches on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Invites (2)' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for invites');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves selection and focus with the arrow keys, wrapping, and with Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'People (3)' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for invites');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Other' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Other' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveFocus();
  });
});
```

`apps/web/src/components/Table.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table } from './Table';

describe('Table', () => {
  it('names the table through its caption', () => {
    render(
      <Table caption="People">
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="Name">Ben</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });
});
```

`apps/web/src/components/Select.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
  it('connects the label, hint and error to the control', () => {
    render(
      <Select label="Role" hint="Admins can manage people" error="Choose a role.">
        <option value="staff">Staff</option>
      </Select>,
    );
    const select = screen.getByLabelText('Role');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Admins can manage people Choose a role.');
  });

  it('is not invalid without an error', () => {
    render(
      <Select label="Role">
        <option value="staff">Staff</option>
      </Select>,
    );
    expect(screen.getByLabelText('Role')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
```

`apps/web/src/components/EmptyState.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

describe('EmptyState and Skeleton', () => {
  it('EmptyState shows a title and its explanation', () => {
    render(<EmptyState title="No activity matches these filters">Try clearing a filter.</EmptyState>);
    expect(screen.getByText('No activity matches these filters')).toBeInTheDocument();
    expect(screen.getByText('Try clearing a filter.')).toBeInTheDocument();
  });

  it('Skeleton announces loading politely', () => {
    render(<Skeleton rows={3} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
```

Run: `npm test -w @jbf/web`
Expected: FAIL — the new component modules do not exist (existing 39 tests still pass once imports resolve).

- [ ] **Step 3: Tokens, base styles, Button, field ids**

`apps/web/src/styles/tokens.css`: add inside `:root` after `--color-info-surface`:

```css
  --color-warning: #92400e;
  --color-warning-surface: #fffbeb;
  --color-danger-hover: #8f1c12;
  --color-overlay: rgb(15 42 51 / 0.45);
```

`apps/web/src/styles/base.css`: append

```css
body:has(dialog:modal) {
  overflow: hidden;
}
```

`apps/web/src/components/Button.tsx` (replace):

```tsx
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'default' | 'small';
  busy?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'default',
  busy = false,
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[styles.button, styles[variant], size === 'small' ? styles.small : undefined, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
```

`apps/web/src/components/Button.module.css`: insert before `.button:disabled`:

```css
.danger {
  background: var(--color-danger);
  color: var(--color-primary-contrast);
}

.danger:hover:not(:disabled) {
  background: var(--color-danger-hover);
}

.small {
  min-height: 36px;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
}
```

`apps/web/src/components/use-field-ids.ts`:

```ts
import { useId } from 'react';

// Ids that tie a form control to its hint and error text, shared by TextField and Select.
export function useFieldIds(id: string | undefined, hint?: string, error?: string) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return { inputId, hintId, errorId, describedBy };
}
```

`apps/web/src/components/TextField.tsx` (replace):

```tsx
import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';
import { useFieldIds } from './use-field-ids';

type TextFieldProps = ComponentPropsWithRef<'input'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, id, ...rest }: TextFieldProps) {
  const { inputId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input {...rest} id={inputId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/Select.tsx`:

```tsx
import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';
import { useFieldIds } from './use-field-ids';

type SelectProps = ComponentPropsWithRef<'select'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Select({ label, hint, error, id, children, ...rest }: SelectProps) {
  const { inputId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <select {...rest} id={inputId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        {children}
      </select>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Dialog and ConfirmDialog**

`apps/web/src/components/Dialog.tsx`:

```tsx
import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'center' | 'right' | 'left';
  children: ReactNode;
}

// Browsers without `closedby` (Safari) get click-outside dismissal from the handler below.
const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
const LIGHT_DISMISS = { closedby: 'any' } as Record<string, string>;

export function Dialog({ open, onClose, title, side = 'center', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The native `close` event covers Esc, the back gesture, light dismiss and our own close() calls.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [onClose]);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (supportsClosedBy || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
    if (!inside) event.currentTarget.close();
  }

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[side]}`}
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      {...LIGHT_DISMISS}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </header>
        <div className={styles.body}>{open ? children : null}</div>
      </div>
    </dialog>
  );
}
```

`apps/web/src/components/Dialog.module.css`:

```css
.dialog {
  width: 100%;
  max-width: min(32rem, calc(100vw - var(--space-8)));
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text);
}

.dialog::backdrop {
  background: var(--color-overlay);
}

.right,
.left {
  height: 100dvh;
  max-height: none;
  max-width: none;
  width: min(34rem, 100vw);
  margin: 0;
  border-radius: 0;
}

.right {
  margin-inline-start: auto;
}

.left {
  margin-inline-end: auto;
  width: min(20rem, 85vw);
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.title {
  margin: 0;
  font-size: var(--text-lg);
}

.close {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-xl);
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  background: var(--color-surface);
}

.body {
  flex: 1;
  padding: var(--space-6);
  overflow-y: auto;
}

@media (prefers-reduced-motion: no-preference) {
  .right[open] {
    animation: slide-in-right 0.2s ease-out;
  }

  .left[open] {
    animation: slide-in-left 0.2s ease-out;
  }
}

@keyframes slide-in-right {
  from {
    transform: translateX(100%);
  }
}

@keyframes slide-in-left {
  from {
    transform: translateX(-100%);
  }
}

@media (max-width: 760px) {
  .right {
    width: 100vw;
  }
}
```

`apps/web/src/components/ConfirmDialog.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p>{children}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
```

`apps/web/src/components/ConfirmDialog.module.css`:

```css
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
```

- [ ] **Step 5: Badge, Tabs, Table, EmptyState, Skeleton**

`apps/web/src/components/Badge.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export function Badge({ tone, children }: { tone: 'change' | 'danger' | 'warning' | 'success' | 'neutral'; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
```

`apps/web/src/components/Badge.module.css`:

```css
.badge {
  display: inline-block;
  padding: 0 var(--space-2);
  border: 1px solid;
  border-radius: 999px;
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
}

.change {
  background: var(--color-info-surface);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.danger {
  background: var(--color-danger-surface);
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.warning {
  background: var(--color-warning-surface);
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.success {
  background: var(--color-success-surface);
  border-color: var(--color-success);
  color: var(--color-success);
}

.neutral {
  background: var(--color-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text-muted);
}
```

`apps/web/src/components/Tabs.tsx`:

```tsx
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import styles from './Tabs.module.css';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  label: string;
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

export function Tabs({ label, tabs, value, onChange, children }: TabsProps) {
  const base = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    buttons.current[target.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[tab.id] = element;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            className={`${styles.tab} ${tab.id === value ? styles.selected : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.count === undefined ? tab.label : `${tab.label} (${tab.count})`}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className={styles.panel}>
        {children}
      </div>
    </div>
  );
}
```

`apps/web/src/components/Tabs.module.css`:

```css
.list {
  display: flex;
  gap: var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.tab {
  min-height: 44px;
  padding: var(--space-2) 0;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.selected {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
}

.panel {
  padding-top: var(--space-4);
}
```

`apps/web/src/components/Table.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Table.module.css';

// Cells carry data-label="Column name" so each row can stack into labelled lines on a phone.
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
```

`apps/web/src/components/Table.module.css`:

```css
.wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  font-weight: 500;
  text-align: left;
}

.table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

@media (max-width: 760px) {
  .table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .table,
  .table tbody,
  .table tr {
    display: block;
  }

  .table tr {
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border-strong);
  }

  .table td {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-1) var(--space-3);
    border: 0;
  }

  .table td::before {
    content: attr(data-label);
    color: var(--color-text-muted);
    font-weight: 500;
  }
}
```

`apps/web/src/components/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.box}>
      <p className={styles.title}>{title}</p>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
```

`apps/web/src/components/EmptyState.module.css`:

```css
.box {
  padding: var(--space-8) var(--space-6);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius);
  background: var(--color-surface);
  text-align: center;
}

.title {
  margin-bottom: var(--space-2);
  font-weight: 600;
}
```

`apps/web/src/components/Skeleton.tsx`:

```tsx
import styles from './Skeleton.module.css';

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className={styles.box}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={styles.bar} />
      ))}
    </div>
  );
}
```

`apps/web/src/components/Skeleton.module.css`:

```css
.box {
  display: grid;
  gap: var(--space-3);
}

.bar {
  display: block;
  height: 1.25rem;
  border-radius: var(--radius);
  background: var(--color-surface);
}
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (the previous 39 web tests plus the new ones). If `getByRole('dialog', …)` cannot find the dialog, check that the polyfill in `setup.ts` sets the `open` attribute and that the element is not hidden by jsdom's default stylesheet; do not weaken the assertions.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add dialog, drawer, tabs, table and badge components"
```

---

### Task 5: App shell, navigation and dashboard

**Files:**
- Create: `apps/web/src/components/{nav-items.ts,NavLinks.tsx,NavLinks.module.css,AppShell.tsx,AppShell.module.css,AdminRoute.tsx}`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/test/session.tsx`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/pages/HomePage.module.css`
- Test: `apps/web/src/components/AppShell.spec.tsx`, `apps/web/src/components/AdminRoute.spec.tsx`

**Interfaces:**
- Consumes: `useAuth`, `ProtectedRoute`, `Dialog`, `Button`, `User` type.
- Produces:

```ts
// nav-items.ts
interface NavItem { to: string; label: string; group: 'main' | 'admin' | 'account'; adminOnly?: boolean; end?: boolean }
const NAV_ITEMS: NavItem[]          // later tasks append their item here
<AppShell />                        // layout route element: sidebar + top bar + <Outlet />
<AdminRoute />                      // layout route element: redirects non-Admins to "/"
// test/session.tsx
ADMIN, STAFF: User; mockSession(user | null, handler?); renderWithSession(ui, route?); <LocationProbe />
```

- [ ] **Step 1: Test helpers**

`apps/web/src/test/session.tsx`:

```tsx
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { User } from '../api/auth';
import { AuthProvider } from '../auth/AuthContext';
import { mockFetch, type MockResponse } from './fetch-mock';

export const ADMIN: User = { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin' };
export const STAFF: User = { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff' };

type Handler = (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>;

// Stubs fetch so the app restores a session as `user` (or as signed out when null); every other request goes
// to `handler`.
export function mockSession(user: User | null, handler: Handler = () => ({ status: 404, body: {} })) {
  return mockFetch((url, init) => {
    if (url === '/api/auth/refresh') return user ? { body: { accessToken: 'test-token' } } : { status: 401, body: {} };
    if (url === '/api/auth/me') return { body: user };
    return handler(url, init);
  });
}

export function renderWithSession(ui: ReactElement, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/components/AppShell.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/auth';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { AppShell } from './AppShell';

function renderShell(user: User) {
  mockSession(user, (url) => (url === '/api/auth/logout' ? { status: 204 } : { status: 404, body: {} }));
  return renderWithSession(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<h1>Dashboard content</h1>} />
        </Route>
      </Route>
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
  );
}

describe('AppShell', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows who is signed in with their role, and the page content', async () => {
    renderShell(ADMIN);
    expect(await screen.findByText('Anita Rao · Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard content' })).toBeInTheDocument();
  });

  it('labels a Staff member as Staff', async () => {
    renderShell(STAFF);
    expect(await screen.findByText('Ben Okoye · Staff')).toBeInTheDocument();
  });

  it('marks the current page in the sidebar navigation', async () => {
    renderShell(ADMIN);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('signs out and returns to the sign-in page', async () => {
    renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('opens the navigation as a drawer from the Menu button and closes it after choosing a page', async () => {
    renderShell(ADMIN);
    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Dashboard' }));
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });
});
```

`apps/web/src/components/AdminRoute.spec.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { AdminRoute } from './AdminRoute';

const routes = (
  <Routes>
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<p>Dashboard home</p>} />
      <Route element={<AdminRoute />}>
        <Route path="/staff" element={<p>Staff admin page</p>} />
      </Route>
    </Route>
  </Routes>
);

describe('AdminRoute', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lets an Admin through', async () => {
    mockSession(ADMIN);
    renderWithSession(routes, '/staff');
    expect(await screen.findByText('Staff admin page')).toBeInTheDocument();
  });

  it('sends Staff to the dashboard instead', async () => {
    mockSession(STAFF);
    renderWithSession(routes, '/staff');
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    expect(screen.queryByText('Staff admin page')).not.toBeInTheDocument();
  });
});
```

Run: `npm test -w @jbf/web -- AppShell AdminRoute` → FAIL (modules missing).

- [ ] **Step 3: Implement navigation, shell, admin route, dashboard; delete the old home page**

`apps/web/src/components/nav-items.ts`:

```ts
export interface NavItem {
  to: string;
  label: string;
  group: 'main' | 'admin' | 'account';
  adminOnly?: boolean;
  end?: boolean;
}

// Pages appear here only once they exist. Later tasks append their entries.
export const NAV_ITEMS: NavItem[] = [{ to: '/', label: 'Dashboard', group: 'main', end: true }];

export const NAV_GROUPS: { id: NavItem['group']; label: string | null }[] = [
  { id: 'main', label: null },
  { id: 'admin', label: 'Admin' },
  { id: 'account', label: 'Account' },
];
```

`apps/web/src/components/NavLinks.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import type { User } from '../api/auth';
import styles from './NavLinks.module.css';
import { NAV_GROUPS, NAV_ITEMS } from './nav-items';

export function NavLinks({ role, onNavigate }: { role: User['role']; onNavigate?: () => void }) {
  const visible = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
  return (
    <nav aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const items = visible.filter((item) => item.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className={styles.group}>
            {group.label ? <p className={styles.groupLabel}>{group.label}</p> : null}
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
```

`apps/web/src/components/NavLinks.module.css`:

```css
.group {
  margin-bottom: var(--space-4);
}

.groupLabel {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.link {
  display: block;
  padding: var(--space-2) var(--space-6);
  border-left: 3px solid transparent;
  color: var(--color-text-muted);
  text-decoration: none;
}

.link:hover {
  background: var(--color-bg);
}

.active {
  border-left-color: var(--color-primary);
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 600;
}
```

`apps/web/src/components/AppShell.tsx`:

```tsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import styles from './AppShell.module.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { NavLinks } from './NavLinks';

export function AppShell() {
  const { state, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>JBF Learning Management System</p>
        <NavLinks role={user.role} />
      </aside>
      <div className={styles.column}>
        <header className={styles.topBar}>
          <Button variant="secondary" size="small" className={styles.menuButton} onClick={() => setMenuOpen(true)}>
            Menu
          </Button>
          <span className={styles.who}>
            {user.name} · {user.role === 'admin' ? 'Admin' : 'Staff'}
          </span>
          <Button variant="secondary" size="small" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <NavLinks role={user.role} onNavigate={() => setMenuOpen(false)} />
      </Dialog>
    </div>
  );
}
```

`apps/web/src/components/AppShell.module.css`:

```css
.shell {
  display: grid;
  grid-template-columns: 14rem 1fr;
  min-height: 100vh;
}

.sidebar {
  padding: var(--space-6) 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.brand {
  margin: 0 0 var(--space-6);
  padding: 0 var(--space-6);
  color: var(--color-primary);
  font-weight: 600;
  line-height: 1.25;
}

.column {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topBar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.menuButton {
  display: none;
  margin-right: auto;
}

.who {
  color: var(--color-text-muted);
}

.main {
  flex: 1;
  padding: var(--space-8) var(--space-6);
}

@media (max-width: 760px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .menuButton {
    display: inline-flex;
  }

  .topBar {
    padding: var(--space-3) var(--space-4);
  }

  .main {
    padding: var(--space-6) var(--space-4);
  }
}
```

`apps/web/src/components/AdminRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// The server enforces Admin-only access on every request; this keeps Staff out of pages they cannot use.
export function AdminRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated' && state.user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
```

`apps/web/src/pages/DashboardPage.tsx`:

```tsx
import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <>
      <h1>Welcome, {state.user.name}</h1>
      <p>Your library will appear here as soon as content features arrive in the next milestones.</p>
    </>
  );
}
```

Delete `apps/web/src/pages/HomePage.tsx` and `apps/web/src/pages/HomePage.module.css` (`git rm`).

`apps/web/src/App.tsx` (replace):

```tsx
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. Also confirm nothing else imports `HomePage` (`grep -R HomePage apps/web/src` must print nothing).

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the app shell with sidebar, top bar and mobile menu"
```

---

### Task 6: Staff page (People and Invites)

**Files:**
- Modify: `apps/web/src/api/client.ts` (502 message), `apps/web/src/api/client.spec.ts`, `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`, `apps/web/src/test/fetch-mock.ts`
- Create: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.spec.ts`, `apps/web/src/api/staff.ts`, `apps/web/src/pages/staff/{StaffPage.tsx,StaffPage.module.css,PeopleTable.tsx,InvitesTable.tsx,InviteDialog.tsx,ChangeRoleDialog.tsx}`
- Test: `apps/web/src/pages/staff/StaffPage.spec.tsx`; extend `AppShell.spec.tsx`

**Interfaces:**
- Consumes: Task 4 components, Task 5 shell/session helpers, milestone 1 endpoints: `GET /api/users`, `PATCH /api/users/:id/role {role}`, `POST /api/users/:id/deactivate|reactivate`, `GET/POST /api/invites`, `POST /api/invites/:id/resend`, `DELETE /api/invites/:id`.
- Produces:

```ts
// api/staff.ts
type Role = User['role']
interface Person { id; email; name; role: Role; status: 'active'|'deactivated'; createdAt: string }
interface Invite { id; email; name; role: Role; status: 'pending'|'expired'|'accepted'|'cancelled'; expiresAt: string; createdAt: string; invitedBy: string | null }
listPeople, changeRole(id, role), deactivatePerson(id), reactivatePerson(id), listInvites, createInvite({name,email,role}), resendInvite(id), cancelInvite(id)
// lib/format.ts
formatDateTime(iso), formatDate(iso), formatExactUtc(iso), formatValue(value)
// client.ts: describeError now passes through the server message for 502 (our own "saved but email failed" answer)
```

- [ ] **Step 1: Small shared changes with their tests**

`apps/web/src/api/client.ts`: change `describeError`'s last line from

```ts
  return error.status >= 500 ? GENERIC_FAILURE : error.message;
```

to

```ts
  // 502 is the API's own "saved, but the email could not be sent" answer and carries a safe message.
  return error.status >= 500 && error.status !== 502 ? GENERIC_FAILURE : error.message;
```

In `apps/web/src/api/client.spec.ts` add (and import `describeError`, `TOO_MANY_REQUESTS` from `./client` if not already imported):

```ts
describe('describeError', () => {
  it('shows server messages for client errors and for the 502 "email failed" answer', () => {
    expect(describeError(new ApiError(409, 'At least one active Admin is required.'))).toBe('At least one active Admin is required.');
    expect(describeError(new ApiError(502, 'The invite was saved but the email could not be sent. Use Resend to try again.'))).toBe(
      'The invite was saved but the email could not be sent. Use Resend to try again.',
    );
  });

  it('hides internals of other server errors and network failures, and words rate limiting fixedly', () => {
    expect(describeError(new ApiError(500, 'stack trace here'))).toBe('Something went wrong. Please try again.');
    expect(describeError(new ApiError(429, 'x'))).toBe(TOO_MANY_REQUESTS);
    expect(describeError(new TypeError('Failed to fetch'))).toBe('Something went wrong. Please try again.');
  });
});
```

`apps/web/src/test/fetch-mock.ts` (replace; adds text bodies and headers for CSV tests):

```ts
import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export function mockFetch(handler: (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const { status = 200, body, text, headers } = await handler(String(input), init);
    const payload = status === 204 ? null : text !== undefined ? text : JSON.stringify(body ?? {});
    return new Response(payload, {
      status,
      headers: { 'Content-Type': text !== undefined ? 'text/csv' : 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
```

`apps/web/src/lib/format.ts`:

```ts
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso));
export const formatExactUtc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
export const formatValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
```

`apps/web/src/lib/format.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatExactUtc, formatValue } from './format';

describe('format', () => {
  it('prints an exact UTC time', () => {
    expect(formatExactUtc('2026-10-08T10:42:07.123Z')).toBe('2026-10-08 10:42:07 UTC');
  });

  it('prints local dates and times as readable text containing the year', () => {
    expect(formatDate('2026-10-08T10:42:07Z')).toMatch(/2026/);
    expect(formatDateTime('2026-10-08T10:42:07Z')).toMatch(/2026/);
  });

  it('shows strings as they are and everything else as JSON', () => {
    expect(formatValue('staff')).toBe('staff');
    expect(formatValue(3)).toBe('3');
    expect(formatValue(null)).toBe('null');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
```

Run `npm test -w @jbf/web -- client format` → the `describeError` 502 case and format tests FAIL until the changes above exist; then PASS.

- [ ] **Step 2: API client for staff**

`apps/web/src/api/staff.ts`:

```ts
import { api } from './client';
import type { User } from './auth';

export type Role = User['role'];

export interface Person {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'deactivated';
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'cancelled';
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

export const listPeople = (): Promise<Person[]> => api<Person[]>('/api/users');

export const changeRole = (id: string, role: Role): Promise<Person> =>
  api<Person>(`/api/users/${id}/role`, { method: 'PATCH', body: { role } });

export const deactivatePerson = (id: string): Promise<Person> => api<Person>(`/api/users/${id}/deactivate`, { method: 'POST' });

export const reactivatePerson = (id: string): Promise<Person> => api<Person>(`/api/users/${id}/reactivate`, { method: 'POST' });

export const listInvites = (): Promise<Invite[]> => api<Invite[]>('/api/invites');

export const createInvite = (input: { name: string; email: string; role: Role }): Promise<Invite> =>
  api<Invite>('/api/invites', { method: 'POST', body: input });

export const resendInvite = (id: string): Promise<Invite> => api<Invite>(`/api/invites/${id}/resend`, { method: 'POST' });

export const cancelInvite = (id: string): Promise<void> => api<void>(`/api/invites/${id}`, { method: 'DELETE' });
```

- [ ] **Step 3: Write the failing page tests**

`apps/web/src/pages/staff/StaffPage.spec.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, Person, Role } from '../../api/staff';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, LocationProbe, mockSession, renderWithSession } from '../../test/session';
import { StaffPage } from './StaffPage';

const day = 86_400_000;
const peopleFixture: Person[] = [
  { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff', status: 'active', createdAt: '2026-01-02T00:00:00Z' },
  { id: 'staff-2', email: 'eli@jbf.org', name: 'Eli Brooks', role: 'staff', status: 'deactivated', createdAt: '2026-01-03T00:00:00Z' },
];
const invitesFixture: Invite[] = [
  { id: 'inv-1', email: 'carla@jbf.org', name: 'Carla Mendes', role: 'staff', status: 'pending', expiresAt: new Date(Date.now() + 5 * day).toISOString(), createdAt: '2026-01-04T00:00:00Z', invitedBy: 'admin-1' },
  { id: 'inv-2', email: 'dev@jbf.org', name: 'Dev Patel', role: 'staff', status: 'expired', expiresAt: new Date(Date.now() - day).toISOString(), createdAt: '2026-01-05T00:00:00Z', invitedBy: 'admin-1' },
  { id: 'inv-3', email: 'old@jbf.org', name: 'Old Timer', role: 'staff', status: 'accepted', expiresAt: '2026-01-06T00:00:00Z', createdAt: '2026-01-06T00:00:00Z', invitedBy: 'admin-1' },
];

interface RequestBody {
  role?: Role;
  name?: string;
  email?: string;
}

type Override = MockResponse | ((body: RequestBody) => MockResponse | Promise<MockResponse>);

function startServer(overrides: Record<string, Override> = {}, people: Person[] = peopleFixture) {
  const state = { people: structuredClone(people), invites: structuredClone(invitesFixture) };
  const calls: { method: string; url: string; body: RequestBody }[] = [];
  mockSession(ADMIN, (url, init) => {
    const method = init.method ?? 'GET';
    const body: RequestBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const key = `${method} ${url}`;
    calls.push({ method, url, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/users') return { body: state.people };
    if (key === 'GET /api/invites') return { body: state.invites };
    const person = (id: string | undefined) => state.people.find((p) => p.id === id)!;
    let match = /^PATCH \/api\/users\/([^/]+)\/role$/.exec(key);
    if (match) {
      person(match[1]).role = body.role ?? 'staff';
      return { body: person(match[1]) };
    }
    match = /^POST \/api\/users\/([^/]+)\/deactivate$/.exec(key);
    if (match) {
      person(match[1]).status = 'deactivated';
      return { body: person(match[1]) };
    }
    match = /^POST \/api\/users\/([^/]+)\/reactivate$/.exec(key);
    if (match) {
      person(match[1]).status = 'active';
      return { body: person(match[1]) };
    }
    if (key === 'POST /api/invites') {
      const invite: Invite = { id: 'inv-new', email: body.email ?? '', name: body.name ?? '', role: body.role ?? 'staff', status: 'pending', expiresAt: new Date(Date.now() + 7 * day).toISOString(), createdAt: new Date().toISOString(), invitedBy: 'admin-1' };
      state.invites.push(invite);
      return { status: 201, body: invite };
    }
    match = /^POST \/api\/invites\/([^/]+)\/resend$/.exec(key);
    if (match) return { body: state.invites.find((i) => i.id === match![1]) };
    match = /^DELETE \/api\/invites\/([^/]+)$/.exec(key);
    if (match) {
      state.invites = state.invites.filter((i) => i.id !== match![1]);
      return { status: 204 };
    }
    return { status: 404, body: {} };
  });
  return { state, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key).length };
}

function renderStaff() {
  return renderWithSession(
    <Routes>
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/audit" element={<LocationProbe />} />
    </Routes>,
    '/staff',
  );
}

const openInvitesTab = () => userEvent.click(screen.getByRole('tab', { name: /^Invites/ }));

describe('StaffPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  describe('People tab', () => {
    it('lists people with role and status and counts both tabs (accepted invites are not shown)', async () => {
      startServer();
      renderStaff();
      const table = await screen.findByRole('table', { name: 'People' });
      const ben = within(table).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('ben@jbf.org')).toBeInTheDocument();
      expect(within(ben).getByText('Staff')).toBeInTheDocument();
      expect(within(ben).getByText('Active')).toBeInTheDocument();
      expect(within(table).getByText('Deactivated')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Invites (2)' })).toBeInTheDocument();
    });

    it('disables role change and deactivate on the signed-in Admin\'s own row and explains why', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      expect(screen.getByRole('button', { name: 'Change role for Anita Rao' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deactivate Anita Rao' })).toBeDisabled();
      expect(screen.getByText('Ask another Admin to change your access.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change role for Ben Okoye' })).toBeEnabled();
    });

    it('filters by name or email', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await userEvent.type(screen.getByLabelText('Filter by name or email'), 'ELI');
      expect(screen.getByText('Eli Brooks')).toBeInTheDocument();
      expect(screen.queryByText('Ben Okoye')).not.toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText('Filter by name or email'));
      await userEvent.type(screen.getByLabelText('Filter by name or email'), 'nobody');
      expect(screen.getByText('No one matches that filter')).toBeInTheDocument();
    });

    it('links each person to their activity in the audit log', async () => {
      startServer();
      renderStaff();
      const link = await screen.findByRole('link', { name: 'View activity for Ben Okoye' });
      expect(link).toHaveAttribute('href', '/audit?involving=staff-1');
      await userEvent.click(link);
      expect(await screen.findByTestId('location')).toHaveTextContent('/audit?involving=staff-1');
    });

    it('shows names and emails as inert text, never as markup', async () => {
      const hostile = [{ ...peopleFixture[1]!, name: '<img src=x onerror=alert(1)>', email: 'x@jbf.org' }];
      startServer({}, hostile);
      const { container } = renderStaff();
      expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('changing a role', () => {
    it('saves the new role and refreshes the list', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Change role for Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Change role' });
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change role' })).not.toBeInTheDocument());
      expect(server.calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/users/staff-1/role', body: { role: 'admin' } });
      const ben = within(screen.getByRole('table', { name: 'People' })).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('Admin')).toBeInTheDocument();
    });

    it('shows the server\'s reason inside the dialog and keeps it open', async () => {
      startServer({ 'PATCH /api/users/staff-1/role': { status: 409, body: { message: 'At least one active Admin is required.' } } });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Change role for Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Change role' });
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('At least one active Admin is required.');
      expect(screen.getByRole('dialog', { name: 'Change role' })).toBeInTheDocument();
    });
  });

  describe('deactivating and reactivating', () => {
    it('asks for confirmation, explains the effect, and deactivates', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      expect(within(dialog).getByText(/signed out immediately/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(0);

      await userEvent.click(screen.getByRole('button', { name: 'Deactivate Ben Okoye' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' })).getByRole('button', { name: 'Deactivate' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument());
      const ben = within(screen.getByRole('table', { name: 'People' })).getByRole('row', { name: /Ben Okoye/ });
      expect(within(ben).getByText('Deactivated')).toBeInTheDocument();
    });

    it('closing with Esc does not submit anything', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      fireEvent(screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' }), new Event('close'));
      expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument();
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(0);
    });

    it('shows the last-Admin message in plain words and keeps the dialog open', async () => {
      startServer({ 'POST /api/users/staff-1/deactivate': { status: 409, body: { message: 'At least one active Admin is required.' } } });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('At least one active Admin is required.');
    });

    it('disables the confirm button while the request is in flight so it cannot be sent twice', async () => {
      let release: (value: MockResponse) => void = () => undefined;
      const gate = new Promise<MockResponse>((resolve) => {
        release = resolve;
      });
      const server = startServer({ 'POST /api/users/staff-1/deactivate': () => gate });
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ben Okoye' }));
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Ben Okoye?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeDisabled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
      release({ body: { ...peopleFixture[1], status: 'deactivated' } });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Ben Okoye?' })).not.toBeInTheDocument());
      expect(server.count('POST /api/users/staff-1/deactivate')).toBe(1);
    });

    it('reactivates straight from the row', async () => {
      const server = startServer();
      renderStaff();
      await userEvent.click(await screen.findByRole('button', { name: 'Reactivate Eli Brooks' }));
      await waitFor(() => expect(server.count('POST /api/users/staff-2/reactivate')).toBe(1));
      const eli = within(await screen.findByRole('table', { name: 'People' })).getByRole('row', { name: /Eli Brooks/ });
      await waitFor(() => expect(within(eli).getByText('Active')).toBeInTheDocument());
    });
  });

  describe('Invites tab', () => {
    it('lists pending and expired invites with Resend and Cancel, and supports arrow-key tab switching', async () => {
      startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      screen.getByRole('tab', { name: 'People (3)' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      const table = await screen.findByRole('table', { name: 'Invites' });
      expect(within(table).getByText('Carla Mendes')).toBeInTheDocument();
      expect(within(table).getByText(/^Pending/)).toBeInTheDocument();
      expect(within(table).getByText('Dev Patel')).toBeInTheDocument();
      expect(within(table).getByText('Expired')).toBeInTheDocument();
      expect(within(table).queryByText('Old Timer')).not.toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Resend invite to Carla Mendes' })).toBeInTheDocument();
    });

    it('resends an invite and says so', async () => {
      const server = startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await openInvitesTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Resend invite to Dev Patel' }));
      await waitFor(() => expect(server.count('POST /api/invites/inv-2/resend')).toBe(1));
      expect(await screen.findByRole('status')).toHaveTextContent('Invite resent to dev@jbf.org.');
    });

    it('cancels an invite only after confirmation', async () => {
      const server = startServer();
      renderStaff();
      await screen.findByRole('table', { name: 'People' });
      await openInvitesTab();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel invite for Carla Mendes' }));
      const dialog = screen.getByRole('dialog', { name: 'Cancel invite for Carla Mendes?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Keep invite' }));
      expect(server.count('DELETE /api/invites/inv-1')).toBe(0);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel invite for Carla Mendes' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Cancel invite for Carla Mendes?' })).getByRole('button', { name: 'Cancel invite' }));
      await waitFor(() => expect(screen.queryByText('Carla Mendes')).not.toBeInTheDocument());
      expect(server.count('DELETE /api/invites/inv-1')).toBe(1);
    });
  });

  describe('Invite person', () => {
    const openDialog = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite person' }));
      return screen.getByRole('dialog', { name: 'Invite person' });
    };

    it('asks for name and email before calling the server and focuses the first problem', async () => {
      const server = startServer();
      renderStaff();
      const dialog = await openDialog();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
      expect(within(dialog).getByLabelText('Email')).toHaveAccessibleDescription(/Enter an email address\./);
      expect(within(dialog).getByLabelText('Name')).toHaveFocus();
      expect(server.count('POST /api/invites')).toBe(0);
    });

    it('sends the invite with the chosen role, closes, shows the Invites tab and confirms', async () => {
      const server = startServer();
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'fiona@jbf.org');
      await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'admin');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invite person' })).not.toBeInTheDocument());
      expect(server.calls.find((c) => c.method === 'POST' && c.url === '/api/invites')?.body).toEqual({ name: 'Fiona Quinn', email: 'fiona@jbf.org', role: 'admin' });
      expect(await screen.findByRole('table', { name: 'Invites' })).toBeInTheDocument();
      expect(screen.getByText('Fiona Quinn')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Invite sent to fiona@jbf.org.');
    });

    it('defaults the role to Staff', async () => {
      startServer();
      renderStaff();
      const dialog = await openDialog();
      expect(within(dialog).getByLabelText('Role')).toHaveValue('staff');
    });

    it('shows server field errors under the fields and keeps what was typed', async () => {
      startServer({ 'POST /api/invites': { status: 400, body: { message: 'Validation failed', fieldErrors: { email: ['Enter a valid email address.'] } } } });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'not-an-email');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Fiona Quinn');
      expect(within(dialog).getByLabelText('Email')).toHaveValue('not-an-email');
    });

    it('shows a conflict in the dialog', async () => {
      startServer({ 'POST /api/invites': { status: 409, body: { message: 'A user with this email already exists.' } } });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Ben Okoye');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'ben@jbf.org');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('A user with this email already exists.');
    });

    it('when the invite is saved but the email fails, closes, warns about Resend and shows the invite', async () => {
      const server = startServer({
        'POST /api/invites': { status: 502, body: { message: 'The invite was saved but the email could not be sent. Use Resend to try again.' } },
      });
      renderStaff();
      const dialog = await openDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fiona Quinn');
      await userEvent.type(within(dialog).getByLabelText('Email'), 'fiona@jbf.org');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The invite was saved but the email could not be sent. Use Resend to try again.');
      expect(screen.queryByRole('dialog', { name: 'Invite person' })).not.toBeInTheDocument();
      expect(server.count('GET /api/invites')).toBeGreaterThan(1);
      expect(screen.getByRole('tab', { name: /^Invites/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('loading and errors', () => {
    it('shows a skeleton while loading', () => {
      mockSession(ADMIN, () => new Promise<MockResponse>(() => undefined));
      renderStaff();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    });

    it('shows an error with Retry when the lists cannot be loaded', async () => {
      let failures = 1;
      startServer({
        'GET /api/users': () => (failures-- > 0 ? { status: 500, body: {} } : { body: peopleFixture }),
      });
      renderStaff();
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('table', { name: 'People' })).toBeInTheDocument();
    });
  });
});
```

Run: `npm test -w @jbf/web -- StaffPage` → FAIL (modules missing).

- [ ] **Step 4: Implement the dialogs**

`apps/web/src/pages/staff/InviteDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { createInvite, type Role } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import styles from './StaffPage.module.css';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  // `warning` is set when the invite was saved but its email could not be sent.
  onInvited: (email: string, warning?: string) => void;
}

export function InviteDialog({ open, onClose, onInvited }: InviteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Invite person">
      <InviteForm onClose={onClose} onInvited={onInvited} />
    </Dialog>
  );
}

function InviteForm({ onClose, onInvited }: Pick<InviteDialogProps, 'onClose' | 'onInvited'>) {
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<'name' | 'email' | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus moves only after the error text has rendered so it is announced together with the field.
  useEffect(() => {
    if (focusRequest) (focusRequest === 'name' ? nameRef : emailRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: name.trim() ? undefined : 'Enter a name.',
      email: email.trim() ? undefined : 'Enter an email address.',
    };
    setErrors(next);
    setFailure(null);
    if (next.name || next.email) {
      setFocusRequest(next.name ? 'name' : 'email');
      return;
    }
    setBusy(true);
    try {
      await createInvite({ name, email, role });
      onInvited(email.trim().toLowerCase());
    } catch (error) {
      if (error instanceof ApiError && error.status === 502) {
        onInvited(email.trim().toLowerCase(), error.message);
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors({ name: error.fieldErrors.name?.join(' '), email: error.fieldErrors.email?.join(' ') });
        setFailure(error.fieldErrors.role?.join(' ') ?? null);
        setFocusRequest(error.fieldErrors.name ? 'name' : 'email');
      } else {
        setFailure(describeError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={nameRef} label="Name" autoComplete="off" data-autofocus value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <TextField
        ref={emailRef}
        label="Email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="The invite link is sent to this address and works once, for 7 days."
        error={errors.email}
      />
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </Select>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Send invite
        </Button>
      </div>
    </form>
  );
}
```

`apps/web/src/pages/staff/ChangeRoleDialog.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import type { Person, Role } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Select } from '../../components/Select';
import styles from './StaffPage.module.css';

interface ChangeRoleDialogProps {
  person: Person | null;
  busy: boolean;
  error: string | null;
  onSave: (role: Role) => void;
  onClose: () => void;
}

export function ChangeRoleDialog({ person, busy, error, onSave, onClose }: ChangeRoleDialogProps) {
  return (
    <Dialog open={person !== null} onClose={onClose} title="Change role">
      {person ? <RoleForm person={person} busy={busy} error={error} onSave={onSave} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RoleForm({ person, busy, error, onSave, onClose }: Omit<ChangeRoleDialogProps, 'person'> & { person: Person }) {
  const [role, setRole] = useState<Role>(person.role);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(role);
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p>
        Choose what <strong>{person.name}</strong> can do. Admins can manage people and read the audit log.
      </p>
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </Select>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={role === person.role}>
          Save
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Implement the tables**

`apps/web/src/pages/staff/PeopleTable.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { Person } from '../../api/staff';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import styles from './StaffPage.module.css';

interface PeopleTableProps {
  people: Person[];
  selfId: string;
  busy: boolean;
  onChangeRole: (person: Person) => void;
  onDeactivate: (person: Person) => void;
  onReactivate: (person: Person) => void;
}

export function PeopleTable({ people, selfId, busy, onChangeRole, onDeactivate, onReactivate }: PeopleTableProps) {
  return (
    <Table caption="People">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Role</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {people.map((person) => {
          const isSelf = person.id === selfId;
          const hintId = `self-hint-${person.id}`;
          return (
            <tr key={person.id}>
              <td data-label="Name">
                <span className={styles.name}>{person.name}</span>
                <span className={styles.muted}>{person.email}</span>
              </td>
              <td data-label="Role">{person.role === 'admin' ? 'Admin' : 'Staff'}</td>
              <td data-label="Status">
                <Badge tone={person.status === 'active' ? 'success' : 'neutral'}>
                  {person.status === 'active' ? 'Active' : 'Deactivated'}
                </Badge>
              </td>
              <td data-label="Actions">
                <div className={styles.actions}>
                  <Button variant="secondary" size="small" disabled={busy || isSelf} aria-describedby={isSelf ? hintId : undefined} aria-label={`Change role for ${person.name}`} onClick={() => onChangeRole(person)}>
                    Change role
                  </Button>
                  {person.status === 'active' ? (
                    <Button variant="secondary" size="small" disabled={busy || isSelf} aria-describedby={isSelf ? hintId : undefined} aria-label={`Deactivate ${person.name}`} onClick={() => onDeactivate(person)}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Reactivate ${person.name}`} onClick={() => onReactivate(person)}>
                      Reactivate
                    </Button>
                  )}
                  <Link className={styles.link} to={`/audit?involving=${person.id}`} aria-label={`View activity for ${person.name}`}>
                    View activity
                  </Link>
                </div>
                {isSelf ? (
                  <span id={hintId} className={styles.muted}>
                    Ask another Admin to change your access.
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
```

`apps/web/src/pages/staff/InvitesTable.tsx`:

```tsx
import type { Invite } from '../../api/staff';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatDate } from '../../lib/format';
import styles from './StaffPage.module.css';

interface InvitesTableProps {
  invites: Invite[];
  busy: boolean;
  onResend: (invite: Invite) => void;
  onCancel: (invite: Invite) => void;
}

export function InvitesTable({ invites, busy, onResend, onCancel }: InvitesTableProps) {
  return (
    <Table caption="Invites">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Role</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {invites.map((invite) => (
          <tr key={invite.id}>
            <td data-label="Name">
              <span className={styles.name}>{invite.name}</span>
              <span className={styles.muted}>{invite.email}</span>
            </td>
            <td data-label="Role">{invite.role === 'admin' ? 'Admin' : 'Staff'}</td>
            <td data-label="Status">
              {invite.status === 'pending' ? (
                <Badge tone="change">{`Pending · expires ${formatDate(invite.expiresAt)}`}</Badge>
              ) : (
                <Badge tone="warning">Expired</Badge>
              )}
            </td>
            <td data-label="Actions">
              <div className={styles.actions}>
                <Button variant="secondary" size="small" disabled={busy} aria-label={`Resend invite to ${invite.name}`} onClick={() => onResend(invite)}>
                  Resend
                </Button>
                <Button variant="secondary" size="small" disabled={busy} aria-label={`Cancel invite for ${invite.name}`} onClick={() => onCancel(invite)}>
                  Cancel
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
```

- [ ] **Step 6: Implement the page**

`apps/web/src/pages/staff/StaffPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../../api/client';
import {
  cancelInvite,
  changeRole,
  deactivatePerson,
  type Invite,
  listInvites,
  listPeople,
  type Person,
  reactivatePerson,
  resendInvite,
  type Role,
} from '../../api/staff';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { TextField } from '../../components/TextField';
import { ChangeRoleDialog } from './ChangeRoleDialog';
import { InviteDialog } from './InviteDialog';
import { InvitesTable } from './InvitesTable';
import { PeopleTable } from './PeopleTable';
import styles from './StaffPage.module.css';

type OpenDialog =
  | { kind: 'invite' }
  | { kind: 'role'; person: Person }
  | { kind: 'deactivate'; person: Person }
  | { kind: 'cancel'; invite: Invite }
  | null;

type Notice = { tone: 'error' | 'success'; text: string };

const matches = (filter: string, ...fields: string[]): boolean => {
  const needle = filter.trim().toLowerCase();
  return needle === '' || fields.some((field) => field.toLowerCase().includes(needle));
};

export function StaffPage() {
  const { state } = useAuth();
  const selfId = state.status === 'authenticated' ? state.user.id : '';
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'invites'>('people');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedPeople, loadedInvites] = await Promise.all([listPeople(), listInvites()]);
      setPeople(loadedPeople);
      setInvites(loadedInvites.filter((invite) => invite.status === 'pending' || invite.status === 'expired'));
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  // Runs one action, reloads both lists, then closes the dialog; a failure is shown inside the dialog when one
  // is open, or on the page otherwise.
  async function perform(action: () => Promise<unknown>, success: string | null) {
    const inDialog = dialog !== null;
    setBusy(true);
    setNotice(null);
    setDialogError(null);
    try {
      await action();
      await load();
      if (inDialog) closeDialog();
      if (success) setNotice({ tone: 'success', text: success });
    } catch (error) {
      const message = describeError(error);
      if (inDialog) setDialogError(message);
      else setNotice({ tone: 'error', text: message });
    } finally {
      setBusy(false);
    }
  }

  async function onInvited(email: string, warning?: string) {
    closeDialog();
    setTab('invites');
    await load();
    setNotice(warning ? { tone: 'error', text: warning } : { tone: 'success', text: `Invite sent to ${email}.` });
  }

  const visiblePeople = useMemo(() => (people ?? []).filter((p) => matches(filter, p.name, p.email)), [people, filter]);
  const visibleInvites = useMemo(() => (invites ?? []).filter((i) => matches(filter, i.name, i.email)), [invites, filter]);

  const deactivateTarget = dialog?.kind === 'deactivate' ? dialog.person : null;
  const cancelTarget = dialog?.kind === 'cancel' ? dialog.invite : null;

  return (
    <>
      <div className={styles.header}>
        <h1>Staff</h1>
        <Button onClick={() => setDialog({ kind: 'invite' })}>Invite person</Button>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loadError ? (
        <>
          <Alert tone="error">{loadError}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            Retry
          </Button>
        </>
      ) : people === null || invites === null ? (
        <Skeleton />
      ) : (
        <>
          <TextField label="Filter by name or email" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Tabs
            label="Staff sections"
            tabs={[
              { id: 'people', label: 'People', count: people.length },
              { id: 'invites', label: 'Invites', count: invites.length },
            ]}
            value={tab}
            onChange={(id) => setTab(id === 'invites' ? 'invites' : 'people')}
          >
            {tab === 'people' ? (
              visiblePeople.length === 0 ? (
                <EmptyState title="No one matches that filter">Clear the filter to see everyone.</EmptyState>
              ) : (
                <PeopleTable
                  people={visiblePeople}
                  selfId={selfId}
                  busy={busy}
                  onChangeRole={(person) => setDialog({ kind: 'role', person })}
                  onDeactivate={(person) => setDialog({ kind: 'deactivate', person })}
                  onReactivate={(person) => void perform(() => reactivatePerson(person.id), `${person.name} was reactivated.`)}
                />
              )
            ) : visibleInvites.length === 0 ? (
              <EmptyState title={invites.length === 0 ? 'No open invites' : 'No invites match that filter'}>
                {invites.length === 0 ? 'Use "Invite person" to add someone.' : 'Clear the filter to see every invite.'}
              </EmptyState>
            ) : (
              <InvitesTable
                invites={visibleInvites}
                busy={busy}
                onResend={(invite) => void perform(() => resendInvite(invite.id), `Invite resent to ${invite.email}.`)}
                onCancel={(invite) => setDialog({ kind: 'cancel', invite })}
              />
            )}
          </Tabs>
        </>
      )}

      <InviteDialog open={dialog?.kind === 'invite'} onClose={closeDialog} onInvited={(email, warning) => void onInvited(email, warning)} />

      <ChangeRoleDialog
        person={dialog?.kind === 'role' ? dialog.person : null}
        busy={busy}
        error={dialog?.kind === 'role' ? dialogError : null}
        onClose={closeDialog}
        onSave={(role: Role) => {
          if (dialog?.kind === 'role') {
            const person = dialog.person;
            void perform(() => changeRole(person.id, role), `${person.name} is now ${role === 'admin' ? 'an Admin' : 'Staff'}.`);
          }
        }}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={deactivateTarget ? `Deactivate ${deactivateTarget.name}?` : 'Deactivate'}
        confirmLabel="Deactivate"
        tone="danger"
        busy={busy}
        error={deactivateTarget ? dialogError : null}
        onCancel={closeDialog}
        onConfirm={() => {
          if (deactivateTarget) void perform(() => deactivatePerson(deactivateTarget.id), `${deactivateTarget.name} was deactivated.`);
        }}
      >
        {deactivateTarget ? `${deactivateTarget.name} will be signed out immediately and cannot sign in until you reactivate them.` : ''}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelTarget !== null}
        title={cancelTarget ? `Cancel invite for ${cancelTarget.name}?` : 'Cancel invite'}
        confirmLabel="Cancel invite"
        cancelLabel="Keep invite"
        tone="danger"
        busy={busy}
        error={cancelTarget ? dialogError : null}
        onCancel={closeDialog}
        onConfirm={() => {
          if (cancelTarget) void perform(() => cancelInvite(cancelTarget.id), `Invite for ${cancelTarget.email} was cancelled.`);
        }}
      >
        {cancelTarget ? `The link sent to ${cancelTarget.email} will stop working.` : ''}
      </ConfirmDialog>
    </>
  );
}
```

`apps/web/src/pages/staff/StaffPage.module.css`:

```css
.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.header h1 {
  margin: 0;
}

.name {
  display: block;
  font-weight: 500;
}

.muted {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.link {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
}

.dialogActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
```

- [ ] **Step 7: Route and navigation; extend the shell tests**

`apps/web/src/components/nav-items.ts`: change the list to

```ts
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', group: 'main', end: true },
  { to: '/staff', label: 'Staff', group: 'admin', adminOnly: true },
];
```

`apps/web/src/App.tsx`: add imports `import { AdminRoute } from './components/AdminRoute';` and `import { StaffPage } from './pages/staff/StaffPage';` and inside the `AppShell` route, after the Dashboard route:

```tsx
          <Route element={<AdminRoute />}>
            <Route path="/staff" element={<StaffPage />} />
          </Route>
```

Add to `apps/web/src/components/AppShell.spec.tsx`:

```tsx
  it('shows the Admin section only to Admins', async () => {
    renderShell(ADMIN);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/staff');
    expect(within(nav).getByText('Admin')).toBeInTheDocument();
  });

  it('hides the Admin section from Staff', async () => {
    renderShell(STAFF);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    expect(within(nav).queryByText('Admin')).not.toBeInTheDocument();
  });
```

(`vi.unstubAllGlobals()` is already in that file's `beforeEach`.)

- [ ] **Step 8: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. If the 502 test fails on `findByRole('alert')` finding two alerts, make sure the dialog is closed (the dialog's own alert unmounts with it) before asserting; if `getByRole('status')` finds both the Alert and another element with `role="status"`, scope the query to the notice.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the Staff page with people, invites and role management"
```

---

### Task 7: Audit log page (filters, table, detail drawer, export)

**Files:**
- Modify: `apps/web/src/api/client.ts` (+ `apiDownload`), `apps/web/src/api/client.spec.ts`, `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`
- Create: `apps/web/src/lib/download.ts`, `apps/web/src/api/audit.ts`, `apps/web/src/api/audit.spec.ts`, `apps/web/src/pages/audit/{AuditPage.tsx,AuditPage.module.css,AuditFilters.tsx,AuditTable.tsx,AuditDetails.tsx}`
- Test: `apps/web/src/pages/audit/AuditPage.spec.tsx`; extend `AppShell.spec.tsx`

**Interfaces:**
- Consumes: Task 4 components, Task 5/6 helpers (`mockSession`, `renderWithSession`, `LocationProbe`, `ADMIN`, `STAFF`, `formatDateTime`, `formatExactUtc`, `formatValue`, `listPeople`, `Person`), API endpoints `GET /api/audit`, `POST /api/audit/opened`, `GET /api/audit/export.csv`.
- Produces:

```ts
// client.ts
apiDownload(path): Promise<{ blob: Blob; filename: string }>     // same 401-refresh behaviour as api(); non-2xx throws ApiError
// lib/download.ts
saveBlob(blob: Blob, filename: string): void
// api/audit.ts
type AuditTone, AuditCategory; interface AuditEntry (the server's AuditEntryView with occurredAt as string)
interface AuditFilters { involving?; actorId?; category?; action?; from?; to?; q?: string; includePlayback?: boolean }   // from/to are plain dates "YYYY-MM-DD"
filtersFromParams(params: URLSearchParams): AuditFilters; filtersToParams(filters): URLSearchParams
auditQueryString(filters, extra?: { limit?: number; cursor?: string }): string
listAudit(filters, cursor?): Promise<{ items: AuditEntry[]; nextCursor: string | null }>; markAuditOpened(): Promise<void>; exportAudit(filters): Promise<{ blob; filename }>
```

- [ ] **Step 1: Failing tests for the API layer**

`apps/web/src/api/audit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditQueryString, filtersFromParams, filtersToParams } from './audit';

describe('audit filters', () => {
  it('round-trips through URL parameters and drops empty values', () => {
    const params = new URLSearchParams('involving=u1&category=accounts&q=anita&includePlayback=true&from=2026-03-02&to=2026-03-03&junk=1');
    const filters = filtersFromParams(params);
    expect(filters).toEqual({ involving: 'u1', category: 'accounts', q: 'anita', includePlayback: true, from: '2026-03-02', to: '2026-03-03' });
    expect(filtersToParams(filters).toString()).toBe('involving=u1&category=accounts&from=2026-03-02&to=2026-03-03&q=anita&includePlayback=true');
    expect(filtersToParams({}).toString()).toBe('');
    expect(filtersFromParams(new URLSearchParams('q=&actorId=')).q).toBeUndefined();
  });

  it('builds the API query: whole-day local range as ISO instants, paging extras, and omits includePlayback when off', () => {
    const query = new URLSearchParams(auditQueryString({ actorId: 'a1', from: '2026-03-02', to: '2026-03-02', q: 'x y' }, { limit: 50, cursor: 'abc' }).slice(1));
    expect(query.get('actorId')).toBe('a1');
    expect(query.get('q')).toBe('x y');
    expect(query.get('limit')).toBe('50');
    expect(query.get('cursor')).toBe('abc');
    expect(query.get('includePlayback')).toBeNull();
    expect(new Date(query.get('from')!).getTime()).toBe(new Date('2026-03-02T00:00:00').getTime());
    expect(new Date(query.get('to')!).getTime()).toBe(new Date('2026-03-02T23:59:59.999').getTime());
    expect(new URLSearchParams(auditQueryString({ includePlayback: true }).slice(1)).get('includePlayback')).toBe('true');
  });

  it('ignores malformed dates from a hand-edited URL instead of throwing', () => {
    expect(auditQueryString({ from: 'yesterday', to: '2026-13-45' })).toBe('');
  });

  it('returns an empty string when there is nothing to send', () => {
    expect(auditQueryString({})).toBe('');
  });
});
```

In `apps/web/src/api/client.spec.ts` add (importing `apiDownload` from `./client`):

```ts
describe('apiDownload', () => {
  beforeEach(() => {
    setAccessToken(null);
    setSessionLostHandler(() => undefined);
    vi.unstubAllGlobals();
  });

  it('returns the file and the filename from Content-Disposition', async () => {
    setAccessToken('abc');
    mockFetch(() => ({ text: 'a,b\r\n', headers: { 'Content-Disposition': 'attachment; filename="audit-log-2026-10-08.csv"' } }));
    const { blob, filename } = await apiDownload('/api/audit/export.csv');
    expect(filename).toBe('audit-log-2026-10-08.csv');
    expect(await blob.text()).toBe('a,b\r\n');
  });

  it('refreshes once on 401 and retries, like api()', async () => {
    setAccessToken('old');
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(url);
      if (url === '/api/auth/refresh') return { body: { accessToken: 'new' } };
      return (init.headers as Record<string, string>).Authorization === 'Bearer new' ? { text: 'x' } : { status: 401, body: {} };
    });
    await apiDownload('/api/audit/export.csv');
    expect(calls).toEqual(['/api/audit/export.csv', '/api/auth/refresh', '/api/audit/export.csv']);
  });

  it('throws an ApiError carrying the server message when the export is refused', async () => {
    mockFetch(() => ({ status: 413, body: { message: 'Too many rows to export (limit 50000). Narrow the filters.' } }));
    await expect(apiDownload('/api/audit/export.csv')).rejects.toMatchObject({
      status: 413,
      message: 'Too many rows to export (limit 50000). Narrow the filters.',
    });
  });
});
```

Run `npm test -w @jbf/web -- audit.spec client.spec` → FAIL.

- [ ] **Step 2: Implement the download helper, the client change and the audit API layer**

`apps/web/src/api/client.ts`: replace the exported `api` function (the last function in the file) with:

```ts
async function execute(path: string, options: RequestOptions): Promise<Response> {
  const auth = options.auth ?? true;
  let response = await send(path, options);
  if (response.status === 401 && auth && path !== REFRESH_PATH) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      accessToken = null;
      onSessionLost();
    }
  }
  return response;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return parse<T>(await execute(path, options));
}

// Fetches a file with the same sign-in handling as api(). The bearer token lives only in memory, so a plain
// <a href> cannot download protected files.
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await execute(path, {});
  if (!response.ok) await parse(response);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download';
  return { blob: await response.blob(), filename };
}
```

`apps/web/src/lib/download.ts`:

```ts
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```

`apps/web/src/api/audit.ts`:

```ts
import { api, apiDownload } from './client';
import type { Role } from './staff';

export type AuditTone = 'change' | 'danger' | 'warning' | 'success' | 'neutral';
export type AuditCategory = 'accounts' | 'content' | 'files' | 'playback';

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: { id: string | null; role: Role | null; label: string | null; name: string | null } | null;
  action: string;
  label: string;
  tone: AuditTone;
  category: AuditCategory;
  target: { type: string; id: string; label: string | null; name: string | null } | null;
  source: string;
  ip: string | null;
  userAgent: string | null;
  appVersion: string | null;
  requestId: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  metadata: Record<string, unknown> | null;
  summary: string;
}

// `from` and `to` are plain dates ("YYYY-MM-DD") in the person's own time zone.
export interface AuditFilters {
  involving?: string;
  actorId?: string;
  category?: string;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  includePlayback?: boolean;
}

const TEXT_KEYS = ['involving', 'actorId', 'category', 'action', 'from', 'to', 'q'] as const;

export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const filters: AuditFilters = {};
  for (const key of TEXT_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  if (params.get('includePlayback') === 'true') filters.includePlayback = true;
  return filters;
}

export function filtersToParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.includePlayback) params.set('includePlayback', 'true');
  return params;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function instant(date: string | undefined, time: string): string | undefined {
  if (!date || !DATE_ONLY.test(date)) return undefined;
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function auditQueryString(filters: AuditFilters, extra: { limit?: number; cursor?: string } = {}): string {
  const params = filtersToParams(filters);
  params.delete('from');
  params.delete('to');
  const from = instant(filters.from, '00:00:00');
  const to = instant(filters.to, '23:59:59.999');
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (extra.limit) params.set('limit', String(extra.limit));
  if (extra.cursor) params.set('cursor', extra.cursor);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const listAudit = (filters: AuditFilters, cursor?: string): Promise<{ items: AuditEntry[]; nextCursor: string | null }> =>
  api(`/api/audit${auditQueryString(filters, { limit: 50, cursor })}`);

export const markAuditOpened = (): Promise<void> => api<void>('/api/audit/opened', { method: 'POST' });

export const exportAudit = (filters: AuditFilters): Promise<{ blob: Blob; filename: string }> =>
  apiDownload(`/api/audit/export.csv${auditQueryString(filters)}`);
```

Run `npm test -w @jbf/web -- audit.spec client.spec` → PASS.

- [ ] **Step 3: Write the failing page tests**

`apps/web/src/pages/audit/AuditPage.spec.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../../api/audit';
import type { Person } from '../../api/staff';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, LocationProbe, mockSession, renderWithSession } from '../../test/session';
import { AuditPage } from './AuditPage';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('../../lib/download', () => ({ saveBlob }));

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'e1',
  occurredAt: '2026-10-08T10:42:07.000Z',
  actor: { id: 'admin-1', role: 'admin', label: 'anita@jbf.org', name: 'Anita Rao' },
  action: 'user.role_changed',
  label: 'Role changed',
  tone: 'change',
  category: 'accounts',
  target: { type: 'user', id: 'staff-1', label: 'ben@jbf.org', name: 'Ben Okoye' },
  source: 'portal',
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  appVersion: null,
  requestId: 'req-7f3c',
  changes: { role: { before: 'staff', after: 'admin' } },
  metadata: null,
  summary: "Anita Rao changed Ben Okoye's role from Staff to Admin",
  ...overrides,
});

const signIn = entry({
  id: 'e2',
  occurredAt: '2026-10-08T10:31:00.000Z',
  actor: { id: 'staff-1', role: 'staff', label: 'ben@jbf.org', name: 'Ben Okoye' },
  action: 'auth.login.succeeded',
  label: 'Signed in',
  tone: 'success',
  target: null,
  source: 'mobile',
  appVersion: '2.0.1',
  changes: null,
  summary: 'Ben Okoye signed in from the app',
});

const failed = entry({
  id: 'e3',
  occurredAt: '2026-10-08T10:12:00.000Z',
  actor: { id: null, role: null, label: 'dev@jbf.org', name: null },
  action: 'auth.login.failed',
  label: 'Sign-in failed',
  tone: 'warning',
  target: null,
  changes: null,
  metadata: { reason: 'wrong_password', locked: false },
  summary: 'Failed sign-in for dev@jbf.org (wrong password)',
});

const people: Person[] = [
  { id: 'admin-1', email: 'anita@jbf.org', name: 'Anita Rao', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'staff-1', email: 'ben@jbf.org', name: 'Ben Okoye', role: 'staff', status: 'active', createdAt: '2026-01-02T00:00:00Z' },
];

type Page = { items: AuditEntry[]; nextCursor: string | null };

function startServer(
  pages: Record<string, Page> | ((url: URL) => MockResponse | Promise<MockResponse>) = {},
  exportResponse: MockResponse = {
    text: 'Time (UTC)\r\n',
    headers: { 'Content-Disposition': 'attachment; filename="audit-log-2026-10-08.csv"' },
  },
) {
  const calls: { method: string; url: URL }[] = [];
  mockSession(ADMIN, (rawUrl, init) => {
    const url = new URL(rawUrl, 'http://localhost');
    const method = init.method ?? 'GET';
    calls.push({ method, url });
    if (method === 'GET' && url.pathname === '/api/users') return { body: people };
    if (method === 'POST' && url.pathname === '/api/audit/opened') return { status: 204 };
    if (method === 'GET' && url.pathname === '/api/audit') {
      if (typeof pages === 'function') return pages(url);
      return { body: pages[url.searchParams.get('cursor') ?? ''] ?? { items: [], nextCursor: null } };
    }
    if (method === 'GET' && url.pathname === '/api/audit/export.csv') return exportResponse;
    return { status: 404, body: {} };
  });
  const auditCalls = () => calls.filter((c) => c.method === 'GET' && c.url.pathname === '/api/audit');
  return { calls, auditCalls, opened: () => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/api/audit/opened').length };
}

function renderAudit(route = '/audit') {
  return renderWithSession(
    <>
      <Routes>
        <Route path="/audit" element={<AuditPage />} />
      </Routes>
      <LocationProbe />
    </>,
    route,
  );
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    saveBlob.mockReset();
  });

  describe('list', () => {
    it('shows each entry with its time, person, badge, plain-English summary and source', async () => {
      startServer({ '': { items: [entry(), signIn, failed], nextCursor: null } });
      renderAudit();
      const table = await screen.findByRole('table', { name: 'Audit log' });
      const first = within(table).getByRole('row', { name: /Role changed/ });
      expect(within(first).getByText('Anita Rao')).toBeInTheDocument();
      expect(within(first).getByText('Role changed')).toBeInTheDocument();
      expect(within(first).getByText("Anita Rao changed Ben Okoye's role from Staff to Admin")).toBeInTheDocument();
      expect(within(first).getByText('Portal')).toBeInTheDocument();
      expect(within(table).getByText('App')).toBeInTheDocument();
      expect(within(table).getByText('dev@jbf.org')).toBeInTheDocument();
      expect(within(table).getByText('Sign-in failed')).toBeInTheDocument();
    });

    it('asks for "Changes only" by default (no includePlayback) and lets the Admin include plays and downloads', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      const toggle = await screen.findByRole('checkbox', { name: 'Changes only' });
      expect(toggle).toBeChecked();
      expect(server.auditCalls()[0]!.url.searchParams.get('includePlayback')).toBeNull();
      await userEvent.click(toggle);
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('includePlayback')).toBe('true'));
      expect(screen.getByRole('checkbox', { name: 'Changes only' })).not.toBeChecked();
      expect(screen.getByTestId('location')).toHaveTextContent('/audit?includePlayback=true');
    });

    it('records one "opened" marker per visit, not per filter change', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      await userEvent.selectOptions(screen.getByLabelText('Category'), 'accounts');
      await waitFor(() => expect(server.auditCalls().length).toBeGreaterThan(1));
      expect(server.opened()).toBe(1);
    });

    it('loads more with the cursor, appends, and hides the button on the last page', async () => {
      const older = entry({ id: 'e9', summary: 'An older thing happened', label: 'Reactivated', tone: 'success' });
      const server = startServer({
        '': { items: [entry()], nextCursor: 'CURSOR-1' },
        'CURSOR-1': { items: [older], nextCursor: null },
      });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
      expect(await screen.findByText('An older thing happened')).toBeInTheDocument();
      expect(screen.getByText("Anita Rao changed Ben Okoye's role from Staff to Admin")).toBeInTheDocument();
      expect(server.auditCalls().at(-1)!.url.searchParams.get('cursor')).toBe('CURSOR-1');
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('shows an empty state with Clear filters when nothing matches', async () => {
      startServer({});
      renderAudit('/audit?q=zzz');
      expect(await screen.findByText('No activity matches these filters')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/audit$/));
    });

    it('shows a loading skeleton, then an error with Retry', async () => {
      let attempts = 0;
      startServer(() => (attempts++ === 0 ? { status: 500, body: {} } : { body: { items: [entry()], nextCursor: null } }));
      renderAudit();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('table', { name: 'Audit log' })).toBeInTheDocument();
    });

    it('explains a rejected filter from a hand-edited address and offers to clear it', async () => {
      startServer(() => ({ status: 400, body: { message: 'Validation failed', fieldErrors: { involving: ['Invalid UUID'] } } }));
      renderAudit('/audit?involving=not-a-uuid');
      expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    it('renders hostile labels as inert text, never as markup', async () => {
      const hostile = entry({
        id: 'x1',
        actor: { id: null, role: null, label: '<img src=x onerror=alert(1)>', name: null },
        summary: 'Failed sign-in for <img src=x onerror=alert(1)> (wrong password)',
        label: 'Sign-in failed',
        tone: 'warning',
      });
      startServer({ '': { items: [hostile], nextCursor: null } });
      const { container } = renderAudit();
      expect(await screen.findByText('Failed sign-in for <img src=x onerror=alert(1)> (wrong password)')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('filters', () => {
    it('filters by person, category and date range and reflects them in the address', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      await userEvent.selectOptions(screen.getByLabelText('Person'), 'staff-1');
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('actorId')).toBe('staff-1'));
      await userEvent.selectOptions(screen.getByLabelText('Category'), 'content');
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('category')).toBe('content'));
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-02' } });
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('from')).not.toBeNull());
      expect(screen.getByTestId('location')).toHaveTextContent('actorId=staff-1');
      expect(screen.getByTestId('location')).toHaveTextContent('category=content');
      expect(screen.getByTestId('location')).toHaveTextContent('from=2026-03-02');
    });

    it('searches only when submitted, not on every keystroke', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log' });
      const before = server.auditCalls().length;
      await userEvent.type(screen.getByLabelText('Search'), 'ben');
      expect(server.auditCalls().length).toBe(before);
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('q')).toBe('ben'));
    });

    it('shows a removable chip for activity of one person when arriving from the Staff page', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit('/audit?involving=staff-1');
      expect(await screen.findByText('Activity of Ben Okoye')).toBeInTheDocument();
      expect(server.auditCalls()[0]!.url.searchParams.get('involving')).toBe('staff-1');
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Activity of Ben Okoye' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/audit$/));
      await waitFor(() => expect(server.auditCalls().at(-1)!.url.searchParams.get('involving')).toBeNull());
    });
  });

  describe('details drawer', () => {
    it('opens from a row with the full record and a before/after comparison, and closes again', async () => {
      startServer({ '': { items: [entry(), signIn], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: "Anita Rao changed Ben Okoye's role from Staff to Admin" }));
      const drawer = screen.getByRole('dialog', { name: 'Role changed' });
      expect(within(drawer).getByText('2026-10-08 10:42:07 UTC')).toBeInTheDocument();
      expect(within(drawer).getByText('Anita Rao (Admin)')).toBeInTheDocument();
      expect(within(drawer).getByText('User: Ben Okoye')).toBeInTheDocument();
      expect(within(drawer).getByText('Portal · 203.0.113.9')).toBeInTheDocument();
      expect(within(drawer).getByText('req-7f3c')).toBeInTheDocument();
      const diff = within(drawer).getByRole('table', { name: 'Changes' });
      expect(within(diff).getByText('role')).toBeInTheDocument();
      expect(within(diff).getByText('staff')).toBeInTheDocument();
      expect(within(diff).getByText('admin')).toBeInTheDocument();
      await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Role changed' })).not.toBeInTheDocument();
    });

    it('opens from the keyboard (focus the summary, press Enter)', async () => {
      startServer({ '': { items: [signIn], nextCursor: null } });
      renderAudit();
      const summary = await screen.findByRole('button', { name: 'Ben Okoye signed in from the app' });
      summary.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('dialog', { name: 'Signed in' })).toBeInTheDocument();
    });

    it('shows app version for mobile entries, and a typed label for failed sign-ins with no person', async () => {
      startServer({ '': { items: [signIn, failed], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Failed sign-in for dev@jbf.org (wrong password)' }));
      const drawer = screen.getByRole('dialog', { name: 'Sign-in failed' });
      expect(within(drawer).getByText('dev@jbf.org')).toBeInTheDocument();
      expect(within(drawer).queryByRole('table', { name: 'Changes' })).not.toBeInTheDocument();
      expect(within(drawer).getByText(/wrong_password/)).toBeInTheDocument();
    });

    it('links to everything involving that person', async () => {
      startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: "Anita Rao changed Ben Okoye's role from Staff to Admin" }));
      const link = within(screen.getByRole('dialog', { name: 'Role changed' })).getByRole('link', { name: "View all of Anita Rao's activity" });
      expect(link).toHaveAttribute('href', '/audit?involving=admin-1');
      await userEvent.click(link);
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/audit?involving=admin-1'));
      expect(screen.queryByRole('dialog', { name: 'Role changed' })).not.toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('downloads the CSV for the current filters', async () => {
      const server = startServer({ '': { items: [entry()], nextCursor: null } });
      renderAudit('/audit?category=accounts');
      await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
      await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
      expect(saveBlob.mock.calls[0]![1]).toBe('audit-log-2026-10-08.csv');
      const exportCall = server.calls.find((c) => c.url.pathname === '/api/audit/export.csv')!;
      expect(exportCall.url.searchParams.get('category')).toBe('accounts');
      expect(exportCall.url.searchParams.get('limit')).toBeNull();
    });

    it('shows the server\'s message when there are too many rows and lets the Admin try again', async () => {
      startServer(
        { '': { items: [entry()], nextCursor: null } },
        { status: 413, body: { message: 'Too many rows to export (limit 50000). Narrow the filters.' } },
      );
      renderAudit();
      await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Too many rows to export (limit 50000). Narrow the filters.');
      expect(saveBlob).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    });
  });
});
```

Run: `npm test -w @jbf/web -- AuditPage` → FAIL (modules missing).

- [ ] **Step 4: Implement the filter bar**

`apps/web/src/pages/audit/AuditFilters.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import type { AuditFilters as Filters } from '../../api/audit';
import type { Person } from '../../api/staff';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import styles from './AuditPage.module.css';

interface AuditFiltersProps {
  filters: Filters;
  people: Person[];
  personName?: string;
  onChange: (filters: Filters) => void;
}

export function AuditFilterBar({ filters, people, personName, onChange }: AuditFiltersProps) {
  const [search, setSearch] = useState(filters.q ?? '');

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onChange({ ...filters, q: search.trim() || undefined });
  }

  return (
    <div className={styles.filters}>
      {filters.involving ? (
        <p className={styles.chip}>
          <span>{`Activity of ${personName ?? 'this person'}`}</span>
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`Remove filter: Activity of ${personName ?? 'this person'}`}
            onClick={() => onChange({ ...filters, involving: undefined })}
          >
            ×
          </button>
        </p>
      ) : null}
      <div className={styles.filterRow}>
        <Select label="Person" value={filters.actorId ?? ''} onChange={(e) => onChange({ ...filters, actorId: e.target.value || undefined })}>
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        <Select label="Category" value={filters.category ?? ''} onChange={(e) => onChange({ ...filters, category: e.target.value || undefined })}>
          <option value="">All categories</option>
          <option value="accounts">Accounts</option>
          <option value="content">Content</option>
          <option value="files">Files</option>
          <option value="playback">Playback</option>
        </Select>
        <TextField label="From" type="date" value={filters.from ?? ''} onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
        <TextField label="To" type="date" value={filters.to ?? ''} onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
      </div>
      <form role="search" className={styles.searchRow} onSubmit={submitSearch}>
        <TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} hint="Names, emails and action types" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={!filters.includePlayback}
          onChange={(e) => onChange({ ...filters, includePlayback: e.target.checked ? undefined : true })}
        />
        Changes only
      </label>
    </div>
  );
}
```

Note: the component is exported as `AuditFilterBar` (the file is named `AuditFilters.tsx` to match the plan's file list; the type import is aliased to avoid a name clash).

- [ ] **Step 5: Implement the table and the drawer content**

`apps/web/src/pages/audit/AuditTable.tsx`:

```tsx
import type { AuditEntry } from '../../api/audit';
import { Badge } from '../../components/Badge';
import { Table } from '../../components/Table';
import { formatDateTime } from '../../lib/format';
import styles from './AuditPage.module.css';

const personOf = (entry: AuditEntry): { name: string; role: string | null } => ({
  name: entry.actor?.name ?? entry.actor?.label ?? 'System',
  role: entry.actor?.role ? (entry.actor.role === 'admin' ? 'Admin' : 'Staff') : null,
});

export const sourceLabel = (source: string): string => (source === 'mobile' ? 'App' : source === 'system' ? 'System' : 'Portal');

interface AuditTableProps {
  entries: AuditEntry[];
  onOpen: (entry: AuditEntry) => void;
}

export function AuditTable({ entries, onOpen }: AuditTableProps) {
  return (
    <Table caption="Audit log">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Person</th>
          <th scope="col">Action</th>
          <th scope="col">What happened</th>
          <th scope="col">From</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const person = personOf(entry);
          return (
            <tr key={entry.id} className={styles.row} onClick={() => onOpen(entry)}>
              <td data-label="Time">
                <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
              </td>
              <td data-label="Person">
                <span className={styles.name}>{person.name}</span>
                {person.role ? <span className={styles.muted}>{person.role}</span> : null}
              </td>
              <td data-label="Action">
                <Badge tone={entry.tone}>{entry.label}</Badge>
              </td>
              <td data-label="What happened">
                <button type="button" className={styles.summary}>
                  {entry.summary}
                </button>
              </td>
              <td data-label="From">{sourceLabel(entry.source)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
```

`apps/web/src/pages/audit/AuditDetails.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { AuditEntry } from '../../api/audit';
import { Table } from '../../components/Table';
import { formatDateTime, formatExactUtc, formatValue } from '../../lib/format';
import styles from './AuditPage.module.css';
import { sourceLabel } from './AuditTable';

const roleLabel = (role: string | null): string => (role === 'admin' ? ' (Admin)' : role === 'staff' ? ' (Staff)' : '');

interface AuditDetailsProps {
  entry: AuditEntry;
  onNavigate: () => void;
}

export function AuditDetails({ entry, onNavigate }: AuditDetailsProps) {
  const actorName = entry.actor?.name ?? entry.actor?.label ?? 'System';
  const personId = entry.actor?.id ?? (entry.target?.type === 'user' ? entry.target.id : null);
  const personName = entry.actor?.id ? actorName : (entry.target?.name ?? entry.target?.label ?? 'this person');
  const changes = entry.changes ? Object.entries(entry.changes) : [];

  return (
    <>
      <p>{entry.summary}</p>
      <dl className={styles.details}>
        <dt>When</dt>
        <dd>
          {formatDateTime(entry.occurredAt)}
          <span className={styles.muted}>{formatExactUtc(entry.occurredAt)}</span>
        </dd>
        <dt>Who</dt>
        <dd>{`${actorName}${roleLabel(entry.actor?.role ?? null)}`}</dd>
        {entry.target ? (
          <>
            <dt>Target</dt>
            <dd>{`${entry.target.type === 'user' ? 'User' : entry.target.type === 'invite' ? 'Invite' : entry.target.type}: ${entry.target.name ?? entry.target.label ?? entry.target.id}`}</dd>
          </>
        ) : null}
        <dt>From</dt>
        <dd>{[sourceLabel(entry.source), entry.ip].filter(Boolean).join(' · ')}</dd>
        {entry.appVersion ? (
          <>
            <dt>App version</dt>
            <dd>{entry.appVersion}</dd>
          </>
        ) : null}
        {entry.userAgent ? (
          <>
            <dt>Device</dt>
            <dd>{entry.userAgent}</dd>
          </>
        ) : null}
        {entry.requestId ? (
          <>
            <dt>Request</dt>
            <dd>{entry.requestId}</dd>
          </>
        ) : null}
      </dl>

      {changes.length > 0 ? (
        <Table caption="Changes">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(([field, change]) => (
              <tr key={field}>
                <td data-label="Field">{field}</td>
                <td data-label="Before" className={styles.before}>
                  {formatValue(change.before)}
                </td>
                <td data-label="After" className={styles.after}>
                  {formatValue(change.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {entry.metadata ? <pre className={styles.metadata}>{JSON.stringify(entry.metadata, null, 2)}</pre> : null}

      {personId ? (
        <p>
          <Link to={`/audit?involving=${personId}`} onClick={onNavigate}>{`View all of ${personName}'s activity`}</Link>
        </p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 6: Implement the page**

`apps/web/src/pages/audit/AuditPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AuditEntry, exportAudit, filtersFromParams, filtersToParams, listAudit, markAuditOpened, type AuditFilters } from '../../api/audit';
import { describeError } from '../../api/client';
import { listPeople, type Person } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { saveBlob } from '../../lib/download';
import { AuditDetails } from './AuditDetails';
import { AuditFilterBar } from './AuditFilters';
import styles from './AuditPage.module.css';
import { AuditTable } from './AuditTable';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AuditEntry[]; nextCursor: string | null; loadingMore: boolean; moreError: string | null };

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(key)), [key]);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const pinged = useRef(false);

  // One "opened" marker per visit. The ref also keeps React StrictMode's double effect from sending two.
  useEffect(() => {
    if (pinged.current) return;
    pinged.current = true;
    void markAuditOpened().catch(() => undefined);
  }, []);

  useEffect(() => {
    listPeople().then(setPeople).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listAudit(filters)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreError: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloads]);

  const change = useCallback(
    (next: AuditFilters) => {
      setExportError(null);
      setParams(filtersToParams(next));
    },
    [setParams],
  );

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    const { items, nextCursor } = state;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const page = await listAudit(filters, nextCursor);
      setState({ status: 'ready', items: [...items, ...page.items], nextCursor: page.nextCursor, loadingMore: false, moreError: null });
    } catch (error) {
      setState({ status: 'ready', items, nextCursor, loadingMore: false, moreError: describeError(error) });
    }
  }

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportAudit(filters);
      saveBlob(blob, filename);
    } catch (error) {
      setExportError(describeError(error));
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = params.toString() !== '';
  const personName = people.find((person) => person.id === filters.involving)?.name;

  return (
    <>
      <div className={styles.header}>
        <h1>Audit log</h1>
        <Button variant="secondary" busy={exporting} onClick={() => void onExport()}>
          Export CSV
        </Button>
      </div>

      {exportError ? <Alert tone="error">{exportError}</Alert> : null}

      <AuditFilterBar key={filters.q ?? ''} filters={filters} people={people} personName={personName} onChange={change} />

      {state.status === 'loading' ? (
        <Skeleton rows={6} />
      ) : state.status === 'error' ? (
        <>
          <Alert tone="error">{state.message}</Alert>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setReloads((count) => count + 1)}>
              Retry
            </Button>
            {hasFilters ? (
              <Button variant="secondary" onClick={() => change({})}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </>
      ) : state.items.length === 0 ? (
        <EmptyState title="No activity matches these filters">
          {hasFilters ? (
            <Button variant="secondary" onClick={() => change({})}>
              Clear filters
            </Button>
          ) : (
            'Activity appears here as people use the system.'
          )}
        </EmptyState>
      ) : (
        <>
          <AuditTable entries={state.items} onOpen={setSelected} />
          {state.moreError ? <Alert tone="error">{state.moreError}</Alert> : null}
          {state.nextCursor ? (
            <div className={styles.more}>
              <Button variant="secondary" busy={state.loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={selected !== null} onClose={() => setSelected(null)} title={selected?.label ?? 'Details'} side="right">
        {selected ? <AuditDetails entry={selected} onNavigate={() => setSelected(null)} /> : null}
      </Dialog>
    </>
  );
}
```

`apps/web/src/pages/audit/AuditPage.module.css`:

```css
.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.header h1 {
  margin: 0;
}

.filters {
  margin-bottom: var(--space-4);
}

.filterRow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-4);
}

.searchRow {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
}

.searchRow > :first-child {
  flex: 1;
}

.searchRow button {
  margin-bottom: var(--space-4);
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  color: var(--color-primary);
  font-weight: 500;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  background: var(--color-info-surface);
  color: var(--color-primary);
  font-weight: 500;
}

.chipRemove {
  min-width: 28px;
  min-height: 28px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.row {
  cursor: pointer;
}

.row:hover {
  background: var(--color-surface);
}

.name {
  display: block;
  font-weight: 500;
}

.muted {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.summary {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.summary:hover {
  text-decoration: underline;
}

.more {
  display: flex;
  justify-content: center;
  margin-top: var(--space-4);
}

.actions {
  display: flex;
  gap: var(--space-3);
}

.details {
  display: grid;
  grid-template-columns: 7rem 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-6);
}

.details dt {
  color: var(--color-text-muted);
}

.details dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.before {
  background: var(--color-danger-surface);
}

.after {
  background: var(--color-success-surface);
}

.metadata {
  overflow-x: auto;
  margin: 0 0 var(--space-6);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  font-size: var(--text-sm);
}
```

- [ ] **Step 7: Route and navigation**

`apps/web/src/components/nav-items.ts`: append `{ to: '/audit', label: 'Audit log', group: 'admin', adminOnly: true }` after the Staff item.

`apps/web/src/App.tsx`: add `import { AuditPage } from './pages/audit/AuditPage';` and, inside the `AdminRoute` block next to the Staff route:

```tsx
            <Route path="/audit" element={<AuditPage />} />
```

Extend the AppShell test for Admins (`AppShell.spec.tsx`, the "shows the Admin section only to Admins" test): also assert `within(nav).getByRole('link', { name: 'Audit log' })` has `href="/audit"`, and in the Staff test assert it is absent.

- [ ] **Step 8: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. Likely snags (fix the code, never loosen the assertion): the `Person` select needs `people` loaded (the test's `/api/users` stub returns them); "records one marker per visit" fails if the ping effect depends on `filters`; `getByRole('button', { name: <summary text> })` requires the summary to be a real `<button>`; the keyboard test needs the Enter key to bubble from the button to the row's `onClick`.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the Audit log page with filters, details drawer and export"
```

---

### Task 8: My account page

**Files:**
- Modify: `apps/web/src/api/auth.ts`, `apps/web/src/auth/AuthContext.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/account/AccountPage.tsx`, `apps/web/src/pages/account/AccountPage.module.css`
- Test: `apps/web/src/pages/account/AccountPage.spec.tsx`; extend `LoginPage.spec.tsx` and `AppShell.spec.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/change-password {currentPassword,newPassword}` (204; 400 with `fieldErrors.currentPassword` or `fieldErrors.newPassword`), `POST /api/auth/logout-all` (204), `GET /api/auth/password-policy`.
- Produces:

```ts
// api/auth.ts
changePassword(currentPassword: string, newPassword: string): Promise<void>; logoutAll(): Promise<void>
// AuthContext: AuthState anonymous variant gains an optional notice; signOut(notice?: string)
type AuthState = { status: 'loading' } | { status: 'anonymous'; notice?: string } | { status: 'authenticated'; user: User }
signOut: (notice?: string) => Promise<void>
```

Design note: after a password change or "sign out everywhere" the server has revoked every session, so the app signs the person out locally and the sign-in page shows a notice. The notice travels in the auth state (not router state) because signing out re-renders the protected routes into a redirect that would drop router state.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/pages/account/AccountPage.spec.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../../auth/ProtectedRoute';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, mockSession, renderWithSession } from '../../test/session';
import { LoginPage } from '../LoginPage';
import { AccountPage } from './AccountPage';

type Override = MockResponse | (() => MockResponse | Promise<MockResponse>);

function start(overrides: Record<string, Override> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  mockSession(ADMIN, (url, init) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const key = `${method} ${url}`;
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override() : override;
    if (key === 'GET /api/auth/password-policy') return { body: { minLength: 10, maxLength: 128 } };
    if (key === 'POST /api/auth/change-password' || key === 'POST /api/auth/logout-all' || key === 'POST /api/auth/logout') return { status: 204 };
    return { status: 404, body: {} };
  });
  return { calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key).length };
}

function renderAccount() {
  return renderWithSession(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/account" element={<AccountPage />} />
      </Route>
    </Routes>,
    '/account',
  );
}

const fill = async (current: string, next: string, confirm: string) => {
  await userEvent.type(await screen.findByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
};

describe('AccountPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the password rules and the sign-out warning before anything is typed', async () => {
    start();
    renderAccount();
    expect(await screen.findByLabelText('New password')).toHaveAccessibleDescription(/at least 10 characters/i);
    expect(screen.getByText(/signs you out of every device/i)).toBeInTheDocument();
  });

  it('asks for every field and moves focus to the first problem without calling the server', async () => {
    const server = start();
    renderAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription('Enter your current password.');
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(server.count('POST /api/auth/change-password')).toBe(0);
  });

  it('rejects a short or mismatched new password before calling the server', async () => {
    const server = start();
    renderAccount();
    await fill('current password!', 'short', 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/use at least 10 characters/i);
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription(/do not match/i);
    expect(server.count('POST /api/auth/change-password')).toBe(0);
  });

  it('changes the password, signs out locally and shows a notice on the sign-in page', async () => {
    const server = start();
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your password was changed. Sign in again with the new one.');
    expect(server.calls.find((c) => c.url === '/api/auth/change-password')?.body).toEqual({
      currentPassword: 'current password!',
      newPassword: 'a brand new passphrase',
    });
  });

  it('shows the server\'s complaint under the right field and keeps what was typed', async () => {
    start({
      'POST /api/auth/change-password': { status: 400, body: { message: 'Validation failed', fieldErrors: { currentPassword: ['Current password is incorrect.'] } } },
    });
    renderAccount();
    await fill('wrong current', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveFocus();
    expect(screen.getByLabelText('New password')).toHaveValue('a brand new passphrase');
  });

  it('shows a common-password complaint from the server under the new password field', async () => {
    start({
      'POST /api/auth/change-password': {
        status: 400,
        body: { message: 'Validation failed', fieldErrors: { newPassword: ['That password is too common. Choose something less guessable.'] } },
      },
    });
    renderAccount();
    await fill('current password!', 'password123', 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
  });

  it('keeps the form and shows an alert for rate limits and server errors', async () => {
    start({ 'POST /api/auth/change-password': { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } } });
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please try again in a minute.');
    expect(screen.getByLabelText('New password')).toHaveValue('a brand new passphrase');
  });

  it('disables the button while the request is in flight so it cannot be sent twice', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const gate = new Promise<MockResponse>((resolve) => {
      release = resolve;
    });
    const server = start({ 'POST /api/auth/change-password': () => gate });
    renderAccount();
    await fill('current password!', 'a brand new passphrase', 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    release({ status: 204 });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(server.count('POST /api/auth/change-password')).toBe(1);
  });

  describe('sign out of all devices', () => {
    it('asks first, then ends every session and shows a notice on the sign-in page', async () => {
      const server = start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      const dialog = screen.getByRole('dialog', { name: 'Sign out of all devices?' });
      expect(server.count('POST /api/auth/logout-all')).toBe(0);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('You were signed out of all devices.');
      expect(server.count('POST /api/auth/logout-all')).toBe(1);
    });

    it('does nothing when cancelled', async () => {
      const server = start();
      renderAccount();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Sign out of all devices?' })).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out of all devices?' })).not.toBeInTheDocument());
      expect(server.count('POST /api/auth/logout-all')).toBe(0);
    });
  });
});
```

Add the missing import to that file's header: `import { screen, waitFor, within } from '@testing-library/react';` (replace the first import line).

The positive case for the auth-state notice (shown on the sign-in page after `signOut(notice)`) is covered end to end by the AccountPage tests above.

Add to `AppShell.spec.tsx`: in both nav tests assert `within(nav).getByRole('link', { name: 'My account' })` is present for Admin and for Staff (href `/account`).

Run: `npm test -w @jbf/web -- AccountPage` → FAIL.

- [ ] **Step 2: Implement the API calls, the auth-state notice and the page**

`apps/web/src/api/auth.ts`: append

```ts
export const changePassword = (currentPassword: string, newPassword: string): Promise<void> =>
  api('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });

export const logoutAll = (): Promise<void> => api('/api/auth/logout-all', { method: 'POST' });
```

`apps/web/src/auth/AuthContext.tsx`: change the types and `signOut`:

```tsx
type AuthState = { status: 'loading' } | { status: 'anonymous'; notice?: string } | { status: 'authenticated'; user: User };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
}
```

and

```tsx
  const signOut = useCallback(async (notice?: string) => {
    await logout().catch(() => undefined);
    setState({ status: 'anonymous', notice });
  }, []);
```

`apps/web/src/pages/LoginPage.tsx`: replace the `notice` line

```tsx
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
```

with

```tsx
  const locationNotice = (useLocation().state as { notice?: string } | null)?.notice;
  const notice = locationNotice ?? (state.status === 'anonymous' ? state.notice : undefined);
```

(`state` comes from the existing `const { state, signIn } = useAuth();` line, which must come before it; keep the hook order as in the file.)

`apps/web/src/pages/account/AccountPage.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { changePassword, fetchPasswordPolicy, logoutAll } from '../../api/auth';
import { ApiError, describeError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextField } from '../../components/TextField';
import styles from './AccountPage.module.css';

type FieldName = 'current' | 'next' | 'confirm';

export function AccountPage() {
  const { signOut } = useAuth();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [minLength, setMinLength] = useState(10);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: FieldName } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
  }, []);

  // Focus moves only after the error text has rendered, so screen readers announce the field with its error.
  useEffect(() => {
    if (!focusRequest) return;
    ({ current: currentRef, next: nextRef, confirm: confirmRef })[focusRequest.field].current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<FieldName, string>> = {
      current: current ? undefined : 'Enter your current password.',
      next: [...next].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: next === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(found);
    setFailure(null);
    const first = (['current', 'next', 'confirm'] as const).find((field) => found[field]);
    if (first) {
      setFocusRequest({ field: first });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      await signOut('Your password was changed. Sign in again with the new one.');
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.currentPassword) {
        setErrors({ current: error.fieldErrors.currentPassword.join(' ') });
        setFocusRequest({ field: 'current' });
      } else if (error instanceof ApiError && error.fieldErrors.newPassword) {
        setErrors({ next: error.fieldErrors.newPassword.join(' ') });
        setFocusRequest({ field: 'next' });
      } else {
        setFailure(describeError(error));
      }
      setBusy(false);
    }
  }

  async function onSignOutEverywhere() {
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      await logoutAll();
      await signOut('You were signed out of all devices.');
    } catch (error) {
      setSignOutError(describeError(error));
      setSignOutBusy(false);
    }
  }

  return (
    <>
      <h1>My account</h1>

      <section className={styles.section} aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p>Changing your password signs you out of every device, including this one. You will sign in again with the new password.</p>
        {failure ? <Alert tone="error">{failure}</Alert> : null}
        <form onSubmit={onSubmit} noValidate className={styles.form}>
          <TextField ref={currentRef} label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
          <TextField
            ref={nextRef}
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            hint={`At least ${minLength} characters. A short sentence works well. Common passwords are not allowed.`}
            error={errors.next}
          />
          <TextField ref={confirmRef} label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" busy={busy}>
            Change password
          </Button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="devices-heading">
        <h2 id="devices-heading">Devices</h2>
        <p>Lost a phone or used a shared computer? Sign out everywhere to end every session for your account.</p>
        <Button variant="secondary" onClick={() => setConfirmingSignOut(true)}>
          Sign out of all devices
        </Button>
      </section>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out of all devices?"
        confirmLabel="Sign out everywhere"
        busy={signOutBusy}
        error={signOutError}
        onCancel={() => {
          setConfirmingSignOut(false);
          setSignOutError(null);
        }}
        onConfirm={() => void onSignOutEverywhere()}
      >
        Every session for your account ends, on this computer and on your phone. You will need to sign in again.
      </ConfirmDialog>
    </>
  );
}
```

`apps/web/src/pages/account/AccountPage.module.css`:

```css
.section {
  max-width: 32rem;
  margin-bottom: var(--space-12);
}

.form {
  margin-top: var(--space-4);
}
```

- [ ] **Step 3: Route and navigation**

`apps/web/src/components/nav-items.ts`: append `{ to: '/account', label: 'My account', group: 'account' }`.

`apps/web/src/App.tsx`: add `import { AccountPage } from './pages/account/AccountPage';` and inside the `AppShell` route (outside `AdminRoute`, after the Dashboard route):

```tsx
          <Route path="/account" element={<AccountPage />} />
```

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. If `getByRole('status')` finds the notice twice (Alert plus the Skeleton or another status), scope it to the sign-in page content.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the My account page with password change and sign out everywhere"
```

---

### Task 9: API contract, documentation, full check and handoff

**Files:**
- Create: `docs/api/audit.md`
- Modify: `README.md`, `ARCHITECTURE.md`, `PROGRESS.md`, `TASKS.md`, `CHANGELOG.md`, `DECISIONS.md`, `docs/api/auth.md` (add the web-only note about the account page changing nothing in the contract: no edit needed unless a statement became false), `apps/api/.env.example` (already updated in Task 3)

- [ ] **Step 1: Write the audit API contract**

`docs/api/audit.md`, derived from the actual controllers, schemas and e2e tests (read `apps/api/src/audit/*.ts` and `apps/api/test/audit*.e2e-spec.ts`; do not write from memory). It must document: the three endpoints (`GET /api/audit`, `POST /api/audit/opened`, `GET /api/audit/export.csv`) with auth (Admin only: 401 anonymous, 403 Staff), every query parameter with its validation and defaults (`limit` 1–100 default 50, `cursor` opaque, `actorId`, `involving`, `category`, `action`, `from`, `to`, `q` max 100, `includePlayback` default false / "Changes only"), the exact response shape with one example entry, the tone/label/category table for every known action, how unknown actions are presented, the error shapes (400 with `fieldErrors`, 413 export message, 429), the CSV columns and the formula-neutralizing rule, the `AUDIT_EXPORT_MAX_ROWS` setting, and the rule that opening the page records one `audit.viewed` and each export records `audit.exported` (filters and row count only).

- [ ] **Step 2: Working-memory files and README**

- `TASKS.md`: tick milestone 2 and keep milestones 3–7 unticked.
- `PROGRESS.md`: milestone 2 done (summary); next: milestone 3 (media upload and playback, Videos); open items carried from milestone 1 (OpenAPI decision for the user; first Admin creation; manual browser check; CI first run; same-origin hosting; `NODE_ENV=production`), plus new items: the parked milestone 1 review minors that remain, `q` search is a sequential scan (add trigram indexes if volume grows), audit archiving not designed, names joined at read time (breaks if users are ever hard-deleted).
- `CHANGELOG.md`: one dated line per meaningful change in this milestone.
- `DECISIONS.md`: dated entries with reasons: Staff page as two tabs; audit details in a side drawer; "viewed" logged once per page open; keyset paging with microsecond-exact cursors; summaries generated on the server; names joined at read time; export cap and formula neutralizing; native `<dialog>` with `closedby` and fallback; inline action buttons instead of a row menu; no top-bar search yet; the sign-out notice carried in auth state; Admin-only pages hidden in the UI and enforced by the server.
- `README.md`: add the new environment variable and a short "Pages" section (Dashboard, Staff, Audit log, My account, who can see what).
- `ARCHITECTURE.md`: add the audit read side and the app shell to the module map.

- [ ] **Step 3: Full verification**

```bash
npm run lint && npm run build && npm test && npm audit --audit-level=high
```

Expected: lint clean; both builds succeed; all API and web suites pass with pristine output (no React `act` warnings, no unhandled rejections); audit reports no high or critical findings (dev-only moderate advisories are acceptable and already recorded). Then check by hand: `grep -R "HomePage" apps/web/src` prints nothing; `grep -R "console.log" apps/*/src` prints nothing outside `apps/api/src/cli`; no unused exports in the new files (search each new exported symbol).

Run the new API suites and the page specs three times in a row to rule out order dependence: `for i in 1 2 3; do npm test -w @jbf/api -- audit && npm test -w @jbf/web -- Audit Staff Account || break; done`.

- [ ] **Step 4: Commit the docs, then stop for review**

```bash
git add -A
git commit -m "docs: document the audit API and update the working-memory files"
git status
```

Expected: clean tree on `milestone-2-staff-audit` (apart from the untracked `vibe-coding-master-prompt.md` and `.claude/`). Do not merge or push. Report to the user in plain language: what was built, how to try it (create the first Admin, open the Staff and Audit log pages, export a CSV), what was tested, the rulings made, and open items. After the user approves: `git pull --rebase origin main`, merge fast-forward into `main`, run the suites once more on the merged result, push.

---

## Self-Review

**Spec coverage** (`2026-10-08-milestone-2-staff-and-audit-design.md`):
- §3.1 list endpoint, params, view shape → Task 2. §3.2 labels/tones/categories/summaries → Task 1. §3.3 export → Task 3. §3.4 logging the use of the log → Task 3 (server) and Task 7 (client marker). §3.5 indexes and new actions → Tasks 1 and 2.
- §4.1 shell/routes/mobile menu → Task 5. §4.2 Staff page → Task 6. §4.3 Audit page → Task 7. §4.4 My account → Task 8. §4.5 components/tokens/jsdom note → Task 4.
- §5 acceptance criteria: Staff blocked (Tasks 2, 3, 5, 6, 7 tests); every action presented (Task 1 test over `AUDIT_ACTIONS`); stable paging and filters (Task 2); export safety and cap and logging (Task 3); no secrets (the log never stores them; views add none — covered by the shape test); staff actions end-to-end (Task 6); My account (Task 8); keyboard, contrast, motion, responsive (Tasks 4–8 styles and tests).
- Planned simplifications of the spec are listed at the top (inline action buttons; single `Dialog`).

**Placeholder scan:** no TBD/TODO; every code step shows the final file contents.

**Type consistency:** `AuditEntryView` (API) ↔ `AuditEntry` (web) fields match; `AuditFilters` (web, dates as `YYYY-MM-DD`) vs `AuditFilters` (API, ISO instants) are different types in different packages joined by `auditQueryString`; `Person`/`Invite` match the milestone 1 `UserView`/`InviteView` JSON; `signOut(notice?)` is used by `AccountPage`, `AppShell` (no argument) and `LoginPage` reads `state.notice`.

**Review Focus coverage:** items 1–8 map to tests in Tasks 2, 3, 4, 5, 6, 7 as noted in the list.
