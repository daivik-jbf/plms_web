# Milestone 3: Videos (Upload, Storage and Playback) — Design

Date: 2026-10-08
Status: Draft for review (nothing is planned or built until this is approved)
Parent spec: `2026-10-08-jbf-lms-portal-design.md` (sections 4, 5, 9, 10 and milestone 3 of section 11). Milestone 1 and 2 code is the baseline. This document adds decisions and detail for milestone 3 only; where it is silent, the parent spec governs.

## 1. Goal

Staff and Admin can create folders in the **Videos** category, upload MP4 videos of up to 2 GB into them (with an optional cover image), and play them in the portal. Large files are uploaded in pieces, directly from the browser to private storage, with retry and resume. Storage is Cloudflare R2 in production; development and the automated tests use a stand-in, so the whole flow can be built and tried before a Cloudflare account exists. Movies, Podcasts and Songs reuse this in milestone 4.

## 2. Decisions made in discovery

| Topic | Decision |
|---|---|
| Storage | **Cloudflare R2** (S3-compatible, private bucket, free downloads; about $0.015 per GB-month, first 10 GB free; a single upload can be up to 5 GiB, larger via pieces; temporary links last up to 7 days). |
| Size limit | **2 GiB (2,147,483,648 bytes) per video.** (The parent spec proposed 4 GB; this is tighter.) |
| File type | **MP4 only** (`video/mp4`, H.264/AAC). MKV, AVI and others are rejected with a message to convert first. (Accepted in the parent spec.) |
| Upload method | **In pieces of 16 MiB with retry and resume.** At most 128 pieces for a 2 GiB file. |
| Cover images | **Included in this milestone.** JPG, PNG or WebP, up to 10 MiB, one request. Optional per video; settable at upload or later. |
| Cloudflare account | **Not required to build.** A `StoragePort` has two drivers: `r2` (production) and `local` (development, files in a git-ignored folder). The tests use an in-memory fake. A "check my Cloudflare setup" script proves the real connection when it is made. |
| Video list layout | **Table with small pictures** (not a card grid). |
| Reordering | **Move up / Move down buttons** for folders and videos. |
| Replace a video's file | **Not in this milestone** (later, with the Trash). Edit covers title, description and cover. |
| Delete | **Not in this milestone.** The Trash and restore arrive in milestone 6. A person can cancel their own unfinished upload. |
| Player | A dialog with the browser's own `<video controls>`. The docked player is milestone 4. |
| Audit | New actions are added for folders, videos, uploads and plays (section 7). |
| Dependencies | Two official packages: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (verified before install). |

## 3. Data model (new tables, versioned migrations)

**`files`** — one row per stored file.
`id` uuid pk; `purpose` enum (`video`, `cover`); `storage_key` text unique (`videos/<uuid>` or `covers/<uuid>`; never contains a user-typed name); `original_name` text (display only; path separators stripped; at most 255 characters); `content_type` text; `size_bytes` bigint; `status` enum (`pending`, `ready`); `upload_id` text null (multipart upload id; set while a video upload is pending); `part_size` int null; `part_count` int null; `uploaded_by` uuid fk users; `created_at`; `completed_at` null.

**`media_folders`** — `id`; `category` enum (`video`, `movie`, `podcast`, `song`; only `video` is used now); `name` text (1–100 characters, unique per category ignoring case); `position` int; `created_by`; `created_at`; `updated_at`.

**`media_items`** — `id`; `folder_id` fk; `title` (1–200); `description` text null (at most 2,000); `position` int (new items go to the end); `video_file_id` fk files unique; `cover_file_id` fk files null; `duration_seconds` int null (read by the browser, not trusted for anything security-related); `status` enum (`uploading`, `ready`); `created_by`; `created_at`; `updated_at`.

No `deleted_at` column yet (milestone 6 adds it with the Trash).

## 4. Storage interface (`StoragePort`)

