# Milestone 4: Movies, Podcasts, Songs and the docked player — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff and Admin keep Movies, Podcasts and Songs in folders exactly as they keep Videos (upload in resumable pieces with an optional cover, edit, reorder, play), with one implementation for all four categories; podcasts and songs play in a docked player bar that keeps playing while the person browses, videos and movies keep the pop-up player.

**Architecture:** One kinds table decides what each category accepts: on the API `MEDIA_KINDS` and `MEDIA_CATEGORIES` in `apps/api/src/media/media-kinds.ts` (content types, maximum size, first-bytes check, storage key prefix, file purpose, failure reason, words), on the web `MEDIA_KINDS` in `apps/web/src/uploads/limits.ts` (file picker, client-side check, declared type) and `CATEGORIES` in `apps/web/src/media/categories.ts` (route slug, kind, words). The folder decides the kind; the server never trusts a kind from the browser. Migration `0004` renames `media_items.video_file_id` to `media_file_id` and adds `audio` to `file_purpose`. The docked player is a React context mounted once in the app shell next to the upload panel; its bar owns one `<audio>` element per start and asks for exactly one playback link per start.

**Tech Stack:** Unchanged: NestJS 11, Drizzle 0.45, PostgreSQL 17, zod 4, Jest + supertest (API); React 19, react-router-dom 7, Vite, Vitest + Testing Library + jsdom 30 (web). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-milestone-4-media-categories-design.md` (binding). It builds on `docs/superpowers/specs/2026-10-08-milestone-3-videos-design.md` and the parent spec `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`; where the milestone 4 spec is silent, those apply. Milestone 1 to 3 code is the baseline.

**Dry run:** every code step of Tasks 1–10 was applied to a scratch copy of the repository while this plan was written (milestone 3 code as on `main`): after each task the type check, lint and the full test suites passed, ending at 539 API tests and 387 web tests. The migration commands of Task 2 were run the same way (`No schema changes` afterwards; the migration test passed on PostgreSQL 17).

**Planned deviations from the spec (the user may overrule):**
1. **Audit target type of an item is its category.** Entries about an item (`file.upload_*`, `content.video.*`, `playback.played`) record `target.type` as `video`, `movie`, `podcast` or `song` instead of always `video`. Video entries are unchanged; the spec does not say what the target type of a song is, and `video` would be wrong in the details drawer and the CSV export. `metadata.category` is written on the content entries exactly as the spec says (folder and item `content.*` actions), not on `file.upload_*` or `playback.played`, whose sentences do not change.
2. **Three error messages lose the word "video"** because they now serve every category: `Video not found.` becomes `Item not found.`, `This video is still uploading.` becomes `This is still uploading.`, and the cancel refusal `This video has already finished uploading. Finished videos cannot be cancelled here.` becomes `This upload has already finished. Finished uploads cannot be cancelled here.` Status codes do not change; no milestone 3 test matches the old wording except `/still uploading/i`, which still matches.
3. **The phone layout puts volume beside the controls.** The spec says "two rows (title and Close on top; controls and seek slider below)"; volume (Mute and its slider) goes in the second row too, with a narrower slider, so nothing is hidden on a phone.
4. **"The link expired" is detected as "the audio stopped loading".** The browser does not say why a media element failed, so any load error asks once for a fresh link (the milestone 3 pop-up already works this way).

## Global Constraints

- Branch `milestone-4-media` (already created; the spec and this plan are committed on it). Work only on this branch. Run `git status` before starting and before the final handoff. **Do not push, and do not merge to `main`**, until the user approves the milestone. Never force-push; on a conflict stop and show the user. Leave `vibe-coding-master-prompt.md` untracked.
- Environment for every shell command: `export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"`. PostgreSQL must be running (the API tests recreate `jbf_lms_test` and, in Task 2, `jbf_lms_migration_test`).
- **No new dependencies.** Decisions inherited (do not undo): NestJS 11; TypeScript 6 with `module: commonjs` + `moduleResolution: bundler` (API); zod 4; drizzle-orm 0.45 (`.for('update')`, `.returning()`, conditional deletes); Jest runs serially (`--runInBand`) against one shared, recreated database, so tests create their own rows with unique names; Vitest + Testing Library; the milestone 2 `Dialog` (native `<dialog>`).
- **Limits (exact):** video and movie: `video/mp4` only, at most `2,147,483,648` bytes (2 GiB). Podcast and song: `audio/mpeg` (MP3) and `audio/mp4` (M4A) only, at most `524,288,000` bytes (500 MiB). Raw `.aac` (ADTS), `.wav`, `.flac` are refused. Pieces `16,777,216` bytes (16 MiB), `ceil(size / 16 MiB)` pieces, so at most 128 for 2 GiB and at most 32 for 500 MiB; every piece except the last at least `5,242,880` bytes; cover `image/jpeg`, `image/png`, `image/webp` up to `10,485,760` bytes; links last 1 hour; unfinished uploads removed after 24 hours; title 1–200, description at most 2,000, folder name 1–100 (unique per category ignoring case), stored file name at most 255.
- **First-bytes checks on completion (exact):** MP4 and M4A: `ftyp` at bytes 4–7. MP3: starts with `ID3` (`49 44 33`), or byte 0 is `FF` and `(byte1 & 0xE0) === 0xE0`. A mismatch deletes the object, aborts the upload, removes the rows (and the cover), records `file.upload_failed` with reason `not_mp4` (video kind) or `not_audio` (audio kind) and answers 422.
- Category route slugs are exactly `videos`, `movies`, `podcasts`, `songs` (database categories `video`, `movie`, `podcast`, `song`); any other slug is 404. Existing `/api/media/videos/...` routes keep their behaviour; responses only gain `category`.
- Every media endpoint needs a signed-in person (Admin or Staff). Nothing in this milestone deletes content; the only removals are those of milestone 3 (cancel, failed verification, 24-hour cleanup, replaced cover).
- Storage keys are random: `videos/<uuid>`, `audio/<uuid>`, `covers/<uuid>`; never user text. File names are display-only. `sanitizeFileName` exists twice (`apps/api/src/media/file-checks.ts` and `apps/web/src/uploads/sanitize-file-name.ts`); this milestone does not change it, and if anyone touches one copy the other must stay identical.
- Database change and its audit entry are written in the SAME transaction. Storage calls happen OUTSIDE transactions with best-effort compensation. **Lock order everywhere: the `media_items` row before the `files` rows.** Cancel, failure and cleanup delete conditionally (`status = 'uploading'` / `status = 'pending'`), so a ready item can never be removed by them. Completion is idempotent; an object that vanishes during verification (`head` null or `readRange` `not_found`) answers 404 or 409, never 500.
- NUL characters in text fields (folder name, title, description, file name, content type) are refused with 400.
- **Links and keys are secrets-adjacent:** no temporary link, signature, token, upload id or storage key may appear in any audit entry, log line, error message or API response other than the one that issues that link.
- Web: user text (titles, descriptions, file and folder names) only as React text, never `dangerouslySetInnerHTML`; links are never stored (no `localStorage`/`sessionStorage`) or logged; dialogs use `Dialog` with `blocked` while a request runs; everything keyboard operable with labelled fields and visible focus; AA contrast; responsive; design tokens only (this plan adds exactly one token, `--player-height`, in Task 8, because the bar, the page padding and the upload panel must agree on it).
- jsdom 30 facts the web tests rely on: `HTMLMediaElement.prototype.play/pause/load` are not implemented (`play()` returns `undefined`), so tests that reach them stub them with `vi.spyOn(HTMLMediaElement.prototype, 'play' | 'pause')`; `currentTime`, `volume` and `muted` are settable; `duration` and `paused` are read-only (define `duration` per element with `Object.defineProperty`); `volumechange` is dispatched asynchronously (use `waitFor`); the `autoplay` attribute does nothing.
- No dead code, no unused exports or imports, no `any`, no `eslint-disable`, no `console.log` outside `apps/api/src/cli`. Commit messages `<type>: <what changed, plain language>`, first line under about 72 characters, then a blank line and the attribution trailer your session instructions require. Commit after every task.
- All milestone 1–3 tests keep passing. Each task lists the existing tests it must adapt because of the rename or the generalization; adapt exactly those, never weaken an assertion. Test-only code lives under `apps/api/test/`.

## Review Focus

Inputs and failure modes the spec implies but a happy-path test would miss, most likely first. Each has a test in the task that owns the code.

1. **Cross-kind and alias declarations:** an MP4 declared into Songs or Podcasts, an MP3 or M4A into Videos or Movies, `audio/x-m4a`, `audio/aac`, `audio/mp3`, `audio/wav` sent to the API are 400 with a message naming the allowed formats and leave nothing in storage; the web declares `.m4a` files reported as `audio/x-m4a`, `audio/aac` or nothing as `audio/mp4`, `.mp3` reported as nothing or `audio/mp3` as `audio/mpeg`, and refuses raw `.aac` (Tasks 1, 4, 6, 10).
2. **Audio first bytes:** `ID3`; frame syncs `FF FB`, `FF F3`, `FF E3` and the boundary `FF E0` accepted; `FF D8` (JPEG), `FF C0`, a lone `FF`, empty input, `ID` alone, lower-case `id3`, a frame sync one byte late, RIFF/WAV and MP4 bytes refused as MP3; an MP3 declared as M4A refused; a refused song loses its rows, object and cover and records `not_audio` (Tasks 1, 4).
3. **Exact size edges per kind:** 500 MiB accepted for songs and podcasts (32 pieces), +1 refused; 2 GiB accepted for movies (128 pieces), +1 refused; 0 refused; the same edges on the web (Tasks 1, 4, 6, 10).
4. **Migration on existing data:** a database at migration 0003 holding a ready video with a cover and an upload in progress keeps every value through 0004, the foreign key and unique index follow the rename, the unfinished upload can still be completed afterwards, and the unique rule still holds (Task 2).
5. **Backwards compatibility and unknown slugs:** every milestone 3 test keeps passing; `music`, `video`, `Videos`, `SONGS`, `constructor`, `__proto__`, `toString` as a category slug are 404 for GET, POST and PUT; audit rows written before this milestone (no `metadata.category`) still read "the video" (Tasks 3, 5).
6. **One link per start in the dock:** exactly one `POST /items/:id/play` per Play, also under React StrictMode; on a load error one fresh link and playback resumes at the same position; a second error shows "This could not be played. Please try again later." with Try again; `playing` re-arms the one retry; Play after the end replays without a new link (Task 7).
7. **Dock lifetime:** the same `<audio>` element keeps playing across route changes; choosing another track replaces it and pauses the old element; Close and signing out remove the element and pause it (Tasks 7, 8).
8. **Unknown lengths:** an audio duration of `NaN`, `Infinity` or 0 gives no length on upload and a disabled seek slider with "—" in the dock (Tasks 6, 7).
9. **Layout:** the page gets bottom space only while the bar shows, the upload panel is lifted above it (class and CSS variable; the visual result is part of the manual check) (Task 8).
10. **Hostile text and secrets:** titles in the dock, audio rows, folder pages and the resume list render as inert text; audit entries of audio uploads contain no key or link; no link reaches `localStorage` or `sessionStorage` (Tasks 4, 5, 7, 9, 10).

---

## File Structure

```
apps/api/
  drizzle/0004_media_categories.sql                  (custom migration, written by hand)
  drizzle/meta/0004_snapshot.json, _journal.json      (generated, snapshot corrected by script)
  src/
    db/schema.ts                                     file_purpose + 'audio'; mediaFileId (media_file_id)
    storage/storage.constants.ts                     + MAX_AUDIO_BYTES, AUDIO_CONTENT_TYPES
    storage/local.storage.ts                         key pattern accepts audio/<uuid>
    media/media-kinds.ts (+ .spec.ts)                MEDIA_KINDS, MEDIA_CATEGORIES, kindOf, categoryFromSlug, uploadFieldErrors
    media/file-checks.ts (+ spec)                    + hasMp3Signature, audioMatches
    media/category.pipe.ts                           :category slug -> database category, else 404
    media/folders.service.ts, media.controller.ts    category-aware folder routes, FolderView.category
    media/items.service.ts, covers.service.ts        ItemView.category, VisibleItem, audit target/metadata
    media/uploads.service.ts, media.schemas.ts       kind from the folder: types, sizes, key prefix, purpose, not_audio
    media/remove-unfinished.ts, upload-cleanup.service.ts   media_file_id, category for audit targets
    audit/audit-presentation.ts (+ media spec)       neutral labels, nouns from metadata.category, not_audio
  test/
    helpers/media.ts                                 seedFolder(category), createFolderViaApi(slug), mp3/m4a bytes
    support/storage-contract.ts                      + audio/ key case
    storage/local-storage.e2e-spec.ts                + audio keys and traversal
    media-migration.e2e-spec.ts                      0004 on a database that already holds media
    media-audio-uploads.e2e-spec.ts                  every category's upload rules end to end
    media-audit.e2e-spec.ts                          audit words per category, old rows, not_audio
apps/web/src/
  styles/tokens.css                                  + --player-height
  uploads/limits.ts, duration.ts, UploadsContext.tsx MEDIA_KINDS, checkMediaFile, readDuration(file, kind), contentType
  uploads/UploadPanel.module.css                     lifted above the bar
  player/PlayerContext.tsx, DockedPlayer.tsx (+ .module.css, spec)   the docked player
  components/AppShell.tsx (+ .module.css, spec)      PlayerProvider + DockedPlayer next to UploadPanel, bottom space
  components/nav-items.ts                            Videos, Movies, Podcasts, Songs
  media/categories.ts                                CATEGORIES (slug, kind, words)
  api/media.ts                                       slug-based folder calls, MediaItem, category fields
  App.tsx (+ App.spec.tsx)                           /:slug and /:slug/:folderId for the four categories
  pages/media/                                       (was pages/videos) CategoryPage, FolderPage, ItemsTable, FolderDialog,
                                                     UploadDialog, EditItemDialog, PlayerDialog, PendingUploads, Media.module.css
docs/ api/media.md, api/audit.md, storage.md; README.md, ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, CHANGELOG.md
```

---

## API tasks (Tasks 1–5)

### Task 1: The kinds table, audio signatures and `audio/` storage keys

**Files:**
- Modify: `apps/api/src/storage/storage.constants.ts`, `apps/api/src/storage/local.storage.ts:12`, `apps/api/src/media/file-checks.ts`
- Create: `apps/api/src/media/media-kinds.ts`
- Test: `apps/api/src/media/file-checks.spec.ts`, `apps/api/src/media/media-kinds.spec.ts` (new), `apps/api/test/support/storage-contract.ts`, `apps/api/test/storage/local-storage.e2e-spec.ts`

**Existing tests to adapt:** none (only additions).

**Interfaces:**
- Consumes: `mediaCategory` (`apps/api/src/db/schema.ts`), `MAX_VIDEO_BYTES`, `VIDEO_CONTENT_TYPE`, `partCountFor` (`storage.constants.ts`), `hasMp4Signature` (`file-checks.ts`).
- Produces:

```ts
// storage.constants.ts
MAX_AUDIO_BYTES = 524_288_000; AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4'] as const
// file-checks.ts
hasMp3Signature(bytes: Uint8Array): boolean
audioMatches(bytes: Uint8Array, contentType: string): boolean
// media-kinds.ts
type MediaCategory = 'video' | 'movie' | 'podcast' | 'song'   // from the database enum
type MediaKind = 'video' | 'audio'
interface KindRule { purpose: MediaKind; keyPrefix: 'videos' | 'audio'; contentTypes: readonly string[]; maxBytes: number;
  typeMessage: string; sizeMessage: string; failureReason: 'not_mp4' | 'not_audio'; matches(bytes: Uint8Array, contentType: string): boolean }
const MEDIA_KINDS: Record<MediaKind, KindRule>
interface CategoryRule { slug: 'videos' | 'movies' | 'podcasts' | 'songs'; kind: MediaKind; noun: string; nounPlural: string; label: string }
const MEDIA_CATEGORIES: Record<MediaCategory, CategoryRule>
kindOf(category: MediaCategory): KindRule
categoryFromSlug(slug: string): MediaCategory | null
uploadFieldErrors(category: MediaCategory, contentType: string, sizeBytes: number): Record<string, string[]> | null
// LocalStorage accepts keys matching ^(videos|audio|covers)/<uuid>$
```

- [ ] **Step 1: Failing unit tests for the signatures and the kinds table**

Add to `apps/api/src/media/file-checks.spec.ts` (change the import line to `import { audioMatches, hasMp3Signature, hasMp4Signature, imageMatches, sanitizeFileName } from './file-checks';` and append these two blocks at the end of the file; `mp4` is the constant already declared at the top):

```ts
describe('hasMp3Signature', () => {
  it.each([
    ['an ID3 tag', [0x49, 0x44, 0x33, 4, 0]],
    ['an MPEG-1 Layer III frame (FF FB)', [0xff, 0xfb, 0x90, 0x64]],
    ['an MPEG-2 frame (FF F3)', [0xff, 0xf3, 0x90, 0x64]],
    ['an MPEG-2.5 frame (FF E3)', [0xff, 0xe3, 0x90, 0x64]],
    ['the smallest frame sync (FF E0)', [0xff, 0xe0]],
  ])('accepts %s', (_name, bytes) => {
    expect(hasMp3Signature(new Uint8Array(bytes))).toBe(true);
  });

  it.each([
    ['a JPEG (FF D8)', [0xff, 0xd8, 0xff, 0xe0]],
    ['FF with only two sync bits (FF C0)', [0xff, 0xc0]],
    ['a lone FF', [0xff]],
    ['nothing', []],
    ['an unfinished ID3 tag', [0x49, 0x44]],
    ['a lower-case id3', [0x69, 0x64, 0x33]],
    ['a frame sync one byte late', [0x00, 0xff, 0xfb]],
    ['a WAV file', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ['an MP4', mp4],
  ])('refuses %s', (_name, bytes) => {
    expect(hasMp3Signature(new Uint8Array(bytes))).toBe(false);
  });
});

describe('audioMatches', () => {
  const mp3 = [0xff, 0xfb, 0x90, 0x64];
  const m4a = [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20];

  it('checks MP3 and M4A each under its own declared type only', () => {
    expect(audioMatches(new Uint8Array(mp3), 'audio/mpeg')).toBe(true);
    expect(audioMatches(new Uint8Array(m4a), 'audio/mp4')).toBe(true);
    expect(audioMatches(new Uint8Array(m4a), 'audio/mpeg')).toBe(false);
    expect(audioMatches(new Uint8Array(mp3), 'audio/mp4')).toBe(false);
  });

  it('refuses every other declared type, including the aliases some systems report', () => {
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav', 'video/mp4', '']) {
      expect(audioMatches(new Uint8Array(m4a), type)).toBe(false);
      expect(audioMatches(new Uint8Array(mp3), type)).toBe(false);
    }
  });
});
```

Create `apps/api/src/media/media-kinds.spec.ts`:

```ts
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';
import { categoryFromSlug, kindOf, MEDIA_CATEGORIES, MEDIA_KINDS, uploadFieldErrors } from './media-kinds';

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

  it('keeps the piece arithmetic: 500 MiB is 32 pieces and 2 GiB is 128', () => {
    expect(partCountFor(MAX_AUDIO_BYTES)).toBe(32);
    expect(partCountFor(MAX_VIDEO_BYTES)).toBe(128);
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
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav']) {
      expect(uploadFieldErrors('podcast', type, 10)).toHaveProperty('contentType');
    }
  });

  it('reports a wrong type and a wrong size together', () => {
    expect(Object.keys(uploadFieldErrors('song', 'video/mp4', 600 * 1024 ** 2) ?? {}).sort()).toEqual(['contentType', 'sizeBytes']);
  });

  it('has the words the folder labels and the audit log use', () => {
    expect(MEDIA_CATEGORIES.song).toEqual({ slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' });
    expect(MEDIA_CATEGORIES.video).toEqual({ slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' });
  });
});
```

Run: `npm test -w @jbf/api -- file-checks media-kinds`
Expected: FAIL (`hasMp3Signature`, `audioMatches` and `./media-kinds` do not exist).

- [ ] **Step 2: Constants and signatures**

Append to `apps/api/src/storage/storage.constants.ts` after the `VIDEO_CONTENT_TYPE` line (keep every existing line):

```ts
export const MAX_AUDIO_BYTES = 500 * 1024 ** 2;
// MP3 and M4A. Raw AAC (ADTS) and other formats are not accepted.
export const AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4'] as const;
```

Append to `apps/api/src/media/file-checks.ts`:

```ts
// An MP3 starts with an ID3 tag, or straight away with an MPEG audio frame: byte 0 is FF and the top three bits of
// byte 1 are set (the frame sync).
export const hasMp3Signature = (bytes: Uint8Array): boolean =>
  startsWith(bytes, 0, ascii('ID3')) || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);

// MP3 by its own signature. An M4A is an MP4 container, so it starts with the same "ftyp" box as a video; the declared
// type and the folder's category decide what is accepted.
export function audioMatches(bytes: Uint8Array, contentType: string): boolean {
  switch (contentType) {
    case 'audio/mpeg':
      return hasMp3Signature(bytes);
    case 'audio/mp4':
      return hasMp4Signature(bytes);
    default:
      return false;
  }
}
```

- [ ] **Step 3: The kinds table**

Create `apps/api/src/media/media-kinds.ts`:

```ts
import type { mediaCategory } from '../db/schema';
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, VIDEO_CONTENT_TYPE } from '../storage/storage.constants';
import { audioMatches, hasMp4Signature } from './file-checks';

export type MediaCategory = (typeof mediaCategory.enumValues)[number];
export type MediaKind = 'video' | 'audio';

// What may be uploaded to a category of this kind, and how a finished upload is checked.
export interface KindRule {
  // The files.purpose of the main file, and the prefix of its random storage key.
  purpose: MediaKind;
  keyPrefix: 'videos' | 'audio';
  contentTypes: readonly string[];
  maxBytes: number;
  typeMessage: string;
  sizeMessage: string;
  // Recorded in file.upload_failed when the first bytes do not match the declared type.
  failureReason: 'not_mp4' | 'not_audio';
  matches: (bytes: Uint8Array, contentType: string) => boolean;
}

// The web app keeps a matching table for its file picker (apps/web/src/uploads/limits.ts); this one is the rule.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    purpose: 'video',
    keyPrefix: 'videos',
    contentTypes: [VIDEO_CONTENT_TYPE],
    maxBytes: MAX_VIDEO_BYTES,
    typeMessage: 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).',
    sizeMessage: 'Videos can be at most 2 GB (MP4).',
    failureReason: 'not_mp4',
    matches: (bytes) => hasMp4Signature(bytes),
  },
  audio: {
    purpose: 'audio',
    keyPrefix: 'audio',
    contentTypes: AUDIO_CONTENT_TYPES,
    maxBytes: MAX_AUDIO_BYTES,
    typeMessage: 'Only MP3 or M4A audio files can be uploaded here.',
    sizeMessage: 'Audio files can be at most 500 MB (MP3 or M4A).',
    failureReason: 'not_audio',
    matches: audioMatches,
  },
};

export interface CategoryRule {
  // The route slug: /api/media/<slug>/folders.
  slug: 'videos' | 'movies' | 'podcasts' | 'songs';
  kind: MediaKind;
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

export const kindOf = (category: MediaCategory): KindRule => MEDIA_KINDS[MEDIA_CATEGORIES[category].kind];

// Own entries only: a slug such as "constructor" or "__proto__" is simply unknown.
export function categoryFromSlug(slug: string): MediaCategory | null {
  return CATEGORY_LIST.find((category) => MEDIA_CATEGORIES[category].slug === slug) ?? null;
}

// The problems with a declared upload for this category, by body field, in plain words; null when it is acceptable.
export function uploadFieldErrors(category: MediaCategory, contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = kindOf(category);
  const errors: Record<string, string[]> = {};
  if (!kind.contentTypes.includes(contentType)) errors.contentType = [kind.typeMessage];
  if (sizeBytes > kind.maxBytes) errors.sizeBytes = [kind.sizeMessage];
  return Object.keys(errors).length > 0 ? errors : null;
}
```

Run: `npm test -w @jbf/api -- file-checks media-kinds`
Expected: PASS.

- [ ] **Step 4: Failing storage tests for `audio/` keys**

In `apps/api/test/support/storage-contract.ts` widen the key helper to `const newKey = (prefix: 'videos' | 'covers' | 'audio' = 'videos'): string => \`${prefix}/${randomUUID()}\`;` and add this case inside `describeStorageContract`, after `'serves a stored object through a temporary read link, including byte ranges'`:

