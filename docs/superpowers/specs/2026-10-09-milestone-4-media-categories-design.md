# Milestone 4: Movies, Podcasts, Songs and the docked player — design

Status: written 2026-10-09 for review. Builds on `2026-10-08-jbf-lms-portal-design.md` (parent spec) and `2026-10-08-milestone-3-videos-design.md` (milestone 3, merged). Where this document is silent, those two apply.

## 1. Goal

Staff and Admin can keep Movies, Podcasts and Songs in folders exactly as they keep Videos today: upload in resumable pieces (with an optional cover image), edit, reorder and play. Audio (Podcasts, Songs) plays in a **docked player bar** at the bottom of the app that keeps playing while the person browses. Videos and Movies keep the pop-up player from milestone 3.

## 2. Decisions made in discovery

| Topic | Decision |
|---|---|
| Docked player scope | **Audio only.** Podcasts and Songs play in the dock; Videos and Movies open the existing pop-up player (stops when closed). |
| Movie size limit | **2 GiB**, the same as Videos (one rule for all video). MP4 only. |
| Audio formats and size | **MP3 and M4A** (MP4 container), **500 MiB** per file. Raw `.aac` (ADTS) files are not accepted. |
| Dock behaviour at end of track | **One track at a time**: no playlist, no auto-next. The bar stays on the finished track with Play to replay it. |
| Categories | Fixed: Videos, Movies, Podcasts, Songs (Courses is milestone 5). One level of folders, as before. |
| Covers | Optional cover image on every item, same rules as milestone 3 (JPEG/PNG/WebP, 10 MiB). |
| Reuse | One implementation serves all four categories; no copies of the Videos code. |
| Deleting | Still none (Trash is milestone 6). |
| Upload machinery | Unchanged: 16 MiB pieces, 3 in parallel, retries, resume, verification on completion, 24-hour cleanup. |

## 3. Kinds and categories

Every category has a **kind** that decides what may be uploaded:

| Category (route slug) | Database category | Kind | Content types | Max size | First-bytes check | Plays in |
|---|---|---|---|---|---|---|
| Videos (`videos`) | `video` | video | `video/mp4` | 2,147,483,648 bytes | `ftyp` at bytes 4–7 | pop-up |
| Movies (`movies`) | `movie` | video | `video/mp4` | 2,147,483,648 bytes | `ftyp` at bytes 4–7 | pop-up |
| Podcasts (`podcasts`) | `podcast` | audio | `audio/mpeg`, `audio/mp4` | 524,288,000 bytes (500 MiB) | see below | dock |
| Songs (`songs`) | `song` | audio | `audio/mpeg`, `audio/mp4` | 524,288,000 bytes (500 MiB) | see below | dock |

One table in the code (`MEDIA_KINDS`) holds these rules for the API; the web has a matching table for the file picker. The folder an item belongs to decides its kind; the server never trusts a kind sent by the browser.

**Audio first-bytes checks** (run on completion, like `ftyp` for video):
- `audio/mpeg` (MP3): the file starts with `ID3` (bytes 49 44 33), or with an MPEG frame sync: byte 0 is `FF` and the top three bits of byte 1 are set (`(b1 & 0xE0) == 0xE0`).
- `audio/mp4` (M4A): `ftyp` at bytes 4–7 (an MP4 container). A video MP4 passes this check by construction; the declared type and the category decide what is accepted, and the browser cannot play a file that has no audio track, so this is accepted.
- A mismatch is handled like a fake MP4 today: object deleted, upload aborted, rows removed, `file.upload_failed` recorded (new reason `not_audio`), 422 with a plain message.

The browser declares `audio/mpeg` for `.mp3` and `audio/mp4` for `.m4a` (also when the system reports `audio/x-m4a` or `audio/aac` for an `.m4a` file); the declaration must be one of the category's content types or the request is a 400.

## 4. Data model (one new migration, `0004`)

- `media_items.video_file_id` is renamed to **`media_file_id`** (the unique index and foreign key follow). Existing rows keep their values.
- The `file_purpose` enum gains **`audio`** (files of kind video keep purpose `video`; this includes movies).
- Storage keys for audio files are `audio/<uuid>` (random, no user text), alongside `videos/<uuid>` and `covers/<uuid>`. The local development driver's key check is extended to accept the `audio/` prefix.
- No other table changes. `media_folders.category` already has `movie`, `podcast` and `song`.

## 5. API

