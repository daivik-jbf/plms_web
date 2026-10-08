# JBF Learning Management System — Web Portal Design

Date: 2026-10-08
Status: Draft for review (nothing is built until this is approved)

## 1. Purpose

A web portal for managing and playing learning and media content, for staff of a single organization (JBF) working with a prison population. The same accounts and the same content are used by a separate mobile app, which already exists but has no backend yet. The portal's backend becomes the mobile app's backend.

The one thing it must get right: **content and account permissions are enforced on the server for both clients**, and **every action is recorded in a tamper-proof audit log that Admins can read.**

## 2. Decisions locked in discovery

| Topic | Decision |
|---|---|
| Users | Two roles only: **Admin** and **Staff**. No learner accounts, no third parties. |
| Who consumes content | Admins and Staff, in both the portal and the mobile app. |
| Visibility | Anything uploaded is visible to every user. |
| Organizations | Single organization, one shared library. No multi-facility or multi-tenant. |
| Login | One login for portal and mobile. Email + password, Admin-issued invites. No self-signup. |
| 2FA | Not in version 1. |
| Scale | Small: ~50 users, ~100 hours of media (tens of GB). |
| Offline | Mobile app downloads files to a location visible in the device file manager. No encryption or expiry. |
| Video conversion | None in version 1. MP4 (H.264/AAC) only. |
| Visual identity | White and cyan blue. App name: **JBF Learning Management System**. |
| Stack | Option 2: React + NestJS + PostgreSQL + S3-compatible storage (see section 10). |

## 3. Roles and permissions

| Action | Staff | Admin |
|---|---|---|
| Sign in, browse, play, download content | Yes | Yes |
| Upload new content | Yes | Yes |
| Edit any content (titles, order, descriptions, replace files) | Yes | Yes |
| Delete content (moves to Trash) | No | Yes |
| Restore from Trash, permanently purge | No | Yes |
| Invite staff, deactivate accounts, change roles | No | Yes |
| View and export the audit log | No | Yes |
| Change own password and profile | Yes | Yes |

Rules:
- Every permission is enforced by the API on every request. The UI hides what a user can't do, but hiding is never the control.
- Admins can create other Admins.
- The system refuses to deactivate or demote the **last remaining active Admin**.
- Deactivating a user revokes their refresh tokens, locking them out of portal and app within the access-token lifetime (~15 minutes).
- Deletion is soft. Soft-deleted content disappears from the app at its next sync. Copies already saved in a device's file manager stay on the device; the app can only remove its own in-app entry.

## 4. Content structure

Five fixed categories: **Courses, Videos, Movies, Podcasts, Songs.** Admin cannot add or remove categories in version 1.

**Courses:** Course → Lesson → Topic, any number at each level, manually ordered.
- Course: title, description, cover image.
- Topic: title, text description, and any number of **attachments** (video, audio, PDF, image).

**Videos, Movies, Podcasts, Songs:** Category → Folder → Items, one level of folders (no nested folders).
- Videos and Movies hold video files. Podcasts and Songs hold audio files.
- Item: title, optional description, optional cover image. Duration, size and uploader are recorded automatically.
- Folders and items are manually ordered.

## 5. Upload and playback

**Upload**
1. The client asks the API for upload permission. The server checks role, file type and size.
2. The API returns a short-lived signed upload link (resumable/multipart for large files). The browser uploads **directly to storage**; the API never carries the file.
3. The client reports completion. The server verifies the object exists and matches the allowed type and size, then marks the item **Ready**. Until Ready, the item is hidden from others.
4. Abandoned or failed uploads are cleaned up automatically.
5. The UI shows a progress bar and allows retry.

**Accepted formats (version 1):** video MP4 (H.264/AAC); audio MP3 and M4A/AAC; documents PDF; images JPG, PNG, WebP. Anything else is rejected with a clear message (for example, MKV or AVI movies must be converted first, with a free tool such as HandBrake).

**Proposed size limits (to be confirmed in the plan):** video 4 GB, audio 500 MB, PDF 50 MB, image 10 MB.