```
createMultipartUpload(key, contentType) -> uploadId
presignUploadPart(key, uploadId, partNumber, expiresInSeconds) -> url
listParts(key, uploadId) -> [{ partNumber, size, etag }]
completeMultipartUpload(key, uploadId, parts[{partNumber, etag}]) -> void
abortMultipartUpload(key, uploadId) -> void
presignPut(key, contentType, expiresInSeconds) -> url           (covers)
head(key) -> { size, contentType } | null
readRange(key, start, endInclusive) -> bytes                     (first bytes for the type check)
presignGet(key, expiresInSeconds, { contentType }) -> url        (playback, covers)
delete(key) -> void
```

Drivers: `R2Storage` (AWS SDK v3 pointed at `https://<account>.r2.cloudflarestorage.com`, region `auto`; the client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'` because newer SDK versions add checksum headers R2 has rejected); `LocalStorage` (section 9); `InMemoryStorage` (tests only: real multipart semantics including "every piece except the last is at least 5 MiB").

## 5. Rules enforced by the server

- Video: `contentType` must be `video/mp4`; `sizeBytes` must be 1 to 2,147,483,648; the browser declares both and the server computes the piece count (`ceil(size / 16 MiB)`). Anything else is a 400 with `fieldErrors`.
- Cover: `image/jpeg`, `image/png` or `image/webp`, 1 byte to 10 MiB.
- **On completion:** `head()` must show the stored size equal to the declared size and the declared type; `readRange(0, 15)` must show an MP4 (`ftyp` at offset 4) or a JPEG (`FF D8 FF`), PNG (`89 50 4E 47`) or WebP (`RIFF` + `WEBP`) as declared. On any mismatch the object is deleted, the upload is aborted, an audit entry `file.upload_failed` records the reason (`size_mismatch`, `not_mp4`, `bad_image`) and the API answers 422 with a plain message. A video is hidden from everyone but its uploader until **Ready**.
- Temporary link lifetimes: upload pieces 1 hour (the browser may ask again), playback 1 hour, covers 1 hour.
- **Abandoned uploads:** any `pending` file older than 24 hours is aborted and deleted by a cleanup job (an hourly timer in the API plus `npm run storage:cleanup`), with the half-created item removed and `file.upload_failed` (`expired`) recorded. Running it twice is harmless.
- Pieces are validated at completion only through the stored total size and the storage's own receipt (ETag) checks; per-piece sizes cannot be enforced by a temporary link.

## 6. API (all under `/api/media`; any signed-in person, Admin or Staff; nothing here deletes)

| Method and path | Purpose |
|---|---|
| `GET /videos/folders` | Folders: `{ id, name, position, itemCount }` (counts Ready videos). |
| `POST /videos/folders` `{ name }` | Create a folder (409 if the name exists in the category). |
| `PATCH /folders/:id` `{ name }` | Rename (409 on conflict). |
| `PUT /videos/folders/order` `{ ids }` | Set the order; `ids` must be exactly the current folders. |
| `GET /folders/:id/items` | Videos in order: `{ id, title, description, durationSeconds, sizeBytes, status, coverUrl, createdBy: { id, name }, createdAt, position }`. Other people's `uploading` items are not listed. `coverUrl` is a 1-hour link or null. |
| `PATCH /items/:id` `{ title?, description? }` | Edit (Ready items; or your own uploading item). |
| `PUT /folders/:id/items/order` `{ ids }` | Set the order of the Ready videos. |
| `POST /uploads` `{ folderId, title, description?, fileName, contentType, sizeBytes, durationSeconds? }` | Start: creates the item (`uploading`), the file (`pending`) and the multipart upload. Returns `{ itemId, fileId, partSize, partCount }`. |
| `POST /uploads/:fileId/part-urls` `{ partNumbers }` | Up to 16 piece numbers (each `1..partCount`); returns `{ urls: { "<n>": "<url>" } }`. Owner or Admin. |
| `GET /uploads/:fileId` | `{ fileId, itemId, status, partSize, partCount, uploadedParts: [{ partNumber, size, etag }] }` straight from storage (resume). Owner or Admin. |
| `POST /uploads/:fileId/complete` `{ parts: [{ partNumber, etag }] }` | Verify and finish (section 5). Returns the item, now Ready. |
| `DELETE /uploads/:fileId` | Cancel a **pending** upload (owner or Admin): aborts storage, removes the item and file rows. Never touches Ready content. |
| `GET /uploads/mine` | The caller's pending uploads: `{ fileId, itemId, folderId, title, fileName, sizeBytes, createdAt }`. |
| `POST /items/:id/cover` `{ contentType, sizeBytes }` | Returns `{ fileId, url, headers: { "Content-Type": ... } }` for a single upload. |
| `POST /covers/:fileId/complete` | Verify and attach the cover to the item. |
| `POST /items/:id/play` | Item must be Ready; returns `{ url, expiresAt, contentType }` and records `playback.played`. |

Errors use the existing shape (`{ statusCode, error, message, fieldErrors?, requestId }`): 400 validation, 403 not the owner, 404, 409 conflicts, 422 failed verification, 429 throttling. Piece-URL and complete endpoints are throttled generously (a 2 GiB upload is about 128 pieces plus retries).

## 7. Audit

New actions (all use the existing presentation module; `content.*` is category Content, `file.*` is Files, `playback.*` is Playback, which "Changes only" hides by default):

| Action | Label | Tone | Summary |
|---|---|---|---|
| `content.folder.created` | Folder created | change | `A created the folder T` |
| `content.folder.renamed` | Folder renamed | change | `A renamed the folder from <before> to <after>` |
| `content.folder.reordered` | Folders reordered | neutral | `A changed the order of the video folders` |
| `content.video.added` | Video added | change | `A added the video T` |
| `content.video.edited` | Video edited | change | `A edited the video T` (before/after in the details) |
| `content.video.reordered` | Videos reordered | neutral | `A changed the order of the videos in T` |
| `content.video.cover_set` | Cover set | change | `A set the cover image of T` |
| `file.upload_started` | Upload started | neutral | `A started uploading T` |
| `file.upload_completed` | Upload finished | success | `A finished uploading T` |
| `file.upload_failed` | Upload failed | warning | `The upload of T failed (<reason>)` |
| `file.upload_cancelled` | Upload cancelled | neutral | `A cancelled the upload of T` |
| `playback.played` | Played | neutral | `A played T` |

Entries are written in the same transaction as the database change they describe (storage calls happen outside the transaction, in a safe order described in the plan). Metadata never holds links, tokens or storage keys beyond ids.

## 8. Web

- **Navigation:** a new **Videos** link for everyone.
- **`/videos`:** table of folders (name, video count, Open, Rename, Move up/down) and **New folder**.
- **`/videos/:folderId`:** breadcrumb; table with the cover or a placeholder, title, length, size, who added it and when, Edit, Move up/down; uploading items show an "Uploading" badge with progress (visible to the uploader only). Row click or the title opens the player.
- **Player dialog:** native `<video controls>`; title, description, uploader. If the video errors because the temporary link expired, it asks once for a fresh link and continues from the same position. Closing stops playback.
- **Upload dialog:** file picker restricted to MP4 (validated again: type and size, with the "convert to MP4 first (for example with HandBrake)" message), title (prefilled from the file name), description, optional cover. The duration is read in the browser from the file's metadata (null if it cannot be read).
- **Upload manager** (app-wide, so uploads continue while navigating; not across a page reload): three pieces in parallel; each piece retried up to five times with growing waits (and waiting while offline); progress panel in the bottom corner with a bar, bytes sent and Cancel; a warning before closing the tab during an upload. Pieces are cut with `Blob.slice` (never the whole file in memory) and sent with `XMLHttpRequest` for progress; the receipt (ETag) is read from each response.
- **Resume after a reload:** the folder page lists "unfinished uploads" from `GET /uploads/mine`; **Resume** asks for the same file (name and size must match), asks the server which pieces exist and continues.
- **Edit dialog:** title, description, set or replace the cover. Folder dialogs: New folder, Rename.
- Loading skeletons, empty states ("No folders yet", "No videos in this folder yet"), error with Retry, keyboard operation, focus handling and phone layout as in milestone 2.

## 9. Local development driver

Enabled with `STORAGE_DRIVER=local`; **refused when `NODE_ENV=production`**. Files live under `STORAGE_LOCAL_DIR` (default `./.storage`, git-ignored). It mimics R2's links: signed with HMAC-SHA256 using `STORAGE_SIGNING_SECRET` (required for local), expiring, scoped to one operation and one object. Token-authorized routes under `/api/dev-storage/` (the only routes besides login that are not behind the sign-in guard): upload a piece or single object (streamed to disk; the response carries an `ETag` of the body's MD5), and read or `HEAD` an object with `Range` support. Completing joins the pieces in order, checks the receipts and the "5 MiB except the last" rule, and removes the temporary pieces. Because the Vite dev server proxies `/api`, no browser permission rules are needed locally.

