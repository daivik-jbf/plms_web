# Milestone 2: Staff Management and Audit Log — Design

Date: 2026-10-08
Status: Draft for review (nothing is planned or built until this is approved)
Parent spec: `2026-10-08-jbf-lms-portal-design.md` (sections 3, 7, 8 and milestone 2 of section 11). This document adds decisions and detail for milestone 2 only; where it is silent, the parent spec and the milestone 1 code govern.

## 1. Goal

Give Admins screens to run their team and read everything that has happened in the system, and give every signed-in person a place to manage their own password. Concretely: an app shell (sidebar and top bar), a Staff page, an Audit log page with a detail drawer, and a My account page. The backend for staff and invites already exists (milestone 1); this milestone adds the read side of the audit log.

## 2. Decisions made in discovery

| Topic | Decision |
|---|---|
| Scope extra | A **My account** page (change password, sign out of all devices) is included, for Admins and Staff. |
| Logging use of the log | One `audit.viewed` entry each time an Admin **opens** the Audit log page (not on filter or page changes), plus one `audit.exported` entry per CSV export. |
| Staff page layout | Two tabs: **People** and **Invites**. |
| Audit detail | A **side drawer** (full width on phones), not inline expansion. |
| Top-bar search | Omitted until there is content to search. |
| Sidebar | Shows only pages that exist: Dashboard and My account (everyone); Staff and Audit log (Admin only). |
| Dialogs and drawers | Native `<dialog>` opened with `showModal()`; light dismiss via `closedby="any"` with the click-outside fallback for browsers without `closedby` (Safari). The mobile menu uses the same mechanism. |

## 3. Audit log API (Admin only; Staff get 403, anonymous 401)

### 3.1 `GET /api/audit`

Returns `{ items: AuditEntryView[], nextCursor: string | null }`, newest first.

Query parameters (all optional; invalid values give 400 with `fieldErrors`):

| Parameter | Meaning |
|---|---|
| `limit` | 1 to 100, default 50. |
| `cursor` | Opaque token from the previous response (base64url of `occurred_at` and `id`). Paging is keyset-based on `(occurred_at desc, id desc)`, so it is stable while new entries arrive. |
| `actorId` | UUID. Entries performed by that person. |
| `involving` | UUID. Entries performed by that person OR whose target is that user (`target_id`). Powers the per-person history. |
| `category` | `accounts`, `content`, `files` or `playback`. |
| `action` | One known action name. |
| `from`, `to` | ISO 8601 date-times, inclusive range on `occurred_at`. |
| `q` | Up to 100 characters. Case-insensitive match against `actor_label`, `target_label`, the actor's name and the target user's name, and `action`. (The plain-English summary is computed, not stored, so it is not searched.) |
| `includePlayback` | Boolean, default `false`. When false the `playback` category is excluded ("Changes only"). No playback actions exist yet; the switch is built now so milestone 3 needs no API change. |

`AuditEntryView`:

```
id, occurredAt,
actor: { id, role, label, name } | null,      // name from users (LEFT JOIN on actor_id), else null
action, label, tone, category,
target: { type, id, label, name } | null,     // name from users when type='user' (LEFT JOIN on target_id)
source: 'portal' | 'mobile' | 'system', ip, userAgent, appVersion, requestId,
changes: { [field]: { before, after } } | null,
metadata: object | null,
summary: string
```

Display names come from the live `users` table by join (names cannot be edited and users are never hard-deleted, so the join is accurate); when there is no match the stored label is used.

### 3.2 Categories, labels, tones and summaries

One pure function module (`audit-presentation`) owns this and is unit-tested for every action. `tone` is one of `change` (cyan), `danger` (red), `warning` (amber), `success` (green), `neutral` (grey). Every badge also shows its text `label`.