**Playback:** the bucket is private. The client asks the API to play an item; the API checks the user is active and permitted, then returns a signed link valid ~1 hour. Storage supports range requests, so seeking works. The portal uses the browser's native video and audio elements with custom controls in the JBF style.

**Offline (mobile):** the app requests a signed download link per item. Downloads are resumable. The app calls a **sync endpoint** ("what changed since time T?") that returns new, edited and deleted items so the app can update its list and remove deleted entries. Files are saved to a user-visible location (iOS requires file sharing to be enabled; Android follows its scoped-storage rules — detailed in the mobile API notes).

## 6. Authentication

- Email + password. Passwords hashed with Argon2 through a vetted library.
- Short-lived access token (~15 min) + rotating, revocable refresh token stored hashed in the database.
- **Portal:** refresh token in a Secure, HttpOnly, SameSite cookie, with CSRF protection. **Mobile:** refresh token in Keychain / Keystore.
- Password rules, shown before submission: minimum 10 characters, high maximum (password managers must work), blocked if on a common-password list, no forced symbol/number rules.
- **Invite flow:** Admin enters name, email, role. A single-use link, expiring in 7 days, lets the person set a password. Admin can resend or cancel. No self-signup.
- **Forgot password:** emailed single-use link, valid 1 hour. The response is identical whether or not the email exists.
- **Sign out:** this device or all devices.
- Failed logins slow down, then temporarily lock the account and IP. Rate limits apply to login, invite and reset routes.
- When the app reconnects, a deactivated user is signed out. Already-downloaded files keep playing offline until then.

Field rules:
- Name: letters (including accented and non-Latin), spaces, hyphens, apostrophes; generous max length; no strict "what a name looks like" pattern.
- Email: validated with a well-tested library, not a hand-rolled regex.
- Validation runs on both client (fast feedback, on blur/submit) and server (authoritative). Input is never silently altered.

## 7. Audit log

**Purpose:** a complete, trustworthy record of everything that happens in the system, readable only by Admins, and easy to scan for changes.

**What is recorded**
- **Accounts and access:** sign-in success and failure, sign-out, password change and reset, invite sent / resent / cancelled / accepted, account deactivated or reactivated, role changed.
- **Content changes:** every create, edit, delete, restore and permanent purge for courses, lessons, topics, folders and media items.
- **Files:** upload started / completed / failed, file replaced.
- **Playback and downloads:** every play and every offline download, with user and item.
- **Admin actions:** viewing and exporting the audit log.

**Each entry holds:** timestamp, actor (user, role), action, target (type, id, name at the time), source (portal or mobile app, app version), IP address, request ID, and for edits the **before and after values** of each changed field.

**Integrity**
- Append-only. No edit or delete exists, for anyone. The application's database role has INSERT and SELECT on the audit table only.
- Written in the **same database transaction** as the action it records, so an action cannot succeed without its entry. (Playback/download entries are written when the signed link is issued.)
- Retained indefinitely.
- Only Admins can read it; the API rejects Staff.