## 10. Configuration and the Cloudflare guide

New environment settings: `STORAGE_DRIVER` (`local` | `r2`), `STORAGE_LOCAL_DIR`, `STORAGE_SIGNING_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The environment check requires the matching group for the chosen driver and rejects `local` in production. `docs/storage.md` gives the exact steps to create the bucket and a bucket-scoped access key, the CORS rules for the bucket (allow the web address to `PUT`, `GET` and `HEAD`, allow the `Content-Type` header, **expose `ETag`**), a lifecycle rule to abort incomplete uploads after a few days as a safety net, and how to run `npm run storage:check`. The check uploads a small test object through a temporary link, reads it back, deletes it, and sends a browser-style permission-check request to confirm the CORS rules and the `ETag` exposure.

## 11. Testing

- **API:** the full flow against the in-memory fake (start, piece links, listing parts, completion, wrong size, not an MP4, bad cover, cancel, expired cleanup, playback link, audit entries, permissions incl. other people's uploading items, throttling not enabled in tests as before). A shared **storage contract suite** runs against `InMemoryStorage` and `LocalStorage`.
- **Local driver:** signature validation, expiry, wrong operation, wrong object, range reads, the minimum piece size rule.
- **Web:** upload manager unit tests with fake timers (parallelism of three, retries with waits, resume from existing parts, cancel, offline waiting), the dialogs and pages with mocked requests, and the player's expired-link recovery.
- No test touches the network or Cloudflare.

## 12. Acceptance criteria

- A person can create a folder, upload an MP4 of up to 2 GiB with retry and resume, and play it; other people see it only once it is Ready.
- A file over 2 GiB, a non-MP4, or a lying declaration (size or type) is rejected and its storage is cleaned up.
- Abandoned uploads are cleaned up after 24 hours.
- Every action in section 7 appears in the audit log with the right label, tone and sentence; playback is hidden by "Changes only".
- No link, token or storage key appears in any audit entry, log line or error message.
- Everything works with the local driver in a browser on this machine, and the real Cloudflare connection is proven by `npm run storage:check` once credentials exist (not required for approval of this milestone).

## 13. Out of scope

Movies, Podcasts, Songs (milestone 4); the docked player (milestone 4); delete, Trash and restore (milestone 6); replacing a video's file (later); offline download and sync endpoints (milestone 6); video conversion (MKV/AVI); thumbnails taken from video frames; folders inside folders; per-person watch progress.

## 14. Risks and notes

1. Until Cloudflare is connected, only `storage:check` can prove the real service works; the final review will say so plainly.
2. Wrong CORS rules produce a confusing browser error; `docs/storage.md` and the check script address this.
3. Browsers slow timers in background tabs, so retries wait longer there; uploads still continue.
4. A 2 GiB upload on a slow link takes a long time; the progress panel and resume are the mitigation.
5. The checksum-header behaviour of the AWS SDK against R2 is handled by configuration and verified only by the check script.
6. Part-size equality ("all pieces the same size except the last") is required by R2; the fixed 16 MiB piece size guarantees it.