```ts
    it('stores and serves an audio file under an audio/ key', async () => {
      const { storage } = harness;
      const key = newKey('audio');
      const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
      const uploadId = await storage.createMultipartUpload(key, 'audio/mpeg');
      const piece = await uploadPiece(key, uploadId, 1, bytes);
      await storage.completeMultipartUpload(key, uploadId, [piece]);
      expect(await storage.head(key)).toEqual({ size: 6, contentType: 'audio/mpeg' });
      const read = await harness.get(await storage.presignGet(key, 3600, { contentType: 'audio/mpeg' }));
      expect(read.status).toBe(200);
      expect(read.contentType).toMatch(/^audio\/mpeg/);
      expect(Array.from(read.body)).toEqual(Array.from(bytes));
    });
```

In `apps/api/test/storage/local-storage.e2e-spec.ts`, inside `describe('LocalStorage development routes', ...)`, after `'refuses keys that could escape the storage folder'`, add:

```ts
  it('accepts audio keys and still refuses audio-looking keys that could escape or are not exact', async () => {
    const k = `audio/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(k, 'audio/mpeg');
    await storage.abortMultipartUpload(k, uploadId);
    await expect(storage.head('audio/../videos/x')).rejects.toThrow('Invalid storage key');
    await expect(storage.presignGet(`audio/${randomUUID()}/../../x`, 60, { contentType: 'audio/mpeg' })).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`audios/${randomUUID()}`, 'audio/mpeg')).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`AUDIO/${randomUUID()}`, 'audio/mpeg')).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload('audio/not-a-uuid', 'audio/mpeg')).rejects.toThrow('Invalid storage key');
  });