All under `/api/media`; any signed-in person (Admin or Staff); nothing deletes. Existing routes and their behaviour for Videos do not change.

| Method and path | Change |
|---|---|
| `GET/POST /:category/folders`, `PUT /:category/folders/order` | `:category` is one of `videos`, `movies`, `podcasts`, `songs`; any other value is 404. `/videos/folders` keeps working exactly as before. |
| `PATCH /folders/:id`, `GET /folders/:id/items`, `PUT /folders/:id/items/order`, `PATCH /items/:id`, `POST /items/:id/cover`, `POST /items/:id/cover/:fileId/complete`, `POST /items/:id/play` | No new paths. The folder decides the kind. |
| `POST /uploads` | The folder decides the kind and limits. `contentType` must be one of the kind's types and `sizeBytes` at most the kind's maximum, otherwise 400 with `fieldErrors` (`contentType` or `sizeBytes`) in plain words that name the allowed formats. |
| `POST /uploads/:fileId/part-urls`, `GET /uploads/:fileId`, `POST /uploads/:fileId/complete`, `DELETE /uploads/:fileId`, `GET /uploads/mine` | Unchanged. `complete` applies the kind's first-bytes check. |
| Folder and item responses | Gain `category` (`video`, `movie`, `podcast`, `song`) so the web app chooses the pop-up or the dock. The web app already knows each folder's category from its own folder list, so `GET /uploads/mine` does not change. |

Piece arithmetic is unchanged (`ceil(size / 16 MiB)`; a 500 MiB file is at most 32 pieces).

## 6. Audit

Action names do not change, so every existing row still reads correctly. New and existing entries for content changes record `metadata.category` (`video`, `movie`, `podcast`, `song`); the sentence uses the matching word and falls back to "video" when the field is absent (all rows written before this milestone):

- `content.video.added` → "A added the song T" / "the movie T" / "the podcast T" / "the video T"
- `content.video.edited`, `content.video.cover_set` → the same noun
- `content.video.reordered` → "A changed the order of the songs in T" (T is the folder)
- `content.folder.created` / `renamed` / `reordered` → "the folder T" (unchanged); `reordered` says "the song folders" etc. using the category when known, "the video folders" otherwise.

The labels shown in the audit table ("Video added") become neutral: "Item added", "Item edited", "Items reordered", "Cover set" (the existing label wording for old rows changes too, since labels come from the action name). `file.upload_*` and `playback.played` sentences are unchanged and the new failure reason `not_audio` reads "the file is not a valid MP3 or M4A". Links, tokens and storage keys never appear in any entry (unchanged rule).

## 7. Web

### 7.1 Category pages

- Sidebar for everyone: Dashboard, Videos, Movies, Podcasts, Songs (then the Admin and Account groups as now).
- Routes: `/videos`, `/movies`, `/podcasts`, `/songs` (folder lists) and `/videos/:folderId`, `/movies/:folderId`, `/podcasts/:folderId`, `/songs/:folderId` (item tables). The milestone 3 pages are generalized into one category-aware page pair; the visible words (headings, empty states, buttons, dialog titles) use the category's name ("No songs in this folder yet", "Upload song").
- Item table for audio: cover or a ♪ placeholder, title, length, size, who added it and when, **Play**, Edit, Move up/down. For video and movie rows the title or the row opens the pop-up as before.
- The upload dialog is category-aware: the file picker's `accept`, the client-side check and the "wrong file" message come from the category's rule (Videos/Movies: MP4 up to 2 GB with the HandBrake hint; Podcasts/Songs: MP3 or M4A up to 500 MB). The duration is read from the file's metadata with an `<audio>` element for audio. The title is prefilled from the file name as before.
- The upload manager, progress panel, resume list and cancel work for every category without change (they already speak in files and pieces).

### 7.2 The docked player

- One player for the whole signed-in app, mounted once next to the upload panel in the app shell, with its state in memory only (a page reload stops playback; links are never stored or logged).
- It appears only when something is playing. A fixed bar at the bottom, full width:
  - left: a ♪ glyph or the cover, the title, and "Category › Folder" underneath (plain text);
  - centre: Play/Pause, elapsed time, a seek slider, total time;
  - right: volume (slider and mute) and Close (✕).