**Audit screen (Admin only)**
- A table, newest first, paginated. Columns: **time, person (with role), action, target, source, plain-English summary** — for example *"Anita Rao edited the title of lesson 'Intro' from 'Intro' to 'Introduction'."*
- Actions are shown as color-coded badges so changes stand out: edits and creates in cyan, deletes and purges in red, failed sign-ins in amber, plays and downloads in grey.
- **Click any row** to open a detail drawer: the full record, a **before/after comparison with the changed fields highlighted**, IP, device and app version, request ID, and a link to the item (or "deleted" if it's in Trash).
- **Filters:** person, category (Accounts, Content, Files, Playback), specific action, target, date range, and free-text search.
- **"Changes only" is the default view.** A toggle includes plays and downloads, so routine playback doesn't bury edits.
- **History tabs:** every course, folder and item page shows that item's history, and every staff member's page shows that person's activity — both Admin-only.
- CSV export of the filtered view (the export is itself logged).

## 8. Portal UI

**Design tokens, defined once and reused by every screen**
- Colors: white page background; very pale cool-grey panels; primary cyan blue `#0E7490` for buttons, links, active states (chosen so white text on it passes AA contrast); bright cyan `#06B6D4` for non-text accents only; deep blue-slate text; red for destructive actions only; green for success only.
- Type: one family, IBM Plex Sans.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. No other values.
- One shared component set (buttons, inputs, tables, drawers, badges, nav), built once.

**Layout:** left sidebar (Dashboard, Courses, Videos, Movies, Podcasts, Songs; and for Admin only: Staff, Trash, Audit log), a top bar with search, Upload and the user menu, and a main area favoring tables and trees over card grids.

**The one deliberate design choice:** a **docked player bar** at the bottom, so people can keep media playing while they browse and organize.

**Screens:** dashboard home (counts per category, recent uploads, uploads in progress, storage used for Admin); courses (expandable lesson/topic tree, drag to reorder, inline edit); category pages (folder list, then item table); Staff (user table with status, invite, role change); Trash (restore / delete permanently); Audit log (section 7); login, accept invite, forgot/reset password; designed 404, error, empty and loading states.

**Behavior:** responsive across mobile, tablet and desktop (sidebar becomes a slide-out menu, tables stack on small screens); visible keyboard focus, AA contrast, reduced-motion support, semantic HTML and labels. Before styling each screen during the build, a short design plan is shown for approval.

## 9. Data model (entities)

Users, Invites, Refresh tokens, Password resets; Courses → Lessons → Topics → Topic attachments; Media folders, Media items (each tagged with its category); Files (storage key, type, size, status, uploader); Audit log. Content tables carry `deleted_at` for the Trash. All schema changes are versioned migrations.

## 10. Architecture and operations

**Stack**
- Web: React + TypeScript, built with Vite, deployed as static files on a CDN.
- API: NestJS (TypeScript), publishing an **OpenAPI document** that the mobile app can generate a client from.
- Database: PostgreSQL with an ORM (Prisma or Drizzle, decided in the plan) and versioned migrations.
- Storage: a private S3-compatible bucket. Cloudflare R2 vs AWS S3 to be compared on verified, current pricing before the plan is written; downloads are the main cost driver.
- Email: a transactional email service for invites and resets.
- One repository containing web, API and shared types.

**Hosting:** web on a CDN, API as one small container, managed Postgres. Separate dev and production environments. Cheapest setup that meets ~50 users, scalable without a rebuild.

**Reliability and security:** daily database backups plus one tested restore before launch; timeouts and retries on every external call; server-side validation on every field; rate limiting; secrets only in environment variables; security headers; dependency vulnerability check on every push; structured logging.

**Quality and operations:** tests concentrated on the permission rules (Staff must never be able to delete or read the audit log), plus API tests and a few end-to-end tests for login and upload; CI on every push (lint, tests, dependency audit); error tracking and uptime monitoring; a cloud budget alert before launch.

## 11. Milestones (vertical slices, in order)

1. Project setup, database, login, invites, Admin/Staff roles, **and the audit-logging foundation** so every later feature is logged from the start.
2. Staff management screens and the **Audit log screen**.
3. Media upload and playback, end to end, on **Videos**.
4. Movies, Podcasts, Songs (reusing milestone 3) and the docked player.
5. Courses, Lessons, Topics and attachments.
6. Trash, restore, and the mobile sync endpoints.
7. Hardening, utility pages, deployment.

Each milestone is built in its own session, reviewed, tested and committed before the next begins.

## 12. Out of scope for version 1

Learner accounts, progress tracking, quizzes and certificates; two-factor authentication; video transcoding; nested folders; adding or removing categories; encrypted or expiring offline downloads; multi-facility or multi-tenant support.

## 13. Open items and risks

- **Node.js is not installed on the development machine** and is required for the build.
- Mobile app framework and how it will consume the OpenAPI client: to be confirmed when milestone 1 is planned.
- Size limits (section 5) and storage provider (section 10) to be confirmed in the plan.
- Files already in a device's file manager cannot be revoked after Admin deletion or user deactivation. This is accepted for version 1.
- The portal holds staff names and emails only, and no inmate data. If that ever changes, a qualified security and compliance review is needed before real use. A security review before launch is still recommended.