```

Run: `npm test -w @jbf/api -- local-storage in-memory-storage`
Expected: the in-memory contract passes (it has no key rule); the LocalStorage contract case and the new local case FAIL with `Invalid storage key`.

- [ ] **Step 5: Accept `audio/` keys in the local driver**

In `apps/api/src/storage/local.storage.ts` change line 12 to:

```ts
const KEY_PATTERN = new RegExp(`^(videos|audio|covers)/${UUID}$`);
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS, including the new `file-checks`, `media-kinds`, contract (both drivers) and local-storage cases. `MEDIA_CATEGORIES`, `categoryFromSlug`, `uploadFieldErrors` and the `KindRule` fields are consumed by Tasks 3–5; lint does not flag unused exports.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/storage apps/api/src/media/file-checks.ts apps/api/src/media/file-checks.spec.ts apps/api/src/media/media-kinds.ts apps/api/src/media/media-kinds.spec.ts apps/api/test/support/storage-contract.ts apps/api/test/storage/local-storage.e2e-spec.ts
git commit -m "feat: add the media kinds table, MP3 and M4A checks and audio storage keys"
```

---

### Task 2: Migration 0004 (rename `video_file_id`, add the `audio` purpose) tested on existing data

**Files:**
- Modify: `apps/api/src/db/schema.ts:117,170-172,183`, `apps/api/src/media/items.service.ts`, `apps/api/src/media/uploads.service.ts`, `apps/api/src/media/remove-unfinished.ts`
- Create: `apps/api/drizzle/0004_media_categories.sql`, `apps/api/drizzle/meta/0004_snapshot.json` (generated), journal entry (generated)
- Test: `apps/api/test/media-migration.e2e-spec.ts` (new)

**Existing tests to adapt (mechanical rename only):** `apps/api/test/helpers/media.ts:95` (`videoFileId` → `mediaFileId`), `apps/api/test/media-schema.e2e-spec.ts:54` (`videoFileId` → `mediaFileId`).

**Interfaces:**
- Consumes: `runMigrations` (`src/db/migrate.ts`), `createTestApp`, `createUser`, `loginMobile`, `bearer`, `putPieces`, `completeViaApi`, `mp4Bytes`, `pngBytes` (test helpers), `PART_SIZE`.
- Produces: `mediaItems.mediaFileId` (column `media_file_id`, unique index `media_items_media_file_unique`, foreign key `media_items_media_file_id_files_id_fk`); `filePurpose` values `['video', 'cover', 'audio']`; `removeUnfinishedItem(tx, mediaFileId)` (parameter renamed only). In `items.service.ts` the joined main file is selected as `media` (was `video`).

- [ ] **Step 1: The failing migration test**

Create `apps/api/test/media-migration.e2e-spec.ts`. It builds its own database, migrates it only to 0003, writes milestone 3 rows with plain SQL (the current schema code no longer matches that state), then applies 0004 and checks that everything still works through the API.

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
import { runMigrations } from '../src/db/migrate';
import type { User } from '../src/db/schema';
import { PART_SIZE } from '../src/storage/storage.constants';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { completeViaApi, mp4Bytes, pngBytes, putPieces } from './helpers/media';
import { createUser } from './helpers/users';
import type { InMemoryStorage } from './support/in-memory-storage';

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

describe('migration 0004 on a database that already holds videos, covers and an upload in progress', () => {
  const originalUrl = process.env.DATABASE_URL;
  let app: NestExpressApplication;
  let storage: InMemoryStorage;
  let sql: Pool;
  let owner: User;
  let session: Session;
  const ids = { folder: '', readyItem: '', readyFile: '', cover: '', pendingItem: '', pendingFile: '' };

  const insertFile = async (purpose: 'video' | 'cover', key: string, contentType: string, size: number, pending: { uploadId: string } | null) => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into files (purpose, storage_key, original_name, content_type, size_bytes, status, upload_id, part_size, part_count, uploaded_by, completed_at)
       values ($1, $2, 'old.mp4', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [purpose, key, contentType, size, pending ? 'pending' : 'ready', pending?.uploadId ?? null, pending ? PART_SIZE : null, pending ? 1 : null, owner.id, pending ? null : new Date()],
    );
    return rows[0].id;
  };

  const insertItem = async (title: string, fileId: string, coverId: string | null, status: 'ready' | 'uploading') => {
    const { rows } = await sql.query<{ id: string }>(
      `insert into media_items (folder_id, title, position, video_file_id, cover_file_id, status, created_by)
       values ($1, $2, 0, $3, $4, $5, $6) returning id`,
      [ids.folder, title, fileId, coverId, status, owner.id],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    await recreateDatabase(false);
    await migrateUpTo(3);
    process.env.DATABASE_URL = databaseUrl.toString();
    const created = await createTestApp();
    app = created.app;
    storage = created.storage;
    sql = new Pool({ connectionString: databaseUrl.toString() });
    owner = await createUser(created.db);
    session = await loginMobile(app, owner.email);

    ids.folder = (await sql.query<{ id: string }>(`insert into media_folders (category, name, position, created_by) values ('video', 'Old folder', 0, $1) returning id`, [owner.id])).rows[0].id;

    const readyKey = `videos/${randomUUID()}`;
    storage.seed(readyKey, mp4Bytes(64), 'video/mp4');
    ids.readyFile = await insertFile('video', readyKey, 'video/mp4', 64, null);
    const coverKey = `covers/${randomUUID()}`;
    storage.seed(coverKey, pngBytes(64), 'image/png');
    ids.cover = await insertFile('cover', coverKey, 'image/png', 64, null);
    ids.readyItem = await insertItem('Old ready video', ids.readyFile, ids.cover, 'ready');

    const pendingKey = `videos/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(pendingKey, 'video/mp4');
    ids.pendingFile = await insertFile('video', pendingKey, 'video/mp4', 100, { uploadId });
    ids.pendingItem = await insertItem('Old unfinished video', ids.pendingFile, null, 'uploading');

    await runMigrations(databaseUrl.toString());
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    process.env.DATABASE_URL = originalUrl;
    await recreateDatabase(true);
  });

  const http = () => request(app.getHttpServer());

  it('renames the column and keeps every value, with the foreign key and unique index renamed too', async () => {
    const columns = (await sql.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'media_items'`)).rows.map(
      (row) => row.column_name,
    );
    expect(columns).toContain('media_file_id');
    expect(columns).not.toContain('video_file_id');
    const { rows } = await sql.query(`select id, media_file_id, cover_file_id, status from media_items order by title`);
    expect(rows).toEqual([
      { id: ids.readyItem, media_file_id: ids.readyFile, cover_file_id: ids.cover, status: 'ready' },
      { id: ids.pendingItem, media_file_id: ids.pendingFile, cover_file_id: null, status: 'uploading' },
    ]);
    const keys = (await sql.query<{ conname: string }>(`select conname from pg_constraint where conrelid = 'media_items'::regclass and contype = 'f'`)).rows.map(
      (row) => row.conname,
    );
    expect(keys).toContain('media_items_media_file_id_files_id_fk');
    expect(keys).not.toContain('media_items_video_file_id_files_id_fk');
    const indexes = (await sql.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'media_items'`)).rows.map((row) => row.indexname);
    expect(indexes).toContain('media_items_media_file_unique');
    expect(indexes).not.toContain('media_items_video_file_unique');
    const purposes = (await sql.query<{ value: string }>(`select unnest(enum_range(null::file_purpose))::text as value`)).rows.map((row) => row.value);
    expect(purposes).toEqual(['video', 'cover', 'audio']);
  });

  it('still lists and plays the ready video with its cover', async () => {
    const list = await http().get(`/api/media/folders/${ids.folder}/items`).set(...bearer(session)).expect(200);
    const ready = list.body.find((item: { id: string }) => item.id === ids.readyItem);
    expect(ready).toMatchObject({ title: 'Old ready video', status: 'ready', sizeBytes: 64, coverUrl: expect.stringMatching(/^memory:\/\/get\//) });
    const play = await http().post(`/api/media/items/${ids.readyItem}/play`).set(...bearer(session)).expect(200);
    expect(play.body.contentType).toBe('video/mp4');
  });

  it('can still finish the upload that was in progress before the migration', async () => {
    const parts = await putPieces(app, storage, session, ids.pendingFile, mp4Bytes(100));
    const res = await completeViaApi(app, session, ids.pendingFile, parts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.pendingItem, status: 'ready', sizeBytes: 100 });
    const { rows } = await sql.query(`select status, upload_id from files where id = $1`, [ids.pendingFile]);
    expect(rows).toEqual([{ status: 'ready', upload_id: null }]);
  });

  it('still refuses a second item for the same file', async () => {
    await expect(
      sql.query(`insert into media_items (folder_id, title, position, media_file_id, status, created_by) values ($1, 'Copy', 1, $2, 'ready', $3)`, [
        ids.folder,
        ids.readyFile,
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

Run: `npm test -w @jbf/api -- media-migration`
Expected: FAIL (the first test finds `video_file_id`; there is no migration 0004 yet).

- [ ] **Step 2: Schema**

In `apps/api/src/db/schema.ts`:

```ts
export const filePurpose = pgEnum('file_purpose', ['video', 'cover', 'audio']);
```

and in `mediaItems` replace the `videoFileId` column and the unique index:

```ts
    // The main file of the item: a video (videos, movies) or an audio file (podcasts, songs).
    mediaFileId: uuid('media_file_id')
      .notNull()
      .references(() => files.id),
```

```ts
    uniqueIndex('media_items_media_file_unique').on(table.mediaFileId),
```

- [ ] **Step 3: The migration, written by hand (a generated one would drop and recreate the column)**

```bash
cd apps/api
npx drizzle-kit generate --custom --name=media_categories
```

Expected: `Prepared empty file for your custom SQL migration!` and `drizzle/0004_media_categories.sql`, `drizzle/meta/0004_snapshot.json` and a fifth journal entry with tag `0004_media_categories`. Replace the content of `drizzle/0004_media_categories.sql` with exactly:

```sql
ALTER TYPE "public"."file_purpose" ADD VALUE 'audio';--> statement-breakpoint
ALTER TABLE "media_items" RENAME COLUMN "video_file_id" TO "media_file_id";--> statement-breakpoint
ALTER TABLE "media_items" RENAME CONSTRAINT "media_items_video_file_id_files_id_fk" TO "media_items_media_file_id_files_id_fk";--> statement-breakpoint
ALTER INDEX "media_items_video_file_unique" RENAME TO "media_items_media_file_unique";
```

PostgreSQL 17 allows `ADD VALUE` inside the migrator's transaction because nothing in the same transaction uses the new value.

A custom migration's snapshot is a copy of the previous one, so correct it to describe the new schema (still in `apps/api`):

```bash
node - <<'EOF'
const fs = require('node:fs');
const path = 'drizzle/meta/0004_snapshot.json';
const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
const table = snapshot.tables['public.media_items'];
const renameKey = (record, from, to, change) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => (key === from ? [to, change(value)] : [key, value])));
table.columns = renameKey(table.columns, 'video_file_id', 'media_file_id', (column) => ({ ...column, name: 'media_file_id' }));
table.indexes = renameKey(table.indexes, 'media_items_video_file_unique', 'media_items_media_file_unique', (index) => ({
  ...index,
  name: 'media_items_media_file_unique',
  columns: index.columns.map((column) => ({ ...column, expression: 'media_file_id' })),
}));
table.foreignKeys = renameKey(table.foreignKeys, 'media_items_video_file_id_files_id_fk', 'media_items_media_file_id_files_id_fk', (key) => ({
  ...key,
  name: 'media_items_media_file_id_files_id_fk',
  columnsFrom: ['media_file_id'],
}));
snapshot.enums['public.file_purpose'].values = ['video', 'cover', 'audio'];
fs.writeFileSync(path, JSON.stringify(snapshot, null, 2));
EOF
npx drizzle-kit generate
cd ../..
```

Expected from the last command: `No schema changes, nothing to migrate 😴` (the snapshot now matches `schema.ts`). If it prints anything else, the snapshot correction is wrong; fix it, never commit a second generated migration. Do not edit `0000`–`0003` or their snapshots.

- [ ] **Step 4: The mechanical rename in code and tests**

```bash
grep -rl videoFileId apps/api/src apps/api/test | xargs sed -i '' 's/videoFileId/mediaFileId/g'
grep -rn "videoFileId\|video_file_id" apps/api/src apps/api/test | grep -v "test/media-migration.e2e-spec.ts"
```

Expected: the second command prints nothing (the migration test is the only file that must still name the old column: it writes milestone 3 rows and checks the rename). The files changed are `src/media/items.service.ts`, `src/media/uploads.service.ts`, `src/media/remove-unfinished.ts`, `test/helpers/media.ts` and `test/media-schema.e2e-spec.ts`. Then, in `apps/api/src/media/items.service.ts`, rename the joined main file from `video` to `media` (it is no longer always a video):

```ts
interface ItemRow {
  item: MediaItem;
  media: FileRow;
  cover: FileRow | null;
  creator: { id: string; name: string };
}
```

```ts
      .select({ item: mediaItems, media: files, cover: coverFile, creator: { id: users.id, name: users.name } })
```

and replace the three uses `row.video.storageKey`, `row.video.contentType` (twice) and `row.video.sizeBytes` with `row.media.storageKey`, `row.media.contentType` and `row.media.sizeBytes`. In `apps/api/src/media/remove-unfinished.ts` update the comment above `removeUnfinishedItem` to say "an unfinished item with its media file row and its cover" (the parameter is already `mediaFileId` after the sed).

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS, including the four `media-migration` tests and every milestone 1–3 test. If the migration test cannot create `jbf_lms_migration_test`, the local PostgreSQL user lacks `CREATEDB`; report it rather than skipping the test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle apps/api/src apps/api/test
git commit -m "feat: rename the media file column and add the audio file purpose"
```

---

### Task 3: Category-aware folder routes, and `category` in folder and item responses

**Files:**
- Create: `apps/api/src/media/category.pipe.ts`
- Modify: `apps/api/src/media/folders.service.ts`, `apps/api/src/media/media.controller.ts`, `apps/api/src/media/items.service.ts`
- Test: `apps/api/test/helpers/media.ts`, `apps/api/test/media-folders.e2e-spec.ts`, `apps/api/test/media-items.e2e-spec.ts`

**Existing tests to adapt:** `apps/api/test/media-folders.e2e-spec.ts:38` (the exact folder object gains `category: 'video'`), `apps/api/test/media-items.e2e-spec.ts:46-58` (the exact item object gains `category: 'video'`). Nothing else changes; every `/api/media/videos/...` call stays as it is.

**Interfaces:**
- Consumes: `MediaCategory`, `MEDIA_CATEGORIES`, `categoryFromSlug` (Task 1); `mediaItems.mediaFileId` (Task 2).
- Produces:

```ts
// category.pipe.ts
class CategoryPipe implements PipeTransform<string, MediaCategory>   // unknown slug -> 404 'Not found.'
// folders.service.ts
interface FolderView { id: string; name: string; position: number; itemCount: number; category: MediaCategory }
class FoldersService { list(category: MediaCategory, executor?: DbExecutor): Promise<FolderView[]>;
  create(actor: AuthUser, category: MediaCategory, name: string): Promise<FolderView>;
  rename(actor: AuthUser, id: string, name: string): Promise<FolderView>;
  reorder(actor: AuthUser, category: MediaCategory, ids: string[]): Promise<FolderView[]> }
// items.service.ts
interface ItemView { ...milestone 3 fields...; category: MediaCategory }
// HTTP: GET/POST /api/media/:category/folders, PUT /api/media/:category/folders/order (videos|movies|podcasts|songs)
// Audit: content.folder.created/renamed/reordered carry metadata { category }; reordered target { type: 'category', id: category, label: '<Label> folders' }
// test/helpers/media.ts
type CategorySlug = 'videos' | 'movies' | 'podcasts' | 'songs'
createFolderViaApi(app, session, name = uniqueName(), slug: CategorySlug = 'videos'): Promise<{ id; name; position; itemCount; category }>
seedFolder(db, createdBy, name = uniqueName(), category: MediaCategory = 'video'): Promise<MediaFolder>
```

- [ ] **Step 1: Helpers and failing tests**

In `apps/api/test/helpers/media.ts` add `import type { MediaCategory } from '../../src/media/media-kinds';` and replace `createFolderViaApi` and `seedFolder` with:

```ts
export type CategorySlug = 'videos' | 'movies' | 'podcasts' | 'songs';

export async function createFolderViaApi(
  app: INestApplication,
  session: Session,
  name = uniqueName(),
  slug: CategorySlug = 'videos',
): Promise<{ id: string; name: string; position: number; itemCount: number; category: string }> {
  const res = await request(app.getHttpServer()).post(`/api/media/${slug}/folders`).set(...bearer(session)).send({ name }).expect(201);
  return res.body;
}

export async function seedFolder(db: Database, createdBy: string, name = uniqueName(), category: MediaCategory = 'video'): Promise<MediaFolder> {
  const [folder] = await db.insert(mediaFolders).values({ category, name, position: 0, createdBy }).returning();
  return folder;
}
```

In `apps/api/test/media-folders.e2e-spec.ts` change the import of drizzle to `import { and, desc, eq } from 'drizzle-orm';`, change line 38 to:

```ts
    expect(first).toEqual({ id: expect.any(String), name: expect.any(String), position: expect.any(Number), itemCount: 0, category: 'video' });
```

and add this block at the end of the outer `describe`:

```ts
  describe('categories', () => {
    it.each([
      ['videos', 'video'],
      ['movies', 'movie'],
      ['podcasts', 'podcast'],
      ['songs', 'song'],
    ] as const)('creates, lists, renames and reorders %s folders, each marked with its category', async (slug, category) => {
      const { session } = await signIn(app, db);
      const first = await createFolderViaApi(app, session, uniqueName(), slug);
      await createFolderViaApi(app, session, uniqueName(), slug);
      expect(first).toEqual({ id: expect.any(String), name: expect.any(String), position: expect.any(Number), itemCount: 0, category });
      const list = (await http().get(`/api/media/${slug}/folders`).set(...bearer(session)).expect(200)).body as { id: string; category: string }[];
      expect(list.map((folder) => folder.id)).toContain(first.id);
      expect(new Set(list.map((folder) => folder.category))).toEqual(new Set([category]));
      const renamed = await http().patch(`/api/media/folders/${first.id}`).set(...bearer(session)).send({ name: uniqueName('Renamed') }).expect(200);
      expect(renamed.body.category).toBe(category);
      const reversed = list.map((folder) => folder.id).reverse();
      const reordered = await http().put(`/api/media/${slug}/folders/order`).set(...bearer(session)).send({ ids: reversed }).expect(200);
      expect(reordered.body.map((folder: { id: string }) => folder.id)).toEqual(reversed);
    });

    it("keeps each category's folders apart, and lets the same name exist in two categories", async () => {
      const { session } = await signIn(app, db);
      const name = uniqueName('Shared');
      const song = await createFolderViaApi(app, session, name, 'songs');
      const movie = await createFolderViaApi(app, session, name, 'movies');
      const songs = ((await http().get('/api/media/songs/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id);
      const videos = ((await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id);
      expect(songs).toContain(song.id);
      expect(songs).not.toContain(movie.id);
      expect(videos).not.toContain(song.id);
      expect(videos).not.toContain(movie.id);
      await http().post('/api/media/songs/folders').set(...bearer(session)).send({ name: name.toUpperCase() }).expect(409);
    });

    it('answers 404 for any other category, after checking sign-in', async () => {
      const { session } = await signIn(app, db);
      for (const slug of ['music', 'video', 'Videos', 'SONGS', 'constructor', '__proto__', 'toString', 'folders']) {
        await http().get(`/api/media/${slug}/folders`).set(...bearer(session)).expect(404);
        await http().post(`/api/media/${slug}/folders`).set(...bearer(session)).send({ name: uniqueName() }).expect(404);
        await http().put(`/api/media/${slug}/folders/order`).set(...bearer(session)).send({ ids: [] }).expect(404);
      }
      await http().get('/api/media/music/folders').expect(401);
    });

    it('records the category of every folder change and names it in a reorder', async () => {
      const { user, session } = await signIn(app, db);
      const created = await createFolderViaApi(app, session, uniqueName(), 'podcasts');
      const [entry] = await auditFor('content.folder.created', created.id);
      expect(entry).toMatchObject({ actorId: user.id, targetType: 'folder', metadata: { category: 'podcast' } });
      await http().patch(`/api/media/folders/${created.id}`).set(...bearer(session)).send({ name: uniqueName('Renamed') }).expect(200);
      expect((await auditFor('content.folder.renamed', created.id))[0].metadata).toEqual({ category: 'podcast' });
      await createFolderViaApi(app, session, uniqueName(), 'podcasts');
      const ids = ((await http().get('/api/media/podcasts/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id).reverse();
      await http().put('/api/media/podcasts/folders/order').set(...bearer(session)).send({ ids }).expect(200);
      const [reordered] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'content.folder.reordered'), eq(auditLog.targetId, 'podcast')))
        .orderBy(desc(auditLog.occurredAt))
        .limit(1);
      expect(reordered).toMatchObject({ actorId: user.id, targetType: 'category', targetLabel: 'Podcast folders', metadata: { category: 'podcast' } });
    });
  });
```

In `apps/api/test/media-items.e2e-spec.ts` change the helper import to `import { seedFolder, seedItem, signIn, uniqueName } from './helpers/media';`, add `category: 'video',` to the exact object at line 46 (after `position: 0,`), and add this test at the end of the `describe`:

```ts
  it('says which category an item belongs to, from its folder', async () => {
    const { owner } = await setup();
    const songs = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    const { itemId } = await seedItem(db, { folderId: songs.id, createdBy: owner.user.id, storage });
    const res = await http().get(`/api/media/folders/${songs.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ id: itemId, category: 'song' })]);
    const edited = await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ title: 'New' }).expect(200);
    expect(edited.body.category).toBe('song');
  });
```

Run: `npm test -w @jbf/api -- media-folders media-items`
Expected: FAIL (no `/:category` routes, no `category` field).

- [ ] **Step 2: The category pipe**

Create `apps/api/src/media/category.pipe.ts`:

```ts
import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { categoryFromSlug, type MediaCategory } from './media-kinds';

// Turns the route's category slug (videos, movies, podcasts, songs) into the database category. Anything else is
// not a page that exists, so it is a 404.
@Injectable()
export class CategoryPipe implements PipeTransform<string, MediaCategory> {
  transform(value: string): MediaCategory {
    const category = categoryFromSlug(value);
    if (!category) throw new NotFoundException('Not found.');
    return category;
  }
}
```

- [ ] **Step 3: The folders service**

Replace `apps/api/src/media/folders.service.ts` with:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { mediaFolders, mediaItems } from '../db/schema';
import { actorOf } from './actor';
import { MEDIA_CATEGORIES, type MediaCategory } from './media-kinds';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';

const NAME_TAKEN = 'A folder with that name already exists.';

export interface FolderView {
  id: string;
  name: string;
  position: number;
  itemCount: number;
  category: MediaCategory;
}

@Injectable()
export class FoldersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(category: MediaCategory, executor: DbExecutor = this.db): Promise<FolderView[]> {
    return executor
      .select({
        id: mediaFolders.id,
        name: mediaFolders.name,
        position: mediaFolders.position,
        itemCount: sql<number>`count(${mediaItems.id}) filter (where ${mediaItems.status} = 'ready')`.mapWith(Number),
        category: mediaFolders.category,
      })
      .from(mediaFolders)
      .leftJoin(mediaItems, eq(mediaItems.folderId, mediaFolders.id))
      .where(eq(mediaFolders.category, category))
      .groupBy(mediaFolders.id)
      .orderBy(asc(mediaFolders.position), asc(mediaFolders.createdAt), asc(mediaFolders.id));
  }

  create(actor: AuthUser, category: MediaCategory, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mediaFolders.position}), -1) + 1`.mapWith(Number) })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, category));
      let folder;
      try {
        [folder] = await tx.insert(mediaFolders).values({ category, name, position: next, createdBy: actor.id }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
        throw error;
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.folder.created',
        target: { type: 'folder', id: folder.id, label: folder.name },
        metadata: { category },
      });
      return { id: folder.id, name: folder.name, position: folder.position, itemCount: 0, category };
    });
  }

  rename(actor: AuthUser, id: string, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [folder] = await tx.select().from(mediaFolders).where(eq(mediaFolders.id, id)).for('update');
      if (!folder) throw new NotFoundException('Folder not found.');
      if (folder.name !== name) {
        try {
          await tx.update(mediaFolders).set({ name, updatedAt: new Date() }).where(eq(mediaFolders.id, id));
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
          throw error;
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.folder.renamed',
          target: { type: 'folder', id, label: name },
          changes: { name: { before: folder.name, after: name } },
          metadata: { category: folder.category },
        });
      }
      const view = (await this.list(folder.category, tx)).find((candidate) => candidate.id === id);
      if (!view) throw new NotFoundException('Folder not found.');
      return view;
    });
  }

  reorder(actor: AuthUser, category: MediaCategory, ids: string[]): Promise<FolderView[]> {
    return this.db.transaction(async (tx) => {
      // Locked in id order so two people reordering at once cannot deadlock.
      const locked = await tx
        .select({ id: mediaFolders.id, position: mediaFolders.position, createdAt: mediaFolders.createdAt })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, category))
        .orderBy(asc(mediaFolders.id))
        .for('update');
      const current = [...locked]
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((folder) => folder.id);
      const known = new Set(current);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new ConflictException(ORDER_CHANGED_MESSAGE);
      }
      if (ids.some((id, index) => id !== current[index])) {
        for (const [index, id] of ids.entries()) {
          await tx.update(mediaFolders).set({ position: index, updatedAt: new Date() }).where(eq(mediaFolders.id, id));
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.folder.reordered',
          target: { type: 'category', id: category, label: `${MEDIA_CATEGORIES[category].label} folders` },
          metadata: { category },
        });
      }
      return this.list(category, tx);
    });
  }
}
```

(For videos the reordered target stays `{ type: 'category', id: 'video', label: 'Video folders' }`, exactly as in milestone 3.)

- [ ] **Step 4: The controller**

In `apps/api/src/media/media.controller.ts` add `import { CategoryPipe } from './category.pipe';` and `import type { MediaCategory } from './media-kinds';`, then replace the three video-folder routes with:

```ts
  @Get(':category/folders')
  listFolders(@Param('category', CategoryPipe) category: MediaCategory): Promise<FolderView[]> {
    return this.folders.list(category);
  }

  @Post(':category/folders')
  createFolder(
    @CurrentUser() actor: AuthUser,
    @Param('category', CategoryPipe) category: MediaCategory,
    @Body(new ZodPipe(folderBodySchema)) body: z.infer<typeof folderBodySchema>,
  ): Promise<FolderView> {
    return this.folders.create(actor, category, body.name);
  }

  @Put(':category/folders/order')
  reorderFolders(
    @CurrentUser() actor: AuthUser,
    @Param('category', CategoryPipe) category: MediaCategory,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<FolderView[]> {
    return this.folders.reorder(actor, category, body.ids);
  }
```

These do not collide with the other routes: `folders/:id` is PATCH only, `folders/:id/items` and `folders/:id/items/order` have more path segments, and `items/...` routes have three segments.

- [ ] **Step 5: `category` in item responses**

In `apps/api/src/media/items.service.ts` add `import type { MediaCategory } from './media-kinds';`, add `category: MediaCategory;` as the last field of `ItemView` and of `ItemRow`, and change `rows()` and the end of `toView()`:

```ts
  private rows(executor: DbExecutor, where: SQL | undefined): Promise<ItemRow[]> {
    return executor
      .select({ item: mediaItems, media: files, cover: coverFile, creator: { id: users.id, name: users.name }, category: mediaFolders.category })
      .from(mediaItems)
      .innerJoin(files, eq(files.id, mediaItems.mediaFileId))
      .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .leftJoin(coverFile, eq(coverFile.id, mediaItems.coverFileId))
      .innerJoin(users, eq(users.id, mediaItems.createdBy))
      .where(where)
      .orderBy(asc(mediaItems.position), asc(mediaItems.createdAt), asc(mediaItems.id));
  }
```

```ts
      createdAt: row.item.createdAt,
      position: row.item.position,
      category: row.category,
    };
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (media-folders gains 7 tests, media-items 1). `POST /api/media/uploads` still accepts video folders only until Task 4.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/media apps/api/test/helpers/media.ts apps/api/test/media-folders.e2e-spec.ts apps/api/test/media-items.e2e-spec.ts
git commit -m "feat: serve folders for every media category and name the category in responses"
```

---

### Task 4: Uploads for every category: the folder's kind decides types, sizes, keys and checks

**Files:**
- Modify: `apps/api/src/media/media.schemas.ts`, `apps/api/src/media/uploads.service.ts`, `apps/api/src/media/remove-unfinished.ts`, `apps/api/src/media/upload-cleanup.service.ts`
- Test: `apps/api/src/media/media.schemas.spec.ts`, `apps/api/test/helpers/media.ts`, `apps/api/test/media-audio-uploads.e2e-spec.ts` (new)

**Existing tests to adapt:** none. The milestone 3 upload tests keep passing unchanged: a non-MP4 type or a size over 2 GiB in a video folder is still a 400 with `fieldErrors.contentType` / `fieldErrors.sizeBytes` (now from the service instead of the schema, same body shape), a blank type is still refused by the schema, an unknown folder is still 404.

**Interfaces:**
- Consumes: `kindOf`, `uploadFieldErrors`, `MediaCategory` (Task 1); `filePurpose` with `audio`, `mediaItems.mediaFileId` (Task 2); `ItemView.category` (Task 3); `seedFolder(..., category)` (Task 3).
- Produces:

```ts
// media.schemas.ts: startUploadSchema.contentType is any non-empty string (max 100, no NUL); sizeBytes is a positive safe integer.
// uploads.service.ts
type UploadRow = { file: FileRow; item: MediaItem; category: MediaCategory }
// POST /uploads: 404 unknown folder; 400 { message: 'Validation failed', fieldErrors: { contentType?, sizeBytes? } } from uploadFieldErrors;
//   key `${kind.keyPrefix}/<uuid>`, files.purpose = kind.purpose, files.content_type = declared type.
// complete: stored type must equal the declared type and kind.matches(firstBytes, declaredType); else 422 with
//   FAILURE_MESSAGES[kind.failureReason]; not_audio message:
//   'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.'
// load / mine: any purpose except 'cover'. Audit target of upload entries: { type: category, id: itemId, label: title };
//   content.video.added metadata { folderId, category }.
// remove-unfinished.ts
interface RemovedUnfinished { item: { id: string; title: string; category: MediaCategory }; cover: Pick<FileRow, 'id' | 'storageKey'> | null }
// test/helpers/media.ts
mp3Bytes(size = 64): Uint8Array; mp3FrameBytes(secondByte: number, size = 64): Uint8Array; m4aBytes(size = 64): Uint8Array
```

- [ ] **Step 1: Helpers and failing tests**

Append to the byte helpers in `apps/api/test/helpers/media.ts` (after `webpBytes`):

```ts
export const mp3Bytes = (size = 64): Uint8Array => bytes(size, [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
export const mp3FrameBytes = (secondByte: number, size = 64): Uint8Array => bytes(size, [0xff, secondByte, 0x90, 0x64]);
export const m4aBytes = (size = 64): Uint8Array => bytes(size, [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
```

Add to `apps/api/src/media/media.schemas.spec.ts`:

```ts
  it('leaves the allowed type and size to the folder, but refuses a missing or NUL type and an empty file', () => {
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: 'audio/mpeg', sizeBytes: 524_288_001 }).success).toBe(true);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 3 * 1024 ** 3 }).success).toBe(true);
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: '' }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: 'audio/mpeg\u0000' }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 0 }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 2 ** 60 }).success).toBe(false);
  });
```

Create `apps/api/test/media-audio-uploads.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from '../src/storage/storage.constants';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import {
  attachCoverViaApi,
  completeViaApi,
  jpegBytes,
  m4aBytes,
  mp3Bytes,
  mp3FrameBytes,
  mp4Bytes,
  putPieces,
  seedFolder,
  signIn,
  startUploadViaApi,
  uniqueName,
  uploadVideo,
} from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;
const MP3 = { contentType: 'audio/mpeg', fileName: 'song.mp3' };
const M4A = { contentType: 'audio/mp4', fileName: 'talk.m4a' };
const NOT_AUDIO = 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.';
const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);

describe('uploading to every media category', () => {
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
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];
  const start = (session: Session, folderId: string, overrides: object) =>
    http()
      .post('/api/media/uploads')
      .set(...bearer(session))
      .send({ folderId, title: 'T', fileName: 'a.bin', contentType: 'audio/mpeg', sizeBytes: 100, ...overrides });

  async function setup() {
    const owner = await signIn(app, db);
    return {
      owner,
      songs: await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song'),
      podcasts: await seedFolder(db, owner.user.id, uniqueName('Podcasts'), 'podcast'),
      movies: await seedFolder(db, owner.user.id, uniqueName('Movies'), 'movie'),
      videos: await seedFolder(db, owner.user.id, uniqueName('Videos')),
    };
  }

  describe('starting', () => {
    it('stores a song as an audio file under a random audio/ key that never uses the file name', async () => {
      const { owner, songs } = await setup();
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, fileName: '../../etc/passwd.mp3', sizeBytes: 100 });
      expect(started.partCount).toBe(1);
      const row = await fileRow(started.fileId);
      expect(row).toMatchObject({ purpose: 'audio', contentType: 'audio/mpeg', status: 'pending', originalName: 'etc passwd.mp3' });
      expect(row.storageKey).toMatch(/^audio\/[0-9a-f-]{36}$/);
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'song' });
      expect(JSON.stringify(entry)).not.toContain(row.storageKey);
    });

    it.each([
      ['song', 'songs', 'audio/mpeg', MAX_AUDIO_BYTES, 32],
      ['podcast', 'podcasts', 'audio/mp4', MAX_AUDIO_BYTES, 32],
      ['movie', 'movies', 'video/mp4', MAX_VIDEO_BYTES, 128],
    ] as const)('accepts a %s of exactly the largest size', async (_name, key, contentType, sizeBytes, partCount) => {
      const folders = await setup();
      const started = await startUploadViaApi(app, folders.owner.session, folders[key].id, { contentType, sizeBytes });
      expect(started.partCount).toBe(partCount);
    });

    it.each([
      ['a song one byte over 500 MB', 'songs', { contentType: 'audio/mpeg', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB \(MP3 or M4A\)/],
      ['a podcast one byte over 500 MB', 'podcasts', { contentType: 'audio/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }, 'sizeBytes', /500 MB/],
      ['a movie one byte over 2 GB', 'movies', { contentType: 'video/mp4', sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes', /2 GB \(MP4\)/],
      ['an empty song', 'songs', { contentType: 'audio/mpeg', sizeBytes: 0 }, 'sizeBytes', /empty/],
      ['an MP4 video in Songs', 'songs', { contentType: 'video/mp4' }, 'contentType', /MP3 or M4A/],
      ['an MP4 video in Podcasts', 'podcasts', { contentType: 'video/mp4' }, 'contentType', /MP3 or M4A/],
      ['an MP3 in Videos', 'videos', { contentType: 'audio/mpeg' }, 'contentType', /MP4.*HandBrake/],
      ['an M4A in Movies', 'movies', { contentType: 'audio/mp4' }, 'contentType', /MP4.*HandBrake/],
      ['the audio/x-m4a alias', 'songs', { contentType: 'audio/x-m4a' }, 'contentType', /MP3 or M4A/],
      ['the audio/mp3 alias', 'songs', { contentType: 'audio/mp3' }, 'contentType', /MP3 or M4A/],
      ['raw AAC', 'songs', { contentType: 'audio/aac' }, 'contentType', /MP3 or M4A/],
      ['a WAV file', 'podcasts', { contentType: 'audio/wav' }, 'contentType', /MP3 or M4A/],
    ] as const)('refuses %s in plain words and creates nothing', async (_name, key, overrides, field, message) => {
      const folders = await setup();
      const pending = storage.pendingUploadCount();
      const res = await start(folders.owner.session, folders[key].id, overrides).expect(400);
      expect(res.body.fieldErrors[field][0]).toMatch(message);
      expect(storage.pendingUploadCount()).toBe(pending);
      expect(await db.select().from(mediaItems).where(eq(mediaItems.folderId, folders[key].id))).toEqual([]);
    });

    it('reports a wrong type and a wrong size together', async () => {
      const { owner, songs } = await setup();
      const res = await start(owner.session, songs.id, { contentType: 'video/mp4', sizeBytes: MAX_AUDIO_BYTES + 1 }).expect(400);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['contentType', 'sizeBytes']);
    });

    it('answers 404 for an unknown folder whatever is declared', async () => {
      const { owner } = await setup();
      await start(owner.session, '00000000-0000-4000-8000-000000000000', { contentType: 'video/mp4' }).expect(404);
    });
  });

  describe('finishing', () => {
    it('makes a song with an ID3 tag ready and plays it as audio', async () => {
      const { owner, songs } = await setup();
      const { itemId, fileId, res } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(300), { ...MP3, title: 'Morning song' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, title: 'Morning song', status: 'ready', category: 'song', sizeBytes: 300 });
      expect(await storage.head((await fileRow(fileId)).storageKey)).toEqual({ size: 300, contentType: 'audio/mpeg' });
      expect(await auditFor('content.video.added', itemId)).toEqual([
        expect.objectContaining({ targetType: 'song', metadata: { folderId: songs.id, category: 'song' } }),
      ]);
      expect(await auditFor('file.upload_completed', itemId)).toEqual([expect.objectContaining({ targetType: 'song' })]);
      const play = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(200);
      expect(play.body.contentType).toBe('audio/mpeg');
      expect(storage.get(play.body.url).body).toHaveLength(300);
    });

    it.each([
      ['FF FB', 0xfb],
      ['FF F3', 0xf3],
      ['FF E3', 0xe3],
    ])('accepts an MP3 that starts straight with a frame (%s)', async (_name, second) => {
      const { owner, podcasts } = await setup();
      const { res } = await uploadVideo(app, storage, owner.session, podcasts.id, mp3FrameBytes(second, 200), MP3);
      expect(res.status).toBe(200);
      expect(res.body.category).toBe('podcast');
    });

    it('makes an M4A ready in Songs and an MP4 ready in Movies, each with its own purpose and key', async () => {
      const { owner, songs, movies } = await setup();
      const song = await uploadVideo(app, storage, owner.session, songs.id, m4aBytes(200), M4A);
      expect(song.res.status).toBe(200);
      expect(song.res.body.category).toBe('song');
      expect(await fileRow(song.fileId)).toMatchObject({ purpose: 'audio', contentType: 'audio/mp4' });
      const movie = await uploadVideo(app, storage, owner.session, movies.id, mp4Bytes(200));
      expect(movie.res.body).toMatchObject({ status: 'ready', category: 'movie' });
      const movieFile = await fileRow(movie.fileId);
      expect(movieFile).toMatchObject({ purpose: 'video', contentType: 'video/mp4' });
      expect(movieFile.storageKey).toMatch(/^videos\/[0-9a-f-]{36}$/);
    });

    it.each([
      ['a JPEG declared as MP3', 'songs', MP3, jpegBytes(64)],
      ['a WAV file declared as MP3', 'podcasts', MP3, wavBytes],
      ['an MP3 declared as M4A', 'songs', M4A, mp3Bytes(64)],
      ['a frame sync with only two bits (FF C0)', 'songs', MP3, mp3FrameBytes(0xc0, 64)],
    ] as const)('discards %s, removes its rows and object, and records not_audio', async (_name, key, declared, body) => {
      const folders = await setup();
      const started = await startUploadViaApi(app, folders.owner.session, folders[key].id, { ...declared, sizeBytes: body.length });
      const storageKey = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, folders.owner.session, started.fileId, body);
      const res = await completeViaApi(app, folders.owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(NOT_AUDIO);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(storage.has(storageKey)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry).toMatchObject({ targetType: folders[key].category, metadata: { fileId: started.fileId, reason: 'not_audio' } });
    });

    it('also removes the cover of a song it discards', async () => {
      const { owner, songs } = await setup();
      const body = jpegBytes(64);
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, sizeBytes: body.length });
      const coverId = await attachCoverViaApi(app, storage, owner.session, started.itemId);
      const coverKey = (await fileRow(coverId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(422);
      expect(await fileRow(coverId)).toBeUndefined();
      expect(storage.has(coverKey)).toBe(false);
    });
  });

  describe('resume, cancel and cleanup', () => {
    it('reports, lists and cancels an unfinished song like a video', async () => {
      const { owner, songs } = await setup();
      const started = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, title: 'Half a song', sizeBytes: 100 });
      const status = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(status.body).toMatchObject({ fileId: started.fileId, status: 'pending', partCount: 1 });
      const mine = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(mine.body.map((entry: { fileId: string }) => entry.fileId)).toContain(started.fileId);
      const pending = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(pending - 1);
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(await auditFor('file.upload_cancelled', started.itemId)).toEqual([expect.objectContaining({ targetType: 'song' })]);
    });

    it('refuses to cancel a ready song and keeps it', async () => {
      const { owner, songs } = await setup();
      const { itemId, fileId } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
      const res = await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect(res.body.message).toBe('This upload has already finished. Finished uploads cannot be cancelled here.');
      expect((await itemRow(itemId)).status).toBe('ready');
    });

    it('cleans up an abandoned song and its cover after 24 hours, and never a ready song', async () => {
      const { owner, songs } = await setup();
      const abandoned = await startUploadViaApi(app, owner.session, songs.id, { ...MP3, sizeBytes: 100 });
      const coverId = await attachCoverViaApi(app, storage, owner.session, abandoned.itemId);
      const coverKey = (await fileRow(coverId)).storageKey;
      const ready = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
      await db
        .update(files)
        .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
        .where(inArray(files.id, [abandoned.fileId, ready.fileId]));
      const pending = storage.pendingUploadCount();

      await cleanup.run();
      expect(await itemRow(abandoned.itemId)).toBeUndefined();
      expect(await fileRow(abandoned.fileId)).toBeUndefined();
      expect(await fileRow(coverId)).toBeUndefined();
      expect(storage.has(coverKey)).toBe(false);
      expect(storage.pendingUploadCount()).toBe(pending - 1);
      expect(await auditFor('file.upload_failed', abandoned.itemId)).toEqual([
        expect.objectContaining({ actorId: null, targetType: 'song', metadata: { fileId: abandoned.fileId, reason: 'expired' } }),
      ]);
      expect((await itemRow(ready.itemId)).status).toBe('ready');
    });
  });

  it('never puts links or storage keys in the audit entries of an audio upload', async () => {
    const { owner, songs } = await setup();
    const { itemId, fileId } = await uploadVideo(app, storage, owner.session, songs.id, mp3Bytes(100), MP3);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rows)).not.toContain((await fileRow(fileId)).storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|audio\/[0-9a-f]{8}-|dev-storage|X-Amz/);
  });
});
```

Run: `npm test -w @jbf/api -- media-audio-uploads media.schemas`
Expected: FAIL (audio folders are 404 for uploads, the schema still enforces MP4 and 2 GiB).

- [ ] **Step 2: The start schema leaves type and size to the folder**

In `apps/api/src/media/media.schemas.ts` change the import to `import { COVER_CONTENT_TYPES, MAX_COVER_BYTES, MAX_PART_URLS_PER_REQUEST, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';` and the two fields of `startUploadSchema`:

```ts
  // Which types and sizes are allowed depends on the folder's category, so the service checks them (media-kinds.ts).
  contentType: z.string().min(1, 'Choose a file.').max(100, 'Choose a file.').refine(hasNoNul, NUL_MESSAGE),
  sizeBytes: z.number('Choose a file.').int('Choose a file.').min(1, 'That file is empty.'),
```

`MAX_PARTS` stays `partCountFor(MAX_VIDEO_BYTES)` (128, the largest of all kinds). zod 4 `int()` accepts safe integers only, so a size like `2 ** 60` is still a 400.

- [ ] **Step 3: Removing an unfinished item knows its category**

Replace `apps/api/src/media/remove-unfinished.ts` with:

```ts
import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/db.module';
import { type FileRow, files, mediaFolders, mediaItems } from '../db/schema';
import type { MediaCategory } from './media-kinds';

export interface RemovedUnfinished {
  item: { id: string; title: string; category: MediaCategory };
  // The cover attached to the item, if any: the caller discards its stored object after the transaction commits.
  cover: Pick<FileRow, 'id' | 'storageKey'> | null;
}

// Deletes an unfinished item (a video or an audio file) with its media file row and its cover, inside the caller's
// transaction. Returns null when the item is no longer unfinished (it finished or was removed meanwhile), so a ready
// item is never removed. The item goes first (taking its row lock), then the file rows, the same order as everywhere
// else. The cover is read from the deleted row, not from an earlier snapshot, because one can be attached at any time.
export async function removeUnfinishedItem(tx: DbTransaction, mediaFileId: string): Promise<RemovedUnfinished | null> {
  const [item] = await tx
    .delete(mediaItems)
    .where(and(eq(mediaItems.mediaFileId, mediaFileId), eq(mediaItems.status, 'uploading')))
    .returning({ id: mediaItems.id, title: mediaItems.title, folderId: mediaItems.folderId, coverFileId: mediaItems.coverFileId });
  if (!item) return null;
  // Folders are never deleted, so the item's folder still says which category it belonged to (for the audit entry).
  const [folder] = await tx.select({ category: mediaFolders.category }).from(mediaFolders).where(eq(mediaFolders.id, item.folderId));
  await tx.delete(files).where(eq(files.id, mediaFileId));
  let cover: RemovedUnfinished['cover'] = null;
  if (item.coverFileId) {
    [cover = null] = await tx.delete(files).where(eq(files.id, item.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
  }
  return { item: { id: item.id, title: item.title, category: folder.category }, cover };
}
```

- [ ] **Step 4: The uploads service**

Replace `apps/api/src/media/uploads.service.ts` with:

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
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuditAction } from '../audit/audit.actions';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaFolders, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS, PART_SIZE, partCountFor } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort, type StoredPart } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { sanitizeFileName } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import { kindOf, type MediaCategory, uploadFieldErrors } from './media-kinds';
import type { StartUploadInput } from './media.schemas';
import { type RemovedUnfinished, removeUnfinishedItem } from './remove-unfinished';

const GONE = 'This upload no longer exists.';
const LOST_UPLOAD = 'This upload can no longer be continued. Cancel it and start again.';
const MISSING_PIECES = 'Some pieces are missing. Resume the upload to send them.';
const BAD_PIECES = 'Some pieces are missing or damaged. Resume the upload to send them again.';
const FINISHED = 'This upload has already finished.';

const FAILURE_MESSAGES = {
  size_mismatch: 'The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.',
  not_mp4: 'That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).',
  not_audio: 'That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.',
} as const;

type FailureReason = keyof typeof FAILURE_MESSAGES;
// The category is the item's folder's: it decides the kind of file (video or audio) and how it is checked.
type UploadRow = { file: FileRow; item: MediaItem; category: MediaCategory };

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
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
    const kind = kindOf(folder.category);

    const key = `${kind.keyPrefix}/${randomUUID()}`;
    const partCount = partCountFor(input.sizeBytes);
    // Storage first, then the database: if the transaction fails the storage side is rolled back below.
    const uploadId = await this.storage.createMultipartUpload(key, input.contentType);
    try {
      return await this.db.transaction(async (tx) => {
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
          .from(mediaItems)
          .where(eq(mediaItems.folderId, folder.id));
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
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'file.upload_started',
          target: { type: folder.category, id: item.id, label: item.title },
          metadata: { fileId: file.id, sizeBytes: input.sizeBytes, partCount },
        });
        return { itemId: item.id, fileId: file.id, partSize: PART_SIZE, partCount };
      });
    } catch (error) {
      await this.storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw error;
    }
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
    const { file, item } = await this.load(fileId, actor);
    const base = { fileId: file.id, itemId: item.id, status: file.status, partSize: file.partSize ?? PART_SIZE, partCount: file.partCount ?? 0 };
    if (file.status === 'ready' || !file.uploadId) return { ...base, uploadedParts: [] };
    try {
      return { ...base, uploadedParts: await this.storage.listParts(file.storageKey, file.uploadId) };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'no_such_upload') throw new ConflictException(LOST_UPLOAD);
      throw error;
    }
  }

  async complete(actor: AuthUser, fileId: string, parts: { partNumber: number; etag: string }[]): Promise<ItemView> {
    const row = await this.load(fileId, actor);
    const { file, item } = row;
    if (file.status === 'ready') return this.items.view(item.id, actor);
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
    // The stored type must be the declared one, and the first bytes must match it (MP4 "ftyp", an MP3 frame or ID3 tag).
    const kind = kindOf(row.category);
    if (info.contentType !== file.contentType || !kind.matches(head, file.contentType)) return this.fail(actor, row, kind.failureReason);
    return this.finish(actor, row);
  }

  async cancel(actor: AuthUser, fileId: string): Promise<void> {
    const row = await this.load(fileId, actor);
    if (row.file.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
    const removed = await this.removePending(row, { actor, action: 'file.upload_cancelled', metadata: { fileId } });
    if (!removed) {
      const [current] = await this.db.select({ status: files.status }).from(files).where(eq(files.id, fileId));
      if (current?.status === 'ready') throw new ConflictException(`${FINISHED} Finished uploads cannot be cancelled here.`);
      return;
    }
    await this.discardRemoved(row.file, removed);
  }

  mine(actor: AuthUser) {
    return this.db
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
      .where(and(eq(files.uploadedBy, actor.id), ne(files.purpose, 'cover'), eq(files.status, 'pending')))
      .orderBy(desc(files.createdAt));
  }

  // The main file of an item: a video or an audio file, never a cover (covers have their own routes).
  private async load(fileId: string, actor: AuthUser): Promise<UploadRow> {
    const [row] = await this.db
      .select({ file: files, item: mediaItems, category: mediaFolders.category })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .where(and(eq(files.id, fileId), ne(files.purpose, 'cover')));
    if (!row) throw new NotFoundException('Upload not found.');
    if (row.file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    return row;
  }

  // The object is not in storage any more: either another request finished the job, or the upload was cancelled.
  private async afterVanish(actor: AuthUser, fileId: string): Promise<ItemView> {
    const [row] = await this.db
      .select({ status: files.status, itemId: mediaItems.id })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.mediaFileId, files.id))
      .where(eq(files.id, fileId));
    if (!row) throw new NotFoundException(GONE);
    if (row.status === 'ready') return this.items.view(row.itemId, actor);
    throw new ConflictException(LOST_UPLOAD);
  }

  // Removes the rows of a still-pending upload (and its cover) and records why. Returns null when someone else already
  // removed it (or the upload finished meanwhile), so a ready item is never removed.
  private async removePending(
    { file, item, category }: UploadRow,
    outcome: { actor: AuthUser; action: AuditAction; metadata: Record<string, unknown> },
  ): Promise<RemovedUnfinished | null> {
    return this.db.transaction(async (tx) => {
      const removed = await removeUnfinishedItem(tx, file.id);
      if (!removed) return null;
      await this.audit.record(tx, {
        actor: actorOf(outcome.actor),
        action: outcome.action,
        target: { type: category, id: item.id, label: item.title },
        metadata: outcome.metadata,
      });
      return removed;
    });
  }

  // Storage calls stay outside the transaction and are best effort.
  private async discardRemoved(file: FileRow, removed: RemovedUnfinished): Promise<void> {
    await discardStoredFile(this.storage, this.logger, file);
    if (removed.cover) await discardStoredFile(this.storage, this.logger, { ...removed.cover, uploadId: null });
  }

  private async fail(actor: AuthUser, row: UploadRow, reason: FailureReason): Promise<never> {
    const removed = await this.removePending(row, { actor, action: 'file.upload_failed', metadata: { fileId: row.file.id, reason } });
    if (removed) await this.discardRemoved(row.file, removed);
    throw new UnprocessableEntityException(FAILURE_MESSAGES[reason]);
  }

  private async finish(actor: AuthUser, { file, item, category }: UploadRow): Promise<ItemView> {
    const outcome = await this.db.transaction(async (tx) => {
      // Lock the item row first, as removePending does (it deletes the item row, then the file row): taking the
      // locks in the same order is what keeps a cancel and a finish that overlap from deadlocking.
      const [locked] = await tx.select({ status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
      if (!locked) return 'gone' as const;
      if (locked.status === 'ready') return 'done' as const;
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
      return 'done' as const;
    });
    if (outcome === 'gone') {
      // Cancelled while the pieces were being joined: the stored object has no owner any more.
      await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
      throw new NotFoundException(GONE);
    }
    return this.items.view(item.id, actor);
  }
}
```

- [ ] **Step 5: The cleanup handles audio uploads and names their category**

In `apps/api/src/media/upload-cleanup.service.ts` replace the comment and `expire()`:

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
        return { cover: removed.cover };
      }
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return null;
      await this.audit.record(tx, {
        actor: null,
        action: 'file.upload_failed',
        target: { type: 'cover', id: file.id, label: 'a cover image' },
        metadata: { fileId: file.id, reason: 'expired' },
      });
      return { cover: null };
    });
  }
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS, including every milestone 3 upload, cover and cleanup test and the new `media-audio-uploads` suite (about 30 tests). `grep -n "purpose, 'video'\|=== 'video'" apps/api/src/media/*.ts` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/media apps/api/test/helpers/media.ts apps/api/test/media-audio-uploads.e2e-spec.ts
git commit -m "feat: accept MP3 and M4A uploads for podcasts and songs and MP4 for movies"
```

---

### Task 5: Audit entries and sentences for every category

**Files:**
- Modify: `apps/api/src/audit/audit-presentation.ts`, `apps/api/src/media/items.service.ts`, `apps/api/src/media/covers.service.ts`
- Test: `apps/api/src/audit/audit-presentation-media.spec.ts`, `apps/api/test/media-play.e2e-spec.ts`, `apps/api/test/media-audit.e2e-spec.ts` (new)

**Existing tests to adapt:** `apps/api/src/audit/audit-presentation-media.spec.ts` rows for `content.video.added` (`'Video added'` → `'Item added'`), `content.video.edited` (`'Video edited'` → `'Item edited'`), `content.video.reordered` (`'Videos reordered'` → `'Items reordered'`) and `content.video.cover_set` (sentence `'Anita set the cover image of Fire exits'` → `'Anita set the cover image of the video Fire exits'`), as the spec requires (labels come from the action name, so old rows change too). Sentences for entries without `metadata.category` still say "video".

**Interfaces:**
- Consumes: `MEDIA_CATEGORIES`, `CategoryRule`, `MediaCategory` (Task 1); `ItemView.category`, `rows()` with `category` (Task 3); uploads and cleanup already write category targets (Task 4).
- Produces:

```ts
// items.service.ts
type VisibleItem = MediaItem & { category: MediaCategory }
ItemsService.requireVisible(executor: DbExecutor, itemId: string, actor: AuthUser): Promise<VisibleItem>
// messages: 'Item not found.' (404), 'This is still uploading.' (409 on play)
// Audit: content.video.edited target { type: category, ... } metadata { category }; content.video.reordered metadata { category };
//   content.video.cover_set target { type: category, ... } metadata { fileId, category }; cover file.upload_failed target type = category;
//   playback.played target { type: category, ... }
// audit-presentation.ts: labels 'Item added', 'Item edited', 'Items reordered', 'Cover set'; nouns from metadata.category,
//   'video' when absent or unknown; UPLOAD_FAILURE_REASONS.not_audio = 'the file is not a valid MP3 or M4A'
```

- [ ] **Step 1: Failing presentation tests**

Replace `apps/api/src/audit/audit-presentation-media.spec.ts` with:

```ts
import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, type PresentableEntry, presentAudit } from './audit-presentation';

const entry = (overrides: Partial<PresentableEntry>): PresentableEntry => ({
  action: 'x',
  source: 'portal',
  actorLabel: 'anita@example.org',
  actorName: 'Anita',
  targetLabel: null,
  targetName: null,
  changes: null,
  metadata: null,
  ...overrides,
});

describe('media audit presentation', () => {
  it.each([
    ['content.folder.created', { targetLabel: 'Safety' }, 'Folder created', 'change', 'content', 'Anita created the folder Safety'],
    [
      'content.folder.renamed',
      { targetLabel: 'Safety', changes: { name: { before: 'Safty', after: 'Safety' } } },
      'Folder renamed',
      'change',
      'content',
      'Anita renamed the folder from Safty to Safety',
    ],
    ['content.folder.renamed', { targetLabel: 'Safety' }, 'Folder renamed', 'change', 'content', 'Anita renamed the folder Safety'],
    ['content.folder.reordered', {}, 'Folders reordered', 'neutral', 'content', 'Anita changed the order of the video folders'],
    ['content.video.added', { targetLabel: 'Fire exits' }, 'Item added', 'change', 'content', 'Anita added the video Fire exits'],
    ['content.video.edited', { targetLabel: 'Fire exits' }, 'Item edited', 'change', 'content', 'Anita edited the video Fire exits'],
    ['content.video.reordered', { targetLabel: 'Safety' }, 'Items reordered', 'neutral', 'content', 'Anita changed the order of the videos in Safety'],
    ['content.video.cover_set', { targetLabel: 'Fire exits' }, 'Cover set', 'change', 'content', 'Anita set the cover image of the video Fire exits'],
    ['file.upload_started', { targetLabel: 'Fire exits' }, 'Upload started', 'neutral', 'files', 'Anita started uploading Fire exits'],
    ['file.upload_completed', { targetLabel: 'Fire exits' }, 'Upload finished', 'success', 'files', 'Anita finished uploading Fire exits'],
    [
      'file.upload_failed',
      { targetLabel: 'Fire exits', metadata: { reason: 'size_mismatch' } },
      'Upload failed',
      'warning',
      'files',
      'The upload of Fire exits failed (the file size did not match)',
    ],
    ['file.upload_cancelled', { targetLabel: 'Fire exits' }, 'Upload cancelled', 'neutral', 'files', 'Anita cancelled the upload of Fire exits'],
    ['playback.played', { targetLabel: 'Fire exits' }, 'Played', 'neutral', 'playback', 'Anita played Fire exits'],
  ] as const)('%s', (action, overrides, label, tone, category, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category, summary });
  });

  it.each([
    ['song', 'song', 'songs'],
    ['podcast', 'podcast', 'podcasts'],
    ['movie', 'movie', 'movies'],
    ['video', 'video', 'videos'],
  ])('uses the word for a %s from metadata.category', (category, noun, plural) => {
    const say = (action: string, targetLabel: string) => presentAudit(entry({ action, targetLabel, metadata: { category } })).summary;
    expect(say('content.video.added', 'T')).toBe(`Anita added the ${noun} T`);
    expect(say('content.video.edited', 'T')).toBe(`Anita edited the ${noun} T`);
    expect(say('content.video.cover_set', 'T')).toBe(`Anita set the cover image of the ${noun} T`);
    expect(say('content.video.reordered', 'Road trip')).toBe(`Anita changed the order of the ${plural} in Road trip`);
    expect(say('content.folder.reordered', 'Song folders')).toBe(`Anita changed the order of the ${noun} folders`);
  });

  it('falls back to "video" for entries written before milestone 4 and for unknown or inherited values', () => {
    for (const metadata of [null, {}, { category: 'karaoke' }, { category: 'constructor' }, { category: '__proto__' }, { category: 5 }]) {
      expect(presentAudit(entry({ action: 'content.video.added', targetLabel: 'T', metadata })).summary).toBe('Anita added the video T');
      expect(presentAudit(entry({ action: 'content.video.reordered', targetLabel: 'F', metadata })).summary).toBe('Anita changed the order of the videos in F');
    }
  });

  it('keeps the upload and playback sentences the same for audio', () => {
    expect(presentAudit(entry({ action: 'playback.played', targetLabel: 'Morning song', metadata: { category: 'song' } })).summary).toBe('Anita played Morning song');
  });

  it.each([
    ['not_mp4', 'the file is not a valid MP4'],
    ['not_audio', 'the file is not a valid MP3 or M4A'],
    ['bad_image', 'the cover image is not valid'],
    ['expired', 'it was not finished within 24 hours'],
  ])('explains the failure reason %s in plain words', (reason, words) => {
    const result = presentAudit(entry({ action: 'file.upload_failed', targetLabel: 'T', actorName: null, actorLabel: null, metadata: { reason } }));
    expect(result.summary).toBe(`The upload of T failed (${words})`);
  });

  it('omits the reason when it is unknown, including inherited object names', () => {
    for (const reason of ['something_new', 'constructor', undefined]) {
      expect(presentAudit(entry({ action: 'file.upload_failed', targetLabel: 'T', metadata: { reason } })).summary).toBe('The upload of T failed');
    }
  });

  it('files the media actions under the right categories', () => {
    const media = AUDIT_ACTIONS.filter((action) => /^(content\.(folder|video)|file\.upload|playback\.)/.test(action));
    expect(media).toHaveLength(12);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played']);
  });
});
```

Run: `npm test -w @jbf/api -- audit-presentation-media`
Expected: FAIL (old labels, no nouns, no `not_audio`).

- [ ] **Step 2: The sentences**

In `apps/api/src/audit/audit-presentation.ts` add the import `import { type CategoryRule, MEDIA_CATEGORIES, type MediaCategory } from '../media/media-kinds';`, add `not_audio: 'the file is not a valid MP3 or M4A',` to `UPLOAD_FAILURE_REASONS` after `not_mp4`, add this helper after `folderRenamed`:

```ts
// Content entries name their category in metadata.category since milestone 4. Older entries have none and are all about
// videos, so they keep reading "the video". Own keys only: a stored value such as 'constructor' falls back too.
function wordsFor(entry: PresentableEntry): CategoryRule {
  const code = entry.metadata?.category;
  return typeof code === 'string' && Object.hasOwn(MEDIA_CATEGORIES, code) ? MEDIA_CATEGORIES[code as MediaCategory] : MEDIA_CATEGORIES.video;
}
```

and replace the five content specs:

```ts
  'content.folder.reordered': {
    label: 'Folders reordered',
    tone: 'neutral',
    summary: ({ actor, entry }) => `${actor} changed the order of the ${wordsFor(entry).noun} folders`,
  },
  'content.video.added': {
    label: 'Item added',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} added the ${wordsFor(entry).noun} ${target}`,
  },
  'content.video.edited': {
    label: 'Item edited',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} edited the ${wordsFor(entry).noun} ${target}`,
  },
  'content.video.reordered': {
    label: 'Items reordered',
    tone: 'neutral',
    summary: ({ actor, target, entry }) => `${actor} changed the order of the ${wordsFor(entry).nounPlural} in ${target}`,
  },
  'content.video.cover_set': {
    label: 'Cover set',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} set the cover image of the ${wordsFor(entry).noun} ${target}`,
  },
```

Run: `npm test -w @jbf/api -- audit-presentation`
Expected: PASS (both presentation specs).

- [ ] **Step 3: Failing end-to-end tests for the entries**

Add to `apps/api/test/media-play.e2e-spec.ts` (extend the helper import to `import { mp3Bytes, seedFolder, seedItem, signIn, uniqueName, uploadVideo } from './helpers/media';`):

```ts
  it('gives a link for a song with its audio type and records the song as what was played', async () => {
    const owner = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id, uniqueName('Songs'), 'song');
    const { itemId, res } = await uploadVideo(app, storage, owner.session, folder.id, mp3Bytes(120), { contentType: 'audio/mpeg', fileName: 's.mp3', title: 'Morning song' });
    expect(res.status).toBe(200);
    const play = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(200);
    expect(play.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType: 'audio/mpeg' });
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'playback.played'), eq(auditLog.targetId, itemId)));
    expect(entry).toMatchObject({ actorId: owner.user.id, targetType: 'song', targetLabel: 'Morning song' });
    expect(JSON.stringify(entry)).not.toMatch(/memory:|audio\/[0-9a-f]{8}-/);
  });
```

Create `apps/api/test/media-audit.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files } from '../src/db/schema';
import { seedAudit } from './helpers/audit';
import { bearer, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { attachCoverViaApi, completeViaApi, createFolderViaApi, jpegBytes, mp3Bytes, putPieces, signIn, startUploadViaApi, uniqueName, uploadVideo } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const MP3 = { contentType: 'audio/mpeg', fileName: 'song.mp3' };

describe('audit entries for every media category', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;
  let admin: Session;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
    admin = (await signIn(app, db, 'admin')).session;
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const presented = async (q: string) =>
    (await http().get(`/api/audit?q=${encodeURIComponent(q)}&includePlayback=true&limit=100`).set(...bearer(admin)).expect(200)).body.items as {
      action: string;
      label: string;
      summary: string;
    }[];

  it('records the category on every change to a song and words the log with it', async () => {
    const folder = await createFolderViaApi(app, admin, uniqueName('Road trip'), 'songs');
    const title = uniqueName('Morning song');
    const first = await uploadVideo(app, storage, admin, folder.id, mp3Bytes(100), { ...MP3, title });
    expect(first.res.status).toBe(200);
    await http().patch(`/api/media/items/${first.itemId}`).set(...bearer(admin)).send({ description: 'Sung softly' }).expect(200);
    await attachCoverViaApi(app, storage, admin, first.itemId);
    const second = await uploadVideo(app, storage, admin, folder.id, mp3Bytes(100), { ...MP3, title: uniqueName('Evening song') });
    await http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(admin)).send({ ids: [second.itemId, first.itemId] }).expect(200);
    await http().post(`/api/media/items/${first.itemId}/play`).set(...bearer(admin)).expect(200);

    const rows = await db.select().from(auditLog).where(inArray(auditLog.targetId, [first.itemId, folder.id]));
    const of = (action: string) => rows.filter((row) => row.action === action);
    for (const action of ['content.video.added', 'content.video.edited', 'content.video.cover_set']) {
      expect(of(action)).toEqual([expect.objectContaining({ targetType: 'song', metadata: expect.objectContaining({ category: 'song' }) })]);
    }
    expect(of('content.video.reordered')).toEqual([expect.objectContaining({ targetType: 'folder', metadata: { category: 'song' } })]);
    expect(of('playback.played')).toEqual([expect.objectContaining({ targetType: 'song' })]);
    const [{ storageKey }] = await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.id, first.fileId));
    expect(JSON.stringify(rows)).not.toContain(storageKey);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|covers\/|dev-storage/);

    const items = await presented(title);
    const sentence = (action: string) => items.find((item) => item.action === action);
    expect(sentence('content.video.added')).toMatchObject({ label: 'Item added', summary: `Test User added the song ${title}` });
    expect(sentence('content.video.edited')).toMatchObject({ label: 'Item edited', summary: `Test User edited the song ${title}` });
    expect(sentence('content.video.cover_set')).toMatchObject({ label: 'Cover set', summary: `Test User set the cover image of the song ${title}` });
    expect(sentence('playback.played')).toMatchObject({ label: 'Played', summary: `Test User played ${title}` });
    expect((await presented(folder.name)).find((item) => item.action === 'content.video.reordered')).toMatchObject({
      label: 'Items reordered',
      summary: `Test User changed the order of the songs in ${folder.name}`,
    });
  });

  it('still describes entries written before this milestone as videos', async () => {
    const label = uniqueName('Old');
    await seedAudit(db, [
      { action: 'content.video.added', actorLabel: 'old@example.org', targetType: 'video', targetId: randomUUID(), targetLabel: label, metadata: { folderId: randomUUID() } },
      { action: 'content.video.reordered', actorLabel: 'old@example.org', targetType: 'folder', targetId: randomUUID(), targetLabel: label },
    ]);
    const items = await presented(label);
    expect(items.map((item) => item.summary).sort()).toEqual(
      [`old@example.org added the video ${label}`, `old@example.org changed the order of the videos in ${label}`].sort(),
    );
    expect(items.map((item) => item.label).sort()).toEqual(['Item added', 'Items reordered']);
  });

  it('explains a podcast that was not really audio', async () => {
    const folder = await createFolderViaApi(app, admin, uniqueName('Weekly'), 'podcasts');
    const title = uniqueName('Episode');
    const body = jpegBytes(64);
    const started = await startUploadViaApi(app, admin, folder.id, { ...MP3, title, sizeBytes: body.length });
    const parts = await putPieces(app, storage, admin, started.fileId, body);
    expect((await completeViaApi(app, admin, started.fileId, parts)).status).toBe(422);
    const failed = (await presented(title)).find((item) => item.action === 'file.upload_failed');
    expect(failed).toMatchObject({ label: 'Upload failed', summary: `The upload of ${title} failed (the file is not a valid MP3 or M4A)` });
  });
});
```

Run: `npm test -w @jbf/api -- media-play media-audit`
Expected: FAIL (`playback.played`, `content.video.edited` and `cover_set` still use target type `video` and have no `metadata.category`).

- [ ] **Step 4: Items: visible items carry their category; neutral messages; audit targets and metadata**

In `apps/api/src/media/items.service.ts`:

```ts
const NOT_FOUND = 'Item not found.';
```

```ts
// An item as stored, with the category of its folder (it decides the words and the audit target type).
export type VisibleItem = MediaItem & { category: MediaCategory };
```

Replace `requireVisible`, `update`, `reorder`'s audit call and `play`:

```ts
  async requireVisible(executor: DbExecutor, itemId: string, actor: AuthUser): Promise<VisibleItem> {
    const [row] = await executor
      .select({ item: mediaItems, category: mediaFolders.category })
      .from(mediaItems)
      .innerJoin(mediaFolders, eq(mediaFolders.id, mediaItems.folderId))
      .where(eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    return { ...row.item, category: row.category };
  }

  async update(actor: AuthUser, id: string, input: UpdateItemInput): Promise<ItemView> {
    await this.db.transaction(async (tx) => {
      const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, id)).for('update');
      if (!item || !visibleTo(item, actor)) throw new NotFoundException(NOT_FOUND);
      const changes: AuditChanges = {};
      if (input.title !== undefined && input.title !== item.title) changes.title = { before: item.title, after: input.title };
      if (input.description !== undefined && input.description !== item.description) {
        changes.description = { before: item.description, after: input.description };
      }
      if (Object.keys(changes).length === 0) return;
      const folder = await this.requireFolder(tx, item.folderId);
      await tx.update(mediaItems).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(mediaItems.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.edited',
        target: { type: folder.category, id, label: input.title ?? item.title },
        changes,
        metadata: { category: folder.category },
      });
    });
    return this.view(id, actor);
  }
```

In `reorder`, the audit call becomes:

```ts
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.video.reordered',
          target: { type: 'folder', id: folderId, label: folder.name },
          metadata: { category: folder.category },
        });
```

```ts
  async play(actor: AuthUser, itemId: string): Promise<{ url: string; expiresAt: string; contentType: string }> {
    const [row] = await this.rows(this.db, eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    if (row.item.status !== 'ready') throw new ConflictException('This is still uploading.');
    const url = await this.storage.presignGet(row.media.storageKey, LINK_TTL_SECONDS, { contentType: row.media.contentType });
    // Written only after the link exists, and every issued link is recorded (including a renewal while playing).
    await this.audit.record(this.db, {
      actor: actorOf(actor),
      action: 'playback.played',
      target: { type: row.category, id: itemId, label: row.item.title },
    });
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), contentType: row.media.contentType };
  }
```

Also change the comment above `visibleTo` to "An item that is still uploading belongs to the person uploading it; to everyone else it does not exist yet." The folder is read without a lock in `update`: folders are never deleted, and the category of a folder never changes.

- [ ] **Step 5: Covers name the item's category**

In `apps/api/src/media/covers.service.ts` change the item import to `import { type ItemView, ItemsService, type VisibleItem } from './items.service';`, change the `reject` and `attach` signatures to take `item: VisibleItem`, and change their audit calls:

```ts
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'file.upload_failed',
        target: { type: item.category, id: item.id, label: item.title },
        metadata: { fileId: file.id, reason },
      });
```

```ts
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.cover_set',
        target: { type: item.category, id: item.id, label: lockedItem.title },
        metadata: { fileId: file.id, category: item.category },
      });
```

`start` and `complete` already get the item from `requireVisible`, so they pass a `VisibleItem` without other changes; `alreadyAttached(actor, item: MediaItem, file)` keeps its signature (a `VisibleItem` is a `MediaItem`).

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS. The milestone 3 tests that check `targetType: 'video'` for video items, `targetType: 'category', targetId: 'video'` for a folder reorder and `/still uploading/i` keep passing unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/audit apps/api/src/media apps/api/test/media-play.e2e-spec.ts apps/api/test/media-audit.e2e-spec.ts
git commit -m "feat: word audit entries by media category and add the not_audio reason"
```

---

## Web tasks (Tasks 6–10)

Run web tests with `npm test -w @jbf/web -- <pattern>`. `npm run build -w @jbf/web` type-checks the spec files too, so every fixture typed `Folder` or `MediaItem` must have every field.

### Task 6: Web file rules per kind: the picker, the declared type and the length

**Files:**
- Modify: `apps/web/src/uploads/limits.ts`, `apps/web/src/uploads/duration.ts`, `apps/web/src/uploads/UploadsContext.tsx`, `apps/web/src/pages/videos/UploadDialog.tsx`, `apps/web/src/pages/videos/PendingUploads.tsx`
- Test: `apps/web/src/uploads/limits.spec.ts`, `apps/web/src/uploads/duration.spec.ts`, `apps/web/src/uploads/UploadsContext.spec.tsx`, `apps/web/src/pages/videos/UploadDialog.spec.tsx`

**Existing tests to adapt:** `limits.spec.ts` (rewritten below: `checkVideoFile` is replaced by `checkMediaFile`, every milestone 3 case is kept); `duration.spec.ts` (calls become `readDuration(file, 'video')`, the element spy also captures `audio`); `UploadsContext.spec.tsx:51` (`input` gains `contentType: 'video/mp4'`); `UploadDialog.spec.tsx:59` (the expected `start` argument gains `contentType: 'video/mp4'`).

**Interfaces:**
- Produces:

```ts
// uploads/limits.ts
type MediaKind = 'video' | 'audio'
MAX_VIDEO_BYTES = 2_147_483_648; MAX_AUDIO_BYTES = 524_288_000; MAX_COVER_BYTES = 10_485_760
MP4_HELP: string; AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.'
MEDIA_KINDS: Record<MediaKind, { accept: string; formats: string; maxBytes: number; wrongType: string; tooLarge: string; declaredType(file: File): string | null }>
type FileCheck = { ok: true; contentType: string } | { ok: false; problem: string }
checkMediaFile(kind: MediaKind, file: File): FileCheck
checkCoverFile(file: File): string | null          // unchanged
// uploads/duration.ts
readDuration(file: File, kind: MediaKind): Promise<number | null>
// uploads/UploadsContext.tsx
interface StartInput { file; folderId; contentType: string; title; description; durationSeconds; cover }
```

- [ ] **Step 1: Failing tests**

Replace `apps/web/src/uploads/limits.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { AUDIO_HELP, checkCoverFile, checkMediaFile, MAX_AUDIO_BYTES, MAX_COVER_BYTES, MAX_VIDEO_BYTES, MEDIA_KINDS, MP4_HELP } from './limits';

const file = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

describe('checkMediaFile for videos and movies', () => {
  it('accepts an MP4 up to exactly 2 GB and declares it as video/mp4', () => {
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', 1))).toEqual({ ok: true, contentType: 'video/mp4' });
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toEqual({ ok: true, contentType: 'video/mp4' });
  });

  it('accepts an .mp4 whose type the system did not report', () => {
    expect(checkMediaFile('video', file('Clip.MP4', '', 10))).toEqual({ ok: true, contentType: 'video/mp4' });
  });

  it('explains how to convert anything else, audio included', () => {
    for (const bad of [file('a.mov', 'video/quicktime', 10), file('a.webm', 'video/webm', 10), file('a.txt', '', 10), file('a.mp4.exe', '', 10), file('a.mp3', 'audio/mpeg', 10)]) {
      expect(checkMediaFile('video', bad)).toEqual({ ok: false, problem: MP4_HELP });
    }
    expect(MP4_HELP).toMatch(/HandBrake/);
  });

  it('refuses an empty file and a file over 2 GB', () => {
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', 0))).toEqual({ ok: false, problem: 'That file is empty.' });
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toEqual({
      ok: false,
      problem: 'Videos can be at most 2 GB. Choose a smaller file or compress it first.',
    });
  });
});

describe('checkMediaFile for podcasts and songs', () => {
  it.each([
    ['an MP3', 'song.mp3', 'audio/mpeg', 'audio/mpeg'],
    ['an MP3 the system did not type', 'song.MP3', '', 'audio/mpeg'],
    ['an MP3 reported as audio/mp3', 'song.mp3', 'audio/mp3', 'audio/mpeg'],
    ['an M4A', 'talk.m4a', 'audio/mp4', 'audio/mp4'],
    ['an M4A reported as audio/x-m4a', 'talk.m4a', 'audio/x-m4a', 'audio/mp4'],
    ['an M4A reported as audio/aac', 'talk.M4A', 'audio/aac', 'audio/mp4'],
    ['an M4A the system did not type', 'talk.m4a', '', 'audio/mp4'],
  ])('accepts %s and declares it as the server expects', (_name, name, type, declared) => {
    expect(checkMediaFile('audio', file(name, type, 10))).toEqual({ ok: true, contentType: declared });
  });

  it('accepts exactly 500 MB and refuses one byte more', () => {
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES))).toEqual({ ok: true, contentType: 'audio/mpeg' });
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES + 1))).toEqual({
      ok: false,
      problem: 'Audio files can be at most 500 MB. Choose a smaller file.',
    });
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', 0))).toEqual({ ok: false, problem: 'That file is empty.' });
  });

  it('refuses raw AAC, WAV, FLAC, videos and unknown files with the audio message', () => {
    for (const bad of [
      file('raw.aac', 'audio/aac', 10),
      file('a.wav', 'audio/wav', 10),
      file('a.flac', 'audio/flac', 10),
      file('a.mp4', 'video/mp4', 10),
      file('a.m4a.exe', '', 10),
      file('noextension', '', 10),
    ]) {
      expect(checkMediaFile('audio', bad)).toEqual({ ok: false, problem: AUDIO_HELP });
    }
  });

  it('offers the right files in the picker', () => {
    expect(MEDIA_KINDS.video.accept).toBe('video/mp4,.mp4');
    expect(MEDIA_KINDS.audio.accept).toBe('audio/mpeg,audio/mp4,.mp3,.m4a');
    expect(MEDIA_KINDS.audio.formats).toBe('MP3 or M4A, up to 500 MB');
  });
});

describe('checkCoverFile', () => {
  it('accepts JPEG, PNG and WebP up to exactly 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(checkCoverFile(file('c', type, MAX_COVER_BYTES))).toBeNull();
    }
  });

  it('refuses other types, empty files and files over 10 MB', () => {
    expect(checkCoverFile(file('c.gif', 'image/gif', 10))).toMatch(/JPEG, PNG or WebP/);
    expect(checkCoverFile(file('c.png', 'image/png', 0))).toMatch(/empty/i);
    expect(checkCoverFile(file('c.png', 'image/png', MAX_COVER_BYTES + 1))).toMatch(/at most 10 MB/);
  });
});
```

Replace `apps/web/src/uploads/duration.spec.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDuration } from './duration';

describe('readDuration', () => {
  let media: HTMLMediaElement;
  let created: string[];

  beforeEach(() => {
    created = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'video' || tag === 'audio') {
        media = element as HTMLMediaElement;
        created.push(tag);
      }
      return element;
    });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const video = new File(['x'], 'a.mp4', { type: 'video/mp4' });
  const song = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });

  it('reads the length in whole seconds from the file itself and lets the file go', async () => {
    const result = readDuration(video, 'video');
    Object.defineProperty(media, 'duration', { value: 724.4, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(724);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(created).toEqual(['video']);
  });

  it('opens an audio file in an audio element', async () => {
    const result = readDuration(song, 'audio');
    Object.defineProperty(media, 'duration', { value: 185.6, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(186);
    expect(created).toEqual(['audio']);
  });

  it('answers null when the browser cannot read the file', async () => {
    const result = readDuration(video, 'video');
    media.dispatchEvent(new Event('error'));
    await expect(result).resolves.toBeNull();
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN])('answers null for a length of %s', async (value) => {
    const result = readDuration(song, 'audio');
    Object.defineProperty(media, 'duration', { value, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBeNull();
  });

  it('gives up after ten seconds', async () => {
    vi.useFakeTimers();
    const result = readDuration(song, 'audio');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
```

In `apps/web/src/uploads/UploadsContext.spec.tsx` change line 51 to:

```ts
const input = { file, folderId: 'f1', contentType: 'video/mp4', title: 'Fire exits', description: '', durationSeconds: 12, cover: null };
```

and add after the first test (`'starts an upload, sends every piece ...'`):

```ts
  it('declares the type it was given, for example an M4A for a song folder', async () => {
    const calls = startServer();
    setup();
    await act(() => value.start({ ...input, file: new File([new Uint8Array(10)], 'talk.m4a', { type: 'audio/x-m4a' }), contentType: 'audio/mp4' }));
    expect(calls.find((call) => call.key === 'POST /api/media/uploads')?.body).toMatchObject({ fileName: 'talk.m4a', contentType: 'audio/mp4' });
  });
```

In `apps/web/src/pages/videos/UploadDialog.spec.tsx` change the expectation at line 59 to:

```ts
    expect(start).toHaveBeenCalledWith({ file, folderId: 'f1', contentType: 'video/mp4', title: 'Fire exits', description: 'Where to go.', durationSeconds: 42, cover });
```

and add, after `'does not open a file that will be refused in a video element'`:

```ts
  it('reads the length of a video with a video element', async () => {
    const { dialog } = setup();
    vi.mocked(readDuration).mockClear();
    const file = mp4();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), file);
    expect(readDuration).toHaveBeenCalledWith(file, 'video');
  });
```

Run: `npm test -w @jbf/web -- limits duration UploadsContext UploadDialog`
Expected: FAIL (`checkMediaFile`, `MEDIA_KINDS`, `AUDIO_HELP`, `MAX_AUDIO_BYTES` do not exist; `readDuration` takes one argument; `contentType` is hard-coded).

- [ ] **Step 2: The web kinds table**

Replace `apps/web/src/uploads/limits.ts` with:

```ts
export type MediaKind = 'video' | 'audio';

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_AUDIO_BYTES = 500 * 1024 ** 2;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MP4_HELP = 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).';
export const AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const extensionOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

interface KindRule {
  // For the file picker: which files to offer and how to describe them.
  accept: string;
  formats: string;
  maxBytes: number;
  wrongType: string;
  tooLarge: string;
  // The type to tell the server, or null when the file is not of this kind.
  declaredType: (file: File) => string | null;
}

// The browser's copy of the server's rules (apps/api/src/media/media-kinds.ts), for quick answers before anything is
// sent. The server checks everything again.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    accept: 'video/mp4,.mp4',
    formats: 'MP4, up to 2 GB',
    maxBytes: MAX_VIDEO_BYTES,
    wrongType: MP4_HELP,
    tooLarge: 'Videos can be at most 2 GB. Choose a smaller file or compress it first.',
    declaredType: (file) => (file.type === 'video/mp4' || (file.type === '' && extensionOf(file.name) === 'mp4') ? 'video/mp4' : null),
  },
  audio: {
    accept: 'audio/mpeg,audio/mp4,.mp3,.m4a',
    formats: 'MP3 or M4A, up to 500 MB',
    maxBytes: MAX_AUDIO_BYTES,
    wrongType: AUDIO_HELP,
    tooLarge: 'Audio files can be at most 500 MB. Choose a smaller file.',
    // Systems report M4A files under several names (audio/x-m4a, audio/aac or none) and MP3 files sometimes as
    // audio/mp3; the server accepts only audio/mp4 and audio/mpeg. A raw .aac file is not an M4A and is refused.
    declaredType: (file) => {
      const extension = extensionOf(file.name);
      if (file.type === 'audio/mpeg' || (extension === 'mp3' && ['', 'audio/mp3'].includes(file.type))) return 'audio/mpeg';
      if (file.type === 'audio/mp4' || (extension === 'm4a' && ['', 'audio/x-m4a', 'audio/aac', 'audio/m4a'].includes(file.type))) return 'audio/mp4';
      return null;
    },
  },
};

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

export function checkCoverFile(file: File): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_COVER_BYTES) return 'Covers can be at most 10 MB.';
  return null;
}
```

- [ ] **Step 3: Length from an `<audio>` element for audio**

Replace `apps/web/src/uploads/duration.ts` with:

```ts
import type { MediaKind } from './limits';

const TIMEOUT_MS = 10_000;

// The length is read by the browser from the file's own header; it is only shown to people, never trusted.
export function readDuration(file: File, kind: MediaKind): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    media.preload = 'metadata';
    const finish = (seconds: number | null): void => {
      clearTimeout(timer);
      media.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    // Some files report no usable length (NaN or Infinity); that is shown as unknown.
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? Math.round(media.duration) : null);
    media.onerror = () => finish(null);
    media.src = url;
  });
}
```

- [ ] **Step 4: The upload manager declares the type it is given**

In `apps/web/src/uploads/UploadsContext.tsx` add `contentType: string;` to `StartInput` after `folderId`, and in `start` send `contentType: input.contentType,` instead of `contentType: 'video/mp4',`. Change the comment on `finishedCount` to `// Goes up by one each time an upload finishes, so pages showing items know to reload.`

- [ ] **Step 5: The milestone 3 dialog and resume list use the table (still videos only; Task 10 makes them per category)**

In `apps/web/src/pages/videos/UploadDialog.tsx` change the limits import to `import { checkCoverFile, checkMediaFile } from '../../uploads/limits';` and replace `onFileChange` and the start of `onSubmit` up to the `uploads.start` call with:

```tsx
  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    const check = chosen ? checkMediaFile('video', chosen) : null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: check && !check.ok ? check.problem : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    // A file that will be refused is never opened in a media element.
    duration.current = chosen && check?.ok ? readDuration(chosen, 'video') : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const check = file ? checkMediaFile('video', file) : null;
    const next: Errors = {
      file: check === null ? 'Choose a video file.' : check.ok ? undefined : check.problem,
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    const first = (['file', 'title', 'cover'] as const).find((field) => next[field]);
    if (first || !file || !check || !check.ok) {
      setFocusRequest({ field: first ?? 'file' });
      return;
    }
    setBusy(true);
    try {
      await uploads.start({ file, folderId, contentType: check.contentType, title: title.trim(), description, durationSeconds: await duration.current, cover });
```

(the rest of `onSubmit` is unchanged). In `apps/web/src/pages/videos/PendingUploads.tsx` add `import { MEDIA_KINDS } from '../../uploads/limits';` and change the hidden input's `accept="video/mp4,.mp4"` to `accept={MEDIA_KINDS.video.accept}`.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS; the Videos pages behave exactly as before. `grep -rn "checkVideoFile" apps/web/src` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/uploads apps/web/src/pages/videos
git commit -m "feat: add the web file rules for audio and declare each file's type"
```

---

### Task 7: The docked player: context and bar

**Files:**
- Create: `apps/web/src/player/PlayerContext.tsx`, `apps/web/src/player/DockedPlayer.tsx`, `apps/web/src/player/DockedPlayer.module.css`
- Test: `apps/web/src/player/DockedPlayer.spec.tsx` (new)

**Existing tests to adapt:** none.

**Interfaces:**
- Consumes: `playItem(id): Promise<PlayLink>` (`api/media.ts`, unchanged), `describeError` (`api/client.ts`), `formatDuration` (`lib/format.ts`), `Button`.
- Produces:

```ts
// player/PlayerContext.tsx
interface DockTrack { itemId: string; title: string; categoryLabel: string; folderName: string; coverUrl: string | null }
interface PlayerSession { id: number; track: DockTrack }        // one start of playback
interface PlayerValue { session: PlayerSession | null; play(track: DockTrack): void; close(): void }
const PlayerContext: React.Context<PlayerValue | null>
usePlayer(): PlayerValue
PlayerProvider({ children })
// player/DockedPlayer.tsx
DockedPlayer()   // renders nothing without a session; otherwise <section aria-label="Player"> with one <audio>
// DockedPlayer.module.css classes used by tests: info, transport, volume, close
```

Behaviour (spec 7.2): one start asks for exactly one link (`POST /items/:id/play`), also under StrictMode; the `<audio>` has `autoPlay`, so a browser that blocks autoplay simply shows Play; on a media error it asks once for a fresh link and resumes at the same position; a second error shows `This could not be played. Please try again later.` with Try again; reaching `playing` re-arms the one retry; at the end the bar stays on the track, back at the start, with Play; Close (and unmounting, for example on sign-out) pauses the element and removes it; nothing is stored or logged.

- [ ] **Step 1: Failing tests**

Create `apps/web/src/player/DockedPlayer.spec.tsx`:

```tsx
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { MockResponse } from '../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../test/session';
import { DockedPlayer } from './DockedPlayer';
import styles from './DockedPlayer.module.css';
import { type DockTrack, PlayerProvider, usePlayer } from './PlayerContext';

const song: DockTrack = { itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null };
const podcast: DockTrack = { itemId: 'p1', title: 'Episode 4', categoryLabel: 'Podcasts', folderName: 'Weekly', coverUrl: 'https://cdn.example/cover?sig=1' };
const FAILED = 'This could not be played. Please try again later.';

let player: ReturnType<typeof usePlayer>;
function Probe() {
  player = usePlayer();
  return null;
}

// Answers every playback link request with a new link (s1-1, s1-2, ...) unless `refuse` says otherwise.
function startServer(refuse: (count: number) => MockResponse | null = () => null) {
  const requests: string[] = [];
  mockSession(STAFF, (url, init) => {
    const match = /^\/api\/media\/items\/([^/]+)\/play$/.exec(url);
    if (!match || init.method !== 'POST') return { status: 404, body: {} };
    requests.push(match[1] as string);
    const refused = refuse(requests.length);
    if (refused) return refused;
    return { body: { url: `https://cdn.example/${match[1]}-${requests.length}?sig=1`, expiresAt: '2026-10-09T11:00:00Z', contentType: 'audio/mpeg' } };
  });
  return requests;
}

function renderDock(strict = false) {
  const tree = (
    <PlayerProvider>
      <Probe />
      <DockedPlayer />
    </PlayerProvider>
  );
  return renderWithSession(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const audio = () => document.querySelector('audio') as HTMLAudioElement;
const setDuration = (element: HTMLMediaElement, value: number) => Object.defineProperty(element, 'duration', { configurable: true, value });

async function start(track: DockTrack, expectedSrc: string) {
  act(() => player.play(track));
  await waitFor(() => expect(audio()).toHaveAttribute('src', expectedSrc));
}

describe('DockedPlayer', () => {
  let play: MockInstance<() => Promise<void>>;
  let pause: MockInstance<() => void>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // jsdom has no media playback: play() and pause() are stand-ins that only record their calls.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows nothing until something plays', () => {
    startServer();
    renderDock();
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('plays a chosen track with one link, showing its title and "Category › Folder"', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const bar = screen.getByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Morning song')).toBeInTheDocument();
    expect(within(bar).getByText('Songs › Road trip')).toBeInTheDocument();
    expect(within(bar).getByText('♪')).toHaveAttribute('aria-hidden', 'true');
    expect(audio()).toHaveAttribute('autoplay');
    expect(requests).toEqual(['s1']);
    fireEvent.play(audio());
    expect(within(bar).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows Play when the browser blocks autoplay, and Play starts it', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(play.mock.contexts).toEqual([audio()]);
  });

  it('pauses and plays again with the same button', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.play(audio());
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause.mock.contexts).toEqual([audio()]);
    fireEvent.pause(audio());
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('shows the times and seeks with the slider (a native range input, so arrow keys work in browsers)', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const seek = screen.getByRole('slider', { name: 'Seek' });
    expect(seek).toBeDisabled();
    setDuration(audio(), 200);
    fireEvent.loadedMetadata(audio());
    expect(seek).toBeEnabled();
    expect(seek).toHaveAttribute('type', 'range');
    expect(seek).toHaveAttribute('max', '200');
    expect(seek).toHaveAttribute('step', '1');
    expect(screen.getByText('3:20')).toBeInTheDocument();
    audio().currentTime = 30;
    fireEvent.timeUpdate(audio());
    expect(screen.getByText('0:30')).toBeInTheDocument();
    fireEvent.change(seek, { target: { value: '65' } });
    expect(audio().currentTime).toBe(65);
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(seek).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, 0])('leaves the slider disabled with a dash for a length of %s', async (value) => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    setDuration(audio(), value);
    fireEvent.loadedMetadata(audio());
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('changes the volume and mutes and unmutes', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const volume = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(volume, { target: { value: '0.4' } });
    expect(audio().volume).toBe(0.4);
    await waitFor(() => expect(volume).toHaveValue('0.4'));
    const mute = screen.getByRole('button', { name: 'Mute' });
    await userEvent.click(mute);
    expect(audio().muted).toBe(true);
    await waitFor(() => expect(mute).toHaveAttribute('aria-pressed', 'true'));
    expect(volume).toHaveValue('0');
    await userEvent.click(mute);
    await waitFor(() => expect(mute).toHaveAttribute('aria-pressed', 'false'));
    expect(volume).toHaveValue('0.4');
  });

  it('stays on a finished track, back at the start, and Play replays it without a new link', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    setDuration(audio(), 200);
    fireEvent.loadedMetadata(audio());
    fireEvent.play(audio());
    audio().currentTime = 200;
    fireEvent.timeUpdate(audio());
    expect(screen.getAllByText('3:20')).toHaveLength(2);
    fireEvent.pause(audio());
    fireEvent.ended(audio());
    expect(screen.getByRole('region', { name: 'Player' })).toHaveTextContent('Morning song');
    expect(audio().currentTime).toBe(0);
    expect(screen.getByText('0:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(requests).toEqual(['s1']);
  });

  it('replaces the track when another is chosen, stopping the first', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const first = audio();
    await start(podcast, 'https://cdn.example/p1-2?sig=1');
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(audio()).not.toBe(first);
    expect(pause.mock.contexts).toContain(first);
    const bar = screen.getByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Episode 4')).toBeInTheDocument();
    expect(within(bar).getByText('Podcasts › Weekly')).toBeInTheDocument();
    expect(bar.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(bar.querySelector('img')).toHaveAttribute('alt', '');
    expect(requests).toEqual(['s1', 'p1']);
  });

  it('asks once for a fresh link when the audio stops loading and carries on from the same position', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    audio().currentTime = 42.5;
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    expect(requests).toEqual(['s1', 's1']);
    // The browser starts from the beginning when a new source loads.
    audio().currentTime = 0;
    setDuration(audio(), 200);
    play.mockClear();
    fireEvent.loadedMetadata(audio());
    expect(audio().currentTime).toBe(42.5);
    expect(play).toHaveBeenCalledTimes(1);
    // The position is used once.
    fireEvent.loadedMetadata(audio());
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('gives up after a second failure with a message and Try again, which asks for a new link', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    fireEvent.error(audio());
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED);
    expect(audio()).not.toHaveAttribute('src');
    expect(requests).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-3?sig=1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows another fresh link once the audio has played again', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    fireEvent.playing(audio());
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-3?sig=1'));
    expect(requests).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server refusal with Try again when no link is given', async () => {
    startServer((count) => (count === 1 ? { status: 409, body: { message: 'This is still uploading.' } } : null));
    renderDock();
    act(() => player.play(song));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is still uploading.');
    expect(audio()).not.toHaveAttribute('src');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
  });

  it('asks for one link per start even when effects run twice (development double-run)', async () => {
    const requests = startServer();
    renderDock(true);
    await start(song, 'https://cdn.example/s1-1?sig=1');
    expect(requests).toEqual(['s1']);
    await start(podcast, 'https://cdn.example/p1-2?sig=1');
    expect(requests).toEqual(['s1', 'p1']);
  });

  it('Close stops the sound and removes the player', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const element = audio();
    await userEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(pause.mock.contexts).toContain(element);
  });

  it('shows a hostile title as plain text and stores no link', async () => {
    startServer();
    renderDock();
    await start({ ...song, title: '<img src=x onerror=alert(1)>' }, 'https://cdn.example/s1-1?sig=1');
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('lays the bar out in areas the phone layout rearranges into two rows', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    expect(screen.getByText('Morning song').closest(`.${styles.info}`)).not.toBeNull();
    expect(screen.getByRole('slider', { name: 'Seek' }).closest(`.${styles.transport}`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Play' }).closest(`.${styles.transport}`)).not.toBeNull();
    expect(screen.getByRole('slider', { name: 'Volume' }).closest(`.${styles.volume}`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close player' }).closest(`.${styles.close}`)).not.toBeNull();
  });
});
```

Run: `npm test -w @jbf/web -- DockedPlayer`
Expected: FAIL (`./DockedPlayer` and `./PlayerContext` do not exist).

- [ ] **Step 2: The context**

Create `apps/web/src/player/PlayerContext.tsx`:

```tsx
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface DockTrack {
  itemId: string;
  title: string;
  categoryLabel: string;
  folderName: string;
  coverUrl: string | null;
}

// One start of playback. Every Play is a new session, even for the same item: it starts again with a fresh link.
export interface PlayerSession {
  id: number;
  track: DockTrack;
}

export interface PlayerValue {
  session: PlayerSession | null;
  play: (track: DockTrack) => void;
  close: () => void;
}

export const PlayerContext = createContext<PlayerValue | null>(null);

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider');
  return value;
}

// Lives inside the app shell, so the sound keeps playing while the person browses and stops when they sign out.
// Memory only: a page reload stops playback, and no link is ever stored.
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const play = useCallback((track: DockTrack) => setSession((previous) => ({ id: (previous?.id ?? 0) + 1, track })), []);
  const close = useCallback(() => setSession(null), []);
  const value = useMemo(() => ({ session, play, close }), [session, play, close]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
```

- [ ] **Step 3: The bar**

Create `apps/web/src/player/DockedPlayer.tsx`:

```tsx
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../api/client';
import { playItem } from '../api/media';
import { Button } from '../components/Button';
import { formatDuration } from '../lib/format';
import styles from './DockedPlayer.module.css';
import { type PlayerSession, usePlayer } from './PlayerContext';

const PLAYBACK_FAILED = 'This could not be played. Please try again later.';

const clock = (seconds: number | null): string => formatDuration(seconds === null ? null : Math.floor(seconds));

export function DockedPlayer() {
  const { session, close } = usePlayer();
  if (!session) return null;
  // A new start is a new bar: fresh state, a fresh audio element and exactly one new link.
  return <PlayerBar key={session.id} session={session} onClose={close} />;
}

function PlayerBar({ session, onClose }: { session: PlayerSession; onClose: () => void }) {
  const { track } = session;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Every link handed out is recorded in the audit log, so the development double-run of effects (StrictMode) must not
  // ask twice for the same start.
  const requested = useRef(false);
  const retried = useRef(false);
  const resumeAt = useRef(0);

  const fetchLink = useCallback(async () => {
    try {
      setSrc((await playItem(track.itemId)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [track.itemId]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void fetchLink();
  }, [fetchLink]);

  // Stops the sound when the bar goes away: Close, another track replacing this one, or signing out.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  function syncDuration() {
    const value = audioRef.current?.duration ?? Number.NaN;
    // Some files report no usable length (NaN, Infinity or 0): the slider then stays off.
    setDuration(Number.isFinite(value) && value > 0 ? value : null);
  }

  function onLoadedMetadata() {
    syncDuration();
    const audio = audioRef.current;
    if (!audio || resumeAt.current <= 0) return;
    audio.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void audio.play().catch(() => undefined);
  }

  // The link lasts one hour. If the audio stops loading (for example the link expired during a long pause) ask once for
  // a new link and carry on from the same position; a second failure in a row is shown with Try again.
  function onMediaError() {
    if (retried.current) {
      setSrc(null);
      setError(PLAYBACK_FAILED);
      return;
    }
    retried.current = true;
    resumeAt.current = audioRef.current?.currentTime ?? 0;
    void fetchLink();
  }

  // One track at a time: at the end the bar stays on it, back at the start, with Play to hear it again.
  function onEnded() {
    const audio = audioRef.current;
    setPlaying(false);
    if (audio) audio.currentTime = 0;
    setPosition(0);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => undefined);
  }

  function onSeek(event: ChangeEvent<HTMLInputElement>) {
    const to = Number(event.target.value);
    if (audioRef.current) audioRef.current.currentTime = to;
    setPosition(to);
  }

  function onVolume(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const level = Number(event.target.value);
    audio.volume = level;
    audio.muted = level === 0;
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (audio) audio.muted = !audio.muted;
  }

  function onVolumeChange() {
    const audio = audioRef.current;
    if (!audio) return;
    setVolume(audio.volume);
    setMuted(audio.muted);
  }

  function tryAgain() {
    retried.current = false;
    setError(null);
    void fetchLink();
  }

  const level = muted ? 0 : volume;

  return (
    <section className={styles.bar} aria-label="Player">
      <audio
        ref={audioRef}
        src={src ?? undefined}
        autoPlay
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={syncDuration}
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onPlaying={() => {
          retried.current = false;
        }}
        onEnded={onEnded}
        onError={onMediaError}
        onVolumeChange={onVolumeChange}
      />
      <div className={styles.info}>
        {track.coverUrl ? (
          <img className={styles.cover} src={track.coverUrl} alt="" />
        ) : (
          <span className={styles.glyph} aria-hidden="true">
            ♪
          </span>
        )}
        <div className={styles.text}>
          <p className={styles.title}>{track.title}</p>
          <p className={styles.place}>{`${track.categoryLabel} › ${track.folderName}`}</p>
        </div>
      </div>
      <div className={styles.transport}>
        {error ? (
          <>
            <p className={styles.error} role="alert">
              {error}
            </p>
            <Button variant="secondary" size="small" onClick={tryAgain}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button size="small" disabled={src === null} onClick={togglePlay}>
              {playing ? 'Pause' : 'Play'}
            </Button>
            <span className={styles.time}>{clock(position)}</span>
            <input
              className={styles.seek}
              type="range"
              aria-label="Seek"
              min={0}
              max={duration === null ? 0 : Math.floor(duration)}
              step={1}
              value={Math.floor(position)}
              disabled={duration === null}
              aria-valuetext={`${clock(position)} of ${clock(duration)}`}
              onChange={onSeek}
            />
            <span className={styles.time}>{clock(duration)}</span>
          </>
        )}
      </div>
      <div className={styles.volume}>
        <Button variant="secondary" size="small" aria-pressed={muted} onClick={toggleMute}>
          Mute
        </Button>
        <input
          className={styles.level}
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={level}
          aria-valuetext={`${Math.round(level * 100)}%`}
          onChange={onVolume}
        />
      </div>
      <div className={styles.close}>
        <Button variant="secondary" size="small" aria-label="Close player" onClick={onClose}>
          ✕
        </Button>
      </div>
    </section>
  );
}
```

Create `apps/web/src/player/DockedPlayer.module.css` (`--player-height` and `--player-offset` are defined in Task 8; until then the bar simply takes its natural height):

```css
.bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 9;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) minmax(16rem, 2fr) auto auto;
  grid-template-areas: 'info transport volume close';
  align-items: center;
  gap: var(--space-2) var(--space-4);
  height: var(--player-height);
  padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--color-border-strong);
  background: var(--color-bg);
  box-shadow: 0 -4px 16px rgb(15 42 51 / 0.18);
}

.info {
  grid-area: info;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.cover,
.glyph {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 4px;
}

.cover {
  object-fit: cover;
  background: var(--color-surface);
}

.glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--text-lg);
}

.text {
  min-width: 0;
}

.title,
.place {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-weight: 500;
}

.place {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.transport {
  grid-area: transport;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.time {
  flex: none;
  min-width: 3.5em;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.seek {
  flex: 1;
  min-width: 0;
}

.volume {
  grid-area: volume;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.level {
  width: 6rem;
}

.seek,
.level {
  accent-color: var(--color-primary);
}

.seek:focus-visible,
.level:focus-visible {
  outline: var(--focus-outline);
  outline-offset: 2px;
}

.close {
  grid-area: close;
}

.error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}

/* Phone: title and Close on top; the controls, the seek slider and the volume below. */
@media (max-width: 760px) {
  .bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'info close'
      'transport volume';
    padding: var(--space-3) var(--space-4);
  }

  .level {
    width: 4rem;
  }
}
```

There is no animation in the bar, so `prefers-reduced-motion` needs nothing extra.

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web -- DockedPlayer`
Expected: PASS (about 20 tests). If jsdom ever reports `Not implemented: HTMLMediaElement's ... method`, a test reached `play`, `pause` or `load` without the stubs in `beforeEach`; fix the test, not the component.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/player
git commit -m "feat: add the docked audio player with one link per start"
```

---

### Task 8: The docked player in the app shell: always there, room at the bottom, stops on sign-out

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/AppShell.module.css`, `apps/web/src/uploads/UploadPanel.module.css:2-4`, `apps/web/src/styles/tokens.css`
- Test: `apps/web/src/components/AppShell.spec.tsx`

**Existing tests to adapt:** none (the existing AppShell tests keep passing; the dock renders nothing until something plays).

**Interfaces:**
- Consumes: `PlayerProvider`, `usePlayer`, `DockTrack`, `DockedPlayer` (Task 7).
- Produces: `AppShell` renders `UploadsProvider > PlayerProvider > Shell`; the shell `<div>` gets `styles.withPlayer` while a session exists; tokens `--player-height` (4.5rem, 7.5rem on phones); `.withPlayer` defines `--player-offset: var(--player-height)` and the bottom padding; the upload panel sits at `bottom: calc(var(--space-4) + var(--player-offset, 0px))`.

- [ ] **Step 1: Failing tests**

In `apps/web/src/components/AppShell.spec.tsx` change the imports to:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { User } from '../api/auth';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { type DockTrack, usePlayer } from '../player/PlayerContext';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../test/session';
import { useUploads } from '../uploads/UploadsContext';
import { AppShell } from './AppShell';
import styles from './AppShell.module.css';
```

and add at the end of the file:

```tsx
const song: DockTrack = { itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null };
const SONG_LINK = 'https://cdn.example/s1?sig=1';

function PlayProbe() {
  const { play } = usePlayer();
  return (
    <>
      <button type="button" onClick={() => play(song)}>
        Start song
      </button>
      <Link to="/other">Go elsewhere</Link>
    </>
  );
}

function renderWithPlayer() {
  mockSession(ADMIN, (url, init) => {
    if (url === '/api/auth/logout') return { status: 204 };
    if (url === '/api/media/items/s1/play' && init.method === 'POST') {
      return { body: { url: SONG_LINK, expiresAt: '2026-10-09T11:00:00Z', contentType: 'audio/mpeg' } };
    }
    return { status: 404, body: {} };
  });
  return renderWithSession(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<PlayProbe />} />
          <Route path="/other" element={<h1>Other page</h1>} />
        </Route>
      </Route>
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
  );
}

async function startSong() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start song' }));
  await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute('src', SONG_LINK));
  return document.querySelector('audio') as HTMLAudioElement;
}

describe('AppShell and the docked player', () => {
  let pause: MockInstance<() => void>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  it('keeps playing while the person moves to another page', async () => {
    renderWithPlayer();
    const audio = await startSong();
    await userEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));
    expect(await screen.findByRole('heading', { name: 'Other page' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Player' })).toHaveTextContent('Morning song');
    expect(document.querySelector('audio')).toBe(audio);
    expect(pause).not.toHaveBeenCalled();
  });

  it('gives the page room at the bottom only while the bar shows', async () => {
    const { container } = renderWithPlayer();
    const shell = () => container.firstElementChild as HTMLElement;
    await screen.findByRole('button', { name: 'Start song' });
    expect(shell()).toHaveClass(styles.shell!);
    expect(shell()).not.toHaveClass(styles.withPlayer!);
    await startSong();
    expect(shell()).toHaveClass(styles.withPlayer!);
    await userEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(shell()).not.toHaveClass(styles.withPlayer!);
  });

  it('puts the player next to the upload panel, inside the shell', async () => {
    const { container } = renderWithPlayer();
    await startSong();
    expect(screen.getByRole('region', { name: 'Player' }).parentElement).toBe(container.firstElementChild);
  });

  it('stops and removes the player when the person signs out', async () => {
    renderWithPlayer();
    const audio = await startSong();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
    expect(pause.mock.contexts).toContain(audio);
  });
});
```

Run: `npm test -w @jbf/web -- AppShell`
Expected: FAIL (`usePlayer must be used inside PlayerProvider`).

- [ ] **Step 2: The shell**

Replace `apps/web/src/components/AppShell.tsx` with:

```tsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { User } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { DockedPlayer } from '../player/DockedPlayer';
import { PlayerProvider, usePlayer } from '../player/PlayerContext';
import { UploadPanel } from '../uploads/UploadPanel';
import { UploadsProvider } from '../uploads/UploadsContext';
import styles from './AppShell.module.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { NavLinks } from './NavLinks';

export function AppShell() {
  const { state, signOut } = useAuth();
  // Signing out unmounts everything below: uploads stop and the docked player stops.
  if (state.status !== 'authenticated') return null;
  return (
    <UploadsProvider>
      <PlayerProvider>
        <Shell user={state.user} onSignOut={() => void signOut()} />
      </PlayerProvider>
    </UploadsProvider>
  );
}

function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // While the docked player shows, the page gets room at the bottom so the bar never hides the last row.
  const { session } = usePlayer();

  return (
    <div className={session ? `${styles.shell} ${styles.withPlayer}` : styles.shell}>
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
          <Button variant="secondary" size="small" onClick={onSignOut}>
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
      <UploadPanel />
      <DockedPlayer />
    </div>
  );
}
```

- [ ] **Step 3: Room for the bar, and the upload panel above it**

Add to `apps/web/src/styles/tokens.css`, inside `:root` after `--radius`:

```css
  /* Height of the docked player bar; the page and the upload panel make room for it. */
  --player-height: 4.5rem;
```

and after the `:root` block:

```css
@media (max-width: 760px) {
  :root {
    /* Two rows on a phone. */
    --player-height: 7.5rem;
  }
}
```

Add to `apps/web/src/components/AppShell.module.css` after `.shell`:

```css
/* While the docked player shows: the page scrolls clear of the bar, and the upload panel (which reads
   --player-offset) sits above it. */
.withPlayer {
  --player-offset: var(--player-height);
  padding-bottom: var(--player-offset);
}
```

In `apps/web/src/uploads/UploadPanel.module.css` change `bottom: var(--space-4);` in `.panel` to:

```css
  bottom: calc(var(--space-4) + var(--player-offset, 0px));
```

and its `max-height: 60vh;` to `max-height: calc(60vh - var(--player-offset, 0px));` so the panel never grows under the top of the screen on a short phone screen.

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS (AppShell gains 4 tests). jsdom cannot check the visual layout; the manual check in Task 11 covers it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components apps/web/src/uploads/UploadPanel.module.css apps/web/src/styles/tokens.css
git commit -m "feat: mount the docked player in the app shell and make room for it"
```

---

### Task 9: Category pages, routes and the sidebar

**Files:**
- Create: `apps/web/src/media/categories.ts`, `apps/web/src/App.spec.tsx`
- Move (git mv): `apps/web/src/pages/videos/` → `apps/web/src/pages/media/`; inside it `VideosPage.tsx` → `CategoryPage.tsx`, `VideosPage.spec.tsx` → `CategoryPage.spec.tsx`, `VideosTable.tsx` → `ItemsTable.tsx`, `EditVideoDialog.tsx` → `EditItemDialog.tsx`, `Videos.module.css` → `Media.module.css`
- Modify: `apps/web/src/api/media.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/nav-items.ts`, `apps/web/src/pages/media/CategoryPage.tsx`, `apps/web/src/pages/media/FolderDialog.tsx`, `apps/web/src/pages/media/FolderPage.tsx`
- Test: `apps/web/src/api/media.spec.ts`, `apps/web/src/pages/media/CategoryPage.spec.tsx`, `apps/web/src/pages/media/FolderPage.spec.tsx`, `apps/web/src/components/AppShell.spec.tsx`, `apps/web/src/App.spec.tsx`

**Existing tests to adapt:** `api/media.spec.ts` (`'talks to the folder endpoints'` passes the slug `'videos'`; same URLs); `CategoryPage.spec.tsx` (the renamed `VideosPage.spec.tsx`: component name, `category={VIDEOS}`, `category: 'video'` on fixtures, the new `startServer` below; every assertion stays); `FolderPage.spec.tsx` (`VideoItem` → `MediaItem`, `category: 'video'` on the folder and item fixtures, `<FolderPage category={VIDEOS} />`; every assertion stays).

**Interfaces:**
- Consumes: `MediaKind` (Task 6).
- Produces:

```ts
// api/media.ts
type MediaCategory = 'video' | 'movie' | 'podcast' | 'song'
type CategorySlug = 'videos' | 'movies' | 'podcasts' | 'songs'
interface Folder { id; name; position; itemCount; category: MediaCategory }
interface MediaItem { ...the milestone 3 VideoItem fields...; category: MediaCategory }   // VideoItem is renamed
listFolders(slug: CategorySlug): Promise<Folder[]>
createFolder(slug: CategorySlug, name: string): Promise<Folder>
reorderFolders(slug: CategorySlug, ids: string[]): Promise<Folder[]>
// media/categories.ts
interface CategoryConfig { slug: CategorySlug; kind: MediaKind; label: string; noun: string; nounPlural: string; nounTitle: string }
const CATEGORIES: readonly CategoryConfig[]   // videos, movies, podcasts, songs in sidebar order
// pages/media
CategoryPage({ category }: { category: CategoryConfig })
FolderPage({ category }: { category: CategoryConfig })       // Task 10 completes it
FolderDialog({ slug, mode, onClose, onSaved })
// routes: /videos, /movies, /podcasts, /songs and /<slug>/:folderId
```

- [ ] **Step 1: Move the pages and rename the milestone 3 names**

```bash
cd apps/web/src
git mv pages/videos pages/media
git mv pages/media/VideosPage.tsx pages/media/CategoryPage.tsx
git mv pages/media/VideosPage.spec.tsx pages/media/CategoryPage.spec.tsx
git mv pages/media/VideosTable.tsx pages/media/ItemsTable.tsx
git mv pages/media/EditVideoDialog.tsx pages/media/EditItemDialog.tsx
git mv pages/media/Videos.module.css pages/media/Media.module.css
perl -pi -e "s#'\./Videos\.module\.css'#'./Media.module.css'#g; s/\bVideosPage\b/CategoryPage/g; s/\bVideosTableProps\b/ItemsTableProps/g; s/\bVideosTable\b/ItemsTable/g; s/\bEditVideoDialogProps\b/EditItemDialogProps/g; s/\bEditVideoDialog\b/EditItemDialog/g" pages/media/*.tsx
perl -pi -e 's/\bVideoItem\b/MediaItem/g' api/media.ts pages/media/*.tsx
cd ../../..
grep -rn "VideoItem\|VideosPage\|VideosTable\|EditVideoDialog\|Videos.module\|pages/videos" apps/web/src
```

Expected: the last command prints only lines of `App.tsx` (its two `./pages/videos/...` imports and the `<VideosPage />` route), which Step 4 replaces.

- [ ] **Step 2: Failing tests**

In `apps/web/src/api/media.spec.ts` replace the first test with:

```ts
  it('talks to the folder endpoints of the category it is given', async () => {
    const calls = record({ 'GET /api/media/videos/folders': [], 'POST /api/media/videos/folders': { id: 'f1' } });
    await listFolders('videos');
    await createFolder('videos', 'Safety');
    await renameFolder('f1', 'Safe');
    await reorderFolders('videos', ['b', 'a']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/media/videos/folders',
      'POST /api/media/videos/folders',
      'PATCH /api/media/folders/f1',
      'PUT /api/media/videos/folders/order',
    ]);
    expect(calls[1]?.body).toEqual({ name: 'Safety' });
    expect(calls[2]?.body).toEqual({ name: 'Safe' });
    expect(calls[3]?.body).toEqual({ ids: ['b', 'a'] });
  });

  it.each(['movies', 'podcasts', 'songs'] as const)('uses /api/media/%s for that category', async (slug) => {
    const calls = record({ [`GET /api/media/${slug}/folders`]: [], [`POST /api/media/${slug}/folders`]: { id: 'f1' } });
    await listFolders(slug);
    await createFolder(slug, 'Mix');
    await reorderFolders(slug, ['a']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET /api/media/${slug}/folders`,
      `POST /api/media/${slug}/folders`,
      `PUT /api/media/${slug}/folders/order`,
    ]);
  });