| Action | Category | Label | Tone | Summary template (`A` = actor name or label, `T` = target name or label) |
|---|---|---|---|---|
| `auth.login.succeeded` | accounts | Signed in | success | `A signed in from the <portal/app>` |
| `auth.login.failed` | accounts | Sign-in failed | warning | `Failed sign-in for <label> (<reason>)` |
| `auth.logout` | accounts | Signed out | neutral | `A signed out` |
| `auth.logout_all` | accounts | Signed out everywhere | neutral | `A signed out of all devices` |
| `auth.refresh.reuse_detected` | accounts | Session reuse detected | warning | `A's session was ended because an old session token was reused` |
| `auth.password.changed` | accounts | Password changed | change | `A changed their password` |
| `auth.password.reset_requested` | accounts | Password reset requested | neutral | `A requested a password reset` |
| `auth.password.reset_completed` | accounts | Password reset | change | `A reset their password` |
| `invite.created` | accounts | Invite sent | change | `A invited T as <role>` |
| `invite.resent` | accounts | Invite resent | change | `A resent the invite to T` |
| `invite.cancelled` | accounts | Invite cancelled | danger | `A cancelled the invite for T` |
| `invite.accepted` | accounts | Invite accepted | success | `T accepted their invite and joined` |
| `user.role_changed` | accounts | Role changed | change | `A changed T's role from <before> to <after>` |
| `user.deactivated` | accounts | Deactivated | danger | `A deactivated T` |
| `user.reactivated` | accounts | Reactivated | success | `A reactivated T` |
| `audit.viewed` | accounts | Viewed audit log | neutral | `A opened the audit log` |
| `audit.exported` | accounts | Exported audit log | neutral | `A exported <n> audit log rows` |

Rows written by the system (no actor, `source: 'system'`) read `The system …` where it applies. Unknown or future actions fall back to the action name as label, neutral tone, and a generic summary, so a new action can never break the screen. Categories for future actions follow the action prefix (`content.*`, `file.*`, `playback.*`/`download.*`).

### 3.3 `GET /api/audit/export.csv`

Same filters as 3.1 (no paging). Streams a CSV file named `audit-log-YYYY-MM-DD.csv` with columns: time (ISO UTC), person, role, action, label, target type, target, source, IP, app version, request id, summary, changes (JSON). RFC 4180 quoting. **Spreadsheet formula injection:** any cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote (failed-login rows contain attacker-typed emails). If more than 50,000 rows match, respond 413 `Too many rows to export (limit 50,000). Narrow the filters.` Rows are read in keyset chunks of 1,000 so memory stays flat.

### 3.4 Logging the use of the log

- `POST /api/audit/opened` (204): records `audit.viewed` (actor = the Admin). Called once when the Audit page mounts.
- Each export records `audit.exported` with `metadata: { filters, rowCount }` (the filters used, never the exported data).

### 3.5 Database

One migration adds `audit_log (occurred_at desc, id desc)` for paging and `audit_log (target_id)` for per-person history. No column changes. The append-only triggers are untouched. New action names are added to `AuditAction`.

## 4. Web

### 4.1 Routes and shell

`/` Dashboard (placeholder), `/staff` and `/audit` (Admin only, wrapped in an `AdminRoute` that redirects Staff to `/`; the server enforces it regardless), `/account`. The shell is the sidebar plus top bar (name and role, Sign out) from the parent spec. Below tablet width the sidebar is a slide-in `<dialog>` drawer opened from a menu button in the top bar. `HomePage` from milestone 1 becomes the Dashboard page inside the shell.

### 4.2 Staff page (`/staff`)

- Tabs **People (n)** and **Invites (n)** (ARIA tabs pattern, arrow-key navigation).
- **People:** `GET /api/users`. Columns: name with email beneath, role, status badge (Active / Deactivated). Row menu: Change role (dialog with Admin/Staff select), Deactivate (confirm dialog explaining the person is signed out immediately), Reactivate, View activity (navigates to `/audit?involving=<id>`). On the signed-in Admin's own row, Change role and Deactivate are disabled with a hint "Ask another Admin" (a UI guard only; the server rule is the last-active-Admin rule). Server 409 `At least one active Admin is required.` is shown in the dialog.
- **Invites:** `GET /api/invites`. Columns: name and email, role, status badge (Pending with expiry, Expired), Resend, Cancel (confirm). Accepted and cancelled invites are hidden here (they remain visible in the audit log).
- **Invite person** button (top right of the page): dialog with name, email, role (Staff default). Validation on submit with field errors from the server. A 502 shows "The invite was saved but the email could not be sent. Use Resend." and refreshes the Invites tab.
- Lists are loaded on page open and reloaded after each successful action. A client-side text filter over the loaded list is provided (at most dozens of people).

### 4.3 Audit log page (`/audit`)

