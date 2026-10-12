# Milestone 5: Courses, Lessons, Topics and attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff and Admin build Courses: a course holds lessons, a lesson holds topics, in any number and a manual order, and a topic has a plain text and any number of attachments (video, audio, PDF, image), each either uploaded into the topic or picked from the library (Videos, Movies, Podcasts, Songs). People open attachments from a two-pane course page: videos in the pop-up, audio in the docked player, PDFs in a new browser tab, images in a pop-up.

**Architecture:** Migration `0005` adds `courses`, `lessons`, `topics` and `topic_attachments` (exactly one of an uploaded file or a library item; the file unique) and the file purposes `pdf` and `image`. The kinds table in `apps/api/src/media/media-kinds.ts` gains the `pdf` and `image` kinds and an attachment kind resolver (the declared type decides the kind, there is no folder). The existing upload engine becomes generic over "the owner of a file", a library item or an attachment (`uploads.service.ts`, `remove-unfinished.ts`, `upload-cleanup.service.ts`), keeping the lock order (the owner's row before the file rows) and the conditional deletes; the cover flow becomes generic over the owner of a cover (a library item or a course) and every reorder goes through one exact-order check (`media/reorder.ts`). Courses, lessons and topics live in `apps/api/src/courses/`; the rows of attachments live next to the upload engine in `apps/api/src/media/attachments.service.ts`. On the web, `pages/courses/` holds the list, the two-pane course page (an accessible tree, the topic panel, the attachment list, the library picker and the upload dialog) and its small dialogs; the player, the pop-up player, the upload manager and the resume list are generalized, not copied.

**Tech Stack:** Unchanged: NestJS 11, Drizzle 0.45, PostgreSQL 17, zod 4, Jest + supertest (API); React 19, react-router-dom 7, Vite, Vitest + Testing Library + jsdom 30 (web). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-milestone-5-courses-design.md` (binding). It builds on `docs/superpowers/specs/2026-10-09-milestone-4-media-categories-design.md`, `docs/superpowers/specs/2026-10-08-milestone-3-videos-design.md` and the parent spec `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`; where the milestone 5 spec is silent, those apply. Milestone 1 to 4 code (as on `main`) is the baseline.

**Dry run:** Tasks 1 to 12 were each applied exactly as written to a scratch copy of the repository (a fresh clone of this branch, with a separate `_test` database) in an earlier session, task by task, running every test, the lint and the builds after each task, and doing the mutation checks the tasks describe; that is how the plan's code, expected failures and expected counts were found and corrected. The final run of that dry run was 867 API tests in 59 suites and 531 web tests in 46 files, all passing, with lint and both builds clean, and `drizzle-kit generate` reporting no schema changes. A usage limit then interrupted the work before the plan file was saved, and the plan text was written out again from those verified drafts. After that second writing, the text was checked again in a fresh clone by applying every task's code blocks and edits in order with a script that fails on a missing or non-unique anchor (Tasks 1 to 13), generating the migration with drizzle-kit, and running the whole suite once at the end: 867 API tests in 59 suites and 531 web tests in 46 files pass, lint and the API and web builds are clean, `drizzle-kit generate` prints `No schema changes, nothing to migrate`, and Task 13's documentation edits applied cleanly. What was not repeated: the per-task red-then-green runs (the "Expected: FAIL" results and the intermediate counts after each task were not re-observed in this second pass) and the mutation checks; those rest on the earlier session. The intermediate counts in each task (551, 606, 665, 723, 768, 857, 867 for the API; 405, 436, 458, 484, 531 for the web) come from that earlier pass. Nothing in the dry run used a real Cloudflare R2 bucket, a real browser or a real PDF viewer: storage was the local and in-memory drivers, and the web tests run in jsdom.

**Planned deviations from the spec (the user may overrule):**
1. **A library attachment's title is nullable.** `topic_attachments.title` is `null` for a library attachment attached without a title, and the topic then shows the library item's current title; a title given when attaching or by a rename is the attachment's own. A second check constraint (`topic_attachments_title_present`) requires a title for every uploaded attachment. Reason: the spec says both that a library attachment's title is the item's and a later edit shows in the course (§2), and that an attachment has a title that defaults to the item's title (§3); a copied title would go stale, so the default is "no title of its own".
2. **`topic_attachments` has a `duration_seconds` column** (null when unknown). Reason: `POST /topics/:id/attachments/uploads` takes `durationSeconds` and the attachment list shows lengths, but the spec's column list has no place for it.
3. **`GET /api/media/uploads/mine` entries gain `topicId`, and `folderId` can be `null`** (exactly one of them is set). Reason: the resume list must tell a library upload from an attachment upload, and the spec says that route "works unchanged" without saying how an attachment upload shows in it. The existing fields do not change.
4. **`AttachmentView` carries a little more than the spec lists** (`status`, `position`, `libraryFolderName`, `createdBy`, `createdAt`): `status` so the list shows an upload in progress, `libraryFolderName` for the dock's "Songs › folder" label. It never carries a file id, upload id or storage key; `thumbnailUrl` is a one-hour link to a library item's cover or to an uploaded image itself.
5. **Answers the spec leaves open:** the routes that change the tree (add a lesson, rename a lesson, add a topic, the lesson and topic reorders, the course edit and cover) answer the whole `CourseTree` so the page replaces its tree in one step; `PATCH /topics/:id` answers the topic; the attachment reorder answers the topic's attachments. An attachment reorder names exactly the **ready** attachments (one that is still uploading takes its place when it finishes), as the library's does.
6. **Audit targets and words.** Entries about courses, lessons, topics and attachments use the target types `course`, `courses` (the list), `lesson`, `topic` and `attachment`; the upload entries of an attachment (`file.upload_*`) have the attachment as the target, with the title as its label. New sentences put titles in single quotes (the spec's example, "Anita Rao added the PDF 'Exit map' to the topic 'Fire exits'"); the library's older sentences are unchanged. Opening a library attachment is audited with the attachment as the target, not the library item.
7. **The course list's Rename edits the title only**; the description, the cover and the text are edited on the course page (Edit course, Edit topic).

## Global Constraints

- Branch `milestone-5-courses` (already created; the spec and this plan are committed on it). Work only on this branch. Run `git status` before starting and before the final handoff. **Do not push, and do not merge to `main`**, until the user approves the milestone. Never force-push; on a conflict stop and show the user. Leave `vibe-coding-master-prompt.md` untracked.
- Environment for every shell command: `export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"`. PostgreSQL must be running (the API tests recreate `jbf_lms_test` and, in Task 1, the scratch databases `jbf_lms_migration_test` and `jbf_lms_courses_migration_test`).
- **No new dependencies.** Decisions inherited (do not undo): NestJS 11; TypeScript 6 with `module: commonjs` + `moduleResolution: bundler` (API); zod 4; drizzle-orm 0.45 (`.for('update')`, `.returning()`, conditional deletes); Jest runs serially (`--runInBand`) against one shared, recreated database, so tests create their own rows with unique names and never assume a list is empty (courses are global: a reorder test reads the whole list first); Vitest + Testing Library; the milestone 2 `Dialog` (native `<dialog>`).
- **Limits (exact):** video `video/mp4` at most `2,147,483,648` bytes; audio `audio/mpeg` and `audio/mp4` at most `524,288,000`; PDF `application/pdf` at most `52,428,800` (50 MiB); image `image/jpeg`, `image/png`, `image/webp` at most `10,485,760` (as covers). Pieces `16,777,216` bytes (16 MiB), `ceil(size / 16 MiB)` pieces (at most 128, 32, 4 and 1 for the four kinds), every piece except the last at least `5,242,880` bytes; links last 1 hour; unfinished uploads removed after 24 hours; title 1–200, course description at most 2,000, topic description at most 10,000, folder name 1–100, stored file name at most 255.
- **First-bytes checks on completion (exact):** MP4 and M4A `ftyp` at bytes 4–7; MP3 `ID3`, or byte 0 `FF` with `(byte1 & 0xE0) === 0xE0`; PDF starts with `%PDF-`; images as for covers (JPEG `FF D8 FF`, PNG signature, WebP `RIFF` ... `WEBP`). A mismatch deletes the object, aborts the upload, removes the rows, records `file.upload_failed` with reason `not_mp4`, `not_audio`, `not_pdf` or `not_image` and answers 422. The stored type must equal the declared type.
- The kind of an attachment comes from its declared type only (`attachmentKindFor`); the browser's idea of a kind is never trusted. Storage keys are random and never user text: `videos/<uuid>`, `audio/<uuid>`, `documents/<uuid>`, `images/<uuid>`, `covers/<uuid>` (the local development driver accepts exactly these). `sanitizeFileName` exists twice (`apps/api/src/media/file-checks.ts` and `apps/web/src/uploads/sanitize-file-name.ts`); this milestone does not change it, and if anyone touches one copy the other must stay identical.
- Every endpoint needs a signed-in person (Admin or Staff). **Nothing in this milestone deletes anything**, including an attachment; the only removals are those of the upload engine (cancel, failed verification, 24-hour cleanup) and a replaced cover.
- Database change and its audit entry are written in the SAME transaction. Storage calls happen OUTSIDE transactions with best-effort compensation. **Lock order everywhere: the parent row before its children (course, lesson, topic, attachment), and an item's or attachment's row before the `files` rows.** Cancel, failure and cleanup delete conditionally (`status = 'uploading'` / `status = 'pending'`), so a ready item or attachment can never be removed by them. Completion is idempotent; an object that vanishes during verification (`head` null or `readRange` `not_found`) answers 404 or 409, never 500.
- NUL characters in text fields (titles, descriptions, file names, content types) are refused with 400.
- **Links and keys are secrets-adjacent:** no temporary link, signature, token, upload id or storage key may appear in any audit entry, log line, error message or API response other than the one that issues that link (and the list responses' one-hour cover and thumbnail links). The attachment object never carries a file id.
- Web: user text (titles, descriptions, file and folder names) only as React text, never `dangerouslySetInnerHTML`; links are never stored (no `localStorage`/`sessionStorage`) or logged; dialogs use `Dialog` with `blocked` while a request runs; everything keyboard operable with labelled fields and visible focus; AA contrast; responsive; design tokens only (this plan adds none).
- jsdom 30 facts the web tests rely on: `HTMLMediaElement.prototype.play/pause/load` are not implemented (tests that reach them stub `play` and `pause`); `currentTime`, `volume` and `muted` are settable, `duration` and `paused` are read-only; `window.open` is not implemented (tests spy on it and return a stand-in with `location`, `close` and `opener`); `<dialog>` is stubbed in `test/setup.ts`; a test that awaits an element that already exists waits on the real condition with `waitFor`, and a test that asserts absence waits for the awaited response first.
- No dead code, no unused exports or imports, no `any`, no `eslint-disable`, no `console.log` outside `apps/api/src/cli`. Commit messages `<type>: <what changed, plain language>`, first line under about 72 characters, then a blank line and the attribution trailer your session instructions require. Commit after every task.
- All milestone 1–4 tests keep passing. Each task lists the existing tests it must adapt because of a changed shape (never an assertion weakened). Test-only code lives under `apps/api/test/`.

## Review Focus

Inputs and failure modes the spec implies but a happy-path test would miss, most likely first. Each has a test in the task that owns the code.

1. **Wrong type, wrong bytes, wrong size, per kind:** unknown declared types and the aliases (`image/gif`, `application/zip`, `audio/x-m4a`, `audio/aac`, `video/quicktime`, `APPLICATION/PDF`) are 400 naming every allowed format and create nothing; each kind accepted at exactly its largest size (2 GiB, 500 MiB, 52,428,800, 10,485,760) and refused one byte more, and a size of 0 refused; a PDF declared as video, an MP3 that is a JPEG, a PDF that is an MP4 or a JPEG, a PNG that is a PDF, a JPEG that is a PNG, a WebP that is a JPEG are each discarded with their own reason and leave no rows or object; `%PDF-` alone is accepted, `%PDF`, ` %PDF-`, `%pdf-` and `%PDF1` are refused (Tasks 2, 6, 12).
2. **Races and the lock order:** two additions that wait for the same parent row still get different positions (the tests hold the parent lock; checked to fail without it); three completions at once; cancel against finish over many rounds; cleanup against finish in both orders; a cleanup that read a stale snapshot of a file that has since become ready; an object that vanishes before the size check, between the size check and the first-bytes read, or while a cancel runs; a database failure while an upload starts aborts the multipart upload (Tasks 4, 5, 6, 7).
3. **Reorder exactness at every level:** an order that is missing an id, repeats one, adds an unknown one, names something of another list (a lesson of another course, a topic of another lesson, an attachment of another topic, a lesson id in the course list) or, for attachments, names one that is still uploading is 409 and changes nothing; an unchanged order writes no audit entry; non-UUID ids and a body that is not a list are 400; `[]` is valid for an empty list (Tasks 3, 4, 5).
4. **A library attachment follows the library:** a later title, cover or file change of the item shows in the topic; a title given at attach time or by a rename stays the attachment's own; an item that is still uploading is refused (409), another person's unfinished item is 404; an attachment whose item is not ready cannot be opened (409, nothing audited); the same item can be attached twice (Task 5).
5. **Unfinished uploads are private:** an attachment that is still uploading is invisible to everyone but its creator in the topic, in rename, in open and in the counts; complete and cancel are for the uploader or an Admin; `GET /api/media/uploads/mine` lists both kinds of upload, newest first, with exactly one of `folderId` and `topicId` (Tasks 5, 6).
6. **The migration on existing data:** a database at migration 0004 holding a ready video with a cover, a song and an upload in progress keeps every value through 0005, the new tables are empty and constrained, the old upload can still be completed, and an old file can be attached once (Task 1).
7. **Counts and structure answers:** the course list counts lessons and topics, and the tree counts only ready attachments (a correlated subquery that silently counted nothing was found by a test; grouped queries replace it) (Tasks 3, 5).
8. **Secrets:** no key, link, upload id or file id in an attachment response, an audit entry or an error; the audit rows of an upload, a failure, a cancel, an expiry and an open are searched for them (Tasks 5, 6, 7).
9. **Text:** NUL, over-long and blank titles and descriptions are refused with the field named; hostile titles and descriptions are stored and shown as plain text everywhere, including audit sentences, the tree, the dock label and image `alt` text (Tasks 3–6, 8–12).
10. **Web behaviour that only a real interaction shows:** the tree's arrow keys, Home and End, Left and Right, Enter and Space, one Tab stop, buttons that keep their own keys; the `?topic=` deep link and a topic that is not in the course; the phone panes and the Back button; a PDF tab opened synchronously from the click (a blocked tab, a failed link closes the tab); an image that stops loading asks once for a fresh link; the library picker ignores an answer for a category the person has left; the resume list shows only this topic's uploads and asks for any allowed type; every dialog is blocked while its request runs (Tasks 8–12).
11. **Nothing that worked stops working:** every library upload, cover, cancel, cleanup and audit test passes unchanged except the listed shape changes (`topicId` in `mine`, `link` and `place` in a dock track, `belongs` in the resume list); the pop-up and the dock still ask for exactly one link per start, also under React StrictMode (Tasks 6, 11, 12).

---

## File Structure

```
apps/api/
  drizzle/0005_courses.sql                            (generated)
  drizzle/meta/0005_snapshot.json, _journal.json       (generated)
  src/
    db/schema.ts                                      file_purpose + pdf, image; attachment_kind; courses, lessons, topics, topic_attachments
    storage/storage.constants.ts, local.storage.ts    MAX_PDF_BYTES, PDF_CONTENT_TYPE; key pattern accepts documents/ and images/
    media/media-kinds.ts (+ spec)                     MEDIA_KINDS pdf and image, LibraryKind, attachmentKindFor, attachmentFieldErrors
    media/file-checks.ts (+ spec)                     hasPdfSignature, titleFromFileName
    media/reorder.ts (+ spec)                         applyOrder: the one exact-order check
    media/covers.service.ts                           the cover flow for any CoverOwner (library item, course)
    media/attachments.service.ts                      list, view, attach from the library, rename, reorder, open
    media/uploads.service.ts, uploads.controller.ts   the engine for either owner; startAttachment; mine with topicId
    media/remove-unfinished.ts, upload-cleanup.service.ts   one removal for both owners
    media/media.schemas.ts, media.module.ts           attachment schemas, shared file fields, exports
    courses/courses.schemas.ts, courses.service.ts, courses.controller.ts
    courses/lessons.service.ts, lessons.controller.ts, topics.service.ts, topics.controller.ts, attachments.controller.ts, courses.module.ts
    audit/audit.actions.ts, audit-presentation.ts     14 new actions, sentences, failure reasons
  test/
    helpers/migrations.ts, courses.ts, media.ts       scratchDatabase, courses and attachments helpers, pdfBytes
    courses-schema, courses-migration, courses, courses-covers, lessons, topics, attachments,
    attachment-uploads, attachment-cleanup (.e2e-spec.ts)
apps/web/src/
  api/courses.ts (+ spec), api/media.ts               course, lesson, topic and attachment calls; uploadCoverTo, startAttachmentUpload, PendingUpload.topicId
  uploads/limits.ts, UploadsContext.tsx               attachment kinds and checkAttachmentFile; StartInput for a topic; UploadJob.topicId
  player/PlayerContext.tsx, DockedPlayer.tsx          a track has link and place
  components/nav-items.ts, App.tsx                    Courses link and routes
  pages/media/PlayerDialog.tsx, FolderPage.tsx, PendingUploads.tsx   VideoTarget; the resume list for any owner
  pages/courses/                                      CoursesPage, CourseDialog, CoursePage, CourseOutline, TopicPanel, EditCourseDialog,
                                                      EditTopicDialog, TitleDialog, AttachmentList, LibraryPickerDialog, ImageDialog,
                                                      AddAttachmentDialog, AttachmentUploadDialog, Courses.module.css
docs/ api/courses.md; api/media.md, api/audit.md, storage.md; README.md, ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, CHANGELOG.md
```

---

## API tasks (Tasks 1–7)

### Task 1: Migration 0005 (courses, lessons, topics, attachments, the `pdf` and `image` purposes) tested on existing data

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0005_courses.sql`, `apps/api/drizzle/meta/0005_snapshot.json` (both generated), a sixth entry in `apps/api/drizzle/meta/_journal.json` (generated), `apps/api/test/helpers/migrations.ts`, `apps/api/test/courses-schema.e2e-spec.ts`, `apps/api/test/courses-migration.e2e-spec.ts`
- Test: the files above, plus the adapted `apps/api/test/media-migration.e2e-spec.ts`

**Existing tests to adapt:** `apps/api/test/media-migration.e2e-spec.ts`: the migration helpers (`recreateDatabase`, `migrateUpTo` and the database names) move to `apps/api/test/helpers/migrations.ts` so the new migration test shares them (behaviour unchanged), and the expected `file_purpose` values at the end of the first test become `['video', 'cover', 'audio', 'pdf', 'image']` because that test applies every migration after 0003, including the new one.

**Interfaces:**
- Consumes: `runMigrations` (`src/db/migrate.ts`), `createTestApp`, `createUser`, `loginMobile`, `bearer`, `putPieces`, `completeViaApi`, `mp4Bytes`, `pngBytes`, `m4aBytes` (test helpers), `PART_SIZE`, `isUniqueViolation`.
- Produces (`apps/api/src/db/schema.ts`): `filePurpose` values `['video', 'cover', 'audio', 'pdf', 'image']`; `attachmentKind` (`attachment_kind`: `video`, `audio`, `pdf`, `image`); tables `courses`, `lessons`, `topics`, `topicAttachments` (`topic_attachments`) and the types `Course`, `Lesson`, `Topic`, `TopicAttachment`. Attachment `status` reuses `mediaItemStatus` (`uploading`, `ready`). In `apps/api/test/helpers/migrations.ts`: `scratchDatabase(suffix)` returning `{ url, recreate(), drop(), migrateUpTo(lastIdx) }`.

```ts
// topic_attachments (the one source rule is a check constraint; file_id is unique)
{ id, topicId, position, kind, title /* null = follow the library item's title */, fileId | null, libraryItemId | null,
  durationSeconds | null, status, createdBy, createdAt, updatedAt }
```

- [ ] **Step 1: The shared migration helper and the adapted milestone 4 test**

Create `apps/api/test/helpers/migrations.ts`:

```ts
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

const MIGRATIONS = join(__dirname, '../../drizzle');

// A throwaway database next to the test database (named <test database without _test>_<suffix>_test), for tests that
// need a schema at an earlier migration.
export function scratchDatabase(suffix: string) {
  const base = new URL(process.env.DATABASE_URL as string);
  const name = `${base.pathname.slice(1).replace(/_test$/, '')}_${suffix}_test`;
  const databaseUrl = new URL(base);
  databaseUrl.pathname = `/${name}`;
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';

  async function drop(): Promise<void> {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  }

  async function recreate(): Promise<void> {
    await drop();
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${name}"`);
    } finally {
      await client.end();
    }
  }

  // Applies the migrations up to and including `lastIdx` from a copy of the migrations folder.
  async function migrateUpTo(lastIdx: number): Promise<void> {
    const folder = await mkdtemp(join(tmpdir(), 'jbf-migrations-'));
    try {
      const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
      const entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
      await mkdir(join(folder, 'meta'));
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) await copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      const pool = new Pool({ connectionString: databaseUrl.toString() });
      try {
        await migrate(drizzle(pool), { migrationsFolder: folder });
      } finally {
        await pool.end();
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  return { url: databaseUrl.toString(), recreate, drop, migrateUpTo };
}
```

In `apps/api/test/media-migration.e2e-spec.ts` replace the imports and helper functions at the top with the shared helper, and use it:

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import request from 'supertest';
```

with:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
```

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
import { createTestApp } from './helpers/app';
import { completeViaApi, mp4Bytes, pngBytes, putPieces } from './helpers/media';
```

with:

```ts
import { createTestApp } from './helpers/app';
import { completeViaApi, mp4Bytes, pngBytes, putPieces } from './helpers/media';
import { scratchDatabase } from './helpers/migrations';
```

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
const MIGRATIONS = join(__dirname, '../drizzle');
const base = new URL(process.env.DATABASE_URL as string);
const dbName = `${base.pathname.slice(1).replace(/_test$/, '')}_migration_test`;
const databaseUrl = new URL(base);
databaseUrl.pathname = `/${dbName}`;
const adminUrl = new URL(base);
adminUrl.pathname = '/postgres';

async function recreateDatabase(drop: boolean): Promise<void> {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    if (!drop) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

// Applies the migrations up to and including `lastIdx` from a copy of the migrations folder.
async function migrateUpTo(lastIdx: number): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'jbf-migrations-'));
  try {
    const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
    await mkdir(join(folder, 'meta'));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    const pool = new Pool({ connectionString: databaseUrl.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
```

with:

```ts
const { url: databaseUrl, recreate, drop, migrateUpTo } = scratchDatabase('migration');
```

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
    await recreateDatabase(false);
```

with:

```ts
    await recreate();
```

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
    await recreateDatabase(true);
```

with:

```ts
    await drop();
```

In `apps/api/test/media-migration.e2e-spec.ts` replace:

```ts
    expect(purposes).toEqual(['video', 'cover', 'audio']);
```

with:

```ts
    expect(purposes).toEqual(['video', 'cover', 'audio', 'pdf', 'image']);
```

(`databaseUrl.toString()` further down still works: it is now a string.)

- [ ] **Step 2: The failing schema and migration tests**

Create `apps/api/test/courses-schema.e2e-spec.ts` (the migrated test database, like `media-schema.e2e-spec.ts`):

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/db.module';
import { isUniqueViolation } from '../src/db/errors';
import { courses, files, lessons, mediaFolders, mediaItems, topicAttachments, topics } from '../src/db/schema';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

const isRejected = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, () => true);
const isRejectedAsDuplicate = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, isUniqueViolation);

describe('course tables', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  async function setup() {
    const user = await createUser(db);
    const [course] = await db.insert(courses).values({ title: 'Safety', position: 0, createdBy: user.id }).returning();
    const [lesson] = await db.insert(lessons).values({ courseId: course.id, title: 'Exits', position: 0, createdBy: user.id }).returning();
    const [topic] = await db.insert(topics).values({ lessonId: lesson.id, title: 'Fire exits', position: 0, createdBy: user.id }).returning();
    const file = async (purpose: 'pdf' | 'image' | 'video' = 'pdf') => {
      const [row] = await db
        .insert(files)
        .values({ purpose, storageKey: `documents/${randomUUID()}`, originalName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 10, uploadedBy: user.id })
        .returning();
      return row;
    };
    const [folder] = await db.insert(mediaFolders).values({ category: 'video', name: `Folder ${randomUUID()}`, position: 0, createdBy: user.id }).returning();
    const libraryItem = async () => {
      const media = await file('video');
      const [item] = await db
        .insert(mediaItems)
        .values({ folderId: folder.id, title: 'Library video', position: 0, mediaFileId: media.id, status: 'ready', createdBy: user.id })
        .returning();
      return item;
    };
    const attachment = (overrides: Partial<typeof topicAttachments.$inferInsert>) =>
      db.insert(topicAttachments).values({ topicId: topic.id, position: 0, kind: 'pdf', title: 'Exit map', status: 'ready', createdBy: user.id, ...overrides });
    return { user, course, lesson, topic, file, libraryItem, attachment };
  }

  it('stores files with the pdf and image purposes', async () => {
    const { file } = await setup();
    expect((await file('pdf')).purpose).toBe('pdf');
    expect((await file('image')).purpose).toBe('image');
  });

  it('takes an uploaded file or a library item as the source of an attachment, never both and never neither', async () => {
    const { file, libraryItem, attachment } = await setup();
    const uploaded = await file();
    const item = await libraryItem();
    expect(await isRejected(attachment({ fileId: uploaded.id }))).toBe(false);
    expect(await isRejected(attachment({ kind: 'video', title: null, libraryItemId: item.id }))).toBe(false);
    expect(await isRejected(attachment({}))).toBe(true);
    expect(await isRejected(attachment({ fileId: (await file()).id, libraryItemId: item.id }))).toBe(true);
  });

  it('refuses an uploaded attachment without a title but lets a library attachment follow its item', async () => {
    const { file, libraryItem, attachment } = await setup();
    expect(await isRejected(attachment({ fileId: (await file()).id, title: null }))).toBe(true);
    expect(await isRejected(attachment({ kind: 'audio', libraryItemId: (await libraryItem()).id, title: null }))).toBe(false);
  });

  it('refuses a second attachment for the same file and a duplicate storage key, but not a second one for the same library item', async () => {
    const { file, libraryItem, attachment } = await setup();
    const uploaded = await file();
    await attachment({ fileId: uploaded.id });
    expect(await isRejectedAsDuplicate(attachment({ fileId: uploaded.id }))).toBe(true);
    const item = await libraryItem();
    await attachment({ kind: 'video', libraryItemId: item.id, title: null });
    expect(await isRejected(attachment({ kind: 'video', libraryItemId: item.id, title: null, position: 1 }))).toBe(false);
  });

  it('stores kinds, statuses, positions and an optional length, and refuses a kind that does not exist', async () => {
    const { file, attachment, topic } = await setup();
    const [stored] = await attachment({ fileId: (await file()).id, kind: 'image', status: 'uploading', position: 4, durationSeconds: null }).returning();
    expect(stored).toMatchObject({ kind: 'image', status: 'uploading', position: 4, durationSeconds: null, topicId: topic.id });
    expect(await isRejected(attachment({ fileId: (await file()).id, kind: 'spreadsheet' as 'pdf' }))).toBe(true);
    const [again] = await db.select().from(topicAttachments).where(eq(topicAttachments.id, stored.id));
    expect(again.createdAt).toBeInstanceOf(Date);
  });

  it('keeps lessons with their course, topics with their lesson and attachments with their topic', async () => {
    const { user, course, lesson, topic, file, attachment } = await setup();
    const missing = randomUUID();
    expect(await isRejected(db.insert(lessons).values({ courseId: missing, title: 'L', position: 0, createdBy: user.id }))).toBe(true);
    expect(await isRejected(db.insert(topics).values({ lessonId: missing, title: 'T', position: 0, createdBy: user.id }))).toBe(true);
    expect(await isRejected(attachment({ topicId: missing, fileId: (await file()).id }))).toBe(true);
    await attachment({ fileId: (await file()).id });
    expect(await isRejected(db.delete(courses).where(eq(courses.id, course.id)))).toBe(true);
    expect(await isRejected(db.delete(lessons).where(eq(lessons.id, lesson.id)))).toBe(true);
    expect(await isRejected(db.delete(topics).where(eq(topics.id, topic.id)))).toBe(true);
  });

  it('lets a course point at a cover file and keeps titles that repeat', async () => {
    const { user, file } = await setup();
    const cover = await file('image');
    const [first] = await db.insert(courses).values({ title: 'Same', position: 1, coverFileId: cover.id, createdBy: user.id }).returning();
    const [second] = await db.insert(courses).values({ title: 'Same', position: 2, createdBy: user.id }).returning();
    expect(first.coverFileId).toBe(cover.id);
    expect(second.coverFileId).toBeNull();
  });
});
```

Create `apps/api/test/courses-migration.e2e-spec.ts` (a database at migration 0004 that holds a ready video with a cover, a ready song and an upload in progress):

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/db/migrate';
import type { User } from '../src/db/schema';
import { PART_SIZE } from '../src/storage/storage.constants';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { completeViaApi, m4aBytes, mp4Bytes, pngBytes, putPieces } from './helpers/media';
import { scratchDatabase } from './helpers/migrations';
import { createUser } from './helpers/users';
import type { InMemoryStorage } from './support/in-memory-storage';

const { url: databaseUrl, recreate, drop, migrateUpTo } = scratchDatabase('courses_migration');

describe('migration 0005 on a database that already holds a video with a cover, a song and an upload in progress', () => {
  const originalUrl = process.env.DATABASE_URL;
  let app: NestExpressApplication;
  let storage: InMemoryStorage;
  let sql: Pool;
  let owner: User;
  let session: Session;
  const ids = { folder: '', songFolder: '', readyItem: '', readyFile: '', cover: '', song: '', songFile: '', pendingItem: '', pendingFile: '' };

  const insertFile = async (purpose: 'video' | 'cover' | 'audio', key: string, contentType: string, size: number, pending: { uploadId: string } | null) => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into files (purpose, storage_key, original_name, content_type, size_bytes, status, upload_id, part_size, part_count, uploaded_by, completed_at)
       values ($1, $2, 'old.bin', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [purpose, key, contentType, size, pending ? 'pending' : 'ready', pending?.uploadId ?? null, pending ? PART_SIZE : null, pending ? 1 : null, owner.id, pending ? null : new Date()],
    );
    return rows[0].id;
  };

  const insertItem = async (folderId: string, title: string, fileId: string, coverId: string | null, status: 'ready' | 'uploading') => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into media_items (folder_id, title, position, media_file_id, cover_file_id, status, created_by)
       values ($1, $2, 0, $3, $4, $5, $6) returning id`,
      [folderId, title, fileId, coverId, status, owner.id],
    );
    return rows[0].id;
  };

  const insertFolder = async (category: 'video' | 'song', name: string) =>
    (await sql.query<{ id: string }>(`insert into media_folders (category, name, position, created_by) values ($1, $2, 0, $3) returning id`, [category, name, owner.id])).rows[0].id;

  beforeAll(async () => {
    await recreate();
    await migrateUpTo(4);
    process.env.DATABASE_URL = databaseUrl;
    const created = await createTestApp();
    app = created.app;
    storage = created.storage;
    sql = new Pool({ connectionString: databaseUrl });
    owner = await createUser(created.db);
    session = await loginMobile(app, owner.email);

    ids.folder = await insertFolder('video', 'Old folder');
    ids.songFolder = await insertFolder('song', 'Old songs');

    const readyKey = `videos/${randomUUID()}`;
    storage.seed(readyKey, mp4Bytes(64), 'video/mp4');
    ids.readyFile = await insertFile('video', readyKey, 'video/mp4', 64, null);
    const coverKey = `covers/${randomUUID()}`;
    storage.seed(coverKey, pngBytes(64), 'image/png');
    ids.cover = await insertFile('cover', coverKey, 'image/png', 64, null);
    ids.readyItem = await insertItem(ids.folder, 'Old ready video', ids.readyFile, ids.cover, 'ready');

    const songKey = `audio/${randomUUID()}`;
    storage.seed(songKey, m4aBytes(64), 'audio/mp4');
    ids.songFile = await insertFile('audio', songKey, 'audio/mp4', 64, null);
    ids.song = await insertItem(ids.songFolder, 'Old song', ids.songFile, null, 'ready');

    const pendingKey = `videos/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(pendingKey, 'video/mp4');
    ids.pendingFile = await insertFile('video', pendingKey, 'video/mp4', 100, { uploadId });
    ids.pendingItem = await insertItem(ids.folder, 'Old unfinished video', ids.pendingFile, null, 'uploading');

    await runMigrations(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    process.env.DATABASE_URL = originalUrl;
    await drop();
  });

  const http = () => request(app.getHttpServer());

  it('adds the purposes and the four tables and keeps every existing row as it was', async () => {
    const purposes = (await sql.query<{ value: string }>(`select unnest(enum_range(null::file_purpose))::text as value`)).rows.map((row) => row.value);
    expect(purposes).toEqual(['video', 'cover', 'audio', 'pdf', 'image']);
    const tables = (await sql.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('courses', 'lessons', 'topics', 'topic_attachments') order by table_name`)).rows;
    expect(tables.map((row) => row.table_name)).toEqual(['courses', 'lessons', 'topic_attachments', 'topics']);
    for (const table of ['courses', 'lessons', 'topics', 'topic_attachments']) {
      expect((await sql.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);
    }
    const { rows } = await sql.query(`select id, media_file_id, cover_file_id, status from media_items order by title`);
    expect(rows).toEqual([
      { id: ids.readyItem, media_file_id: ids.readyFile, cover_file_id: ids.cover, status: 'ready' },
      { id: ids.song, media_file_id: ids.songFile, cover_file_id: null, status: 'ready' },
      { id: ids.pendingItem, media_file_id: ids.pendingFile, cover_file_id: null, status: 'uploading' },
    ]);
    const kept = await sql.query(`select purpose, status from files order by purpose, status`);
    expect(kept.rows).toEqual([
      { purpose: 'video', status: 'pending' },
      { purpose: 'video', status: 'ready' },
      { purpose: 'cover', status: 'ready' },
      { purpose: 'audio', status: 'ready' },
    ]);
  });

  it('has the one-source and unique-file rules on the attachments table', async () => {
    const constraints = (await sql.query<{ conname: string }>(`select conname from pg_constraint where conrelid = 'topic_attachments'::regclass and contype = 'c' order by conname`)).rows.map(
      (row) => row.conname,
    );
    expect(constraints).toEqual(['topic_attachments_one_source', 'topic_attachments_title_present']);
    const indexes = (await sql.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'topic_attachments'`)).rows.map((row) => row.indexname);
    expect(indexes).toContain('topic_attachments_file_unique');
  });

  it('still lists and plays the old ready video with its cover and the old song', async () => {
    const list = await http().get(`/api/media/folders/${ids.folder}/items`).set(...bearer(session)).expect(200);
    expect(list.body.find((item: { id: string }) => item.id === ids.readyItem)).toMatchObject({ title: 'Old ready video', status: 'ready', sizeBytes: 64, coverUrl: expect.stringMatching(/^memory:\/\/get\//) });
    await http().post(`/api/media/items/${ids.readyItem}/play`).set(...bearer(session)).expect(200);
    const song = await http().post(`/api/media/items/${ids.song}/play`).set(...bearer(session)).expect(200);
    expect(song.body.contentType).toBe('audio/mp4');
  });

  it('can still finish the upload that was in progress before the migration', async () => {
    const parts = await putPieces(app, storage, session, ids.pendingFile, mp4Bytes(100));
    const res = await completeViaApi(app, session, ids.pendingFile, parts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.pendingItem, status: 'ready', sizeBytes: 100 });
    const { rows } = await sql.query(`select status, upload_id from files where id = $1`, [ids.pendingFile]);
    expect(rows).toEqual([{ status: 'ready', upload_id: null }]);
  });

  it('lets a new attachment point at an old library item and an old file, once', async () => {
    const { rows: course } = await sql.query<{ id: string }>(`insert into courses (title, position, created_by) values ('Safety', 0, $1) returning id`, [owner.id]);
    const { rows: lesson } = await sql.query<{ id: string }>(`insert into lessons (course_id, title, position, created_by) values ($1, 'Exits', 0, $2) returning id`, [course[0].id, owner.id]);
    const { rows: topic } = await sql.query<{ id: string }>(`insert into topics (lesson_id, title, position, created_by) values ($1, 'Fire exits', 0, $2) returning id`, [lesson[0].id, owner.id]);
    await sql.query(`insert into topic_attachments (topic_id, position, kind, library_item_id, status, created_by) values ($1, 0, 'video', $2, 'ready', $3)`, [topic[0].id, ids.readyItem, owner.id]);
    await sql.query(`insert into topic_attachments (topic_id, position, kind, title, file_id, status, created_by) values ($1, 1, 'video', 'Same file', $2, 'ready', $3)`, [topic[0].id, ids.readyFile, owner.id]);
    await expect(
      sql.query(`insert into topic_attachments (topic_id, position, kind, title, file_id, status, created_by) values ($1, 2, 'video', 'Again', $2, 'ready', $3)`, [topic[0].id, ids.readyFile, owner.id]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

Run: `npm test -w @jbf/api -- courses-schema courses-migration media-migration`
Expected: FAIL (the tables and purposes do not exist; `courses-schema` does not compile).

- [ ] **Step 3: The schema**

In `apps/api/src/db/schema.ts` add `check` to the import, extend the purpose enum and add the new enum:

In `apps/api/src/db/schema.ts` replace:

```ts
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```

with:

```ts
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```

In `apps/api/src/db/schema.ts` replace:

```ts
export const filePurpose = pgEnum('file_purpose', ['video', 'cover', 'audio']);
```

with:

```ts
export const filePurpose = pgEnum('file_purpose', ['video', 'cover', 'audio', 'pdf', 'image']);
export const attachmentKind = pgEnum('attachment_kind', ['video', 'audio', 'pdf', 'image']);
```

Add the tables after `mediaItems` and the row types at the end of the file:

In `apps/api/src/db/schema.ts`, after:

```ts
    uniqueIndex('media_items_media_file_unique').on(table.mediaFileId),
    index('media_items_folder_idx').on(table.folderId, table.position),
  ],
);
```

add:

```ts

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  position: integer('position').notNull(),
  coverFileId: uuid('cover_file_id').references(() => files.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('lessons_course_idx').on(table.courseId, table.position)],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('topics_lesson_idx').on(table.lessonId, table.position)],
);

// A file shown in a topic: uploaded into the topic (file_id) or picked from the library (library_item_id), never both.
// A library attachment keeps following its item: while title is null the item's own title is shown.
export const topicAttachments = pgTable(
  'topic_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id),
    position: integer('position').notNull(),
    kind: attachmentKind('kind').notNull(),
    title: text('title'),
    fileId: uuid('file_id').references(() => files.id),
    libraryItemId: uuid('library_item_id').references(() => mediaItems.id),
    durationSeconds: integer('duration_seconds'),
    status: mediaItemStatus('status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('topic_attachments_file_unique').on(table.fileId),
    index('topic_attachments_topic_idx').on(table.topicId, table.position),
    check('topic_attachments_one_source', sql`num_nonnulls(${table.fileId}, ${table.libraryItemId}) = 1`),
    check('topic_attachments_title_present', sql`${table.title} is not null or ${table.libraryItemId} is not null`),
  ],
);
```

In `apps/api/src/db/schema.ts`, after:

```ts
export type MediaItem = typeof mediaItems.$inferSelect;
```

add:

```ts
export type Course = typeof courses.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type TopicAttachment = typeof topicAttachments.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

```bash
cd apps/api
npx drizzle-kit generate --name=courses
cd ../..
```

Expected: `drizzle/0005_courses.sql`, `drizzle/meta/0005_snapshot.json` and a sixth journal entry with tag `0005_courses`. Read the SQL (this migration is generated, unlike 0004, because nothing is renamed). It must contain exactly the new enum, the two `ADD VALUE` statements, the four tables, their foreign keys, the two check constraints and the indexes:

```sql
CREATE TYPE "public"."attachment_kind" AS ENUM('video', 'audio', 'pdf', 'image');--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'pdf';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'image';--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"cover_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"title" text,
	"file_id" uuid,
	"library_item_id" uuid,
	"duration_seconds" integer,
	"status" "media_item_status" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_attachments_one_source" CHECK (num_nonnulls("topic_attachments"."file_id", "topic_attachments"."library_item_id") = 1),
	CONSTRAINT "topic_attachments_title_present" CHECK ("topic_attachments"."title" is not null or "topic_attachments"."library_item_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD CONSTRAINT "topic_attachments_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD CONSTRAINT "topic_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD CONSTRAINT "topic_attachments_library_item_id_media_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD CONSTRAINT "topic_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lessons_course_idx" ON "lessons" USING btree ("course_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_attachments_file_unique" ON "topic_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "topic_attachments_topic_idx" ON "topic_attachments" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "topics_lesson_idx" ON "topics" USING btree ("lesson_id","position");
```

(The order of statements and the exact constraint names come from drizzle-kit; compare the substance. If the generated file also drops or alters anything that already exists, the schema edit is wrong: fix it, never hand-edit a generated snapshot.) PostgreSQL 17 allows `ADD VALUE` inside the migrator's transaction because nothing in the same transaction uses the new values.

Then confirm the snapshot matches the schema: `(cd apps/api && npx drizzle-kit generate)` must print `No schema changes, nothing to migrate`.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (551 API tests), including the new `courses-schema` (7 tests), `courses-migration` (5 tests) and the adapted `media-migration` (4 tests). If a migration test cannot create its scratch database, the local PostgreSQL user lacks `CREATEDB`; report it rather than skipping the test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle apps/api/src/db/schema.ts apps/api/test/helpers/migrations.ts apps/api/test/media-migration.e2e-spec.ts apps/api/test/courses-schema.e2e-spec.ts apps/api/test/courses-migration.e2e-spec.ts
git commit -m "feat: add courses, lessons, topics and attachments with the pdf and image file purposes"
```


### Task 2: The kinds table gains PDF and image, the attachment kind resolver, the `%PDF-` check and the new key prefixes

**Files:**
- Modify: `apps/api/src/storage/storage.constants.ts`, `apps/api/src/storage/local.storage.ts:12`, `apps/api/src/media/file-checks.ts`, `apps/api/src/media/media-kinds.ts`, `apps/api/src/media/uploads.service.ts` (two failure messages), `apps/api/src/audit/audit-presentation.ts` (two failure reasons)
- Test: `apps/api/src/media/file-checks.spec.ts`, `apps/api/src/media/media-kinds.spec.ts`, `apps/api/src/audit/audit-presentation-media.spec.ts`, `apps/api/test/support/storage-contract.ts`, `apps/api/test/storage/local-storage.e2e-spec.ts`

**Existing tests to adapt:** none (only additions). `typeMessage` moves out of the kind rule into a table of its own (`LIBRARY_TYPE_MESSAGES`) because a PDF or an image kind never needs one (the kind of an attachment follows its declared type); `uploadFieldErrors` returns exactly the same messages as before, which the milestone 3 and 4 tests pin.

**Interfaces:**
- Consumes: `mediaCategory` and the `file_purpose` values `pdf` and `image` (Task 1, `apps/api/src/db/schema.ts`; `uploads.service.ts` stores `kind.purpose` in `files.purpose`, which is why the kind table can only grow after the enum), `MAX_VIDEO_BYTES`, `MAX_AUDIO_BYTES`, `MAX_COVER_BYTES`, `AUDIO_CONTENT_TYPES`, `COVER_CONTENT_TYPES`, `VIDEO_CONTENT_TYPE`, `partCountFor` (`storage.constants.ts`), `hasMp4Signature`, `audioMatches`, `imageMatches` (`file-checks.ts`).
- Produces:

```ts
// storage.constants.ts
MAX_PDF_BYTES = 52_428_800; PDF_CONTENT_TYPE = 'application/pdf'
// file-checks.ts
hasPdfSignature(bytes: Uint8Array): boolean            // starts with "%PDF-"
// media-kinds.ts
type MediaKind = 'video' | 'audio' | 'pdf' | 'image'    // files that can be stored
type LibraryKind = 'video' | 'audio'                    // what a library category can hold
interface KindRule { purpose: MediaKind; keyPrefix: 'videos' | 'audio' | 'documents' | 'images'; contentTypes: readonly string[];
  maxBytes: number; sizeMessage: string; failureReason: 'not_mp4' | 'not_audio' | 'not_pdf' | 'not_image';
  matches(bytes: Uint8Array, contentType: string): boolean }
const MEDIA_KINDS: Record<MediaKind, KindRule>          // gains pdf and image
interface CategoryRule { ...; kind: LibraryKind; ... }  // categories still use video and audio only
const ATTACHMENT_TYPE_MESSAGE: string
attachmentKindFor(contentType: string): MediaKind | null
attachmentFieldErrors(contentType: string, sizeBytes: number): Record<string, string[]> | null
// LocalStorage accepts keys matching ^(videos|audio|documents|images|covers)/<uuid>$
```

- [ ] **Step 1: Failing unit tests**

In `apps/api/src/media/file-checks.spec.ts` change the import line and append a block at the end of the file (the unit tests of the `%PDF-` marker):

In `apps/api/src/media/file-checks.spec.ts` replace:

```ts
import { audioMatches, hasMp3Signature, hasMp4Signature, imageMatches, sanitizeFileName } from './file-checks';
```

with:

```ts
import { audioMatches, hasMp3Signature, hasMp4Signature, hasPdfSignature, imageMatches, sanitizeFileName } from './file-checks';
```

Append to `apps/api/src/media/file-checks.spec.ts`:

```ts
describe('hasPdfSignature', () => {
  const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

  it.each([
    ['a PDF 1.7 header', ascii('%PDF-1.7\n%')],
    ['exactly the five marker bytes', ascii('%PDF-')],
  ])('accepts %s', (_name, bytes) => {
    expect(hasPdfSignature(new Uint8Array(bytes))).toBe(true);
  });

  it.each([
    ['nothing', []],
    ['an unfinished marker (%PDF)', ascii('%PDF')],
    ['a lower-case marker (%pdf-)', ascii('%pdf-1.4')],
    ['a marker one byte late', [0x20, ...ascii('%PDF-1.4')]],
    ['a marker without the dash (%PDF1)', ascii('%PDF1.4')],
    ['a JPEG', [0xff, 0xd8, 0xff, 0xe0]],
    ['a ZIP archive', [0x50, 0x4b, 0x03, 0x04]],
    ['an MP4', mp4],
  ])('refuses %s', (_name, bytes) => {
    expect(hasPdfSignature(new Uint8Array(bytes))).toBe(false);
  });
});
```

Replace the whole of `apps/api/src/media/media-kinds.spec.ts` with:

```ts
import { MAX_AUDIO_BYTES, MAX_PDF_BYTES, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';
import {
  ATTACHMENT_TYPE_MESSAGE,
  attachmentFieldErrors,
  attachmentKindFor,
  categoryFromSlug,
  kindOf,
  MEDIA_CATEGORIES,
  MEDIA_KINDS,
  uploadFieldErrors,
} from './media-kinds';

describe('media kinds and categories', () => {
  it('maps each route slug to its category and nothing else to anything', () => {
    expect(['videos', 'movies', 'podcasts', 'songs'].map(categoryFromSlug)).toEqual(['video', 'movie', 'podcast', 'song']);
    for (const slug of ['video', 'Videos', 'SONGS', 'music', '', 'constructor', '__proto__', 'toString', 'songs/']) {
      expect(categoryFromSlug(slug)).toBeNull();
    }
  });

  it('gives videos and movies the video kind, podcasts and songs the audio kind', () => {
    expect(kindOf('video')).toBe(MEDIA_KINDS.video);
    expect(kindOf('movie')).toBe(MEDIA_KINDS.video);
    expect(kindOf('podcast')).toBe(MEDIA_KINDS.audio);
    expect(kindOf('song')).toBe(MEDIA_KINDS.audio);
    expect(MEDIA_KINDS.video).toMatchObject({
      purpose: 'video',
      keyPrefix: 'videos',
      contentTypes: ['video/mp4'],
      maxBytes: 2_147_483_648,
      failureReason: 'not_mp4',
    });
    expect(MEDIA_KINDS.audio).toMatchObject({
      purpose: 'audio',
      keyPrefix: 'audio',
      contentTypes: ['audio/mpeg', 'audio/mp4'],
      maxBytes: 524_288_000,
      failureReason: 'not_audio',
    });
  });

  it('has a PDF kind and an image kind for files attached to topics, with random-key prefixes of their own', () => {
    expect(MEDIA_KINDS.pdf).toMatchObject({
      purpose: 'pdf',
      keyPrefix: 'documents',
      contentTypes: ['application/pdf'],
      maxBytes: 52_428_800,
      failureReason: 'not_pdf',
    });
    expect(MEDIA_KINDS.image).toMatchObject({
      purpose: 'image',
      keyPrefix: 'images',
      contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 10_485_760,
      failureReason: 'not_image',
    });
    expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
  });

  it('checks the first bytes of a PDF and of each image type', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]);
    expect(MEDIA_KINDS.pdf.matches(pdf, 'application/pdf')).toBe(true);
    expect(MEDIA_KINDS.pdf.matches(new Uint8Array([0xff, 0xd8, 0xff]), 'application/pdf')).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(MEDIA_KINDS.image.matches(png, 'image/png')).toBe(true);
    expect(MEDIA_KINDS.image.matches(png, 'image/jpeg')).toBe(false);
    expect(MEDIA_KINDS.image.matches(pdf, 'image/webp')).toBe(false);
  });

  it('keeps the piece arithmetic: 500 MiB is 32 pieces, 2 GiB is 128, 50 MiB is 4, 10 MiB is 1', () => {
    expect(partCountFor(MAX_AUDIO_BYTES)).toBe(32);
    expect(partCountFor(MAX_VIDEO_BYTES)).toBe(128);
    expect(partCountFor(MAX_PDF_BYTES)).toBe(4);
    expect(partCountFor(MEDIA_KINDS.image.maxBytes)).toBe(1);
  });

  it.each([
    ['song', 'audio/mpeg', 524_288_000],
    ['podcast', 'audio/mp4', 524_288_000],
    ['movie', 'video/mp4', 2_147_483_648],
    ['video', 'video/mp4', 1],
  ] as const)('accepts a %s declared as %s of %i bytes', (category, type, size) => {
    expect(uploadFieldErrors(category, type, size)).toBeNull();
  });

  it('refuses one byte over each limit with a message that names the formats', () => {
    expect(uploadFieldErrors('song', 'audio/mpeg', 524_288_001)).toEqual({ sizeBytes: ['Audio files can be at most 500 MB (MP3 or M4A).'] });
    expect(uploadFieldErrors('podcast', 'audio/mp4', 524_288_001)).toEqual({ sizeBytes: ['Audio files can be at most 500 MB (MP3 or M4A).'] });
    expect(uploadFieldErrors('movie', 'video/mp4', 2_147_483_649)).toEqual({ sizeBytes: ['Videos can be at most 2 GB (MP4).'] });
  });

  it('refuses a type of the other kind and the aliases the server does not accept', () => {
    expect(uploadFieldErrors('song', 'video/mp4', 10)).toEqual({ contentType: ['Only MP3 or M4A audio files can be uploaded here.'] });
    expect(uploadFieldErrors('video', 'audio/mpeg', 10)?.contentType?.[0]).toMatch(/MP4.*HandBrake/);
    expect(uploadFieldErrors('movie', 'audio/mp4', 10)?.contentType?.[0]).toMatch(/MP4.*HandBrake/);
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav', 'application/pdf', 'image/png']) {
      expect(uploadFieldErrors('podcast', type, 10)).toHaveProperty('contentType');
    }
    expect(uploadFieldErrors('video', 'application/pdf', 10)).toHaveProperty('contentType');
  });

  it('reports a wrong type and a wrong size together', () => {
    expect(Object.keys(uploadFieldErrors('song', 'video/mp4', 600 * 1024 ** 2) ?? {}).sort()).toEqual(['contentType', 'sizeBytes']);
  });

  it('has the words the folder labels and the audit log use', () => {
    expect(MEDIA_CATEGORIES.song).toEqual({ slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' });
    expect(MEDIA_CATEGORIES.video).toEqual({ slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' });
  });
});

describe('the kind of a file attached to a topic', () => {
  it.each([
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['audio/mp4', 'audio'],
    ['application/pdf', 'pdf'],
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['image/webp', 'image'],
  ])('follows the declared type %s to the %s kind', (type, kind) => {
    expect(attachmentKindFor(type)).toBe(kind);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/zip', 'application/x-pdf', 'APPLICATION/PDF', 'video/quicktime', 'audio/x-m4a', 'audio/aac', 'text/html', '', 'constructor', '__proto__'])(
    'knows no kind for the declared type %j',
    (type) => {
      expect(attachmentKindFor(type)).toBeNull();
    },
  );

  it.each([
    ['video/mp4', 2_147_483_648],
    ['audio/mpeg', 524_288_000],
    ['audio/mp4', 524_288_000],
    ['application/pdf', 52_428_800],
    ['image/jpeg', 10_485_760],
    ['image/png', 10_485_760],
    ['image/webp', 10_485_760],
    ['application/pdf', 1],
  ])('accepts %s of exactly %i bytes', (type, size) => {
    expect(attachmentFieldErrors(type, size)).toBeNull();
  });

  it.each([
    ['video/mp4', 2_147_483_649, 'Videos can be at most 2 GB (MP4).'],
    ['audio/mpeg', 524_288_001, 'Audio files can be at most 500 MB (MP3 or M4A).'],
    ['audio/mp4', 524_288_001, 'Audio files can be at most 500 MB (MP3 or M4A).'],
    ['application/pdf', 52_428_801, 'PDF files can be at most 50 MB.'],
    ['image/jpeg', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
    ['image/png', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
    ['image/webp', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
  ])('refuses %s one byte over its limit', (type, size, message) => {
    expect(attachmentFieldErrors(type, size)).toEqual({ sizeBytes: [message] });
  });

  it('names every allowed format when the type is unknown, whatever the size', () => {
    expect(ATTACHMENT_TYPE_MESSAGE).toBe('Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.');
    expect(attachmentFieldErrors('image/gif', 10)).toEqual({ contentType: [ATTACHMENT_TYPE_MESSAGE] });
    expect(attachmentFieldErrors('application/zip', 5 * 1024 ** 4)).toEqual({ contentType: [ATTACHMENT_TYPE_MESSAGE] });
  });
});
```

In `apps/api/src/audit/audit-presentation-media.spec.ts` add the two new failure reasons to the reasons table:

In `apps/api/src/audit/audit-presentation-media.spec.ts` replace:

```ts
    ['not_audio', 'the file is not a valid MP3 or M4A'],
```

with:

```ts
    ['not_audio', 'the file is not a valid MP3 or M4A'],
    ['not_pdf', 'the file is not a valid PDF'],
    ['not_image', 'the file is not a valid JPEG, PNG or WebP image'],
```

In `apps/api/test/support/storage-contract.ts` widen the key helper and add a case that stores and serves a document and an image:

In `apps/api/test/support/storage-contract.ts` replace:

```ts
const newKey = (prefix: 'videos' | 'covers' | 'audio' = 'videos'): string => `${prefix}/${randomUUID()}`;
```

with:

```ts
const newKey = (prefix: 'videos' | 'covers' | 'audio' | 'documents' | 'images' = 'videos'): string => `${prefix}/${randomUUID()}`;
```

In `apps/api/test/support/storage-contract.ts`, after:

```ts
      expect(Array.from(read.body)).toEqual(Array.from(bytes));
    });
```

add:

```ts

    it.each([
      ['documents', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 1]],
      ['images', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ] as const)('stores and serves a file under a %s/ key', async (prefix, contentType, content) => {
      const { storage } = harness;
      const key = newKey(prefix);
      const bytes = new Uint8Array(content);
      const uploadId = await storage.createMultipartUpload(key, contentType);
      const piece = await uploadPiece(key, uploadId, 1, bytes);
      await storage.completeMultipartUpload(key, uploadId, [piece]);
      expect(await storage.head(key)).toEqual({ size: bytes.length, contentType });
      const read = await harness.get(await storage.presignGet(key, 3600, { contentType }));
      expect(read.status).toBe(200);
      expect(read.contentType).toMatch(new RegExp(`^${contentType}`));
      expect(Array.from(read.body)).toEqual(Array.from(bytes));
    });
```

In `apps/api/test/storage/local-storage.e2e-spec.ts`, inside `describe('LocalStorage development routes', ...)`, after the audio-keys case:

In `apps/api/test/storage/local-storage.e2e-spec.ts` replace:

```ts
    await expect(storage.createMultipartUpload('audio/not-a-uuid', 'audio/mpeg')).rejects.toThrow('Invalid storage key');
  });
```

with:

```ts
    await expect(storage.createMultipartUpload('audio/not-a-uuid', 'audio/mpeg')).rejects.toThrow('Invalid storage key');
  });

  it.each([
    ['documents', 'application/pdf'],
    ['images', 'image/png'],
  ])('accepts %s keys and refuses look-alikes that could escape or are not exact', async (prefix, contentType) => {
    const k = `${prefix}/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(k, contentType);
    await storage.abortMultipartUpload(k, uploadId);
    await expect(storage.head(`${prefix}/../videos/x`)).rejects.toThrow('Invalid storage key');
    await expect(storage.presignGet(`${prefix}/${randomUUID()}/../../x`, 60, { contentType })).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`${prefix.slice(0, -1)}/${randomUUID()}`, contentType)).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`${prefix.toUpperCase()}/${randomUUID()}`, contentType)).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`${prefix}/not-a-uuid`, contentType)).rejects.toThrow('Invalid storage key');
  });
```

Run: `npm test -w @jbf/api -- file-checks media-kinds audit-presentation local-storage in-memory-storage`
Expected: FAIL (`hasPdfSignature`, `MEDIA_KINDS.pdf`, `attachmentKindFor`, the two failure reasons and the new key prefixes do not exist yet).

- [ ] **Step 2: Constants, the `%PDF-` check, the local key pattern and the failure wording**

In `apps/api/src/storage/storage.constants.ts` add the two lines after the audio types:

In `apps/api/src/storage/storage.constants.ts`, after:

```ts
export const AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4'] as const;
```

add:

```ts
export const MAX_PDF_BYTES = 50 * 1024 ** 2;
export const PDF_CONTENT_TYPE = 'application/pdf';
```

In `apps/api/src/media/file-checks.ts`, before the audio check:

In `apps/api/src/media/file-checks.ts`, before:

```ts
// MP3 by its own signature. An M4A is an MP4 container, so it starts with the same "ftyp" box as a video; the declared
// type and the folder's category decide what is accepted.
```

add:

```ts
// A PDF starts with the marker "%PDF-" (followed by the version, for example "%PDF-1.7").
export const hasPdfSignature = (bytes: Uint8Array): boolean => startsWith(bytes, 0, ascii('%PDF-'));

```

In `apps/api/src/storage/local.storage.ts` line 12:

In `apps/api/src/storage/local.storage.ts` replace:

```ts
const KEY_PATTERN = new RegExp(`^(videos|audio|covers)/${UUID}$`);
```

with:

```ts
const KEY_PATTERN = new RegExp(`^(videos|audio|documents|images|covers)/${UUID}$`);
```

In `apps/api/src/media/uploads.service.ts` the failure reasons are the keys of the message table, so the two new reasons need their messages (the upload engine uses them for attachments in Task 6):

In `apps/api/src/media/uploads.service.ts`, after:

```ts
  not_audio: 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.',
```

add:

```ts
  not_pdf: 'That file is not a valid PDF, so it was discarded. Please choose another file.',
  not_image: 'That file is not a valid JPEG, PNG or WebP image, so it was discarded. Please choose another file.',
```

In `apps/api/src/audit/audit-presentation.ts` explain them in the audit sentences:

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
  not_audio: 'the file is not a valid MP3 or M4A',
```

add:

```ts
  not_pdf: 'the file is not a valid PDF',
  not_image: 'the file is not a valid JPEG, PNG or WebP image',
```

- [ ] **Step 3: The kinds table**

Replace the whole of `apps/api/src/media/media-kinds.ts` with:

```ts
import type { mediaCategory } from '../db/schema';
import {
  AUDIO_CONTENT_TYPES,
  COVER_CONTENT_TYPES,
  MAX_AUDIO_BYTES,
  MAX_COVER_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  PDF_CONTENT_TYPE,
  VIDEO_CONTENT_TYPE,
} from '../storage/storage.constants';
import { audioMatches, hasMp4Signature, hasPdfSignature, imageMatches } from './file-checks';

export type MediaCategory = (typeof mediaCategory.enumValues)[number];
// The kinds of file the portal stores. A library category holds videos or audio; a file attached to a topic can also be a
// PDF or an image.
export type MediaKind = 'video' | 'audio' | 'pdf' | 'image';
export type LibraryKind = 'video' | 'audio';

// What may be uploaded as a file of this kind, and how a finished upload is checked.
export interface KindRule {
  // The files.purpose of the main file, and the prefix of its random storage key.
  purpose: MediaKind;
  keyPrefix: 'videos' | 'audio' | 'documents' | 'images';
  contentTypes: readonly string[];
  maxBytes: number;
  sizeMessage: string;
  // Recorded in file.upload_failed when the first bytes do not match the declared type.
  failureReason: 'not_mp4' | 'not_audio' | 'not_pdf' | 'not_image';
  matches: (bytes: Uint8Array, contentType: string) => boolean;
}

// The web app keeps a matching table for its file picker (apps/web/src/uploads/limits.ts); this one is the rule.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    purpose: 'video',
    keyPrefix: 'videos',
    contentTypes: [VIDEO_CONTENT_TYPE],
    maxBytes: MAX_VIDEO_BYTES,
    sizeMessage: 'Videos can be at most 2 GB (MP4).',
    failureReason: 'not_mp4',
    matches: (bytes) => hasMp4Signature(bytes),
  },
  audio: {
    purpose: 'audio',
    keyPrefix: 'audio',
    contentTypes: AUDIO_CONTENT_TYPES,
    maxBytes: MAX_AUDIO_BYTES,
    sizeMessage: 'Audio files can be at most 500 MB (MP3 or M4A).',
    failureReason: 'not_audio',
    matches: audioMatches,
  },
  pdf: {
    purpose: 'pdf',
    keyPrefix: 'documents',
    contentTypes: [PDF_CONTENT_TYPE],
    maxBytes: MAX_PDF_BYTES,
    sizeMessage: 'PDF files can be at most 50 MB.',
    failureReason: 'not_pdf',
    matches: (bytes) => hasPdfSignature(bytes),
  },
  // The same formats and limit as a cover image.
  image: {
    purpose: 'image',
    keyPrefix: 'images',
    contentTypes: COVER_CONTENT_TYPES,
    maxBytes: MAX_COVER_BYTES,
    sizeMessage: 'Images can be at most 10 MB (JPEG, PNG or WebP).',
    failureReason: 'not_image',
    matches: imageMatches,
  },
};

// What a library upload says when the declared type is not one the folder's kind accepts.
const LIBRARY_TYPE_MESSAGES: Record<LibraryKind, string> = {
  video: 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).',
  audio: 'Only MP3 or M4A audio files can be uploaded here.',
};

export interface CategoryRule {
  // The route slug: /api/media/<slug>/folders.
  slug: 'videos' | 'movies' | 'podcasts' | 'songs';
  kind: LibraryKind;
  // Words for sentences ("the song", "the songs") and labels ("Song folders").
  noun: string;
  nounPlural: string;
  label: string;
}

export const MEDIA_CATEGORIES: Record<MediaCategory, CategoryRule> = {
  video: { slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' },
  movie: { slug: 'movies', kind: 'video', noun: 'movie', nounPlural: 'movies', label: 'Movie' },
  podcast: { slug: 'podcasts', kind: 'audio', noun: 'podcast', nounPlural: 'podcasts', label: 'Podcast' },
  song: { slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' },
};

const CATEGORY_LIST = Object.keys(MEDIA_CATEGORIES) as MediaCategory[];
const KIND_LIST = Object.keys(MEDIA_KINDS) as MediaKind[];

export const kindOf = (category: MediaCategory): KindRule => MEDIA_KINDS[MEDIA_CATEGORIES[category].kind];

// Own entries only: a slug such as "constructor" or "__proto__" is simply unknown.
export function categoryFromSlug(slug: string): MediaCategory | null {
  return CATEGORY_LIST.find((category) => MEDIA_CATEGORIES[category].slug === slug) ?? null;
}

// The problems with a declared upload for this category, by body field, in plain words; null when it is acceptable.
export function uploadFieldErrors(category: MediaCategory, contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = kindOf(category);
  const errors: Record<string, string[]> = {};
  if (!kind.contentTypes.includes(contentType)) errors.contentType = [LIBRARY_TYPE_MESSAGES[MEDIA_CATEGORIES[category].kind]];
  if (sizeBytes > kind.maxBytes) errors.sizeBytes = [kind.sizeMessage];
  return Object.keys(errors).length > 0 ? errors : null;
}

export const ATTACHMENT_TYPE_MESSAGE = 'Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.';

// An attachment has no folder to decide its kind: the declared type does. Each type belongs to exactly one kind.
export function attachmentKindFor(contentType: string): MediaKind | null {
  return KIND_LIST.find((kind) => MEDIA_KINDS[kind].contentTypes.includes(contentType)) ?? null;
}

// The problems with a declared attachment upload, by body field, in plain words; null when it is acceptable. An unknown
// type is reported alone: without a kind there is no limit to compare the size with.
export function attachmentFieldErrors(contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = attachmentKindFor(contentType);
  if (!kind) return { contentType: [ATTACHMENT_TYPE_MESSAGE] };
  return sizeBytes > MEDIA_KINDS[kind].maxBytes ? { sizeBytes: [MEDIA_KINDS[kind].sizeMessage] } : null;
}
```

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (606 API tests), including the new `file-checks`, `media-kinds`, contract (both drivers) and local-storage cases. `attachmentKindFor`, `attachmentFieldErrors` and `MEDIA_KINDS.pdf/image` are consumed by Tasks 5–7; lint does not flag unused exports.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage apps/api/src/media apps/api/src/audit apps/api/test/support apps/api/test/storage
git commit -m "feat: add the PDF and image kinds, the attachment kind resolver and document and image storage keys"
```


### Task 3: Courses API: list, create, reorder, the tree, edit and the cover, with their audit entries

**Files:**
- Create: `apps/api/src/media/reorder.ts` (+ `reorder.spec.ts`), `apps/api/src/courses/courses.schemas.ts`, `apps/api/src/courses/courses.service.ts`, `apps/api/src/courses/courses.controller.ts`, `apps/api/src/courses/courses.module.ts`, `apps/api/src/audit/audit-presentation-courses.spec.ts`, `apps/api/test/helpers/courses.ts`, `apps/api/test/courses.e2e-spec.ts`, `apps/api/test/courses-covers.e2e-spec.ts`
- Modify: `apps/api/src/media/covers.service.ts` (the cover flow works for any owner of a cover), `apps/api/src/media/media.module.ts` (exports `CoversService`), `apps/api/src/app.module.ts`, `apps/api/src/audit/audit.actions.ts`, `apps/api/src/audit/audit-presentation.ts`

**Existing tests to adapt:** none. The milestone 3 and 4 cover tests (`media-covers.e2e-spec.ts`, `media-cleanup.e2e-spec.ts`, `media-audit.e2e-spec.ts`) keep passing unchanged: the library cover flow is the same code with the owner described by a small object.

**Interfaces:**
- Consumes: `CoversService`, `VisibleItem`, `ItemsService.requireVisible` (`apps/api/src/media/`), `coverStartSchema`, `orderSchema`, `titleSchema`, `descriptionSchema`, `ORDER_CHANGED_MESSAGE` (`media.schemas.ts`), `courses`, `lessons`, `topics`, `topicAttachments`, `files`, `users` (Task 1), `AuditService.record`, `actorOf`, `ZodPipe`, `CurrentUser`.
- Produces:

```ts
// media/reorder.ts
applyOrder(current: string[], ids: string[], write: (id: string, position: number) => Promise<unknown>): Promise<boolean>
//   current: the sibling ids in their present order (read in SQL); throws 409 ORDER_CHANGED_MESSAGE unless ids is exactly the same set;
//   returns false (and writes nothing) when the order is unchanged, true after writing positions 0..n-1
// media/covers.service.ts
interface CoverUpload { fileId; url; headers: { 'Content-Type': string } }
interface CoverOwner { id; title; coverFileId: string | null; targetType: string; action: AuditAction; metadata: Record<string, unknown>;
  lock(tx: DbTransaction): Promise<{ title: string; coverFileId: string | null } | null>;
  setCover(tx: DbTransaction, fileId: string, at: Date): Promise<void> }
class CoversService { start(actor, itemId, input); complete(actor, itemId, fileId): Promise<ItemView>   // as before
  newCover(actor, input): Promise<CoverUpload>; setCover(actor, owner: CoverOwner, fileId): Promise<void> }
// courses/courses.service.ts
interface CourseView { id; title; description: string | null; position; coverUrl: string | null; lessonCount; topicCount; createdBy: { id; name }; createdAt: Date }
interface TopicSummary { id; title; position; attachmentCount }            // attachmentCount counts ready attachments
interface LessonView { id; title; position; topics: TopicSummary[] }
interface CourseTree { id; title; description; position; coverUrl; createdBy; createdAt; lessons: LessonView[] }
// The counts are read with grouped queries, not correlated subqueries: inside a single-table select drizzle leaves columns unqualified,
// and an unqualified id in a subquery silently means the subquery's own table.
class CoursesService { list(): Promise<CourseView[]>; create(actor, input): Promise<CourseView>; reorder(actor, ids): Promise<CourseView[]>;
  tree(id, executor?): Promise<CourseTree>; update(actor, id, input): Promise<CourseTree>;
  startCover(actor, id, input); completeCover(actor, id, fileId): Promise<CourseTree> }
// HTTP: GET/POST /api/courses, PUT /api/courses/order, GET/PATCH /api/courses/:id,
//       POST /api/courses/:id/cover, POST /api/courses/:id/cover/:fileId/complete
// Audit: content.course.created (target course), .edited (changes), .reordered (target courses), .cover_set (target course)
// test/helpers/courses.ts
createCourseViaApi(app, session, body?): Promise<CourseBody>; attachCourseCoverViaApi(app, storage, session, courseId): Promise<string>
seedLesson(db, courseId, createdBy, title?, position?): Promise<Lesson>; seedTopic(db, lessonId, createdBy, title?, position?): Promise<Topic>
```

- [ ] **Step 1: Failing tests**

Create `apps/api/src/media/reorder.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';
import { applyOrder } from './reorder';

describe('applyOrder', () => {
  const run = async (current: string[], ids: string[]) => {
    const writes: [string, number][] = [];
    const changed = await applyOrder(current, ids, async (id, position) => {
      writes.push([id, position]);
    });
    return { changed, writes };
  };

  it('writes every position when the order changed', async () => {
    expect(await run(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({
      changed: true,
      writes: [
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ],
    });
  });

  it('writes nothing when the order is the same', async () => {
    expect(await run(['a', 'b'], ['a', 'b'])).toEqual({ changed: false, writes: [] });
    expect(await run([], [])).toEqual({ changed: false, writes: [] });
  });

  it.each([
    ['one missing', ['a', 'b', 'c'], ['a', 'b']],
    ['one unknown', ['a', 'b'], ['a', 'b', 'x']],
    ['one swapped for an unknown', ['a', 'b'], ['a', 'x']],
    ['one repeated', ['a', 'b', 'c'], ['a', 'a', 'b']],
    ['all repeated', ['a', 'b'], ['a', 'a']],
    ['nothing for a full list', ['a'], []],
    ['something for an empty list', [], ['a']],
  ])('refuses %s without writing anything', async (_name, current, ids) => {
    const writes: string[] = [];
    await expect(applyOrder(current, ids, async (id) => void writes.push(id))).rejects.toThrow(new ConflictException(ORDER_CHANGED_MESSAGE));
    expect(writes).toEqual([]);
  });
});
```

Create `apps/api/src/audit/audit-presentation-courses.spec.ts`:

```ts
import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, type PresentableEntry, presentAudit } from './audit-presentation';

const entry = (overrides: Partial<PresentableEntry>): PresentableEntry => ({
  action: 'x',
  source: 'portal',
  actorLabel: 'anita@example.org',
  actorName: 'Anita Rao',
  targetLabel: null,
  targetName: null,
  changes: null,
  metadata: null,
  ...overrides,
});

describe('course audit presentation', () => {
  it.each([
    ['content.course.created', { targetLabel: 'Fire safety' }, 'Course created', 'change', "Anita Rao created the course 'Fire safety'"],
    ['content.course.edited', { targetLabel: 'Fire safety' }, 'Course edited', 'change', "Anita Rao edited the course 'Fire safety'"],
    ['content.course.reordered', { targetLabel: 'Courses' }, 'Courses reordered', 'neutral', 'Anita Rao changed the order of the courses'],
    ['content.course.cover_set', { targetLabel: 'Fire safety' }, 'Course cover set', 'change', "Anita Rao set the cover image of the course 'Fire safety'"],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('keeps hostile titles as plain text inside the quotes', () => {
    expect(presentAudit(entry({ action: 'content.course.created', targetLabel: '<b>x</b>\' OR 1=1' })).summary).toBe("Anita Rao created the course '<b>x</b>' OR 1=1'");
  });

  it('files the course actions under content', () => {
    const course = AUDIT_ACTIONS.filter((action) => action.startsWith('content.course.'));
    expect(course).toEqual(['content.course.created', 'content.course.edited', 'content.course.reordered', 'content.course.cover_set']);
    expect(course.every((action) => categoryOf(action) === 'content')).toBe(true);
  });
});
```

Create `apps/api/test/helpers/courses.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database } from '../../src/db/db.module';
import { type Lesson, lessons, type Topic, topics } from '../../src/db/schema';
import type { InMemoryStorage } from '../support/in-memory-storage';
import { bearer, type Session } from './auth';
import { pngBytes, uniqueName } from './media';

export interface CourseBody {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessonCount: number;
  topicCount: number;
}

export async function createCourseViaApi(app: INestApplication, session: Session, body: object = {}): Promise<CourseBody> {
  const res = await request(app.getHttpServer())
    .post('/api/courses')
    .set(...bearer(session))
    .send({ title: uniqueName('Course'), ...body })
    .expect(201);
  return res.body;
}

// Sets a real cover on a course through the cover endpoints, the way the web does.
export async function attachCourseCoverViaApi(app: INestApplication, storage: InMemoryStorage, session: Session, courseId: string): Promise<string> {
  const body = pngBytes(100);
  const started = await request(app.getHttpServer())
    .post(`/api/courses/${courseId}/cover`)
    .set(...bearer(session))
    .send({ contentType: 'image/png', sizeBytes: body.length })
    .expect(201);
  storage.putObject(started.body.url, body);
  await request(app.getHttpServer()).post(`/api/courses/${courseId}/cover/${started.body.fileId}/complete`).set(...bearer(session)).expect(200);
  return started.body.fileId;
}

export async function seedLesson(db: Database, courseId: string, createdBy: string, title = uniqueName('Lesson'), position = 0): Promise<Lesson> {
  const [lesson] = await db.insert(lessons).values({ courseId, title, position, createdBy }).returning();
  return lesson;
}

export async function seedTopic(db: Database, lessonId: string, createdBy: string, title = uniqueName('Topic'), position = 0): Promise<Topic> {
  const [topic] = await db.insert(topics).values({ lessonId, title, position, createdBy }).returning();
  return topic;
}
```

Create `apps/api/test/courses.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedLesson, seedTopic } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('courses', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const listIds = async (session: Parameters<typeof bearer>[0]) =>
    ((await http().get('/api/courses').set(...bearer(session)).expect(200)).body as { id: string }[]).map((course) => course.id);

  it('needs a signed-in person on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await http().get('/api/courses').expect(401);
    await http().post('/api/courses').send({ title: 'x' }).expect(401);
    await http().put('/api/courses/order').send({ ids: [] }).expect(401);
    await http().get(`/api/courses/${id}`).expect(401);
    await http().patch(`/api/courses/${id}`).send({ title: 'x' }).expect(401);
    await http().post(`/api/courses/${id}/cover`).send({}).expect(401);
    await http().post(`/api/courses/${id}/cover/${id}/complete`).expect(401);
  });

  describe('creating and listing', () => {
    it('creates a course at the end with trimmed text, and lists it with its counts', async () => {
      const { user, session } = await signIn(app, db);
      const before = await listIds(session);
      const created = await http()
        .post('/api/courses')
        .set(...bearer(session))
        .send({ title: '  Fire safety  ', description: '  Know the exits.\nPractise them.  ' })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        title: 'Fire safety',
        description: 'Know the exits.\nPractise them.',
        position: expect.any(Number),
        coverUrl: null,
        lessonCount: 0,
        topicCount: 0,
        createdBy: { id: user.id, name: 'Test User' },
        createdAt: expect.any(String),
      });
      const lesson = await seedLesson(db, created.body.id, user.id);
      await seedLesson(db, created.body.id, user.id, uniqueName('Lesson'), 1);
      await seedTopic(db, lesson.id, user.id);
      await seedTopic(db, lesson.id, user.id, uniqueName('Topic'), 1);
      await seedTopic(db, lesson.id, user.id, uniqueName('Topic'), 2);
      const list = (await http().get('/api/courses').set(...bearer(session)).expect(200)).body as { id: string; lessonCount: number; topicCount: number }[];
      expect(list.map((course) => course.id)).toEqual([...before, created.body.id]);
      expect(list.at(-1)).toMatchObject({ lessonCount: 2, topicCount: 3 });
      const [entry] = await auditFor('content.course.created', created.body.id);
      expect(entry).toMatchObject({ actorId: user.id, targetType: 'course', targetLabel: 'Fire safety' });
    });

    it('keeps the order of creation and lets titles repeat', async () => {
      const { session } = await signIn(app, db);
      const title = uniqueName('Same');
      const first = await createCourseViaApi(app, session, { title });
      const second = await createCourseViaApi(app, session, { title });
      expect(second.position).toBeGreaterThan(first.position);
      const ids = await listIds(session);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    it('treats an empty description as none and accepts the largest title and description', async () => {
      const { session } = await signIn(app, db);
      expect((await createCourseViaApi(app, session, { description: '   ' })).description).toBeNull();
      const longest = await createCourseViaApi(app, session, { title: 'T'.repeat(200), description: 'D'.repeat(2000) });
      expect(longest.title).toHaveLength(200);
      expect(longest.description).toHaveLength(2000);
    });

    it.each([
      ['no title', {}, 'title'],
      ['a blank title', { title: '   ' }, 'title'],
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a NUL character in the title', { title: 'Fire\u0000safety' }, 'title'],
      ['a description of 2001 characters', { title: 'Ok', description: 'D'.repeat(2001) }, 'description'],
      ['a NUL character in the description', { title: 'Ok', description: 'a\u0000b' }, 'description'],
      ['a title that is not text', { title: 5 }, 'title'],
    ])('refuses %s with the field named', async (_name, body, field) => {
      const { session } = await signIn(app, db);
      const before = await listIds(session);
      const res = await http().post('/api/courses').set(...bearer(session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await listIds(session)).toEqual(before);
    });

    it('stores hostile text as it is and returns it as plain text', async () => {
      const { session } = await signIn(app, db);
      const title = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 6)}`;
      const created = await createCourseViaApi(app, session, { title, description: '<script>alert(1)</script>' });
      expect(created).toMatchObject({ title, description: '<script>alert(1)</script>' });
      const [entry] = await auditFor('content.course.created', created.id);
      expect(entry.targetLabel).toBe(title);
    });
  });

  describe('the tree', () => {
    it('answers the course with its lessons and their topics in order, in one answer', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Tree', description: 'About trees' });
      const second = await seedLesson(db, course.id, user.id, 'Second lesson', 1);
      const first = await seedLesson(db, course.id, user.id, 'First lesson', 0);
      const t2 = await seedTopic(db, first.id, user.id, 'Topic B', 1);
      const t1 = await seedTopic(db, first.id, user.id, 'Topic A', 0);
      const res = await http().get(`/api/courses/${course.id}`).set(...bearer(session)).expect(200);
      expect(res.body).toEqual({
        id: course.id,
        title: 'Tree',
        description: 'About trees',
        position: course.position,
        coverUrl: null,
        createdBy: { id: user.id, name: 'Test User' },
        createdAt: expect.any(String),
        lessons: [
          {
            id: first.id,
            title: 'First lesson',
            position: 0,
            topics: [
              { id: t1.id, title: 'Topic A', position: 0, attachmentCount: 0 },
              { id: t2.id, title: 'Topic B', position: 1, attachmentCount: 0 },
            ],
          },
          { id: second.id, title: 'Second lesson', position: 1, topics: [] },
        ],
      });
    });

    it('is the same for every signed-in person and answers 404 or 400 for a bad id', async () => {
      const owner = await signIn(app, db);
      const other = await signIn(app, db, 'admin');
      const course = await createCourseViaApi(app, owner.session);
      await http().get(`/api/courses/${course.id}`).set(...bearer(other.session)).expect(200);
      await http().get('/api/courses/00000000-0000-4000-8000-000000000000').set(...bearer(owner.session)).expect(404);
      await http().get('/api/courses/nope').set(...bearer(owner.session)).expect(400);
    });
  });

  describe('editing', () => {
    it('changes title and description, trims them, and records before and after', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Old', description: 'Before' });
      const res = await http()
        .patch(`/api/courses/${course.id}`)
        .set(...bearer(session))
        .send({ title: '  New title ', description: ' After ' })
        .expect(200);
      expect(res.body).toMatchObject({ id: course.id, title: 'New title', description: 'After', lessons: [] });
      const [entry] = await auditFor('content.course.edited', course.id);
      expect(entry).toMatchObject({
        actorId: user.id,
        targetType: 'course',
        targetLabel: 'New title',
        changes: { title: { before: 'Old', after: 'New title' }, description: { before: 'Before', after: 'After' } },
      });
    });

    it('clears the description with an empty string and does not audit a change that changes nothing', async () => {
      const { session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Keep', description: 'Words' });
      const cleared = await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send({ description: '' }).expect(200);
      expect(cleared.body.description).toBeNull();
      expect(await auditFor('content.course.edited', course.id)).toHaveLength(1);
      await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send({ title: 'Keep', description: null }).expect(200);
      expect(await auditFor('content.course.edited', course.id)).toHaveLength(1);
    });

    it.each([
      ['an empty change', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'a\u0000b' }],
      ['a description of 2001 characters', { description: 'D'.repeat(2001) }],
      ['a NUL character in the description', { description: 'a\u0000b' }],
    ])('refuses %s and changes nothing', async (_name, body) => {
      const { session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session, { title: 'Stay', description: 'Same' });
      await http().patch(`/api/courses/${course.id}`).set(...bearer(session)).send(body).expect(400);
      const [stored] = await db.select().from(courses).where(eq(courses.id, course.id));
      expect(stored).toMatchObject({ title: 'Stay', description: 'Same' });
    });

    it('answers 404 for an unknown course and 400 for a malformed id', async () => {
      const { session } = await signIn(app, db);
      await http().patch('/api/courses/00000000-0000-4000-8000-000000000000').set(...bearer(session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/courses/nope').set(...bearer(session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the courses in the order given and records one entry', async () => {
      const { user, session } = await signIn(app, db);
      await createCourseViaApi(app, session);
      await createCourseViaApi(app, session);
      const reversed = (await listIds(session)).reverse();
      const res = await http().put('/api/courses/order').set(...bearer(session)).send({ ids: reversed }).expect(200);
      expect(res.body.map((course: { id: string }) => course.id)).toEqual(reversed);
      expect(await listIds(session)).toEqual(reversed);
      const entries = await db.select().from(auditLog).where(and(eq(auditLog.action, 'content.course.reordered'), eq(auditLog.actorId, user.id)));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ targetType: 'courses', targetId: 'courses', targetLabel: 'Courses' });
    });

    it('does not audit an order that did not change', async () => {
      const { user, session } = await signIn(app, db);
      await createCourseViaApi(app, session);
      await http().put('/api/courses/order').set(...bearer(session)).send({ ids: await listIds(session) }).expect(200);
      expect(await db.select().from(auditLog).where(and(eq(auditLog.action, 'content.course.reordered'), eq(auditLog.actorId, user.id)))).toHaveLength(0);
    });

    it('refuses an order that is missing a course, repeats one, invents one or names something that is not a course', async () => {
      const { user, session } = await signIn(app, db);
      const course = await createCourseViaApi(app, session);
      await createCourseViaApi(app, session);
      const lesson = await seedLesson(db, course.id, user.id);
      const ids = await listIds(session);
      const before = ids.join();
      const attempts: string[][] = [
        ids.slice(1),
        [...ids, randomUUID()],
        [ids[0], ...ids.slice(0, -1)],
        [...ids.slice(0, -1), lesson.id],
        [],
      ];
      for (const attempt of attempts) {
        await http().put('/api/courses/order').set(...bearer(session)).send({ ids: attempt }).expect(409);
      }
      expect((await listIds(session)).join()).toBe(before);
    });

    it('refuses a body that is not a list of ids', async () => {
      const { session } = await signIn(app, db);
      await http().put('/api/courses/order').set(...bearer(session)).send({ ids: ['nope'] }).expect(400);
      await http().put('/api/courses/order').set(...bearer(session)).send({}).expect(400);
    });
  });
});
```

Create `apps/api/test/courses-covers.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses, files } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { MAX_COVER_BYTES } from '../src/storage/storage.constants';
import { StorageError } from '../src/storage/storage.port';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { attachCourseCoverViaApi, createCourseViaApi } from './helpers/courses';
import { jpegBytes, mp4Bytes, pngBytes, signIn, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('course covers', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const courseRow = async (id: string) => (await db.select().from(courses).where(eq(courses.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const startCover = (session: Parameters<typeof bearer>[0], courseId: string, body: object) =>
    http().post(`/api/courses/${courseId}/cover`).set(...bearer(session)).send(body);
  const completeCover = (session: Parameters<typeof bearer>[0], courseId: string, fileId: string) =>
    http().post(`/api/courses/${courseId}/cover/${fileId}/complete`).set(...bearer(session));

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session);
    return { owner, other, course };
  }

  it('sets a cover end to end, shows it as a link in the list and the tree, and records it without any storage key', async () => {
    const { owner, other, course } = await setup();
    const body = pngBytes(200);
    const started = await startCover(other.session, course.id, { contentType: 'image/png', sizeBytes: body.length }).expect(201);
    expect(started.body).toEqual({ fileId: expect.any(String), url: expect.stringMatching(/^memory:\/\/put\//), headers: { 'Content-Type': 'image/png' } });
    storage.putObject(started.body.url, body);
    const done = await completeCover(other.session, course.id, started.body.fileId).expect(200);
    expect(done.body).toMatchObject({ id: course.id, coverUrl: expect.stringMatching(/^memory:\/\/get\//), lessons: [] });
    expect((await fileRow(started.body.fileId)).status).toBe('ready');
    expect((await courseRow(course.id)).coverFileId).toBe(started.body.fileId);
    const list = await http().get('/api/courses').set(...bearer(owner.session)).expect(200);
    expect(list.body.find((candidate: { id: string }) => candidate.id === course.id).coverUrl).toMatch(/^memory:\/\/get\//);
    const [entry] = await auditFor('content.course.cover_set', course.id);
    expect(entry).toMatchObject({ actorId: other.user.id, targetType: 'course', targetLabel: course.title });
    expect(JSON.stringify(entry)).not.toMatch(/covers\/|memory:/);
  });

  it.each([
    ['image/jpeg', jpegBytes],
    ['image/webp', webpBytes],
  ] as const)('accepts %s', async (contentType, make) => {
    const { owner, course } = await setup();
    const body = make(100);
    const started = await startCover(owner.session, course.id, { contentType, sizeBytes: body.length }).expect(201);
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
  });

  it('replaces an earlier cover and removes the old file and object', async () => {
    const { owner, course } = await setup();
    const first = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    const firstKey = (await fileRow(first)).storageKey;
    const second = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    expect(await fileRow(first)).toBeUndefined();
    expect(storage.has(firstKey)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBe(second);
    expect(await auditFor('content.course.cover_set', course.id)).toHaveLength(2);
  });

  it('is safe to complete twice', async () => {
    const { owner, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
    await completeCover(owner.session, course.id, started.body.fileId).expect(200);
    expect(await auditFor('content.course.cover_set', course.id)).toHaveLength(1);
  });

  it.each([
    ['an unsupported type', { contentType: 'image/gif', sizeBytes: 10 }],
    ['an empty file', { contentType: 'image/png', sizeBytes: 0 }],
    ['a file over 10 MB', { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES + 1 }],
    ['no type', { sizeBytes: 10 }],
  ])('refuses %s when starting', async (_name, body) => {
    const { owner, course } = await setup();
    await startCover(owner.session, course.id, body).expect(400);
  });

  it('accepts exactly 10 MB when starting', async () => {
    const { owner, course } = await setup();
    await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES }).expect(201);
  });

  it('discards a cover whose bytes are not the declared image type and keeps the old cover', async () => {
    const { owner, course } = await setup();
    const kept = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    const body = mp4Bytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    const key = (await fileRow(started.body.fileId)).storageKey;
    storage.putObject(started.body.url, body);
    const res = await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/JPEG, PNG or WebP/);
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBe(kept);
    expect((await auditFor('file.upload_failed', course.id))[0]).toMatchObject({ targetType: 'course', metadata: { reason: 'bad_image' } });
  });

  it('discards a cover whose size differs from the declared size', async () => {
    const { owner, course } = await setup();
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: 500 });
    storage.putObject(started.body.url, pngBytes(100));
    await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect((await auditFor('file.upload_failed', course.id))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
  });

  it('asks the browser to try again when nothing was uploaded yet, and when the object vanishes during the check', async () => {
    const { owner, course } = await setup();
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: 10 });
    const res = await completeCover(owner.session, course.id, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/not been uploaded/i);
    expect((await fileRow(started.body.fileId)).status).toBe('pending');

    const body = pngBytes(100);
    const second = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(second.body.url, body);
    const spy = jest.spyOn(storage, 'readRange').mockRejectedValueOnce(new StorageError('not_found', 'No such object.'));
    try {
      await completeCover(owner.session, course.id, second.body.fileId).expect(422);
    } finally {
      spy.mockRestore();
    }
    expect((await fileRow(second.body.fileId)).status).toBe('pending');
    await completeCover(owner.session, course.id, second.body.fileId).expect(200);
  });

  it('is limited to the uploader of the cover (or an Admin), and refuses unknown courses, foreign files and used covers', async () => {
    const { owner, other, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(other.session, course.id, started.body.fileId).expect(403);
    const admin = await signIn(app, db, 'admin');
    await completeCover(admin.session, course.id, started.body.fileId).expect(200);

    const unknown = '00000000-0000-4000-8000-000000000000';
    await startCover(owner.session, unknown, { contentType: 'image/png', sizeBytes: 5 }).expect(404);
    await completeCover(owner.session, unknown, started.body.fileId).expect(404);
    await completeCover(owner.session, course.id, unknown).expect(404);
    await completeCover(owner.session, 'nope', started.body.fileId).expect(400);

    const second = await createCourseViaApi(app, owner.session);
    await completeCover(owner.session, second.id, started.body.fileId).expect(409);
  });

  it('refuses the file of a video or an attachment in place of a cover file', async () => {
    const { owner, course } = await setup();
    const [video] = await db
      .insert(files)
      .values({ purpose: 'video', storageKey: `videos/${randomUUID()}`, originalName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 10, uploadedBy: owner.user.id })
      .returning();
    await completeCover(owner.session, course.id, video.id).expect(404);
  });

  it('removes a cover that was never finished after 24 hours, like any abandoned upload', async () => {
    const { owner, course } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, course.id, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    const key = (await fileRow(started.body.fileId)).storageKey;
    await db.update(files).set({ createdAt: new Date(Date.now() - 48 * HOUR) }).where(eq(files.id, started.body.fileId));
    await app.get(UploadCleanupService).run();
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await courseRow(course.id)).coverFileId).toBeNull();
  });

  it('never touches the cover of a course during cleanup', async () => {
    const { owner, course } = await setup();
    const cover = await attachCourseCoverViaApi(app, storage, owner.session, course.id);
    await db.update(files).set({ createdAt: new Date(Date.now() - 500 * HOUR) }).where(eq(files.id, cover));
    await app.get(UploadCleanupService).run();
    expect((await fileRow(cover)).status).toBe('ready');
    expect((await courseRow(course.id)).coverFileId).toBe(cover);
  });
});
```

Run: `npm test -w @jbf/api -- reorder audit-presentation-courses courses`
Expected: FAIL (the modules, routes, helpers and actions do not exist yet).

- [ ] **Step 2: The reorder helper**

Create `apps/api/src/media/reorder.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';

// `current` is the siblings' ids in the order they have now (read in SQL, after locking them); `ids` is the order the
// person asks for. It must contain exactly the same ids: nothing missing, nothing unknown, nothing twice, so a list that
// changed while someone was editing it is never silently reshuffled. When the order differs, `write` is called once per
// id with its new position (0, 1, 2 ...) and the answer is true; an unchanged order writes nothing and answers false.
export async function applyOrder(
  current: string[],
  ids: string[],
  write: (id: string, position: number) => Promise<unknown>,
): Promise<boolean> {
  const known = new Set(current);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new ConflictException(ORDER_CHANGED_MESSAGE);
  }
  if (ids.every((id, index) => id === current[index])) return false;
  for (const [index, id] of ids.entries()) await write(id, index);
  return true;
}
```

- [ ] **Step 3: The cover flow for any owner of a cover**

Replace the whole of `apps/api/src/media/covers.service.ts` with the same flow, describing the owner of the cover by a small object (a library item, or in this milestone a course). The behaviour for library items is unchanged:

```ts
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { AuditAction } from '../audit/audit.actions';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { imageMatches } from './file-checks';
import { type ItemView, ItemsService, type VisibleItem } from './items.service';
import type { CoverStartInput } from './media.schemas';

const NOT_UPLOADED = 'The cover image has not been uploaded yet. Try again.';
const REJECTED = 'That is not a valid JPEG, PNG or WebP image of the declared size, so it was discarded. Please choose another file.';

export interface CoverUpload {
  fileId: string;
  url: string;
  headers: { 'Content-Type': string };
}

// Whatever carries a cover image: a library item or a course. The checks and the attaching are the same; the owner says
// which row to lock, which column to set and what to write in the audit log.
export interface CoverOwner {
  id: string;
  title: string;
  coverFileId: string | null;
  // The audit target type of the owner (a category such as "song", or "course") and the entry written when a cover is set.
  targetType: string;
  action: AuditAction;
  metadata: Record<string, unknown>;
  // Locks the owner's row and returns what it holds now, or null when it is gone.
  lock: (tx: DbTransaction) => Promise<{ title: string; coverFileId: string | null } | null>;
  setCover: (tx: DbTransaction, fileId: string, at: Date) => Promise<void>;
}

const itemOwner = (item: VisibleItem): CoverOwner => ({
  id: item.id,
  title: item.title,
  coverFileId: item.coverFileId,
  targetType: item.category,
  action: 'content.video.cover_set',
  metadata: { category: item.category },
  lock: async (tx) => (await tx.select().from(mediaItems).where(eq(mediaItems.id, item.id)).for('update'))[0] ?? null,
  setCover: async (tx, fileId, at) => {
    await tx.update(mediaItems).set({ coverFileId: fileId, updatedAt: at }).where(eq(mediaItems.id, item.id));
  },
});

@Injectable()
export class CoversService {
  private readonly logger = new Logger(CoversService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
  ) {}

  async start(actor: AuthUser, itemId: string, input: CoverStartInput): Promise<CoverUpload> {
    await this.items.requireVisible(this.db, itemId, actor);
    return this.newCover(actor, input);
  }

  async complete(actor: AuthUser, itemId: string, fileId: string): Promise<ItemView> {
    const item = await this.items.requireVisible(this.db, itemId, actor);
    await this.setCover(actor, itemOwner(item), fileId);
    return this.items.view(item.id, actor);
  }

  // Step one for any owner (the caller has already found the owner): a one-time link to send the image to.
  async newCover(actor: AuthUser, input: CoverStartInput): Promise<CoverUpload> {
    const key = `covers/${randomUUID()}`;
    const url = await this.storage.presignPut(key, input.contentType, LINK_TTL_SECONDS);
    const [file] = await this.db
      .insert(files)
      .values({ purpose: 'cover', storageKey: key, originalName: 'cover', contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedBy: actor.id })
      .returning({ id: files.id });
    return { fileId: file.id, url, headers: { 'Content-Type': input.contentType } };
  }

  // Step two for any owner: check what was uploaded and make it the owner's cover.
  async setCover(actor: AuthUser, owner: CoverOwner, fileId: string): Promise<void> {
    const [file] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.purpose, 'cover')));
    if (!file) throw new NotFoundException('Cover upload not found.');
    if (file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    if (file.status === 'ready') {
      if (owner.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
      return;
    }

    const info = await this.storage.head(file.storageKey);
    if (!info) throw new UnprocessableEntityException(NOT_UPLOADED);
    if (info.size !== file.sizeBytes) return this.reject(actor, owner, file, 'size_mismatch');
    const head = await this.readHead(file.storageKey);
    if (info.contentType !== file.contentType || !imageMatches(head, file.contentType)) return this.reject(actor, owner, file, 'bad_image');
    await this.attach(actor, owner, file);
  }

  // The object can disappear between the size check and this read (for example cleanup of an abandoned cover):
  // that is the same as "not uploaded yet", not a server error.
  private async readHead(key: string): Promise<Uint8Array> {
    try {
      return await this.storage.readRange(key, 0, 15);
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not_found') throw new UnprocessableEntityException(NOT_UPLOADED);
      throw error;
    }
  }

  private async reject(actor: AuthUser, owner: CoverOwner, file: FileRow, reason: 'size_mismatch' | 'bad_image'): Promise<never> {
    const removed = await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'file.upload_failed',
        target: { type: owner.targetType, id: owner.id, label: owner.title },
        metadata: { fileId: file.id, reason },
      });
      return true;
    });
    if (removed) await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
    throw new UnprocessableEntityException(REJECTED);
  }

  // Lock order everywhere: the owner's row first (the item or the course), then the file row.
  private async attach(actor: AuthUser, owner: CoverOwner, file: FileRow): Promise<void> {
    const replaced = await this.db.transaction(async (tx) => {
      const locked = await owner.lock(tx);
      const [lockedFile] = await tx.select().from(files).where(eq(files.id, file.id)).for('update');
      if (!locked || !lockedFile) throw new NotFoundException('Cover upload not found.');
      if (lockedFile.status === 'ready') {
        if (locked.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
        return null;
      }
      const now = new Date();
      await tx.update(files).set({ status: 'ready', completedAt: now }).where(eq(files.id, file.id));
      // The owner points at the new file before the old row is deleted, so the foreign key always holds.
      await owner.setCover(tx, file.id, now);
      let old: Pick<FileRow, 'id' | 'storageKey'> | null = null;
      if (locked.coverFileId) {
        [old] = await tx.delete(files).where(eq(files.id, locked.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: owner.action,
        target: { type: owner.targetType, id: owner.id, label: locked.title },
        metadata: { fileId: file.id, ...owner.metadata },
      });
      return old;
    });
    if (replaced) await discardStoredFile(this.storage, this.logger, { id: replaced.id, storageKey: replaced.storageKey, uploadId: null });
  }
}
```

In `apps/api/src/media/media.module.ts` export the service so the courses module can use it:

In `apps/api/src/media/media.module.ts` replace:

```ts
  exports: [ItemsService],
```

with:

```ts
  exports: [CoversService, ItemsService],
```

- [ ] **Step 4: Audit actions and sentences**

In `apps/api/src/audit/audit.actions.ts`:

In `apps/api/src/audit/audit.actions.ts`, after:

```ts
  'content.video.cover_set',
```

add:

```ts
  'content.course.created',
  'content.course.edited',
  'content.course.reordered',
  'content.course.cover_set',
```

In `apps/api/src/audit/audit-presentation.ts` add a quoting helper (titles in the new sentences are quoted, as in "Anita Rao added the PDF 'Exit map' to the topic 'Fire exits'") and the four entries:

In `apps/api/src/audit/audit-presentation.ts`, before:

```ts
const SPECS: Record<AuditAction, ActionSpec> = {
```

add:

```ts
const quoted = (text: string): string => `'${text}'`;

```

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
    summary: ({ actor, target, entry }) => `${actor} set the cover image of the ${wordsFor(entry).noun} ${target}`,
  },
```

add:

```ts
  'content.course.created': {
    label: 'Course created',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} created the course ${quoted(target)}`,
  },
  'content.course.edited': {
    label: 'Course edited',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} edited the course ${quoted(target)}`,
  },
  'content.course.reordered': {
    label: 'Courses reordered',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} changed the order of the courses`,
  },
  'content.course.cover_set': {
    label: 'Course cover set',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} set the cover image of the course ${quoted(target)}`,
  },
```

- [ ] **Step 5: The courses module**

Create `apps/api/src/courses/courses.schemas.ts`:

```ts
import { z } from 'zod';
import { descriptionSchema, titleSchema } from '../media/media.schemas';

// A course has a title (1 to 200) and a description of at most 2,000 characters; an empty description means none.
export const createCourseSchema = z.object({ title: titleSchema, description: descriptionSchema.nullish() });

export const updateCourseSchema = z
  .object({ title: titleSchema.optional(), description: descriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
```

Create `apps/api/src/courses/courses.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type AuditChanges, type Course, courses, type FileRow, files, lessons, topicAttachments, topics, users } from '../db/schema';
import { actorOf } from '../media/actor';
import { type CoverOwner, type CoverUpload, CoversService } from '../media/covers.service';
import type { CoverStartInput } from '../media/media.schemas';
import { applyOrder } from '../media/reorder';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import type { CreateCourseInput, UpdateCourseInput } from './courses.schemas';

const NOT_FOUND = 'Course not found.';

interface CourseBase {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface CourseView extends CourseBase {
  lessonCount: number;
  topicCount: number;
}

export interface TopicSummary {
  id: string;
  title: string;
  position: number;
  // Ready attachments only: one that is still uploading is not part of the topic yet.
  attachmentCount: number;
}

export interface LessonView {
  id: string;
  title: string;
  position: number;
  topics: TopicSummary[];
}

// The whole course in one answer: its lessons in order, each with its topics in order.
export interface CourseTree extends CourseBase {
  lessons: LessonView[];
}

interface CourseRow {
  course: Course;
  cover: FileRow | null;
  creator: { id: string; name: string };
}

@Injectable()
export class CoursesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly covers: CoversService,
  ) {}

  async list(): Promise<CourseView[]> {
    return this.views(await this.rows(this.db, undefined));
  }

  async create(actor: AuthUser, input: CreateCourseInput): Promise<CourseView> {
    const id = await this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${courses.position}), -1) + 1`.mapWith(Number) })
        .from(courses);
      const [course] = await tx
        .insert(courses)
        .values({ title: input.title, description: input.description ?? null, position: next, createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.course.created',
        target: { type: 'course', id: course.id, label: course.title },
      });
      return course.id;
    });
    const [view] = await this.views(await this.rows(this.db, eq(courses.id, id)));
    return view;
  }

  async reorder(actor: AuthUser, ids: string[]): Promise<CourseView[]> {
    await this.db.transaction(async (tx) => {
      // Locked in id order so two people reordering at once cannot deadlock, then the order is read in SQL.
      await tx.select({ id: courses.id }).from(courses).orderBy(asc(courses.id)).for('update');
      const current = (
        await tx.select({ id: courses.id }).from(courses).orderBy(asc(courses.position), asc(courses.createdAt), asc(courses.id))
      ).map((course) => course.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(courses).set({ position, updatedAt: new Date() }).where(eq(courses.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.course.reordered',
          target: { type: 'courses', id: 'courses', label: 'Courses' },
        });
      }
    });
    return this.list();
  }

  async tree(id: string, executor: DbExecutor = this.db): Promise<CourseTree> {
    const [row] = await this.rows(executor, eq(courses.id, id));
    if (!row) throw new NotFoundException(NOT_FOUND);
    const lessonRows = await executor
      .select()
      .from(lessons)
      .where(eq(lessons.courseId, id))
      .orderBy(asc(lessons.position), asc(lessons.createdAt), asc(lessons.id));
    const topicRows =
      lessonRows.length === 0
        ? []
        : await executor
            .select()
            .from(topics)
            .where(
              inArray(
                topics.lessonId,
                lessonRows.map((lesson) => lesson.id),
              ),
            )
            .orderBy(asc(topics.position), asc(topics.createdAt), asc(topics.id));
    const attachmentCounts =
      topicRows.length === 0
        ? []
        : await executor
            .select({ topicId: topicAttachments.topicId, total: count() })
            .from(topicAttachments)
            .where(
              and(
                inArray(
                  topicAttachments.topicId,
                  topicRows.map((topic) => topic.id),
                ),
                eq(topicAttachments.status, 'ready'),
              ),
            )
            .groupBy(topicAttachments.topicId);
    const countOf = new Map(attachmentCounts.map((entry) => [entry.topicId, entry.total]));
    return {
      ...(await this.toBase(row)),
      lessons: lessonRows.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        topics: topicRows
          .filter((topic) => topic.lessonId === lesson.id)
          .map((topic) => ({ id: topic.id, title: topic.title, position: topic.position, attachmentCount: countOf.get(topic.id) ?? 0 })),
      })),
    };
  }

  async update(actor: AuthUser, id: string, input: UpdateCourseInput): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      const course = await this.requireCourse(tx, id, true);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== course.title) changes.title = { before: course.title, after: input.title };
      if (input.description !== undefined && input.description !== course.description) {
        changes.description = { before: course.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(courses).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(courses.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.course.edited',
        target: { type: 'course', id, label: input.title ?? course.title },
        changes,
      });
    });
    return this.tree(id);
  }

  async startCover(actor: AuthUser, id: string, input: CoverStartInput): Promise<CoverUpload> {
    await this.requireCourse(this.db, id);
    return this.covers.newCover(actor, input);
  }

  async completeCover(actor: AuthUser, id: string, fileId: string): Promise<CourseTree> {
    const course = await this.requireCourse(this.db, id);
    await this.covers.setCover(actor, this.coverOwner(course), fileId);
    return this.tree(id);
  }

  async requireCourse(executor: DbExecutor, id: string, lock = false): Promise<Course> {
    const query = executor.select().from(courses).where(eq(courses.id, id));
    const [course] = lock ? await query.for('update') : await query;
    if (!course) throw new NotFoundException(NOT_FOUND);
    return course;
  }

  private coverOwner(course: Course): CoverOwner {
    return {
      id: course.id,
      title: course.title,
      coverFileId: course.coverFileId,
      targetType: 'course',
      action: 'content.course.cover_set',
      metadata: {},
      lock: async (tx) => (await tx.select().from(courses).where(eq(courses.id, course.id)).for('update'))[0] ?? null,
      setCover: async (tx, fileId, at) => {
        await tx.update(courses).set({ coverFileId: fileId, updatedAt: at }).where(eq(courses.id, course.id));
      },
    };
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<CourseRow[]> {
    return executor
      .select({ course: courses, cover: files, creator: { id: users.id, name: users.name } })
      .from(courses)
      .leftJoin(files, eq(files.id, courses.coverFileId))
      .innerJoin(users, eq(users.id, courses.createdBy))
      .where(where)
      .orderBy(asc(courses.position), asc(courses.createdAt), asc(courses.id));
  }

  // The lesson and topic counts of the courses, each from one grouped query.
  private async views(rows: CourseRow[]): Promise<CourseView[]> {
    const ids = rows.map((row) => row.course.id);
    const lessonCounts =
      ids.length === 0
        ? []
        : await this.db.select({ courseId: lessons.courseId, total: count() }).from(lessons).where(inArray(lessons.courseId, ids)).groupBy(lessons.courseId);
    const topicCounts =
      ids.length === 0
        ? []
        : await this.db
            .select({ courseId: lessons.courseId, total: count() })
            .from(topics)
            .innerJoin(lessons, eq(lessons.id, topics.lessonId))
            .where(inArray(lessons.courseId, ids))
            .groupBy(lessons.courseId);
    const lessonsOf = new Map(lessonCounts.map((entry) => [entry.courseId, entry.total]));
    const topicsOf = new Map(topicCounts.map((entry) => [entry.courseId, entry.total]));
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.toBase(row)),
        lessonCount: lessonsOf.get(row.course.id) ?? 0,
        topicCount: topicsOf.get(row.course.id) ?? 0,
      })),
    );
  }

  private async toBase(row: CourseRow): Promise<CourseBase> {
    const coverUrl =
      row.cover && row.cover.status === 'ready'
        ? await this.storage.presignGet(row.cover.storageKey, LINK_TTL_SECONDS, { contentType: row.cover.contentType })
        : null;
    return {
      id: row.course.id,
      title: row.course.title,
      description: row.course.description,
      position: row.course.position,
      coverUrl,
      createdBy: row.creator,
      createdAt: row.course.createdAt,
    };
  }
}
```

Create `apps/api/src/courses/courses.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type CoverStartInput, coverStartSchema, orderSchema } from '../media/media.schemas';
import { type CreateCourseInput, createCourseSchema, type UpdateCourseInput, updateCourseSchema } from './courses.schemas';
import { type CourseTree, CoursesService, type CourseView } from './courses.service';

// Every route needs a signed-in person (Admin or Staff); there is no @Roles because both may do everything here.
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list(): Promise<CourseView[]> {
    return this.courses.list();
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createCourseSchema)) body: CreateCourseInput): Promise<CourseView> {
    return this.courses.create(actor, body);
  }

  @Put('order')
  reorder(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>): Promise<CourseView[]> {
    return this.courses.reorder(actor, body.ids);
  }

  @Get(':id')
  tree(@Param('id', ParseUUIDPipe) id: string): Promise<CourseTree> {
    return this.courses.tree(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCourseSchema)) body: UpdateCourseInput,
  ): Promise<CourseTree> {
    return this.courses.update(actor, id, body);
  }

  @Post(':id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.courses.startCover(actor, id, body);
  }

  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<CourseTree> {
    return this.courses.completeCover(actor, id, fileId);
  }
}
```

Create `apps/api/src/courses/courses.module.ts` and register it:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [AuditModule, MediaModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
```

In `apps/api/src/app.module.ts` replace:

```ts
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
```

with:

```ts
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { CoursesModule } from './courses/courses.module';
```

In `apps/api/src/app.module.ts` replace:

```ts
    MediaModule,
  ],
```

with:

```ts
    MediaModule,
    CoursesModule,
  ],
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (665 API tests), including the new `reorder`, `audit-presentation-courses`, `courses` and `courses-covers` suites and every library cover test (`media-covers`, `media-cleanup`, `media-audit`) unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: add the courses API with the tree, edit, reorder and cover"
```


### Task 4: Lessons and topics API: add, rename or edit, and reorder, with their audit entries

**Files:**
- Create: `apps/api/src/courses/lessons.service.ts`, `apps/api/src/courses/lessons.controller.ts`, `apps/api/src/courses/topics.service.ts`, `apps/api/src/courses/topics.controller.ts`, `apps/api/test/lessons.e2e-spec.ts`, `apps/api/test/topics.e2e-spec.ts`
- Modify: `apps/api/src/courses/courses.schemas.ts`, `apps/api/src/courses/courses.controller.ts`, `apps/api/src/courses/courses.module.ts`, `apps/api/src/media/media.schemas.ts` (exports `hasNoNul` and `NUL_MESSAGE`), `apps/api/src/audit/audit.actions.ts`, `apps/api/src/audit/audit-presentation.ts`, `apps/api/src/audit/audit-presentation-courses.spec.ts`, `apps/api/test/helpers/courses.ts`

**Existing tests to adapt:** none.

**Interfaces:**
- Consumes: `CoursesService.tree`, `CoursesService.requireCourse(executor, id, lock)`, `CourseTree` (Task 3), `applyOrder` (Task 3), `titleSchema`, `orderSchema` (`media.schemas.ts`), `lessons`, `topics` (Task 1).
- Produces:

```ts
// lessons.service.ts
class LessonsService { add(actor, courseId, input: { title }): Promise<CourseTree>; rename(actor, id, input): Promise<CourseTree>;
  reorder(actor, courseId, ids): Promise<CourseTree>; requireLesson(executor, id, lock?): Promise<Lesson> }
// topics.service.ts
interface TopicView { id; lessonId; courseId; title; description: string | null; position }
class TopicsService { add(actor, lessonId, input: { title; description? }): Promise<CourseTree>; edit(actor, id, input): Promise<TopicView>;
  reorder(actor, lessonId, ids): Promise<CourseTree> }
// HTTP: POST /api/courses/:id/lessons, PUT /api/courses/:id/lessons/order, PATCH /api/lessons/:id,
//       POST /api/lessons/:id/topics, PUT /api/lessons/:id/topics/order, PATCH /api/topics/:id
// Audit (all target the thing changed; metadata names the parent so the sentence can):
//   content.lesson.added   target lesson,  metadata { courseId, courseTitle }
//   content.lesson.renamed target lesson,  changes { title }, metadata { courseId }
//   content.lesson.reordered target course
//   content.topic.added    target topic,   metadata { lessonId, lessonTitle, courseId }
//   content.topic.edited   target topic,   changes { title?, description? }
//   content.topic.reordered target lesson
// test/helpers/courses.ts: whileHolding(db, lock, start); TreeBody; addLessonViaApi(app, session, courseId, title?): Promise<TreeBody>;
//   addTopicViaApi(app, session, lessonId, body?): Promise<TreeBody>
```

- [ ] **Step 1: Failing tests**

Append to `apps/api/src/audit/audit-presentation-courses.spec.ts`:

Append to `apps/api/src/audit/audit-presentation-courses.spec.ts`:

```ts
describe('lesson and topic audit presentation', () => {
  it.each([
    [
      'content.lesson.added',
      { targetLabel: 'Exits', metadata: { courseTitle: 'Fire safety' } },
      'Lesson added',
      'change',
      "Anita Rao added the lesson 'Exits' to the course 'Fire safety'",
    ],
    ['content.lesson.added', { targetLabel: 'Exits' }, 'Lesson added', 'change', "Anita Rao added the lesson 'Exits'"],
    [
      'content.lesson.renamed',
      { targetLabel: 'Exits', changes: { title: { before: 'Exist', after: 'Exits' } } },
      'Lesson renamed',
      'change',
      "Anita Rao renamed the lesson from 'Exist' to 'Exits'",
    ],
    ['content.lesson.renamed', { targetLabel: 'Exits' }, 'Lesson renamed', 'change', "Anita Rao renamed the lesson 'Exits'"],
    ['content.lesson.reordered', { targetLabel: 'Fire safety' }, 'Lessons reordered', 'neutral', "Anita Rao changed the order of the lessons in the course 'Fire safety'"],
    [
      'content.topic.added',
      { targetLabel: 'Fire exits', metadata: { lessonTitle: 'Exits' } },
      'Topic added',
      'change',
      "Anita Rao added the topic 'Fire exits' to the lesson 'Exits'",
    ],
    ['content.topic.added', { targetLabel: 'Fire exits' }, 'Topic added', 'change', "Anita Rao added the topic 'Fire exits'"],
    ['content.topic.edited', { targetLabel: 'Fire exits' }, 'Topic edited', 'change', "Anita Rao edited the topic 'Fire exits'"],
    ['content.topic.reordered', { targetLabel: 'Exits' }, 'Topics reordered', 'neutral', "Anita Rao changed the order of the topics in the lesson 'Exits'"],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('ignores parent names that are not text, including inherited object members', () => {
    for (const courseTitle of [5, null, { x: 1 }, undefined]) {
      expect(presentAudit(entry({ action: 'content.lesson.added', targetLabel: 'L', metadata: { courseTitle } })).summary).toBe("Anita Rao added the lesson 'L'");
    }
    expect(presentAudit(entry({ action: 'content.lesson.renamed', targetLabel: 'L', changes: { title: { before: 1, after: 'L' } } })).summary).toBe("Anita Rao renamed the lesson 'L'");
  });

  it('files the lesson and topic actions under content', () => {
    const structure = AUDIT_ACTIONS.filter((action) => /^content\.(lesson|topic)\./.test(action));
    expect(structure).toHaveLength(6);
    expect(structure.every((action) => categoryOf(action) === 'content')).toBe(true);
  });
});
```

Append the helpers the next tests use to `apps/api/test/helpers/courses.ts` (and import `DbTransaction` next to `Database`). `whileHolding` runs a request while a transaction holds a lock and says whether the request had finished before the lock was released: a request that takes the same lock must wait, and this pins that it does.

In `apps/api/test/helpers/courses.ts` replace:

```ts
import type { Database } from '../../src/db/db.module';
```

with:

```ts
import type { Database, DbTransaction } from '../../src/db/db.module';
```

Append to `apps/api/test/helpers/courses.ts`:

```ts
// Runs `start` (a request) while a transaction holds the lock taken by `lock`, and says whether the request had finished
// before the lock was released. A request that takes the same lock must wait: this pins that it does.
export async function whileHolding<T>(
  db: Database,
  lock: (tx: DbTransaction) => PromiseLike<unknown>,
  start: () => PromiseLike<T>,
): Promise<{ result: T; finishedWhileHeld: boolean }> {
  const state: { pending?: Promise<T>; finished: boolean; finishedWhileHeld: boolean } = { finished: false, finishedWhileHeld: false };
  await db.transaction(async (tx) => {
    await lock(tx);
    state.pending = Promise.resolve(start()).then((value) => {
      state.finished = true;
      return value;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    state.finishedWhileHeld = state.finished;
  });
  return { result: await (state.pending as Promise<T>), finishedWhileHeld: state.finishedWhileHeld };
}

export interface TreeBody {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessons: { id: string; title: string; position: number; topics: { id: string; title: string; position: number; attachmentCount: number }[] }[];
}

export async function addLessonViaApi(app: INestApplication, session: Session, courseId: string, title = uniqueName('Lesson')): Promise<TreeBody> {
  const res = await request(app.getHttpServer()).post(`/api/courses/${courseId}/lessons`).set(...bearer(session)).send({ title }).expect(201);
  return res.body;
}

export async function addTopicViaApi(app: INestApplication, session: Session, lessonId: string, body: object = {}): Promise<TreeBody> {
  const res = await request(app.getHttpServer())
    .post(`/api/lessons/${lessonId}/topics`)
    .set(...bearer(session))
    .send({ title: uniqueName('Topic'), ...body })
    .expect(201);
  return res.body;
}
```

Create `apps/api/test/lessons.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, courses, lessons } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { addLessonViaApi, createCourseViaApi, seedLesson, whileHolding } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('lessons', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const unknown = '00000000-0000-4000-8000-000000000000';

  async function setup() {
    const owner = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session);
    return { owner, course };
  }

  it('needs a signed-in person on every route', async () => {
    await http().post(`/api/courses/${unknown}/lessons`).send({ title: 'x' }).expect(401);
    await http().put(`/api/courses/${unknown}/lessons/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/lessons/${unknown}`).send({ title: 'x' }).expect(401);
  });

  describe('adding', () => {
    it('adds a lesson at the end, trimmed, and answers the whole tree', async () => {
      const { owner, course } = await setup();
      const first = await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send({ title: '  Exits  ' }).expect(201);
      expect(first.body.lessons).toEqual([{ id: expect.any(String), title: 'Exits', position: 0, topics: [] }]);
      const second = await addLessonViaApi(app, owner.session, course.id, 'Alarms');
      expect(second.lessons.map((lesson) => [lesson.title, lesson.position])).toEqual([
        ['Exits', 0],
        ['Alarms', 1],
      ]);
      const [entry] = await auditFor('content.lesson.added', second.lessons[1].id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'lesson',
        targetLabel: 'Alarms',
        metadata: { courseId: course.id, courseTitle: course.title },
      });
    });

    it('takes the course row first, so additions that wait for each other still get different positions', async () => {
      const { owner, course } = await setup();
      const add = (title: string) => http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send({ title });
      // Both requests are in flight while another transaction holds the course row. Without the row lock both would read
      // the same "next position" before waiting and write the same one.
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(courses).where(eq(courses.id, course.id)).for('update'),
        () => Promise.all([add('First'), add('Second')]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(lessons).where(eq(lessons.courseId, course.id));
      expect(stored.map((lesson) => lesson.position).sort()).toEqual([0, 1]);
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '   ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'Ex\u0000its' }],
      ['a title that is not text', { title: { x: 1 } }],
    ])('refuses %s with the field named and adds nothing', async (_name, body) => {
      const { owner, course } = await setup();
      const res = await http().post(`/api/courses/${course.id}/lessons`).set(...bearer(owner.session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty('title');
      expect(await db.select().from(lessons).where(eq(lessons.courseId, course.id))).toEqual([]);
    });

    it('accepts a title of exactly 200 characters and keeps hostile text as it is', async () => {
      const { owner, course } = await setup();
      const hostile = `<script>alert(1)</script> ${randomUUID().slice(0, 4)}`;
      const tree = await addLessonViaApi(app, owner.session, course.id, 'L'.repeat(200));
      expect(tree.lessons[0].title).toHaveLength(200);
      const second = await addLessonViaApi(app, owner.session, course.id, hostile);
      expect(second.lessons[1].title).toBe(hostile);
    });

    it('answers 404 for an unknown course and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().post(`/api/courses/${unknown}/lessons`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().post('/api/courses/nope/lessons').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('renaming', () => {
    it('renames a lesson, records before and after, and does not audit the same name', async () => {
      const { owner, course } = await setup();
      const tree = await addLessonViaApi(app, owner.session, course.id, 'Exist');
      const id = tree.lessons[0].id;
      const res = await http().patch(`/api/lessons/${id}`).set(...bearer(owner.session)).send({ title: '  Exits ' }).expect(200);
      expect(res.body.lessons[0]).toMatchObject({ id, title: 'Exits' });
      const [entry] = await auditFor('content.lesson.renamed', id);
      expect(entry).toMatchObject({ targetLabel: 'Exits', changes: { title: { before: 'Exist', after: 'Exits' } }, metadata: { courseId: course.id } });
      await http().patch(`/api/lessons/${id}`).set(...bearer(owner.session)).send({ title: 'Exits' }).expect(200);
      expect(await auditFor('content.lesson.renamed', id)).toHaveLength(1);
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character', { title: 'a\u0000b' }],
    ])('refuses %s and keeps the name', async (_name, body) => {
      const { owner, course } = await setup();
      const lesson = await seedLesson(db, course.id, owner.user.id, 'Keep');
      await http().patch(`/api/lessons/${lesson.id}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await db.select().from(lessons).where(eq(lessons.id, lesson.id)))[0].title).toBe('Keep');
    });

    it('answers 404 for an unknown lesson and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().patch(`/api/lessons/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/lessons/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the lessons in the order given, answers the tree and records one entry on the course', async () => {
      const { owner, course } = await setup();
      for (const title of ['One', 'Two', 'Three']) await addLessonViaApi(app, owner.session, course.id, title);
      const before = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string; title: string }[];
      const reversed = before.map((lesson) => lesson.id).reverse();
      const res = await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: reversed }).expect(200);
      expect(res.body.lessons.map((lesson: { title: string }) => lesson.title)).toEqual(['Three', 'Two', 'One']);
      expect(res.body.lessons.map((lesson: { position: number }) => lesson.position)).toEqual([0, 1, 2]);
      const [entry] = await auditFor('content.lesson.reordered', course.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'course', targetLabel: course.title });
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts an empty course', async () => {
      const { owner, course } = await setup();
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const tree = await addLessonViaApi(app, owner.session, course.id);
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: tree.lessons.map((lesson) => lesson.id) }).expect(200);
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(0);
    });

    it('refuses an order that is missing a lesson, repeats one, invents one or names a lesson of another course', async () => {
      const { owner, course } = await setup();
      const other = await createCourseViaApi(app, owner.session);
      const foreign = (await addLessonViaApi(app, owner.session, other.id)).lessons[0].id;
      await addLessonViaApi(app, owner.session, course.id, 'One');
      await addLessonViaApi(app, owner.session, course.id, 'Two');
      const ids = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string }[]).map((lesson) => lesson.id);
      const attempts = [ids.slice(1), [...ids, randomUUID()], [ids[0], ids[0]], [ids[0], foreign], [...ids, foreign], []];
      for (const attempt of attempts) {
        await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      const after = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons as { id: string }[];
      expect(after.map((lesson) => lesson.id)).toEqual(ids);
      expect(await auditFor('content.lesson.reordered', course.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown course, 400 for a malformed id or body', async () => {
      const { owner, course } = await setup();
      await http().put(`/api/courses/${unknown}/lessons/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/courses/nope/lessons/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/courses/${course.id}/lessons/order`).set(...bearer(owner.session)).send({ ids: ['nope'] }).expect(400);
    });
  });

  it('writes the audit sentences with the course and the old name', async () => {
    const { owner, course } = await setup();
    const admin = await signIn(app, db, 'admin');
    const name = uniqueName('Exits');
    const tree = await addLessonViaApi(app, owner.session, course.id, name);
    await http().patch(`/api/lessons/${tree.lessons[0].id}`).set(...bearer(owner.session)).send({ title: `${name} renamed` }).expect(200);
    const items = (await http().get(`/api/audit?q=${encodeURIComponent(name)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'content.lesson.added')).toMatchObject({
      label: 'Lesson added',
      summary: `Test User added the lesson '${name}' to the course '${course.title}'`,
    });
    expect(items.find((item) => item.action === 'content.lesson.renamed')).toMatchObject({
      label: 'Lesson renamed',
      summary: `Test User renamed the lesson from '${name}' to '${name} renamed'`,
    });
  });
});
```

Create `apps/api/test/topics.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, lessons, topics } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { addLessonViaApi, addTopicViaApi, createCourseViaApi, seedLesson, seedTopic, whileHolding } from './helpers/courses';
import { signIn, uniqueName } from './helpers/media';

describe('topics', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const unknown = '00000000-0000-4000-8000-000000000000';

  async function setup() {
    const owner = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    return { owner, course, lesson };
  }

  it('needs a signed-in person on every route', async () => {
    await http().post(`/api/lessons/${unknown}/topics`).send({ title: 'x' }).expect(401);
    await http().put(`/api/lessons/${unknown}/topics/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/topics/${unknown}`).send({ title: 'x' }).expect(401);
  });

  describe('adding', () => {
    it('adds a topic at the end with trimmed text and answers the whole tree', async () => {
      const { owner, course, lesson } = await setup();
      const first = await http()
        .post(`/api/lessons/${lesson.id}/topics`)
        .set(...bearer(owner.session))
        .send({ title: '  Fire exits ', description: '  Keep them clear.\nNever lock them.  ' })
        .expect(201);
      expect(first.body.id).toBe(course.id);
      expect(first.body.lessons[0].topics).toEqual([{ id: expect.any(String), title: 'Fire exits', position: 0, attachmentCount: 0 }]);
      const second = await addTopicViaApi(app, owner.session, lesson.id, { title: 'Alarms' });
      expect(second.lessons[0].topics.map((topic) => [topic.title, topic.position])).toEqual([
        ['Fire exits', 0],
        ['Alarms', 1],
      ]);
      const id = first.body.lessons[0].topics[0].id;
      const [stored] = await db.select().from(topics).where(eq(topics.id, id));
      expect(stored.description).toBe('Keep them clear.\nNever lock them.');
      const [entry] = await auditFor('content.topic.added', id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'topic',
        targetLabel: 'Fire exits',
        metadata: { lessonId: lesson.id, lessonTitle: 'Exits', courseId: course.id },
      });
    });

    it('treats an empty description as none, accepts exactly 10,000 characters and refuses one more', async () => {
      const { owner, lesson } = await setup();
      await addTopicViaApi(app, owner.session, lesson.id, { description: '   ' });
      const longest = 'D'.repeat(10_000);
      await addTopicViaApi(app, owner.session, lesson.id, { description: longest });
      const stored = await db.select().from(topics).where(eq(topics.lessonId, lesson.id));
      expect(stored.map((topic) => topic.description).sort()).toEqual([null, longest].sort());
      const res = await http()
        .post(`/api/lessons/${lesson.id}/topics`)
        .set(...bearer(owner.session))
        .send({ title: 'Too much', description: 'D'.repeat(10_001) })
        .expect(400);
      expect(res.body.fieldErrors.description[0]).toMatch(/10,000/);
      expect(await db.select().from(topics).where(eq(topics.lessonId, lesson.id))).toHaveLength(2);
    });

    it.each([
      ['no title', {}, 'title'],
      ['a blank title', { title: ' ' }, 'title'],
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a NUL character in the title', { title: 'a\u0000b' }, 'title'],
      ['a NUL character in the description', { title: 'Ok', description: 'a\u0000b' }, 'description'],
      ['a description that is not text', { title: 'Ok', description: 5 }, 'description'],
    ])('refuses %s with the field named and adds nothing', async (_name, body, field) => {
      const { owner, lesson } = await setup();
      const res = await http().post(`/api/lessons/${lesson.id}/topics`).set(...bearer(owner.session)).send(body).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await db.select().from(topics).where(eq(topics.lessonId, lesson.id))).toEqual([]);
    });

    it('takes the lesson row first, so additions that wait for each other still get different positions', async () => {
      const { owner, lesson } = await setup();
      const add = (title: string) => http().post(`/api/lessons/${lesson.id}/topics`).set(...bearer(owner.session)).send({ title });
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(lessons).where(eq(lessons.id, lesson.id)).for('update'),
        () => Promise.all([add('First'), add('Second')]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(topics).where(eq(topics.lessonId, lesson.id));
      expect(stored.map((topic) => topic.position).sort()).toEqual([0, 1]);
    });

    it('keeps hostile text as it is', async () => {
      const { owner, course, lesson } = await setup();
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      await addTopicViaApi(app, owner.session, lesson.id, { title: hostile, description: '<script>alert(1)</script>' });
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].topics[0].title).toBe(hostile);
    });

    it('answers 404 for an unknown lesson and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().post(`/api/lessons/${unknown}/topics`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().post('/api/lessons/nope/topics').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('editing', () => {
    it('changes title and description, trims them, records before and after and answers the topic', async () => {
      const { owner, course, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Old title');
      await db.update(topics).set({ description: 'Before' }).where(eq(topics.id, topic.id));
      const res = await http()
        .patch(`/api/topics/${topic.id}`)
        .set(...bearer(owner.session))
        .send({ title: '  New title ', description: '  After\nlines ' })
        .expect(200);
      expect(res.body).toEqual({ id: topic.id, lessonId: lesson.id, courseId: course.id, title: 'New title', description: 'After\nlines', position: 0 });
      const [entry] = await auditFor('content.topic.edited', topic.id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'topic',
        targetLabel: 'New title',
        changes: { title: { before: 'Old title', after: 'New title' }, description: { before: 'Before', after: 'After\nlines' } },
      });
    });

    it('clears the description with an empty string, edits one field at a time, and does not audit a change that changes nothing', async () => {
      const { owner, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Same');
      await db.update(topics).set({ description: 'Words' }).where(eq(topics.id, topic.id));
      const cleared = await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ description: '' }).expect(200);
      expect(cleared.body).toMatchObject({ title: 'Same', description: null });
      expect(await auditFor('content.topic.edited', topic.id)).toHaveLength(1);
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ title: 'Same', description: null }).expect(200);
      expect(await auditFor('content.topic.edited', topic.id)).toHaveLength(1);
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send({ title: 'Renamed' }).expect(200);
      expect((await auditFor('content.topic.edited', topic.id))[1].changes).toEqual({ title: { before: 'Same', after: 'Renamed' } });
    });

    it.each([
      ['an empty change', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character in the title', { title: 'a\u0000b' }],
      ['a description of 10,001 characters', { description: 'D'.repeat(10_001) }],
      ['a NUL character in the description', { description: 'a\u0000b' }],
    ])('refuses %s and changes nothing', async (_name, body) => {
      const { owner, lesson } = await setup();
      const topic = await seedTopic(db, lesson.id, owner.user.id, 'Stay');
      await http().patch(`/api/topics/${topic.id}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await db.select().from(topics).where(eq(topics.id, topic.id)))[0]).toMatchObject({ title: 'Stay', description: null });
    });

    it('answers 404 for an unknown topic and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().patch(`/api/topics/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/topics/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the topics in the order given, answers the tree and records one entry on the lesson', async () => {
      const { owner, course, lesson } = await setup();
      for (const title of ['One', 'Two', 'Three']) await addTopicViaApi(app, owner.session, lesson.id, { title });
      const before = (await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[];
      const reversed = before.map((topic) => topic.id).reverse();
      const res = await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: reversed }).expect(200);
      expect(res.body.lessons[0].topics.map((topic: { title: string }) => topic.title)).toEqual(['Three', 'Two', 'One']);
      const [entry] = await auditFor('content.topic.reordered', lesson.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'lesson', targetLabel: 'Exits' });
      expect(await auditFor('content.topic.reordered', lesson.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts a lesson without topics', async () => {
      const { owner, lesson } = await setup();
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const tree = await addTopicViaApi(app, owner.session, lesson.id);
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: tree.lessons[0].topics.map((topic) => topic.id) }).expect(200);
      expect(await auditFor('content.topic.reordered', lesson.id)).toHaveLength(0);
    });

    it('refuses an order that is missing a topic, repeats one, invents one or names a topic of another lesson', async () => {
      const { owner, course, lesson } = await setup();
      const sibling = await addLessonViaApi(app, owner.session, course.id, 'Other lesson');
      const foreign = (await addTopicViaApi(app, owner.session, sibling.lessons.at(-1)?.id as string)).lessons.at(-1)?.topics[0].id as string;
      await addTopicViaApi(app, owner.session, lesson.id, { title: 'One' });
      await addTopicViaApi(app, owner.session, lesson.id, { title: 'Two' });
      const ids = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[]).map((topic) => topic.id);
      const attempts = [ids.slice(1), [...ids, randomUUID()], [ids[0], ids[0]], [ids[0], foreign], [...ids, foreign], []];
      for (const attempt of attempts) {
        await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      const after = ((await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200)).body.lessons[0].topics as { id: string }[]).map((topic) => topic.id);
      expect(after).toEqual(ids);
    });

    it('answers 404 for an unknown lesson, 400 for a malformed id or body', async () => {
      const { owner, lesson } = await setup();
      await http().put(`/api/lessons/${unknown}/topics/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/lessons/nope/topics/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/lessons/${lesson.id}/topics/order`).set(...bearer(owner.session)).send({ ids: 'x' }).expect(400);
    });
  });

  it('counts the topics in the course list and writes the audit sentences with the lesson', async () => {
    const { owner, course, lesson } = await setup();
    const admin = await signIn(app, db, 'admin');
    const name = uniqueName('Fire exits');
    await addTopicViaApi(app, owner.session, lesson.id, { title: name });
    const list = (await http().get('/api/courses').set(...bearer(owner.session)).expect(200)).body as { id: string; lessonCount: number; topicCount: number }[];
    expect(list.find((candidate) => candidate.id === course.id)).toMatchObject({ lessonCount: 1, topicCount: 1 });
    const items = (await http().get(`/api/audit?q=${encodeURIComponent(name)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'content.topic.added')).toMatchObject({
      label: 'Topic added',
      summary: `Test User added the topic '${name}' to the lesson 'Exits'`,
    });
  });
});
```

Run: `npm test -w @jbf/api -- audit-presentation-courses lessons topics`
Expected: FAIL (no routes, services, actions or sentences yet).

- [ ] **Step 2: Audit actions, sentences and shared text rules**

In `apps/api/src/audit/audit.actions.ts`, after:

```ts
  'content.course.cover_set',
```

add:

```ts
  'content.lesson.added',
  'content.lesson.renamed',
  'content.lesson.reordered',
  'content.topic.added',
  'content.topic.edited',
  'content.topic.reordered',
```

In `apps/api/src/audit/audit-presentation.ts` add two small helpers next to `quoted` and the six entries after the course ones:

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
const quoted = (text: string): string => `'${text}'`;
```

add:

```ts

// A text value from the entry's metadata, or null when it is missing or not text.
const metaText = (entry: PresentableEntry, key: string): string | null => {
  const value = entry.metadata?.[key];
  return typeof value === 'string' ? value : null;
};

// "from 'a' to 'b'" for an entry that recorded a change of one text field, or null.
const changedText = (entry: PresentableEntry, field: string): { before: string; after: string } | null => {
  const { before, after } = entry.changes?.[field] ?? {};
  return typeof before === 'string' && typeof after === 'string' ? { before, after } : null;
};
```

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
    summary: ({ actor, target }) => `${actor} set the cover image of the course ${quoted(target)}`,
  },
```

add:

```ts
  'content.lesson.added': {
    label: 'Lesson added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const course = metaText(entry, 'courseTitle');
      return course ? `${actor} added the lesson ${quoted(target)} to the course ${quoted(course)}` : `${actor} added the lesson ${quoted(target)}`;
    },
  },
  'content.lesson.renamed': {
    label: 'Lesson renamed',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const title = changedText(entry, 'title');
      return title ? `${actor} renamed the lesson from ${quoted(title.before)} to ${quoted(title.after)}` : `${actor} renamed the lesson ${quoted(target)}`;
    },
  },
  'content.lesson.reordered': {
    label: 'Lessons reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the lessons in the course ${quoted(target)}`,
  },
  'content.topic.added': {
    label: 'Topic added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const lesson = metaText(entry, 'lessonTitle');
      return lesson ? `${actor} added the topic ${quoted(target)} to the lesson ${quoted(lesson)}` : `${actor} added the topic ${quoted(target)}`;
    },
  },
  'content.topic.edited': {
    label: 'Topic edited',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} edited the topic ${quoted(target)}`,
  },
  'content.topic.reordered': {
    label: 'Topics reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the topics in the lesson ${quoted(target)}`,
  },
```

In `apps/api/src/media/media.schemas.ts` export the two text rules the topic description needs:

In `apps/api/src/media/media.schemas.ts` replace:

```ts
const hasNoNul = (value: string): boolean => !value.includes('\u0000');
const NUL_MESSAGE = 'Remove the invalid character.';
```

with:

```ts
export const hasNoNul = (value: string): boolean => !value.includes('\u0000');
export const NUL_MESSAGE = 'Remove the invalid character.';
```

- [ ] **Step 3: Schemas**

In `apps/api/src/courses/courses.schemas.ts` replace:

```ts
import { descriptionSchema, titleSchema } from '../media/media.schemas';
```

with:

```ts
import { descriptionSchema, hasNoNul, NUL_MESSAGE, titleSchema } from '../media/media.schemas';
```

Append to `apps/api/src/courses/courses.schemas.ts`:

```ts
export const lessonBodySchema = z.object({ title: titleSchema });

// A topic's text can be longer than a course description: at most 10,000 characters; empty means none.
export const topicDescriptionSchema = z
  .string()
  .trim()
  .max(10_000, 'Description must be 10,000 characters or fewer.')
  .refine(hasNoNul, NUL_MESSAGE)
  .transform((value) => (value === '' ? null : value));

export const createTopicSchema = z.object({ title: titleSchema, description: topicDescriptionSchema.nullish() });

export const updateTopicSchema = z
  .object({ title: titleSchema.optional(), description: topicDescriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

export type LessonInput = z.infer<typeof lessonBodySchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
```

- [ ] **Step 4: The services**

Create `apps/api/src/courses/lessons.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type Lesson, lessons } from '../db/schema';
import { actorOf } from '../media/actor';
import { applyOrder } from '../media/reorder';
import type { LessonInput } from './courses.schemas';
import { type CourseTree, CoursesService } from './courses.service';

const NOT_FOUND = 'Lesson not found.';

// Lock order for the course tree: the parent row before its children (course, then lesson, then topic).
@Injectable()
export class LessonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
  ) {}

  async add(actor: AuthUser, courseId: string, input: LessonInput): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      // The course row is locked, so two people adding at once get different positions.
      const course = await this.courses.requireCourse(tx, courseId, true);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${lessons.position}), -1) + 1`.mapWith(Number) })
        .from(lessons)
        .where(eq(lessons.courseId, courseId));
      const [lesson] = await tx.insert(lessons).values({ courseId, title: input.title, position: next, createdBy: actor.id }).returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.lesson.added',
        target: { type: 'lesson', id: lesson.id, label: lesson.title },
        metadata: { courseId, courseTitle: course.title },
      });
    });
    return this.courses.tree(courseId);
  }

  async rename(actor: AuthUser, id: string, input: LessonInput): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      const lesson = await this.requireLesson(tx, id, true);
      if (lesson.title !== input.title) {
        await tx.update(lessons).set({ title: input.title, updatedAt: new Date() }).where(eq(lessons.id, id));
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.lesson.renamed',
          target: { type: 'lesson', id, label: input.title },
          changes: { title: { before: lesson.title, after: input.title } },
          metadata: { courseId: lesson.courseId },
        });
      }
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  async reorder(actor: AuthUser, courseId: string, ids: string[]): Promise<CourseTree> {
    await this.db.transaction(async (tx) => {
      const course = await this.courses.requireCourse(tx, courseId, true);
      // Locked in id order so two people reordering at once cannot deadlock, then the order is read in SQL.
      await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.id)).for('update');
      const current = (
        await tx
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.courseId, courseId))
          .orderBy(asc(lessons.position), asc(lessons.createdAt), asc(lessons.id))
      ).map((lesson) => lesson.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(lessons).set({ position, updatedAt: new Date() }).where(eq(lessons.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.lesson.reordered',
          target: { type: 'course', id: courseId, label: course.title },
        });
      }
    });
    return this.courses.tree(courseId);
  }

  async requireLesson(executor: DbExecutor, id: string, lock = false): Promise<Lesson> {
    const query = executor.select().from(lessons).where(eq(lessons.id, id));
    const [lesson] = lock ? await query.for('update') : await query;
    if (!lesson) throw new NotFoundException(NOT_FOUND);
    return lesson;
  }
}
```

Create `apps/api/src/courses/topics.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type AuditChanges, lessons, topics } from '../db/schema';
import { actorOf } from '../media/actor';
import { applyOrder } from '../media/reorder';
import type { CreateTopicInput, UpdateTopicInput } from './courses.schemas';
import { type CourseTree, CoursesService } from './courses.service';
import { LessonsService } from './lessons.service';

const NOT_FOUND = 'Topic not found.';

export interface TopicView {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
}

@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}

  async add(actor: AuthUser, lessonId: string, input: CreateTopicInput): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      // The lesson row is locked, so two people adding at once get different positions.
      const lesson = await this.lessons.requireLesson(tx, lessonId, true);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topics.position}), -1) + 1`.mapWith(Number) })
        .from(topics)
        .where(eq(topics.lessonId, lessonId));
      const [topic] = await tx
        .insert(topics)
        .values({ lessonId, title: input.title, description: input.description ?? null, position: next, createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.added',
        target: { type: 'topic', id: topic.id, label: topic.title },
        metadata: { lessonId, lessonTitle: lesson.title, courseId: lesson.courseId },
      });
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  async edit(actor: AuthUser, id: string, input: UpdateTopicInput): Promise<TopicView> {
    await this.db.transaction(async (tx) => {
      const [topic] = await tx.select().from(topics).where(eq(topics.id, id)).for('update');
      if (!topic) throw new NotFoundException(NOT_FOUND);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== topic.title) changes.title = { before: topic.title, after: input.title };
      if (input.description !== undefined && input.description !== topic.description) {
        changes.description = { before: topic.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(topics).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(topics.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.topic.edited',
        target: { type: 'topic', id, label: input.title ?? topic.title },
        changes,
      });
    });
    return this.view(id);
  }

  async reorder(actor: AuthUser, lessonId: string, ids: string[]): Promise<CourseTree> {
    const courseId = await this.db.transaction(async (tx) => {
      const lesson = await this.lessons.requireLesson(tx, lessonId, true);
      await tx.select({ id: topics.id }).from(topics).where(eq(topics.lessonId, lessonId)).orderBy(asc(topics.id)).for('update');
      const current = (
        await tx
          .select({ id: topics.id })
          .from(topics)
          .where(eq(topics.lessonId, lessonId))
          .orderBy(asc(topics.position), asc(topics.createdAt), asc(topics.id))
      ).map((topic) => topic.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(topics).set({ position, updatedAt: new Date() }).where(eq(topics.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.topic.reordered',
          target: { type: 'lesson', id: lessonId, label: lesson.title },
        });
      }
      return lesson.courseId;
    });
    return this.courses.tree(courseId);
  }

  private async view(id: string): Promise<TopicView> {
    const [row] = await this.db
      .select({ topic: topics, courseId: lessons.courseId })
      .from(topics)
      .innerJoin(lessons, eq(lessons.id, topics.lessonId))
      .where(eq(topics.id, id));
    if (!row) throw new NotFoundException(NOT_FOUND);
    return {
      id: row.topic.id,
      lessonId: row.topic.lessonId,
      courseId: row.courseId,
      title: row.topic.title,
      description: row.topic.description,
      position: row.topic.position,
    };
  }
}
```

- [ ] **Step 5: The routes**

Create `apps/api/src/courses/lessons.controller.ts`:

```ts
import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { orderSchema } from '../media/media.schemas';
import { type CreateTopicInput, createTopicSchema, type LessonInput, lessonBodySchema } from './courses.schemas';
import type { CourseTree } from './courses.service';
import { LessonsService } from './lessons.service';
import { TopicsService } from './topics.service';

@Controller('lessons')
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly topics: TopicsService,
  ) {}

  @Patch(':id')
  rename(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(lessonBodySchema)) body: LessonInput,
  ): Promise<CourseTree> {
    return this.lessons.rename(actor, id, body);
  }

  @Post(':id/topics')
  addTopic(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createTopicSchema)) body: CreateTopicInput,
  ): Promise<CourseTree> {
    return this.topics.add(actor, id, body);
  }

  @Put(':id/topics/order')
  reorderTopics(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<CourseTree> {
    return this.topics.reorder(actor, id, body.ids);
  }
}
```

Create `apps/api/src/courses/topics.controller.ts`:

```ts
import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type UpdateTopicInput, updateTopicSchema } from './courses.schemas';
import { TopicsService, type TopicView } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Patch(':id')
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTopicSchema)) body: UpdateTopicInput,
  ): Promise<TopicView> {
    return this.topics.edit(actor, id, body);
  }
}
```

Add the two lesson routes to the courses controller (they live under `/courses/:id`):

In `apps/api/src/courses/courses.controller.ts` replace:

```ts
import { type CreateCourseInput, createCourseSchema, type UpdateCourseInput, updateCourseSchema } from './courses.schemas';
import { type CourseTree, CoursesService, type CourseView } from './courses.service';
```

with:

```ts
import {
  type CreateCourseInput,
  createCourseSchema,
  type LessonInput,
  lessonBodySchema,
  type UpdateCourseInput,
  updateCourseSchema,
} from './courses.schemas';
import { type CourseTree, CoursesService, type CourseView } from './courses.service';
import { LessonsService } from './lessons.service';
```

In `apps/api/src/courses/courses.controller.ts` replace:

```ts
  constructor(private readonly courses: CoursesService) {}
```

with:

```ts
  constructor(
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}
```

In `apps/api/src/courses/courses.controller.ts`, after:

```ts
  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<CourseTree> {
    return this.courses.completeCover(actor, id, fileId);
  }
```

add:

```ts

  @Post(':id/lessons')
  addLesson(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(lessonBodySchema)) body: LessonInput,
  ): Promise<CourseTree> {
    return this.lessons.add(actor, id, body);
  }

  @Put(':id/lessons/order')
  reorderLessons(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<CourseTree> {
    return this.lessons.reorder(actor, id, body.ids);
  }
```

Replace the whole of `apps/api/src/courses/courses.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';

@Module({
  imports: [AuditModule, MediaModule],
  controllers: [CoursesController, LessonsController, TopicsController],
  providers: [CoursesService, LessonsService, TopicsService],
  exports: [CoursesService, LessonsService, TopicsService],
})
export class CoursesModule {}
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (723 API tests).

To see that the two lock tests bite, change `requireCourse(tx, courseId, true)` in `LessonsService.add` and `requireLesson(tx, lessonId, true)` in `TopicsService.add` to `false`: "takes the course row first" and "takes the lesson row first" FAIL (positions come out equal). Undo the change.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: add lessons and topics with add, rename, edit and reorder"
```


### Task 5: The topic with its attachments, library attachments, rename, reorder and `open`

**Files:**
- Create: `apps/api/src/media/attachments.service.ts`, `apps/api/src/courses/attachments.controller.ts`, `apps/api/test/attachments.e2e-spec.ts`
- Modify: `apps/api/src/media/media.schemas.ts`, `apps/api/src/media/media.module.ts`, `apps/api/src/courses/topics.service.ts`, `apps/api/src/courses/topics.controller.ts`, `apps/api/src/courses/courses.module.ts`, `apps/api/src/audit/audit.actions.ts`, `apps/api/src/audit/audit-presentation.ts`, `apps/api/src/audit/audit-presentation-courses.spec.ts`, `apps/api/test/helpers/media.ts`, `apps/api/test/helpers/courses.ts`

**Existing tests to adapt:** `apps/api/src/audit/audit-presentation-media.spec.ts`, the last test ("files the media actions under the right categories"): the regular expression that selects the media actions already matches `playback.`, so the new `playback.viewed` makes it 13 actions and the playback category two; the counts and the expected list change accordingly (nothing is weakened).

**Interfaces:**
- Consumes: `topicAttachments`, `topics`, `lessons`, `mediaItems`, `mediaFolders`, `files`, `users` (Task 1), `MEDIA_CATEGORIES`, `MediaKind`, `MediaCategory` (Task 2), `applyOrder`, `actorOf`, `titleSchema`, `orderSchema`, `LINK_TTL_SECONDS`, `CoursesService`, `TopicView` (Tasks 3–4).
- Produces:

```ts
// media/attachments.service.ts
interface AttachmentView { id; topicId; position; kind: MediaKind; title: string; source: 'upload' | 'library'; status: 'uploading' | 'ready';
  sizeBytes: number; durationSeconds: number | null; thumbnailUrl: string | null; libraryItemId: string | null;
  category: MediaCategory | null; libraryFolderName: string | null; createdBy: { id; name }; createdAt: Date }
interface OpenLink { url: string; expiresAt: string; contentType: string; kind: MediaKind }
class AttachmentsService { list(topicId, actor): Promise<AttachmentView[]>; view(id, actor): Promise<AttachmentView>;
  addFromLibrary(actor, topicId, input: { itemId; title? }): Promise<AttachmentView>; rename(actor, id, title): Promise<AttachmentView>;
  reorder(actor, topicId, ids): Promise<AttachmentView[]>; open(actor, id): Promise<OpenLink> }
// topics.service.ts
interface TopicDetail extends TopicView { attachments: AttachmentView[] }   TopicsService.detail(actor, id)
// HTTP: GET /api/topics/:id, POST /api/topics/:id/attachments/library, PUT /api/topics/:id/attachments/order,
//       PATCH /api/attachments/:id, POST /api/attachments/:id/open
// Visibility: an attachment that is still uploading belongs to its creator (404 to everyone else, and it is not listed for them).
// Titles: topic_attachments.title is null for a library attachment that follows its item; a title given at attach time or by a rename is the attachment's own.
// Audit: content.attachment.added (target attachment, metadata { kind, source, topicId, topicTitle, libraryItemId? }), .renamed (changes { title }),
//   .reordered (target topic), playback.played (video and audio) or playback.viewed (pdf and image) with target attachment and metadata { kind, source, topicId }
// test/helpers/courses.ts: seedAttachment(db, options): Promise<{ attachmentId; fileId: string | null; storageKey: string | null }>
// test/helpers/media.ts: pdfBytes(size?)
```

- [ ] **Step 1: Failing tests**

In `apps/api/src/audit/audit-presentation-media.spec.ts` adapt the last test:

In `apps/api/src/audit/audit-presentation-media.spec.ts` replace:

```ts
    expect(media).toHaveLength(12);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played']);
```

with:

```ts
    expect(media).toHaveLength(13);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played', 'playback.viewed']);
```

Append to `apps/api/src/audit/audit-presentation-courses.spec.ts`:

Append to `apps/api/src/audit/audit-presentation-courses.spec.ts`:

```ts
describe('attachment audit presentation', () => {
  it.each([
    ['pdf', 'PDF'],
    ['video', 'video'],
    ['audio', 'audio file'],
    ['image', 'image'],
  ])('says "%s" as "%s"', (kind, word) => {
    const added = presentAudit(entry({ action: 'content.attachment.added', targetLabel: 'Exit map', metadata: { kind, topicTitle: 'Fire exits' } }));
    expect(added).toEqual({
      label: 'Attachment added',
      tone: 'change',
      category: 'content',
      summary: `Anita Rao added the ${word} 'Exit map' to the topic 'Fire exits'`,
    });
    expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'Exit map', metadata: { kind } })).summary).toBe(`Anita Rao opened the ${word} 'Exit map'`);
  });

  it('falls back to "attachment" and leaves out a topic that was not recorded', () => {
    for (const metadata of [null, {}, { kind: 'constructor' }, { kind: '__proto__' }, { kind: 5 }, { kind: 'spreadsheet', topicTitle: 7 }]) {
      expect(presentAudit(entry({ action: 'content.attachment.added', targetLabel: 'T', metadata })).summary).toBe("Anita Rao added the attachment 'T'");
      expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'T', metadata })).summary).toBe("Anita Rao opened the attachment 'T'");
    }
  });

  it.each([
    [
      'content.attachment.renamed',
      { targetLabel: 'Exit map', changes: { title: { before: 'Map', after: 'Exit map' } } },
      'Attachment renamed',
      'change',
      "Anita Rao renamed the attachment from 'Map' to 'Exit map'",
    ],
    ['content.attachment.renamed', { targetLabel: 'Exit map' }, 'Attachment renamed', 'change', "Anita Rao renamed the attachment 'Exit map'"],
    [
      'content.attachment.reordered',
      { targetLabel: 'Fire exits' },
      'Attachments reordered',
      'neutral',
      "Anita Rao changed the order of the attachments in the topic 'Fire exits'",
    ],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('presents viewing as a playback entry', () => {
    expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'Exit map', metadata: { kind: 'pdf' } }))).toEqual({
      label: 'Viewed',
      tone: 'neutral',
      category: 'playback',
      summary: "Anita Rao opened the PDF 'Exit map'",
    });
    expect(categoryOf('playback.viewed')).toBe('playback');
  });
});
```

Add a PDF to the byte helpers in `apps/api/test/helpers/media.ts`:

In `apps/api/test/helpers/media.ts`, after:

```ts
export const m4aBytes = (size = 64): Uint8Array => bytes(size, [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
```

add:

```ts
export const pdfBytes = (size = 64): Uint8Array => bytes(size, [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
```

Add the attachment seed helper to `apps/api/test/helpers/courses.ts`:

In `apps/api/test/helpers/courses.ts` replace:

```ts
import type { INestApplication } from '@nestjs/common';
```

with:

```ts
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
```

In `apps/api/test/helpers/courses.ts` replace:

```ts
import { type Lesson, lessons, type Topic, topics } from '../../src/db/schema';
```

with:

```ts
import { files, type Lesson, lessons, topicAttachments, type Topic, topics } from '../../src/db/schema';
```

In `apps/api/test/helpers/courses.ts` replace:

```ts
import { pngBytes, uniqueName } from './media';
```

with:

```ts
import { m4aBytes, mp4Bytes, pdfBytes, pngBytes, uniqueName } from './media';
```

Append to `apps/api/test/helpers/courses.ts`:

```ts
const SEED_FILES = {
  video: { prefix: 'videos', contentType: 'video/mp4', bytes: mp4Bytes },
  audio: { prefix: 'audio', contentType: 'audio/mp4', bytes: m4aBytes },
  pdf: { prefix: 'documents', contentType: 'application/pdf', bytes: pdfBytes },
  image: { prefix: 'images', contentType: 'image/png', bytes: pngBytes },
} as const;

export interface SeedAttachmentOptions {
  topicId: string;
  createdBy: string;
  kind?: keyof typeof SEED_FILES;
  title?: string;
  status?: 'uploading' | 'ready';
  position?: number;
  sizeBytes?: number;
  durationSeconds?: number | null;
  // A library item to follow instead of an uploaded file.
  libraryItemId?: string;
  // The attachment's own title; null (the default for a library attachment) follows the item's title.
  libraryTitle?: string | null;
  storage?: InMemoryStorage; // when given, the bytes of a ready uploaded file are put into it
}

// An attachment straight in the database: an uploaded file (ready or still uploading) or a library item.
export async function seedAttachment(db: Database, options: SeedAttachmentOptions) {
  const status = options.status ?? 'ready';
  const kind = options.kind ?? 'pdf';
  if (options.libraryItemId) {
    const [row] = await db
      .insert(topicAttachments)
      .values({
        topicId: options.topicId,
        position: options.position ?? 0,
        kind,
        title: options.libraryTitle ?? null,
        libraryItemId: options.libraryItemId,
        status: 'ready',
        createdBy: options.createdBy,
      })
      .returning();
    return { attachmentId: row.id, fileId: null, storageKey: null };
  }
  const seed = SEED_FILES[kind];
  const sizeBytes = options.sizeBytes ?? 64;
  const storageKey = `${seed.prefix}/${randomUUID()}`;
  const [file] = await db
    .insert(files)
    .values({
      purpose: kind,
      storageKey,
      originalName: `seed.${kind}`,
      contentType: seed.contentType,
      sizeBytes,
      status: status === 'ready' ? 'ready' : 'pending',
      uploadId: status === 'ready' ? null : randomUUID(),
      partSize: status === 'ready' ? null : 16_777_216,
      partCount: status === 'ready' ? null : 1,
      uploadedBy: options.createdBy,
      completedAt: status === 'ready' ? new Date() : null,
    })
    .returning();
  if (status === 'ready') options.storage?.seed(storageKey, seed.bytes(sizeBytes), seed.contentType);
  const [row] = await db
    .insert(topicAttachments)
    .values({
      topicId: options.topicId,
      position: options.position ?? 0,
      kind,
      title: options.title ?? `Attachment ${randomUUID().slice(0, 8)}`,
      fileId: file.id,
      durationSeconds: options.durationSeconds ?? null,
      status,
      createdBy: options.createdBy,
    })
    .returning();
  return { attachmentId: row.id, fileId: file.id, storageKey };
}
```

Create `apps/api/test/attachments.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, mediaItems, topicAttachments, topics } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic, whileHolding } from './helpers/courses';
import { seedFolder, seedItem, signIn, uniqueName } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('topic attachments', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const unknown = '00000000-0000-4000-8000-000000000000';
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const course = await createCourseViaApi(app, owner.session, { title: 'Fire safety' });
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    const folder = await seedFolder(db, owner.user.id);
    const songs = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    return { owner, other, course, lesson, topic, folder, songs };
  }

  const libraryAttach = (session: Parameters<typeof bearer>[0], topicId: string, body: object) =>
    http().post(`/api/topics/${topicId}/attachments/library`).set(...bearer(session)).send(body);

  it('needs a signed-in person on every route', async () => {
    await http().get(`/api/topics/${unknown}`).expect(401);
    await http().post(`/api/topics/${unknown}/attachments/library`).send({}).expect(401);
    await http().put(`/api/topics/${unknown}/attachments/order`).send({ ids: [] }).expect(401);
    await http().patch(`/api/attachments/${unknown}`).send({ title: 'x' }).expect(401);
    await http().post(`/api/attachments/${unknown}/open`).expect(401);
  });

  describe('the topic with its attachments', () => {
    it('answers the topic and its attachments in order, with the facts a page needs and no storage keys', async () => {
      const { owner, course, lesson, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library video', sizeBytes: 300, durationSeconds: 90, withCover: true, storage });
      const pdf = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', title: 'Exit map', position: 1, sizeBytes: 2048, storage });
      const image = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'image', title: 'Plan', position: 2, storage });
      const library = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId, position: 0 });
      const res = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ id: topic.id, lessonId: lesson.id, courseId: course.id, title: 'Fire exits', description: null, position: 0 });
      expect(res.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([library.attachmentId, pdf.attachmentId, image.attachmentId]);
      expect(res.body.attachments[0]).toEqual({
        id: library.attachmentId,
        topicId: topic.id,
        position: 0,
        kind: 'video',
        title: 'Library video',
        source: 'library',
        status: 'ready',
        sizeBytes: 300,
        durationSeconds: 90,
        thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//),
        libraryItemId: item.itemId,
        category: 'video',
        libraryFolderName: folder.name,
        createdBy: { id: owner.user.id, name: 'Test User' },
        createdAt: expect.any(String),
      });
      expect(res.body.attachments[1]).toMatchObject({ kind: 'pdf', title: 'Exit map', source: 'upload', sizeBytes: 2048, thumbnailUrl: null, libraryItemId: null, category: null, libraryFolderName: null });
      expect(res.body.attachments[2]).toMatchObject({ kind: 'image', source: 'upload', thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//) });
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|storage_key|uploadId|upload_id|fileId/);
    });

    it('lists an attachment that is still uploading to its creator only', async () => {
      const { owner, other, topic } = await setup();
      const ready = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Ready', storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Unfinished', status: 'uploading', position: 1 });
      const mine = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(mine.body.attachments.map((attachment: { id: string; status: string }) => [attachment.id, attachment.status])).toEqual([
        [ready.attachmentId, 'ready'],
        [unfinished.attachmentId, 'uploading'],
      ]);
      const theirs = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(theirs.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([ready.attachmentId]);
    });

    it('counts only ready attachments in the course tree', async () => {
      const { owner, course, topic } = await setup();
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading', position: 1 });
      const tree = await http().get(`/api/courses/${course.id}`).set(...bearer(owner.session)).expect(200);
      expect(tree.body.lessons[0].topics[0]).toMatchObject({ id: topic.id, attachmentCount: 1 });
    });

    it('answers 404 for an unknown topic and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await http().get(`/api/topics/${unknown}`).set(...bearer(owner.session)).expect(404);
      await http().get('/api/topics/nope').set(...bearer(owner.session)).expect(400);
    });
  });

  describe('attaching a library item', () => {
    it('attaches a ready item that follows the library: its title, cover and later edits show in the topic', async () => {
      const { owner, other, topic, songs } = await setup();
      const item = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, title: 'Morning song', sizeBytes: 500, durationSeconds: 61, storage });
      const res = await libraryAttach(other.session, topic.id, { itemId: item.itemId }).expect(201);
      expect(res.body).toMatchObject({
        topicId: topic.id,
        kind: 'audio',
        title: 'Morning song',
        source: 'library',
        status: 'ready',
        sizeBytes: 500,
        durationSeconds: 61,
        thumbnailUrl: null,
        libraryItemId: item.itemId,
        category: 'song',
        libraryFolderName: songs.name,
        createdBy: { id: other.user.id, name: 'Test User' },
      });
      expect((await attachmentRow(res.body.id)).title).toBeNull();

      await http().patch(`/api/media/items/${item.itemId}`).set(...bearer(owner.session)).send({ title: 'Evening song' }).expect(200);
      const cover = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
      const started = await http().post(`/api/media/items/${item.itemId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: cover.length }).expect(201);
      storage.putObject(started.body.url, cover);
      await http().post(`/api/media/items/${item.itemId}/cover/${started.body.fileId}/complete`).set(...bearer(owner.session)).expect(200);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments[0]).toMatchObject({ title: 'Evening song', thumbnailUrl: expect.stringMatching(/^memory:\/\/get\//) });
    });

    it('keeps its own title when one was given at attach time or by a rename, whatever happens to the item', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', storage });
      const named = await libraryAttach(owner.session, topic.id, { itemId: item.itemId, title: '  Our title ' }).expect(201);
      expect(named.body.title).toBe('Our title');
      const followed = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await http().patch(`/api/attachments/${followed.body.id}`).set(...bearer(owner.session)).send({ title: 'Renamed here' }).expect(200);
      await http().patch(`/api/media/items/${item.itemId}`).set(...bearer(owner.session)).send({ title: 'Changed in the library' }).expect(200);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments.map((attachment: { title: string }) => attachment.title)).toEqual(['Our title', 'Renamed here']);
    });

    it('puts a new attachment at the end, takes the kind from the item and allows the same item twice', async () => {
      const { owner, topic, folder, songs } = await setup();
      const video = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const song = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, storage });
      await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 4, storage });
      const first = await libraryAttach(owner.session, topic.id, { itemId: video.itemId }).expect(201);
      const second = await libraryAttach(owner.session, topic.id, { itemId: video.itemId }).expect(201);
      const third = await libraryAttach(owner.session, topic.id, { itemId: song.itemId }).expect(201);
      expect([first, second, third].map((res) => [res.body.position, res.body.kind])).toEqual([
        [5, 'video'],
        [6, 'video'],
        [7, 'audio'],
      ]);
    });

    it('refuses an item that is still uploading, hides another person\'s unfinished item, and knows no unknown item', async () => {
      const { owner, other, topic, folder } = await setup();
      const unfinished = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
      const refused = await libraryAttach(owner.session, topic.id, { itemId: unfinished.itemId }).expect(409);
      expect(refused.body.message).toMatch(/still uploading/i);
      await libraryAttach(other.session, topic.id, { itemId: unfinished.itemId }).expect(404);
      await libraryAttach(owner.session, topic.id, { itemId: unknown }).expect(404);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it.each([
      ['no item', {}],
      ['an item id that is not an id', { itemId: 'nope' }],
      ['a blank title', { itemId: unknown, title: '  ' }],
      ['a title of 201 characters', { itemId: unknown, title: 'T'.repeat(201) }],
      ['a NUL character in the title', { itemId: unknown, title: 'a\u0000b' }],
    ])('refuses %s', async (_name, body) => {
      const { owner, topic } = await setup();
      await libraryAttach(owner.session, topic.id, body).expect(400);
    });

    it('answers 404 for an unknown topic and 400 for a malformed topic id', async () => {
      const { owner, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      await libraryAttach(owner.session, unknown, { itemId: item.itemId }).expect(404);
      await libraryAttach(owner.session, 'nope', { itemId: item.itemId }).expect(400);
    });

    it('takes the topic row first, so additions that wait for each other still get different positions', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const add = () => libraryAttach(owner.session, topic.id, { itemId: item.itemId });
      const { result, finishedWhileHeld } = await whileHolding(
        db,
        (tx) => tx.select().from(topics).where(eq(topics.id, topic.id)).for('update'),
        () => Promise.all([add(), add()]),
      );
      expect(finishedWhileHeld).toBe(false);
      expect(result.map((res) => res.status)).toEqual([201, 201]);
      const stored = await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id));
      expect(stored.map((attachment) => attachment.position).sort()).toEqual([0, 1]);
    });

    it('records the addition with the topic and no storage key, and words it for the audit log', async () => {
      const { owner, topic, folder } = await setup();
      const admin = await signIn(app, db, 'admin');
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: uniqueName('Exit film'), storage });
      const res = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      const [entry] = await auditFor('content.attachment.added', res.body.id);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'attachment',
        targetLabel: res.body.title,
        metadata: { kind: 'video', source: 'library', topicId: topic.id, topicTitle: 'Fire exits', libraryItemId: item.itemId },
      });
      expect(JSON.stringify(entry)).not.toMatch(/videos\/|memory:/);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(res.body.title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((candidate) => candidate.action === 'content.attachment.added')?.summary).toBe(`Test User added the video '${res.body.title}' to the topic 'Fire exits'`);
    });
  });

  describe('renaming', () => {
    it('renames an attachment, records before and after, and does not audit the same name', async () => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Map', storage });
      const res = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ title: '  Exit map ' }).expect(200);
      expect(res.body).toMatchObject({ id: seeded.attachmentId, title: 'Exit map' });
      const [entry] = await auditFor('content.attachment.renamed', seeded.attachmentId);
      expect(entry).toMatchObject({
        actorId: owner.user.id,
        targetType: 'attachment',
        targetLabel: 'Exit map',
        changes: { title: { before: 'Map', after: 'Exit map' } },
        metadata: { kind: 'pdf', topicId: topic.id },
      });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send({ title: 'Exit map' }).expect(200);
      expect(await auditFor('content.attachment.renamed', seeded.attachmentId)).toHaveLength(1);
    });

    it('records the library title as the old name when a library attachment is renamed first', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library title', storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await http().patch(`/api/attachments/${attached.body.id}`).set(...bearer(owner.session)).send({ title: 'Our title' }).expect(200);
      expect((await auditFor('content.attachment.renamed', attached.body.id))[0].changes).toEqual({ title: { before: 'Library title', after: 'Our title' } });
      await http().patch(`/api/attachments/${attached.body.id}`).set(...bearer(owner.session)).send({ title: 'Library title' }).expect(200);
      expect((await attachmentRow(attached.body.id)).title).toBe('Library title');
    });

    it.each([
      ['no title', {}],
      ['a blank title', { title: '  ' }],
      ['a title of 201 characters', { title: 'T'.repeat(201) }],
      ['a NUL character', { title: 'a\u0000b' }],
    ])('refuses %s and keeps the name', async (_name, body) => {
      const { owner, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'Keep', storage });
      await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(owner.session)).send(body).expect(400);
      expect((await attachmentRow(seeded.attachmentId)).title).toBe('Keep');
    });

    it('keeps hostile text as it is, and answers 404 for unknown or another person\'s unfinished attachments and 400 for a malformed id', async () => {
      const { owner, other, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      const res = await http().patch(`/api/attachments/${seeded.attachmentId}`).set(...bearer(other.session)).send({ title: hostile }).expect(200);
      expect(res.body.title).toBe(hostile);
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading', position: 1 });
      await http().patch(`/api/attachments/${unfinished.attachmentId}`).set(...bearer(other.session)).send({ title: 'x' }).expect(404);
      await http().patch(`/api/attachments/${unknown}`).set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
      await http().patch('/api/attachments/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
    });
  });

  describe('reordering', () => {
    it('puts the ready attachments in the order given, leaves an unfinished one out and records one entry on the topic', async () => {
      const { owner, topic } = await setup();
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'A', position: 0, storage });
      const b = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'B', position: 1, storage });
      const c = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'C', position: 2, storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, title: 'U', position: 3, status: 'uploading' });
      const res = await http()
        .put(`/api/topics/${topic.id}/attachments/order`)
        .set(...bearer(owner.session))
        .send({ ids: [c.attachmentId, a.attachmentId, b.attachmentId] })
        .expect(200);
      expect(res.body.map((attachment: { title: string }) => attachment.title)).toEqual(['C', 'A', 'B', 'U']);
      expect((await attachmentRow(unfinished.attachmentId)).position).toBe(3);
      const [entry] = await auditFor('content.attachment.reordered', topic.id);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'topic', targetLabel: 'Fire exits' });
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(1);
    });

    it('does not audit an order that did not change, and accepts a topic without attachments', async () => {
      const { owner, topic } = await setup();
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(200);
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, storage });
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: [a.attachmentId] }).expect(200);
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(0);
    });

    it('refuses an order that is missing one, repeats one, invents one, names an unfinished one or one of another topic', async () => {
      const { owner, lesson, topic } = await setup();
      const sibling = await seedTopic(db, lesson.id, owner.user.id, 'Other topic', 1);
      const foreign = await seedAttachment(db, { topicId: sibling.id, createdBy: owner.user.id, storage });
      const a = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 0, storage });
      const b = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 1, storage });
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, position: 2, status: 'uploading' });
      const ids = [a.attachmentId, b.attachmentId];
      const attempts = [[a.attachmentId], [...ids, randomUUID()], [a.attachmentId, a.attachmentId], [a.attachmentId, foreign.attachmentId], [...ids, unfinished.attachmentId], []];
      for (const attempt of attempts) {
        await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: attempt }).expect(409);
      }
      expect((await attachmentRow(a.attachmentId)).position).toBe(0);
      expect(await auditFor('content.attachment.reordered', topic.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown topic, 400 for a malformed id or body', async () => {
      const { owner, topic } = await setup();
      await http().put(`/api/topics/${unknown}/attachments/order`).set(...bearer(owner.session)).send({ ids: [] }).expect(404);
      await http().put('/api/topics/nope/attachments/order').set(...bearer(owner.session)).send({ ids: [] }).expect(400);
      await http().put(`/api/topics/${topic.id}/attachments/order`).set(...bearer(owner.session)).send({ ids: ['nope'] }).expect(400);
    });
  });

  describe('opening', () => {
    it.each([
      ['video', 'video/mp4', 'playback.played'],
      ['audio', 'audio/mp4', 'playback.played'],
      ['pdf', 'application/pdf', 'playback.viewed'],
      ['image', 'image/png', 'playback.viewed'],
    ] as const)('gives a one-hour link to an uploaded %s and records %s without any link or key', async (kind, contentType, action) => {
      const { owner, other, topic } = await setup();
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind, title: 'Exit map', sizeBytes: 300, storage });
      const before = Date.now();
      const res = await http().post(`/api/attachments/${seeded.attachmentId}/open`).set(...bearer(other.session)).expect(200);
      expect(res.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType, kind });
      expect(Date.parse(res.body.expiresAt) - before).toBeGreaterThan(3_590_000);
      expect(Date.parse(res.body.expiresAt) - before).toBeLessThanOrEqual(3_601_000);
      const fetched = storage.get(res.body.url);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toHaveLength(300);
      const [entry] = await auditFor(action, seeded.attachmentId);
      expect(entry).toMatchObject({ actorId: other.user.id, targetType: 'attachment', targetLabel: 'Exit map', metadata: { kind, source: 'upload', topicId: topic.id } });
      expect(JSON.stringify(entry)).not.toMatch(/memory:|videos\/|audio\/|documents\/|images\//);
    });

    it('opens a library attachment with the library item\'s file and records the play', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Library video', sizeBytes: 200, storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      const res = await http().post(`/api/attachments/${attached.body.id}/open`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ contentType: 'video/mp4', kind: 'video' });
      expect(storage.get(res.body.url).body).toHaveLength(200);
      expect((await auditFor('playback.played', attached.body.id))[0]).toMatchObject({ targetType: 'attachment', targetLabel: 'Library video', metadata: { kind: 'video', source: 'library' } });
    });

    it('cannot open an attachment whose library item is not ready', async () => {
      const { owner, topic, folder } = await setup();
      const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
      const attached = await libraryAttach(owner.session, topic.id, { itemId: item.itemId }).expect(201);
      await db.update(mediaItems).set({ status: 'uploading' }).where(eq(mediaItems.id, item.itemId));
      const res = await http().post(`/api/attachments/${attached.body.id}/open`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toMatch(/not available/i);
      expect(await auditFor('playback.played', attached.body.id)).toHaveLength(0);
    });

    it('answers 409 for your own unfinished attachment, 404 for another person\'s, an unknown one and a malformed id', async () => {
      const { owner, other, topic } = await setup();
      const unfinished = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, status: 'uploading' });
      const mine = await http().post(`/api/attachments/${unfinished.attachmentId}/open`).set(...bearer(owner.session)).expect(409);
      expect(mine.body.message).toMatch(/still uploading/i);
      await http().post(`/api/attachments/${unfinished.attachmentId}/open`).set(...bearer(other.session)).expect(404);
      await http().post(`/api/attachments/${unknown}/open`).set(...bearer(owner.session)).expect(404);
      await http().post('/api/attachments/nope/open').set(...bearer(owner.session)).expect(400);
      expect(await db.select().from(auditLog).where(eq(auditLog.targetId, unfinished.attachmentId))).toEqual([]);
    });

    it('words viewing a PDF for the audit log', async () => {
      const { owner, topic } = await setup();
      const admin = await signIn(app, db, 'admin');
      const title = uniqueName('Exit map');
      const seeded = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'pdf', title, storage });
      await http().post(`/api/attachments/${seeded.attachmentId}/open`).set(...bearer(admin.session)).expect(200);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&includePlayback=true&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        label: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'playback.viewed')).toMatchObject({ label: 'Viewed', summary: `Test User opened the PDF '${title}'` });
    });
  });
});
```

Run: `npm test -w @jbf/api -- audit-presentation attachments`
Expected: FAIL (no service, routes, actions or sentences yet).

- [ ] **Step 2: Audit actions and sentences**

In `apps/api/src/audit/audit.actions.ts`, after:

```ts
  'content.topic.reordered',
```

add:

```ts
  'content.attachment.added',
  'content.attachment.renamed',
  'content.attachment.reordered',
```

In `apps/api/src/audit/audit.actions.ts`, after:

```ts
  'playback.played',
```

add:

```ts
  'playback.viewed',
```

In `apps/api/src/audit/audit-presentation.ts` add the words for the kinds next to the other helpers, and the four entries:

In `apps/api/src/audit/audit-presentation.ts`, before:

```ts
// "from 'a' to 'b'" for an entry that recorded a change of one text field, or null.
```

add:

```ts
// How an attachment is called in a sentence. Own keys only: a stored kind such as 'constructor' falls back to "attachment".
const ATTACHMENT_WORDS: Record<string, string> = { video: 'video', audio: 'audio file', pdf: 'PDF', image: 'image' };
const attachmentWord = (entry: PresentableEntry): string => {
  const kind = metaText(entry, 'kind');
  return kind !== null && Object.hasOwn(ATTACHMENT_WORDS, kind) ? ATTACHMENT_WORDS[kind] : 'attachment';
};

// "from 'a' to 'b'" for an entry that recorded a change of one text field, or null.
```

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
    summary: ({ actor, target }) => `${actor} changed the order of the topics in the lesson ${quoted(target)}`,
  },
```

add:

```ts
  'content.attachment.added': {
    label: 'Attachment added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const topic = metaText(entry, 'topicTitle');
      const added = `${actor} added the ${attachmentWord(entry)} ${quoted(target)}`;
      return topic ? `${added} to the topic ${quoted(topic)}` : added;
    },
  },
  'content.attachment.renamed': {
    label: 'Attachment renamed',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const title = changedText(entry, 'title');
      return title
        ? `${actor} renamed the attachment from ${quoted(title.before)} to ${quoted(title.after)}`
        : `${actor} renamed the attachment ${quoted(target)}`;
    },
  },
  'content.attachment.reordered': {
    label: 'Attachments reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the attachments in the topic ${quoted(target)}`,
  },
```

In `apps/api/src/audit/audit-presentation.ts`, after:

```ts
  'playback.played': {
    label: 'Played',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} played ${target}`,
  },
```

add:

```ts
  'playback.viewed': {
    label: 'Viewed',
    tone: 'neutral',
    summary: ({ actor, target, entry }) => `${actor} opened the ${attachmentWord(entry)} ${quoted(target)}`,
  },
```

- [ ] **Step 3: The service**

In `apps/api/src/media/media.schemas.ts` add the two bodies:

In `apps/api/src/media/media.schemas.ts`, after:

```ts
export const ORDER_CHANGED_MESSAGE = 'The list changed while you were editing it. Reload and try again.';
```

add:

```ts

// Attaching a library item to a topic: the title is optional; without one the attachment follows the item's own title.
export const libraryAttachmentSchema = z.object({ itemId: z.uuid(), title: titleSchema.optional() });

export const attachmentTitleSchema = z.object({ title: titleSchema });
```

In `apps/api/src/media/media.schemas.ts`, after:

```ts
export type CoverStartInput = z.infer<typeof coverStartSchema>;
```

add:

```ts
export type LibraryAttachmentInput = z.infer<typeof libraryAttachmentSchema>;
```

Create `apps/api/src/media/attachments.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type FileRow, files, type MediaFolder, type MediaItem, mediaFolders, mediaItems, type TopicAttachment, topicAttachments, topics, users } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { MEDIA_CATEGORIES, type MediaCategory, type MediaKind } from './media-kinds';
import type { LibraryAttachmentInput } from './media.schemas';
import { applyOrder } from './reorder';

const NOT_FOUND = 'Attachment not found.';
const TOPIC_NOT_FOUND = 'Topic not found.';
const ownFile = alias(files, 'own_file');
const itemMedia = alias(files, 'item_media');
const itemCover = alias(files, 'item_cover');

export interface AttachmentView {
  id: string;
  topicId: string;
  position: number;
  kind: MediaKind;
  // The attachment's own title, or the library item's current title for a library attachment that has none of its own.
  title: string;
  source: 'upload' | 'library';
  status: TopicAttachment['status'];
  sizeBytes: number;
  durationSeconds: number | null;
  // A one-hour link to a small picture: a library item's cover, or the uploaded image itself. Null for everything else.
  thumbnailUrl: string | null;
  libraryItemId: string | null;
  category: MediaCategory | null;
  libraryFolderName: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface OpenLink {
  url: string;
  expiresAt: string;
  contentType: string;
  kind: MediaKind;
}

interface AttachmentRow {
  attachment: TopicAttachment;
  own: FileRow | null;
  item: MediaItem | null;
  media: FileRow | null;
  cover: FileRow | null;
  folder: MediaFolder | null;
  creator: { id: string; name: string };
}

// An attachment that is still uploading belongs to the person uploading it; to everyone else it does not exist yet.
const visibleTo = (attachment: Pick<TopicAttachment, 'status' | 'createdBy'>, actor: AuthUser): boolean =>
  attachment.status === 'ready' || attachment.createdBy === actor.id;

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(topicId: string, actor: AuthUser): Promise<AttachmentView[]> {
    const rows = await this.rows(
      this.db,
      and(eq(topicAttachments.topicId, topicId), or(eq(topicAttachments.status, 'ready'), eq(topicAttachments.createdBy, actor.id))),
    );
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async view(id: string, actor: AuthUser): Promise<AttachmentView> {
    const [row] = await this.rows(this.db, eq(topicAttachments.id, id));
    if (!row || !visibleTo(row.attachment, actor)) throw new NotFoundException(NOT_FOUND);
    return this.toView(row);
  }

  async addFromLibrary(actor: AuthUser, topicId: string, input: LibraryAttachmentInput): Promise<AttachmentView> {
    const id = await this.db.transaction(async (tx) => {
      // The topic row is locked, so two people adding at once get different positions.
      const [topic] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (!topic) throw new NotFoundException(TOPIC_NOT_FOUND);
      const [found] = await tx
        .select({ item: mediaItems, category: mediaFolders.category })
        .from(mediaItems)
        .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
        .where(eq(mediaItems.id, input.itemId));
      if (!found || (found.item.status !== 'ready' && found.item.createdBy !== actor.id)) throw new NotFoundException('Item not found.');
      if (found.item.status !== 'ready') throw new ConflictException('That item is still uploading.');
      const kind = MEDIA_CATEGORIES[found.category].kind;
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
        .from(topicAttachments)
        .where(and(eq(topicAttachments.topicId, topicId), eq(topicAttachments.status, 'ready')));
      const [attachment] = await tx
        .insert(topicAttachments)
        .values({ topicId, position: next, kind, title: input.title ?? null, libraryItemId: found.item.id, status: 'ready', createdBy: actor.id })
        .returning();
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.attachment.added',
        target: { type: 'attachment', id: attachment.id, label: input.title ?? found.item.title },
        metadata: { kind, source: 'library', topicId, topicTitle: topic.title, libraryItemId: found.item.id },
      });
      return attachment.id;
    });
    return this.view(id, actor);
  }

  async rename(actor: AuthUser, id: string, title: string): Promise<AttachmentView> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(topicAttachments).where(eq(topicAttachments.id, id)).for('update');
      if (!locked || !visibleTo(locked, actor)) throw new NotFoundException(NOT_FOUND);
      const [row] = await this.rows(tx, eq(topicAttachments.id, id));
      const before = row.attachment.title ?? row.item?.title ?? '';
      if (before === title) return;
      await tx.update(topicAttachments).set({ title, updatedAt: new Date() }).where(eq(topicAttachments.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.attachment.renamed',
        target: { type: 'attachment', id, label: title },
        changes: { title: { before, after: title } },
        metadata: { kind: locked.kind, topicId: locked.topicId },
      });
    });
    return this.view(id, actor);
  }

  async reorder(actor: AuthUser, topicId: string, ids: string[]): Promise<AttachmentView[]> {
    await this.db.transaction(async (tx) => {
      const [topic] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (!topic) throw new NotFoundException(TOPIC_NOT_FOUND);
      // Only ready attachments have a place in the order; one that is still uploading takes its place when it finishes.
      const ready = and(eq(topicAttachments.topicId, topicId), eq(topicAttachments.status, 'ready'));
      await tx.select({ id: topicAttachments.id }).from(topicAttachments).where(ready).orderBy(asc(topicAttachments.id)).for('update');
      const current = (
        await tx
          .select({ id: topicAttachments.id })
          .from(topicAttachments)
          .where(ready)
          .orderBy(asc(topicAttachments.position), asc(topicAttachments.createdAt), asc(topicAttachments.id))
      ).map((attachment) => attachment.id);
      const changed = await applyOrder(current, ids, (id, position) =>
        tx.update(topicAttachments).set({ position, updatedAt: new Date() }).where(eq(topicAttachments.id, id)),
      );
      if (changed) {
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.attachment.reordered',
          target: { type: 'topic', id: topicId, label: topic.title },
        });
      }
    });
    return this.list(topicId, actor);
  }

  async open(actor: AuthUser, id: string): Promise<OpenLink> {
    const [row] = await this.rows(this.db, eq(topicAttachments.id, id));
    if (!row || !visibleTo(row.attachment, actor)) throw new NotFoundException(NOT_FOUND);
    if (row.attachment.status !== 'ready') throw new ConflictException('This is still uploading.');
    // A library attachment opens the library item's own file, and only while that item is ready.
    const file = row.own ?? row.media;
    if (!file || (row.item && row.item.status !== 'ready')) throw new ConflictException('This item is not available.');
    const url = await this.storage.presignGet(file.storageKey, LINK_TTL_SECONDS, { contentType: file.contentType });
    const { kind } = row.attachment;
    // Written only after the link exists, and every issued link is recorded. Video and audio are played, the rest viewed.
    await this.audit.record(this.db, {
      actor: actorOf(actor),
      action: kind === 'video' || kind === 'audio' ? 'playback.played' : 'playback.viewed',
      target: { type: 'attachment', id, label: row.attachment.title ?? row.item?.title ?? '' },
      metadata: { kind, source: row.own ? 'upload' : 'library', topicId: row.attachment.topicId },
    });
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), contentType: file.contentType, kind };
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<AttachmentRow[]> {
    return executor
      .select({
        attachment: topicAttachments,
        own: ownFile,
        item: mediaItems,
        media: itemMedia,
        cover: itemCover,
        folder: mediaFolders,
        creator: { id: users.id, name: users.name },
      })
      .from(topicAttachments)
      .leftJoin(ownFile, eq(ownFile.id, topicAttachments.fileId))
      .leftJoin(mediaItems, eq(mediaItems.id, topicAttachments.libraryItemId))
      .leftJoin(itemMedia, eq(itemMedia.id, mediaItems.mediaFileId))
      .leftJoin(itemCover, eq(itemCover.id, mediaItems.coverFileId))
      .leftJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .innerJoin(users, eq(users.id, topicAttachments.createdBy))
      .where(where)
      .orderBy(asc(topicAttachments.position), asc(topicAttachments.createdAt), asc(topicAttachments.id));
  }

  private async toView(row: AttachmentRow): Promise<AttachmentView> {
    const { attachment, own, item, media, cover, folder } = row;
    // The picture: a library item's cover, or an uploaded image shown as its own thumbnail once it is complete.
    const picture = item ? cover : attachment.kind === 'image' ? own : null;
    const thumbnailUrl =
      picture && picture.status === 'ready' ? await this.storage.presignGet(picture.storageKey, LINK_TTL_SECONDS, { contentType: picture.contentType }) : null;
    return {
      id: attachment.id,
      topicId: attachment.topicId,
      position: attachment.position,
      kind: attachment.kind,
      title: attachment.title ?? item?.title ?? '',
      source: item ? 'library' : 'upload',
      status: attachment.status,
      sizeBytes: (own ?? media)?.sizeBytes ?? 0,
      durationSeconds: attachment.durationSeconds ?? item?.durationSeconds ?? null,
      thumbnailUrl,
      libraryItemId: item?.id ?? null,
      category: folder?.category ?? null,
      libraryFolderName: folder?.name ?? null,
      createdBy: row.creator,
      createdAt: attachment.createdAt,
    };
  }
}
```

Register and export it:

In `apps/api/src/media/media.module.ts` replace:

```ts
import { CoversService } from './covers.service';
```

with:

```ts
import { AttachmentsService } from './attachments.service';
import { CoversService } from './covers.service';
```

In `apps/api/src/media/media.module.ts` replace:

```ts
  providers: [CoversService, FoldersService, ItemsService, UploadCleanupService, UploadsService],
  exports: [CoversService, ItemsService],
```

with:

```ts
  providers: [AttachmentsService, CoversService, FoldersService, ItemsService, UploadCleanupService, UploadsService],
  exports: [AttachmentsService, CoversService, ItemsService],
```

- [ ] **Step 4: The topic detail and the routes**

In `apps/api/src/courses/topics.service.ts` add the detail:

In `apps/api/src/courses/topics.service.ts` replace:

```ts
import { actorOf } from '../media/actor';
```

with:

```ts
import { actorOf } from '../media/actor';
import { type AttachmentView, AttachmentsService } from '../media/attachments.service';
```

In `apps/api/src/courses/topics.service.ts` replace:

```ts
@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}
```

with:

```ts
// A topic with the attachments the person may see: every ready one, and their own that are still uploading.
export interface TopicDetail extends TopicView {
  attachments: AttachmentView[];
}

@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly attachments: AttachmentsService,
  ) {}

  async detail(actor: AuthUser, id: string): Promise<TopicDetail> {
    const topic = await this.view(id);
    return { ...topic, attachments: await this.attachments.list(id, actor) };
  }
```

Replace the whole of `apps/api/src/courses/topics.controller.ts` with:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AttachmentView, AttachmentsService } from '../media/attachments.service';
import { type LibraryAttachmentInput, libraryAttachmentSchema, orderSchema } from '../media/media.schemas';
import { type UpdateTopicInput, updateTopicSchema } from './courses.schemas';
import { type TopicDetail, TopicsService, type TopicView } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get(':id')
  detail(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TopicDetail> {
    return this.topics.detail(actor, id);
  }

  @Patch(':id')
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTopicSchema)) body: UpdateTopicInput,
  ): Promise<TopicView> {
    return this.topics.edit(actor, id, body);
  }

  @Post(':id/attachments/library')
  attachFromLibrary(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(libraryAttachmentSchema)) body: LibraryAttachmentInput,
  ): Promise<AttachmentView> {
    return this.attachments.addFromLibrary(actor, id, body);
  }

  @Put(':id/attachments/order')
  reorderAttachments(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<AttachmentView[]> {
    return this.attachments.reorder(actor, id, body.ids);
  }
}
```

Create `apps/api/src/courses/attachments.controller.ts`:

```ts
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AttachmentView, AttachmentsService, type OpenLink } from '../media/attachments.service';
import { attachmentTitleSchema } from '../media/media.schemas';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Patch(':id')
  rename(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(attachmentTitleSchema)) body: z.infer<typeof attachmentTitleSchema>,
  ): Promise<AttachmentView> {
    return this.attachments.rename(actor, id, body.title);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OpenLink> {
    return this.attachments.open(actor, id);
  }
}
```

In `apps/api/src/courses/courses.module.ts` replace:

```ts
import { CoursesController } from './courses.controller';
```

with:

```ts
import { AttachmentsController } from './attachments.controller';
import { CoursesController } from './courses.controller';
```

In `apps/api/src/courses/courses.module.ts` replace:

```ts
  controllers: [CoursesController, LessonsController, TopicsController],
```

with:

```ts
  controllers: [CoursesController, LessonsController, TopicsController, AttachmentsController],
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (768 API tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: add topic detail, library attachments, attachment rename and reorder, and opening"
```


### Task 6: Uploaded attachments: the start route and the upload engine for topics

**Files:**
- Modify: `apps/api/src/media/uploads.service.ts` (the engine works for an owner that is a library item or an attachment), `apps/api/src/media/uploads.controller.ts`, `apps/api/src/media/remove-unfinished.ts`, `apps/api/src/media/media.schemas.ts`, `apps/api/src/media/media.module.ts`, `apps/api/src/media/file-checks.ts`, `apps/api/src/courses/topics.controller.ts`
- Test: `apps/api/src/media/file-checks.spec.ts`, `apps/api/src/media/media.schemas.spec.ts`, `apps/api/test/helpers/courses.ts`, `apps/api/test/attachment-uploads.e2e-spec.ts` (new)

**Existing tests to adapt:** `apps/api/test/media-uploads.e2e-spec.ts` ("lists only my unfinished uploads"): each entry of `GET /api/media/uploads/mine` now also says which topic it belongs to, so the exact object gains `topicId: null`. Nothing else: every milestone 3 and 4 upload, cancel, cleanup and audit test passes unchanged.

**Interfaces:**
- Consumes: `attachmentFieldErrors`, `attachmentKindFor`, `MEDIA_KINDS`, `KindRule`, `kindOf` (Task 2), `topicAttachments`, `topics`, `files` (Task 1), `AttachmentsService.view`, `AttachmentView` (Task 5), `ItemsService.view`, `sanitizeFileName`, `discardStoredFile`, `AuditService`.
- Produces:

```ts
// file-checks.ts
titleFromFileName(input: string): string       // sanitizeFileName without its extension, at most 200 characters
// media.schemas.ts
startAttachmentUploadSchema   // { title?, fileName, contentType, sizeBytes, durationSeconds? } (the file fields are shared with startUploadSchema)
// uploads.service.ts
UploadsService.startAttachment(actor, topicId, input): Promise<{ itemId /* the attachment id */; fileId; partSize; partCount }>
UploadsService.complete(...): Promise<ItemView | AttachmentView>
UploadsService.mine(actor): Promise<PendingUpload[]>   // { fileId; itemId; folderId: string | null; topicId: string | null; title; fileName; sizeBytes; createdAt }
// remove-unfinished.ts
removeUnfinished(tx, fileId): Promise<RemovedUpload | null>   // RemovedUpload { target: { type; id; label }; cover: Pick<FileRow, 'id' | 'storageKey'> | null }
//   removes an unfinished library item (with its cover) or an unfinished attachment, whichever owns the file; null when it is no longer unfinished
// HTTP: POST /api/topics/:id/attachments/uploads, then the existing /api/media/uploads/... routes for the pieces, status, complete, cancel and mine
// Audit: file.upload_started|completed|failed|cancelled with target { type: 'attachment', id: <attachment id>, label: <title> };
//   a finished upload also records content.attachment.added (metadata { kind, source: 'upload', topicId, topicTitle })
// test/helpers/courses.ts: startAttachmentUploadViaApi(app, session, topicId, overrides?): Promise<StartedUpload>;
//   uploadAttachment(app, storage, session, topicId, body?, overrides?)
```

- [ ] **Step 1: Failing tests**

In `apps/api/src/media/file-checks.spec.ts` add the title helper to the import and a block at the end:

In `apps/api/src/media/file-checks.spec.ts` replace:

```ts
import { audioMatches, hasMp3Signature, hasMp4Signature, hasPdfSignature, imageMatches, sanitizeFileName } from './file-checks';
```

with:

```ts
import { audioMatches, hasMp3Signature, hasMp4Signature, hasPdfSignature, imageMatches, sanitizeFileName, titleFromFileName } from './file-checks';
```

Append to `apps/api/src/media/file-checks.spec.ts`:

```ts
describe('titleFromFileName', () => {
  it.each([
    ['Exit map.pdf', 'Exit map'],
    ['archive.tar.gz', 'archive.tar'],
    ['no extension', 'no extension'],
    ['../../etc/passwd.pdf', 'etc passwd'],
    ['.pdf', 'pdf'],
    ['  spaced   out .png ', 'spaced out'],
    ['bad\u0007name.mp3', 'bad name'],
    ['<b>x</b>.mp4', '<b>x< b>'],
  ])('%j becomes the title %j', (input, expected) => {
    expect(titleFromFileName(input)).toBe(expected);
  });

  it('cuts to 200 characters, the longest title there is', () => {
    expect(titleFromFileName(`${'a'.repeat(300)}.pdf`)).toHaveLength(200);
    expect(titleFromFileName(`${'a'.repeat(200)}.pdf`)).toHaveLength(200);
  });
});
```

In `apps/api/src/media/media.schemas.spec.ts` import the new schema and add a block at the end:

In `apps/api/src/media/media.schemas.spec.ts` replace:

```ts
import { descriptionSchema, folderNameSchema, startUploadSchema, titleSchema } from './media.schemas';
```

with:

```ts
import { descriptionSchema, folderNameSchema, startAttachmentUploadSchema, startUploadSchema, titleSchema } from './media.schemas';
```

Append to `apps/api/src/media/media.schemas.spec.ts`:

```ts
describe('the attachment upload schema', () => {
  const valid = { fileName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 10 };

  it('needs no title and accepts the longest one and a length', () => {
    expect(startAttachmentUploadSchema.safeParse(valid).success).toBe(true);
    expect(startAttachmentUploadSchema.safeParse({ ...valid, title: 'T'.repeat(200), durationSeconds: 90 }).success).toBe(true);
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a title of 201 characters', { title: 'T'.repeat(201) }],
    ['a NUL character in the title', { title: 'a\u0000b' }],
    ['no file name', { fileName: '' }],
    ['a NUL character in the file name', { fileName: 'a\u0000.pdf' }],
    ['no type', { contentType: '' }],
    ['an empty file', { sizeBytes: 0 }],
    ['a fractional size', { sizeBytes: 1.5 }],
    ['a negative length', { durationSeconds: -1 }],
  ])('refuses %s', (_name, bad) => {
    expect(startAttachmentUploadSchema.safeParse({ ...valid, ...bad }).success).toBe(false);
  });

  it('leaves the allowed type and size to the declared kind', () => {
    expect(startAttachmentUploadSchema.safeParse({ ...valid, contentType: 'application/zip', sizeBytes: 3 * 1024 ** 3 }).success).toBe(true);
  });
});
```

Add the helpers to `apps/api/test/helpers/courses.ts`:

In `apps/api/test/helpers/courses.ts` replace:

```ts
import { m4aBytes, mp4Bytes, pdfBytes, pngBytes, uniqueName } from './media';
```

with:

```ts
import { completeViaApi, m4aBytes, mp4Bytes, pdfBytes, pngBytes, putPieces, type StartedUpload, uniqueName } from './media';
```

Append to `apps/api/test/helpers/courses.ts`:

```ts
export async function startAttachmentUploadViaApi(
  app: INestApplication,
  session: Session,
  topicId: string,
  overrides: Record<string, unknown> = {},
): Promise<StartedUpload> {
  const res = await request(app.getHttpServer())
    .post(`/api/topics/${topicId}/attachments/uploads`)
    .set(...bearer(session))
    .send({ fileName: 'Exit map.pdf', contentType: 'application/pdf', sizeBytes: 100, ...overrides })
    .expect(201);
  return res.body;
}

// The happy path end to end for an attachment (a PDF unless the body and overrides say otherwise). The declared size
// defaults to the real size. `itemId` in the answer is the attachment's id.
export async function uploadAttachment(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  topicId: string,
  body: Uint8Array = pdfBytes(100),
  overrides: Record<string, unknown> = {},
) {
  const started = await startAttachmentUploadViaApi(app, session, topicId, { sizeBytes: body.length, ...overrides });
  const parts = await putPieces(app, storage, session, started.fileId, body);
  const res = await completeViaApi(app, session, started.fileId, parts);
  return { ...started, parts, res };
}
```

Adapt the milestone 4 `mine` test:

In `apps/api/test/media-uploads.e2e-spec.ts` replace:

```ts
        { fileId: mine.fileId, itemId: mine.itemId, folderId: folder.id, title: 'Mine', fileName: 'mine.mp4', sizeBytes: 321, createdAt: expect.any(String) },
```

with:

```ts
        {
          fileId: mine.fileId,
          itemId: mine.itemId,
          folderId: folder.id,
          topicId: null,
          title: 'Mine',
          fileName: 'mine.mp4',
          sizeBytes: 321,
          createdAt: expect.any(String),
        },
```

Create `apps/api/test/attachment-uploads.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import type { Database } from '../src/db/db.module';
import { auditLog, files, topicAttachments } from '../src/db/schema';
import { MAX_AUDIO_BYTES, MAX_COVER_BYTES, MAX_PDF_BYTES, MAX_VIDEO_BYTES, PART_SIZE } from '../src/storage/storage.constants';
import { StorageError } from '../src/storage/storage.port';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedLesson, seedTopic, startAttachmentUploadViaApi, uploadAttachment } from './helpers/courses';
import { completeViaApi, jpegBytes, m4aBytes, mp3Bytes, mp4Bytes, pdfBytes, pngBytes, putPieces, seedFolder, startUploadViaApi, signIn, uniqueName, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const KINDS = {
  video: { contentType: 'video/mp4', fileName: 'Safety film.mp4', bytes: mp4Bytes, max: MAX_VIDEO_BYTES, pieces: 128, prefix: /^videos\//, words: 'video' },
  audio: { contentType: 'audio/mpeg', fileName: 'Briefing.mp3', bytes: mp3Bytes, max: MAX_AUDIO_BYTES, pieces: 32, prefix: /^audio\//, words: 'audio file' },
  pdf: { contentType: 'application/pdf', fileName: 'Exit map.pdf', bytes: pdfBytes, max: MAX_PDF_BYTES, pieces: 4, prefix: /^documents\//, words: 'PDF' },
  image: { contentType: 'image/png', fileName: 'Floor plan.png', bytes: pngBytes, max: MAX_COVER_BYTES, pieces: 1, prefix: /^images\//, words: 'image' },
} as const;

describe('uploading files into a topic', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const unknown = '00000000-0000-4000-8000-000000000000';
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];
  const start = (session: Session, topicId: string, body: object) =>
    http().post(`/api/topics/${topicId}/attachments/uploads`).set(...bearer(session)).send(body);

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const course = await createCourseViaApi(app, owner.session, { title: 'Fire safety' });
    const lesson = await seedLesson(db, course.id, owner.user.id, 'Exits');
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    return { owner, other, admin, course, topic };
  }

  it('needs a signed-in person', async () => {
    await http().post(`/api/topics/${unknown}/attachments/uploads`).send({}).expect(401);
  });

  describe('starting', () => {
    it.each(Object.entries(KINDS))('creates an uploading %s attachment and a pending file under a random key that never uses the file name', async (kind, rule) => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { fileName: '../../etc/passwd.bin', contentType: rule.contentType, sizeBytes: 100 });
      expect(started).toEqual({ itemId: expect.any(String), fileId: expect.any(String), partSize: PART_SIZE, partCount: 1 });
      const file = await fileRow(started.fileId);
      expect(file).toMatchObject({ purpose: kind, contentType: rule.contentType, status: 'pending', originalName: 'etc passwd.bin', uploadedBy: owner.user.id });
      expect(file.storageKey).toMatch(rule.prefix);
      expect(file.storageKey).toMatch(/\/[0-9a-f-]{36}$/);
      expect(await attachmentRow(started.itemId)).toMatchObject({ topicId: topic.id, kind, status: 'uploading', fileId: started.fileId, libraryItemId: null, title: 'etc passwd', durationSeconds: null });
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'attachment', targetLabel: 'etc passwd', metadata: { fileId: started.fileId, sizeBytes: 100, partCount: 1 } });
      expect(JSON.stringify(entry)).not.toContain(file.storageKey);
    });

    it.each(Object.entries(KINDS))('accepts a %s of exactly the largest size and counts its pieces', async (_kind, rule) => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType: rule.contentType, sizeBytes: rule.max });
      expect(started.partCount).toBe(rule.pieces);
    });

    it.each([
      ['a video one byte over 2 GB', { contentType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes', /2 GB \(MP4\)/],
      ['an audio file one byte over 500 MB', { contentType: 'audio/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB \(MP3 or M4A\)/],
      ['a PDF one byte over 50 MB', { contentType: 'application/pdf', sizeBytes: 52_428_801 }, 'sizeBytes', /PDF files can be at most 50 MB/],
      ['a PNG one byte over 10 MB', { contentType: 'image/png', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB \(JPEG, PNG or WebP\)/],
      ['a JPEG one byte over 10 MB', { contentType: 'image/jpeg', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB/],
      ['a WebP one byte over 10 MB', { contentType: 'image/webp', sizeBytes: 10_485_761 }, 'sizeBytes', /10 MB/],
      ['an empty file', { contentType: 'application/pdf', sizeBytes: 0 }, 'sizeBytes', /empty/],
      ['a GIF', { contentType: 'image/gif' }, 'contentType', /MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images/],
      ['a ZIP archive', { contentType: 'application/zip' }, 'contentType', /PDF files/],
      ['the audio/x-m4a alias', { contentType: 'audio/x-m4a' }, 'contentType', /MP3 or M4A/],
      ['a QuickTime movie', { contentType: 'video/quicktime' }, 'contentType', /MP4 videos/],
      ['a type in capital letters', { contentType: 'APPLICATION/PDF' }, 'contentType', /PDF files/],
    ])('refuses %s in plain words and creates nothing', async (_name, overrides, field, message) => {
      const { owner, topic } = await setup();
      const pending = storage.pendingUploadCount();
      const res = await start(owner.session, topic.id, { fileName: 'a.bin', sizeBytes: 100, ...overrides }).expect(400);
      expect(res.body.fieldErrors[field][0]).toMatch(message);
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it('reports a type that is not allowed alone, whatever the size', async () => {
      const { owner, topic } = await setup();
      const res = await start(owner.session, topic.id, { fileName: 'a.zip', contentType: 'application/zip', sizeBytes: 5 * 1024 ** 4 }).expect(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(['contentType']);
    });

    it('makes the title from the file name unless one is given, and keeps hostile text as it is', async () => {
      const { owner, topic } = await setup();
      const fromName = await startAttachmentUploadViaApi(app, owner.session, topic.id, { fileName: 'Exit map.pdf' });
      expect((await attachmentRow(fromName.itemId)).title).toBe('Exit map');
      const given = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: '  Our map ', fileName: 'x.pdf' });
      expect((await attachmentRow(given.itemId)).title).toBe('Our map');
      const hostile = `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 4)}`;
      const inert = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: hostile });
      expect((await attachmentRow(inert.itemId)).title).toBe(hostile);
      expect((await auditFor('file.upload_started', inert.itemId))[0].targetLabel).toBe(hostile);
      const longest = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'T'.repeat(200) });
      expect((await attachmentRow(longest.itemId)).title).toHaveLength(200);
    });

    it('stores the length when one is given', async () => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType: 'audio/mpeg', fileName: 'a.mp3', durationSeconds: 125 });
      expect((await attachmentRow(started.itemId)).durationSeconds).toBe(125);
    });

    it.each([
      ['a title of 201 characters', { title: 'T'.repeat(201) }, 'title'],
      ['a blank title', { title: '   ' }, 'title'],
      ['a NUL character in the title', { title: 'a\u0000b' }, 'title'],
      ['a NUL character in the file name', { fileName: 'a\u0000.pdf' }, 'fileName'],
      ['a NUL character in the type', { contentType: 'application/pdf\u0000' }, 'contentType'],
      ['no file name', { fileName: '' }, 'fileName'],
      ['no type', { contentType: '' }, 'contentType'],
      ['a fractional size', { sizeBytes: 1.5 }, 'sizeBytes'],
      ['a negative length', { durationSeconds: -1 }, 'durationSeconds'],
    ])('refuses %s with the field named', async (_name, overrides, field) => {
      const { owner, topic } = await setup();
      const res = await start(owner.session, topic.id, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100, ...overrides }).expect(400);
      expect(res.body.fieldErrors).toHaveProperty(field);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });

    it('answers 404 for an unknown topic whatever is declared, and 400 for a malformed id', async () => {
      const { owner } = await setup();
      await start(owner.session, unknown, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(404);
      await start(owner.session, unknown, { fileName: 'a.zip', contentType: 'application/zip', sizeBytes: 100 }).expect(404);
      await start(owner.session, 'nope', { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(400);
    });

    it('aborts the storage upload and leaves no rows when the database refuses to start it', async () => {
      const { owner, topic } = await setup();
      const pending = storage.pendingUploadCount();
      const spy = jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('the audit write failed'));
      try {
        await start(owner.session, topic.id, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(topicAttachments).where(eq(topicAttachments.topicId, topic.id))).toEqual([]);
    });
  });

  describe('finishing', () => {
    it.each(Object.entries(KINDS))('makes a %s ready for everyone at the end of the topic, with two audit entries and a sentence', async (kind, rule) => {
      const { owner, other, admin, topic } = await setup();
      const title = uniqueName('Exit file');
      const { itemId, fileId, res } = await uploadAttachment(app, storage, owner.session, topic.id, rule.bytes(300), { contentType: rule.contentType, fileName: rule.fileName, title });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, topicId: topic.id, kind, title, source: 'upload', status: 'ready', sizeBytes: 300, position: 0, libraryItemId: null });
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|uploadId|fileId/);
      expect(await fileRow(fileId)).toMatchObject({ status: 'ready', uploadId: null, completedAt: expect.any(Date) });
      const key = (await fileRow(fileId)).storageKey;
      expect(await storage.head(key)).toEqual({ size: 300, contentType: rule.contentType });
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(detail.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([itemId]);
      expect(await auditFor('file.upload_completed', itemId)).toEqual([expect.objectContaining({ actorId: owner.user.id, targetType: 'attachment', targetLabel: title })]);
      const [added] = await auditFor('content.attachment.added', itemId);
      expect(added).toMatchObject({ metadata: { kind, source: 'upload', topicId: topic.id, topicTitle: 'Fire exits' } });
      expect(JSON.stringify([added, ...(await auditFor('file.upload_completed', itemId))])).not.toMatch(/memory:|videos\/|audio\/|documents\/|images\//);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'content.attachment.added')?.summary).toBe(`Test User added the ${rule.words} '${title}' to the topic 'Fire exits'`);
    });

    it('puts a finished attachment after the ready ones even when it started before them', async () => {
      const { owner, topic } = await setup();
      const slow = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Slow' });
      const first = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'First' });
      const second = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'Second' });
      expect([first.res.body.position, second.res.body.position]).toEqual([0, 1]);
      const parts = await putPieces(app, storage, owner.session, slow.fileId, pdfBytes(100));
      const done = await completeViaApi(app, owner.session, slow.fileId, parts);
      expect(done.body).toMatchObject({ title: 'Slow', position: 2 });
    });

    it('joins several pieces, including a small last piece', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 1024);
      const { fileId, parts, res } = await uploadAttachment(app, storage, owner.session, topic.id, body);
      expect(parts).toHaveLength(2);
      expect(res.status).toBe(200);
      expect(await storage.head((await fileRow(fileId)).storageKey)).toEqual({ size: body.length, contentType: 'application/pdf' });
    });

    it('accepts a PDF that is only its five marker bytes and refuses near misses', async () => {
      const { owner, topic } = await setup();
      const ascii = (text: string) => new Uint8Array([...text].map((character) => character.charCodeAt(0)));
      expect((await uploadAttachment(app, storage, owner.session, topic.id, ascii('%PDF-'))).res.status).toBe(200);
      for (const body of [ascii('%PDF'), ascii(' %PDF-1.4'), ascii('%pdf-1.4'), ascii('%PDF1.4'), new Uint8Array([0x25, 0x50, 0x44, 0x46])]) {
        const attempt = await uploadAttachment(app, storage, owner.session, topic.id, body);
        expect(attempt.res.status).toBe(422);
        expect(attempt.res.body.message).toMatch(/not a valid PDF/);
        expect(await fileRow(attempt.fileId)).toBeUndefined();
        expect(await attachmentRow(attempt.itemId)).toBeUndefined();
      }
    });

    it.each([
      ['a video that is really a PDF', 'video/mp4', 'a.mp4', pdfBytes, 'not_mp4', /MP4/],
      ['an MP3 that is really a JPEG', 'audio/mpeg', 'a.mp3', jpegBytes, 'not_audio', /MP3 or M4A/],
      ['an M4A that is really a PDF', 'audio/mp4', 'a.m4a', pdfBytes, 'not_audio', /MP3 or M4A/],
      ['a PDF that is really an MP4', 'application/pdf', 'a.pdf', mp4Bytes, 'not_pdf', /not a valid PDF/],
      ['a PDF that is really a JPEG', 'application/pdf', 'a.pdf', jpegBytes, 'not_pdf', /not a valid PDF/],
      ['a PNG that is really a PDF', 'image/png', 'a.png', pdfBytes, 'not_image', /JPEG, PNG or WebP/],
      ['a JPEG that is really a PNG', 'image/jpeg', 'a.jpg', pngBytes, 'not_image', /JPEG, PNG or WebP/],
      ['a WebP that is really a JPEG', 'image/webp', 'a.webp', jpegBytes, 'not_image', /JPEG, PNG or WebP/],
    ])('discards %s, removes its rows and its object and records why', async (_name, contentType, fileName, make, reason, message) => {
      const { owner, admin, topic } = await setup();
      const title = uniqueName('Wrong bytes');
      const body = make(64);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { contentType, fileName, title, sizeBytes: body.length });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(message);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await attachmentRow(started.itemId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry).toMatchObject({ targetType: 'attachment', metadata: { fileId: started.fileId, reason } });
      expect(JSON.stringify(entry)).not.toContain(key);
      expect(await auditFor('content.attachment.added', started.itemId)).toEqual([]);
      const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
      expect(detail.body.attachments).toEqual([]);
      const items = (await http().get(`/api/audit?q=${encodeURIComponent(title)}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
        action: string;
        summary: string;
      }[];
      expect(items.find((item) => item.action === 'file.upload_failed')?.summary).toMatch(/^The upload of .* failed \(the file is not a valid /);
    });

    it('discards a file whose size differs from the declared size', async () => {
      const { owner, topic } = await setup();
      for (const actual of [99, 101]) {
        const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: 100 });
        const parts = await putPieces(app, storage, owner.session, started.fileId, pdfBytes(actual));
        const res = await completeViaApi(app, owner.session, started.fileId, parts);
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/size/i);
        expect(await attachmentRow(started.itemId)).toBeUndefined();
        expect((await auditFor('file.upload_failed', started.itemId))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
      }
    });

    it('is safe to repeat: the second call returns the ready attachment and adds nothing', async () => {
      const { owner, topic } = await setup();
      const { itemId, fileId, parts } = await uploadAttachment(app, storage, owner.session, topic.id);
      const again = await completeViaApi(app, owner.session, fileId, parts);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
      expect(await auditFor('content.attachment.added', itemId)).toHaveLength(1);
    });

    it('is safe when three requests finish the same upload at once', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(300);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const results = await Promise.all([1, 2, 3].map(() => completeViaApi(app, owner.session, started.fileId, parts)));
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(await auditFor('file.upload_completed', started.itemId)).toHaveLength(1);
      expect(await auditFor('content.attachment.added', started.itemId)).toHaveLength(1);
      expect((await attachmentRow(started.itemId)).status).toBe('ready');
    });

    it('refuses while pieces are missing, keeps the upload, and works after the missing piece arrives', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 10);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const first = await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const refused = await completeViaApi(app, owner.session, started.fileId, first);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/missing/i);
      expect((await fileRow(started.fileId)).status).toBe('pending');
      const second = await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      expect((await completeViaApi(app, owner.session, started.fileId, [...second, ...first])).status).toBe(200);
    });

    it('is for the uploader or an Admin only, and 404s once the upload is gone', async () => {
      const { owner, other, admin, topic } = await setup();
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, other.session, started.fileId, parts)).status).toBe(403);
      expect((await completeViaApi(app, admin.session, started.fileId, parts)).status).toBe(200);
      await http().post(`/api/media/uploads/${unknown}/complete`).set(...bearer(owner.session)).send({ parts }).expect(404);
    });

    describe('when the stored file disappears between the size check and the signature check', () => {
      const prepare = async () => {
        const { owner, topic } = await setup();
        const body = pdfBytes(100);
        const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
        const parts = await putPieces(app, storage, owner.session, started.fileId, body);
        return { owner, started, parts };
      };

      it('answers 409 and keeps a pending upload that is still there', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'readRange').mockRejectedValueOnce(new StorageError('not_found', 'No such object.'));
        try {
          const res = await completeViaApi(app, owner.session, started.fileId, parts);
          expect(res.status).toBe(409);
          expect(res.body.message).toMatch(/no longer be continued/);
          expect((await fileRow(started.fileId)).status).toBe('pending');
          expect((await attachmentRow(started.itemId)).status).toBe('uploading');
        } finally {
          spy.mockRestore();
        }
      });

      it('answers 404 when the upload was cancelled in that moment', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'readRange').mockImplementationOnce(async () => {
          await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
          throw new StorageError('not_found', 'No such object.');
        });
        try {
          await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
          expect(await attachmentRow(started.itemId)).toBeUndefined();
        } finally {
          spy.mockRestore();
        }
      });

      it('answers 409, never 500, when the object is gone before the size check', async () => {
        const { owner, started, parts } = await prepare();
        const spy = jest.spyOn(storage, 'head').mockResolvedValueOnce(null);
        try {
          await completeViaApi(app, owner.session, started.fileId, parts).expect(409);
        } finally {
          spy.mockRestore();
        }
        expect((await attachmentRow(started.itemId)).status).toBe('uploading');
      });
    });
  });

  describe('resuming and listing', () => {
    it('reports the pieces, hands out links and refuses a piece number past the end, for the uploader or an Admin', async () => {
      const { owner, other, admin, topic } = await setup();
      const body = pdfBytes(PART_SIZE + 10);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const status = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(status.body).toMatchObject({ fileId: started.fileId, itemId: started.itemId, status: 'pending', partSize: PART_SIZE, partCount: 2, uploadedParts: [{ partNumber: 1, size: PART_SIZE }] });
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(other.session)).expect(403);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(admin.session)).expect(200);
      const links = await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [2] }).expect(200);
      expect(links.body.urls['2']).toMatch(/^memory:\/\/part\//);
      await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [3] }).expect(400);
    });

    it('lists my unfinished attachment uploads with their topic and no folder, newest first, beside library uploads', async () => {
      const { owner, other, topic } = await setup();
      const folder = await seedFolder(db, owner.user.id);
      const library = await startUploadViaApi(app, owner.session, folder.id, { title: 'Library one', sizeBytes: 50 });
      const first = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'First', fileName: 'first.pdf', sizeBytes: 321 });
      const second = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Second', fileName: 'second.pdf', sizeBytes: 123 });
      await startAttachmentUploadViaApi(app, other.session, topic.id);
      await uploadAttachment(app, storage, owner.session, topic.id);
      const res = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(res.body).toEqual([
        { fileId: second.fileId, itemId: second.itemId, folderId: null, topicId: topic.id, title: 'Second', fileName: 'second.pdf', sizeBytes: 123, createdAt: expect.any(String) },
        { fileId: first.fileId, itemId: first.itemId, folderId: null, topicId: topic.id, title: 'First', fileName: 'first.pdf', sizeBytes: 321, createdAt: expect.any(String) },
        { fileId: library.fileId, itemId: library.itemId, folderId: folder.id, topicId: null, title: 'Library one', fileName: 'clip.mp4', sizeBytes: 50, createdAt: expect.any(String) },
      ]);
    });

    it('keeps an attachment that is still uploading out of view of everyone else', async () => {
      const { owner, other, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id);
      const theirs = await http().get(`/api/topics/${topic.id}`).set(...bearer(other.session)).expect(200);
      expect(theirs.body.attachments).toEqual([]);
      await http().post(`/api/attachments/${started.itemId}/open`).set(...bearer(other.session)).expect(404);
    });
  });

  describe('cancelling', () => {
    it('removes a pending upload, aborts it in storage and audits it with the attachment as the target', async () => {
      const { owner, topic } = await setup();
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Half a map' });
      await putPieces(app, storage, owner.session, started.fileId, pdfBytes(100));
      const key = (await fileRow(started.fileId)).storageKey;
      const before = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(before - 1);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await attachmentRow(started.itemId)).toBeUndefined();
      const [entry] = await auditFor('file.upload_cancelled', started.itemId);
      expect(entry).toMatchObject({ targetType: 'attachment', targetLabel: 'Half a map', metadata: { fileId: started.fileId } });
      expect(JSON.stringify(entry)).not.toContain(key);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(404);
    });

    it('never touches a finished attachment', async () => {
      const { owner, topic } = await setup();
      const { itemId, fileId } = await uploadAttachment(app, storage, owner.session, topic.id);
      const key = (await fileRow(fileId)).storageKey;
      const res = await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toMatch(/already finished/);
      expect((await attachmentRow(itemId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    });

    it('lets an Admin cancel anyone\'s upload but not another Staff member', async () => {
      const { owner, other, admin, topic } = await setup();
      const first = await startAttachmentUploadViaApi(app, owner.session, topic.id);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(other.session)).expect(403);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(admin.session)).expect(204);
    });

    it('stops a later finish with 404 instead of resurrecting the attachment', async () => {
      const { owner, topic } = await setup();
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    });
  });

  it('never puts links or storage keys in any audit entry of these uploads', async () => {
    const { owner, topic } = await setup();
    const { itemId, fileId } = await uploadAttachment(app, storage, owner.session, topic.id);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rows)).not.toContain((await fileRow(fileId)).storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|documents\/|X-Amz|dev-storage/);
  });

  it('keeps an attachment of one topic out of another topic\'s list', async () => {
    const { owner, course, topic } = await setup();
    const lesson = await seedLesson(db, course.id, owner.user.id, 'More', 1);
    const sibling = await seedTopic(db, lesson.id, owner.user.id, 'Other topic');
    const { itemId } = await uploadAttachment(app, storage, owner.session, topic.id);
    const detail = await http().get(`/api/topics/${sibling.id}`).set(...bearer(owner.session)).expect(200);
    expect(detail.body.attachments).toEqual([]);
    expect((await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200)).body.attachments[0].id).toBe(itemId);
  });

  it.each([
    ['webp', webpBytes, 'image/webp', 'Plan.webp'],
    ['m4a', m4aBytes, 'audio/mp4', 'Briefing.m4a'],
  ])('also finishes a %s declared with its own type', async (_name, make, contentType, fileName) => {
    const { owner, topic } = await setup();
    const { res } = await uploadAttachment(app, storage, owner.session, topic.id, make(100), { contentType, fileName });
    expect(res.status).toBe(200);
  });
});
```

Run: `npm test -w @jbf/api -- file-checks media.schemas attachment-uploads media-uploads`
Expected: FAIL (no route, no schema, no title helper, `topicId` missing from `mine`).

- [ ] **Step 2: The title helper and the schema**

Append to `apps/api/src/media/file-checks.ts`:

In `apps/api/src/media/file-checks.ts`, after:

```ts
  return cleaned === '' ? 'video.mp4' : cleaned;
}
```

add:

```ts

// A title made from a file name: tidied like any stored file name, without its extension, at most 200 characters (the
// longest title). The tidied name never starts with a space or a dot, so the title is never empty.
export function titleFromFileName(input: string): string {
  return sanitizeFileName(input).replace(/\.[^.]+$/, '').slice(0, 200).trim();
}
```

In `apps/api/src/media/media.schemas.ts` share the file fields between the library upload and the attachment upload:

In `apps/api/src/media/media.schemas.ts` replace:

```ts
export const startUploadSchema = z.object({
  folderId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema.nullish(),
  fileName: z.string().min(1, 'The file needs a name.').max(1000).refine(hasNoNul, NUL_MESSAGE),
  // Which types and sizes are allowed depends on the folder's category, so the service checks them (media-kinds.ts).
  contentType: z.string().min(1, 'Choose a file.').max(100, 'Choose a file.').refine(hasNoNul, NUL_MESSAGE),
  sizeBytes: z.number('Choose a file.').int('Choose a file.').min(1, 'That file is empty.'),
  durationSeconds: z.number().int().min(0).max(1_000_000).nullish(),
});
```

with:

```ts
// The file an upload starts with. Which types and sizes are allowed depends on the folder's category (library) or on the
// declared type (attachments), so the service checks them (media-kinds.ts).
const uploadFileFields = {
  fileName: z.string().min(1, 'The file needs a name.').max(1000).refine(hasNoNul, NUL_MESSAGE),
  contentType: z.string().min(1, 'Choose a file.').max(100, 'Choose a file.').refine(hasNoNul, NUL_MESSAGE),
  sizeBytes: z.number('Choose a file.').int('Choose a file.').min(1, 'That file is empty.'),
  durationSeconds: z.number().int().min(0).max(1_000_000).nullish(),
};

export const startUploadSchema = z.object({
  folderId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema.nullish(),
  ...uploadFileFields,
});

// An attachment has no folder, and its title defaults to the file name.
export const startAttachmentUploadSchema = z.object({ title: titleSchema.optional(), ...uploadFileFields });
```

In `apps/api/src/media/media.schemas.ts`, after:

```ts
export type LibraryAttachmentInput = z.infer<typeof libraryAttachmentSchema>;
```

add:

```ts
export type StartAttachmentUploadInput = z.infer<typeof startAttachmentUploadSchema>;
```

- [ ] **Step 3: Removing what an upload leaves behind, for either kind of owner**

In `apps/api/src/media/remove-unfinished.ts` keep `removeUnfinishedItem` as it is (the cleanup job still uses it until Task 7) and add the attachment case and the function that tries both:

In `apps/api/src/media/remove-unfinished.ts` replace:

```ts
import { type FileRow, files, mediaFolders, mediaItems } from '../db/schema';
```

with:

```ts
import { type FileRow, files, mediaFolders, mediaItems, topicAttachments } from '../db/schema';
```

Append to `apps/api/src/media/remove-unfinished.ts`:

```ts

export interface RemovedUpload {
  // What was removed, as the audit log names it: a library item by its category, or an attachment.
  target: { type: string; id: string; label: string };
  cover: RemovedUnfinished['cover'];
}

// Removes whatever the unfinished file belongs to, inside the caller's transaction: a library item (with its cover) or a
// topic attachment. The owner's row goes first, taking its lock, then the file row: the same order as everywhere else.
// Returns null when nothing unfinished owned the file (it finished or was removed meanwhile), so a ready one is never removed.
export async function removeUnfinished(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const item = await removeUnfinishedItem(tx, fileId);
  if (item) return { target: { type: item.item.category, id: item.item.id, label: item.item.title }, cover: item.cover };
  const [attachment] = await tx
    .delete(topicAttachments)
    .where(and(eq(topicAttachments.fileId, fileId), eq(topicAttachments.status, 'uploading')))
    .returning({ id: topicAttachments.id, title: topicAttachments.title });
  if (!attachment) return null;
  await tx.delete(files).where(eq(files.id, fileId));
  return { target: { type: 'attachment', id: attachment.id, label: attachment.title ?? '' }, cover: null };
}
```

- [ ] **Step 4: The engine for both owners**

Replace the whole of `apps/api/src/media/uploads.service.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuditAction } from '../audit/audit.actions';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbTransaction } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaFolders, mediaItems, type TopicAttachment, topicAttachments, topics } from '../db/schema';
import { LINK_TTL_SECONDS, PART_SIZE, partCountFor } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort, type StoredPart } from '../storage/storage.port';
import { actorOf } from './actor';
import { type AttachmentView, AttachmentsService } from './attachments.service';
import { discardStoredFile } from './discard';
import { sanitizeFileName, titleFromFileName } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import { attachmentFieldErrors, attachmentKindFor, type KindRule, kindOf, MEDIA_KINDS, type MediaCategory, type MediaKind, uploadFieldErrors } from './media-kinds';
import type { StartAttachmentUploadInput, StartUploadInput } from './media.schemas';
import { removeUnfinished, type RemovedUpload } from './remove-unfinished';

const GONE = 'This upload no longer exists.';
const LOST_UPLOAD = 'This upload can no longer be continued. Cancel it and start again.';
const MISSING_PIECES = 'Some pieces are missing. Resume the upload to send them.';
const BAD_PIECES = 'Some pieces are missing or damaged. Resume the upload to send them again.';
const FINISHED = 'This upload has already finished.';

const FAILURE_MESSAGES = {
  size_mismatch: 'The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.',
  not_mp4: 'That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).',
  not_audio: 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.',
  not_pdf: 'That file is not a valid PDF, so it was discarded. Please choose another file.',
  not_image: 'That file is not a valid JPEG, PNG or WebP image, so it was discarded. Please choose another file.',
} as const;

type FailureReason = keyof typeof FAILURE_MESSAGES;

// An unfinished upload of the person asking, for the resume list: it belongs to a folder (library) or to a topic (attachment).
export interface PendingUpload {
  fileId: string;
  itemId: string;
  folderId: string | null;
  topicId: string | null;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

type AuditTarget = { type: string; id: string; label: string };

// What an upload belongs to: a library item (its folder's category decides what kind of file it is and how it is checked)
// or an attachment of a topic (which carries its own kind).
type UploadOwner = { type: 'item'; item: MediaItem; category: MediaCategory } | { type: 'attachment'; attachment: TopicAttachment };
type UploadRow = { file: FileRow; owner: UploadOwner };

const kindRuleOf = (owner: UploadOwner): KindRule => (owner.type === 'item' ? kindOf(owner.category) : MEDIA_KINDS[owner.attachment.kind]);

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
    private readonly attachments: AttachmentsService,
  ) {}

  async start(actor: AuthUser, input: StartUploadInput): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const [folder] = await this.db
      .select({ id: mediaFolders.id, category: mediaFolders.category })
      .from(mediaFolders)
      .where(eq(mediaFolders.id, input.folderId));
    if (!folder) throw new NotFoundException('Folder not found.');
    // The folder decides what may be uploaded; nothing the browser says about the kind is trusted.
    const fieldErrors = uploadFieldErrors(folder.category, input.contentType, input.sizeBytes);
    if (fieldErrors) throw new BadRequestException({ error: 'Bad Request', message: 'Validation failed', fieldErrors });

    return this.begin(actor, kindOf(folder.category), input, async (tx, file) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
        .from(mediaItems)
        .where(eq(mediaItems.folderId, folder.id));
      const [item] = await tx
        .insert(mediaItems)
        .values({
          folderId: folder.id,
          title: input.title,
          description: input.description ?? null,
          position: next,
          mediaFileId: file.id,
          durationSeconds: input.durationSeconds ?? null,
          status: 'uploading',
          createdBy: actor.id,
        })
        .returning();
      return { id: item.id, target: { type: folder.category, id: item.id, label: item.title } };
    });
  }

  async startAttachment(
    actor: AuthUser,
    topicId: string,
    input: StartAttachmentUploadInput,
  ): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const [topic] = await this.db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
    if (!topic) throw new NotFoundException('Topic not found.');
    // An attachment has no folder: the declared type decides the kind, and the size limit is that kind's.
    const fieldErrors = attachmentFieldErrors(input.contentType, input.sizeBytes);
    if (fieldErrors) throw new BadRequestException({ error: 'Bad Request', message: 'Validation failed', fieldErrors });
    // No field error means the declared type belongs to a kind.
    const kindName = attachmentKindFor(input.contentType) as MediaKind;
    const title = input.title ?? titleFromFileName(input.fileName);

    return this.begin(actor, MEDIA_KINDS[kindName], input, async (tx, file) => {
      // The topic row is locked (parent before child), so two uploads started at once get different positions.
      await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).for('update');
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
        .from(topicAttachments)
        .where(eq(topicAttachments.topicId, topicId));
      const [attachment] = await tx
        .insert(topicAttachments)
        .values({
          topicId,
          position: next,
          kind: kindName,
          title,
          fileId: file.id,
          durationSeconds: input.durationSeconds ?? null,
          status: 'uploading',
          createdBy: actor.id,
        })
        .returning();
      return { id: attachment.id, target: { type: 'attachment', id: attachment.id, label: title } };
    });
  }

  async partUrls(actor: AuthUser, fileId: string, partNumbers: number[]): Promise<{ urls: Record<string, string> }> {
    const { file } = await this.load(fileId, actor);
    if (file.status !== 'pending' || !file.uploadId) throw new ConflictException(FINISHED);
    const { uploadId, partCount } = { uploadId: file.uploadId, partCount: file.partCount ?? 0 };
    const wanted = [...new Set(partNumbers)];
    if (wanted.some((number) => number > partCount)) {
      throw new BadRequestException(`Piece numbers must be between 1 and ${partCount}.`);
    }
    const links = await Promise.all(wanted.map((number) => this.storage.presignUploadPart(file.storageKey, uploadId, number, LINK_TTL_SECONDS)));
    return { urls: Object.fromEntries(wanted.map((number, index) => [String(number), links[index]])) };
  }

  async status(
    actor: AuthUser,
    fileId: string,
  ): Promise<{ fileId: string; itemId: string; status: FileRow['status']; partSize: number; partCount: number; uploadedParts: StoredPart[] }> {
    const { file, owner } = await this.load(fileId, actor);
    const base = {
      fileId: file.id,
      itemId: owner.type === 'item' ? owner.item.id : owner.attachment.id,
      status: file.status,
      partSize: file.partSize ?? PART_SIZE,
      partCount: file.partCount ?? 0,
    };
    if (file.status === 'ready' || !file.uploadId) return { ...base, uploadedParts: [] };
    try {
      return { ...base, uploadedParts: await this.storage.listParts(file.storageKey, file.uploadId) };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'no_such_upload') throw new ConflictException(LOST_UPLOAD);
      throw error;
    }
  }

  async complete(actor: AuthUser, fileId: string, parts: { partNumber: number; etag: string }[]): Promise<ItemView | AttachmentView> {
    const row = await this.load(fileId, actor);
    const { file, owner } = row;
    if (file.status === 'ready') return this.viewOf(owner, actor);
    if (!file.uploadId) throw new ConflictException(LOST_UPLOAD);

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (sorted.length !== file.partCount || sorted.some((part, index) => part.partNumber !== index + 1)) {
      throw new UnprocessableEntityException(MISSING_PIECES);
    }
    try {
      await this.storage.completeMultipartUpload(file.storageKey, file.uploadId, sorted);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      if (error.code === 'invalid_part' || error.code === 'part_too_small') throw new UnprocessableEntityException(BAD_PIECES);
      if (error.code !== 'no_such_upload') throw error;
      // Someone else (or an earlier attempt that failed after storage finished) already joined the pieces:
      // carry on and judge what is stored.
    }

    const info = await this.storage.head(file.storageKey);
    if (!info) return this.afterVanish(actor, fileId);
    if (info.size !== file.sizeBytes) return this.fail(actor, row, 'size_mismatch');
    // A cancel or the cleanup job can remove the object between the size check and this read.
    const head = await this.storage.readRange(file.storageKey, 0, 15).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === 'not_found') return null;
      throw error;
    });
    if (!head) return this.afterVanish(actor, fileId);
    // The stored type must be the declared one, and the first bytes must match it (an MP4 "ftyp", an MP3 frame or ID3 tag,
    // the "%PDF-" marker, an image signature).
    const kind = kindRuleOf(owner);
    if (info.contentType !== file.contentType || !kind.matches(head, file.contentType)) return this.fail(actor, row, kind.failureReason);
    return this.finish(actor, row);
  }

  async cancel(actor: AuthUser, fileId: string): Promise<void> {
    const row = await this.load(fileId, actor);
    if (row.file.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
    const removed = await this.removePending(row.file, { actor, action: 'file.upload_cancelled', metadata: { fileId } });
    if (!removed) {
      const [current] = await this.db.select({ status: files.status }).from(files).where(eq(files.id, fileId));
      if (current?.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
      return;
    }
    await this.discardRemoved(row.file, removed);
  }

  // My unfinished uploads, newest first: library uploads belong to a folder, attachment uploads to a topic.
  async mine(actor: AuthUser): Promise<PendingUpload[]> {
    const pending = and(eq(files.uploadedBy, actor.id), ne(files.purpose, 'cover'), eq(files.status, 'pending'));
    const libraryRows = await this.db
      .select({
        fileId: files.id,
        itemId: mediaItems.id,
        folderId: mediaItems.folderId,
        title: mediaItems.title,
        fileName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .where(pending);
    const attachmentRows = await this.db
      .select({
        fileId: files.id,
        itemId: topicAttachments.id,
        topicId: topicAttachments.topicId,
        title: topicAttachments.title,
        fileName: files.originalName,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      })
      .from(files)
      .innerJoin(topicAttachments, eq(topicAttachments.fileId, files.id))
      .where(pending);
    return [
      ...libraryRows.map((row): PendingUpload => ({ ...row, topicId: null })),
      ...attachmentRows.map((row): PendingUpload => ({ ...row, title: row.title ?? '', folderId: null })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Storage first, then the database in one transaction: if the transaction fails the storage side is rolled back.
  private async begin(
    actor: AuthUser,
    kind: KindRule,
    input: { fileName: string; contentType: string; sizeBytes: number },
    createOwner: (tx: DbTransaction, file: FileRow) => Promise<{ id: string; target: AuditTarget }>,
  ): Promise<{ itemId: string; fileId: string; partSize: number; partCount: number }> {
    const key = `${kind.keyPrefix}/${randomUUID()}`;
    const partCount = partCountFor(input.sizeBytes);
    const uploadId = await this.storage.createMultipartUpload(key, input.contentType);
    try {
      return await this.db.transaction(async (tx) => {
        const [file] = await tx
          .insert(files)
          .values({
            purpose: kind.purpose,
            storageKey: key,
            originalName: sanitizeFileName(input.fileName),
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            uploadId,
            partSize: PART_SIZE,
            partCount,
            uploadedBy: actor.id,
          })
          .returning();
        const owner = await createOwner(tx, file);
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'file.upload_started',
          target: owner.target,
          metadata: { fileId: file.id, sizeBytes: input.sizeBytes, partCount },
        });
        return { itemId: owner.id, fileId: file.id, partSize: PART_SIZE, partCount };
      });
    } catch (error) {
      await this.storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  // The owner of a file, whoever is asking: the library item whose main file it is, or the attachment it was uploaded for.
  // Never a cover (covers have their own routes).
  private async find(fileId: string): Promise<UploadRow | null> {
    const [asItem] = await this.db
      .select({ file: files, item: mediaItems, category: mediaFolders.category })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .where(and(eq(files.id, fileId), ne(files.purpose, 'cover')));
    if (asItem) return { file: asItem.file, owner: { type: 'item', item: asItem.item, category: asItem.category } };
    const [asAttachment] = await this.db
      .select({ file: files, attachment: topicAttachments })
      .from(files)
      .innerJoin(topicAttachments, eq(topicAttachments.fileId, files.id))
      .where(and(eq(files.id, fileId), ne(files.purpose, 'cover')));
    return asAttachment ? { file: asAttachment.file, owner: { type: 'attachment', attachment: asAttachment.attachment } } : null;
  }

  private async load(fileId: string, actor: AuthUser): Promise<UploadRow> {
    const row = await this.find(fileId);
    if (!row) throw new NotFoundException('Upload not found.');
    if (row.file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    return row;
  }

  private viewOf(owner: UploadOwner, actor: AuthUser): Promise<ItemView | AttachmentView> {
    return owner.type === 'item' ? this.items.view(owner.item.id, actor) : this.attachments.view(owner.attachment.id, actor);
  }

  // The object is not in storage any more: either another request finished the job, or the upload was cancelled.
  private async afterVanish(actor: AuthUser, fileId: string): Promise<ItemView | AttachmentView> {
    const row = await this.find(fileId);
    if (!row) throw new NotFoundException(GONE);
    if (row.file.status === 'ready') return this.viewOf(row.owner, actor);
    throw new ConflictException(LOST_UPLOAD);
  }

  // Removes the rows of a still-pending upload (and a library item's cover) and records why. Returns null when someone
  // else already removed it (or the upload finished meanwhile), so a ready item or attachment is never removed.
  private async removePending(
    file: FileRow,
    outcome: { actor: AuthUser; action: AuditAction; metadata: Record<string, unknown> },
  ): Promise<RemovedUpload | null> {
    return this.db.transaction(async (tx) => {
      const removed = await removeUnfinished(tx, file.id);
      if (!removed) return null;
      await this.audit.record(tx, { actor: actorOf(outcome.actor), action: outcome.action, target: removed.target, metadata: outcome.metadata });
      return removed;
    });
  }

  // Storage calls stay outside the transaction and are best effort.
  private async discardRemoved(file: FileRow, removed: RemovedUpload): Promise<void> {
    await discardStoredFile(this.storage, this.logger, file);
    if (removed.cover) await discardStoredFile(this.storage, this.logger, { ...removed.cover, uploadId: null });
  }

  private async fail(actor: AuthUser, row: UploadRow, reason: FailureReason): Promise<never> {
    const removed = await this.removePending(row.file, { actor, action: 'file.upload_failed', metadata: { fileId: row.file.id, reason } });
    if (removed) await this.discardRemoved(row.file, removed);
    throw new UnprocessableEntityException(FAILURE_MESSAGES[reason]);
  }

  private async finish(actor: AuthUser, { file, owner }: UploadRow): Promise<ItemView | AttachmentView> {
    const outcome = await this.db.transaction((tx) =>
      owner.type === 'item' ? this.finishItem(tx, actor, file, owner) : this.finishAttachment(tx, actor, file, owner.attachment),
    );
    if (outcome === 'gone') {
      // Cancelled while the pieces were being joined: the stored object has no owner any more.
      await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
      throw new NotFoundException(GONE);
    }
    return this.viewOf(owner, actor);
  }

  private async finishItem(tx: DbTransaction, actor: AuthUser, file: FileRow, owner: Extract<UploadOwner, { type: 'item' }>): Promise<'gone' | 'done'> {
    const { item, category } = owner;
    // Lock the item row first, as removePending does (it deletes the item row, then the file row): taking the
    // locks in the same order is what keeps a cancel and a finish that overlap from deadlocking.
    const [locked] = await tx.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
    if (!locked) return 'gone';
    if (locked.status === 'ready') return 'done';
    const [{ end }] = await tx
      .select({ end: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
      .from(mediaItems)
      .where(and(eq(mediaItems.folderId, item.folderId), eq(mediaItems.status, 'ready')));
    const now = new Date();
    await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
    await tx.update(mediaItems).set({ status: 'ready', position: end, updatedAt: now }).where(eq(mediaItems.id, item.id));
    const target = { type: category, id: item.id, label: item.title };
    await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
    await this.audit.record(tx, { actor: actorOf(actor), action: 'content.video.added', target, metadata: { folderId: item.folderId, category } });
    return 'done';
  }

  private async finishAttachment(tx: DbTransaction, actor: AuthUser, file: FileRow, attachment: TopicAttachment): Promise<'gone' | 'done'> {
    // The attachment row first, then the file row, exactly as removePending does.
    const [locked] = await tx.select({ status: topicAttachments.status }).from(topicAttachments).where(eq(topicAttachments.id, attachment.id)).for('update');
    if (!locked) return 'gone';
    if (locked.status === 'ready') return 'done';
    const [{ end }] = await tx
      .select({ end: sql<number>`coalesce(max(${topicAttachments.position}), -1) + 1`.mapWith(Number) })
      .from(topicAttachments)
      .where(and(eq(topicAttachments.topicId, attachment.topicId), eq(topicAttachments.status, 'ready')));
    const [topic] = await tx.select({ title: topics.title }).from(topics).where(eq(topics.id, attachment.topicId));
    const now = new Date();
    await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
    await tx.update(topicAttachments).set({ status: 'ready', position: end, updatedAt: now }).where(eq(topicAttachments.id, attachment.id));
    const target = { type: 'attachment', id: attachment.id, label: attachment.title ?? '' };
    await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
    await this.audit.record(tx, {
      actor: actorOf(actor),
      action: 'content.attachment.added',
      target,
      metadata: { kind: attachment.kind, source: 'upload', topicId: attachment.topicId, topicTitle: topic.title },
    });
    return 'done';
  }
}
```

In `apps/api/src/media/uploads.controller.ts` the completion answers either kind of view:

In `apps/api/src/media/uploads.controller.ts` replace:

```ts
import type { ItemView } from './items.service';
```

with:

```ts
import type { AttachmentView } from './attachments.service';
import type { ItemView } from './items.service';
```

In `apps/api/src/media/uploads.controller.ts` replace:

```ts
  ): Promise<ItemView> {
    return this.uploads.complete(actor, fileId, body.parts);
```

with:

```ts
  ): Promise<ItemView | AttachmentView> {
    return this.uploads.complete(actor, fileId, body.parts);
```

Export the engine and add the start route to the topics controller:

In `apps/api/src/media/media.module.ts` replace:

```ts
  exports: [AttachmentsService, CoversService, ItemsService],
```

with:

```ts
  exports: [AttachmentsService, CoversService, ItemsService, UploadsService],
```

In `apps/api/src/courses/topics.controller.ts` replace:

```ts
import { type LibraryAttachmentInput, libraryAttachmentSchema, orderSchema } from '../media/media.schemas';
```

with:

```ts
import {
  type LibraryAttachmentInput,
  libraryAttachmentSchema,
  orderSchema,
  type StartAttachmentUploadInput,
  startAttachmentUploadSchema,
} from '../media/media.schemas';
import { UploadsService } from '../media/uploads.service';
```

In `apps/api/src/courses/topics.controller.ts` replace:

```ts
    private readonly attachments: AttachmentsService,
  ) {}
```

with:

```ts
    private readonly attachments: AttachmentsService,
    private readonly uploads: UploadsService,
  ) {}
```

In `apps/api/src/courses/topics.controller.ts`, after:

```ts
    return this.attachments.addFromLibrary(actor, id, body);
  }
```

add:

```ts

  // Starts an upload into the topic; the pieces, status, completion, cancelling and listing then use /api/media/uploads/...
  @Post(':id/attachments/uploads')
  startUpload(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(startAttachmentUploadSchema)) body: StartAttachmentUploadInput,
  ) {
    return this.uploads.startAttachment(actor, id, body);
  }
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (857 API tests), including every milestone 3 and 4 upload, cancel, cleanup and audit test.

To see the storage rollback test bite, delete the `abortMultipartUpload` line in the `catch` of `UploadsService.begin`: "aborts the storage upload and leaves no rows when the database refuses to start it" FAILS. Undo the change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: upload files into topics with the same engine as the library"
```


### Task 7: Abandoned attachment uploads are cleaned up after 24 hours, and cancel, finish and cleanup can race safely

**Files:**
- Modify: `apps/api/src/media/remove-unfinished.ts`, `apps/api/src/media/upload-cleanup.service.ts`
- Test: `apps/api/test/attachment-cleanup.e2e-spec.ts` (new)

**Existing tests to adapt:** none. `media-cleanup.e2e-spec.ts` (library items, their covers, cover files, the three race tests) passes unchanged.

**Interfaces:**
- Consumes: `removeUnfinished`, `RemovedUpload` (Task 6), `UploadsService` (Task 6), `discardStoredFile`, `PENDING_UPLOAD_MAX_AGE_MS`.
- Produces: `remove-unfinished.ts` exports only `removeUnfinished(tx, fileId): Promise<RemovedUpload | null>` and `RemovedUpload` (the library-only `removeUnfinishedItem` becomes a private helper of that file). `UploadCleanupService.run()` removes expired attachment uploads exactly as it removes expired library uploads, recording `file.upload_failed` with reason `expired` and the attachment as the target.

- [ ] **Step 1: Failing tests**

Create `apps/api/test/attachment-cleanup.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, topicAttachments } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createCourseViaApi, seedAttachment, seedLesson, seedTopic, startAttachmentUploadViaApi, uploadAttachment } from './helpers/courses';
import { completeViaApi, pdfBytes, putPieces, seedFolder, seedItem, signIn } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('cleaning up abandoned attachment uploads', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;
  let cleanup: UploadCleanupService;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
    cleanup = app.get(UploadCleanupService);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const age = (fileId: string, hours: number) =>
    db.update(files).set({ createdAt: new Date(Date.now() - hours * HOUR) }).where(eq(files.id, fileId));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const attachmentRow = async (id: string) => (await db.select().from(topicAttachments).where(eq(topicAttachments.id, id)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const course = await createCourseViaApi(app, owner.session);
    const lesson = await seedLesson(db, course.id, owner.user.id);
    const topic = await seedTopic(db, lesson.id, owner.user.id, 'Fire exits');
    return { owner, admin, topic };
  }

  it('removes a pending attachment upload older than 24 hours, aborts it in storage and records why without any key', async () => {
    const { owner, admin, topic } = await setup();
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { title: 'Old map' });
    await putPieces(app, storage, owner.session, started.fileId, pdfBytes(100));
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 25);
    const pending = storage.pendingUploadCount();

    const result = await cleanup.run();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(await attachmentRow(started.itemId)).toBeUndefined();
    expect(storage.pendingUploadCount()).toBe(pending - 1);
    const entries = await auditFor('file.upload_failed', started.itemId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, targetType: 'attachment', targetLabel: 'Old map', metadata: { fileId: started.fileId, reason: 'expired' } });
    expect(JSON.stringify(entries[0])).not.toContain(key);
    const items = (await http().get(`/api/audit?q=${encodeURIComponent('Old map')}&limit=100`).set(...bearer(admin.session)).expect(200)).body.items as {
      action: string;
      summary: string;
    }[];
    expect(items.find((item) => item.action === 'file.upload_failed')?.summary).toBe('The upload of Old map failed (it was not finished within 24 hours)');
  });

  it('leaves recent uploads and every ready attachment alone, however old their file is', async () => {
    const { owner, topic } = await setup();
    const recent = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(recent.fileId, 23);
    const ready = await uploadAttachment(app, storage, owner.session, topic.id);
    await age(ready.fileId, 500);
    const readyKey = (await fileRow(ready.fileId)).storageKey;
    const folder = await seedFolder(db, owner.user.id);
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const library = await seedAttachment(db, { topicId: topic.id, createdBy: owner.user.id, kind: 'video', libraryItemId: item.itemId, position: 5 });

    await cleanup.run();
    expect((await fileRow(recent.fileId)).status).toBe('pending');
    expect((await attachmentRow(recent.itemId)).status).toBe('uploading');
    expect((await attachmentRow(ready.itemId)).status).toBe('ready');
    expect((await fileRow(ready.fileId)).status).toBe('ready');
    expect(storage.has(readyKey)).toBe(true);
    expect(await attachmentRow(library.attachmentId)).toBeDefined();
  });

  it('removes only the expired upload of a topic and leaves the topic and its other attachments', async () => {
    const { owner, topic } = await setup();
    const kept = await uploadAttachment(app, storage, owner.session, topic.id, pdfBytes(100), { title: 'Keep me' });
    const gone = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(gone.fileId, 30);
    await cleanup.run();
    const detail = await http().get(`/api/topics/${topic.id}`).set(...bearer(owner.session)).expect(200);
    expect(detail.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([kept.itemId]);
  });

  it('is harmless to run twice', async () => {
    const { owner, topic } = await setup();
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id);
    await age(started.fileId, 30);
    await cleanup.run();
    expect((await cleanup.run()).removed).toBe(0);
    expect(await auditFor('file.upload_failed', started.itemId)).toHaveLength(1);
  });

  it('answers 404 to a later finish of a cleaned-up upload', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    await cleanup.run();
    await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
  });

  it('never damages an upload that finishes at the same moment: it ends fully ready or fully gone', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const [finish] = await Promise.all([completeViaApi(app, owner.session, started.fileId, parts), cleanup.run()]);
    const attachment = await attachmentRow(started.itemId);
    if (attachment) {
      expect(finish.status).toBe(200);
      expect(attachment.status).toBe('ready');
      expect((await fileRow(started.fileId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    } else {
      expect([404, 409]).toContain(finish.status);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
    }
  });

  // The test above lets the two requests race for real, so either valid ending may occur on a given run. These pin each
  // ending down by forcing the order.
  it('ends fully gone when the cleanup lands between the stored checks and the finishing transaction', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const realRead = storage.readRange.bind(storage);
    const spy = jest.spyOn(storage, 'readRange').mockImplementationOnce(async (...args) => {
      const bytes = await realRead(...args);
      await cleanup.run();
      return bytes;
    });
    try {
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    } finally {
      spy.mockRestore();
    }
    expect(await attachmentRow(started.itemId)).toBeUndefined();
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect(await auditFor('content.attachment.added', started.itemId)).toEqual([]);
  });

  it('leaves an attachment that finished after the cleanup looked at it fully ready', async () => {
    const { owner, topic } = await setup();
    const body = pdfBytes(100);
    const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    const staleSnapshot = await fileRow(started.fileId);
    await completeViaApi(app, owner.session, started.fileId, parts).expect(200);

    expect(await cleanup['expire'](staleSnapshot)).toBeNull();
    expect((await attachmentRow(started.itemId)).status).toBe('ready');
    const ready = await fileRow(started.fileId);
    expect(ready.status).toBe('ready');
    expect(storage.has(ready.storageKey)).toBe(true);
    expect(await auditFor('file.upload_failed', started.itemId)).toEqual([]);
  });

  it('settles cleanly when a cancel and a finish race: either the attachment is ready or everything is gone', async () => {
    const { owner, topic } = await setup();
    for (let round = 0; round < 12; round += 1) {
      const body = pdfBytes(100);
      const started = await startAttachmentUploadViaApi(app, owner.session, topic.id, { sizeBytes: body.length });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const [finish, cancel] = await Promise.all([
        completeViaApi(app, owner.session, started.fileId, parts),
        http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)),
      ]);
      if (finish.status === 200) {
        expect(cancel.status).toBe(409);
        expect((await attachmentRow(started.itemId)).status).toBe('ready');
        expect(storage.has(key)).toBe(true);
      } else {
        expect([finish.status, cancel.status]).toEqual([404, 204]);
        expect(await attachmentRow(started.itemId)).toBeUndefined();
        expect(await fileRow(started.fileId)).toBeUndefined();
        expect(storage.has(key)).toBe(false);
      }
    }
  });

  it('refuses to cancel a ready attachment even when a stale cancel arrives after the finish', async () => {
    const { owner, topic } = await setup();
    const { itemId, fileId, parts } = await uploadAttachment(app, storage, owner.session, topic.id);
    const key = (await fileRow(fileId)).storageKey;
    await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
    await completeViaApi(app, owner.session, fileId, parts).expect(200);
    expect((await attachmentRow(itemId)).status).toBe('ready');
    expect(storage.has(key)).toBe(true);
    expect(await auditFor('file.upload_cancelled', itemId)).toEqual([]);
  });
});
```

Run: `npm test -w @jbf/api -- attachment-cleanup`
Expected: 5 of the 10 tests FAIL, the ones that need an expired attachment upload to be removed (the job still uses the library-only removal); the real race, the cancel race, the stale snapshot, the ready-attachment and the stale-cancel tests already pass because the engine of Task 6 is already generic.

- [ ] **Step 2: One removal for both owners**

Replace the whole of `apps/api/src/media/remove-unfinished.ts` with:

```ts
import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaFolders, mediaItems, topicAttachments } from '../db/schema';

export interface RemovedUpload {
  // What was removed, as the audit log names it: a library item by its category, or an attachment.
  target: { type: string; id: string; label: string };
  // The cover attached to a library item, if any: the caller discards its stored object after the transaction commits.
  cover: Pick<FileRow, 'id' | 'storageKey'> | null;
}

// Removes whatever the unfinished file belongs to, inside the caller's transaction: a library item (with its media file
// row and its cover) or a topic attachment (with its file row). The owner's row goes first, taking its lock, then the file
// rows: the same order as everywhere else. Returns null when nothing unfinished owned the file (it finished or was
// removed meanwhile), so a ready item or attachment is never removed.
export async function removeUnfinished(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  return (await removeItem(tx, fileId)) ?? (await removeAttachment(tx, fileId));
}

// The cover is read from the deleted row, not from an earlier snapshot, because one can be attached at any time.
async function removeItem(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const [item] = await tx
    .delete(mediaItems)
    .where(and(eq(mediaItems.mediaFileId, fileId), eq(mediaItems.status, 'uploading')))
    .returning({ id: mediaItems.id, title: mediaItems.title, folderId: mediaItems.folderId, coverFileId: mediaItems.coverFileId });
  if (!item) return null;
  // Folders are never deleted, so the item's folder still says which category it belonged to (for the audit entry).
  const [folder] = await tx.select({ category: mediaFolders.category }).from(mediaFolders).where(eq(mediaFolders.id, item.folderId));
  await tx.delete(files).where(eq(files.id, fileId));
  let cover: RemovedUpload['cover'] = null;
  if (item.coverFileId) {
    [cover = null] = await tx.delete(files).where(eq(files.id, item.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
  }
  return { target: { type: folder.category, id: item.id, label: item.title }, cover };
}

async function removeAttachment(tx: DbTransaction, fileId: string): Promise<RemovedUpload | null> {
  const [attachment] = await tx
    .delete(topicAttachments)
    .where(and(eq(topicAttachments.fileId, fileId), eq(topicAttachments.status, 'uploading')))
    .returning({ id: topicAttachments.id, title: topicAttachments.title });
  if (!attachment) return null;
  await tx.delete(files).where(eq(files.id, fileId));
  return { target: { type: 'attachment', id: attachment.id, label: attachment.title ?? '' }, cover: null };
}
```

In `apps/api/src/media/upload-cleanup.service.ts` let the job use it:

In `apps/api/src/media/upload-cleanup.service.ts` replace:

```ts
import { type RemovedUnfinished, removeUnfinishedItem } from './remove-unfinished';
```

with:

```ts
import { type RemovedUpload, removeUnfinished } from './remove-unfinished';
```

In `apps/api/src/media/upload-cleanup.service.ts` replace:

```ts
  // Deletes the rows (and the cover of an unfinished item) only if the file is still pending, so an item that finished
  // a moment ago is never touched. The item row goes before the file rows, the same order as a cancel and a finish use,
  // so they cannot deadlock. Returns null when nothing was removed.
  private expire(file: FileRow): Promise<Pick<RemovedUnfinished, 'cover'> | null> {
    return this.db.transaction(async (tx) => {
      if (file.purpose !== 'cover') {
        const removed = await removeUnfinishedItem(tx, file.id);
        if (!removed) return null;
        await this.audit.record(tx, {
          actor: null,
          action: 'file.upload_failed',
          target: { type: removed.item.category, id: removed.item.id, label: removed.item.title },
          metadata: { fileId: file.id, reason: 'expired' },
        });
```

with:

```ts
  // Deletes the rows (and the cover of an unfinished library item) only if the file is still pending, so an item or an
  // attachment that finished a moment ago is never touched. The owner's row goes before the file rows, the same order as a
  // cancel and a finish use, so they cannot deadlock. Returns null when nothing was removed.
  private expire(file: FileRow): Promise<Pick<RemovedUpload, 'cover'> | null> {
    return this.db.transaction(async (tx) => {
      if (file.purpose !== 'cover') {
        const removed = await removeUnfinished(tx, file.id);
        if (!removed) return null;
        await this.audit.record(tx, {
          actor: null,
          action: 'file.upload_failed',
          target: removed.target,
          metadata: { fileId: file.id, reason: 'expired' },
        });
```

- [ ] **Step 3: Run everything, then check that the tests bite**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (867 API tests).

Pin checks (each is a temporary edit, undone afterwards with `git checkout apps/api/src`; run `npm test -w @jbf/api -- attachment-cleanup attachment-uploads` after each):
1. In `removeAttachment` drop `eq(topicAttachments.status, 'uploading')` from the `where`: expected FAIL in "leaves an attachment that finished after the cleanup looked at it fully ready" (the stale snapshot would remove a ready attachment).
2. In `UploadsService.begin` delete the `abortMultipartUpload` line in the `catch`: expected FAIL in "aborts the storage upload and leaves no rows when the database refuses to start it" (Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: clean up abandoned attachment uploads and pin the cancel and finish races"
```


## Web tasks (Tasks 8–12)

### Task 8: The Courses link, the course list page and its dialog

**Files:**
- Create: `apps/web/src/api/courses.ts` (+ `courses.spec.ts`), `apps/web/src/pages/courses/CoursesPage.tsx` (+ `CoursesPage.spec.tsx`), `apps/web/src/pages/courses/CourseDialog.tsx`
- Modify: `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`, `apps/web/src/App.spec.tsx`

**Existing tests to adapt:** `apps/web/src/components/AppShell.spec.tsx` (the sidebar test that lists the first links: Courses is now the second link, after Dashboard and above Videos).

**Interfaces:**
- Consumes: `api` (`api/client.ts`), `Button`, `Alert`, `EmptyState`, `Skeleton`, `Table`, `Dialog`, `TextField`, `TextArea`, `ApiError`, `describeError`, the shared table styles in `pages/media/Media.module.css`.
- Produces:

```ts
// api/courses.ts
interface CourseSummary { id; title; description: string | null; position; coverUrl: string | null; lessonCount; topicCount; createdBy: { id; name }; createdAt: string }
interface TopicSummary { id; title; position; attachmentCount }
interface LessonNode { id; title; position; topics: TopicSummary[] }
interface CourseTree { id; title; description: string | null; position; coverUrl: string | null; createdBy; createdAt; lessons: LessonNode[] }
listCourses(): Promise<CourseSummary[]>; createCourse(input: { title; description }): Promise<CourseSummary>
reorderCourses(ids): Promise<CourseSummary[]>; updateCourse(id, input: { title?; description? }): Promise<CourseTree>
// pages/courses/CourseDialog.tsx
type CourseDialogMode = { kind: 'create' } | { kind: 'rename'; course: CourseSummary }
CourseDialog({ mode, onClose, onSaved(title, kind) })
// pages/courses/CoursesPage.tsx   CoursesPage()
// nav: { to: '/courses', label: 'Courses', group: 'main' } right after Dashboard; routes: /courses (the course page /courses/:courseId comes in Task 9)
```

- [ ] **Step 1: Failing tests**

Create `apps/web/src/api/courses.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession, STAFF } from '../test/session';
import { createCourse, listCourses, reorderCourses, updateCourse } from './courses';

describe('courses api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the course endpoints', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`.trim());
      return { body: [] };
    });
    await listCourses();
    await createCourse({ title: 'Fire safety', description: 'About fire' });
    await reorderCourses(['b', 'a']);
    await updateCourse('c1', { title: 'New' });
    expect(calls.filter((call) => call.includes('/api/courses'))).toEqual([
      'GET /api/courses',
      'POST /api/courses {"title":"Fire safety","description":"About fire"}',
      'PUT /api/courses/order {"ids":["b","a"]}',
      'PATCH /api/courses/c1 {"title":"New"}',
    ]);
  });
});
```

Create `apps/web/src/pages/courses/CoursesPage.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseSummary } from '../../api/courses';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { CoursesPage } from './CoursesPage';

const course = (overrides: Partial<CourseSummary> & { id: string; title: string }): CourseSummary => ({
  description: null,
  position: 0,
  coverUrl: null,
  lessonCount: 0,
  topicCount: 0,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  ...overrides,
});

const fixture: CourseSummary[] = [
  course({ id: 'c1', title: 'Fire safety', lessonCount: 3, topicCount: 7, coverUrl: 'https://cdn.example/cover?sig=1' }),
  course({ id: 'c2', title: 'First aid', position: 1, lessonCount: 1, topicCount: 2 }),
  course({ id: 'c3', title: '<img src=x onerror=alert(1)>', position: 2 }),
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: CourseSummary[] = fixture) {
  const state = { courses: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses') return { body: state.courses };
    if (key === 'POST /api/courses') {
      const created = course({ id: 'c-new', title: String(body.title), description: (body.description as string) || null, position: state.courses.length });
      state.courses.push(created);
      return { status: 201, body: created };
    }
    const edit = /^PATCH \/api\/courses\/([^/]+)$/.exec(key);
    if (edit) {
      state.courses.find((candidate) => candidate.id === edit[1])!.title = String(body.title);
      return { body: {} };
    }
    if (key === 'PUT /api/courses/order') {
      const ids = body.ids as string[];
      state.courses = ids.map((id, index) => ({ ...state.courses.find((candidate) => candidate.id === id)!, position: index }));
      return { body: state.courses };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('CoursesPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists the courses with their lesson and topic counts and an Open link to each', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    const table = await screen.findByRole('table', { name: 'Courses' });
    const row = within(table).getByRole('row', { name: /Fire safety/ });
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open Fire safety' })).toHaveAttribute('href', '/courses/c1');
    expect(within(table).getByRole('columnheader', { name: 'Lessons' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Topics' })).toBeInTheDocument();
  });

  it('shows a cover picture where there is one and a placeholder where there is not', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await screen.findByRole('table', { name: 'Courses' });
    const pictures = document.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(pictures[0]).toHaveAttribute('alt', '');
  });

  it('shows hostile course titles as plain text', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('shows an empty state with a way forward', async () => {
    startServer({}, []);
    renderWithSession(<CoursesPage />);
    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
    expect(screen.getByText(/create a course/i)).toBeInTheDocument();
  });

  it('shows a loading state, then offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/courses': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<CoursesPage />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Courses' })).toBeInTheDocument();
  });

  it('creates a course from a trimmed title and a description, and shows it', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await userEvent.type(within(dialog).getByLabelText('Course title'), '  Orientation ');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Your first week.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Course "Orientation" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/courses')?.body).toEqual({ title: 'Orientation', description: 'Your first week.' });
    expect(await screen.findByRole('link', { name: 'Open Orientation' })).toBeInTheDocument();
  });

  it('asks for a title before sending anything', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Enter a course title.')).toBeInTheDocument();
    expect(screen.getByLabelText('Course title')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('shows what the server says about a title inside the dialog and keeps it open', async () => {
    startServer({ 'POST /api/courses': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.type(screen.getByLabelText('Course title'), 'Fire');
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New course' })).toBeInTheDocument();
  });

  it('cannot be dismissed while the request is running', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const pending = new Promise<MockResponse>((resolve) => (release = resolve));
    startServer({ 'POST /api/courses': () => pending as unknown as MockResponse });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.type(screen.getByLabelText('Course title'), 'Slow one');
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release({ status: 201, body: course({ id: 'c-slow', title: 'Slow one' }) });
    expect(await screen.findByText('Course "Slow one" created.')).toBeInTheDocument();
  });

  it('renames a course, starting from its current title', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename First aid' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename course' });
    const field = within(dialog).getByLabelText('Course title');
    expect(field).toHaveValue('First aid');
    expect(within(dialog).queryByLabelText('Description')).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, 'Emergency care');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Course renamed to "Emergency care".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/courses/c2')?.body).toEqual({ title: 'Emergency care' });
  });

  it('moves a course down, disables the moves that are not possible, and sends the whole order', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await screen.findByRole('table', { name: 'Courses' });
    expect(screen.getByRole('button', { name: 'Move Fire safety up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move <img src=x onerror=alert(1)> down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Fire safety down' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Fire safety up' })).toBeEnabled());
    expect(calls.find((call) => call.key === 'PUT /api/courses/order')?.body).toEqual({ ids: ['c2', 'c1', 'c3'] });
    const rows = within(screen.getByRole('table', { name: 'Courses' })).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Open First aid' })).toBeInTheDocument();
  });

  it('says so and reloads when the order changed under you', async () => {
    startServer({ 'PUT /api/courses/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Fire safety down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    expect(await screen.findByRole('table', { name: 'Courses' })).toBeInTheDocument();
  });
});
```

In `apps/web/src/App.spec.tsx` add the route test inside the existing `describe`:

In `apps/web/src/App.spec.tsx` replace:

```tsx
  it('opens a folder inside its category', async () => {
```

with:

```tsx
  it('lists the courses on /courses', async () => {
    const fetchMock = mockSession(STAFF, (url) => (url === '/api/courses' ? { body: [] } : { status: 404, body: {} }));
    renderWithSession(<App />, '/courses');
    expect(await screen.findByRole('heading', { level: 1, name: 'Courses' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/courses'));
  });

  it('opens a folder inside its category', async () => {
```

In `apps/web/src/App.spec.tsx` replace:

```tsx
import { screen, within } from '@testing-library/react';
```

with:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
```

Adapt the sidebar test in `apps/web/src/components/AppShell.spec.tsx`:

In `apps/web/src/components/AppShell.spec.tsx` replace:

```tsx
    expect(within(nav).getAllByRole('link').map((link) => link.textContent).slice(0, 5)).toEqual(['Dashboard', 'Videos', 'Movies', 'Podcasts', 'Songs']);
```

with:

```tsx
    expect(within(nav).getAllByRole('link').map((link) => link.textContent).slice(0, 6)).toEqual(['Dashboard', 'Courses', 'Videos', 'Movies', 'Podcasts', 'Songs']);
```

Run: `npm test -w @jbf/web -- courses CoursesPage App.spec AppShell`
Expected: FAIL (`./courses` and `./CoursesPage` do not exist; the sidebar has no Courses link).

- [ ] **Step 2: The API client**

Create `apps/web/src/api/courses.ts`:

```ts
import { api } from './client';

export interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessonCount: number;
  topicCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface TopicSummary {
  id: string;
  title: string;
  position: number;
  // Ready attachments only.
  attachmentCount: number;
}

export interface LessonNode {
  id: string;
  title: string;
  position: number;
  topics: TopicSummary[];
}

// The whole course in one answer: its lessons in order, each with its topics in order.
export interface CourseTree {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  lessons: LessonNode[];
}

export const listCourses = (): Promise<CourseSummary[]> => api<CourseSummary[]>('/api/courses');

export const createCourse = (input: { title: string; description: string }): Promise<CourseSummary> =>
  api<CourseSummary>('/api/courses', { method: 'POST', body: input });

export const reorderCourses = (ids: string[]): Promise<CourseSummary[]> =>
  api<CourseSummary[]>('/api/courses/order', { method: 'PUT', body: { ids } });

export const updateCourse = (id: string, input: { title?: string; description?: string }): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${id}`, { method: 'PATCH', body: input });
```

- [ ] **Step 3: The dialog and the page**

Create `apps/web/src/pages/courses/CourseDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseSummary, createCourse, updateCourse } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

export type CourseDialogMode = { kind: 'create' } | { kind: 'rename'; course: CourseSummary };

interface CourseDialogProps {
  mode: CourseDialogMode | null;
  onClose: () => void;
  onSaved: (title: string, kind: CourseDialogMode['kind']) => void;
}

export function CourseDialog({ mode, onClose, onSaved }: CourseDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode?.kind === 'rename' ? 'Rename course' : 'New course'} blocked={busy}>
      {mode ? <CourseForm mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

type Field = 'title' | 'description';

function CourseForm({
  mode,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<CourseDialogProps, 'onClose' | 'onSaved'> & { mode: CourseDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(mode.kind === 'rename' ? mode.course.title : '');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : descriptionRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setErrors({ title: 'Enter a course title.' });
      setFocusRequest({ field: 'title' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (mode.kind === 'rename') await updateCourse(mode.course.id, { title: trimmed });
      else await createCourse({ title: trimmed, description: description.trim() });
      onSaved(trimmed, mode.kind);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        setFocusRequest({ field: caught.fieldErrors.title ? 'title' : 'description' });
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={titleRef} label="Course title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      {mode.kind === 'create' ? (
        <TextArea ref={descriptionRef} label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      ) : null}
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {mode.kind === 'rename' ? 'Save' : 'Create course'}
        </Button>
      </div>
    </form>
  );
}
```

Create `apps/web/src/pages/courses/CoursesPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type CourseSummary, listCourses, reorderCourses } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import media from '../media/Media.module.css';
import { CourseDialog, type CourseDialogMode } from './CourseDialog';

type Notice = { tone: 'error' | 'success'; text: string };

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CourseDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setCourses(await listCourses());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(index: number, delta: -1 | 1) {
    if (!courses) return;
    const ids = courses.map((course) => course.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setCourses(await reorderCourses(ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function onSaved(title: string, kind: CourseDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Course "${title}" created.` : `Course renamed to "${title}".` });
    void load();
  }

  return (
    <>
      <div className={media.header}>
        <h1>Courses</h1>
        <Button onClick={() => setDialog({ kind: 'create' })}>New course</Button>
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
      ) : courses === null ? (
        <Skeleton />
      ) : courses.length === 0 ? (
        <EmptyState title="No courses yet">Create a course to start adding lessons, topics and files.</EmptyState>
      ) : (
        <Table caption="Courses">
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col">Lessons</th>
              <th scope="col">Topics</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course, index) => (
              <tr key={course.id}>
                <td data-label="Course">
                  <div className={media.itemCell}>
                    {course.coverUrl ? (
                      <img className={media.cover} src={course.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className={media.coverPlaceholder} aria-hidden="true">
                        ▤
                      </span>
                    )}
                    <Link className={media.name} to={`/courses/${course.id}`}>
                      {course.title}
                    </Link>
                  </div>
                </td>
                <td data-label="Lessons">{course.lessonCount}</td>
                <td data-label="Topics">{course.topicCount}</td>
                <td data-label="Actions">
                  <div className={media.actions}>
                    <Link className={media.link} to={`/courses/${course.id}`} aria-label={`Open ${course.title}`}>
                      Open
                    </Link>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${course.title}`} onClick={() => setDialog({ kind: 'rename', course })}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || index === 0} aria-label={`Move ${course.title} up`} onClick={() => void move(index, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || index === courses.length - 1}
                      aria-label={`Move ${course.title} down`}
                      onClick={() => void move(index, 1)}
                    >
                      ↓ Move down
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CourseDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
```

- [ ] **Step 4: The sidebar link and the route**

In `apps/web/src/components/nav-items.ts` replace:

```ts
  { to: '/', label: 'Dashboard', group: 'main', end: true },
```

with:

```ts
  { to: '/', label: 'Dashboard', group: 'main', end: true },
  { to: '/courses', label: 'Courses', group: 'main' },
```

In `apps/web/src/App.tsx` replace:

```tsx
import { AccountPage } from './pages/account/AccountPage';
import { AuditPage } from './pages/audit/AuditPage';
```

with:

```tsx
import { AccountPage } from './pages/account/AccountPage';
import { AuditPage } from './pages/audit/AuditPage';
import { CoursesPage } from './pages/courses/CoursesPage';
```

In `apps/web/src/App.tsx` replace:

```tsx
          <Route path="/" element={<DashboardPage />} />
```

with:

```tsx
          <Route path="/" element={<DashboardPage />} />
          <Route path="/courses" element={<CoursesPage />} />
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (405 web tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: add the Courses link and the course list page"
```


### Task 9: The course page: the accessible tree, the selected topic, a deep link, the phone Back button and editing the course

**Files:**
- Create: `apps/web/src/pages/courses/CoursePage.tsx` (+ `CoursePage.spec.tsx`), `apps/web/src/pages/courses/CourseOutline.tsx` (+ `CourseOutline.spec.tsx`), `apps/web/src/pages/courses/TopicPanel.tsx`, `apps/web/src/pages/courses/EditCourseDialog.tsx`, `apps/web/src/pages/courses/Courses.module.css`
- Modify: `apps/web/src/api/courses.ts` (+ `courses.spec.ts`), `apps/web/src/api/media.ts` (the cover upload works for any owner), `apps/web/src/App.tsx`, `apps/web/src/App.spec.tsx`

**Existing tests to adapt:** none. `api/media.spec.ts` ("uploads a cover in three steps ...") passes unchanged: `uploadCover` is now one line over the shared helper.

**Interfaces:**
- Consumes: `CourseTree`, `LessonNode`, `TopicSummary` (Task 8), `api`, `ApiError`, `describeError`, `checkCoverFile` (`uploads/limits.ts`), `Dialog`, `TextField`, `TextArea`, `Alert`, `Button`, `EmptyState`, `Skeleton`, the shared styles in `pages/media/Media.module.css`, `LocationProbe` (`test/session.tsx`).
- Produces:

```ts
// api/media.ts
uploadCoverTo<T>(base: string, file: File): Promise<T>     // POST <base>/cover, PUT to the returned link without the sign-in header, POST <base>/cover/<id>/complete
// api/courses.ts
interface TopicView { id; lessonId; courseId; title; description: string | null; position }
getCourse(id): Promise<CourseTree>; getTopic(id): Promise<TopicView>; uploadCourseCover(id, file): Promise<CourseTree>
// pages/courses/CourseOutline.tsx
CourseOutline({ lessons, selectedTopicId, onSelectTopic(id) })
//   role="tree"; a lesson is a treeitem (aria-level 1, aria-expanded) holding a group of its topics (aria-level 2, aria-selected);
//   one item has tabindex 0 (the item last used, else the selected topic, else the first); Up/Down/Home/End move, Right opens or goes in,
//   Left closes or goes out, Enter and Space open/close a lesson or choose a topic. All lessons start open.
// pages/courses/TopicPanel.tsx            TopicPanel({ topicId })
// pages/courses/CoursePage.tsx            CoursePage()  route /courses/:courseId?topic=<id>
//   two panes (data-view="tree" | "topic" decides which one a phone shows) and a Back button that clears ?topic
// pages/courses/EditCourseDialog.tsx      EditCourseDialog({ course, onClose, onChanged })
```

- [ ] **Step 1: Failing tests**

Extend `apps/web/src/api/courses.spec.ts` (imports first, then a new test):

In `apps/web/src/api/courses.spec.ts` replace:

```ts
import { createCourse, listCourses, reorderCourses, updateCourse } from './courses';
```

with:

```ts
import { createCourse, getCourse, getTopic, listCourses, reorderCourses, updateCourse, uploadCourseCover } from './courses';
```

Append to `apps/web/src/api/courses.spec.ts`:

```ts
describe('course page api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('reads a course and a topic', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      return { body: {} };
    });
    await getCourse('c1');
    await getTopic('t1');
    expect(calls.filter((call) => call.includes('/api/courses') || call.includes('/api/topics'))).toEqual(['GET /api/courses/c1', 'GET /api/topics/t1']);
  });

  it('uploads a course cover in three steps, sending the file to the returned link without the sign-in header', async () => {
    const calls: { key: string; headers: Record<string, string> }[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push({ key: `${init.method ?? 'GET'} ${url}`, headers: (init.headers ?? {}) as Record<string, string> });
      if (url === '/api/courses/c1/cover') return { status: 201, body: { fileId: 'f1', url: 'https://storage.example/put?sig=1', headers: { 'Content-Type': 'image/png' } } };
      if (url === 'https://storage.example/put?sig=1') return { status: 200, body: {} };
      return { body: { id: 'c1', lessons: [] } };
    });
    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    await expect(uploadCourseCover('c1', file)).resolves.toMatchObject({ id: 'c1' });
    const steps = calls.filter((call) => /cover|storage\.example/.test(call.key));
    expect(steps.map((call) => call.key)).toEqual(['POST /api/courses/c1/cover', 'PUT https://storage.example/put?sig=1', 'POST /api/courses/c1/cover/f1/complete']);
    expect(steps[1]!.headers).not.toHaveProperty('Authorization');
  });
});
```

Create `apps/web/src/pages/courses/CourseOutline.spec.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LessonNode } from '../../api/courses';
import { CourseOutline } from './CourseOutline';

const lessons: LessonNode[] = [
  {
    id: 'l1',
    title: 'Exits',
    position: 0,
    topics: [
      { id: 't1', title: 'Fire exits', position: 0, attachmentCount: 2 },
      { id: 't2', title: 'Alarms', position: 1, attachmentCount: 0 },
    ],
  },
  { id: 'l2', title: 'Empty lesson', position: 1, topics: [] },
  { id: 'l3', title: '<b>Equipment</b>', position: 2, topics: [{ id: 't3', title: '<img src=x onerror=alert(1)>', position: 0, attachmentCount: 1 }] },
];

function setup(selectedTopicId: string | null = null) {
  const onSelectTopic = vi.fn();
  const view = render(<CourseOutline lessons={lessons} selectedTopicId={selectedTopicId} onSelectTopic={onSelectTopic} />);
  return { onSelectTopic, ...view };
}

const names = () => screen.getAllByRole('treeitem').map((item) => item.getAttribute('aria-label'));

describe('CourseOutline', () => {
  it('is a tree of lessons, all open, holding their topics, and says which topic is selected', () => {
    setup('t2');
    expect(screen.getByRole('tree', { name: 'Course contents' })).toBeInTheDocument();
    expect(names()).toEqual(['Exits', 'Fire exits', 'Alarms', 'Empty lesson', '<b>Equipment</b>', '<img src=x onerror=alert(1)>']);
    const lesson = screen.getByRole('treeitem', { name: 'Exits' });
    expect(lesson).toHaveAttribute('aria-level', '1');
    expect(lesson).toHaveAttribute('aria-expanded', 'true');
    const topic = screen.getByRole('treeitem', { name: 'Alarms' });
    expect(topic).toHaveAttribute('aria-level', '2');
    expect(topic).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toHaveAttribute('aria-selected', 'false');
    expect(within(lesson).getAllByRole('treeitem')).toHaveLength(2);
  });

  it('shows how many files a topic has, and a hint for a lesson without topics', () => {
    setup();
    expect(within(screen.getByRole('treeitem', { name: 'Fire exits' })).getByText('2 files')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: 'Alarms' })).getByText('No files')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: '<img src=x onerror=alert(1)>' })).getByText('1 file')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: 'Empty lesson' })).getByText('No topics yet')).toBeInTheDocument();
  });

  it('shows hostile titles as plain text', () => {
    setup();
    expect(screen.getByText('<b>Equipment</b>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('lets exactly one item be reached with Tab: the selected topic, else the first lesson', () => {
    const { unmount } = setup('t2');
    expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['Alarms']);
    unmount();
    setup();
    expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['Exits']);
  });

  it('closes and opens a lesson when its title is clicked, announcing the state', async () => {
    setup();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Exits' })).getByText('Exits'));
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Fire exits' })).toBeNull();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Exits' })).getByText('Exits'));
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toBeInTheDocument();
  });

  it('chooses a topic when its title is clicked, and does nothing else', async () => {
    const { onSelectTopic } = setup();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Alarms' })).getByText('Alarms'));
    expect(onSelectTopic).toHaveBeenCalledTimes(1);
    expect(onSelectTopic).toHaveBeenCalledWith('t2');
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
  });

  describe('with the keyboard', () => {
    const focused = () => document.activeElement?.getAttribute('aria-label');

    it('moves through the visible items with the arrow keys, Home and End, and keeps the Tab stop where it is', async () => {
      setup();
      await userEvent.tab();
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
      await userEvent.keyboard('{ArrowUp}');
      expect(focused()).toBe('Alarms');
      await userEvent.keyboard('{End}');
      expect(focused()).toBe('<img src=x onerror=alert(1)>');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('<img src=x onerror=alert(1)>');
      await userEvent.keyboard('{Home}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowUp}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{End}');
      expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['<img src=x onerror=alert(1)>']);
    });

    it('closes an open lesson with Left, opens it again with Right, and steps into and out of it', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowLeft}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowLeft}');
      expect(focused()).toBe('Exits');
    });

    it('does not step into a lesson that has no topics', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Empty lesson');
    });

    it('chooses a topic with Enter or Space, and opens or closes a lesson the same way', async () => {
      const { onSelectTopic } = setup();
      await userEvent.tab();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
      await userEvent.keyboard(' ');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
      await userEvent.keyboard('{ArrowDown}{Enter}');
      expect(onSelectTopic).toHaveBeenLastCalledWith('t1');
      await userEvent.keyboard('{ArrowDown} ');
      expect(onSelectTopic).toHaveBeenLastCalledWith('t2');
      expect(onSelectTopic).toHaveBeenCalledTimes(2);
    });

    it('skips the topics of a closed lesson', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
    });
  });
});
```

Create `apps/web/src/pages/courses/CoursePage.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseTree, TopicView } from '../../api/courses';
import type { MockResponse } from '../../test/fetch-mock';
import { LocationProbe, mockSession, renderWithSession, STAFF } from '../../test/session';
import { CoursePage } from './CoursePage';
import styles from './Courses.module.css';

const tree: CourseTree = {
  id: 'c1',
  title: 'Fire safety',
  description: 'Know the exits.\nPractise them.',
  position: 0,
  coverUrl: 'https://cdn.example/cover?sig=1',
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  lessons: [
    {
      id: 'l1',
      title: 'Exits',
      position: 0,
      topics: [
        { id: 't1', title: 'Fire exits', position: 0, attachmentCount: 2 },
        { id: 't2', title: '<b>Alarms</b>', position: 1, attachmentCount: 0 },
      ],
    },
    { id: 'l2', title: 'Equipment', position: 1, topics: [] },
  ],
};

const topic = (overrides: Partial<TopicView> & { id: string; title: string }): TopicView => ({
  lessonId: 'l1',
  courseId: 'c1',
  description: null,
  position: 0,
  ...overrides,
});
const topicsFixture: Record<string, TopicView> = {
  t1: topic({ id: 't1', title: 'Fire exits', description: 'Keep them clear.\nNever lock them.' }),
  t2: topic({ id: 't2', title: '<b>Alarms</b>', position: 1, description: '<script>alert(1)</script>' }),
};

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, course: CourseTree = tree) {
  const state = { course: structuredClone(course) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses/c1') return { body: state.course };
    const found = /^GET \/api\/topics\/([^/]+)$/.exec(key);
    if (found) return topicsFixture[found[1] as string] ? { body: topicsFixture[found[1] as string] } : { status: 404, body: { message: 'Topic not found.' } };
    if (key === 'PATCH /api/courses/c1') {
      Object.assign(state.course, body);
      return { body: state.course };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

function renderPage(route = '/courses/c1') {
  return renderWithSession(
    <>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/courses" element={<p>The course list</p>} />
      </Routes>
      <LocationProbe />
    </>,
    route,
  );
}

describe('CoursePage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the course with its cover, text, breadcrumb and tree', async () => {
    startServer();
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(screen.getByText(/Know the exits\./).textContent).toBe('Know the exits.\nPractise them.');
    expect(screen.getByRole('tree', { name: 'Course contents' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toBeInTheDocument();
  });

  it('asks for a topic when none is chosen and shows no topic request', async () => {
    const calls = startServer();
    renderPage();
    expect(await screen.findByText('Choose a topic')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('GET /api/topics'))).toBe(false);
  });

  it('opens the topic in the address when the page is opened with ?topic=, selects it in the tree and shows its text as plain lines', async () => {
    startServer();
    renderPage('/courses/c1?topic=t1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
    expect(screen.getByText(/Keep them clear\./).textContent).toBe('Keep them clear.\nNever lock them.');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows another topic when it is chosen in the tree, and keeps the choice in the address', async () => {
    const calls = startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    await userEvent.click(within(screen.getByRole('treeitem', { name: '<b>Alarms</b>' })).getByText('<b>Alarms</b>'));
    expect(await screen.findByRole('heading', { level: 2, name: '<b>Alarms</b>' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/courses/c1?topic=t2');
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script, b')).toBeNull();
    expect(calls.filter((call) => call.key === 'GET /api/topics/t2')).toHaveLength(1);
  });

  it('says so for a topic that is not in the course and for one the server no longer has', async () => {
    startServer();
    renderPage('/courses/c1?topic=nope');
    expect(await screen.findByText('Topic not found')).toBeInTheDocument();
  });

  it('says so when the server has no such topic although the tree lists it', async () => {
    startServer({ 'GET /api/topics/t1': { status: 404, body: { message: 'Topic not found.' } } });
    renderPage('/courses/c1?topic=t1');
    expect(await screen.findByText('Topic not found')).toBeInTheDocument();
  });

  it('offers Retry when the topic cannot be loaded', async () => {
    let fail = true;
    startServer({ 'GET /api/topics/t1': () => (fail ? { status: 500, body: {} } : { body: topicsFixture.t1 }) });
    renderPage('/courses/c1?topic=t1');
    const panel = await screen.findByRole('region', { name: 'Selected topic' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
  });

  it('tells a phone which pane to show and has a Back button that clears the topic', async () => {
    startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    const panes = document.querySelector(`.${styles.panes}`) as HTMLElement;
    expect(panes).toHaveAttribute('data-view', 'topic');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the course' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/courses\/c1$/);
    expect(panes).toHaveAttribute('data-view', 'tree');
    expect(screen.queryByRole('button', { name: 'Back to the course' })).toBeNull();
    expect(screen.getByText('Choose a topic')).toBeInTheDocument();
  });

  it('shows an empty state for a course without lessons', async () => {
    startServer({}, { ...tree, lessons: [], description: null, coverUrl: null });
    renderPage();
    expect(await screen.findByText('No lessons yet')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('offers Retry when the course cannot be loaded', async () => {
    let fail = true;
    startServer({ 'GET /api/courses/c1': () => (fail ? { status: 500, body: {} } : { body: tree }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' })).toBeInTheDocument();
  });

  it('says so, with a way back, for a course that does not exist', async () => {
    startServer({ 'GET /api/courses/c1': { status: 404, body: { message: 'Course not found.' } } });
    renderPage();
    expect(await screen.findByText('Course not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Courses' })).toHaveAttribute('href', '/courses');
  });

  describe('editing the course', () => {
    it('starts from the current text and sends only what changed', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit course' });
      expect(within(dialog).getByLabelText('Course title')).toHaveValue('Fire safety');
      expect(within(dialog).getByLabelText('Description')).toHaveValue('Know the exits.\nPractise them.');
      const title = within(dialog).getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, '  Fire and exits ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/courses/c1')?.body).toEqual({ title: 'Fire and exits' });
      expect(await screen.findByRole('heading', { level: 1, name: 'Fire and exits' })).toBeInTheDocument();
    });

    it('clears the description with an empty one', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.clear(screen.getByLabelText('Description'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/courses/c1')?.body).toEqual({ description: '' });
    });

    it('asks for a title, and checks the cover before sending anything', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.clear(screen.getByLabelText('Course title'));
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Enter a course title.')).toBeInTheDocument();
      expect(screen.getByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
      expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false);
    });

    it('sends a new cover in three steps and reloads the course', async () => {
      const calls = startServer({
        'POST /api/courses/c1/cover': { status: 201, body: { fileId: 'f9', url: 'https://storage.example/put?sig=1', headers: { 'Content-Type': 'image/png' } } },
        'PUT https://storage.example/put?sig=1': { status: 200, body: {} },
        'POST /api/courses/c1/cover/f9/complete': { body: { ...tree, coverUrl: 'https://cdn.example/new?sig=2' } },
      });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.map((call) => call.key).filter((key) => /cover|storage/.test(key))).toEqual([
        'POST /api/courses/c1/cover',
        'PUT https://storage.example/put?sig=1',
        'POST /api/courses/c1/cover/f9/complete',
      ]);
      expect(calls.some((call) => call.key === 'PATCH /api/courses/c1')).toBe(false);
    });

    it('keeps what was saved and says the cover failed when only the cover goes wrong', async () => {
      startServer({ 'POST /api/courses/c1/cover': { status: 500, body: {} } });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const title = screen.getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Fire and exits');
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(/Your changes were saved, but the cover image could not be added/)).toBeInTheDocument();
      expect(await screen.findByRole('heading', { level: 1, name: 'Fire and exits' })).toBeInTheDocument();
    });

    it('shows what the server says about the title and keeps the dialog open', async () => {
      startServer({ 'PATCH /api/courses/c1': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const title = screen.getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Changed');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Edit course' })).toBeInTheDocument();
    });
  });
});
```

In `apps/web/src/App.spec.tsx` add a route test:

In `apps/web/src/App.spec.tsx` replace:

```tsx
  it('opens a folder inside its category', async () => {
```

with:

```tsx
  it('opens a course on /courses/:courseId with the topic from the address', async () => {
    mockSession(STAFF, (url) => {
      if (url === '/api/courses/c1') return { body: { id: 'c1', title: 'Fire safety', description: null, position: 0, coverUrl: null, createdBy: { id: 'u1', name: 'Anita Rao' }, createdAt: '2026-10-09T10:00:00Z', lessons: [{ id: 'l1', title: 'Exits', position: 0, topics: [{ id: 't1', title: 'Fire exits', position: 0, attachmentCount: 0 }] }] } };
      if (url === '/api/topics/t1') return { body: { id: 't1', lessonId: 'l1', courseId: 'c1', title: 'Fire exits', description: null, position: 0 } };
      return { status: 404, body: {} };
    });
    renderWithSession(<App />, '/courses/c1?topic=t1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
  });

  it('opens a folder inside its category', async () => {
```

Run: `npm test -w @jbf/web -- CourseOutline CoursePage courses App.spec`
Expected: FAIL (the components, the styles and the api functions do not exist).

- [ ] **Step 2: The shared cover helper and the course calls**

In `apps/web/src/api/media.ts` make the cover upload work for any owner:

In `apps/web/src/api/media.ts` replace:

```ts
// Three steps: ask for a one-time link, send the file straight to storage (no sign-in header: the link is the
// credential), then tell the API to check and attach it.
export async function uploadCover(itemId: string, file: File): Promise<MediaItem> {
  const started = await api<{ fileId: string; url: string; headers: Record<string, string> }>(`/api/media/items/${itemId}/cover`, {
    method: 'POST',
    body: { contentType: file.type, sizeBytes: file.size },
  });
  const response = await fetch(started.url, { method: 'PUT', headers: started.headers, body: file });
  if (!response.ok) throw new ApiError(response.status, 'The cover image could not be uploaded. Please try again.');
  return api<MediaItem>(`/api/media/items/${itemId}/cover/${started.fileId}/complete`, { method: 'POST' });
}
```

with:

```ts
// Three steps: ask for a one-time link, send the file straight to storage (no sign-in header: the link is the
// credential), then tell the API to check and attach it. `base` is the owner of the cover, for example /api/media/items/<id>.
export async function uploadCoverTo<T>(base: string, file: File): Promise<T> {
  const started = await api<{ fileId: string; url: string; headers: Record<string, string> }>(`${base}/cover`, {
    method: 'POST',
    body: { contentType: file.type, sizeBytes: file.size },
  });
  const response = await fetch(started.url, { method: 'PUT', headers: started.headers, body: file });
  if (!response.ok) throw new ApiError(response.status, 'The cover image could not be uploaded. Please try again.');
  return api<T>(`${base}/cover/${started.fileId}/complete`, { method: 'POST' });
}

export const uploadCover = (itemId: string, file: File): Promise<MediaItem> => uploadCoverTo<MediaItem>(`/api/media/items/${itemId}`, file);
```

In `apps/web/src/api/courses.ts`:

In `apps/web/src/api/courses.ts` replace:

```ts
import { api } from './client';
```

with:

```ts
import { api } from './client';
import { uploadCoverTo } from './media';
```

In `apps/web/src/api/courses.ts`, after:

```ts
// The whole course in one answer: its lessons in order, each with its topics in order.
export interface CourseTree {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  lessons: LessonNode[];
}
```

add:

```ts

export interface TopicView {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
}
```

Append to `apps/web/src/api/courses.ts`:

```ts

export const getCourse = (id: string): Promise<CourseTree> => api<CourseTree>(`/api/courses/${id}`);

export const getTopic = (id: string): Promise<TopicView> => api<TopicView>(`/api/topics/${id}`);

export const uploadCourseCover = (id: string, file: File): Promise<CourseTree> => uploadCoverTo<CourseTree>(`/api/courses/${id}`, file);
```

- [ ] **Step 3: Styles**

Create `apps/web/src/pages/courses/Courses.module.css`:

```css
.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.cover {
  flex: none;
  width: 9rem;
  height: 5.5rem;
  border-radius: var(--radius);
  background: var(--color-surface);
  object-fit: cover;
}

.about {
  flex: 1;
  min-width: 12rem;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.panes {
  display: grid;
  grid-template-columns: minmax(15rem, 22rem) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

.treePane,
.topicPane {
  min-width: 0;
}

.treePane {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}

/* Only a phone shows a Back button: there the chosen topic replaces the tree. */
.back {
  display: none;
  margin-bottom: var(--space-3);
}

.topicTitle {
  margin: 0 0 var(--space-3);
  overflow-wrap: anywhere;
}

.text {
  margin: 0 0 var(--space-6);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tree,
.group {
  margin: 0;
  padding: 0;
  list-style: none;
}

.group {
  padding-left: var(--space-4);
}

.item {
  outline: none;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
}

.item:focus-visible > .row {
  outline: var(--focus-outline);
  outline-offset: 2px;
}

.label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.lessonLabel {
  font-weight: 600;
}

.selected > .row {
  background: var(--color-info-surface);
  box-shadow: inset 3px 0 0 var(--color-primary);
  font-weight: 600;
}

.count {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.hint {
  margin: 0;
  padding: var(--space-1) var(--space-3) var(--space-2) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (max-width: 760px) {
  .panes {
    grid-template-columns: 1fr;
  }

  .panes[data-view='topic'] .treePane,
  .panes[data-view='tree'] .topicPane {
    display: none;
  }

  .back {
    display: inline-flex;
  }
}
```

- [ ] **Step 4: The tree**

Create `apps/web/src/pages/courses/CourseOutline.tsx`:

```tsx
import { type KeyboardEvent, useRef, useState } from 'react';
import type { LessonNode, TopicSummary } from '../../api/courses';
import styles from './Courses.module.css';

interface CourseOutlineProps {
  lessons: LessonNode[];
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string) => void;
}

type Entry = { kind: 'lesson'; id: string; lesson: LessonNode } | { kind: 'topic'; id: string; lessonId: string };

const filesText = (topic: TopicSummary): string =>
  topic.attachmentCount === 0 ? 'No files' : topic.attachmentCount === 1 ? '1 file' : `${topic.attachmentCount} files`;

// The lessons and topics in the order the arrow keys walk them: a closed lesson hides its topics.
function visibleEntries(lessons: LessonNode[], closed: ReadonlySet<string>): Entry[] {
  return lessons.flatMap((lesson): Entry[] => [
    { kind: 'lesson', id: lesson.id, lesson },
    ...(closed.has(lesson.id) ? [] : lesson.topics.map((topic): Entry => ({ kind: 'topic', id: topic.id, lessonId: lesson.id }))),
  ]);
}

// An accessible tree (the WAI-ARIA tree pattern): one item is reachable with Tab, the arrow keys do the rest, and the
// state of every lesson is announced through aria-expanded.
export function CourseOutline({ lessons, selectedTopicId, onSelectTopic }: CourseOutlineProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const entries = visibleEntries(lessons, closed);
  const has = (id: string | null): id is string => id !== null && entries.some((entry) => entry.id === id);
  const tabStop = has(lastUsed) ? lastUsed : has(selectedTopicId) ? selectedTopicId : (entries[0]?.id ?? null);

  const focusEntry = (id: string): void => {
    setLastUsed(id);
    elements.current.get(id)?.focus();
  };

  const toggle = (lessonId: string, open: boolean): void => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target as HTMLElement;
    // Keys typed in something inside a row (a button) belong to that button.
    if (target.getAttribute('role') !== 'treeitem') return;
    const index = entries.findIndex((entry) => entry.id === target.dataset.id);
    const entry = entries[index];
    if (!entry) return;
    const go = (to: Entry | undefined): void => {
      event.preventDefault();
      if (to) focusEntry(to.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        go(entries[index + 1]);
        break;
      case 'ArrowUp':
        go(entries[index - 1]);
        break;
      case 'Home':
        go(entries[0]);
        break;
      case 'End':
        go(entries[entries.length - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (closed.has(entry.id)) toggle(entry.id, true);
          else if (entry.lesson.topics.length > 0) focusEntry(entries[index + 1]!.id);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (!closed.has(entry.id)) toggle(entry.id, false);
        } else {
          focusEntry(entry.lessonId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (entry.kind === 'lesson') toggle(entry.id, closed.has(entry.id));
        else onSelectTopic(entry.id);
        break;
    }
  }

  const register = (id: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  };

  // Focus moving to an item itself (not to something inside it) makes it the item Tab comes back to.
  const noteFocus = (id: string) => (event: { target: EventTarget; currentTarget: EventTarget }) => {
    if (event.target === event.currentTarget) setLastUsed(id);
  };

  return (
    <ul role="tree" aria-label="Course contents" className={styles.tree} onKeyDown={onKeyDown}>
      {lessons.map((lesson) => {
        const open = !closed.has(lesson.id);
        return (
          <li
            key={lesson.id}
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-label={lesson.title}
            data-id={lesson.id}
            tabIndex={tabStop === lesson.id ? 0 : -1}
            ref={register(lesson.id)}
            onFocus={noteFocus(lesson.id)}
            className={styles.item}
          >
            <div className={styles.row}>
              <span className={`${styles.label} ${styles.lessonLabel}`} onClick={() => toggle(lesson.id, !open)}>
                <span aria-hidden="true">{open ? '▾ ' : '▸ '}</span>
                {lesson.title}
              </span>
            </div>
            {open ? (
              lesson.topics.length === 0 ? (
                <p className={styles.hint}>No topics yet</p>
              ) : (
                <ul role="group" className={styles.group}>
                  {lesson.topics.map((topic) => (
                    <li
                      key={topic.id}
                      role="treeitem"
                      aria-level={2}
                      aria-selected={topic.id === selectedTopicId}
                      aria-label={topic.title}
                      data-id={topic.id}
                      tabIndex={tabStop === topic.id ? 0 : -1}
                      ref={register(topic.id)}
                      onFocus={noteFocus(topic.id)}
                      className={topic.id === selectedTopicId ? `${styles.item} ${styles.selected}` : styles.item}
                    >
                      <div className={styles.row}>
                        <span className={styles.label} onClick={() => onSelectTopic(topic.id)}>
                          {topic.title}
                        </span>
                        <span className={styles.count}>{filesText(topic)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: The topic panel, the edit dialog and the page**

Create `apps/web/src/pages/courses/TopicPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { getTopic, type TopicView } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';

// The chosen topic: its title and text. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId }: { topicId: string }) {
  const [topic, setTopic] = useState<TopicView | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTopic(await getTopic(topicId));
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) return <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>;
  if (loadError) {
    return (
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
    );
  }
  if (!topic) return <Skeleton rows={3} />;

  return (
    <>
      <h2 className={styles.topicTitle}>{topic.title}</h2>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}
    </>
  );
}
```

Create `apps/web/src/pages/courses/EditCourseDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type CourseTree, updateCourse, uploadCourseCover } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import media from '../media/Media.module.css';

interface EditCourseDialogProps {
  course: CourseTree | null;
  onClose: () => void;
  // Called whenever something was saved, even if a later step failed, so the page never shows stale data.
  onChanged: () => void;
}

export function EditCourseDialog({ course, onClose, onChanged }: EditCourseDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={course !== null} onClose={onClose} title="Edit course" blocked={busy}>
      {course ? <EditForm course={course} busy={busy} setBusy={setBusy} onClose={onClose} onChanged={onChanged} /> : null}
    </Dialog>
  );
}

type Errors = { title?: string; description?: string; cover?: string };

function EditForm({
  course,
  busy,
  setBusy,
  onClose,
  onChanged,
}: Pick<EditCourseDialogProps, 'onClose' | 'onChanged'> & { course: CourseTree; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);

  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next: Errors = {
      title: title.trim() ? undefined : 'Enter a course title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    if (next.title || next.cover) {
      setFocusRequest({ field: next.title ? 'title' : 'cover' });
      return;
    }

    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== course.title) changes.title = title.trim();
    if (description.trim() !== (course.description ?? '')) changes.description = description.trim();
    setBusy(true);
    let saved = false;
    try {
      if (Object.keys(changes).length > 0) {
        await updateCourse(course.id, changes);
        saved = true;
      }
      if (cover) {
        await uploadCourseCover(course.id, cover);
        saved = true;
      }
      if (saved) onChanged();
      onClose();
    } catch (caught) {
      if (saved) onChanged();
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({ field: 'title' });
      } else {
        const reason = describeError(caught);
        setFailure(saved ? `Your changes were saved, but the cover image could not be added: ${reason}` : reason);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={titleRef} label="Course title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <TextField
        ref={coverRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hint={course.coverUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
        onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        error={errors.cover}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
```

Create `apps/web/src/pages/courses/CoursePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type CourseTree, getCourse } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';
import { CourseOutline } from './CourseOutline';
import { EditCourseDialog } from './EditCourseDialog';
import { TopicPanel } from './TopicPanel';

// The key gives every course its own page state when moving from one to another.
export function CoursePage() {
  const { courseId = '' } = useParams();
  return <Course key={courseId} courseId={courseId} />;
}

function Course({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topic');
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTree(await getCourse(courseId));
      setMissing(false);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <EmptyState title="Course not found">
        <Link to="/courses">Back to Courses</Link>
      </EmptyState>
    );
  }
  if (loadError) {
    return (
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
    );
  }
  if (!tree) return <Skeleton />;

  const inCourse = tree.lessons.some((lesson) => lesson.topics.some((topic) => topic.id === topicId));

  return (
    <>
      <nav aria-label="Breadcrumb" className={media.crumbs}>
        <Link to="/courses">Courses</Link> › {tree.title}
      </nav>
      <div className={media.header}>
        <h1>{tree.title}</h1>
        <Button onClick={() => setEditing(true)}>Edit course</Button>
      </div>
      {tree.coverUrl || tree.description ? (
        <div className={styles.hero}>
          {tree.coverUrl ? <img className={styles.cover} src={tree.coverUrl} alt="" /> : null}
          {tree.description ? <p className={styles.about}>{tree.description}</p> : null}
        </div>
      ) : null}

      <div className={styles.panes} data-view={topicId ? 'topic' : 'tree'}>
        <section className={styles.treePane} aria-label="Lessons and topics">
          {tree.lessons.length === 0 ? (
            <EmptyState title="No lessons yet">Add a lesson to start building the course.</EmptyState>
          ) : (
            <CourseOutline lessons={tree.lessons} selectedTopicId={topicId} onSelectTopic={(id) => setParams({ topic: id })} />
          )}
        </section>
        <section className={styles.topicPane} aria-label="Selected topic">
          {topicId ? (
            <>
              <Button className={styles.back} variant="secondary" size="small" aria-label="Back to the course" onClick={() => setParams({})}>
                ← Back
              </Button>
              {inCourse ? <TopicPanel key={topicId} topicId={topicId} /> : <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>}
            </>
          ) : (
            <EmptyState title="Choose a topic">Its text and files appear here.</EmptyState>
          )}
        </section>
      </div>

      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load()} />
    </>
  );
}
```

Register the route:

In `apps/web/src/App.tsx` replace:

```tsx
import { CoursesPage } from './pages/courses/CoursesPage';
```

with:

```tsx
import { CoursePage } from './pages/courses/CoursePage';
import { CoursesPage } from './pages/courses/CoursesPage';
```

In `apps/web/src/App.tsx` replace:

```tsx
          <Route path="/courses" element={<CoursesPage />} />
```

with:

```tsx
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:courseId" element={<CoursePage />} />
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (436 web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat: add the course page with its accessible tree and the selected topic"
```


### Task 10: Building the course: add lessons and topics, rename, move up and down at every level, and edit a topic's text

**Files:**
- Create: `apps/web/src/pages/courses/TitleDialog.tsx`, `apps/web/src/pages/courses/EditTopicDialog.tsx`
- Modify: `apps/web/src/api/courses.ts` (+ `courses.spec.ts`), `apps/web/src/pages/courses/CourseOutline.tsx` (+ spec), `apps/web/src/pages/courses/TopicPanel.tsx`, `apps/web/src/pages/courses/CoursePage.tsx` (+ spec), `apps/web/src/pages/courses/Courses.module.css`

**Existing tests to adapt:** `apps/web/src/pages/courses/CourseOutline.spec.tsx` (its `setup` renders the tree without the new action props, which are now required: it passes `busy` and no-op handlers). Nothing from milestones 1 to 4 changes.

**Interfaces:**
- Consumes: Task 8–9 components and `CourseTree`, `LessonNode`, `TopicSummary`, `TopicView`, `getTopic`, `ApiError`, `describeError`.
- Produces:

```ts
// api/courses.ts (all but updateTopic answer the whole CourseTree)
addLesson(courseId, title); renameLesson(id, title); reorderLessons(courseId, ids)
addTopic(lessonId, title); reorderTopics(lessonId, ids); updateTopic(id, input: { title?; description? }): Promise<TopicView>
// pages/courses/TitleDialog.tsx
TitleDialog({ open, heading, label, initial, submitLabel, emptyMessage, onSubmit(title): Promise<void>, onClose })
//   one text field; the dialog closes when onSubmit resolves; a title error from the server shows under the field, anything else as an alert
// pages/courses/EditTopicDialog.tsx   EditTopicDialog({ topic: TopicView | null, onClose, onSaved })
// pages/courses/CourseOutline.tsx     props gain busy, onAddTopic(lesson), onRenameLesson(lesson), onRenameTopic(topic),
//   onMoveLesson(lesson, delta), onMoveTopic(lesson, topic, delta); each row has its buttons, tabbable only on the row that is the Tab stop
// pages/courses/TopicPanel.tsx        TopicPanel({ topicId, reloadKey, onChanged }) with an Edit topic button
```

- [ ] **Step 1: Failing tests**

Extend `apps/web/src/api/courses.spec.ts`:

In `apps/web/src/api/courses.spec.ts` replace:

```ts
import { createCourse, getCourse, getTopic, listCourses, reorderCourses, updateCourse, uploadCourseCover } from './courses';
```

with:

```ts
import {
  addLesson,
  addTopic,
  createCourse,
  getCourse,
  getTopic,
  listCourses,
  renameLesson,
  reorderCourses,
  reorderLessons,
  reorderTopics,
  updateCourse,
  updateTopic,
  uploadCourseCover,
} from './courses';
```

Append to `apps/web/src/api/courses.spec.ts`:

```ts
describe('lesson and topic api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the lesson and topic endpoints', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`.trim());
      return { body: {} };
    });
    await addLesson('c1', 'Exits');
    await renameLesson('l1', 'Exit routes');
    await reorderLessons('c1', ['l2', 'l1']);
    await addTopic('l1', 'Fire exits');
    await reorderTopics('l1', ['t2', 't1']);
    await updateTopic('t1', { description: 'Words' });
    expect(calls.filter((call) => /\/api\/(courses|lessons|topics)\//.test(call))).toEqual([
      'POST /api/courses/c1/lessons {"title":"Exits"}',
      'PATCH /api/lessons/l1 {"title":"Exit routes"}',
      'PUT /api/courses/c1/lessons/order {"ids":["l2","l1"]}',
      'POST /api/lessons/l1/topics {"title":"Fire exits"}',
      'PUT /api/lessons/l1/topics/order {"ids":["t2","t1"]}',
      'PATCH /api/topics/t1 {"description":"Words"}',
    ]);
  });
});
```

Adapt the milestone's own tree spec: `setup` in `apps/web/src/pages/courses/CourseOutline.spec.tsx` passes the new props, and the new behaviour is tested at the end of the file:

In `apps/web/src/pages/courses/CourseOutline.spec.tsx` replace:

```tsx
function setup(selectedTopicId: string | null = null) {
  const onSelectTopic = vi.fn();
  const view = render(<CourseOutline lessons={lessons} selectedTopicId={selectedTopicId} onSelectTopic={onSelectTopic} />);
  return { onSelectTopic, ...view };
}
```

with:

```tsx
function setup(selectedTopicId: string | null = null, busy = false) {
  const handlers = {
    onSelectTopic: vi.fn(),
    onAddTopic: vi.fn(),
    onRenameLesson: vi.fn(),
    onRenameTopic: vi.fn(),
    onMoveLesson: vi.fn(),
    onMoveTopic: vi.fn(),
  };
  const view = render(<CourseOutline lessons={lessons} selectedTopicId={selectedTopicId} busy={busy} {...handlers} />);
  return { ...handlers, ...view };
}
```

Append to `apps/web/src/pages/courses/CourseOutline.spec.tsx`:

```tsx
describe('CourseOutline row actions', () => {
  const row = (name: string) => within(screen.getByRole('treeitem', { name }));

  it('gives a lesson Add topic, Rename and Move up and down, and a topic Rename and Move up and down, each named after its row', () => {
    setup();
    const lesson = row('Exits');
    expect(lesson.getByRole('button', { name: 'Add a topic to Exits' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Rename lesson Exits' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Move lesson Exits up' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Move lesson Exits down' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Rename topic Fire exits' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Move topic Fire exits up' })).toBeInTheDocument();
    expect(lesson.getByRole('button', { name: 'Move topic Fire exits down' })).toBeInTheDocument();
  });

  it('disables the moves that are not possible at each level, and every move while a request runs', () => {
    const { unmount } = setup();
    expect(screen.getByRole('button', { name: 'Move lesson Exits up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move lesson Exits down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move lesson <b>Equipment</b> down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move topic Fire exits up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move topic Fire exits down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move topic Alarms down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move topic <img src=x onerror=alert(1)> up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move topic <img src=x onerror=alert(1)> down' })).toBeDisabled();
    unmount();
    setup(null, true);
    for (const button of screen.getAllByRole('button', { name: /^Move / })) expect(button).toBeDisabled();
  });

  it('reports each action with the row it belongs to', async () => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add a topic to Exits' }));
    expect(handlers.onAddTopic).toHaveBeenCalledWith(lessons[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Rename lesson Exits' }));
    expect(handlers.onRenameLesson).toHaveBeenCalledWith(lessons[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Rename topic Alarms' }));
    expect(handlers.onRenameTopic).toHaveBeenCalledWith(lessons[0]!.topics[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Move lesson Exits down' }));
    expect(handlers.onMoveLesson).toHaveBeenCalledWith(lessons[0], 1);
    await userEvent.click(screen.getByRole('button', { name: 'Move topic Alarms up' }));
    expect(handlers.onMoveTopic).toHaveBeenCalledWith(lessons[0], lessons[0]!.topics[1], -1);
  });

  it('does not open, close or choose anything when an action is clicked', async () => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Rename lesson Exits' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rename topic Alarms' }));
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
    expect(handlers.onSelectTopic).not.toHaveBeenCalled();
  });

  it('puts the buttons of the Tab stop in the tab order and the others out of it', async () => {
    setup();
    const tabbable = () => screen.getAllByRole('button').filter((button) => button.tabIndex === 0).map((button) => button.getAttribute('aria-label'));
    expect(tabbable()).toEqual(['Add a topic to Exits', 'Rename lesson Exits', 'Move lesson Exits up', 'Move lesson Exits down']);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    expect(tabbable()).toEqual(['Rename topic Fire exits', 'Move topic Fire exits up', 'Move topic Fire exits down']);
  });

  it('leaves the arrow keys to a button that has the focus', async () => {
    setup();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', 'Add a topic to Exits');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('aria-label', 'Add a topic to Exits');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
  });
});
```

Extend `apps/web/src/pages/courses/CoursePage.spec.tsx`. First the server model (the handlers sit before the cover and PATCH ones):

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
  const state = { course: structuredClone(course) };
```

with:

```tsx
  const state = { course: structuredClone(course), topics: structuredClone(topicsFixture), added: 0 };
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
    if (found) return topicsFixture[found[1] as string] ? { body: topicsFixture[found[1] as string] } : { status: 404, body: { message: 'Topic not found.' } };
```

with:

```tsx
    if (found) return state.topics[found[1] as string] ? { body: state.topics[found[1] as string] } : { status: 404, body: { message: 'Topic not found.' } };
    const lessonOf = (id: string) => state.course.lessons.find((lesson) => lesson.id === id)!;
    if (key === 'POST /api/courses/c1/lessons') {
      state.added += 1;
      state.course.lessons.push({ id: `l-new-${state.added}`, title: String(body.title), position: state.course.lessons.length, topics: [] });
      return { status: 201, body: state.course };
    }
    const renameLesson = /^PATCH \/api\/lessons\/([^/]+)$/.exec(key);
    if (renameLesson) {
      lessonOf(renameLesson[1] as string).title = String(body.title);
      return { body: state.course };
    }
    if (key === 'PUT /api/courses/c1/lessons/order') {
      state.course.lessons = (body.ids as string[]).map((id, index) => ({ ...lessonOf(id), position: index }));
      return { body: state.course };
    }
    const addTopic = /^POST \/api\/lessons\/([^/]+)\/topics$/.exec(key);
    if (addTopic) {
      state.added += 1;
      const lesson = lessonOf(addTopic[1] as string);
      lesson.topics.push({ id: `t-new-${state.added}`, title: String(body.title), position: lesson.topics.length, attachmentCount: 0 });
      return { status: 201, body: state.course };
    }
    const reorderTopics = /^PUT \/api\/lessons\/([^/]+)\/topics\/order$/.exec(key);
    if (reorderTopics) {
      const lesson = lessonOf(reorderTopics[1] as string);
      lesson.topics = (body.ids as string[]).map((id, index) => ({ ...lesson.topics.find((candidate) => candidate.id === id)!, position: index }));
      return { body: state.course };
    }
    const editTopic = /^PATCH \/api\/topics\/([^/]+)$/.exec(key);
    if (editTopic) {
      const id = editTopic[1] as string;
      Object.assign(state.topics[id]!, body);
      if (typeof body.title === 'string') for (const lesson of state.course.lessons) for (const entry of lesson.topics) if (entry.id === id) entry.title = body.title;
      return { body: state.topics[id] };
    }
```

and the tests for editing:

Append to `apps/web/src/pages/courses/CoursePage.spec.tsx`:

```tsx
describe('CoursePage: building the course', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const lessonsInTree = () => within(screen.getByRole('tree', { name: 'Course contents' })).getAllByRole('treeitem').filter((item) => item.getAttribute('aria-level') === '1');

  it('adds a lesson from a dialog and shows it at the end of the tree', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
    await userEvent.type(within(dialog).getByLabelText('Lesson title'), '  Alarms and drills ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Lesson "Alarms and drills" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/courses/c1/lessons')?.body).toEqual({ title: 'Alarms and drills' });
    expect(lessonsInTree().map((item) => item.getAttribute('aria-label'))).toEqual(['Exits', 'Equipment', 'Alarms and drills']);
    expect(screen.queryByRole('dialog', { name: 'Add lesson' })).toBeNull();
  });

  it('offers Add lesson in an empty course too', async () => {
    startServer({}, { ...tree, lessons: [] });
    renderPage();
    expect(await screen.findByText('No lessons yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add lesson' })).toBeInTheDocument();
  });

  it('asks for a title before sending anything', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Enter a lesson title.')).toBeInTheDocument();
    expect(screen.getByLabelText('Lesson title')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('shows what the server says about the title and keeps the dialog open', async () => {
    startServer({ 'POST /api/courses/c1/lessons': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Long');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add lesson' })).toBeInTheDocument();
  });

  it('shows a failure that is not about the title as an alert and keeps the dialog open', async () => {
    startServer({ 'POST /api/courses/c1/lessons': { status: 500, body: {} } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Alarms');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await within(screen.getByRole('dialog', { name: 'Add lesson' })).findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('cannot be dismissed while a title is being sent', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const pending = new Promise<MockResponse>((resolve) => (release = resolve));
    startServer({ 'POST /api/courses/c1/lessons': () => pending as unknown as MockResponse });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Slow');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    release({ status: 201, body: { ...tree, lessons: [...tree.lessons, { id: 'l-slow', title: 'Slow', position: 2, topics: [] }] } });
    expect(await screen.findByText('Lesson "Slow" added.')).toBeInTheDocument();
  });

  it('renames a lesson, starting from its current title', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename lesson Equipment' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename lesson' });
    const field = within(dialog).getByLabelText('Lesson title');
    expect(field).toHaveValue('Equipment');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Lesson renamed to "Kit".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/lessons/l2')?.body).toEqual({ title: 'Kit' });
    expect(screen.getByRole('treeitem', { name: 'Kit' })).toBeInTheDocument();
  });

  it('adds a topic to a lesson and shows it in that lesson', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a topic to Equipment' }));
    const dialog = screen.getByRole('dialog', { name: 'Add topic' });
    await userEvent.type(within(dialog).getByLabelText('Topic title'), 'Extinguishers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add topic' }));
    expect(await screen.findByText('Topic "Extinguishers" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/lessons/l2/topics')?.body).toEqual({ title: 'Extinguishers' });
    expect(within(screen.getByRole('treeitem', { name: 'Equipment' })).getByRole('treeitem', { name: 'Extinguishers' })).toBeInTheDocument();
  });

  it('renames a topic and updates the open topic panel', async () => {
    const calls = startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    await userEvent.click(screen.getByRole('button', { name: 'Rename topic Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename topic' });
    const field = within(dialog).getByLabelText('Topic title');
    expect(field).toHaveValue('Fire exits');
    await userEvent.clear(field);
    await userEvent.type(field, 'Exit routes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Topic renamed to "Exit routes".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ title: 'Exit routes' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Exit routes' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Exit routes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves a lesson down and sends the whole order of lessons', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move lesson Exits down' }));
    await waitFor(() => expect(lessonsInTree().map((item) => item.getAttribute('aria-label'))).toEqual(['Equipment', 'Exits']));
    expect(calls.find((call) => call.key === 'PUT /api/courses/c1/lessons/order')?.body).toEqual({ ids: ['l2', 'l1'] });
    expect(screen.getByRole('button', { name: 'Move lesson Equipment up' })).toBeDisabled();
  });

  it('moves a topic up inside its lesson and sends only that lesson\'s order', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move topic <b>Alarms</b> up' }));
    await waitFor(() => expect(within(screen.getByRole('treeitem', { name: 'Exits' })).getAllByRole('treeitem').map((item) => item.getAttribute('aria-label'))).toEqual(['<b>Alarms</b>', 'Fire exits']));
    expect(calls.find((call) => call.key === 'PUT /api/lessons/l1/topics/order')?.body).toEqual({ ids: ['t2', 't1'] });
  });

  it('says so and reloads when the order changed under you', async () => {
    const calls = startServer({ 'PUT /api/courses/c1/lessons/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move lesson Exits down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/courses/c1')).toHaveLength(2));
  });

  describe('editing a topic', () => {
    it('starts from the current text and sends only what changed', async () => {
      const calls = startServer();
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit topic' });
      expect(within(dialog).getByLabelText('Topic title')).toHaveValue('Fire exits');
      const text = within(dialog).getByLabelText('Description');
      expect(text).toHaveValue('Keep them clear.\nNever lock them.');
      await userEvent.clear(text);
      await userEvent.type(text, '  New text ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit topic' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ description: 'New text' });
      expect(await screen.findByText('New text')).toBeInTheDocument();
    });

    it('clears the text with an empty description and does not call the server for no change', async () => {
      const calls = startServer();
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit topic' })).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit topic' })).toBeNull());
      expect(calls.some((call) => call.key === 'PATCH /api/topics/t1')).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Edit topic' }));
      await userEvent.clear(screen.getByLabelText('Description'));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit topic' })).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ description: '' }));
    });

    it('asks for a title and shows what the server says about the text', async () => {
      startServer({ 'PATCH /api/topics/t1': { status: 400, body: { message: 'Validation failed', fieldErrors: { description: ['Description must be 10,000 characters or fewer.'] } } } });
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      await userEvent.clear(screen.getByLabelText('Topic title'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Enter a topic title.')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Topic title'), 'Fire exits again');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Description must be 10,000 characters or fewer.')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Edit topic' })).toBeInTheDocument();
    });
  });
});
```

Run: `npm test -w @jbf/web -- courses CourseOutline CoursePage`
Expected: FAIL (the functions, dialogs, buttons and props do not exist yet).

- [ ] **Step 2: The API calls**

Append to `apps/web/src/api/courses.ts`:

```ts

export const addLesson = (courseId: string, title: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons`, { method: 'POST', body: { title } });

export const renameLesson = (id: string, title: string): Promise<CourseTree> => api<CourseTree>(`/api/lessons/${id}`, { method: 'PATCH', body: { title } });

export const reorderLessons = (courseId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons/order`, { method: 'PUT', body: { ids } });

export const addTopic = (lessonId: string, title: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics`, { method: 'POST', body: { title } });

export const reorderTopics = (lessonId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics/order`, { method: 'PUT', body: { ids } });

export const updateTopic = (id: string, input: { title?: string; description?: string }): Promise<TopicView> =>
  api<TopicView>(`/api/topics/${id}`, { method: 'PATCH', body: input });
```

- [ ] **Step 3: The dialogs**

Create `apps/web/src/pages/courses/TitleDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

interface TitleDialogProps {
  open: boolean;
  // The dialog's name ("Add lesson"), the field's label ("Lesson title"), the button ("Add lesson" or "Save") and what to
  // say when the field is empty ("Enter a lesson title.").
  heading: string;
  label: string;
  initial: string;
  submitLabel: string;
  emptyMessage: string;
  // Sends the trimmed title; the dialog closes when this resolves.
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}

// One text field in a dialog: adding a lesson or a topic, renaming either, renaming an attachment.
export function TitleDialog(props: TitleDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.heading} blocked={busy}>
      <TitleForm {...props} busy={busy} setBusy={setBusy} />
    </Dialog>
  );
}

function TitleForm({
  label,
  initial,
  submitLabel,
  emptyMessage,
  onSubmit,
  onClose,
  busy,
  setBusy,
}: TitleDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError(emptyMessage);
      setFocusRequest({});
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors.title) {
        setError(caught.fieldErrors.title.join(' '));
        setFocusRequest({});
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={inputRef} label={label} autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} error={error} />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
```

Create `apps/web/src/pages/courses/EditTopicDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type TopicView, updateTopic } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import media from '../media/Media.module.css';

interface EditTopicDialogProps {
  topic: TopicView | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditTopicDialog({ topic, onClose, onSaved }: EditTopicDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={topic !== null} onClose={onClose} title="Edit topic" blocked={busy}>
      {topic ? <EditForm topic={topic} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function EditForm({
  topic,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<EditTopicDialogProps, 'onClose' | 'onSaved'> & { topic: TopicView; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(topic.title);
  const [description, setDescription] = useState(topic.description ?? '');
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) titleRef.current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!title.trim()) {
      setErrors({ title: 'Enter a topic title.' });
      setFocusRequest({});
      return;
    }
    setErrors({});
    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== topic.title) changes.title = title.trim();
    if (description.trim() !== (topic.description ?? '')) changes.description = description.trim();
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await updateTopic(topic.id, changes);
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.fieldErrors.title || caught.fieldErrors.description)) {
        setErrors({ title: caught.fieldErrors.title?.join(' '), description: caught.fieldErrors.description?.join(' ') });
        if (caught.fieldErrors.title) setFocusRequest({});
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={titleRef} label="Topic title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea
        label="Description"
        rows={8}
        maxLength={10000}
        hint="Plain text. Line breaks are kept."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: The tree gets its row actions**

Replace the whole of `apps/web/src/pages/courses/CourseOutline.tsx` with:

```tsx
import { type KeyboardEvent, useRef, useState } from 'react';
import type { LessonNode, TopicSummary } from '../../api/courses';
import { Button } from '../../components/Button';
import styles from './Courses.module.css';

interface CourseOutlineProps {
  lessons: LessonNode[];
  selectedTopicId: string | null;
  // While a change is being sent the moves are off, so two cannot cross.
  busy: boolean;
  onSelectTopic: (topicId: string) => void;
  onAddTopic: (lesson: LessonNode) => void;
  onRenameLesson: (lesson: LessonNode) => void;
  onRenameTopic: (topic: TopicSummary) => void;
  onMoveLesson: (lesson: LessonNode, delta: -1 | 1) => void;
  onMoveTopic: (lesson: LessonNode, topic: TopicSummary, delta: -1 | 1) => void;
}

type Entry = { kind: 'lesson'; id: string; lesson: LessonNode } | { kind: 'topic'; id: string; lessonId: string };

const filesText = (topic: TopicSummary): string =>
  topic.attachmentCount === 0 ? 'No files' : topic.attachmentCount === 1 ? '1 file' : `${topic.attachmentCount} files`;

// The lessons and topics in the order the arrow keys walk them: a closed lesson hides its topics.
function visibleEntries(lessons: LessonNode[], closed: ReadonlySet<string>): Entry[] {
  return lessons.flatMap((lesson): Entry[] => [
    { kind: 'lesson', id: lesson.id, lesson },
    ...(closed.has(lesson.id) ? [] : lesson.topics.map((topic): Entry => ({ kind: 'topic', id: topic.id, lessonId: lesson.id }))),
  ]);
}

// An accessible tree (the WAI-ARIA tree pattern): one item is reachable with Tab, the arrow keys do the rest, and the
// state of every lesson is announced through aria-expanded. The buttons of a row are reached with Tab from that row.
export function CourseOutline({ lessons, selectedTopicId, busy, onSelectTopic, onAddTopic, onRenameLesson, onRenameTopic, onMoveLesson, onMoveTopic }: CourseOutlineProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const entries = visibleEntries(lessons, closed);
  const has = (id: string | null): id is string => id !== null && entries.some((entry) => entry.id === id);
  const tabStop = has(lastUsed) ? lastUsed : has(selectedTopicId) ? selectedTopicId : (entries[0]?.id ?? null);

  const focusEntry = (id: string): void => {
    setLastUsed(id);
    elements.current.get(id)?.focus();
  };

  const toggle = (lessonId: string, open: boolean): void => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target as HTMLElement;
    // Keys typed in something inside a row (a button) belong to that button.
    if (target.getAttribute('role') !== 'treeitem') return;
    const index = entries.findIndex((entry) => entry.id === target.dataset.id);
    const entry = entries[index];
    if (!entry) return;
    const go = (to: Entry | undefined): void => {
      event.preventDefault();
      if (to) focusEntry(to.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        go(entries[index + 1]);
        break;
      case 'ArrowUp':
        go(entries[index - 1]);
        break;
      case 'Home':
        go(entries[0]);
        break;
      case 'End':
        go(entries[entries.length - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (closed.has(entry.id)) toggle(entry.id, true);
          else if (entry.lesson.topics.length > 0) focusEntry(entries[index + 1]!.id);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (entry.kind === 'lesson') {
          if (!closed.has(entry.id)) toggle(entry.id, false);
        } else {
          focusEntry(entry.lessonId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (entry.kind === 'lesson') toggle(entry.id, closed.has(entry.id));
        else onSelectTopic(entry.id);
        break;
    }
  }

  const register = (id: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  };

  // Focus moving to an item itself (not to something inside it) makes it the item Tab comes back to.
  const noteFocus = (id: string) => (event: { target: EventTarget; currentTarget: EventTarget }) => {
    if (event.target === event.currentTarget) setLastUsed(id);
  };

  return (
    <ul role="tree" aria-label="Course contents" className={styles.tree} onKeyDown={onKeyDown}>
      {lessons.map((lesson, lessonIndex) => {
        const open = !closed.has(lesson.id);
        const lessonTab = tabStop === lesson.id ? 0 : -1;
        return (
          <li
            key={lesson.id}
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-label={lesson.title}
            data-id={lesson.id}
            tabIndex={lessonTab}
            ref={register(lesson.id)}
            onFocus={noteFocus(lesson.id)}
            className={styles.item}
          >
            <div className={styles.row}>
              <span className={`${styles.label} ${styles.lessonLabel}`} onClick={() => toggle(lesson.id, !open)}>
                <span aria-hidden="true">{open ? '▾ ' : '▸ '}</span>
                {lesson.title}
              </span>
              <div className={styles.actions}>
                <Button variant="secondary" size="small" tabIndex={lessonTab} aria-label={`Add a topic to ${lesson.title}`} onClick={() => onAddTopic(lesson)}>
                  Add topic
                </Button>
                <Button variant="secondary" size="small" tabIndex={lessonTab} aria-label={`Rename lesson ${lesson.title}`} onClick={() => onRenameLesson(lesson)}>
                  Rename
                </Button>
                <Button variant="secondary" size="small" tabIndex={lessonTab} disabled={busy || lessonIndex === 0} aria-label={`Move lesson ${lesson.title} up`} onClick={() => onMoveLesson(lesson, -1)}>
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  tabIndex={lessonTab}
                  disabled={busy || lessonIndex === lessons.length - 1}
                  aria-label={`Move lesson ${lesson.title} down`}
                  onClick={() => onMoveLesson(lesson, 1)}
                >
                  ↓
                </Button>
              </div>
            </div>
            {open ? (
              lesson.topics.length === 0 ? (
                <p className={styles.hint}>No topics yet</p>
              ) : (
                <ul role="group" className={styles.group}>
                  {lesson.topics.map((topic, topicIndex) => {
                    const topicTab = tabStop === topic.id ? 0 : -1;
                    return (
                      <li
                        key={topic.id}
                        role="treeitem"
                        aria-level={2}
                        aria-selected={topic.id === selectedTopicId}
                        aria-label={topic.title}
                        data-id={topic.id}
                        tabIndex={topicTab}
                        ref={register(topic.id)}
                        onFocus={noteFocus(topic.id)}
                        className={topic.id === selectedTopicId ? `${styles.item} ${styles.selected}` : styles.item}
                      >
                        <div className={styles.row}>
                          <span className={styles.label} onClick={() => onSelectTopic(topic.id)}>
                            {topic.title}
                          </span>
                          <span className={styles.count}>{filesText(topic)}</span>
                          <div className={styles.actions}>
                            <Button variant="secondary" size="small" tabIndex={topicTab} aria-label={`Rename topic ${topic.title}`} onClick={() => onRenameTopic(topic)}>
                              Rename
                            </Button>
                            <Button
                              variant="secondary"
                              size="small"
                              tabIndex={topicTab}
                              disabled={busy || topicIndex === 0}
                              aria-label={`Move topic ${topic.title} up`}
                              onClick={() => onMoveTopic(lesson, topic, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="secondary"
                              size="small"
                              tabIndex={topicTab}
                              disabled={busy || topicIndex === lesson.topics.length - 1}
                              aria-label={`Move topic ${topic.title} down`}
                              onClick={() => onMoveTopic(lesson, topic, 1)}
                            >
                              ↓
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

Add the row-action style:

In `apps/web/src/pages/courses/Courses.module.css` replace:

```css
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
```

with:

```css
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
```

In `apps/web/src/pages/courses/Courses.module.css`, after:

```css
.count {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
```

add:

```css

.actions {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.topicHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.treeHeader {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-3);
}
```

- [ ] **Step 5: The topic panel and the page**

Replace the whole of `apps/web/src/pages/courses/TopicPanel.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { getTopic, type TopicView } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';
import { EditTopicDialog } from './EditTopicDialog';

interface TopicPanelProps {
  topicId: string;
  // Goes up whenever the page changed something that may be in this topic (for example its title), so it reloads.
  reloadKey: number;
  // The topic's own text was saved: the page reloads the tree, which shows its title.
  onChanged: () => void;
}

// The chosen topic: its title and text. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId, reloadKey, onChanged }: TopicPanelProps) {
  const [topic, setTopic] = useState<TopicView | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTopic(await getTopic(topicId));
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (missing) return <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>;
  if (loadError) {
    return (
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
    );
  }
  if (!topic) return <Skeleton rows={3} />;

  return (
    <>
      <div className={styles.topicHeader}>
        <h2 className={styles.topicTitle}>{topic.title}</h2>
        <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
          Edit topic
        </Button>
      </div>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}
      <EditTopicDialog
        topic={editing ? topic : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />
    </>
  );
}
```

Replace the whole of `apps/web/src/pages/courses/CoursePage.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { addLesson, addTopic, type CourseTree, getCourse, type LessonNode, renameLesson, reorderLessons, reorderTopics, type TopicSummary, updateTopic } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';
import { CourseOutline } from './CourseOutline';
import { EditCourseDialog } from './EditCourseDialog';
import { TitleDialog } from './TitleDialog';
import { TopicPanel } from './TopicPanel';

type Notice = { tone: 'error' | 'success'; text: string };

type TitleMode =
  | { kind: 'add-lesson' }
  | { kind: 'rename-lesson'; lesson: LessonNode }
  | { kind: 'add-topic'; lesson: LessonNode }
  | { kind: 'rename-topic'; topic: TopicSummary };

// The key gives every course its own page state when moving from one to another.
export function CoursePage() {
  const { courseId = '' } = useParams();
  return <Course key={courseId} courseId={courseId} />;
}

function Course({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topic');
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleMode, setTitleMode] = useState<TitleMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setTree(await getCourse(courseId));
      setMissing(false);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <EmptyState title="Course not found">
        <Link to="/courses">Back to Courses</Link>
      </EmptyState>
    );
  }
  if (loadError) {
    return (
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
    );
  }
  if (!tree) return <Skeleton />;

  const inCourse = tree.lessons.some((lesson) => lesson.topics.some((topic) => topic.id === topicId));

  // Every change answers with the whole tree. A change that fails is explained, and the tree is read again in case it moved on.
  async function move(change: () => Promise<CourseTree>) {
    setBusy(true);
    setNotice(null);
    try {
      setTree(await change());
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function swapped(ids: string[], id: string, delta: -1 | 1): string[] {
    const next = [...ids];
    const index = next.indexOf(id);
    [next[index], next[index + delta]] = [next[index + delta] as string, next[index] as string];
    return next;
  }

  // Sends a title from the dialog; the dialog explains a failure, and closes when this resolves.
  const sendTitle = async (mode: TitleMode, title: string): Promise<void> => {
    switch (mode.kind) {
      case 'add-lesson':
        setTree(await addLesson(tree.id, title));
        setNotice({ tone: 'success', text: `Lesson "${title}" added.` });
        break;
      case 'rename-lesson':
        setTree(await renameLesson(mode.lesson.id, title));
        setNotice({ tone: 'success', text: `Lesson renamed to "${title}".` });
        break;
      case 'add-topic':
        setTree(await addTopic(mode.lesson.id, title));
        setNotice({ tone: 'success', text: `Topic "${title}" added.` });
        break;
      case 'rename-topic':
        await updateTopic(mode.topic.id, { title });
        setNotice({ tone: 'success', text: `Topic renamed to "${title}".` });
        await load();
        // The open topic may be the one that was renamed.
        setReloadKey((key) => key + 1);
        break;
    }
  };

  const dialog = titleMode
    ? {
        'add-lesson': { heading: 'Add lesson', label: 'Lesson title', initial: '', submitLabel: 'Add lesson', emptyMessage: 'Enter a lesson title.' },
        'rename-lesson': { heading: 'Rename lesson', label: 'Lesson title', initial: titleMode.kind === 'rename-lesson' ? titleMode.lesson.title : '', submitLabel: 'Save', emptyMessage: 'Enter a lesson title.' },
        'add-topic': { heading: 'Add topic', label: 'Topic title', initial: '', submitLabel: 'Add topic', emptyMessage: 'Enter a topic title.' },
        'rename-topic': { heading: 'Rename topic', label: 'Topic title', initial: titleMode.kind === 'rename-topic' ? titleMode.topic.title : '', submitLabel: 'Save', emptyMessage: 'Enter a topic title.' },
      }[titleMode.kind]
    : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className={media.crumbs}>
        <Link to="/courses">Courses</Link> › {tree.title}
      </nav>
      <div className={media.header}>
        <h1>{tree.title}</h1>
        <Button onClick={() => setEditing(true)}>Edit course</Button>
      </div>
      {tree.coverUrl || tree.description ? (
        <div className={styles.hero}>
          {tree.coverUrl ? <img className={styles.cover} src={tree.coverUrl} alt="" /> : null}
          {tree.description ? <p className={styles.about}>{tree.description}</p> : null}
        </div>
      ) : null}

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className={styles.panes} data-view={topicId ? 'topic' : 'tree'}>
        <section className={styles.treePane} aria-label="Lessons and topics">
          <div className={styles.treeHeader}>
            <Button size="small" onClick={() => setTitleMode({ kind: 'add-lesson' })}>
              Add lesson
            </Button>
          </div>
          {tree.lessons.length === 0 ? (
            <EmptyState title="No lessons yet">Add a lesson to start building the course.</EmptyState>
          ) : (
            <CourseOutline
              lessons={tree.lessons}
              selectedTopicId={topicId}
              busy={busy}
              onSelectTopic={(id) => setParams({ topic: id })}
              onAddTopic={(lesson) => setTitleMode({ kind: 'add-topic', lesson })}
              onRenameLesson={(lesson) => setTitleMode({ kind: 'rename-lesson', lesson })}
              onRenameTopic={(topic) => setTitleMode({ kind: 'rename-topic', topic })}
              onMoveLesson={(lesson, delta) =>
                void move(() =>
                  reorderLessons(
                    tree.id,
                    swapped(
                      tree.lessons.map((candidate) => candidate.id),
                      lesson.id,
                      delta,
                    ),
                  ),
                )
              }
              onMoveTopic={(lesson, topic, delta) =>
                void move(() =>
                  reorderTopics(
                    lesson.id,
                    swapped(
                      lesson.topics.map((candidate) => candidate.id),
                      topic.id,
                      delta,
                    ),
                  ),
                )
              }
            />
          )}
        </section>
        <section className={styles.topicPane} aria-label="Selected topic">
          {topicId ? (
            <>
              <Button className={styles.back} variant="secondary" size="small" aria-label="Back to the course" onClick={() => setParams({})}>
                ← Back
              </Button>
              {inCourse ? (
                <TopicPanel key={topicId} topicId={topicId} reloadKey={reloadKey} onChanged={() => void load()} />
              ) : (
                <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>
              )}
            </>
          ) : (
            <EmptyState title="Choose a topic">Its text and files appear here.</EmptyState>
          )}
        </section>
      </div>

      <EditCourseDialog course={editing ? tree : null} onClose={() => setEditing(false)} onChanged={() => void load()} />
      <TitleDialog
        open={titleMode !== null}
        heading={dialog?.heading ?? ''}
        label={dialog?.label ?? ''}
        initial={dialog?.initial ?? ''}
        submitLabel={dialog?.submitLabel ?? ''}
        emptyMessage={dialog?.emptyMessage ?? ''}
        onSubmit={(title) => (titleMode ? sendTitle(titleMode, title) : Promise.resolve())}
        onClose={() => setTitleMode(null)}
      />
    </>
  );
}
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (458 web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat: add lessons and topics, renaming, moving and topic text to the course page"
```


### Task 11: Attachments in the topic: the list, adding from the library, renaming, moving and the four ways to open them

**Files:**
- Create: `apps/web/src/pages/courses/AttachmentList.tsx`, `apps/web/src/pages/courses/LibraryPickerDialog.tsx`, `apps/web/src/pages/courses/ImageDialog.tsx`, `apps/web/src/pages/courses/TopicPanel.spec.tsx`
- Modify: `apps/web/src/api/courses.ts` (+ `courses.spec.ts`), `apps/web/src/pages/courses/TopicPanel.tsx`, `apps/web/src/pages/courses/CoursePage.tsx`, `apps/web/src/pages/courses/Courses.module.css`, `apps/web/src/player/PlayerContext.tsx`, `apps/web/src/player/DockedPlayer.tsx`, `apps/web/src/pages/media/PlayerDialog.tsx`, `apps/web/src/pages/media/FolderPage.tsx`

**Existing tests to adapt:**
- `apps/web/src/player/DockedPlayer.spec.tsx` (the two track fixtures: a track now carries a `link` function and the text under its title, `place`, instead of an item id and two words; the bar shows exactly the same text).
- `apps/web/src/components/AppShell.spec.tsx` (its song fixture, the same change as in the player spec).
- `apps/web/src/pages/media/FolderPage.spec.tsx` (the dock assertion: "starts a song in the docked player" now expects the new track shape; the pop-up and dock behaviour is unchanged).
- `apps/web/src/pages/courses/CoursePage.spec.tsx` and `apps/web/src/App.spec.tsx` (a topic answer now carries its `attachments`; the fixtures say `[]`).

**Interfaces:**
- Consumes: `TopicView`, `getTopic`, `CourseTree` (Tasks 8–10), `listFolders`, `listItems`, `Folder`, `MediaItem`, `CategorySlug`, `playItem` (`api/media.ts`), `CATEGORIES` (`media/categories.ts`), `usePlayer`, `formatBytes`, `formatDuration`, `Badge`, `Table`, `Select`, `TitleDialog` (Task 10).
- Produces:

```ts
// api/courses.ts
type AttachmentKind = 'video' | 'audio' | 'pdf' | 'image'
interface Attachment { id; topicId; position; kind: AttachmentKind; title; source: 'upload' | 'library'; status: 'uploading' | 'ready'; sizeBytes; durationSeconds: number | null;
  thumbnailUrl: string | null; libraryItemId: string | null; category: MediaCategory | null; libraryFolderName: string | null; createdBy: { id; name }; createdAt: string }
interface TopicDetail extends TopicView { attachments: Attachment[] }          getTopic(id): Promise<TopicDetail>
interface OpenLink { url; expiresAt; contentType; kind: AttachmentKind }
addLibraryAttachment(topicId, itemId): Promise<Attachment>; renameAttachment(id, title): Promise<Attachment>
reorderAttachments(topicId, ids): Promise<Attachment[]>; openAttachment(id): Promise<OpenLink>
// player/PlayerContext.tsx   DockTrack { link: () => Promise<{ url: string }>; title; place: string; coverUrl: string | null }
// pages/media/PlayerDialog.tsx   VideoTarget { id; title; description: string | null; addedBy; addedAt; link: () => Promise<{ url: string }> };  PlayerDialog({ video, onClose })
// pages/courses/AttachmentList.tsx   AttachmentList({ attachments, busy, onOpen, onRename, onMove })
// pages/courses/LibraryPickerDialog.tsx   LibraryPickerDialog({ open, topicId, onClose, onAttached })
// pages/courses/ImageDialog.tsx   ImageDialog({ attachment, onClose })
// pages/courses/TopicPanel.tsx    TopicPanel({ topicId, courseTitle, lessonTitle, reloadKey, onChanged })
// Opening: video -> the pop-up; audio -> the dock with the place "Songs › folder" (library) or "Course › Lesson › Topic" (uploaded);
//   PDF -> a tab opened straight from the click (window.open('', '_blank')), sent to the link when it arrives; image -> a pop-up.
```

- [ ] **Step 1: Adapt what the new shapes change, then write the failing tests**

In `apps/web/src/player/DockedPlayer.spec.tsx`:

In `apps/web/src/player/DockedPlayer.spec.tsx` replace:

```tsx
const song: DockTrack = { itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null };
const podcast: DockTrack = { itemId: 'p1', title: 'Episode 4', categoryLabel: 'Podcasts', folderName: 'Weekly', coverUrl: 'https://cdn.example/cover?sig=1' };
```

with:

```tsx
const song: DockTrack = { link: () => playItem('s1'), title: 'Morning song', place: 'Songs › Road trip', coverUrl: null };
const podcast: DockTrack = { link: () => playItem('p1'), title: 'Episode 4', place: 'Podcasts › Weekly', coverUrl: 'https://cdn.example/cover?sig=1' };
```

In `apps/web/src/player/DockedPlayer.spec.tsx` replace:

```tsx
import type { MockResponse } from '../test/fetch-mock';
```

with:

```tsx
import { playItem } from '../api/media';
import type { MockResponse } from '../test/fetch-mock';
```

In `apps/web/src/components/AppShell.spec.tsx`:

In `apps/web/src/components/AppShell.spec.tsx` replace:

```tsx
const song: DockTrack = { itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null };
```

with:

```tsx
const song: DockTrack = { link: () => playItem('s1'), title: 'Morning song', place: 'Songs › Road trip', coverUrl: null };
```

In `apps/web/src/components/AppShell.spec.tsx` replace:

```tsx
import type { User } from '../api/auth';
```

with:

```tsx
import type { User } from '../api/auth';
import { playItem } from '../api/media';
```

In `apps/web/src/pages/media/FolderPage.spec.tsx`:

In `apps/web/src/pages/media/FolderPage.spec.tsx` replace:

```tsx
    expect(player.play).toHaveBeenCalledWith({ itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null });
```

with:

```tsx
    expect(player.play).toHaveBeenCalledWith({ link: expect.any(Function), title: 'Morning song', place: 'Songs › Road trip', coverUrl: null });
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` the topic fixtures say they have no attachments, and the page now needs the player context (the app shell provides it) because opening an audio attachment uses the dock:

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
import type { CourseTree, TopicView } from '../../api/courses';
```

with:

```tsx
import type { CourseTree, TopicDetail } from '../../api/courses';
import { PlayerProvider } from '../../player/PlayerContext';
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
const topic = (overrides: Partial<TopicView> & { id: string; title: string }): TopicView => ({
  lessonId: 'l1',
  courseId: 'c1',
  description: null,
  position: 0,
  ...overrides,
});
const topicsFixture: Record<string, TopicView> = {
```

with:

```tsx
const topic = (overrides: Partial<TopicDetail> & { id: string; title: string }): TopicDetail => ({
  lessonId: 'l1',
  courseId: 'c1',
  description: null,
  position: 0,
  attachments: [],
  ...overrides,
});
const topicsFixture: Record<string, TopicDetail> = {
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
  return renderWithSession(
    <>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/courses" element={<p>The course list</p>} />
      </Routes>
      <LocationProbe />
    </>,
    route,
  );
```

with:

```tsx
  return renderWithSession(
    <PlayerProvider>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/courses" element={<p>The course list</p>} />
      </Routes>
      <LocationProbe />
    </PlayerProvider>,
    route,
  );
```

In `apps/web/src/App.spec.tsx` the same for the route test:

In `apps/web/src/App.spec.tsx` replace:

```tsx
      if (url === '/api/topics/t1') return { body: { id: 't1', lessonId: 'l1', courseId: 'c1', title: 'Fire exits', description: null, position: 0 } };
```

with:

```tsx
      if (url === '/api/topics/t1') return { body: { id: 't1', lessonId: 'l1', courseId: 'c1', title: 'Fire exits', description: null, position: 0, attachments: [] } };
```

Extend `apps/web/src/api/courses.spec.ts`:

In `apps/web/src/api/courses.spec.ts` replace:

```ts
import {
  addLesson,
  addTopic,
```

with:

```ts
import {
  addLesson,
  addLibraryAttachment,
  addTopic,
```

In `apps/web/src/api/courses.spec.ts` replace:

```ts
  listCourses,
  renameLesson,
```

with:

```ts
  listCourses,
  openAttachment,
  renameAttachment,
  renameLesson,
  reorderAttachments,
```

Append to `apps/web/src/api/courses.spec.ts`:

```ts
describe('attachment api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the attachment endpoints', async () => {
    const calls: string[] = [];
    mockSession(STAFF, (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`.trim());
      return { body: {} };
    });
    await addLibraryAttachment('t1', 'item-1');
    await renameAttachment('a1', 'Exit map');
    await reorderAttachments('t1', ['a2', 'a1']);
    await openAttachment('a1');
    expect(calls.filter((call) => /\/api\/(topics|attachments)\//.test(call))).toEqual([
      'POST /api/topics/t1/attachments/library {"itemId":"item-1"}',
      'PATCH /api/attachments/a1 {"title":"Exit map"}',
      'PUT /api/topics/t1/attachments/order {"ids":["a2","a1"]}',
      'POST /api/attachments/a1/open',
    ]);
  });
});
```

Create `apps/web/src/pages/courses/TopicPanel.spec.tsx`:

```tsx
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, TopicDetail } from '../../api/courses';
import type { Folder, MediaItem } from '../../api/media';
import { PlayerContext, type PlayerValue } from '../../player/PlayerContext';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { TopicPanel } from './TopicPanel';

const attachment = (overrides: Partial<Attachment> & { id: string; title: string }): Attachment => ({
  topicId: 't1',
  position: 0,
  kind: 'pdf',
  source: 'upload',
  status: 'ready',
  sizeBytes: 2048,
  durationSeconds: null,
  thumbnailUrl: null,
  libraryItemId: null,
  category: null,
  libraryFolderName: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  ...overrides,
});

const fixture: Attachment[] = [
  attachment({ id: 'a1', title: 'Exit map', kind: 'pdf', sizeBytes: 2 * 1024 ** 2 }),
  attachment({ id: 'a2', title: 'Safety briefing', kind: 'audio', position: 1, durationSeconds: 125, sizeBytes: 5 * 1024 ** 2 }),
  attachment({ id: 'a3', title: 'Floor plan', kind: 'image', position: 2, thumbnailUrl: 'https://cdn.example/thumb-a3?sig=1', sizeBytes: 300 * 1024 }),
  attachment({
    id: 'a4',
    title: 'Evacuation film',
    kind: 'video',
    position: 3,
    source: 'library',
    libraryItemId: 'v1',
    category: 'video',
    libraryFolderName: 'Safety Training',
    durationSeconds: 724,
    thumbnailUrl: 'https://cdn.example/cover-v1?sig=1',
    sizeBytes: 412 * 1024 ** 2,
  }),
  attachment({ id: 'a5', title: 'Morning song', kind: 'audio', position: 4, source: 'library', libraryItemId: 's1', category: 'song', libraryFolderName: 'Road trip', durationSeconds: 185, sizeBytes: 4 * 1024 ** 2 }),
];

const topic = (attachments: Attachment[], overrides: Partial<TopicDetail> = {}): TopicDetail => ({
  id: 't1',
  lessonId: 'l1',
  courseId: 'c1',
  title: 'Fire exits',
  description: null,
  position: 0,
  attachments,
  ...overrides,
});

const folders: Folder[] = [
  { id: 'f1', name: 'Safety Training', position: 0, itemCount: 2, category: 'video' },
  { id: 'f2', name: 'Kitchen', position: 1, itemCount: 0, category: 'video' },
];
const songFolders: Folder[] = [{ id: 'sf1', name: 'Road trip', position: 0, itemCount: 1, category: 'song' }];
const libraryItem = (overrides: Partial<MediaItem> & { id: string; title: string }): MediaItem => ({
  folderId: 'f1',
  description: null,
  durationSeconds: 90,
  sizeBytes: 10 * 1024 ** 2,
  status: 'ready',
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-08T10:00:00Z',
  position: 0,
  category: 'video',
  ...overrides,
});
const items: Record<string, MediaItem[]> = {
  f1: [libraryItem({ id: 'v1', title: 'Fire exits film' }), libraryItem({ id: 'v2', title: 'First aid basics', position: 1 }), libraryItem({ id: 'v3', title: 'Still uploading', position: 2, status: 'uploading' })],
  f2: [],
  sf1: [libraryItem({ id: 's9', title: 'Calm song', folderId: 'sf1', category: 'song' })],
};

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(initial: TopicDetail = topic(fixture), overrides: Record<string, Override> = {}) {
  const state = { topic: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/topics/t1') return { body: state.topic };
    if (key === 'GET /api/media/videos/folders') return { body: folders };
    if (key === 'GET /api/media/songs/folders') return { body: songFolders };
    const folderItems = /^GET \/api\/media\/folders\/([^/]+)\/items$/.exec(key);
    if (folderItems) return { body: items[folderItems[1] as string] ?? [] };
    if (key === 'POST /api/topics/t1/attachments/library') {
      const created = attachment({ id: 'a-new', title: 'Fire exits film', kind: 'video', source: 'library', libraryItemId: String(body.itemId), category: 'video', libraryFolderName: 'Safety Training', position: state.topic.attachments.length });
      state.topic.attachments.push(created);
      return { status: 201, body: created };
    }
    const rename = /^PATCH \/api\/attachments\/([^/]+)$/.exec(key);
    if (rename) {
      const target = state.topic.attachments.find((candidate) => candidate.id === rename[1])!;
      target.title = String(body.title);
      return { body: target };
    }
    if (key === 'PUT /api/topics/t1/attachments/order') {
      const ids = body.ids as string[];
      const ready = ids.map((id) => state.topic.attachments.find((candidate) => candidate.id === id)!);
      state.topic.attachments = [...ready, ...state.topic.attachments.filter((candidate) => !ids.includes(candidate.id))];
      return { body: state.topic.attachments };
    }
    const open = /^POST \/api\/attachments\/([^/]+)\/open$/.exec(key);
    if (open) {
      const target = state.topic.attachments.find((candidate) => candidate.id === open[1])!;
      return { body: { url: `https://cdn.example/${open[1]}?sig=1`, expiresAt: '2026-10-09T11:00:00Z', contentType: 'application/octet-stream', kind: target.kind } };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

function renderPanel(options: { player?: PlayerValue; strict?: boolean; onChanged?: () => void } = {}) {
  const { player = fakePlayer(), strict = false, onChanged = vi.fn() } = options;
  const panel = (
    <PlayerContext.Provider value={player}>
      <TopicPanel topicId="t1" courseTitle="Fire safety" lessonTitle="Exits" reloadKey={0} onChanged={onChanged} />
    </PlayerContext.Provider>
  );
  renderWithSession(strict ? <StrictMode>{panel}</StrictMode> : panel);
  return { player, onChanged };
}

const row = (name: RegExp | string) => screen.getByRole('row', { name });

describe('TopicPanel attachments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('lists the attachments in order with their type, length, size and source', async () => {
    startServer();
    renderPanel();
    const table = await screen.findByRole('table', { name: 'Attachments' });
    expect(within(table).getAllByRole('row').slice(1).map((entry) => within(entry).getAllByRole('cell')[0]!.textContent)).toEqual([
      expect.stringContaining('Exit map'),
      expect.stringContaining('Safety briefing'),
      expect.stringContaining('Floor plan'),
      expect.stringContaining('Evacuation film'),
      expect.stringContaining('Morning song'),
    ]);
    const pdf = row(/Exit map/);
    expect(within(pdf).getByText('PDF')).toBeInTheDocument();
    expect(within(pdf).getByText('2 MB')).toBeInTheDocument();
    const audio = row(/Safety briefing/);
    expect(within(audio).getByText('Audio')).toBeInTheDocument();
    expect(within(audio).getByText('2:05')).toBeInTheDocument();
    const library = row(/Evacuation film/);
    expect(within(library).getByText('12:04')).toBeInTheDocument();
    expect(within(library).getByText('412 MB')).toBeInTheDocument();
    expect(within(library).getByText('From Videos › Safety Training')).toBeInTheDocument();
    expect(within(row(/Morning song/)).getByText('From Songs › Road trip')).toBeInTheDocument();
  });

  it('shows a picture for an image and a library cover, and a glyph for the rest', async () => {
    startServer();
    renderPanel();
    await screen.findByRole('table', { name: 'Attachments' });
    const pictures = [...document.querySelectorAll('img')];
    expect(pictures.map((picture) => picture.getAttribute('src'))).toEqual(['https://cdn.example/thumb-a3?sig=1', 'https://cdn.example/cover-v1?sig=1']);
    expect(pictures.every((picture) => picture.getAttribute('alt') === '')).toBe(true);
  });

  it('shows hostile titles as plain text', async () => {
    startServer(topic([attachment({ id: 'a1', title: '<img src=x onerror=alert(1)>' })]));
    renderPanel();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an empty state with a way forward', async () => {
    startServer(topic([]));
    renderPanel();
    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add from the library' })).toBeInTheDocument();
  });

  it('shows an attachment that is still uploading with a badge and no actions', async () => {
    startServer(topic([attachment({ id: 'a1', title: 'Exit map' }), attachment({ id: 'a9', title: 'Half a map', status: 'uploading', position: 1 })]));
    renderPanel();
    const unfinished = await screen.findByRole('row', { name: /Half a map/ });
    expect(within(unfinished).getByText('Uploading')).toBeInTheDocument();
    expect(within(unfinished).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Exit map down' })).toBeDisabled();
  });

  describe('opening', () => {
    it('opens a video in the pop-up player and asks for exactly one link', async () => {
      const calls = startServer();
      renderPanel({ strict: true });
      await userEvent.click(await screen.findByRole('button', { name: 'Open Evacuation film' }));
      const dialog = await screen.findByRole('dialog', { name: 'Evacuation film' });
      await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/a4?sig=1'));
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a4/open')).toHaveLength(1);
      expect(within(dialog).getByText(/Added by Anita Rao/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Evacuation film' })).toBeNull();
    });

    it('starts uploaded audio in the dock under Course, Lesson and Topic, and asks for the link only when the dock does', async () => {
      const calls = startServer();
      const { player } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Safety briefing' }));
      expect(player.play).toHaveBeenCalledWith({ link: expect.any(Function), title: 'Safety briefing', place: 'Fire safety › Exits › Fire exits', coverUrl: null });
      expect(calls.some((call) => call.key.endsWith('/open'))).toBe(false);
      const track = vi.mocked(player.play).mock.calls[0]![0];
      await expect(track.link()).resolves.toMatchObject({ url: 'https://cdn.example/a2?sig=1' });
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a2/open')).toHaveLength(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('starts library audio in the dock under its category and folder, with the cover', async () => {
      startServer(topic([fixture[4]!, attachment({ id: 'a6', title: 'Calm', kind: 'audio', source: 'library', libraryItemId: 's2', category: 'podcast', libraryFolderName: 'Weekly', thumbnailUrl: 'https://cdn.example/c?sig=1', position: 1 })]));
      const { player } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Morning song' }));
      expect(player.play).toHaveBeenLastCalledWith({ link: expect.any(Function), title: 'Morning song', place: 'Songs › Road trip', coverUrl: null });
      await userEvent.click(screen.getByRole('button', { name: 'Open Calm' }));
      expect(player.play).toHaveBeenLastCalledWith({ link: expect.any(Function), title: 'Calm', place: 'Podcasts › Weekly', coverUrl: 'https://cdn.example/c?sig=1' });
    });

    it('opens the tab for a PDF straight from the click, then sends it to the link when it arrives', async () => {
      let release: (value: MockResponse) => void = () => undefined;
      const pending = new Promise<MockResponse>((resolve) => (release = resolve));
      startServer(topic(fixture), { 'POST /api/attachments/a1/open': () => pending as unknown as MockResponse });
      const tab = { location: { href: 'about:blank' }, close: vi.fn(), opener: {} as unknown };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(tab.opener).toBeNull();
      expect(tab.location.href).toBe('about:blank');
      release({ body: { url: 'https://cdn.example/a1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'application/pdf', kind: 'pdf' } });
      await waitFor(() => expect(tab.location.href).toBe('https://cdn.example/a1?sig=1'));
      expect(tab.close).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(localStorage).toHaveLength(0);
      expect(sessionStorage).toHaveLength(0);
    });

    it('says so, and asks for no link, when the browser blocks the new tab', async () => {
      const calls = startServer();
      vi.spyOn(window, 'open').mockReturnValue(null);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Your browser blocked the new tab. Allow pop-ups for this site, then try again.');
      expect(calls.some((call) => call.key.endsWith('/open'))).toBe(false);
    });

    it('closes the empty tab and explains when the link cannot be had', async () => {
      startServer(topic(fixture), { 'POST /api/attachments/a1/open': { status: 500, body: {} } });
      const tab = { location: { href: 'about:blank' }, close: vi.fn(), opener: {} as unknown };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('about:blank');
    });

    it('opens an image larger in a pop-up, asking for one link, and shows it with its title as the description', async () => {
      const calls = startServer();
      renderPanel({ strict: true });
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      const picture = await within(dialog).findByRole('img', { name: 'Floor plan' });
      expect(picture).toHaveAttribute('src', 'https://cdn.example/a3?sig=1');
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(1);
      expect(localStorage).toHaveLength(0);
      expect(sessionStorage).toHaveLength(0);
    });

    it('asks once for a fresh link when the image stops loading, then says so with Try again', async () => {
      const calls = startServer();
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      fireEvent.error(await within(dialog).findByRole('img', { name: 'Floor plan' }));
      await waitFor(() => expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(2));
      fireEvent.error(await within(dialog).findByRole('img', { name: 'Floor plan' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This image could not be shown. Please try again later.');
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(2);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(3));
    });

    it('explains an open that the server refuses, inside the pop-up', async () => {
      startServer(topic(fixture), { 'POST /api/attachments/a3/open': { status: 409, body: { message: 'This item is not available.' } } });
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This item is not available.');
    });
  });

  describe('renaming and moving', () => {
    it('renames an attachment, starting from its current title', async () => {
      const calls = startServer();
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Rename Exit map' }));
      const dialog = screen.getByRole('dialog', { name: 'Rename attachment' });
      const field = within(dialog).getByLabelText('Attachment title');
      expect(field).toHaveValue('Exit map');
      await userEvent.clear(field);
      await userEvent.type(field, '  Exit route map ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Attachment renamed to "Exit route map".')).toBeInTheDocument();
      expect(calls.find((call) => call.key === 'PATCH /api/attachments/a1')?.body).toEqual({ title: 'Exit route map' });
      expect(await screen.findByRole('row', { name: /Exit route map/ })).toBeInTheDocument();
    });

    it('moves an attachment down and sends the order of the ready attachments only', async () => {
      const calls = startServer(topic([...fixture.slice(0, 2), attachment({ id: 'a9', title: 'Unfinished', status: 'uploading', position: 2 })]));
      renderPanel();
      await screen.findByRole('table', { name: 'Attachments' });
      expect(screen.getByRole('button', { name: 'Move Exit map up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Safety briefing down' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Move Exit map down' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Move Exit map up' })).toBeEnabled());
      expect(calls.find((call) => call.key === 'PUT /api/topics/t1/attachments/order')?.body).toEqual({ ids: ['a2', 'a1'] });
      const rows = within(screen.getByRole('table', { name: 'Attachments' })).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Safety briefing');
      expect(rows[2]).toHaveTextContent('Unfinished');
    });

    it('says so and reloads when the order changed under you', async () => {
      const calls = startServer(topic(fixture), { 'PUT /api/topics/t1/attachments/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Move Exit map down' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
      await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
    });
  });

  describe('adding from the library', () => {
    const openPicker = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add from the library' }));
      return screen.findByRole('dialog', { name: 'Add from the library' });
    };

    it('offers the ready items of the first Videos folder, and not the ones still uploading', async () => {
      startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      expect(await within(dialog).findByLabelText('Category')).toHaveValue('videos');
      await waitFor(() => expect(within(dialog).getByLabelText('Folder')).toHaveValue('f1'));
      expect(await within(dialog).findByText('Fire exits film')).toBeInTheDocument();
      expect(within(dialog).getByText('First aid basics')).toBeInTheDocument();
      expect(within(dialog).queryByText('Still uploading')).toBeNull();
      expect(within(dialog).getAllByRole('option', { name: /Videos|Movies|Podcasts|Songs/ }).map((option) => option.textContent)).toEqual(['Videos', 'Movies', 'Podcasts', 'Songs']);
    });

    it('searches the folder by title, ignoring case, and says when nothing matches', async () => {
      startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      await within(dialog).findByText('Fire exits film');
      await userEvent.type(within(dialog).getByLabelText('Search by title'), 'FIRST');
      expect(within(dialog).queryByText('Fire exits film')).toBeNull();
      expect(within(dialog).getByText('First aid basics')).toBeInTheDocument();
      await userEvent.clear(within(dialog).getByLabelText('Search by title'));
      await userEvent.type(within(dialog).getByLabelText('Search by title'), 'zzz');
      expect(within(dialog).getByText('No ready items match.')).toBeInTheDocument();
    });

    it('changes folder and category, loading each list', async () => {
      const calls = startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      await within(dialog).findByText('Fire exits film');
      await userEvent.selectOptions(within(dialog).getByLabelText('Folder'), 'f2');
      expect(await within(dialog).findByText('Nothing ready in this folder yet.')).toBeInTheDocument();
      await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('Calm song')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Folder')).toHaveValue('sf1');
      expect(calls.some((call) => call.key === 'GET /api/media/songs/folders')).toBe(true);
    });

    it('says so when a category has no folders', async () => {
      startServer(topic([]), { 'GET /api/media/songs/folders': { body: [] } });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.selectOptions(await within(dialog).findByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('No folders in Songs yet.')).toBeInTheDocument();
    });

    it('attaches the chosen item, closes, says so and reloads the topic', async () => {
      const calls = startServer(topic([]));
      const { onChanged } = renderPanel();
      const dialog = await openPicker();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Attach Fire exits film' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add from the library' })).toBeNull());
      expect(calls.find((call) => call.key === 'POST /api/topics/t1/attachments/library')?.body).toEqual({ itemId: 'v1' });
      expect(await screen.findByText('Added "Fire exits film" to the topic.')).toBeInTheDocument();
      expect(await screen.findByRole('row', { name: /Fire exits film/ })).toBeInTheDocument();
      expect(onChanged).toHaveBeenCalled();
    });

    it('keeps the dialog open and explains when the attachment is refused', async () => {
      startServer(topic([]), { 'POST /api/topics/t1/attachments/library': { status: 409, body: { message: 'That item is still uploading.' } } });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Attach Fire exits film' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('That item is still uploading.');
      expect(screen.getByRole('dialog', { name: 'Add from the library' })).toBeInTheDocument();
    });

    it('offers Retry when the folders cannot be loaded', async () => {
      let fail = true;
      startServer(topic([]), { 'GET /api/media/videos/folders': () => (fail ? { status: 500, body: {} } : { body: folders }) });
      renderPanel();
      const dialog = await openPicker();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong');
      fail = false;
      await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
      expect(await within(dialog).findByText('Fire exits film')).toBeInTheDocument();
    });

    it('ignores the answer for a category the person has already left', async () => {
      let releaseVideos: (value: MockResponse) => void = () => undefined;
      const slow = new Promise<MockResponse>((resolve) => (releaseVideos = resolve));
      startServer(topic([]), { 'GET /api/media/videos/folders': () => slow as unknown as MockResponse });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.selectOptions(await within(dialog).findByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('Calm song')).toBeInTheDocument();
      await act(async () => releaseVideos({ body: folders }));
      expect(within(dialog).getByLabelText('Category')).toHaveValue('songs');
      expect(within(dialog).getByLabelText('Folder')).toHaveValue('sf1');
      expect(within(dialog).queryByText('Fire exits film')).toBeNull();
    });
  });
});
```

Run: `npm test -w @jbf/web -- TopicPanel courses DockedPlayer FolderPage CoursePage`
Expected: FAIL (the attachment calls, components and the new track shape do not exist).

- [ ] **Step 2: The calls and the new shapes of the player**

In `apps/web/src/api/courses.ts`:

In `apps/web/src/api/courses.ts` replace:

```ts
import { api } from './client';
import { uploadCoverTo } from './media';
```

with:

```ts
import { api } from './client';
import { type MediaCategory, uploadCoverTo } from './media';
```

In `apps/web/src/api/courses.ts`, after:

```ts
export interface TopicView {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
}
```

add:

```ts

export type AttachmentKind = 'video' | 'audio' | 'pdf' | 'image';

export interface Attachment {
  id: string;
  topicId: string;
  position: number;
  kind: AttachmentKind;
  title: string;
  // Uploaded into the topic, or picked from the library (and then following the library item).
  source: 'upload' | 'library';
  status: 'uploading' | 'ready';
  sizeBytes: number;
  durationSeconds: number | null;
  // A one-hour link to a small picture: a library item's cover, or the uploaded image itself.
  thumbnailUrl: string | null;
  libraryItemId: string | null;
  category: MediaCategory | null;
  libraryFolderName: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// A topic with the attachments the person may see: every ready one, and their own that are still uploading.
export interface TopicDetail extends TopicView {
  attachments: Attachment[];
}

export interface OpenLink {
  url: string;
  expiresAt: string;
  contentType: string;
  kind: AttachmentKind;
}
```

In `apps/web/src/api/courses.ts` replace:

```ts
export const getTopic = (id: string): Promise<TopicView> => api<TopicView>(`/api/topics/${id}`);
```

with:

```ts
export const getTopic = (id: string): Promise<TopicDetail> => api<TopicDetail>(`/api/topics/${id}`);
```

Append to `apps/web/src/api/courses.ts`:

```ts

export const addLibraryAttachment = (topicId: string, itemId: string): Promise<Attachment> =>
  api<Attachment>(`/api/topics/${topicId}/attachments/library`, { method: 'POST', body: { itemId } });

export const renameAttachment = (id: string, title: string): Promise<Attachment> =>
  api<Attachment>(`/api/attachments/${id}`, { method: 'PATCH', body: { title } });

export const reorderAttachments = (topicId: string, ids: string[]): Promise<Attachment[]> =>
  api<Attachment[]>(`/api/topics/${topicId}/attachments/order`, { method: 'PUT', body: { ids } });

// A one-hour link to view or play the attachment; every link is recorded in the audit log.
export const openAttachment = (id: string): Promise<OpenLink> => api<OpenLink>(`/api/attachments/${id}/open`, { method: 'POST' });
```

In `apps/web/src/player/PlayerContext.tsx` a track carries how to get its link and the text under its title:

In `apps/web/src/player/PlayerContext.tsx` replace:

```tsx
export interface DockTrack {
  itemId: string;
  title: string;
  categoryLabel: string;
  folderName: string;
  coverUrl: string | null;
}
```

with:

```tsx
export interface DockTrack {
  // Asks for a one-hour link to the audio (every link is recorded in the audit log); the bar calls it once per start,
  // and once more if the audio stops loading.
  link: () => Promise<{ url: string }>;
  title: string;
  // Plain text under the title: "Songs › Road trip" for a library item, "Course › Lesson › Topic" for an uploaded attachment.
  place: string;
  coverUrl: string | null;
}
```

In `apps/web/src/player/DockedPlayer.tsx`:

In `apps/web/src/player/DockedPlayer.tsx` replace:

```tsx
import { describeError } from '../api/client';
import { playItem } from '../api/media';
import { Button } from '../components/Button';
```

with:

```tsx
import { describeError } from '../api/client';
import { Button } from '../components/Button';
```

In `apps/web/src/player/DockedPlayer.tsx` replace:

```tsx
      setSrc((await playItem(track.itemId)).url);
```

with:

```tsx
      setSrc((await track.link()).url);
```

In `apps/web/src/player/DockedPlayer.tsx` replace:

```tsx
  }, [track.itemId]);
```

with:

```tsx
  }, [track]);
```

In `apps/web/src/player/DockedPlayer.tsx` replace:

```tsx
          <p className={styles.place}>{`${track.categoryLabel} › ${track.folderName}`}</p>
```

with:

```tsx
          <p className={styles.place}>{track.place}</p>
```

Replace the whole of `apps/web/src/pages/media/PlayerDialog.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import { formatDate } from '../../lib/format';
import styles from './Media.module.css';

const PLAYBACK_FAILED = 'This video could not be played. Please try again later.';

// A video to play in the pop-up: a library item, or a video attached to a topic.
export interface VideoTarget {
  id: string;
  title: string;
  description: string | null;
  addedBy: string;
  addedAt: string;
  // Asks for a one-hour link (every link is recorded in the audit log).
  link: () => Promise<{ url: string }>;
}

export function PlayerDialog({ video, onClose }: { video: VideoTarget | null; onClose: () => void }) {
  return (
    <Dialog open={video !== null} onClose={onClose} title={video?.title ?? 'Video'}>
      {video ? <Player video={video} /> : null}
    </Dialog>
  );
}

function Player({ video }: { video: VideoTarget }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every link that is handed out is recorded in the audit log, so the development double-run of effects
  // (StrictMode) must not ask twice for the same opening.
  const requestedFor = useRef<string | null>(null);
  const retried = useRef(false);
  const resumeAt = useRef(0);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await video.link()).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [video]);

  useEffect(() => {
    if (requestedFor.current === video.id) return;
    requestedFor.current = video.id;
    void fetchLink();
  }, [video.id, fetchLink]);

  // The link lasts one hour. If the browser fails to read the video (for example the link expired during a long
  // pause) ask once for a new link and carry on from the same position.
  function onVideoError() {
    if (retried.current) {
      setError(PLAYBACK_FAILED);
      return;
    }
    retried.current = true;
    resumeAt.current = videoRef.current?.currentTime ?? 0;
    void fetchLink();
  }

  function onLoadedMetadata() {
    const element = videoRef.current;
    if (!element || resumeAt.current <= 0) return;
    element.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void element.play().catch(() => undefined);
  }

  return (
    <>
      {error ? (
        <>
          <Alert tone="error">{error}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              retried.current = false;
              setError(null);
              void fetchLink();
            }}
          >
            Try again
          </Button>
        </>
      ) : src === null ? (
        <Skeleton rows={2} />
      ) : (
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          controls
          autoPlay
          preload="metadata"
          onError={onVideoError}
          onLoadedMetadata={onLoadedMetadata}
          onPlaying={() => {
            retried.current = false;
          }}
        />
      )}
      {video.description ? <p className={styles.description}>{video.description}</p> : null}
      <p className={styles.muted}>
        Added by {video.addedBy} · {formatDate(video.addedAt)}
      </p>
    </>
  );
}
```

In `apps/web/src/pages/media/FolderPage.tsx` the library page builds the same kind of targets:

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
import { type Folder, listFolders, listItems, type MediaItem, reorderItems } from '../../api/media';
```

with:

```tsx
import { type Folder, listFolders, listItems, type MediaItem, playItem, reorderItems } from '../../api/media';
```

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
import { PlayerDialog } from './PlayerDialog';
```

with:

```tsx
import { PlayerDialog, type VideoTarget } from './PlayerDialog';
```

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
  const [playing, setPlaying] = useState<MediaItem | null>(null);
```

with:

```tsx
  const [playing, setPlaying] = useState<VideoTarget | null>(null);
```

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
  function onPlay(item: MediaItem) {
    if (category.kind === 'video') {
      setPlaying(item);
      return;
    }
    player.play({ itemId: item.id, title: item.title, categoryLabel: category.label, folderName: folder?.name ?? '', coverUrl: item.coverUrl });
  }
```

with:

```tsx
  function onPlay(item: MediaItem) {
    const link = () => playItem(item.id);
    if (category.kind === 'video') {
      setPlaying({ id: item.id, title: item.title, description: item.description, addedBy: item.createdBy.name, addedAt: item.createdAt, link });
      return;
    }
    player.play({ link, title: item.title, place: `${category.label} › ${folder?.name ?? ''}`, coverUrl: item.coverUrl });
  }
```

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
      <PlayerDialog item={playing} onClose={() => setPlaying(null)} />
```

with:

```tsx
      <PlayerDialog video={playing} onClose={() => setPlaying(null)} />
```

- [ ] **Step 3: The list, the picture pop-up and the library picker**

Add the styles the new components use:

In `apps/web/src/pages/courses/Courses.module.css` replace:

```css
@media (max-width: 760px) {
```

with:

```css
.largeImage {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  object-fit: contain;
}

.sectionHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-6) 0 var(--space-3);
}

.sectionHeader h3 {
  margin: 0;
}

.pickerFilters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.pickerList {
  display: grid;
  gap: var(--space-2);
  max-height: 40vh;
  margin: var(--space-3) 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.pickerItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

@media (max-width: 760px) {
```

Create `apps/web/src/pages/courses/AttachmentList.tsx`:

```tsx
import type { Attachment, AttachmentKind } from '../../api/courses';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDuration } from '../../lib/format';
import { CATEGORIES } from '../../media/categories';
import media from '../media/Media.module.css';

interface AttachmentListProps {
  attachments: Attachment[];
  busy: boolean;
  onOpen: (attachment: Attachment) => void;
  onRename: (attachment: Attachment) => void;
  onMove: (attachment: Attachment, delta: -1 | 1) => void;
}

const KIND_WORDS: Record<AttachmentKind, string> = { video: 'Video', audio: 'Audio', pdf: 'PDF', image: 'Image' };
const KIND_GLYPHS: Record<AttachmentKind, string> = { video: '▶', audio: '♪', pdf: '≣', image: '▣' };

// Where a library attachment comes from, in the words of the library: "Songs › Road trip".
function sourceText(attachment: Attachment): string | null {
  if (attachment.source !== 'library') return null;
  const category = CATEGORIES.find((candidate) => candidate.noun === attachment.category);
  return `From ${category?.label ?? 'the library'} › ${attachment.libraryFolderName ?? ''}`;
}

export function AttachmentList({ attachments, busy, onOpen, onRename, onMove }: AttachmentListProps) {
  // Only ready attachments can be ordered; one that is still uploading keeps its place until it finishes.
  const ready = attachments.filter((attachment) => attachment.status === 'ready');

  return (
    <Table caption="Attachments">
      <thead>
        <tr>
          <th scope="col">Attachment</th>
          <th scope="col">Type</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {attachments.map((attachment) => {
          const isReady = attachment.status === 'ready';
          const readyIndex = ready.indexOf(attachment);
          const source = sourceText(attachment);
          return (
            <tr key={attachment.id}>
              <td data-label="Attachment">
                <div className={media.itemCell}>
                  {attachment.thumbnailUrl ? (
                    <img className={media.cover} src={attachment.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={media.coverPlaceholder} aria-hidden="true">
                      {isReady ? KIND_GLYPHS[attachment.kind] : '⏳'}
                    </span>
                  )}
                  <div>
                    <span className={media.name}>{attachment.title}</span>
                    {source ? <span className={media.muted}>{source}</span> : null}
                    {isReady ? null : <Badge tone="change">Uploading</Badge>}
                  </div>
                </div>
              </td>
              <td data-label="Type">{KIND_WORDS[attachment.kind]}</td>
              <td data-label="Length">{isReady && (attachment.kind === 'video' || attachment.kind === 'audio') ? formatDuration(attachment.durationSeconds) : '—'}</td>
              <td data-label="Size">{formatBytes(attachment.sizeBytes)}</td>
              <td data-label="Actions">
                {isReady ? (
                  <div className={media.actions}>
                    <Button size="small" aria-label={`Open ${attachment.title}`} onClick={() => onOpen(attachment)}>
                      Open
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${attachment.title}`} onClick={() => onRename(attachment)}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || readyIndex === 0} aria-label={`Move ${attachment.title} up`} onClick={() => onMove(attachment, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || readyIndex === ready.length - 1}
                      aria-label={`Move ${attachment.title} down`}
                      onClick={() => onMove(attachment, 1)}
                    >
                      ↓ Move down
                    </Button>
                  </div>
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

Create `apps/web/src/pages/courses/ImageDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { type Attachment, openAttachment } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import styles from './Courses.module.css';

const IMAGE_FAILED = 'This image could not be shown. Please try again later.';

export function ImageDialog({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  return (
    <Dialog open={attachment !== null} onClose={onClose} title={attachment?.title ?? 'Image'}>
      {attachment ? <Picture attachment={attachment} /> : null}
    </Dialog>
  );
}

function Picture({ attachment }: { attachment: Attachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every link that is handed out is recorded in the audit log, so the development double-run of effects
  // (StrictMode) must not ask twice for the same opening.
  const requestedFor = useRef<string | null>(null);
  const retried = useRef(false);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await openAttachment(attachment.id)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [attachment.id]);

  useEffect(() => {
    if (requestedFor.current === attachment.id) return;
    requestedFor.current = attachment.id;
    void fetchLink();
  }, [attachment.id, fetchLink]);

  // The link lasts one hour. If the picture stops loading, ask once for a new link; a second failure is shown.
  function onImageError() {
    if (retried.current) {
      setSrc(null);
      setError(IMAGE_FAILED);
      return;
    }
    retried.current = true;
    void fetchLink();
  }

  if (error) {
    return (
      <>
        <Alert tone="error">{error}</Alert>
        <Button
          variant="secondary"
          onClick={() => {
            retried.current = false;
            setError(null);
            void fetchLink();
          }}
        >
          Try again
        </Button>
      </>
    );
  }
  if (src === null) return <Skeleton rows={2} />;
  return (
    <img
      className={styles.largeImage}
      src={src}
      alt={attachment.title}
      onError={onImageError}
      onLoad={() => {
        retried.current = false;
      }}
    />
  );
}
```

Create `apps/web/src/pages/courses/LibraryPickerDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { describeError } from '../../api/client';
import { type Attachment, addLibraryAttachment } from '../../api/courses';
import { type CategorySlug, type Folder, listFolders, listItems, type MediaItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { formatDuration } from '../../lib/format';
import { CATEGORIES } from '../../media/categories';
import media from '../media/Media.module.css';
import styles from './Courses.module.css';

interface LibraryPickerDialogProps {
  open: boolean;
  topicId: string;
  onClose: () => void;
  onAttached: (attachment: Attachment) => void;
}

export function LibraryPickerDialog({ open, topicId, onClose, onAttached }: LibraryPickerDialogProps) {
  const [attaching, setAttaching] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Add from the library" blocked={attaching}>
      <Picker topicId={topicId} attaching={attaching} setAttaching={setAttaching} onClose={onClose} onAttached={onAttached} />
    </Dialog>
  );
}

function Picker({
  topicId,
  attaching,
  setAttaching,
  onClose,
  onAttached,
}: Omit<LibraryPickerDialogProps, 'open'> & { attaching: boolean; setAttaching: (attaching: boolean) => void }) {
  const [slug, setSlug] = useState<CategorySlug>('videos');
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState('');
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Goes up when Retry is pressed, so the folders are asked for again.
  const [attempt, setAttempt] = useState(0);

  // Each answer is used only while the person is still looking at the category or folder it was asked for.
  useEffect(() => {
    let current = true;
    setFolders(null);
    setFolderId('');
    setItems(null);
    setLoadError(null);
    listFolders(slug).then(
      (list) => {
        if (!current) return;
        setFolders(list);
        setFolderId(list[0]?.id ?? '');
      },
      (error: unknown) => {
        if (current) setLoadError(describeError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [slug, attempt]);

  useEffect(() => {
    if (!folderId) return;
    let current = true;
    setItems(null);
    listItems(folderId).then(
      (list) => {
        if (current) setItems(list);
      },
      (error: unknown) => {
        if (current) setLoadError(describeError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [folderId]);

  async function attach(item: MediaItem) {
    setAttaching(true);
    setAttachError(null);
    try {
      onAttached(await addLibraryAttachment(topicId, item.id));
      onClose();
    } catch (error) {
      setAttachError(describeError(error));
    } finally {
      setAttaching(false);
    }
  }

  const category = CATEGORIES.find((candidate) => candidate.slug === slug)!;
  const wanted = search.trim().toLowerCase();
  const shown = (items ?? []).filter((item) => item.status === 'ready' && item.title.toLowerCase().includes(wanted));

  return (
    <>
      <div className={styles.pickerFilters}>
        <Select label="Category" value={slug} onChange={(event) => setSlug(event.target.value as CategorySlug)}>
          {CATEGORIES.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.label}
            </option>
          ))}
        </Select>
        <Select label="Folder" value={folderId} disabled={!folders || folders.length === 0} onChange={(event) => setFolderId(event.target.value)}>
          {(folders ?? []).map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
      </div>
      <TextField label="Search by title" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
      {attachError ? <Alert tone="error">{attachError}</Alert> : null}
      {loadError ? (
        <>
          <Alert tone="error">{loadError}</Alert>
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
            Retry
          </Button>
        </>
      ) : folders === null ? (
        <Skeleton rows={3} />
      ) : folders.length === 0 ? (
        <EmptyState title={`No folders in ${category.label} yet.`} />
      ) : items === null ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <EmptyState title={wanted ? 'No ready items match.' : 'Nothing ready in this folder yet.'} />
      ) : (
        <ul className={styles.pickerList}>
          {shown.map((item) => (
            <li key={item.id} className={styles.pickerItem}>
              <div>
                <span className={media.name}>{item.title}</span>
                <span className={media.muted}>{formatDuration(item.durationSeconds)}</span>
              </div>
              <Button size="small" disabled={attaching} aria-label={`Attach ${item.title}`} onClick={() => void attach(item)}>
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 4: The topic panel and the page**

Replace the whole of `apps/web/src/pages/courses/TopicPanel.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { type Attachment, getTopic, openAttachment, renameAttachment, reorderAttachments, type TopicDetail } from '../../api/courses';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { CATEGORIES } from '../../media/categories';
import { usePlayer } from '../../player/PlayerContext';
import { PlayerDialog, type VideoTarget } from '../media/PlayerDialog';
import { AttachmentList } from './AttachmentList';
import styles from './Courses.module.css';
import { EditTopicDialog } from './EditTopicDialog';
import { ImageDialog } from './ImageDialog';
import { LibraryPickerDialog } from './LibraryPickerDialog';
import { TitleDialog } from './TitleDialog';

type Notice = { tone: 'error' | 'success'; text: string };

interface TopicPanelProps {
  topicId: string;
  // For the line under a track in the docked player: "Course › Lesson › Topic".
  courseTitle: string;
  lessonTitle: string;
  // Goes up whenever the page changed something that may be in this topic (for example its title), so it reloads.
  reloadKey: number;
  // Something in the topic changed that the tree shows (its title, how many files it has): the page reloads the tree.
  onChanged: () => void;
}

// The chosen topic: its title, text and attachments. The page keys this component by topic, so choosing another one starts afresh.
export function TopicPanel({ topicId, courseTitle, lessonTitle, reloadKey, onChanged }: TopicPanelProps) {
  const player = usePlayer();
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<Attachment | null>(null);
  const [video, setVideo] = useState<VideoTarget | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);

  const load = useCallback(async () => {
    try {
      setTopic(await getTopic(topicId));
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (missing) return <EmptyState title="Topic not found">It may have been moved. Choose another topic in the list.</EmptyState>;
  if (loadError) {
    return (
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
    );
  }
  if (!topic) return <Skeleton rows={3} />;

  // The line under a track in the docked player.
  function placeOf(attachment: Attachment): string {
    if (attachment.source === 'library') {
      const category = CATEGORIES.find((candidate) => candidate.noun === attachment.category);
      return `${category?.label ?? 'Library'} › ${attachment.libraryFolderName ?? ''}`;
    }
    return `${courseTitle} › ${lessonTitle} › ${topic?.title ?? ''}`;
  }

  // The tab is opened straight from the click, while the browser still allows it, and sent to the link when it arrives.
  async function openPdf(attachment: Attachment) {
    const tab = window.open('', '_blank');
    if (!tab) {
      setNotice({ tone: 'error', text: 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.' });
      return;
    }
    // The page that opens is on another site: it must not be able to reach this one.
    tab.opener = null;
    try {
      tab.location.href = (await openAttachment(attachment.id)).url;
    } catch (error) {
      tab.close();
      setNotice({ tone: 'error', text: describeError(error) });
    }
  }

  function open(attachment: Attachment) {
    setNotice(null);
    const link = () => openAttachment(attachment.id);
    switch (attachment.kind) {
      case 'video':
        setVideo({ id: attachment.id, title: attachment.title, description: null, addedBy: attachment.createdBy.name, addedAt: attachment.createdAt, link });
        break;
      case 'audio':
        player.play({ link, title: attachment.title, place: placeOf(attachment), coverUrl: attachment.thumbnailUrl });
        break;
      case 'pdf':
        void openPdf(attachment);
        break;
      case 'image':
        setImage(attachment);
        break;
    }
  }

  async function move(attachment: Attachment, delta: -1 | 1) {
    if (!topic) return;
    const ids = topic.attachments.filter((candidate) => candidate.status === 'ready').map((candidate) => candidate.id);
    const index = ids.indexOf(attachment.id);
    [ids[index], ids[index + delta]] = [ids[index + delta] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setTopic({ ...topic, attachments: await reorderAttachments(topic.id, ids) });
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.topicHeader}>
        <h2 className={styles.topicTitle}>{topic.title}</h2>
        <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
          Edit topic
        </Button>
      </div>
      {topic.description ? <p className={styles.text}>{topic.description}</p> : null}

      <div className={styles.sectionHeader}>
        <h3>Attachments</h3>
        <Button size="small" onClick={() => setPicking(true)}>
          Add from the library
        </Button>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {topic.attachments.length === 0 ? (
        <EmptyState title="No attachments yet">Add a file from the library to show it in this topic.</EmptyState>
      ) : (
        <AttachmentList attachments={topic.attachments} busy={busy} onOpen={open} onRename={setRenaming} onMove={(attachment, delta) => void move(attachment, delta)} />
      )}

      <EditTopicDialog
        topic={editing ? topic : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />
      <LibraryPickerDialog
        open={picking}
        topicId={topic.id}
        onClose={() => setPicking(false)}
        onAttached={(attachment) => {
          setNotice({ tone: 'success', text: `Added "${attachment.title}" to the topic.` });
          void load();
          onChanged();
        }}
      />
      <TitleDialog
        open={renaming !== null}
        heading="Rename attachment"
        label="Attachment title"
        initial={renaming?.title ?? ''}
        submitLabel="Save"
        emptyMessage="Enter a title."
        onSubmit={async (title) => {
          await renameAttachment((renaming as Attachment).id, title);
          setNotice({ tone: 'success', text: `Attachment renamed to "${title}".` });
          await load();
        }}
        onClose={() => setRenaming(null)}
      />
      <PlayerDialog video={video} onClose={() => setVideo(null)} />
      <ImageDialog attachment={image} onClose={() => setImage(null)} />
    </>
  );
}
```

In `apps/web/src/pages/courses/CoursePage.tsx` pass the titles of the course and lesson to the panel:

In `apps/web/src/pages/courses/CoursePage.tsx` replace:

```tsx
  const inCourse = tree.lessons.some((lesson) => lesson.topics.some((topic) => topic.id === topicId));
```

with:

```tsx
  const lessonOfTopic = tree.lessons.find((lesson) => lesson.topics.some((topic) => topic.id === topicId));
```

In `apps/web/src/pages/courses/CoursePage.tsx` replace:

```tsx
              {inCourse ? (
                <TopicPanel key={topicId} topicId={topicId} reloadKey={reloadKey} onChanged={() => void load()} />
              ) : (
```

with:

```tsx
              {lessonOfTopic ? (
                <TopicPanel key={topicId} topicId={topicId} courseTitle={tree.title} lessonTitle={lessonOfTopic.title} reloadKey={reloadKey} onChanged={() => void load()} />
              ) : (
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (484 web tests), including every milestone 4 player and folder-page test with the adapted fixtures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: show attachments in a topic, add them from the library and open them four ways"
```


### Task 12: Uploading a file into a topic: the four types, the upload manager, progress and the resume list

**Files:**
- Create: `apps/web/src/pages/courses/AddAttachmentDialog.tsx`, `apps/web/src/pages/courses/AttachmentUploadDialog.tsx` (+ `AttachmentUploadDialog.spec.tsx`)
- Modify: `apps/web/src/uploads/limits.ts` (+ `limits.spec.ts`), `apps/web/src/uploads/UploadsContext.tsx` (+ spec), `apps/web/src/api/media.ts` (+ `media.spec.ts`), `apps/web/src/pages/media/PendingUploads.tsx` (+ spec), `apps/web/src/pages/media/FolderPage.tsx`, `apps/web/src/pages/courses/TopicPanel.tsx` (+ `TopicPanel.spec.tsx`), `apps/web/src/pages/courses/AttachmentList.tsx`, `apps/web/src/pages/courses/CoursePage.spec.tsx`

**Existing tests to adapt:** only what the shapes force, never an assertion.
- `apps/web/src/pages/media/PendingUploads.spec.tsx`: the component is told which uploads are its own (`belongs`), which file types to accept and the words to use, instead of a category and a folder; its fixtures gain `topicId: null` (and the running job `topicId: null`).
- `apps/web/src/uploads/UploadsContext.spec.tsx`, `apps/web/src/uploads/UploadPanel.spec.tsx`, `apps/web/src/pages/media/FolderPage.spec.tsx`: `PendingUpload` and `UploadJob` fixtures gain `topicId: null`.
- `apps/web/src/pages/courses/TopicPanel.spec.tsx` (Task 11): the panel now reads the upload manager, so the spec provides one; **Add** replaces the **Add from the library** button, so the library picker is opened through **Add** and **From the library**.
- `apps/web/src/pages/courses/CoursePage.spec.tsx`: the page now needs the upload manager as well (the app shell provides it).

**Interfaces:**
- Consumes: `UploadsProvider`, `useUploads`, `UploadsValue` (`uploads/UploadsContext.tsx`), `readDuration`, `describeUploadError`, `PendingUploads`, `TopicPanel`, `AttachmentList` (Tasks 9–11), `MEDIA_KINDS`, `checkMediaFile`, `MAX_COVER_BYTES` (`uploads/limits.ts`).
- Produces:

```ts
// uploads/limits.ts (the web copy of the server's kinds table, apps/api/src/media/media-kinds.ts)
type AttachmentKind = 'video' | 'audio' | 'pdf' | 'image'
MAX_PDF_BYTES = 52_428_800; ATTACHMENT_HELP: string; ATTACHMENT_KINDS: Record<AttachmentKind, KindRule>; ATTACHMENT_ACCEPT: string
checkAttachmentFile(file): { ok: true; kind: AttachmentKind; contentType } | { ok: false; problem }
// api/media.ts
PendingUpload { ...; folderId: string | null; topicId: string | null }; startAttachmentUpload(topicId, input): Promise<StartedUpload>
// uploads/UploadsContext.tsx
UploadJob { ...; folderId: string | null; topicId: string | null }
StartInput = LibraryStart | AttachmentStart   // AttachmentStart: { file, topicId, contentType, title, durationSeconds }
// pages/media/PendingUploads.tsx   props: belongs(entry), accept, noun, nounTitle, reloadKey, onChanged
// pages/courses/AddAttachmentDialog.tsx        AddAttachmentDialog({ open, onClose, onUpload, onLibrary })
// pages/courses/AttachmentUploadDialog.tsx     AttachmentUploadDialog({ open, topicId, onClose, onStarted })
// pages/courses/AttachmentList.tsx             gains progress: Record<attachmentId, percent>
```

- [ ] **Step 1: Failing tests**

Add to `apps/web/src/uploads/limits.spec.ts` (imports first):

In `apps/web/src/uploads/limits.spec.ts` replace:

```ts
import { AUDIO_HELP, checkCoverFile, checkMediaFile, MAX_AUDIO_BYTES, MAX_COVER_BYTES, MAX_VIDEO_BYTES, MEDIA_KINDS, MP4_HELP } from './limits';
```

with:

```ts
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HELP,
  ATTACHMENT_KINDS,
  AUDIO_HELP,
  checkAttachmentFile,
  checkCoverFile,
  checkMediaFile,
  MAX_AUDIO_BYTES,
  MAX_COVER_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_KINDS,
  MP4_HELP,
} from './limits';
```

Append to `apps/web/src/uploads/limits.spec.ts`:

```ts
describe('checkAttachmentFile', () => {
  it('has the same sizes as the server for the four kinds', () => {
    expect(ATTACHMENT_KINDS.video.maxBytes).toBe(2_147_483_648);
    expect(ATTACHMENT_KINDS.audio.maxBytes).toBe(524_288_000);
    expect(ATTACHMENT_KINDS.pdf.maxBytes).toBe(52_428_800);
    expect(ATTACHMENT_KINDS.image.maxBytes).toBe(10_485_760);
    expect(MAX_PDF_BYTES).toBe(52_428_800);
    expect(ATTACHMENT_KINDS.video).toBe(MEDIA_KINDS.video);
    expect(ATTACHMENT_KINDS.audio).toBe(MEDIA_KINDS.audio);
  });

  it('offers every allowed type in the picker', () => {
    expect(ATTACHMENT_ACCEPT).toBe('video/mp4,.mp4,audio/mpeg,audio/mp4,.mp3,.m4a,application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp');
  });

  it.each([
    ['an MP4', 'a.mp4', 'video/mp4', 'video', 'video/mp4'],
    ['an MP4 the system did not type', 'a.MP4', '', 'video', 'video/mp4'],
    ['an MP3', 'a.mp3', 'audio/mpeg', 'audio', 'audio/mpeg'],
    ['an M4A reported as audio/x-m4a', 'a.m4a', 'audio/x-m4a', 'audio', 'audio/mp4'],
    ['a PDF', 'a.pdf', 'application/pdf', 'pdf', 'application/pdf'],
    ['a PDF the system did not type', 'Exit map.PDF', '', 'pdf', 'application/pdf'],
    ['a JPEG', 'a.jpg', 'image/jpeg', 'image', 'image/jpeg'],
    ['a PNG', 'a.png', 'image/png', 'image', 'image/png'],
    ['a WebP', 'a.webp', 'image/webp', 'image', 'image/webp'],
    ['a JPEG the system did not type', 'photo.jpeg', '', 'image', 'image/jpeg'],
    ['a PNG the system did not type', 'photo.PNG', '', 'image', 'image/png'],
  ])('accepts %s and declares it as the server expects', (_name, name, type, kind, declared) => {
    expect(checkAttachmentFile(file(name, type, 10))).toEqual({ ok: true, kind, contentType: declared });
  });

  it.each([
    ['an MP4', 'video/mp4', MAX_VIDEO_BYTES, 'a.mp4'],
    ['an MP3', 'audio/mpeg', MAX_AUDIO_BYTES, 'a.mp3'],
    ['a PDF', 'application/pdf', MAX_PDF_BYTES, 'a.pdf'],
    ['a PNG', 'image/png', MAX_COVER_BYTES, 'a.png'],
  ])('accepts %s of exactly its largest size and refuses one byte more', (_name, type, max, name) => {
    expect(checkAttachmentFile(file(name, type, max)).ok).toBe(true);
    expect(checkAttachmentFile(file(name, type, max + 1)).ok).toBe(false);
  });

  it('says what is too large in the words of its kind', () => {
    expect(checkAttachmentFile(file('a.pdf', 'application/pdf', MAX_PDF_BYTES + 1))).toEqual({ ok: false, problem: 'PDF files can be at most 50 MB. Choose a smaller file.' });
    expect(checkAttachmentFile(file('a.png', 'image/png', MAX_COVER_BYTES + 1))).toEqual({ ok: false, problem: 'Images can be at most 10 MB. Choose a smaller file.' });
    expect(checkAttachmentFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toMatchObject({ ok: false, problem: expect.stringMatching(/at most 2 GB/) });
    expect(checkAttachmentFile(file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES + 1))).toMatchObject({ ok: false, problem: expect.stringMatching(/at most 500 MB/) });
  });

  it('refuses an empty file of any kind', () => {
    for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.png', 'image/png'], ['a.mp4', 'video/mp4'], ['a.mp3', 'audio/mpeg']]) {
      expect(checkAttachmentFile(file(name!, type!, 0))).toEqual({ ok: false, problem: 'That file is empty.' });
    }
  });

  it('names every allowed format for anything else', () => {
    expect(ATTACHMENT_HELP).toBe('Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.');
    for (const bad of [
      file('a.gif', 'image/gif', 10),
      file('a.svg', 'image/svg+xml', 10),
      file('a.zip', 'application/zip', 10),
      file('a.mov', 'video/quicktime', 10),
      file('raw.aac', 'audio/aac', 10),
      file('a.pdf.exe', '', 10),
      file('noextension', '', 10),
      file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10),
      file('a.pdf', 'application/x-pdf', 10),
    ]) {
      expect(checkAttachmentFile(bad)).toEqual({ ok: false, problem: ATTACHMENT_HELP });
    }
  });
});
```

Adapt and extend `apps/web/src/api/media.spec.ts`:

In `apps/web/src/api/media.spec.ts` replace:

```ts
  reorderItems,
  startUpload,
  updateItem,
```

with:

```ts
  reorderItems,
  startAttachmentUpload,
  startUpload,
  updateItem,
```

In `apps/web/src/api/media.spec.ts` replace:

```ts
  it('talks to the upload endpoints', async () => {
```

with:

```ts
  it('starts an upload into a topic', async () => {
    const calls = record();
    await startAttachmentUpload('t1', { title: 'Exit map', fileName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 5, durationSeconds: null });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/topics/t1/attachments/uploads']);
    expect(calls[0]?.body).toEqual({ title: 'Exit map', fileName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 5, durationSeconds: null });
  });

  it('talks to the upload endpoints', async () => {
```

In `apps/web/src/uploads/UploadsContext.spec.tsx` add tests (and adapt the fixtures):

In `apps/web/src/uploads/UploadsContext.spec.tsx` replace:

```tsx
    const pending: PendingUpload = { fileId: 'u1', itemId: 'v1', folderId: 'f1', title: 'Fire exits', fileName: 'clip.mp4', sizeBytes: 10, createdAt: '2026-10-08T10:00:00Z' };
```

with:

```tsx
    const pending: PendingUpload = { fileId: 'u1', itemId: 'v1', folderId: 'f1', topicId: null, title: 'Fire exits', fileName: 'clip.mp4', sizeBytes: 10, createdAt: '2026-10-08T10:00:00Z' };
```

In `apps/web/src/uploads/UploadsContext.spec.tsx` replace:

```tsx
  it('starts an upload, sends every piece with a fresh link, completes with the receipts and reports it finished', async () => {
```

with:

```tsx
  it('starts an upload into a topic: the same pieces and completion, a different start, and no folder', async () => {
    const calls = startServer({ 'POST /api/topics/t1/attachments/uploads': { status: 201, body: started } });
    setup();
    await act(() => value.start({ file, topicId: 't1', contentType: 'video/mp4', title: 'Fire film', durationSeconds: 12 }));
    expect(calls.find((call) => call.key === 'POST /api/topics/t1/attachments/uploads')?.body).toEqual({
      title: 'Fire film',
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10,
      durationSeconds: 12,
    });
    expect(await screen.findByText('Fire film:done:10:false:')).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/media/uploads')).toBe(false);
    expect(calls.some((call) => call.key === 'POST /api/media/uploads/u1/complete')).toBe(true);
    expect(value.jobs[0]).toMatchObject({ id: 'u1', itemId: 'v1', folderId: null, topicId: 't1' });
    expect(screen.getByText('finished:1')).toBeInTheDocument();
  });

  it('keeps the topic of a refused start out of the list of jobs', async () => {
    startServer({ 'POST /api/topics/t1/attachments/uploads': { status: 400, body: { message: 'Validation failed', fieldErrors: { contentType: ['Attachments can be MP4 videos.'] } } } });
    setup();
    await expect(act(() => value.start({ file, topicId: 't1', contentType: 'video/mp4', title: 'Fire film', durationSeconds: null }))).rejects.toMatchObject({ status: 400 });
    expect(value.jobs).toEqual([]);
  });

  it('starts an upload, sends every piece with a fresh link, completes with the receipts and reports it finished', async () => {
```

In `apps/web/src/uploads/UploadsContext.spec.tsx` replace:

```tsx
    it('refuses a different file and says which one is needed', async () => {
```

with:

```tsx
    it('resumes an attachment upload from what the server holds, in its topic', async () => {
      const calls = startServer({
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [] } },
      });
      setup();
      await act(() => value.resume({ ...pending, folderId: null, topicId: 't1' }, new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' })));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(value.jobs[0]).toMatchObject({ folderId: null, topicId: 't1' });
      expect(calls.some((call) => call.key === 'POST /api/media/uploads/u1/complete')).toBe(true);
    });

    it('refuses a different file and says which one is needed', async () => {
```

In `apps/web/src/uploads/UploadPanel.spec.tsx` and `apps/web/src/pages/media/FolderPage.spec.tsx` the job fixtures say they belong to no topic:

In `apps/web/src/uploads/UploadPanel.spec.tsx` replace:

```tsx
  folderId: 'f1',
  title: 'Fire exits',
```

with:

```tsx
  folderId: 'f1',
  topicId: null,
  title: 'Fire exits',
```

In `apps/web/src/pages/media/FolderPage.spec.tsx` replace:

```tsx
    const job: UploadJob = { id: 'u3', itemId: 'v3', folderId: 'f1', title: 'x', fileName: 'x.mp4', sizeBytes: 100, bytesSent: 62, status: 'sending', message: null, coverWarning: false };
```

with:

```tsx
    const job: UploadJob = { id: 'u3', itemId: 'v3', folderId: 'f1', topicId: null, title: 'x', fileName: 'x.mp4', sizeBytes: 100, bytesSent: 62, status: 'sending', message: null, coverWarning: false };
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` the component is told what is its own:

In `apps/web/src/pages/media/PendingUploads.spec.tsx` replace:

```tsx
import { mockSession, renderWithSession, STAFF } from '../../test/session';
```

with:

```tsx
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { MEDIA_KINDS } from '../../uploads/limits';
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` replace:

```tsx
const pending = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
  itemId: `item-${overrides.fileId}`,
  folderId: 'f1',
```

with:

```tsx
// What a folder page tells the list: which uploads are the folder's, which files to ask for and the words of the category.
const forFolder = (category: CategoryConfig, folderId: string) => ({
  belongs: (entry: PendingUpload) => entry.folderId === folderId,
  accept: MEDIA_KINDS[category.kind].accept,
  noun: category.noun,
  nounTitle: category.nounTitle,
});

const pending = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
  itemId: `item-${overrides.fileId}`,
  folderId: 'f1',
  topicId: null,
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` replace:

```tsx
      <PendingUploads category={category} folderId="f1" reloadKey={0} onChanged={onChanged} />
```

with:

```tsx
      <PendingUploads {...forFolder(category, 'f1')} reloadKey={0} onChanged={onChanged} />
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` replace:

```tsx
    const running: UploadJob = { id: 'a', itemId: 'item-a', folderId: 'f1', title: 'Mine here',
```

with:

```tsx
    const running: UploadJob = { id: 'a', itemId: 'item-a', folderId: 'f1', topicId: null, title: 'Mine here',
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` replace:

```tsx
        <PendingUploads category={VIDEOS} folderId="f1" reloadKey={0} onChanged={onChanged} />
```

with:

```tsx
        <PendingUploads {...forFolder(VIDEOS, 'f1')} reloadKey={0} onChanged={onChanged} />
```

Create `apps/web/src/pages/courses/AttachmentUploadDialog.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { readDuration } from '../../uploads/duration';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HELP, MAX_COVER_BYTES, MAX_PDF_BYTES } from '../../uploads/limits';
import { UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { AttachmentUploadDialog } from './AttachmentUploadDialog';

vi.mock('../../uploads/duration', () => ({ readDuration: vi.fn(async () => 42) }));

const sized = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

function setup(start: UploadsValue['start'] = vi.fn(async () => undefined)) {
  mockSession(STAFF);
  const value: UploadsValue = { jobs: [], finishedCount: 0, start, resume: vi.fn(), retry: vi.fn(), cancel: vi.fn(), dismiss: vi.fn() };
  const onClose = vi.fn();
  const onStarted = vi.fn();
  renderWithSession(
    <UploadsContext.Provider value={value}>
      <AttachmentUploadDialog open topicId="t1" onClose={onClose} onStarted={onStarted} />
    </UploadsContext.Provider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Upload a file' });
  return { dialog, start, onClose, onStarted };
}

describe('AttachmentUploadDialog', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(readDuration).mockClear();
  });

  it('asks for any of the four kinds, and says how large each may be', () => {
    const { dialog } = setup();
    expect(within(dialog).getByLabelText(/^File/)).toHaveAttribute('accept', ATTACHMENT_ACCEPT);
    expect(within(dialog).getByText(/2 GB for video, 500 MB for audio, 50 MB for a PDF and 10 MB for an image/)).toBeInTheDocument();
  });

  it('fills in the title from the file name, without the extension, until the person types their own', async () => {
    const { dialog } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'Exit map.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Exit map');
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.type(within(dialog).getByLabelText('Title'), 'My own title');
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'Other.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('My own title');
  });

  it.each([
    ['a PDF', 'Exit map.pdf', 'application/pdf', 'application/pdf', null],
    ['an image', 'Floor plan.png', 'image/png', 'image/png', null],
    ['a video', 'Film.mp4', 'video/mp4', 'video/mp4', 'video'],
    ['an MP3', 'Briefing.mp3', 'audio/mpeg', 'audio/mpeg', 'audio'],
    ['an M4A the system calls audio/x-m4a', 'Briefing.m4a', 'audio/x-m4a', 'audio/mp4', 'audio'],
    ['a PDF the system did not type', 'Plan.PDF', '', 'application/pdf', null],
  ])('starts %s with the declared type, the trimmed title and a length only where there is one to read', async (_name, fileName, type, declared, readAs) => {
    const { dialog, start, onClose, onStarted } = setup();
    const file = new File([new Uint8Array(10)], fileName, { type });
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Our file  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).toHaveBeenCalledWith({ file, topicId: 't1', contentType: declared, title: 'Our file', durationSeconds: readAs ? 42 : null });
    expect(vi.mocked(readDuration).mock.calls).toEqual(readAs ? [[file, readAs]] : []);
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a file and a title before sending anything', async () => {
    const { dialog, start } = setup();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^File/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ['a type that is not allowed', sized('notes.zip', 'application/zip', 10), ATTACHMENT_HELP],
    ['an empty file', sized('a.pdf', 'application/pdf', 0), 'That file is empty.'],
    ['a PDF over 50 MB', sized('a.pdf', 'application/pdf', MAX_PDF_BYTES + 1), 'PDF files can be at most 50 MB. Choose a smaller file.'],
    ['an image over 10 MB', sized('a.png', 'image/png', MAX_COVER_BYTES + 1), 'Images can be at most 10 MB. Choose a smaller file.'],
  ])('refuses %s with the reason and never reads its length', async (_name, file, message) => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file, { applyAccept: false });
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
    expect(readDuration).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal of the file or the title and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(400, 'Validation failed', { contentType: ['Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.'], title: ['Title must be 200 characters or fewer.'] });
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText(/Attachments can be MP4 videos/)).toBeInTheDocument();
    expect(within(dialog).getByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a general failure in an alert and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(404, 'Topic not found.');
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Topic not found.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be dismissed while the start is being sent', async () => {
    let release: () => void = () => undefined;
    const start = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { dialog, onStarted } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
  });
});
```

Adapt `apps/web/src/pages/courses/TopicPanel.spec.tsx` (the spec of Task 11) and extend it:

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
import { PlayerContext, type PlayerValue } from '../../player/PlayerContext';
```

with:

```tsx
import { PlayerContext, type PlayerValue } from '../../player/PlayerContext';
import { type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

function renderPanel(options: { player?: PlayerValue; strict?: boolean; onChanged?: () => void } = {}) {
  const { player = fakePlayer(), strict = false, onChanged = vi.fn() } = options;
  const panel = (
    <PlayerContext.Provider value={player}>
      <TopicPanel topicId="t1" courseTitle="Fire safety" lessonTitle="Exits" reloadKey={0} onChanged={onChanged} />
    </PlayerContext.Provider>
  );
  renderWithSession(strict ? <StrictMode>{panel}</StrictMode> : panel);
  return { player, onChanged };
}
```

with:

```tsx
const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

const fakeUploads = (overrides: Partial<UploadsValue> = {}): UploadsValue => ({
  jobs: [],
  finishedCount: 0,
  start: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  dismiss: vi.fn(),
  ...overrides,
});

let setUploads: (value: UploadsValue) => void = () => undefined;

function Providers({ initial, player, children }: { initial: UploadsValue; player: PlayerValue; children: ReactNode }) {
  const [value, setValue] = useState(initial);
  setUploads = setValue;
  return (
    <UploadsContext.Provider value={value}>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </UploadsContext.Provider>
  );
}

function renderPanel(options: { player?: PlayerValue; uploads?: UploadsValue; strict?: boolean; onChanged?: () => void } = {}) {
  const { player = fakePlayer(), uploads = fakeUploads(), strict = false, onChanged = vi.fn() } = options;
  const panel = (
    <Providers initial={uploads} player={player}>
      <TopicPanel topicId="t1" courseTitle="Fire safety" lessonTitle="Exits" reloadKey={0} onChanged={onChanged} />
    </Providers>
  );
  renderWithSession(strict ? <StrictMode>{panel}</StrictMode> : panel);
  return { player, uploads, onChanged };
}
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
import { StrictMode } from 'react';
```

with:

```tsx
import { type ReactNode, StrictMode, useState } from 'react';
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
    if (key === 'GET /api/media/videos/folders') return { body: folders };
```

with:

```tsx
    if (key === 'GET /api/media/uploads/mine') return { body: [] };
    if (key === 'GET /api/media/videos/folders') return { body: folders };
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
    expect(screen.getByRole('button', { name: 'Add from the library' })).toBeInTheDocument();
  });
```

with:

```tsx
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
    const openPicker = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add from the library' }));
      return screen.findByRole('dialog', { name: 'Add from the library' });
    };
```

with:

```tsx
    const openPicker = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Add an attachment' })).getByRole('button', { name: 'From the library' }));
      return screen.findByRole('dialog', { name: 'Add from the library' });
    };
```

Append to `apps/web/src/pages/courses/TopicPanel.spec.tsx`:

```tsx
describe('TopicPanel uploads', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const uploadJob = (overrides: Partial<UploadJob> = {}): UploadJob => ({
    id: 'u9',
    itemId: 'a9',
    folderId: null,
    topicId: 't1',
    title: 'Half a map',
    fileName: 'map.pdf',
    sizeBytes: 200,
    bytesSent: 50,
    status: 'sending',
    message: null,
    coverWarning: false,
    ...overrides,
  });

  it('offers to upload a file or to pick one from the library', async () => {
    startServer(topic([]));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an attachment' });
    expect(within(dialog).getByRole('button', { name: 'Upload a file' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'From the library' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload a file' }));
    expect(screen.queryByRole('dialog', { name: 'Add an attachment' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Upload a file' })).toBeInTheDocument();
  });

  it('starts the upload into this topic through the upload manager, and reloads the topic', async () => {
    const calls = startServer(topic([]));
    const { uploads, onChanged } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload a file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload a file' });
    const file = new File([new Uint8Array(10)], 'Exit map.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(uploads.start).toHaveBeenCalledWith({ file, topicId: 't1', contentType: 'application/pdf', title: 'Exit map', durationSeconds: null }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload a file' })).toBeNull());
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows how far an upload of this topic has got, and ignores jobs of other topics and folders', async () => {
    startServer(topic([attachment({ id: 'a1', title: 'Exit map' }), attachment({ id: 'a9', title: 'Half a map', status: 'uploading', position: 1 })]));
    renderPanel({ uploads: fakeUploads({ jobs: [uploadJob(), uploadJob({ id: 'u8', itemId: 'a1', topicId: 't2', bytesSent: 100 })] }) });
    const unfinished = await screen.findByRole('row', { name: /Half a map/ });
    expect(within(unfinished).getByText('Uploading 25%')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Exit map/ })).queryByText(/Uploading/)).toBeNull();
  });

  it('reloads the topic when an upload finishes', async () => {
    const calls = startServer(topic([]));
    renderPanel();
    await screen.findByText('No attachments yet');
    expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(1);
    act(() => setUploads(fakeUploads({ finishedCount: 1 })));
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
  });

  describe('the list of unfinished uploads', () => {
    const entry = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
      itemId: `a-${overrides.fileId}`,
      folderId: null,
      topicId: 't1',
      title: 'Half a map',
      fileName: 'map.pdf',
      sizeBytes: 1024,
      createdAt: '2026-10-09T10:00:00Z',
      ...overrides,
    });

    it('lists the unfinished uploads of this topic only, in the words of attachments', async () => {
      startServer(topic([]), {
        'GET /api/media/uploads/mine': {
          body: [entry({ fileId: 'u1' }), entry({ fileId: 'u2', title: 'Other topic', topicId: 't2' }), entry({ fileId: 'u3', title: 'A library video', topicId: null, folderId: 'f1' })],
        },
      });
      renderPanel();
      const table = await screen.findByRole('table', { name: 'Unfinished uploads' });
      expect(within(table).getByText('Half a map')).toBeInTheDocument();
      expect(within(table).queryByText('Other topic')).toBeNull();
      expect(within(table).queryByText('A library video')).toBeNull();
      expect(within(table).getByRole('columnheader', { name: 'Attachment' })).toBeInTheDocument();
    });

    it('resumes with the same file, asking for any allowed type', async () => {
      startServer(topic([]), { 'GET /api/media/uploads/mine': { body: [entry({ fileId: 'u1' })] } });
      const { uploads } = renderPanel();
      await screen.findByRole('table', { name: 'Unfinished uploads' });
      await userEvent.click(screen.getByRole('button', { name: 'Resume Half a map' }));
      const input = document.querySelector('input[type="file"][hidden]') as HTMLInputElement;
      expect(input).toHaveAttribute('accept', ATTACHMENT_ACCEPT);
      const file = new File([new Uint8Array(3)], 'map.pdf', { type: 'application/pdf' });
      await userEvent.upload(input, file);
      await waitFor(() => expect(uploads.resume).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'u1', topicId: 't1' }), file));
    });

    it('cancels an unfinished upload after a confirmation that speaks of attachments', async () => {
      startServer(topic([]), { 'GET /api/media/uploads/mine': { body: [entry({ fileId: 'u1' })] } });
      const { uploads } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Half a map' }));
      const dialog = screen.getByRole('dialog', { name: 'Cancel this upload?' });
      expect(dialog).toHaveTextContent('You can upload the attachment again later.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel upload' }));
      await waitFor(() => expect(uploads.cancel).toHaveBeenCalledWith('u1'));
    });
  });
});
```

Add the imports the new tests use at the top of the same spec (`act`, `PendingUpload`, `ATTACHMENT_ACCEPT`):

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
import type { Folder, MediaItem } from '../../api/media';
```

with:

```tsx
import type { Folder, MediaItem, PendingUpload } from '../../api/media';
```

In `apps/web/src/pages/courses/TopicPanel.spec.tsx` replace:

```tsx
import { mockSession, renderWithSession, STAFF } from '../../test/session';
```

with:

```tsx
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { ATTACHMENT_ACCEPT } from '../../uploads/limits';
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` the page needs an upload manager:

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
import { PlayerProvider } from '../../player/PlayerContext';
```

with:

```tsx
import { PlayerProvider } from '../../player/PlayerContext';
import { UploadsProvider } from '../../uploads/UploadsContext';
```

In `apps/web/src/pages/courses/CoursePage.spec.tsx` replace:

```tsx
    <PlayerProvider>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/courses" element={<p>The course list</p>} />
      </Routes>
      <LocationProbe />
    </PlayerProvider>,
```

with:

```tsx
    <UploadsProvider>
      <PlayerProvider>
        <Routes>
          <Route path="/courses/:courseId" element={<CoursePage />} />
          <Route path="/courses" element={<p>The course list</p>} />
        </Routes>
        <LocationProbe />
      </PlayerProvider>
    </UploadsProvider>,
```

Run: `npm test -w @jbf/web -- limits media.spec UploadsContext PendingUploads AttachmentUploadDialog TopicPanel`
Expected: FAIL (the attachment rules, the start route call, the new props and the dialogs do not exist yet).

- [ ] **Step 2: The file rules, the API call and the upload manager**

In `apps/web/src/uploads/limits.ts` let the rules of PDFs and images sit beside those of videos and audio:

In `apps/web/src/uploads/limits.ts` replace:

```ts
export type MediaKind = 'video' | 'audio';
```

with:

```ts
export type MediaKind = 'video' | 'audio';
// What can be attached to a topic: the library's two kinds, and PDFs and images.
export type AttachmentKind = MediaKind | 'pdf' | 'image';
```

In `apps/web/src/uploads/limits.ts` replace:

```ts
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
```

with:

```ts
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MAX_PDF_BYTES = 50 * 1024 ** 2;
```

In `apps/web/src/uploads/limits.ts` replace:

```ts
export const AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.';
```

with:

```ts
export const AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.';
export const ATTACHMENT_HELP = 'Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.';
```

In `apps/web/src/uploads/limits.ts` replace:

```ts
export type FileCheck = { ok: true; contentType: string } | { ok: false; problem: string };

// The type to declare for the file, or a plain-words problem.
export function checkMediaFile(kind: MediaKind, file: File): FileCheck {
  const rule = MEDIA_KINDS[kind];
  const contentType = rule.declaredType(file);
  if (!contentType) return { ok: false, problem: rule.wrongType };
  if (file.size === 0) return { ok: false, problem: 'That file is empty.' };
  if (file.size > rule.maxBytes) return { ok: false, problem: rule.tooLarge };
  return { ok: true, contentType };
}
```

with:

```ts
const IMAGE_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const PDF_RULE: KindRule = {
  accept: 'application/pdf,.pdf',
  formats: 'PDF, up to 50 MB',
  maxBytes: MAX_PDF_BYTES,
  wrongType: 'Only PDF files can be attached as documents.',
  tooLarge: 'PDF files can be at most 50 MB. Choose a smaller file.',
  declaredType: (file) => (file.type === 'application/pdf' || (file.type === '' && extensionOf(file.name) === 'pdf') ? 'application/pdf' : null),
};

const IMAGE_RULE: KindRule = {
  accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  formats: 'JPEG, PNG or WebP, up to 10 MB',
  maxBytes: MAX_COVER_BYTES,
  wrongType: 'Only JPEG, PNG or WebP images can be attached.',
  tooLarge: 'Images can be at most 10 MB. Choose a smaller file.',
  // A file the system did not type is recognised by its extension, as for videos.
  declaredType: (file) => (COVER_TYPES.includes(file.type) ? file.type : file.type === '' ? (IMAGE_BY_EXTENSION[extensionOf(file.name)] ?? null) : null),
};

// The same four kinds as the server's (apps/api/src/media/media-kinds.ts), in the order a file is recognised.
export const ATTACHMENT_KINDS: Record<AttachmentKind, KindRule> = { video: MEDIA_KINDS.video, audio: MEDIA_KINDS.audio, pdf: PDF_RULE, image: IMAGE_RULE };
const ATTACHMENT_KIND_LIST = Object.keys(ATTACHMENT_KINDS) as AttachmentKind[];
export const ATTACHMENT_ACCEPT = ATTACHMENT_KIND_LIST.map((kind) => ATTACHMENT_KINDS[kind].accept).join(',');

export type FileCheck = { ok: true; contentType: string } | { ok: false; problem: string };
export type AttachmentCheck = { ok: true; kind: AttachmentKind; contentType: string } | { ok: false; problem: string };

// The type to declare for the file, or a plain-words problem.
function checkRule(rule: KindRule, file: File): FileCheck {
  const contentType = rule.declaredType(file);
  if (!contentType) return { ok: false, problem: rule.wrongType };
  if (file.size === 0) return { ok: false, problem: 'That file is empty.' };
  if (file.size > rule.maxBytes) return { ok: false, problem: rule.tooLarge };
  return { ok: true, contentType };
}

export const checkMediaFile = (kind: MediaKind, file: File): FileCheck => checkRule(MEDIA_KINDS[kind], file);

// An attachment has no folder to say what it is: the first kind that recognises the file decides, and its limits apply.
export function checkAttachmentFile(file: File): AttachmentCheck {
  const kind = ATTACHMENT_KIND_LIST.find((candidate) => ATTACHMENT_KINDS[candidate].declaredType(file) !== null);
  if (!kind) return { ok: false, problem: ATTACHMENT_HELP };
  const check = checkRule(ATTACHMENT_KINDS[kind], file);
  return check.ok ? { ok: true, kind, contentType: check.contentType } : check;
}
```

In `apps/web/src/api/media.ts`:

In `apps/web/src/api/media.ts` replace:

```ts
export interface PendingUpload {
  fileId: string;
  itemId: string;
  folderId: string;
```

with:

```ts
export interface PendingUpload {
  fileId: string;
  itemId: string;
  // A library upload belongs to a folder, an attachment upload to a topic.
  folderId: string | null;
  topicId: string | null;
```

In `apps/web/src/api/media.ts` replace:

```ts
export interface StartUploadInput {
```

with:

```ts
export interface StartAttachmentUploadInput {
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export interface StartUploadInput {
```

In `apps/web/src/api/media.ts` replace:

```ts
export const getPartUrls =
```

with:

```ts
export const startAttachmentUpload = (topicId: string, input: StartAttachmentUploadInput): Promise<StartedUpload> =>
  api<StartedUpload>(`/api/topics/${topicId}/attachments/uploads`, { method: 'POST', body: input });

export const getPartUrls =
```

In `apps/web/src/api/media.ts` replace:

```ts
export const completeUpload = (fileId: string, parts: { partNumber: number; etag: string }[]): Promise<MediaItem> =>
  api<MediaItem>(`/api/media/uploads/${fileId}/complete`, { method: 'POST', body: { parts } });
```

with:

```ts
// Answers the finished library item or attachment; the upload manager only needs to know it finished.
export const completeUpload = (fileId: string, parts: { partNumber: number; etag: string }[]): Promise<unknown> =>
  api<unknown>(`/api/media/uploads/${fileId}/complete`, { method: 'POST', body: { parts } });
```

In `apps/web/src/uploads/UploadsContext.tsx`:

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
  startUpload,
  type UploadStatus as ServerUploadStatus,
```

with:

```tsx
  startAttachmentUpload,
  startUpload,
  type UploadStatus as ServerUploadStatus,
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
export interface UploadJob {
  id: string;
  itemId: string;
  folderId: string;
```

with:

```tsx
export interface UploadJob {
  id: string;
  itemId: string;
  // A library upload belongs to a folder, an attachment upload to a topic.
  folderId: string | null;
  topicId: string | null;
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
export interface StartInput {
  file: File;
  folderId: string;
  contentType: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  cover: File | null;
}
```

with:

```tsx
interface StartBase {
  file: File;
  contentType: string;
  title: string;
  durationSeconds: number | null;
}

// A library upload goes into a folder and may bring a description and a cover; an attachment goes into a topic.
export type StartInput = (StartBase & { folderId: string; description: string; cover: File | null }) | (StartBase & { topicId: string });
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
interface Source {
```

with:

```tsx
type ResumableUpload = Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'topicId' | 'title' | 'fileName' | 'sizeBytes'>;

interface Source {
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
    (pending: Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'title' | 'fileName' | 'sizeBytes'>, file: File, status: ServerUploadStatus) => {
```

with:

```tsx
    (pending: ResumableUpload, file: File, status: ServerUploadStatus) => {
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
        folderId: pending.folderId,
        title: pending.title,
```

with:

```tsx
        folderId: pending.folderId,
        topicId: pending.topicId,
        title: pending.title,
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
    async (input: StartInput) => {
      const created = await startUpload({
        folderId: input.folderId,
        title: input.title,
        description: input.description,
        fileName: input.file.name,
        contentType: input.contentType,
        sizeBytes: input.file.size,
        durationSeconds: input.durationSeconds,
      });
```

with:

```tsx
    async (input: StartInput) => {
      const created =
        'topicId' in input
          ? await startAttachmentUpload(input.topicId, {
              title: input.title,
              fileName: input.file.name,
              contentType: input.contentType,
              sizeBytes: input.file.size,
              durationSeconds: input.durationSeconds,
            })
          : await startUpload({
              folderId: input.folderId,
              title: input.title,
              description: input.description,
              fileName: input.file.name,
              contentType: input.contentType,
              sizeBytes: input.file.size,
              durationSeconds: input.durationSeconds,
            });
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
          itemId: created.itemId,
          folderId: input.folderId,
          title: input.title.trim(),
```

with:

```tsx
          itemId: created.itemId,
          folderId: 'folderId' in input ? input.folderId : null,
          topicId: 'topicId' in input ? input.topicId : null,
          title: input.title.trim(),
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
      void run(created.fileId, new Map(), input.cover);
```

with:

```tsx
      void run(created.fileId, new Map(), 'cover' in input ? input.cover : null);
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
    async (pending: Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'title' | 'fileName' | 'sizeBytes'>, file: File) => {
```

with:

```tsx
    async (pending: ResumableUpload, file: File) => {
```

In `apps/web/src/uploads/UploadsContext.tsx` replace:

```tsx
        await continueFromServer({ fileId: id, itemId: job.itemId, folderId: job.folderId, title: job.title, fileName: job.fileName, sizeBytes: job.sizeBytes }, source.file);
```

with:

```tsx
        await continueFromServer(
          { fileId: id, itemId: job.itemId, folderId: job.folderId, topicId: job.topicId, title: job.title, fileName: job.fileName, sizeBytes: job.sizeBytes },
          source.file,
        );
```

- [ ] **Step 3: The resume list for any owner**

In `apps/web/src/pages/media/PendingUploads.tsx`:

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
import { formatBytes, formatDateTime } from '../../lib/format';
import type { CategoryConfig } from '../../media/categories';
import { MEDIA_KINDS } from '../../uploads/limits';
import { FileMismatchError, useUploads } from '../../uploads/UploadsContext';
```

with:

```tsx
import { formatBytes, formatDateTime } from '../../lib/format';
import { FileMismatchError, useUploads } from '../../uploads/UploadsContext';
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
interface PendingUploadsProps {
  category: CategoryConfig;
  folderId: string;
```

with:

```tsx
interface PendingUploadsProps {
  // Which of the person's unfinished uploads are listed here (a folder's, or a topic's), which files to ask for when one is
  // resumed, and the words to use: "song" in a sentence, "Song" over the first column.
  belongs: (entry: PendingUpload) => boolean;
  accept: string;
  noun: string;
  nounTitle: string;
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
export function PendingUploads({ category, folderId, reloadKey, onChanged }: PendingUploadsProps) {
```

with:

```tsx
export function PendingUploads({ belongs, accept, noun, nounTitle, reloadKey, onChanged }: PendingUploadsProps) {
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
  const shown = list.filter((entry) => entry.folderId === folderId && !running.has(entry.fileId));
```

with:

```tsx
  const shown = list.filter((entry) => belongs(entry) && !running.has(entry.fileId));
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
      <input ref={inputRef} type="file" accept={MEDIA_KINDS[category.kind].accept} hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} />
```

with:

```tsx
      <input ref={inputRef} type="file" accept={accept} hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} />
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
              <th scope="col">{category.nounTitle}</th>
              <th scope="col">Size</th>
```

with:

```tsx
              <th scope="col">{nounTitle}</th>
              <th scope="col">Size</th>
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
                <td data-label={category.nounTitle}>
```

with:

```tsx
                <td data-label={nounTitle}>
```

In `apps/web/src/pages/media/PendingUploads.tsx` replace:

```tsx
        {cancelling ? `What was already sent of "${cancelling.title}" will be discarded. You can upload the ${category.noun} again later.` : ''}
```

with:

```tsx
        {cancelling ? `What was already sent of "${cancelling.title}" will be discarded. You can upload the ${noun} again later.` : ''}
```

In `apps/web/src/pages/media/FolderPage.tsx`:

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
import { useUploads } from '../../uploads/UploadsContext';
```

with:

```tsx
import { MEDIA_KINDS } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
```

In `apps/web/src/pages/media/FolderPage.tsx` replace:

```tsx
      <PendingUploads category={category} folderId={folderId} reloadKey={uploads.finishedCount} onChanged={() => void load()} />
```

with:

```tsx
      <PendingUploads
        belongs={(entry) => entry.folderId === folderId}
        accept={MEDIA_KINDS[category.kind].accept}
        noun={category.noun}
        nounTitle={category.nounTitle}
        reloadKey={uploads.finishedCount}
        onChanged={() => void load()}
      />
```

- [ ] **Step 4: The dialogs, the list's progress and the panel**

Create `apps/web/src/pages/courses/AddAttachmentDialog.tsx`:

```tsx
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import media from '../media/Media.module.css';

interface AddAttachmentDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: () => void;
  onLibrary: () => void;
}

// The two ways a file gets into a topic.
export function AddAttachmentDialog({ open, onClose, onUpload, onLibrary }: AddAttachmentDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Add an attachment">
      <p>Upload a new file, or pick one that is already in the library (Videos, Movies, Podcasts or Songs).</p>
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onLibrary}>
          From the library
        </Button>
        <Button data-autofocus onClick={onUpload}>
          Upload a file
        </Button>
      </div>
    </Dialog>
  );
}
```

Create `apps/web/src/pages/courses/AttachmentUploadDialog.tsx`:

```tsx
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import { readDuration } from '../../uploads/duration';
import { ATTACHMENT_ACCEPT, checkAttachmentFile } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import media from '../media/Media.module.css';

interface AttachmentUploadDialogProps {
  open: boolean;
  topicId: string;
  onClose: () => void;
  // Called once the server has accepted the upload (sending continues in the background).
  onStarted: () => void;
}

export function AttachmentUploadDialog({ open, topicId, onClose, onStarted }: AttachmentUploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Upload a file" blocked={busy}>
      <UploadForm topicId={topicId} busy={busy} setBusy={setBusy} onClose={onClose} onStarted={onStarted} />
    </Dialog>
  );
}

type Field = 'file' | 'title';
type Errors = Partial<Record<Field, string>>;

function UploadForm({
  topicId,
  busy,
  setBusy,
  onClose,
  onStarted,
}: Pick<AttachmentUploadDialogProps, 'topicId' | 'onClose' | 'onStarted'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const uploads = useUploads();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const titleTouched = useRef(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  // The length of a video or audio file is read in the background while the person fills in the form; submitting waits for it.
  const duration = useRef<Promise<number | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.field === 'file' ? fileRef : titleRef).current?.focus();
  }, [focusRequest]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    const check = chosen ? checkAttachmentFile(chosen) : null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: check && !check.ok ? check.problem : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    // A file that will be refused is never opened in a media element, and only videos and audio have a length.
    duration.current = chosen && check?.ok && (check.kind === 'video' || check.kind === 'audio') ? readDuration(chosen, check.kind) : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const check = file ? checkAttachmentFile(file) : null;
    const next: Errors = {
      file: check === null ? 'Choose a file.' : check.ok ? undefined : check.problem,
      title: title.trim() ? undefined : 'Enter a title.',
    };
    setErrors(next);
    const first = (['file', 'title'] as const).find((field) => next[field]);
    if (first || !file || !check || !check.ok) {
      setFocusRequest({ field: first ?? 'file' });
      return;
    }
    setBusy(true);
    try {
      await uploads.start({ file, topicId, contentType: check.contentType, title: title.trim(), durationSeconds: await duration.current });
      onStarted();
      onClose();
    } catch (caught) {
      const fields = caught instanceof ApiError ? caught.fieldErrors : {};
      const fromServer: Errors = {
        file: (fields.sizeBytes ?? fields.contentType ?? fields.fileName)?.join(' '),
        title: fields.title?.join(' '),
      };
      if (fromServer.file || fromServer.title) {
        setErrors(fromServer);
        setFocusRequest({ field: fromServer.file ? 'file' : 'title' });
      } else {
        setFailure(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField
        ref={fileRef}
        label="File (video, audio, PDF or image)"
        type="file"
        accept={ATTACHMENT_ACCEPT}
        data-autofocus
        hint="MP4 video, MP3 or M4A audio, PDF, or JPEG, PNG or WebP image. Largest sizes: 2 GB for video, 500 MB for audio, 50 MB for a PDF and 10 MB for an image. You can keep working while it uploads; progress shows in the corner. Keep this tab open until it finishes."
        onChange={onFileChange}
        error={errors.file}
      />
      <TextField
        ref={titleRef}
        label="Title"
        autoComplete="off"
        maxLength={200}
        value={title}
        onChange={(e) => {
          titleTouched.current = true;
          setTitle(e.target.value);
        }}
        error={errors.title}
      />
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Start upload
        </Button>
      </div>
    </form>
  );
}
```

In `apps/web/src/pages/courses/AttachmentList.tsx` show the percent of an upload running here:

In `apps/web/src/pages/courses/AttachmentList.tsx` replace:

```tsx
  busy: boolean;
  onOpen: (attachment: Attachment) => void;
```

with:

```tsx
  busy: boolean;
  // Percent sent for attachments being uploaded from this browser right now, by attachment id.
  progress: Record<string, number>;
  onOpen: (attachment: Attachment) => void;
```

In `apps/web/src/pages/courses/AttachmentList.tsx` replace:

```tsx
export function AttachmentList({ attachments, busy, onOpen, onRename, onMove }: AttachmentListProps) {
```

with:

```tsx
export function AttachmentList({ attachments, busy, progress, onOpen, onRename, onMove }: AttachmentListProps) {
```

In `apps/web/src/pages/courses/AttachmentList.tsx` replace:

```tsx
          const source = sourceText(attachment);
```

with:

```tsx
          const source = sourceText(attachment);
          const percent = progress[attachment.id];
```

In `apps/web/src/pages/courses/AttachmentList.tsx` replace:

```tsx
                    {isReady ? null : <Badge tone="change">Uploading</Badge>}
```

with:

```tsx
                    {isReady ? null : <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>}
```

In `apps/web/src/pages/courses/TopicPanel.tsx`:

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
import { usePlayer } from '../../player/PlayerContext';
```

with:

```tsx
import { usePlayer } from '../../player/PlayerContext';
import { ATTACHMENT_ACCEPT } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import { PendingUploads } from '../media/PendingUploads';
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
import { AttachmentList } from './AttachmentList';
```

with:

```tsx
import { AddAttachmentDialog } from './AddAttachmentDialog';
import { AttachmentList } from './AttachmentList';
import { AttachmentUploadDialog } from './AttachmentUploadDialog';
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
  const player = usePlayer();
```

with:

```tsx
  const player = usePlayer();
  const uploads = useUploads();
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
  const [picking, setPicking] = useState(false);
```

with:

```tsx
  const [choosing, setChoosing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
```

with:

```tsx
  // An upload that finished (or was cancelled) changes what the topic holds.
  useEffect(() => {
    void load();
  }, [load, reloadKey, uploads.finishedCount]);
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
  // The line under a track in the docked player.
```

with:

```tsx
  // Percent sent of the uploads of this topic that are running in this browser.
  const progress = Object.fromEntries(
    uploads.jobs
      .filter((job) => job.topicId === topicId && job.status === 'sending' && job.sizeBytes > 0)
      .map((job) => [job.itemId, Math.floor((100 * job.bytesSent) / job.sizeBytes)]),
  );

  // The line under a track in the docked player.
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
        <Button size="small" onClick={() => setPicking(true)}>
          Add from the library
        </Button>
```

with:

```tsx
        <Button size="small" onClick={() => setChoosing(true)}>
          Add
        </Button>
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
        <EmptyState title="No attachments yet">Add a file from the library to show it in this topic.</EmptyState>
      ) : (
        <AttachmentList attachments={topic.attachments} busy={busy} onOpen={open} onRename={setRenaming} onMove={(attachment, delta) => void move(attachment, delta)} />
      )}
```

with:

```tsx
        <EmptyState title="No attachments yet">Upload a file, or add one from the library, to show it in this topic.</EmptyState>
      ) : (
        <AttachmentList
          attachments={topic.attachments}
          busy={busy}
          progress={progress}
          onOpen={open}
          onRename={setRenaming}
          onMove={(attachment, delta) => void move(attachment, delta)}
        />
      )}
      <PendingUploads
        belongs={(entry) => entry.topicId === topicId}
        accept={ATTACHMENT_ACCEPT}
        noun="attachment"
        nounTitle="Attachment"
        reloadKey={uploads.finishedCount}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />
```

In `apps/web/src/pages/courses/TopicPanel.tsx` replace:

```tsx
      <LibraryPickerDialog
```

with:

```tsx
      <AddAttachmentDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        onUpload={() => {
          setChoosing(false);
          setUploading(true);
        }}
        onLibrary={() => {
          setChoosing(false);
          setPicking(true);
        }}
      />
      <AttachmentUploadDialog
        open={uploading}
        topicId={topic.id}
        onClose={() => setUploading(false)}
        onStarted={() => {
          void load();
          onChanged();
        }}
      />
      <LibraryPickerDialog
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (531 web tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: upload files into topics with the upload manager, progress and the resume list"
```


### Task 13: Documentation and the final checks

**Files:**
- Create: `docs/api/courses.md`
- Modify: `docs/api/media.md`, `docs/api/audit.md`, `docs/storage.md`, `ARCHITECTURE.md`, `README.md`, `DECISIONS.md`, `PROGRESS.md`, `CHANGELOG.md`

**Interfaces:** none (documentation only). Edit each file in its existing style: dated one-line bullets in `CHANGELOG.md` and `DECISIONS.md` (newest last), headed sections and tables elsewhere. Use the real date of the work for dated entries (the text below says `2026-10-09`; use the date of the work if it differs). Write from the code as built; where the code and the text below differ, the code wins and the difference is reported.

- [ ] **Step 1: The new API page `docs/api/courses.md`**

```md
# JBF LMS API: courses, lessons, topics and attachments (milestone 5)

This is the hand-written contract for the course endpoints, written from the code (`apps/api/src/courses/`, `apps/api/src/media/attachments.service.ts`, `apps/api/src/media/uploads.service.ts`) and its end-to-end tests (`apps/api/test/courses*.e2e-spec.ts`, `lessons`, `topics`, `attachments` and `attachment-*`). Authentication, token handling, the error body shape and the rate-limit rules are described in `docs/api/auth.md`. Files that are uploaded into a topic use the upload routes of `docs/api/media.md` unchanged; this page says only what differs. Storage is described in `docs/storage.md`.

- Base path: every route starts with `/api`.
- Access: **any signed-in person (Admin or Staff)**. No token gives 401. There are no role-only routes.
- Nothing in milestone 5 deletes anything, including an attachment. The only removals are those of the upload engine (cancel, failed verification, the 24-hour cleanup of an unfinished upload) and a replaced course cover.
- A course holds lessons, a lesson holds topics, a topic holds a text and attachments, each in a manual order. All text is plain text (line breaks are kept); the server never interprets it.

## Routes

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/courses` | The courses in order, with lesson and topic counts | 200 `CourseView[]` |
| `POST /api/courses` | Create a course (at the end) | 201 `CourseView` |
| `PUT /api/courses/order` | Reorder the courses | 200 `CourseView[]` |
| `GET /api/courses/:id` | The whole tree: lessons in order, each with its topics in order | 200 `CourseTree` |
| `PATCH /api/courses/:id` | Edit the title and the description | 200 `CourseTree` |
| `POST /api/courses/:id/cover` | Start setting the cover (the library's cover flow) | 201 `{ fileId, url, headers }` |
| `POST /api/courses/:id/cover/:fileId/complete` | Check and attach the cover | 200 `CourseTree` |
| `POST /api/courses/:id/lessons` | Add a lesson (at the end) | 201 `CourseTree` |
| `PUT /api/courses/:id/lessons/order` | Reorder the lessons of the course | 200 `CourseTree` |
| `PATCH /api/lessons/:id` | Rename a lesson | 200 `CourseTree` |
| `POST /api/lessons/:id/topics` | Add a topic (at the end) | 201 `CourseTree` |
| `PUT /api/lessons/:id/topics/order` | Reorder the topics of the lesson | 200 `CourseTree` |
| `PATCH /api/topics/:id` | Edit a topic's title and text | 200 `TopicView` |
| `GET /api/topics/:id` | The topic with its attachments | 200 `TopicDetail` |
| `POST /api/topics/:id/attachments/library` | Attach a ready library item | 201 `AttachmentView` |
| `POST /api/topics/:id/attachments/uploads` | Start uploading a file into the topic | 201 `{ itemId, fileId, partSize, partCount }` |
| `PUT /api/topics/:id/attachments/order` | Reorder the topic's ready attachments | 200 `AttachmentView[]` |
| `PATCH /api/attachments/:id` | Rename an attachment | 200 `AttachmentView` |
| `POST /api/attachments/:id/open` | A one-hour link to view or play it | 200 `{ url, expiresAt, contentType, kind }` |

Ids in the path must be UUIDs (400 otherwise); an id that does not exist is 404 with `Course not found.`, `Lesson not found.`, `Topic not found.`, `Attachment not found.` or `Item not found.`.

## Objects

- `CourseView`: `id`, `title`, `description` (string or `null`), `position`, `coverUrl` (a one-hour link or `null`), `lessonCount`, `topicCount`, `createdBy` (`{ id, name }`), `createdAt`.
- `CourseTree`: the same without the counts, plus `lessons`: `[{ id, title, position, topics: [{ id, title, position, attachmentCount }] }]`. `attachmentCount` counts ready attachments only.
- `TopicView`: `id`, `lessonId`, `courseId`, `title`, `description` (string or `null`), `position`. `TopicDetail` adds `attachments: AttachmentView[]`.
- `AttachmentView`: `id`, `topicId`, `position`, `kind` (`video`, `audio`, `pdf`, `image`), `title`, `source` (`upload` or `library`), `status` (`uploading` or `ready`), `sizeBytes`, `durationSeconds` (or `null`), `thumbnailUrl` (a one-hour link to the library item's cover, or to the uploaded image itself; `null` for everything else), `libraryItemId`, `category` (`video`, `movie`, `podcast`, `song`) and `libraryFolderName` (all three `null` for an uploaded file), `createdBy`, `createdAt`. It never contains a storage key or a file id.

## Rules

| Field | Rule |
| --- | --- |
| Titles (course, lesson, topic, attachment) | 1 to 200 characters after trimming; may repeat inside a course |
| Course description | at most 2,000 characters; an empty text means none (`null`) |
| Topic description | at most 10,000 characters; an empty text means none (`null`) |
| Any text | A NUL character is refused with 400 and the field named in `fieldErrors` |
| Edits (`PATCH`) | send only what changes; an empty body is 400 `Nothing to change.`; a change that changes nothing writes no audit entry |
| Order (`PUT .../order`) | `{ "ids": [...] }` with exactly the current ids of that list, each once, otherwise 409 `The list changed while you were editing it. Reload and try again.` (nothing is changed). For attachments the list is the ready ones; an attachment that is still uploading takes its place at the end when it finishes |
| New lessons, topics and attachments | go at the end |

A library attachment **follows its item**: with no title of its own it shows the item's current title, cover and file, so a later edit in the library shows in the course. A title given when attaching (`title`) or by a rename is the attachment's own and stays whatever happens to the item.

## Attachments

### From the library: `POST /api/topics/:id/attachments/library`

Body `{ "itemId": "<uuid>", "title": "optional" }`. The kind is the library item's (`video` for Videos and Movies, `audio` for Podcasts and Songs). An item that is still uploading is refused (409 `That item is still uploading.`; another person's unfinished item is 404 `Item not found.`). The same item can be attached more than once.

### Uploading: `POST /api/topics/:id/attachments/uploads`

Body `{ "title": "optional", "fileName": "...", "contentType": "...", "sizeBytes": 123, "durationSeconds": 90 }` (`title` defaults to the file name without its extension, at most 200 characters; `durationSeconds` is optional). The declared type decides the kind; there is no folder:

| Kind | Content types | Largest file | Pieces (at most) | First bytes checked | Stored as |
| --- | --- | --- | --- | --- | --- |
| video | `video/mp4` | 2,147,483,648 bytes (2 GiB) | 128 | `ftyp` at bytes 4–7 | `videos/<uuid>` |
| audio | `audio/mpeg`, `audio/mp4` | 524,288,000 bytes (500 MiB) | 32 | as for Podcasts and Songs | `audio/<uuid>` |
| pdf | `application/pdf` | 52,428,800 bytes (50 MiB) | 4 | starts with `%PDF-` | `documents/<uuid>` |
| image | `image/jpeg`, `image/png`, `image/webp` | 10,485,760 bytes (10 MiB) | 1 | as for covers | `images/<uuid>` |

A type that is none of these is 400 `fieldErrors.contentType` (`Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.`) and nothing else is reported; a size of 0 or over the kind's largest is 400 `fieldErrors.sizeBytes` with the kind's message (`PDF files can be at most 50 MB.`, `Images can be at most 10 MB (JPEG, PNG or WebP).`, and the two of milestone 4); an unknown topic is 404 before anything else is checked.

The answer is the same as for a library upload: `itemId` is the **attachment's id** (it stays the same when the upload finishes), `fileId` is the upload's id. Then use the routes of `docs/api/media.md` with that `fileId`, unchanged: `POST /api/media/uploads/:fileId/part-urls`, `GET /api/media/uploads/:fileId` (its `itemId` is the attachment id), `POST /api/media/uploads/:fileId/complete`, `DELETE /api/media/uploads/:fileId`. Differences:

- `complete` answers the `AttachmentView` (status `ready`, at the end of the topic's ready attachments). Wrong first bytes answer 422 and discard the upload with a message of the kind: `That file is not a valid PDF, so it was discarded. Please choose another file.` (`not_pdf`) or `That file is not a valid JPEG, PNG or WebP image, so it was discarded. Please choose another file.` (`not_image`); the video and audio messages are those of milestone 4.
- `GET /api/media/uploads/mine` lists attachment uploads too. Every entry now has `folderId` and `topicId`; exactly one is set (`topicId` for an attachment, `folderId` for a library upload).
- An attachment that is still uploading is visible to its creator only (404 to everyone else, and it is not in `GET /api/topics/:id` for them). Complete, cancel and the 24-hour cleanup behave as for library items: a ready attachment is never removed by them, completing twice is safe, and an object that disappears during verification answers 404 or 409, never 500.

### Opening: `POST /api/attachments/:id/open`

Answers `{ "url": "...", "expiresAt": "...", "contentType": "...", "kind": "pdf" }`. The link lasts one hour; ask again for a new one. A library attachment opens the library item's file. Errors: 409 `This is still uploading.` (your own unfinished attachment), 409 `This item is not available.` (a library item that is not ready), 404 for another person's unfinished attachment. Never keep or log the link.

## What is written to the audit log

Each entry is written in the same transaction as the change it describes. None contains a link, token, upload id or storage key. See `docs/api/audit.md` for how they are presented.

| Action | Written by | Target | Metadata |
| --- | --- | --- | --- |
| `content.course.created` | `POST /courses` | the course | |
| `content.course.edited` | `PATCH /courses/:id` | the course | before and after in `changes` |
| `content.course.reordered` | `PUT /courses/order` | `courses` | |
| `content.course.cover_set` | the cover completion | the course | `fileId` |
| `content.lesson.added` | `POST /courses/:id/lessons` | the lesson | `courseId`, `courseTitle` |
| `content.lesson.renamed` | `PATCH /lessons/:id` | the lesson | `courseId`; before and after in `changes` |
| `content.lesson.reordered` | `PUT /courses/:id/lessons/order` | the course | |
| `content.topic.added` | `POST /lessons/:id/topics` | the topic | `lessonId`, `lessonTitle`, `courseId` |
| `content.topic.edited` | `PATCH /topics/:id` | the topic | before and after in `changes` |
| `content.topic.reordered` | `PUT /lessons/:id/topics/order` | the lesson | |
| `content.attachment.added` | the library attachment, or an upload finishing | the attachment | `kind`, `source` (`library` or `upload`), `topicId`, `topicTitle` (and `libraryItemId` for a library attachment) |
| `content.attachment.renamed` | `PATCH /attachments/:id` | the attachment | `kind`, `topicId`; before and after in `changes` |
| `content.attachment.reordered` | `PUT /topics/:id/attachments/order` | the topic | |
| `playback.played` / `playback.viewed` | `POST /attachments/:id/open`: `played` for video and audio, `viewed` for PDF and image | the attachment | `kind`, `source`, `topicId` |
| `file.upload_started`, `file.upload_completed`, `file.upload_failed`, `file.upload_cancelled` | the upload routes | the attachment (`target.type` is `attachment`) | as for library uploads; failure reasons add `not_pdf` and `not_image` |

Only the entries of changes are written: an edit that changes nothing, a reorder that keeps the order, listing and reading write nothing. Opening an attachment writes one entry for every link issued.

## Database notes

Migration `0005` adds the `courses`, `lessons`, `topics` and `topic_attachments` tables, the `attachment_kind` type and the file purposes `pdf` and `image`. `topic_attachments.file_id` is unique; a check constraint requires exactly one of `file_id` and `library_item_id`, and another requires a title unless the attachment follows a library item. Locks are always taken parent before child (course, lesson, topic, attachment) and an attachment's or item's row before its `files` rows, so overlapping completions, cancels and cleanups cannot deadlock.
```

- [ ] **Step 2: The existing API pages and the storage guide**

`docs/api/media.md`:

In `docs/api/media.md` replace:

```md
# JBF LMS API: media (videos, movies, podcasts, songs), uploads and playback (milestones 3 and 4)
```

with:

```md
# JBF LMS API: media (videos, movies, podcasts, songs), uploads and playback (milestones 3 to 5)
```

In `docs/api/media.md` replace:

```md
- Nothing in milestones 3 and 4 deletes content. The only removal is cancelling your own unfinished upload.
```

with:

```md
- Nothing in milestones 3 to 5 deletes content. The only removal is cancelling your own unfinished upload.
- Since milestone 5 the upload routes below also carry the files that are uploaded into a course topic; `docs/api/courses.md` describes how that upload is started and what differs (the owner is an attachment, not a library item).
```

In `docs/api/media.md` replace:

```md
[ { "fileId": "...", "itemId": "...", "folderId": "...", "title": "...", "fileName": "welcome.mp4", "sizeBytes": 148230912, "createdAt": "2026-10-09T09:12:44.318Z" } ]
```

with:

```md
[ { "fileId": "...", "itemId": "...", "folderId": "...", "topicId": null, "title": "...", "fileName": "welcome.mp4", "sizeBytes": 148230912, "createdAt": "2026-10-09T09:12:44.318Z" } ]
```

In `docs/api/media.md`, before:

```md
### `POST /api/media/uploads/:fileId/complete`
```

add:

```md
Exactly one of `folderId` and `topicId` is set: `folderId` for a library upload, `topicId` (with `folderId` `null`) for a file uploaded into a course topic, whose `itemId` is then the attachment's id.

```

In `docs/api/media.md` replace:

```md
Migration `0004` renamed `media_items.video_file_id` to `media_file_id` and added `audio` to `file_purpose` (audio files have purpose `audio` and keys `audio/<uuid>`).
```

with:

```md
Migration `0004` renamed `media_items.video_file_id` to `media_file_id` and added `audio` to `file_purpose` (audio files have purpose `audio` and keys `audio/<uuid>`).

Migration `0005` (milestone 5) added the course tables and the file purposes `pdf` and `image` (keys `documents/<uuid>` and `images/<uuid>`); they are used only for files attached to topics (`docs/api/courses.md`). A finished upload of either owner is verified, completed, cancelled and cleaned up by the same code.
```

`docs/api/audit.md`:

In `docs/api/audit.md` replace:

```md
# JBF LMS API: audit log (milestones 2 to 4)
```

with:

```md
# JBF LMS API: audit log (milestones 2 to 5)
```

In `docs/api/audit.md` replace:

```md
Milestone 4 reuses the media actions for movies, podcasts and songs.
```

with:

```md
Milestone 4 reuses the media actions for movies, podcasts and songs. Milestone 5 adds 14 actions for courses, lessons, topics and attachments (see the table below); the endpoints that write them are described in `docs/api/courses.md`.
```

In `docs/api/audit.md` replace:

```md
| `action` | one of the 29 known actions listed below |
```

with:

```md
| `action` | one of the 43 known actions listed below |
```

In `docs/api/audit.md` replace:

```md
`file.upload_cancelled`, `playback.played`. The `action` filter accepts only these
```

with:

```md
`file.upload_cancelled`, `playback.played`, `content.course.created`, `content.course.edited`, `content.course.reordered`, `content.course.cover_set`, `content.lesson.added`, `content.lesson.renamed`, `content.lesson.reordered`, `content.topic.added`, `content.topic.edited`, `content.topic.reordered`, `content.attachment.added`, `content.attachment.renamed`, `content.attachment.reordered`, `playback.viewed`. The `action` filter accepts only these
```

In `docs/api/audit.md` replace:

```md
`type` (for example `user`, `invite`, `video`, `movie`, `podcast`, `song`, `folder`, `category` or `cover`)
```

with:

```md
`type` (for example `user`, `invite`, `video`, `movie`, `podcast`, `song`, `folder`, `category`, `cover`, `course`, `courses`, `lesson`, `topic` or `attachment`)
```

In `docs/api/audit.md` replace:

```md
`not_audio` is "the file is not a valid MP3 or M4A", `bad_image`
```

with:

```md
`not_audio` is "the file is not a valid MP3 or M4A", `not_pdf` is "the file is not a valid PDF", `not_image` is "the file is not a valid JPEG, PNG or WebP image", `bad_image`
```

In `docs/api/audit.md` replace:

```md
| `playback.played` | Played | neutral | playback | `<actor> played <target>` (one entry for every playback link issued, including renewals) |
```

with:

```md
| `playback.played` | Played | neutral | playback | `<actor> played <target>` (one entry for every playback link issued, including renewals) |
| `playback.viewed` | Viewed | neutral | playback | `<actor> opened the <kind> '<target>'` (a PDF or an image of a topic; `<kind>` from `metadata.kind`, else `attachment`) |
| `content.course.created` | Course created | change | content | `<actor> created the course '<target>'` |
| `content.course.edited` | Course edited | change | content | `<actor> edited the course '<target>'` |
| `content.course.reordered` | Courses reordered | neutral | content | `<actor> changed the order of the courses` |
| `content.course.cover_set` | Course cover set | change | content | `<actor> set the cover image of the course '<target>'` |
| `content.lesson.added` | Lesson added | change | content | `<actor> added the lesson '<target>' to the course '<metadata.courseTitle>'` (without the course when it was not recorded) |
| `content.lesson.renamed` | Lesson renamed | change | content | `<actor> renamed the lesson from '<before>' to '<after>'` (from `changes.title`; without them: `<actor> renamed the lesson '<target>'`) |
| `content.lesson.reordered` | Lessons reordered | neutral | content | `<actor> changed the order of the lessons in the course '<target>'` |
| `content.topic.added` | Topic added | change | content | `<actor> added the topic '<target>' to the lesson '<metadata.lessonTitle>'` (without the lesson when it was not recorded) |
| `content.topic.edited` | Topic edited | change | content | `<actor> edited the topic '<target>'` |
| `content.topic.reordered` | Topics reordered | neutral | content | `<actor> changed the order of the topics in the lesson '<target>'` |
| `content.attachment.added` | Attachment added | change | content | `<actor> added the <kind> '<target>' to the topic '<metadata.topicTitle>'`, for example "Anita Rao added the PDF 'Exit map' to the topic 'Fire exits'" |
| `content.attachment.renamed` | Attachment renamed | change | content | `<actor> renamed the attachment from '<before>' to '<after>'` (from `changes.title`; without them: `<actor> renamed the attachment '<target>'`) |
| `content.attachment.reordered` | Attachments reordered | neutral | content | `<actor> changed the order of the attachments in the topic '<target>'` |
```

In `docs/api/audit.md` replace:

```md
Unknown actions: an action that is not in the table
```

with:

```md
`<kind>` in the attachment sentences is `video`, `audio file`, `PDF` or `image` from `metadata.kind`; a missing or unknown kind reads `attachment`. The titles of courses, lessons, topics and attachments are shown between single quotes as plain text. `playback.viewed` is in the `playback` category, so "Changes only" hides it like `playback.played`.

Unknown actions: an action that is not in the table
```

`docs/storage.md`:

In `docs/storage.md` replace:

```md
Videos, movies, podcasts, songs and cover images are not kept on the server.
```

with:

```md
Videos, movies, podcasts, songs, the files attached to course topics (videos, audio, PDFs and images) and cover images are not kept on the server.
```

In `docs/storage.md` replace:

```md
| Storage names | Random, never typed text: `videos/<id>` (videos and movies), `audio/<id>` (podcasts and songs), `covers/<id>` |
| Cover images | JPEG, PNG or WebP, up to 10 MB |
| Piece size | 16 MB; a 2 GB video is at most 128 pieces and a 500 MB audio file at most 32. Every piece except the last must be at least 5 MB (R2's own rule) |
```

with:

```md
| Files attached to course topics | The same video and audio rules, plus PDF (`application/pdf`, up to 50 MB, 52,428,800 bytes) and images (JPEG, PNG or WebP, up to 10 MB) |
| Storage names | Random, never typed text: `videos/<id>` (videos and movies), `audio/<id>` (podcasts and songs), `documents/<id>` (PDFs), `images/<id>` (images), `covers/<id>` |
| Cover images | JPEG, PNG or WebP, up to 10 MB (library items and courses) |
| Piece size | 16 MB; a 2 GB video is at most 128 pieces, a 500 MB audio file at most 32, a 50 MB PDF at most 4 and a 10 MB image 1. Every piece except the last must be at least 5 MB (R2's own rule) |
```

In `docs/storage.md` replace:

```md
its first bytes must look like an MP4 (videos, movies and M4A), an MP3, or a JPEG, PNG or WebP for a cover.
```

with:

```md
its first bytes must look like an MP4 (videos, movies and M4A), an MP3, a PDF (it starts with `%PDF-`), or a JPEG, PNG or WebP (covers and images).
```

- [ ] **Step 3: `ARCHITECTURE.md`, `README.md`, `DECISIONS.md`, `CHANGELOG.md`, `PROGRESS.md`**

In `ARCHITECTURE.md` replace:

```md
Videos, movies, podcasts, songs and cover images live in private S3-compatible storage
```

with:

```md
Videos, movies, podcasts, songs, the files attached to course topics and cover images live in private S3-compatible storage
```

In `ARCHITECTURE.md` replace:

```md
| `cli/` | Command-line entry points:
```

with:

```md
| `courses/` | Courses, lessons and topics (milestone 5): `courses.service.ts` (list, create, reorder, the whole tree in one answer, edit, cover), `lessons.service.ts`, `topics.service.ts` (add, rename or edit, reorder, the topic with its attachments), `courses.schemas.ts` (validation), and the controllers for `/api/courses`, `/api/lessons`, `/api/topics` and `/api/attachments`. Attachments themselves are kept with the upload engine in `media/attachments.service.ts` (list, attach from the library, rename, reorder, open) |
| `cli/` | Command-line entry points:
```

In `ARCHITECTURE.md` replace:

```md
`media-kinds.ts` (the kinds and categories table: content types, sizes, first-bytes checks, key prefixes, words)
```

with:

```md
`media-kinds.ts` (the kinds and categories table: content types, sizes, first-bytes checks, key prefixes, words; the PDF and image kinds and the attachment kind resolver are in it too), `attachments.service.ts` (the files shown in a topic, see `courses/`), `reorder.ts` (the one exact-order check every reorder uses), `remove-unfinished.ts` (removes what an unfinished upload leaves behind, for a library item or an attachment)
```

In `ARCHITECTURE.md` replace:

```md
`covers.service.ts` (cover images)
```

with:

```md
`covers.service.ts` (cover images for any owner: a library item or a course)
```

In `ARCHITECTURE.md` replace:

```md
`api/` | `client.ts` (fetch wrapper, token refresh, error shape, file download) and typed calls: `auth.ts`, `staff.ts`, `audit.ts`, `media.ts` |
```

with:

```md
`api/` | `client.ts` (fetch wrapper, token refresh, error shape, file download) and typed calls: `auth.ts`, `staff.ts`, `audit.ts`, `media.ts`, `courses.ts` |
```

In `ARCHITECTURE.md` replace:

```md
`media/` (was `videos/`: `CategoryPage`, `FolderPage`, `ItemsTable`, the upload, edit and folder dialogs, the pop-up player dialog and the resume list for unfinished uploads, for every category) |
```

with:

```md
`media/` (was `videos/`: `CategoryPage`, `FolderPage`, `ItemsTable`, the upload, edit and folder dialogs, the pop-up player dialog and the resume list for unfinished uploads, for every category), `courses/` (milestone 5: `CoursesPage`, the two-pane `CoursePage` with the accessible tree `CourseOutline` and the `TopicPanel`, the attachment list, the library picker, the upload and image dialogs, and the small dialogs for titles, topics and the course) |
```

In `ARCHITECTURE.md` replace:

```md
`/`, `/account`, `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId` (for example `/songs/:folderId`) for everyone
```

with:

```md
`/`, `/account`, `/courses`, `/courses/:courseId` (with `?topic=<id>` to open a topic), `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId` (for example `/songs/:folderId`) for everyone
```

In `ARCHITECTURE.md` replace:

```md
Videos, movies, podcasts, songs and cover images are not kept on the API server.
```

with:

```md
Videos, movies, podcasts, songs, the files attached to course topics and cover images are not kept on the API server.
```

In `ARCHITECTURE.md` replace:

```md
Video files are stored as `videos/<uuid>`, audio files as `audio/<uuid>` and covers as `covers/<uuid>`.
```

with:

```md
Video files are stored as `videos/<uuid>`, audio files as `audio/<uuid>`, PDFs as `documents/<uuid>`, images as `images/<uuid>` and covers as `covers/<uuid>`. A file uploaded into a course topic goes through the same upload engine as a library file: only the owner of the finished file differs (a topic attachment instead of a library item).
```

In `ARCHITECTURE.md` replace:

```md
- API contracts: `docs/api/auth.md`, `docs/api/audit.md`, `docs/api/media.md`
```

with:

```md
- API contracts: `docs/api/auth.md`, `docs/api/audit.md`, `docs/api/media.md`, `docs/api/courses.md`
```

In `README.md` replace:

```md
Milestones 1 to 4 (this repository today)
```

with:

```md
Milestones 1 to 5 (this repository today)
```

In `README.md` replace:

```md
with a docked audio player. Milestone 3 is built and merged; milestone 4 is built and awaiting approval.
```

with:

```md
with a docked audio player, and Courses (lessons, topics, and files attached to a topic by uploading them or picking them from the library). Milestones 3 and 4 are built and merged; milestone 5 is built and awaiting approval.
```

In `README.md` replace:

```md
| Videos, Movies, Podcasts, Songs | `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId` |
```

with:

```md
| Courses | `/courses` and `/courses/:courseId` (`?topic=<id>` opens a topic) | Everyone signed in. Create courses, add lessons and topics, rename and reorder at every level (Move up and Move down), give a course a cover and a topic a text, and attach files to a topic: upload a video, audio file, PDF or image (the same resumable upload as the library, with progress and Resume), or pick a ready item from Videos, Movies, Podcasts or Songs (it stays linked, so a later edit shows). Videos open in a pop-up, audio in the bar at the bottom, a PDF in a new browser tab and an image in a pop-up. Nothing can be deleted yet (the Trash arrives in milestone 6) |
| Videos, Movies, Podcasts, Songs | `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId` |
```

In `README.md` replace:

```md
- API contract for the mobile developer: `docs/api/auth.md` (sign-in, invites, users), `docs/api/audit.md` (audit log) and `docs/api/media.md` (videos, movies, podcasts, songs, uploads, covers, playback)
```

with:

```md
- Design and plan for milestone 5: `docs/superpowers/specs/2026-10-09-milestone-5-courses-design.md` and `docs/superpowers/plans/2026-10-09-milestone-5-courses.md`
- API contract for the mobile developer: `docs/api/auth.md` (sign-in, invites, users), `docs/api/audit.md` (audit log), `docs/api/media.md` (videos, movies, podcasts, songs, uploads, covers, playback) and `docs/api/courses.md` (courses, lessons, topics, attachments)
```

Append the milestone 5 decisions to `DECISIONS.md` (a new section after the last line; one dated bullet with its reason each, in the same style as the milestone 4 section):

Append to `DECISIONS.md`:

```md

## Engineering decisions (milestone 5)

- **2026-10-09: A library attachment follows its library item; its title is stored only when someone gave it one.** `topic_attachments.title` is null for a library attachment attached without a title, and the topic then shows the item's current title (and its cover and file); a title given when attaching or by a rename is the attachment's own. A check constraint requires a title for every uploaded attachment. Reason: the spec says an edit in the library must show in the course, and also says an attachment has a title; this satisfies both without copying text that then goes stale.
- **2026-10-09: `topic_attachments.duration_seconds` was added to the spec's columns.** Reason: the start route takes the length the browser read from the file and the topic shows it, so it has to be stored somewhere; the spec's column list had no place for it.
- **2026-10-09: An attachment reuses the upload engine, with the owner of a file being either a library item or an attachment.** `UploadsService`, `removeUnfinished` and the cleanup job work on "the owner of this file", the owner's row is locked before the file rows exactly as before, and the kind of an attachment comes from its declared type (`attachmentKindFor`) instead of a folder. Reason: one tested implementation of resume, verification, cancel and cleanup serves both, and the lock order that fixed the milestone 3 deadlock still holds.
- **2026-10-09: The cover flow works for any owner of a cover (`CoverOwner`).** Reason: a course cover has the same checks, replacement and cleanup as a library cover; the owner only says which row to lock, which column to set and which audit entry to write.
- **2026-10-09: Every reorder goes through one check (`applyOrder`).** It takes the current ids in their present order and the ids asked for, answers 409 unless they are the same set, and writes nothing when the order did not change. Reason: five lists (courses, lessons, topics, attachments, and the library's own) must not each decide what "exact" means.
- **2026-10-09: Counts in the course answers come from grouped queries, not correlated subqueries.** Reason: inside a single-table select drizzle writes columns without their table name, so a subquery comparing `topic_id` with `id` silently compared the subquery's own table with itself and counted nothing (found by a test).
- **2026-10-09: `GET /api/media/uploads/mine` entries gained `topicId` and `folderId` can be null.** Reason: the resume list must tell a library upload from an attachment upload; the existing fields did not change.
- **2026-10-09: A PDF opens in a tab opened straight from the click and sent to the link when it arrives; if the browser blocks the tab the person is told to allow pop-ups.** Reason: browsers allow a new tab only inside a click, but the link needs a request; opening first keeps the click, and the tab is closed again if the link cannot be had. The tab's `opener` is cleared before it goes to the storage site.
- **2026-10-09: The course page is one route with the topic in the address (`?topic=`), and a phone shows either the tree or the topic with a Back button.** Reason: a topic can be bookmarked and shared, and the browser's own Back works; the choice of pane is a data attribute on the page that a media query reads, so it needs no extra state.
- **2026-10-09: The tree is the WAI-ARIA tree pattern with one Tab stop; the buttons of a row are reached with Tab from that row.** Reason: arrow keys walk the visible items, Right and Left open, close and step in and out, and a long course does not put dozens of buttons in the Tab order.
- **2026-10-09: The docked player and the pop-up player take a function that asks for the link (`link`) instead of an item id, and the dock shows a `place` text.** Reason: a library item and a topic attachment are played by different routes (`/items/:id/play` and `/attachments/:id/open`), and the label is "Songs › folder" for one and "Course › Lesson › Topic" for the other.
```

Append to `CHANGELOG.md`:

```md
- 2026-10-09: Added the milestone 5 design spec and implementation plan (Courses, Lessons, Topics and attachments).
- 2026-10-09: Added migration 0005: courses, lessons, topics and topic attachments, with the `pdf` and `image` file purposes; tested on a database that already holds media and an upload in progress.
- 2026-10-09: Added the PDF and image kinds to the kinds table, the attachment kind resolver, the `%PDF-` check and the `documents/` and `images/` storage keys.
- 2026-10-09: Added the courses API: list, create, reorder, the whole tree in one answer, edit and the cover (the cover flow now works for any owner).
- 2026-10-09: Added lessons and topics: add, rename or edit and reorder, with their audit entries.
- 2026-10-09: Added the topic with its attachments, attaching a library item (which keeps following it), renaming, reordering and opening an attachment, with `playback.viewed` for PDFs and images.
- 2026-10-09: Files can be uploaded into a topic with the same engine as the library: the upload routes now work for an attachment as well as a library item.
- 2026-10-09: Abandoned attachment uploads are cleaned up after 24 hours, and cancel, finish and cleanup are pinned against racing each other.
- 2026-10-09: Added the Courses link and the course list page.
- 2026-10-09: Added the course page: an accessible tree, the selected topic, a deep link, a phone Back button and editing the course.
- 2026-10-09: Added building a course: add lessons and topics, rename, move up and down at every level, and edit a topic's text.
- 2026-10-09: Added attachments to the topic page: adding from the library, renaming, moving, and opening a video in the pop-up, audio in the dock, a PDF in a new tab and an image in a pop-up.
- 2026-10-09: Added uploading a file into a topic, with progress and the list of unfinished uploads.
- 2026-10-09: Documented milestone 5: the courses API page and the media, audit, storage, README, architecture and working-memory files.
```

In `PROGRESS.md` replace:

```md
## Done: milestone 4 (Movies, Podcasts, Songs and the docked player; built, awaiting approval)
```

with:

```md
## Done: milestone 4 (Movies, Podcasts, Songs and the docked player; built and merged to `main` 2026-10-09)
```

In `PROGRESS.md` replace:

```md
## In progress

Nothing in the build. Milestone 4 is built and waiting for the user's approval (see open items 23 to 26). Milestone 3 was built and merged to `main` on 2026-10-09 (commit 827e0d6); it has not been formally approved yet. `TASKS.md` is unchanged.

## Next: milestone 5

Courses and attachments.
```

with:

```md
## Done: milestone 5 (Courses, Lessons, Topics and attachments; built, awaiting approval)

- Courses hold lessons, lessons hold topics, topics hold a text and attachments, all in a manual order with Move up and Move down at every level. A course has a title, a description and an optional cover. Nothing can be deleted.
- Attachments are either uploaded into the topic (video, audio, PDF or image, with the same resumable engine, progress and Resume as the library) or picked from the library (a ready Videos, Movies, Podcasts or Songs item; it stays linked and follows later edits). Limits: video 2 GiB, audio 500 MiB, PDF 50 MiB (`%PDF-` first bytes), image 10 MiB (as covers); storage keys `documents/<uuid>` and `images/<uuid>`.
- Database (migration `0005`): `courses`, `lessons`, `topics`, `topic_attachments` (exactly one of file or library item, the file unique) and the file purposes `pdf` and `image`. Tested on a database that already holds media and an upload in progress.
- API (`docs/api/courses.md`): the tree in one answer, edits, exact reorders (409 otherwise), the cover for courses, topic detail, library attachments, uploads into a topic (the existing `/api/media/uploads/...` routes), opening an attachment (one-hour link, audited). Cancel, finish and the 24-hour cleanup work for attachments exactly as for library items.
- Audit: 14 new actions (`content.course.*`, `content.lesson.*`, `content.topic.*`, `content.attachment.*`, `playback.viewed`) with sentences such as "Anita Rao added the PDF 'Exit map' to the topic 'Fire exits'".
- Web: Courses first in the sidebar, the course list, the two-pane course page (an accessible tree with arrow keys, the topic, a deep link `?topic=`, a Back button on a phone), building the course, the attachment list with the library picker and the upload dialog, and the four ways to open an attachment (video pop-up, audio in the dock, PDF in a new tab, image pop-up).
- Tests at the end of the build: 867 API tests (59 suites) and 531 web tests (46 files), all passing. Lint and both builds are clean.

## In progress

Nothing in the build. Milestone 5 is built and waiting for the user's approval (see open items 27 to 31). Milestones 3 and 4 are merged to `main`; neither has been formally approved yet. `TASKS.md` is unchanged.

## Next: milestone 6

Delete, Trash and restore, offline download and sync endpoints, the generated OpenAPI document.
```

In `PROGRESS.md`, after:

```md
26. The Cloudflare account and R2 bucket are still not connected (item 19 stays); audio uploads have only been exercised with the local and in-memory drivers.
```

add:

```md
27. The browser parts of milestone 5 (the tree's keyboard use and focus ring, the two-pane layout and the phone Back behaviour, a PDF opening in a new tab and the pop-up blocker, an image in the pop-up, audio from a topic in the dock) were verified only with automated (jsdom) tests, not in a real browser.
28. A PDF opens in the browser's own viewer; a phone may download it instead.
29. A library attachment follows its library item. When milestone 6 lets an item be trashed, the attachment will have to show as unavailable; that behaviour is designed in milestone 6.
30. The topic text and the attachment titles are plain text; there is no rich text, no lesson description, no progress or completion tracking.
31. The Cloudflare account and R2 bucket are still not connected (item 19 stays); PDFs and images have only been exercised with the local and in-memory drivers.
```

- [ ] **Step 4: Final checks (run everything yourself and read the output)**

From the repository root with the Node 24 PATH:

```bash
npm run lint
npm run build -w @jbf/api && npm run build -w @jbf/web
npm test -w @jbf/api
npm test -w @jbf/web
npm audit --audit-level=high
(cd apps/api && npx drizzle-kit generate)
git status --short
grep -rnE "console\.log|eslint-disable|dangerouslySetInnerHTML|: any\b" apps/api/src apps/web/src --include=*.ts --include=*.tsx | grep -v "apps/api/src/cli" || echo "none found"
grep -rnE "localStorage|sessionStorage" apps/web/src --include=*.ts --include=*.tsx | grep -v "\.spec\." || echo "no browser storage"
grep -rn "removeUnfinishedItem\|categoryLabel\|folderName: \|itemId: item" apps/api/src apps/web/src | grep -v "\.spec\." || echo "old shapes gone"
```

Expected: lint and both builds clean; every test passes, milestone 1–4 tests included (the counts are 867 API tests in 59 suites and 531 web tests in 46 files, which is what `PROGRESS.md` now says; if yours differ, correct the numbers in `PROGRESS.md` and tell the reviewer why); `npm audit` exits 0 (if it needs the local certificate bundle, use `NODE_EXTRA_CA_CERTS` as in milestone 3; report any high or critical advisory); `drizzle-kit generate` prints `No schema changes, nothing to migrate`; `git status` shows only the documentation files you edited and `vibe-coding-master-prompt.md` (and `.claude/` if present) untracked; the last three commands print their "none" / "no browser storage" / "old shapes gone" messages (the `localStorage` and `sessionStorage` words appear only in specs that assert they are empty).

- [ ] **Step 5: Smoke test against the development database**

Run `npm run db:migrate -w @jbf/api` (applies 0005 to the development database; it already holds milestone 3 and 4 data if the user tried uploads) and then `npm run storage:cleanup -w @jbf/api` (expect `Removed 0 abandoned uploads.` or a count of really abandoned ones). Do not create an admin or start the servers unless the user asks.

- [ ] **Step 6: Commit**

```bash
git add docs ARCHITECTURE.md README.md PROGRESS.md CHANGELOG.md DECISIONS.md
git commit -m "docs: describe courses, lessons, topics and attachments"
```

**Manual check for the person approving the milestone (not part of automated verification):** (1) start the API and web app, sign in; the sidebar shows Courses above Videos; (2) create a course with a cover, add two lessons and three topics, and use Move up and Move down at each level; (3) in the tree use Tab, the arrow keys, Enter and Space: one stop, arrows walk the items, Left and Right close, open and step in and out, and a screen reader announces open and closed lessons; (4) reload the page with `?topic=` in the address: the topic opens; make the window phone-sized: the topic replaces the tree and Back returns to it; (5) in a topic upload a PDF, an image, an MP3 and an MP4 (try a `.zip` and an oversized file and read the refusals), cancel one upload, close the tab during another and Resume it after reloading; (6) pick a video from Videos and a song from Songs through Add, From the library, then edit the video's title in the library: the course shows the new title; (7) open each: the video in a pop-up, the song in the bar at the bottom (labelled "Songs › folder"), the uploaded MP3 in the bar (labelled "Course › Lesson › Topic"), the PDF in a new tab (allow pop-ups if asked), the image in a pop-up; (8) as an Admin open the Audit log: the sentences for every change (for example "added the PDF 'Exit map' to the topic 'Fire exits'"), "Viewed" entries under Playback, and no links anywhere.

---

## Spec coverage and shared names

- **Spec coverage:** §1 goal → all tasks. §2 decisions: both attachment sources (5, 6, 11, 12), one page with a tree and the phone Back behaviour (9, 10), Move up/down at every level (3, 4, 5, 8, 10, 11), plain text (4, 9, 10), a lesson is a title only (4), no deleting (all), the upload engine unchanged (6, 7, 12), opening by kind (5, 11). §3 data model and `0005` (1), keys and local driver (2). §4 file rules, first bytes, failure reasons (2, 6). §5 routes (3–7), rules: exact reorders, 404s, NUL, creator-only visibility, lock order, conditional deletes, idempotent completion and vanishing objects (3–7). §6 audit actions, sentences and the example (3–7, 13). §7 web: sidebar and routes (8), the course page and tree (9), building (10), attachments, Add, Open (11, 12), reuse of the upload manager, progress panel, resume list and dock (11, 12). §8 testing and §9 acceptance: the tests of every task, and Task 13 for lint, builds and the full suites. §11 risks: Task 13 open items.
- **Names used across tasks:** `MEDIA_KINDS` (pdf, image), `attachmentKindFor`, `attachmentFieldErrors`, `LibraryKind`, `hasPdfSignature`, `scratchDatabase` (Tasks 1–2); `applyOrder`, `CoverOwner`, `CoversService.newCover/setCover`, `CourseTree`, `CourseView`, `CoursesService.requireCourse`, `seedLesson`, `seedTopic` (Task 3); `LessonsService.requireLesson`, `TopicView`, `whileHolding` (Task 4); `AttachmentsService`, `AttachmentView`, `OpenLink`, `TopicDetail`, `seedAttachment`, `pdfBytes` (Task 5); `UploadsService.startAttachment`, `removeUnfinished`, `RemovedUpload`, `titleFromFileName`, `startAttachmentUploadViaApi`, `uploadAttachment` (Tasks 6–7); `CoursesPage`, `CourseDialog`, `updateCourse` (Task 8); `CourseOutline`, `TopicPanel`, `CoursePage`, `EditCourseDialog`, `uploadCoverTo` (Task 9); `TitleDialog`, `EditTopicDialog` (Task 10); `AttachmentList`, `LibraryPickerDialog`, `ImageDialog`, `VideoTarget`, `DockTrack.link/place` (Task 11); `ATTACHMENT_KINDS`, `checkAttachmentFile`, `StartInput` (union), `PendingUploads` (`belongs`), `AddAttachmentDialog`, `AttachmentUploadDialog` (Task 12).