```

In `apps/web/src/pages/media/CategoryPage.spec.tsx`: change `import type { Folder } from '../../api/media';` to `import type { CategorySlug, Folder } from '../../api/media';`, add `import { CATEGORIES } from '../../media/categories';`, add `category: 'video'` to each of the three `fixture` folders, run `perl -pi -e 's#<CategoryPage />#<CategoryPage category={VIDEOS} />#g' apps/web/src/pages/media/CategoryPage.spec.tsx`, and replace `startServer` with (the routes come from the slug; everything else is as before):

```tsx
const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;
const PODCASTS = CATEGORIES.find((entry) => entry.slug === 'podcasts')!;

function startServer(overrides: Record<string, Override> = {}, initial: Folder[] = fixture, slug: CategorySlug = 'videos') {
  const base = `/api/media/${slug}/folders`;
  const state = { folders: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === `GET ${base}`) return { body: state.folders };
    if (key === `POST ${base}`) {
      const folder: Folder = { id: 'f-new', name: String(body.name), position: state.folders.length, itemCount: 0, category: initial[0]?.category ?? 'video' };
      state.folders.push(folder);
      return { status: 201, body: folder };
    }
    const rename = /^PATCH \/api\/media\/folders\/([^/]+)$/.exec(key);
    if (rename) {
      const folder = state.folders.find((candidate) => candidate.id === rename[1])!;
      folder.name = String(body.name);
      return { body: folder };
    }
    if (key === `PUT ${base}/order`) {
      const ids = body.ids as string[];
      state.folders = ids.map((id, index) => ({ ...state.folders.find((folder) => folder.id === id)!, position: index }));
      return { body: state.folders };
    }
    return { status: 404, body: {} };
  });
  return calls;
}
```

and add at the end of its `describe`:

```tsx
  it('shows a Songs page with its own words, links and endpoints', async () => {
    const songs: Folder[] = [
      { id: 's1', name: 'Road trip', position: 0, itemCount: 2, category: 'song' },
      { id: 's2', name: 'Calm', position: 1, itemCount: 0, category: 'song' },
    ];
    const calls = startServer({}, songs, 'songs');
    renderWithSession(<CategoryPage category={SONGS} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Songs' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Song folders' });
    expect(within(table).getByRole('columnheader', { name: 'Songs' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Open Road trip' })).toHaveAttribute('href', '/songs/s1');
    await userEvent.click(screen.getByRole('button', { name: 'Move Road trip down' }));
    await waitFor(() => expect(calls.find((call) => call.key === 'PUT /api/media/songs/folders/order')?.body).toEqual({ ids: ['s2', 's1'] }));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Party');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Folder "Party" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/media/songs/folders')?.body).toEqual({ name: 'Party' });
    expect(calls.some((call) => call.key.includes('/videos/'))).toBe(false);
  });

  it('invites the first podcast folder in its own words', async () => {
    startServer({}, [], 'podcasts');
    renderWithSession(<CategoryPage category={PODCASTS} />);
    expect(await screen.findByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText('Create a folder to start adding podcasts.')).toBeInTheDocument();
  });