- On mount: `POST /api/audit/opened` once (guarded against React StrictMode double-mount), then load the first page.
- Filter bar: Person, Category, Date range, text search, and the **Changes only** toggle (on by default; off sets `includePlayback=true`). Filters are reflected in the URL query string so views can be shared and the browser back button works. Arriving with `?involving=<id>` shows a removable chip "Activity of <name>".
- Table: time, person (with role), action badge, summary, source. **Load more** appends the next page using `nextCursor`. Times display in the browser's local time zone; the drawer also shows exact UTC.
- Clicking or pressing Enter on a row opens the **drawer** with the full record: when, who, target, source and IP, app version, request id, the before/after table for `changes` (changed fields highlighted), and the "View all of <person>'s activity" link. Esc, the close button, or clicking outside closes it and returns focus to the row.
- **Export CSV** downloads with the current filters (shows the 413 message in an alert when too large).
- Designed loading skeleton, empty state ("No activity matches these filters" with a Clear filters button) and error state with Retry.

### 4.4 My account (`/account`)

Change password form (current, new, confirm; the rules shown before submit using `GET /api/auth/password-policy`; errors from the server shown under the fields, including `fieldErrors.currentPassword`). A notice before submit says changing the password signs the person out of every device; on success the app returns to the sign-in screen with a notice. A separate "Sign out of all devices" button (`POST /api/auth/logout-all`, with a confirm dialog).

### 4.5 Shared components (new)

`AppShell`, `Sidebar`/`MobileMenu`, `Modal` and `Drawer` (both on native `<dialog>`; `showModal()`, `aria-labelledby`, `closedby="any"` plus the documented fallback, slide transitions disabled under `prefers-reduced-motion`), `ConfirmDialog`, `Tabs`, `Badge` (tone and text), `DataTable` styles (stacks into labelled rows below tablet width), `Select`, `EmptyState`, `Spinner/Skeleton`. All styling uses the existing design tokens. New tokens only for badge tones: `--color-warning` (amber, text-safe `#92400E` on `#FFFBEB`) alongside the existing danger/success/primary. Tests stub `HTMLDialogElement.showModal/close` for jsdom where needed.

## 5. Acceptance criteria

- A Staff user cannot reach `/staff`, `/audit` or any `/api/audit*` endpoint (UI redirect and server 403), and sees only Dashboard and My account.
- Every audit entry type produced in milestone 1 appears in the log with the right category, label, tone and a correct plain-English summary; unknown actions render without error.
- Paging is stable under concurrent inserts (no duplicates or gaps), filters combine correctly, `involving` returns both performed-by and done-to entries, and `includePlayback=false` hides playback entries.
- CSV export respects filters, neutralizes formula-leading cells, refuses over 50,000 rows with a clear message, and logs `audit.exported` without exported data. Opening the page logs exactly one `audit.viewed`; changing filters or paging logs nothing.
- The audit read and export paths never return or log passwords, hashes or tokens (the log never contains them; the views add none).
- All staff-management actions work end to end through the UI against the milestone 1 API, including the last-Admin 409 message, the 502 invite-email message, the self-row guard, and immediate sign-out of a deactivated user.
- My account changes the password with server-side rules shown, signs out all devices, and the person must sign in again.
- Keyboard-only operation of tabs, menus, dialogs and the drawer works; focus returns to the trigger on close; contrast meets AA; reduced-motion is respected; layouts work at phone, tablet and desktop widths.

## 6. Out of scope for milestone 2

Content features (courses, media), the dashboard's real content (counts, uploads, storage), editing a person's name or email, deleting audit entries (never allowed), audit retention or archiving settings, global search, notifications, the restricted audit database role (milestone 7), OpenAPI generation (still proposed for milestone 6, pending the user's decision), and the small parked milestone 1 review notes (logged in `PROGRESS.md`), except any that this milestone's code touches anyway.

## 7. Risks and notes

- The audit table can grow without bound; the new indexes keep paging and per-person queries fast at the expected scale (about 50 users). Archiving policy is deferred.
- `q` search uses `ILIKE`; at this scale a sequential scan on the filtered range is acceptable. If volume grows, add trigram indexes.
- Names joined at read time depend on users never being hard-deleted. If hard deletes are ever introduced, audit presentation must snapshot names at write time.
- Native `<dialog>` `closedby` is not supported in Safari; the documented click-outside fallback covers it and is tested.