- Phone layout: two rows (title and Close on top; controls and seek slider below).
- **Behaviour:** choosing Play on an audio item loads it and starts playing (if the browser blocks autoplay, it loads and shows Play). Choosing another replaces it. When a track ends the bar stays on it, paused at the start, with Play to replay; there is no next track. Close stops playback and hides the bar; signing out does the same.
- **Links:** the bar asks the API for a playback link (`POST /items/:id/play`, one audit entry per link, like the pop-up). If the audio stops loading because the link expired, it asks once for a fresh link and continues from the same position; a second failure shows "This could not be played. Please try again later." with Try again. The development double-run of effects must not request twice.
- **Accessibility:** a labelled region ("Player"), real buttons with names ("Play", "Pause", "Close player"), a keyboard-operable seek slider and volume slider (arrow keys), the current time announced as text, visible focus, AA contrast, `prefers-reduced-motion` respected (no animation is required).
- **Layout:** while the bar is showing, the page content gets extra bottom space so the bar never hides the last row; the milestone 3 progress panel sits above the bar.
- Video and movie playback is unchanged (pop-up). Starting an audio track does not touch an open pop-up and vice versa; playing a video does not stop the dock (the person may want music while watching; the browser's own rules apply).

## 8. Configuration, docs, no new settings

No new environment settings. `docs/api/media.md` is updated (category slugs, kinds table, new responses, `not_audio`); `docs/storage.md` notes that audio objects use `audio/` keys and the 500 MiB limit. `ARCHITECTURE.md`, `README.md` (Pages list), `CHANGELOG.md`, `DECISIONS.md`, `PROGRESS.md` are updated as in milestone 3.

## 9. Testing

- **API:** the kinds table at its exact edges (500 MiB accepted, +1 refused with the allowed formats named; 2 GiB for movies, +1 refused; 0 refused); a song uploaded end to end with a real MP3 header and with an M4A header; wrong bytes declared as MP3/M4A discarded with `not_audio` (rows and object gone); an MP4 video declared into a Songs folder refused with a 400 and an MP3 declared into Videos refused; every `:category` slug and the 404 for an unknown one; `/videos/...` behaviour unchanged (existing milestone 3 tests keep passing, adapted only where they name the renamed column); audio keys use the `audio/` prefix and never contain user text; the migration applied to a database that already holds videos, covers and uploads in progress (existing rows intact, unfinished uploads still completable); the local driver accepts `audio/` keys and still refuses traversal; audit sentences and labels for each category and the fallback for old rows; `playback.played` for an audio item.
- **Web:** category pages (names, empty states, upload dialog rules per category, wrong-file messages), Play on audio starts the dock and on video opens the pop-up, the dock (play, pause, seek by mouse and keyboard, volume and mute, end of track shows Play and does not advance, close, sign-out stops it, error then one fresh link and resume position, second error message, only one link request per start), phone layout class, hostile titles inert, `<audio>` removed on close, no link stored.

## 10. Acceptance criteria

- Movies, Podcasts and Songs each work end to end (create folders, upload with resume, edit, reorder, cover) with the right file rules; Videos behave exactly as before.
- A song or podcast plays in the dock, keeps playing while navigating, and stops on Close or sign-out; a video or movie opens the pop-up.
- A file that does not match its category (wrong type, wrong bytes, too large) is rejected and its storage cleaned up; abandoned audio uploads are cleaned up after 24 hours like video.
- Every action appears in the audit log with the right noun; no link, token or storage key appears in any entry, log line or error message.
- Lint, builds and all tests pass (milestone 1–3 tests included).

## 11. Out of scope

Playlists, auto-next, shuffle, repeat, queue and the dock for video (decided above); Courses and attachments (milestone 5); delete, Trash and restore, offline download and sync endpoints (milestone 6); transcoding or raw `.aac`/`.wav`/`.flac` support; audio waveform or lyrics; dashboard counts; search.

## 12. Risks and notes

1. Some audio encodings (for example unusual MP3 profiles or HE-AAC variants) play in some browsers and not others; the server checks the format, not the codec. The player shows its error message and Try again.
2. Real audio playback, seeking and the dock layout can only be verified in a real browser; the automated tests simulate the media element. The final report will say so.
3. Cloudflare is still not connected; `npm run storage:check` is still the only proof for the real service.
4. A video MP4 uploaded to a Songs folder as `audio/mp4` passes the `ftyp` check; the portal does not inspect tracks. The browser's audio element simply plays the audio track, if any.
5. Renaming `video_file_id` touches the milestone 3 code and tests; the plan keeps that to a mechanical rename and the migration is tested on existing data.