```

In `apps/web/src/pages/media/FolderPage.spec.tsx`: add `import { CATEGORIES } from '../../media/categories';` and, after the imports, `const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;`; change the folder fixture to `const folder: Folder = { id: 'f1', name: 'Safety Training', position: 0, itemCount: 3, category: 'video' };`; add `category: 'video',` to the defaults in `item()` (after `position: 0,`); and change the route in `UploadsHarness` to `<Route path="/videos/:folderId" element={<FolderPage category={VIDEOS} />} />`.

In `apps/web/src/components/AppShell.spec.tsx` add to the first `describe('AppShell', ...)`:

```tsx
  it('lists the four media categories after the Dashboard, for everyone', async () => {
    renderShell(STAFF);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent).slice(0, 5)).toEqual(['Dashboard', 'Videos', 'Movies', 'Podcasts', 'Songs']);
    for (const [name, href] of [
      ['Videos', '/videos'],
      ['Movies', '/movies'],
      ['Podcasts', '/podcasts'],
      ['Songs', '/songs'],
    ]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });
```

Create `apps/web/src/App.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { mockSession, renderWithSession, STAFF } from './test/session';

describe('App routes for the media categories', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each([
    ['/videos', 'Videos'],
    ['/movies', 'Movies'],
    ['/podcasts', 'Podcasts'],
    ['/songs', 'Songs'],
  ])("%s lists that category's folders", async (path, heading) => {
    const fetchMock = mockSession(STAFF, (url) => (url === `/api/media${path}/folders` ? { body: [] } : { status: 404, body: {} }));
    renderWithSession(<App />, path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/media${path}/folders`);
  });

  it('opens a folder inside its category', async () => {
    mockSession(STAFF, (url) => {
      if (url === '/api/media/songs/folders') return { body: [{ id: 'f9', name: 'Road trip', position: 0, itemCount: 0, category: 'song' }] };
      if (url === '/api/media/folders/f9/items') return { body: [] };
      if (url === '/api/media/uploads/mine') return { body: [] };
      return { status: 404, body: {} };
    });
    renderWithSession(<App />, '/songs/f9');
    expect(await screen.findByRole('heading', { level: 1, name: 'Road trip' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Songs' })).toHaveAttribute('href', '/songs');
  });

  it('shows the not-found page for a category that does not exist', async () => {
    mockSession(STAFF);
    renderWithSession(<App />, '/music');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @jbf/web -- media.spec CategoryPage FolderPage AppShell App.spec`
Expected: FAIL (the client still has fixed `/videos/` URLs, no `categories.ts`, no category routes).

- [ ] **Step 3: The category table and the client**

Create `apps/web/src/media/categories.ts`:

```ts
import type { CategorySlug } from '../api/media';
import type { MediaKind } from '../uploads/limits';

export interface CategoryConfig {
  slug: CategorySlug;
  kind: MediaKind;
  // The words the pages use: "Songs" (headings, links, the count column), "song" and "songs" (sentences),
  // "Song" (table names and the first column).
  label: string;
  noun: string;
  nounPlural: string;
  nounTitle: string;
}

// The four media categories, in sidebar order: the web copy of the server's table (apps/api/src/media/media-kinds.ts).
// The kind decides the file rules (uploads/limits.ts) and the player: the pop-up for video, the docked player for audio.
export const CATEGORIES: readonly CategoryConfig[] = [
  { slug: 'videos', kind: 'video', label: 'Videos', noun: 'video', nounPlural: 'videos', nounTitle: 'Video' },
  { slug: 'movies', kind: 'video', label: 'Movies', noun: 'movie', nounPlural: 'movies', nounTitle: 'Movie' },
  { slug: 'podcasts', kind: 'audio', label: 'Podcasts', noun: 'podcast', nounPlural: 'podcasts', nounTitle: 'Podcast' },
  { slug: 'songs', kind: 'audio', label: 'Songs', noun: 'song', nounPlural: 'songs', nounTitle: 'Song' },
];
```

In `apps/web/src/api/media.ts` add after the import:

```ts
export type MediaCategory = 'video' | 'movie' | 'podcast' | 'song';
export type CategorySlug = 'videos' | 'movies' | 'podcasts' | 'songs';
```

add `category: MediaCategory;` as the last field of `Folder` and of `MediaItem`, and replace the three folder functions:

```ts
export const listFolders = (slug: CategorySlug): Promise<Folder[]> => api<Folder[]>(`/api/media/${slug}/folders`);

export const createFolder = (slug: CategorySlug, name: string): Promise<Folder> =>
  api<Folder>(`/api/media/${slug}/folders`, { method: 'POST', body: { name } });
```

```ts
export const reorderFolders = (slug: CategorySlug, ids: string[]): Promise<Folder[]> =>
  api<Folder[]>(`/api/media/${slug}/folders/order`, { method: 'PUT', body: { ids } });
```

- [ ] **Step 4: Routes and the sidebar**

Replace `apps/web/src/App.tsx` with:

```tsx
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { AppShell } from './components/AppShell';
import { CATEGORIES } from './media/categories';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AccountPage } from './pages/account/AccountPage';
import { AuditPage } from './pages/audit/AuditPage';
import { CategoryPage } from './pages/media/CategoryPage';
import { FolderPage } from './pages/media/FolderPage';
import { StaffPage } from './pages/staff/StaffPage';

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
          {/* The key gives each category its own page state when moving between, say, Videos and Songs. */}
          {CATEGORIES.map((category) => (
            <Route key={category.slug} path={`/${category.slug}`} element={<CategoryPage key={category.slug} category={category} />} />
          ))}
          {CATEGORIES.map((category) => (
            <Route
              key={`${category.slug}/folder`}
              path={`/${category.slug}/:folderId`}
              element={<FolderPage key={category.slug} category={category} />}
            />
          ))}
          <Route path="/account" element={<AccountPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

Replace `apps/web/src/components/nav-items.ts` with:

```ts
import { CATEGORIES } from '../media/categories';

export interface NavItem {
  to: string;
  label: string;
  group: 'main' | 'admin' | 'account';
  adminOnly?: boolean;
  end?: boolean;
}

// Pages appear here only once they exist. Later tasks append their entries.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', group: 'main', end: true },
  ...CATEGORIES.map((category): NavItem => ({ to: `/${category.slug}`, label: category.label, group: 'main' })),
  { to: '/staff', label: 'Staff', group: 'admin', adminOnly: true },
  { to: '/audit', label: 'Audit log', group: 'admin', adminOnly: true },
  { to: '/account', label: 'My account', group: 'account' },
];

export const NAV_GROUPS: { id: NavItem['group']; label: string | null }[] = [
  { id: 'main', label: null },
  { id: 'admin', label: 'Admin' },
  { id: 'account', label: 'Account' },
];
```

- [ ] **Step 5: The category page and the folder dialog**

Replace `apps/web/src/pages/media/CategoryPage.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../api/client';
import { type Folder, listFolders, reorderFolders } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Table } from '../../components/Table';
import type { CategoryConfig } from '../../media/categories';
import { FolderDialog, type FolderDialogMode } from './FolderDialog';
import styles from './Media.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

// The folders of one category (Videos, Movies, Podcasts or Songs).
export function CategoryPage({ category }: { category: CategoryConfig }) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setFolders(await listFolders(category.slug));
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, [category.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(index: number, delta: -1 | 1) {
    if (!folders) return;
    const ids = folders.map((folder) => folder.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setFolders(await reorderFolders(category.slug, ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function onSaved(folder: Folder, kind: FolderDialogMode['kind']) {
    setDialog(null);
    setNotice({ tone: 'success', text: kind === 'create' ? `Folder "${folder.name}" created.` : `Folder renamed to "${folder.name}".` });
    void load();
  }

  return (
    <>
      <div className={styles.header}>
        <h1>{category.label}</h1>
        <Button onClick={() => setDialog({ kind: 'create' })}>New folder</Button>
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
      ) : folders === null ? (
        <Skeleton />
      ) : folders.length === 0 ? (
        <EmptyState title="No folders yet">{`Create a folder to start adding ${category.nounPlural}.`}</EmptyState>
      ) : (
        <Table caption={`${category.nounTitle} folders`}>
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">{category.label}</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((folder, index) => (
              <tr key={folder.id}>
                <td data-label="Folder">
                  <Link className={styles.name} to={`/${category.slug}/${folder.id}`}>
                    {folder.name}
                  </Link>
                </td>
                <td data-label={category.label}>{folder.itemCount}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Link className={styles.link} to={`/${category.slug}/${folder.id}`} aria-label={`Open ${folder.name}`}>
                      Open
                    </Link>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${folder.name}`} onClick={() => setDialog({ kind: 'rename', folder })}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || index === 0} aria-label={`Move ${folder.name} up`} onClick={() => void move(index, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || index === folders.length - 1}
                      aria-label={`Move ${folder.name} down`}
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

      <FolderDialog slug={category.slug} mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
```

In `apps/web/src/pages/media/FolderDialog.tsx`: change the media import to `import { type CategorySlug, createFolder, type Folder, renameFolder } from '../../api/media';`, add `slug: CategorySlug;` as the first field of `FolderDialogProps`, change the component to

```tsx
export function FolderDialog({ slug, mode, onClose, onSaved }: FolderDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode?.kind === 'rename' ? 'Rename folder' : 'New folder'} blocked={busy}>
      {mode ? <FolderForm slug={slug} mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}
```

change `FolderForm`'s parameters to `{ slug, mode, busy, setBusy, onClose, onSaved }: Pick<FolderDialogProps, 'slug' | 'onClose' | 'onSaved'> & { mode: FolderDialogMode; busy: boolean; setBusy: (busy: boolean) => void }`, and the save call to `const saved = mode.kind === 'rename' ? await renameFolder(mode.folder.id, trimmed) : await createFolder(slug, trimmed);`.

- [ ] **Step 6: The folder page knows its category (wording and players follow in Task 10)**

In `apps/web/src/pages/media/FolderPage.tsx` add `import type { CategoryConfig } from '../../media/categories';`, and change:

```tsx
export function FolderPage({ category }: { category: CategoryConfig }) {
```

```tsx
      const [folders, loaded] = await Promise.all([listFolders(category.slug), listItems(folderId)]);
```

```tsx
  }, [category.slug, folderId]);
```

```tsx
      <EmptyState title="Folder not found">
        <Link to={`/${category.slug}`}>{`Back to ${category.label}`}</Link>
      </EmptyState>
```

```tsx
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to={`/${category.slug}`}>{category.label}</Link> › {folder?.name ?? ''}
      </nav>
```

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS; every milestone 3 Videos page test passes with the same assertions.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src
git commit -m "feat: add Movies, Podcasts and Songs pages and sidebar links"
```

---

### Task 10: Folder pages per category: words, upload rules, and Play on audio rows starts the dock

**Files:**
- Modify: `apps/web/src/pages/media/FolderPage.tsx`, `apps/web/src/pages/media/ItemsTable.tsx`, `apps/web/src/pages/media/UploadDialog.tsx`, `apps/web/src/pages/media/EditItemDialog.tsx`, `apps/web/src/pages/media/PendingUploads.tsx`, `apps/web/src/pages/media/Media.module.css`
- Test: `apps/web/src/pages/media/FolderPage.spec.tsx`, `apps/web/src/pages/media/UploadDialog.spec.tsx`, `apps/web/src/pages/media/PendingUploads.spec.tsx`

**Existing tests to adapt:** `FolderPage.spec.tsx` (the harness also provides a `PlayerContext` value and takes the category; `startServer` takes the slug; every assertion stays); `UploadDialog.spec.tsx` (`setup` passes `category`, the dialog is found by `Upload ${category.noun}`; every assertion stays); `PendingUploads.spec.tsx` (`category={VIDEOS}` on both renders; every assertion stays).

**Interfaces:**
- Consumes: `CategoryConfig`, `CATEGORIES` (Task 9); `usePlayer`, `PlayerContext`, `PlayerValue`, `PlayerProvider`, `DockedPlayer`, `DockTrack` (Task 7); `checkMediaFile`, `MEDIA_KINDS`, `MAX_AUDIO_BYTES` (Task 6); `readDuration(file, kind)` (Task 6).
- Produces:

```ts
ItemsTable({ category, items, busy, progress, onPlay, onEdit, onMove })   // onOpen is renamed onPlay
UploadDialog({ open, category, folderId, onClose, onStarted })
EditItemDialog({ noun, item, onClose, onChanged })
PendingUploads({ category, folderId, reloadKey, onChanged })
// FolderPage: video kinds -> PlayerDialog; audio kinds -> usePlayer().play({ itemId, title, categoryLabel: category.label, folderName, coverUrl })
```

- [ ] **Step 1: Failing tests**

In `apps/web/src/pages/media/FolderPage.spec.tsx` replace the imports with:

```tsx
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorySlug, Folder, MediaItem } from '../../api/media';
import { type CategoryConfig, CATEGORIES } from '../../media/categories';
import { DockedPlayer } from '../../player/DockedPlayer';
import { PlayerContext, PlayerProvider, type PlayerValue } from '../../player/PlayerContext';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { FolderPage } from './FolderPage';

const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const MOVIES = CATEGORIES.find((entry) => entry.slug === 'movies')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;
```

(remove the `const VIDEOS = ...` line added in Task 9, which this replaces). Change `startServer`'s signature to `function startServer(overrides: Record<string, Override> = {}, items: MediaItem[] = fixture, folders: Folder[] = [folder], slug: CategorySlug = 'videos')` and its folder line to ``if (key === `GET /api/media/${slug}/folders`) return { body: folders };``. Replace everything from `let setUploads` down to the end of `renderPageInStrictMode` with:

```tsx
const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

let setUploads: (value: UploadsValue) => void = () => undefined;

function UploadsHarness({ initial, category, player }: { initial: UploadsValue; category: CategoryConfig; player: PlayerValue }) {
  const [value, setValue] = useState(initial);
  setUploads = setValue;
  return (
    <UploadsContext.Provider value={value}>
      <PlayerContext.Provider value={player}>
        <Routes>
          <Route path={`/${category.slug}/:folderId`} element={<FolderPage category={category} />} />
        </Routes>
      </PlayerContext.Provider>
    </UploadsContext.Provider>
  );
}

function renderPage(route = '/videos/f1', uploads: UploadsValue = fakeUploads(), category: CategoryConfig = VIDEOS, player: PlayerValue = fakePlayer()) {
  return renderWithSession(<UploadsHarness initial={uploads} category={category} player={player} />, route);
}

function renderPageInStrictMode() {
  return renderWithSession(
    <StrictMode>
      <UploadsHarness initial={fakeUploads()} category={VIDEOS} player={fakePlayer()} />
    </StrictMode>,
    '/videos/f1',
  );
}
```

and append at the end of the file:

```tsx
describe('FolderPage for the other categories', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const songFolder: Folder = { id: 'f1', name: 'Road trip', position: 0, itemCount: 2, category: 'song' };
  const songs: MediaItem[] = [
    item({ id: 's1', title: 'Morning song', category: 'song', durationSeconds: 185, sizeBytes: 6 * 1024 ** 2 }),
    item({ id: 's2', title: '<img src=x onerror=alert(1)>', category: 'song', position: 1 }),
  ];
  const songLink = { body: { url: 'https://cdn.example/s1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'audio/mpeg' } };

  it('uses the words of the category and shows a ♪ for songs without a cover', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Songs' })).toHaveAttribute('href', '/songs');
    expect(screen.getByRole('button', { name: 'Upload song' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Songs in this folder' });
    expect(within(table).getByRole('columnheader', { name: 'Song' })).toBeInTheDocument();
    expect(within(table).getAllByText('♪')).toHaveLength(2);
    expect(within(table).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('says so in its own words when a songs folder is empty or missing', async () => {
    startServer({}, [], [songFolder], 'songs');
    const first = renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByText('No songs in this folder yet')).toBeInTheDocument();
    expect(screen.getByText('Songs you upload here will appear in this list.')).toBeInTheDocument();
    first.unmount();

    startServer({ 'GET /api/media/folders/f1/items': { status: 404, body: { message: 'Folder not found.' } } }, [], [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByText('Folder not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Songs' })).toHaveAttribute('href', '/songs');
  });

  it('starts a song in the docked player from its Play button, with no pop-up and no request of its own', async () => {
    const player = fakePlayer();
    const calls = startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS, player);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Morning song' }));
    expect(player.play).toHaveBeenCalledWith({ itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Morning song' })).toBeNull();
    await userEvent.click(screen.getByText('3:05'));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.key.endsWith('/play'))).toBe(false);
  });

  it('plays a song in the real docked player with one link and the folder named', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const calls = startServer({ 'POST /api/media/items/s1/play': songLink }, songs, [songFolder], 'songs');
    renderWithSession(
      <UploadsContext.Provider value={fakeUploads()}>
        <PlayerProvider>
          <Routes>
            <Route path="/songs/:folderId" element={<FolderPage category={SONGS} />} />
          </Routes>
          <DockedPlayer />
        </PlayerProvider>
      </UploadsContext.Provider>,
      '/songs/f1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Play Morning song' }));
    const bar = await screen.findByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Songs › Road trip')).toBeInTheDocument();
    await waitFor(() => expect(bar.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/s1?sig=1'));
    expect(calls.filter((call) => call.key === 'POST /api/media/items/s1/play')).toHaveLength(1);
  });

  it('opens a movie in the pop-up player, like a video, and never in the dock', async () => {
    const player = fakePlayer();
    const movieFolder: Folder = { id: 'f1', name: 'Classics', position: 0, itemCount: 1, category: 'movie' };
    startServer(
      { 'POST /api/media/items/m1/play': { body: { url: 'https://cdn.example/m1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'video/mp4' } } },
      [item({ id: 'm1', title: 'The long walk', category: 'movie' })],
      [movieFolder],
      'movies',
    );
    renderPage('/movies/f1', fakeUploads(), MOVIES, player);
    await userEvent.click(await screen.findByRole('button', { name: 'The long walk' }));
    const dialog = await screen.findByRole('dialog', { name: 'The long walk' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/m1?sig=1'));
    expect(screen.queryByRole('button', { name: 'Play The long walk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload movie' })).toBeInTheDocument();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('edits a song in a dialog named for it', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Morning song' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit song' });
    await userEvent.type(within(dialog).getByLabelText('Title'), ' (live)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Song saved.')).toBeInTheDocument();
  });

  it('opens the upload dialog for songs with the audio rules', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload song' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload song' });
    expect(within(dialog).getByLabelText('Song file (MP3 or M4A, up to 500 MB)')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
  });
});
```

In `apps/web/src/pages/media/UploadDialog.spec.tsx` change the limits import to `import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from '../../uploads/limits';`, add `import { type CategoryConfig, CATEGORIES } from '../../media/categories';` and, after `vi.mock(...)`, `const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;` and `const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;`. Replace `setup` with:

```tsx
function setup(start: UploadsValue['start'] = vi.fn(async () => undefined), category: CategoryConfig = VIDEOS) {
  mockSession(STAFF);
  const value: UploadsValue = { jobs: [], finishedCount: 0, start, resume: vi.fn(), retry: vi.fn(), cancel: vi.fn(), dismiss: vi.fn() };
  const onClose = vi.fn();
  const onStarted = vi.fn();
  renderWithSession(
    <UploadsContext.Provider value={value}>
      <UploadDialog open category={category} folderId="f1" onClose={onClose} onStarted={onStarted} />
    </UploadsContext.Provider>,
  );
  const dialog = screen.getByRole('dialog', { name: `Upload ${category.noun}` });
  return { dialog, start, onClose, onStarted };
}
```

and append:

```tsx
describe('UploadDialog for songs', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('offers MP3 and M4A up to 500 MB under the name of the category', () => {
    const { dialog } = setup(undefined, SONGS);
    expect(within(dialog).getByLabelText('Song file (MP3 or M4A, up to 500 MB)')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
  });

  it('starts an MP3 with its type, reading its length with an audio element', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    vi.mocked(readDuration).mockClear();
    const file = new File([new Uint8Array(10)], 'Morning song.mp3', { type: 'audio/mpeg' });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), file);
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Morning song');
    expect(readDuration).toHaveBeenCalledWith(file, 'audio');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ file, folderId: 'f1', contentType: 'audio/mpeg', title: 'Morning song', durationSeconds: 42 })),
    );
  });

  it('declares an M4A that the system calls audio/x-m4a as audio/mp4', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const file = new File([new Uint8Array(10)], 'Talk.m4a', { type: 'audio/x-m4a' });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ file, contentType: 'audio/mp4' })));
  });

  it('refuses raw AAC and video files with the audio message and sends nothing', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const input = within(dialog).getByLabelText(/Song file/);
    await userEvent.upload(input, new File(['x'], 'raw.aac', { type: 'audio/aac' }), { applyAccept: false });
    expect(await within(dialog).findByText('Only MP3 or M4A audio files can be uploaded here.')).toBeInTheDocument();
    await userEvent.upload(input, new File(['x'], 'clip.mp4', { type: 'video/mp4' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(within(dialog).getByText('Only MP3 or M4A audio files can be uploaded here.')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a song over 500 MB', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const big = new File(['x'], 'long.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), big);
    expect(await within(dialog).findByText('Audio files can be at most 500 MB. Choose a smaller file.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
  });

  it('asks for a song file before sending anything', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a song file.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Song file/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });
});
```

In `apps/web/src/pages/media/PendingUploads.spec.tsx` add `import { type CategoryConfig, CATEGORIES } from '../../media/categories';` and `const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;` and `const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;`; give `setup` a fourth parameter `category: CategoryConfig = VIDEOS` and render `<PendingUploads category={category} folderId="f1" reloadKey={0} onChanged={onChanged} />`; add `category={VIDEOS}` to the `<PendingUploads ... />` in the last test; and add:

```tsx
  it('asks for the kind of file the folder takes, in its words', async () => {
    const { view } = setup([pending({ fileId: 'a', fileName: 'song.mp3' })], [], {}, SONGS);
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    expect(view.container.querySelector('input[type="file"]')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
    expect(screen.getByRole('columnheader', { name: 'Song' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel upload of Fire exits' }));
    expect(screen.getByRole('dialog', { name: 'Cancel this upload?' })).toHaveTextContent('You can upload the song again later.');
  });
```

Run: `npm test -w @jbf/web -- FolderPage UploadDialog PendingUploads`
Expected: FAIL (no `category` props, no Play button, video words everywhere).

- [ ] **Step 2: The folder page**

Replace `apps/web/src/pages/media/FolderPage.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type Folder, listFolders, listItems, type MediaItem, reorderItems } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import type { CategoryConfig } from '../../media/categories';
import { usePlayer } from '../../player/PlayerContext';
import { useUploads } from '../../uploads/UploadsContext';
import { EditItemDialog } from './EditItemDialog';
import { ItemsTable } from './ItemsTable';
import styles from './Media.module.css';
import { PendingUploads } from './PendingUploads';
import { PlayerDialog } from './PlayerDialog';
import { UploadDialog } from './UploadDialog';

type Notice = { tone: 'error' | 'success'; text: string };

export function FolderPage({ category }: { category: CategoryConfig }) {
  const { folderId = '' } = useParams();
  const uploads = useUploads();
  const player = usePlayer();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<MediaItem | null>(null);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [folders, loaded] = await Promise.all([listFolders(category.slug), listItems(folderId)]);
      const found = folders.find((candidate) => candidate.id === folderId) ?? null;
      setMissing(found === null);
      setFolder(found);
      setItems(loaded);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [category.slug, folderId]);

  useEffect(() => {
    void load();
  }, [load, uploads.finishedCount]);

  const progress = Object.fromEntries(
    uploads.jobs
      .filter((job) => job.folderId === folderId && job.status === 'sending' && job.sizeBytes > 0)
      .map((job) => [job.itemId, Math.floor((100 * job.bytesSent) / job.sizeBytes)]),
  );

  async function move(item: MediaItem, delta: -1 | 1) {
    if (!items) return;
    const ids = items.filter((candidate) => candidate.status === 'ready').map((candidate) => candidate.id);
    const index = ids.indexOf(item.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setBusy(true);
    setNotice(null);
    try {
      setItems(await reorderItems(folderId, ids));
    } catch (error) {
      setNotice({ tone: 'error', text: describeError(error) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Videos and movies open the pop-up player. Podcasts and songs play in the docked player, which keeps playing while
  // the person browses; it asks for the playback link itself.
  function onPlay(item: MediaItem) {
    if (category.kind === 'video') {
      setPlaying(item);
      return;
    }
    player.play({ itemId: item.id, title: item.title, categoryLabel: category.label, folderName: folder?.name ?? '', coverUrl: item.coverUrl });
  }

  if (missing) {
    return (
      <EmptyState title="Folder not found">
        <Link to={`/${category.slug}`}>{`Back to ${category.label}`}</Link>
      </EmptyState>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to={`/${category.slug}`}>{category.label}</Link> › {folder?.name ?? ''}
      </nav>
      <div className={styles.header}>
        <h1>{folder?.name ?? 'Folder'}</h1>
        <Button onClick={() => setUploading(true)}>{`Upload ${category.noun}`}</Button>
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
      ) : items === null ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState title={`No ${category.nounPlural} in this folder yet`}>{`${category.label} you upload here will appear in this list.`}</EmptyState>
      ) : (
        <ItemsTable
          category={category}
          items={items}
          busy={busy}
          progress={progress}
          onPlay={onPlay}
          onEdit={setEditing}
          onMove={(item, delta) => void move(item, delta)}
        />
      )}

      <PendingUploads category={category} folderId={folderId} reloadKey={uploads.finishedCount} onChanged={() => void load()} />

      <PlayerDialog item={playing} onClose={() => setPlaying(null)} />
      <UploadDialog open={uploading} category={category} folderId={folderId} onClose={() => setUploading(false)} onStarted={() => void load()} />
      <EditItemDialog
        noun={category.noun}
        item={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setNotice({ tone: 'success', text: `${category.nounTitle} saved.` });
          void load();
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: The items table**

Replace `apps/web/src/pages/media/ItemsTable.tsx` with:

```tsx
import type { MediaItem } from '../../api/media';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import type { CategoryConfig } from '../../media/categories';
import styles from './Media.module.css';

interface ItemsTableProps {
  category: CategoryConfig;
  items: MediaItem[];
  busy: boolean;
  // Percent sent for items being uploaded from this browser right now, by item id.
  progress: Record<string, number>;
  onPlay: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onMove: (item: MediaItem, delta: -1 | 1) => void;
}

export function ItemsTable({ category, items, busy, progress, onPlay, onEdit, onMove }: ItemsTableProps) {
  // Only ready items can be ordered; an item that is still uploading keeps its place until it finishes.
  const ready = items.filter((item) => item.status === 'ready');
  // Video rows open the pop-up from the title or anywhere on the row. Audio rows have a Play button for the docked
  // player instead, so a stray click on a row never starts sound.
  const isVideo = category.kind === 'video';

  return (
    <Table caption={`${category.label} in this folder`}>
      <thead>
        <tr>
          <th scope="col">{category.nounTitle}</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Added</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isReady = item.status === 'ready';
          const opensOnClick = isReady && isVideo;
          const readyIndex = ready.indexOf(item);
          const percent = progress[item.id];
          return (
            <tr key={item.id} className={opensOnClick ? styles.clickable : undefined} onClick={opensOnClick ? () => onPlay(item) : undefined}>
              <td data-label={category.nounTitle}>
                <div className={styles.itemCell}>
                  {item.coverUrl ? (
                    <img className={styles.cover} src={item.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.coverPlaceholder} aria-hidden="true">
                      {!isReady ? '⏳' : isVideo ? '▶' : '♪'}
                    </span>
                  )}
                  <div>
                    {opensOnClick ? (
                      <button type="button" className={styles.titleButton} onClick={() => onPlay(item)}>
                        {item.title}
                      </button>
                    ) : (
                      <>
                        <span className={styles.name}>{item.title}</span>
                        {isReady ? null : <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>}
                      </>
                    )}
                  </div>
                </div>
              </td>
              <td data-label="Length">{isReady ? formatDuration(item.durationSeconds) : '—'}</td>
              <td data-label="Size">{formatBytes(item.sizeBytes)}</td>
              <td data-label="Added">
                {item.createdBy.name} · {formatDate(item.createdAt)}
              </td>
              <td data-label="Actions" onClick={(event) => event.stopPropagation()}>
                {isReady ? (
                  <div className={styles.actions}>
                    {isVideo ? null : (
                      <Button size="small" aria-label={`Play ${item.title}`} onClick={() => onPlay(item)}>
                        Play
                      </Button>
                    )}
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => onEdit(item)}>
                      Edit
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || readyIndex === 0} aria-label={`Move ${item.title} up`} onClick={() => onMove(item, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || readyIndex === ready.length - 1}
                      aria-label={`Move ${item.title} down`}
                      onClick={() => onMove(item, 1)}
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

In `apps/web/src/pages/media/Media.module.css` rename the class `.videoCell` to `.itemCell` (the rule body is unchanged).

- [ ] **Step 4: The upload dialog follows the category**

Replace `apps/web/src/pages/media/UploadDialog.tsx` with:

```tsx
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import type { CategoryConfig } from '../../media/categories';
import { readDuration } from '../../uploads/duration';
import { checkCoverFile, checkMediaFile, MEDIA_KINDS } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import styles from './Media.module.css';

interface UploadDialogProps {
  open: boolean;
  category: CategoryConfig;
  folderId: string;
  onClose: () => void;
  // Called once the server has accepted the upload (sending continues in the background).
  onStarted: () => void;
}

export function UploadDialog({ open, category, folderId, onClose, onStarted }: UploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={`Upload ${category.noun}`} blocked={busy}>
      <UploadForm category={category} folderId={folderId} busy={busy} setBusy={setBusy} onClose={onClose} onStarted={onStarted} />
    </Dialog>
  );
}

type Field = 'file' | 'title' | 'description' | 'cover';
type Errors = Partial<Record<Field, string>>;

function UploadForm({
  category,
  folderId,
  busy,
  setBusy,
  onClose,
  onStarted,
}: Pick<UploadDialogProps, 'category' | 'folderId' | 'onClose' | 'onStarted'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const uploads = useUploads();
  const rule = MEDIA_KINDS[category.kind];
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const titleTouched = useRef(false);
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  // The length is read in the background while the person fills in the form; submitting waits for it.
  const duration = useRef<Promise<number | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!focusRequest) return;
    const targets = { file: fileRef, title: titleRef, description: descriptionRef, cover: coverRef };
    targets[focusRequest.field].current?.focus();
  }, [focusRequest]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    const check = chosen ? checkMediaFile(category.kind, chosen) : null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: check && !check.ok ? check.problem : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    // A file that will be refused is never opened in a media element (an <audio> element for audio, <video> otherwise).
    duration.current = chosen && check?.ok ? readDuration(chosen, category.kind) : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const check = file ? checkMediaFile(category.kind, file) : null;
    const next: Errors = {
      file: check === null ? `Choose a ${category.noun} file.` : check.ok ? undefined : check.problem,
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    const first = (['file', 'title', 'cover'] as const).find((field) => next[field]);
    if (first || !file || !check || !check.ok) {
      setFocusRequest({ field: first ?? 'file' });
      return;
    }
    setBusy(true);
    try {
      await uploads.start({ file, folderId, contentType: check.contentType, title: title.trim(), description, durationSeconds: await duration.current, cover });
      onStarted();
      onClose();
    } catch (caught) {
      const fields = caught instanceof ApiError ? caught.fieldErrors : {};
      const fromServer: Errors = {
        file: (fields.sizeBytes ?? fields.contentType ?? fields.fileName)?.join(' '),
        title: fields.title?.join(' '),
        description: fields.description?.join(' '),
      };
      if (fromServer.file || fromServer.title || fromServer.description) {
        setErrors(fromServer);
        setFocusRequest({ field: fromServer.file ? 'file' : fromServer.title ? 'title' : 'description' });
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
        label={`${category.nounTitle} file (${rule.formats})`}
        type="file"
        accept={rule.accept}
        data-autofocus
        hint="You can keep working while it uploads; progress shows in the corner. Keep this tab open until it finishes."
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
      <TextArea ref={descriptionRef} label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <TextField
        ref={coverRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hint="Optional. JPEG, PNG or WebP, up to 10 MB."
        onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        error={errors.cover}
      />
      <div className={styles.dialogActions}>
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

- [ ] **Step 5: The edit dialog and the resume list name the category**

In `apps/web/src/pages/media/EditItemDialog.tsx` add `noun: string;` as the first field of `EditItemDialogProps` (with the comment `// "video", "song", ...: the dialog is called "Edit song".`) and change the component to:

```tsx
export function EditItemDialog({ noun, item, onClose, onChanged }: EditItemDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={item !== null} onClose={onClose} title={`Edit ${noun}`} blocked={busy}>
      {item ? <EditForm item={item} busy={busy} setBusy={setBusy} onClose={onClose} onChanged={onChanged} /> : null}
    </Dialog>
  );
}
```

In `apps/web/src/pages/media/PendingUploads.tsx` add `import type { CategoryConfig } from '../../media/categories';`, add `category: CategoryConfig;` as the first field of `PendingUploadsProps`, take it in the parameters (`{ category, folderId, reloadKey, onChanged }`), and change:

```tsx
      <input ref={inputRef} type="file" accept={MEDIA_KINDS[category.kind].accept} hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} />
```

```tsx
              <th scope="col">{category.nounTitle}</th>
```

```tsx
                <td data-label={category.nounTitle}>
```

```tsx
        {cancelling ? `What was already sent of "${cancelling.title}" will be discarded. You can upload the ${category.noun} again later.` : ''}
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: all PASS. `grep -rn "'video'" apps/web/src/pages/media` prints only `category.kind === 'video'` lines in `FolderPage.tsx` and `ItemsTable.tsx`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/media
git commit -m "feat: make folder pages category-aware and play podcasts and songs in the dock"
```

---

### Task 11: Documentation and the final checks

**Files:**
- Modify: `docs/api/media.md`, `docs/api/audit.md`, `docs/storage.md`, `ARCHITECTURE.md`, `README.md`, `DECISIONS.md`, `PROGRESS.md`, `CHANGELOG.md`

**Interfaces:** none (documentation only). Read each file first and edit it in its existing style: dated one-line bullets in `CHANGELOG.md` and `DECISIONS.md` (newest last), headed sections and tables elsewhere. Use the real date of the work for dated entries. Write from the code as built, not from this plan; where the code and the text below differ, the code wins and the difference is reported.

- [ ] **Step 1: `docs/api/media.md`**

- Title: `# JBF LMS API: media (videos, movies, podcasts, songs), uploads and playback (milestones 3 and 4)`; in the first paragraph say "the media endpoints" instead of "the video endpoints".
- In "For the mobile developer", add: "Podcasts and songs are audio: hand the `url` from `POST /items/:id/play` to an audio player. Use the item's `category` (or the folder's) to choose the player."
- Route table: the three folder rows become `GET /api/media/:category/folders`, `POST /api/media/:category/folders`, `PUT /api/media/:category/folders/order`, and add under the table: "`:category` is one of `videos`, `movies`, `podcasts`, `songs`; anything else is 404 `Not found.` `/api/media/videos/folders` works exactly as in milestone 3."
- New section "Categories and kinds" before "Objects", with this table:

  | Category (slug) | `category` value | Kind | Content types | Largest file | First bytes checked |
  | --- | --- | --- | --- | --- | --- |
  | Videos (`videos`) | `video` | video | `video/mp4` | 2,147,483,648 bytes (2 GiB) | `ftyp` at bytes 4–7 |
  | Movies (`movies`) | `movie` | video | `video/mp4` | 2,147,483,648 bytes (2 GiB) | `ftyp` at bytes 4–7 |
  | Podcasts (`podcasts`) | `podcast` | audio | `audio/mpeg` (MP3), `audio/mp4` (M4A) | 524,288,000 bytes (500 MiB) | MP3: `ID3`, or byte 0 `FF` with the top three bits of byte 1 set; M4A: `ftyp` at bytes 4–7 |
  | Songs (`songs`) | `song` | audio | `audio/mpeg` (MP3), `audio/mp4` (M4A) | 524,288,000 bytes (500 MiB) | as Podcasts |

  followed by: "The folder decides the kind; the declared `contentType` must be exactly one of the listed types (`audio/x-m4a`, `audio/aac` and `audio/mp3` are refused: declare an `.m4a` as `audio/mp4` and an `.mp3` as `audio/mpeg`). Raw `.aac`, `.wav` and `.flac` are not accepted. A 500 MiB file is at most 32 pieces."
- `ItemView`: add the row `| category | video, movie, podcast or song | The category of the item's folder |` and `"category": "video"` to the example; say "An item" instead of "A video". `FolderView`: `{ "id", "name", "position", "itemCount", "category" }`, `itemCount` counts ready items.
- "Folders": replace "All folder routes work on the `video` category, which is the only one in use." with "The folder routes take the category slug; renaming works on a folder of any category." and the headings with the `:category` paths.
- "Videos" section heading becomes "Items"; the 404 message becomes `Item not found.`
- "Uploading a video" becomes "Uploading a file". Limits table: Type row "the folder's kind decides (see Categories and kinds)", Size row "1 byte to 2 GiB for videos and movies; 1 byte to 500 MiB for podcasts and songs", piece count "at most 128 (32 for audio)". `POST /uploads` field table: `folderId` "UUID of an existing folder of any category"; `contentType` "one of the folder kind's types"; `sizeBytes` "integer, 1 to the folder kind's largest size". Errors: 400 `fieldErrors.contentType` (`Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).` or `Only MP3 or M4A audio files can be uploaded here.`), `fieldErrors.sizeBytes` (`Videos can be at most 2 GB (MP4).`, `Audio files can be at most 500 MB (MP3 or M4A).`, `That file is empty.`); both can come at once; 404 `Folder not found.` is checked first.
- `complete`: "the stored type must be the declared type; the first bytes must match it (see Categories and kinds)"; add the 422 row `That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.` ("Wrong first bytes for an audio upload; the upload is gone").
- `DELETE /uploads/:fileId`: the 409 message is `This upload has already finished. Finished uploads cannot be cancelled here.`
- "Playing a video" becomes "Playing an item": the example `contentType` may be `audio/mpeg` or `audio/mp4` for audio; 404 `Item not found.`; 409 `This is still uploading.`
- Audit table: `content.folder.created` and `content.folder.reordered` are written by `POST /:category/folders` and `PUT /:category/folders/order`; add a paragraph: "Content entries (`content.folder.*`, `content.video.*`) record `metadata.category` (`video`, `movie`, `podcast`, `song`). Entries about an item use the category as `target.type`. `file.upload_failed` reasons: `size_mismatch`, `not_mp4`, `not_audio`, `bad_image`, `expired`. The action names keep the word `video` for compatibility; they cover every category."
- "Database notes": add "Migration `0004` renamed `media_items.video_file_id` to `media_file_id` and added `audio` to `file_purpose` (audio files have purpose `audio` and keys `audio/<uuid>`)."

- [ ] **Step 2: `docs/api/audit.md` and `docs/storage.md`**

`docs/api/audit.md`: title `(milestones 2 to 4)`; in the intro add "Milestone 4 reuses the media actions for movies, podcasts and songs." Replace the five rows of the presentation table:

| Action | Label | Tone | Category | Summary |
| --- | --- | --- | --- | --- |
| `content.folder.reordered` | Folders reordered | neutral | content | `<actor> changed the order of the <noun> folders` |
| `content.video.added` | Item added | change | content | `<actor> added the <noun> <target>` |
| `content.video.edited` | Item edited | change | content | `<actor> edited the <noun> <target>` (title and description before and after in `changes`) |
| `content.video.reordered` | Items reordered | neutral | content | `<actor> changed the order of the <nouns> in <target>` (the target is the folder) |
| `content.video.cover_set` | Cover set | change | content | `<actor> set the cover image of the <noun> <target>` |

and add below the table: "`<noun>` is `video`, `movie`, `podcast` or `song` from `metadata.category` (`<nouns>`: `videos`, `movies`, `podcasts`, `songs`). Entries written before milestone 4 have no `metadata.category` and read `video`, as does any unknown value. The labels changed in milestone 4 for old rows too, because labels come from the action name." In the `file.upload_failed` row add the reason "`not_audio` is \"the file is not a valid MP3 or M4A\"". In the `target` field description add `movie`, `podcast`, `song` to the example types.

`docs/storage.md`: title `# Storage: media files and cover images (Cloudflare R2)`; in section 1 say "videos, movies, podcasts and songs" where it says "videos" for what is stored; in section 6 replace the two video rows with:

| Rule | Value |
| --- | --- |
| Videos and movies | MP4 only (`video/mp4`), 1 byte up to 2 GB (2,147,483,648 bytes). Other formats must be converted first (for example with HandBrake) |
| Podcasts and songs | MP3 (`audio/mpeg`) or M4A (`audio/mp4`), 1 byte up to 500 MB (524,288,000 bytes). Raw AAC, WAV and FLAC are not accepted |
| Storage names | Random, never typed text: `videos/<id>` (videos and movies), `audio/<id>` (podcasts and songs), `covers/<id>` |

and the piece row "16 MB; a 2 GB video is at most 128 pieces and a 500 MB audio file at most 32"; in the paragraph after the table say the first bytes "must look like an MP4 (videos, movies and M4A), an MP3, or a JPEG, PNG or WebP for a cover". The CORS policy and `storage:check` need no change (audio uses the same `PUT`, `GET` and `HEAD`).

- [ ] **Step 3: `ARCHITECTURE.md`, `README.md`, `DECISIONS.md`, `CHANGELOG.md`, `PROGRESS.md`**

- `ARCHITECTURE.md`: the `media/` row describes all four categories and adds `media-kinds.ts` (the kinds and categories table: content types, sizes, first-bytes checks, key prefixes, words) and `category.pipe.ts`; the web table gains `media/` (`categories.ts`: the four categories and their words), `player/` (`PlayerContext.tsx` and `DockedPlayer.tsx`: the docked audio player, mounted once in the app shell next to the upload panel, memory only) and says `pages/media/` (was `pages/videos/`: `CategoryPage`, `FolderPage`, `ItemsTable`, the dialogs and the resume list for every category); the routes paragraph lists `/videos`, `/movies`, `/podcasts`, `/songs` and `/<category>/:folderId`; "Files and storage" mentions audio files (`audio/<uuid>`) and that podcasts and songs play in the docked player while videos and movies use the pop-up.
- `README.md`: the intro says milestones 1 to 4, adding "Movies, Podcasts and Songs (the same folders and uploads, MP3 and M4A up to 500 MB for audio) with a docked audio player"; the Pages table replaces the Videos row with one row: `| Videos, Movies, Podcasts, Songs | /videos, /movies, /podcasts, /songs and /<category>/:folderId | Everyone signed in. Create and rename folders, reorder folders and items, upload (MP4 up to 2 GB for Videos and Movies; MP3 or M4A up to 500 MB for Podcasts and Songs, each with an optional cover) with a progress panel and Resume, edit titles, descriptions and covers. Videos and movies play in a pop-up; podcasts and songs play in a bar at the bottom that keeps playing while you browse. Nothing can be deleted yet (the Trash arrives in milestone 6) |`; "Where things are" adds the milestone 4 spec and plan.
- `DECISIONS.md`: add "Engineering decisions (milestone 4)" with one dated bullet and its reason each: one kinds table (`MEDIA_KINDS`/`MEDIA_CATEGORIES` on the API, `MEDIA_KINDS`/`CATEGORIES` on the web) instead of per-category code; the folder decides the kind and the server never trusts the browser's; `video_file_id` renamed to `media_file_id` by a hand-written migration tested on a database that already holds media; the web declares `.m4a` files as `audio/mp4` and `.mp3` as `audio/mpeg` whatever the system reports, while the API accepts only those two types; audit action names keep `video` (old rows still read correctly) but labels became neutral and sentences take the noun from `metadata.category`, falling back to "video"; the audit target type of an item is its category; three error messages lost the word "video"; the docked player is audio only, one track at a time, one link per start, mounted in the app shell so it plays across pages and stops on sign-out; on a phone volume shares the second row with the controls; the `--player-height` token is shared by the bar, the page padding and the upload panel.
- `CHANGELOG.md` (one line each, newest last): the milestone 4 design spec and plan; the media kinds table with MP3 and M4A checks and `audio/` keys; migration 0004; folder routes for every category; uploads for movies, podcasts and songs; audit words per category; web file rules per kind; the docked player; the player in the app shell; the Movies, Podcasts and Songs pages; the documentation.
- `PROGRESS.md`: "Last updated" date; mark milestone 3 as approved and merged if `git log main` shows it merged, else leave its wording; add "Done: milestone 4 (Movies, Podcasts, Songs and the docked player; built, awaiting approval)" summarising what exists with the real test counts from Step 4; "In progress": nothing in the build, milestone 4 awaiting the user's approval; "Next: milestone 5" (Courses and attachments); open items: the browser parts of milestone 4 (real `<audio>` playback, seeking, volume, the dock layout on a phone and above the upload panel, autoplay rules, a video pop-up over a playing dock) were verified only with automated tests; some MP3/HE-AAC encodings play in some browsers and not others (the server checks the format, not the codec); a video MP4 declared as `audio/mp4` into Songs passes the `ftyp` check (accepted, spec risk 4); Cloudflare is still not connected (item 19 stays).

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
grep -rn "videoFileId\|video_file_id" apps/api/src apps/api/test apps/web/src | grep -v "test/media-migration.e2e-spec.ts" || echo "rename complete"
```

Expected: lint and both builds clean; every test passes, milestone 1–3 tests included (record the counts); `npm audit` exits 0 (if it needs the local certificate bundle, use `NODE_EXTRA_CA_CERTS` as in milestone 3; report any high or critical advisory); `drizzle-kit generate` prints `No schema changes, nothing to migrate`; `git status` shows only `vibe-coding-master-prompt.md` (and `.claude/` if present) untracked; the last three commands print their "none" / "no browser storage" / "rename complete" messages.

- [ ] **Step 5: Smoke test against the development database**

Run `npm run db:migrate -w @jbf/api` (applies 0004 to the development database; it already holds milestone 3 data if the user tried uploads) and then `npm run storage:cleanup -w @jbf/api` (expect `Removed 0 abandoned uploads.` or a count of really abandoned ones). Do not create an admin or start the servers unless the user asks.

- [ ] **Step 6: Commit**

```bash
git add docs ARCHITECTURE.md README.md PROGRESS.md CHANGELOG.md DECISIONS.md
git commit -m "docs: describe movies, podcasts, songs and the docked player"
```

**Manual check for the person approving the milestone (not part of automated verification):** (1) start the API and web app with the default local storage, sign in; the sidebar shows Videos, Movies, Podcasts, Songs; (2) in Songs create a folder, upload an MP3 and an M4A (one with a cover), try a `.wav` and an `.mp4` and read the refusals; (3) press Play on a song: the bar appears at the bottom with the title and "Songs › folder", seeks with the mouse and the arrow keys, changes volume and mutes; (4) open Videos and another folder while it plays: it keeps playing, the last row of each page is not hidden, and an upload's progress panel sits above the bar; (5) let a short track end: it stays with Play; press Close; (6) play a song, then open a video pop-up (the song keeps playing; the bar cannot be clicked while the pop-up is open); (7) on a phone-sized window the bar has two rows; (8) sign out while a song plays: the sound stops; (9) as an Admin open the Audit log: "Item added", "the song …" sentences, old video entries still say "the video", no links anywhere; (10) upload a movie and play it in the pop-up.

---

## Spec coverage and shared names

- **Spec coverage:** §2 decisions → Tasks 1, 4, 6, 7 (audio-only dock, 2 GiB movies, MP3/M4A 500 MiB, one track, fixed categories, covers on every item via the unchanged cover routes, one implementation, no delete, unchanged upload machinery). §3 kinds and categories, first-bytes rules, `not_audio`, declared-type normalization → Tasks 1, 4, 6. §4 migration, `audio` purpose, `audio/` keys and the local driver → Tasks 1, 2. §5 routes, 404 for other slugs, `category` in responses, upload 400 messages, unchanged `mine` → Tasks 3, 4. §6 audit metadata, nouns, labels, fallback, `not_audio` sentence → Tasks 3, 4, 5. §7.1 sidebar, routes, generalized pages, audio table, upload dialog per category, `<audio>` duration, unchanged upload manager → Tasks 6, 9, 10. §7.2 docked player (mount, bar contents, phone layout, behaviour, links, accessibility, layout, coexistence with the pop-up) → Tasks 7, 8, 10. §8 docs → Task 11. §9 testing → the tests in every task; §10 acceptance → Task 11 final checks and manual check. §12 risks → Task 11 open items.
- **Names used across tasks:** `MEDIA_KINDS`, `MEDIA_CATEGORIES`, `kindOf`, `categoryFromSlug`, `uploadFieldErrors`, `MediaCategory` (API, Task 1); `mediaFileId` (Task 2); `CategoryPipe`, `FolderView.category`, `ItemView.category` (Task 3); `RemovedUnfinished.item.category`, `mp3Bytes`, `mp3FrameBytes`, `m4aBytes` (Task 4); `VisibleItem` (Task 5); `MediaKind`, `checkMediaFile`, `MEDIA_KINDS` (web), `readDuration(file, kind)`, `StartInput.contentType` (Task 6); `DockTrack`, `PlayerSession`, `PlayerValue`, `PlayerContext`, `usePlayer`, `PlayerProvider`, `DockedPlayer` (Task 7); `--player-height`, `--player-offset`, `styles.withPlayer` (Task 8); `CategorySlug`, `MediaCategory` (web), `MediaItem`, `CategoryConfig`, `CATEGORIES`, `CategoryPage` (Task 9); `ItemsTable.onPlay`, `EditItemDialog.noun`, `UploadDialog.category`, `PendingUploads.category` (Task 10).

