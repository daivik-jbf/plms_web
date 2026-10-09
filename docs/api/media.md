# JBF LMS API: media (videos, movies, podcasts, songs), uploads and playback (milestones 3 and 4)

This is the hand-written contract for the media endpoints, written from the code (`apps/api/src/media/`, `apps/api/src/storage/`) and its end-to-end tests (`apps/api/test/media-*.e2e-spec.ts`). Authentication, token handling, the error body shape and the rate-limit rules are described in `docs/api/auth.md`; this page only adds what is specific to media. Setting up the storage service (Cloudflare R2) is described in `docs/storage.md`. A generated OpenAPI document is still planned for milestone 6 (see `PROGRESS.md`).

- Base path: every route starts with `/api/media`.
- Access: **any signed-in person (Admin or Staff)**. No token gives 401 (`Unauthorized`). There are no role-only routes here; the only Admin extras are described under "Visibility and ownership".
- Nothing in milestones 3 and 4 deletes content. The only removal is cancelling your own unfinished upload.
- Videos, movies, podcasts, songs and cover images are stored in private storage, never on the API server. The API owns the records and every check; the client sends the file bytes straight to storage using **temporary links** that the API issues (valid for 1 hour).

## For the mobile developer: read this first

- **Never store a link.** Every link (piece upload, cover upload, cover image, playback) expires after one hour. Keep ids (`id`, `fileId`) and ask the API again when you need a link. `coverUrl` in a list response is a fresh link generated for that response.
- Links are secrets: do not log them or put them in crash reports or analytics.
- To play an item call `POST /items/:id/play` and hand the returned `url` straight to the player. The storage supports range requests, so seeking works. If playback fails after a long pause, ask for a new link and continue from the same position.
- Podcasts and songs are audio: hand the `url` from `POST /items/:id/play` to an audio player. Use the item's `category` (or the folder's) to choose the player.
- Upload pieces with a plain `PUT` of the raw bytes to the link, with **no** extra headers and no `Authorization` header (the link carries its own signature). Read the `ETag` response header and keep it, exactly as received (quotes included); you send it back when you finish.
- Cover images are the exception: `PUT` the image to the cover link with exactly the `Content-Type` header the API returned in `headers`. The link is signed over that type, so a different value is refused.
- A mobile app is not subject to browser CORS rules; those only matter for the web app (see `docs/storage.md`).

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/media/:category/folders` | List the folders of a category | 200 JSON |
| `POST /api/media/:category/folders` | Create a folder | 201 JSON |
| `PUT /api/media/:category/folders/order` | Set the order of the folders | 200 JSON |
| `PATCH /api/media/folders/:id` | Rename a folder | 200 JSON |
| `GET /api/media/folders/:id/items` | List the items in a folder | 200 JSON |
| `PUT /api/media/folders/:id/items/order` | Set the order of the ready items in a folder | 200 JSON |
| `PATCH /api/media/items/:id` | Edit an item's title or description | 200 JSON |
| `POST /api/media/uploads` | Start an upload | 201 JSON |
| `GET /api/media/uploads/mine` | The caller's unfinished uploads | 200 JSON |
| `GET /api/media/uploads/:fileId` | State of an upload (for resuming) | 200 JSON |
| `POST /api/media/uploads/:fileId/part-urls` | Get links for pieces | 200 JSON |
| `POST /api/media/uploads/:fileId/complete` | Verify and finish an upload | 200 JSON |
| `DELETE /api/media/uploads/:fileId` | Cancel an unfinished upload | 204, no body |
| `POST /api/media/items/:id/cover` | Start a cover image upload | 201 JSON |
| `POST /api/media/items/:id/cover/:fileId/complete` | Verify and attach a cover image | 200 JSON |
| `POST /api/media/items/:id/play` | Get a playback link | 200 JSON |

`:category` is one of `videos`, `movies`, `podcasts`, `songs`; anything else is 404 `Not found.` `/api/media/videos/folders` works exactly as in milestone 3.

All ids in paths are UUIDs; anything else is a 400.

## Categories and kinds

| Category (slug) | `category` value | Kind | Content types | Largest file | First bytes checked |
| --- | --- | --- | --- | --- | --- |
| Videos (`videos`) | `video` | video | `video/mp4` | 2,147,483,648 bytes (2 GiB) | `ftyp` at bytes 4–7 |
| Movies (`movies`) | `movie` | video | `video/mp4` | 2,147,483,648 bytes (2 GiB) | `ftyp` at bytes 4–7 |
| Podcasts (`podcasts`) | `podcast` | audio | `audio/mpeg` (MP3), `audio/mp4` (M4A) | 524,288,000 bytes (500 MiB) | MP3: `ID3`, or byte 0 `FF` with the top three bits of byte 1 set; M4A: `ftyp` at bytes 4–7 |
| Songs (`songs`) | `song` | audio | `audio/mpeg` (MP3), `audio/mp4` (M4A) | 524,288,000 bytes (500 MiB) | as Podcasts |

The folder decides the kind; the declared `contentType` must be exactly one of the listed types (`audio/x-m4a`, `audio/aac` and `audio/mp3` are refused: declare an `.m4a` as `audio/mp4` and an `.mp3` as `audio/mpeg`). Raw `.aac`, `.wav` and `.flac` are not accepted. A 500 MiB file is at most 32 pieces.

## Objects

### The item object (`ItemView`)

An item, as returned by the list, edit, reorder, completion and cover routes. Exactly these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | The item id (use it for edit, cover and play) |
| `folderId` | UUID | The folder it is in |
| `title` | string | 1 to 200 characters |
| `description` | string or `null` | At most 2,000 characters |
| `durationSeconds` | integer or `null` | Length as read by the uploading client; informational only, not verified by the server |
| `sizeBytes` | integer | Size of the media file |
| `status` | `uploading` or `ready` | `uploading` is visible only to the person uploading it (see "Visibility and ownership") |
| `coverUrl` | string or `null` | A one-hour link to the cover image, or `null` when there is no (finished) cover |
| `createdBy` | `{ id, name }` | Who added it (the user's current name) |
| `createdAt` | ISO 8601 string (UTC) | When the upload was started |
| `position` | integer | Order within the folder (0 first) |
| `category` | video, movie, podcast or song | The category of the item's folder |

Example:

```json
{
  "id": "5f0e2b0a-95c1-4c36-8b83-0b3a7a0f6d11",
  "folderId": "c9d7d4f0-2d0a-4a53-8a5b-0e4d9f5f2a10",
  "title": "Welcome to the programme",
  "description": null,
  "durationSeconds": 312,
  "sizeBytes": 148230912,
  "status": "ready",
  "coverUrl": "https://<storage-host>/covers/...?...",
  "createdBy": { "id": "6a1e0c52-3f55-4c0e-8f0d-2f4b9d1c7e10", "name": "Anita Rao" },
  "createdAt": "2026-10-09T09:12:44.318Z",
  "position": 0,
  "category": "video"
}
```

### The folder object (`FolderView`)

`{ "id": UUID, "name": string, "position": integer, "itemCount": integer, "category": "video" | "movie" | "podcast" | "song" }`. `itemCount` counts **ready** items only.

## Folders

The folder routes take the category slug; renaming works on a folder of any category. Folder names must be different within one category (the comparison ignores upper and lower case).

### `GET /api/media/:category/folders`

Returns an array of folders in order. An empty array when there are none.

### `POST /api/media/:category/folders`

Body `{ "name": string }`: trimmed, 1 to 100 characters. Returns the new folder (201), placed last, with `itemCount` 0.

- 409 `A folder with that name already exists.` The comparison ignores upper and lower case.

### `PATCH /api/media/folders/:id`

Body `{ "name": string }` with the same rules. Returns the folder. Renaming to the same name is allowed and changes nothing (nothing is audited).

- 404 `Folder not found.`; 409 `A folder with that name already exists.`

### `PUT /api/media/:category/folders/order`

Body `{ "ids": [UUID, ...] }`. `ids` must be exactly the current folders of the category, each once, in the new order. Returns the folders in the new order.

- 409 `The list changed while you were editing it. Reload and try again.` when the list does not match the current folders (someone added one, or an id is missing or repeated).

## Items

### `GET /api/media/folders/:id/items`

Returns an array of `ItemView` in order (by `position`): the ready items and any of the caller's own unfinished uploads. Other people's `uploading` items are not listed (see "Visibility and ownership").

- 404 `Folder not found.`

### `PATCH /api/media/items/:id`

Body: `title` (1 to 200 characters, trimmed) and/or `description` (at most 2,000, trimmed; an empty string or `null` clears it). At least one must be present (`Nothing to change.`). Returns the `ItemView`. A request that changes nothing is accepted and not audited. Any signed-in person may edit any **visible** item (a ready one, or your own unfinished upload).

- 404 `Item not found.` (also for someone else's unfinished upload)

### `PUT /api/media/folders/:id/items/order`

Body `{ "ids": [UUID, ...] }`. `ids` must be exactly the **ready** items currently in the folder, each once. Unfinished uploads are not part of the order and are not listed in `ids`. Returns the folder's items (same as the list).

- 404 `Folder not found.`; 409 `The list changed while you were editing it. Reload and try again.`

## Uploading a file

The flow, in order:

1. **Start**: `POST /uploads` creates the (hidden) item and the upload, and returns how many pieces to send.
2. **Get links**: `POST /uploads/:fileId/part-urls` with up to 16 piece numbers; repeat as needed. Ask again for a fresh link on every retry.
3. **Send each piece**: `PUT` the bytes to its link and keep the `ETag` response header.
4. **Complete**: `POST /uploads/:fileId/complete` with every piece number and its `ETag`. The server verifies the stored file; the item becomes `ready`.

Limits:

| Rule | Value |
| --- | --- |
| Type | the folder's kind decides (see Categories and kinds) |
| Size | 1 byte to 2 GiB for videos and movies; 1 byte to 500 MiB for podcasts and songs |
| Piece size | 16 MiB (16,777,216 bytes), fixed by the server and returned as `partSize` |
| Piece count | `ceil(size / 16 MiB)`, at most 128 (32 for audio), returned as `partCount` |
| Piece sizes | Send every piece exactly `partSize` bytes except the last, which is whatever remains. Storage refuses any piece other than the last that is under 5 MiB |
| Link lifetime | 1 hour |
| Unfinished uploads | Removed after 24 hours |

Cut the file with offsets, not by loading it into memory: piece `n` (counting from 1) is bytes `(n - 1) * partSize` up to `min(n * partSize, size)`.

### `POST /api/media/uploads`

```json
{
  "folderId": "c9d7d4f0-2d0a-4a53-8a5b-0e4d9f5f2a10",
  "title": "Welcome to the programme",
  "description": "Optional",
  "fileName": "welcome.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 148230912,
  "durationSeconds": 312
}
```

| Field | Rules |
| --- | --- |
| `folderId` | UUID of an existing folder of any category |
| `title` | trimmed, 1 to 200 characters |
| `description` | optional, trimmed, at most 2,000; empty means none |
| `fileName` | 1 to 1,000 characters. Display only: path separators and control characters are stripped, the result is cut to 255 characters, and it never becomes part of a storage path |
| `contentType` | one of the folder kind's types |
| `sizeBytes` | integer, 1 to the folder kind's largest size |
| `durationSeconds` | optional integer 0 to 1,000,000 or `null` |

Response (201):

```json
{ "itemId": "5f0e2b0a-95c1-4c36-8b83-0b3a7a0f6d11", "fileId": "0d8f3d0c-4f0b-47e1-a64f-1c6a2f7d9b30", "partSize": 16777216, "partCount": 9 }
```

Keep `fileId`: every other upload route uses it. Errors: 400 `fieldErrors.contentType` (`Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).` or `Only MP3 or M4A audio files can be uploaded here.`) and `fieldErrors.sizeBytes` (`Videos can be at most 2 GB (MP4).`, `Audio files can be at most 500 MB (MP3 or M4A).`, `That file is empty.`); both can come at once; 404 `Folder not found.` is checked first.

### `POST /api/media/uploads/:fileId/part-urls`

Body `{ "partNumbers": [1, 2, 3] }`: 1 to 16 integers, each from 1 to `partCount` (duplicates are ignored). Response:

```json
{ "urls": { "1": "https://<storage-host>/videos/...?...", "2": "...", "3": "..." } }
```

- 400 `Piece numbers must be between 1 and <partCount>.`; 409 `This upload has already finished.` (the upload is no longer pending).

### Sending a piece

`PUT <url>` with the raw piece bytes as the body and no other headers. A 2xx answer carries the receipt in the `ETag` response header. Keep it exactly as given. Retry a failed piece (with a fresh link from `part-urls`) with waits that grow, for example 1, 2, 4, 8 seconds up to 30; sending the same piece again simply replaces it. The API does not see these requests, so it cannot report on their progress.

### `GET /api/media/uploads/:fileId` (resume)

Reports what storage already holds, so an app that was closed or lost its state can continue:

```json
{
  "fileId": "0d8f3d0c-4f0b-47e1-a64f-1c6a2f7d9b30",
  "itemId": "5f0e2b0a-95c1-4c36-8b83-0b3a7a0f6d11",
  "status": "pending",
  "partSize": 16777216,
  "partCount": 9,
  "uploadedParts": [ { "partNumber": 1, "size": 16777216, "etag": "\"9a0364b9e99bb480dd25e1f0284c8555\"" } ]
}
```

- `status` is `pending` or `ready`. When it is `ready` the upload has finished and `uploadedParts` is empty.
- `uploadedParts` comes from storage itself, even if the client forgot what it had sent. Send only the missing pieces, and use the listed `etag` values for the pieces you do not resend.
- Only resume with the same file (same name and size). The stored name is the tidied display name (control characters and slashes become spaces, repeated spaces collapse, leading dots are dropped, at most 255 characters), so a client must tidy the chosen file's name the same way before comparing it. The server cannot tell, so the client must check; a different file is caught at completion as a size or type mismatch and the upload is discarded.
- 409 `This upload can no longer be continued. Cancel it and start again.` when storage has lost the upload.

### `GET /api/media/uploads/mine`

The caller's own unfinished uploads (even for an Admin), newest first. Use it after a restart to offer "Resume":

```json
[ { "fileId": "...", "itemId": "...", "folderId": "...", "title": "...", "fileName": "welcome.mp4", "sizeBytes": 148230912, "createdAt": "2026-10-09T09:12:44.318Z" } ]
```

### `POST /api/media/uploads/:fileId/complete`

Body `{ "parts": [ { "partNumber": 1, "etag": "..." }, ... ] }`. It must contain every piece, numbered 1 to `partCount` exactly once (in any order), each with the `ETag` returned when it was sent. Returns the `ItemView`, now `status: "ready"`.

The server then verifies the stored file itself (this is not optional and does not trust the client):

- the stored size must equal the declared `sizeBytes`;
- the stored type must be the declared type;
- the first bytes must match it (see Categories and kinds).

If the size or the type does not match, the file is deleted, the upload and its hidden item are removed, `file.upload_failed` is recorded and the answer is a 422 with a plain message. Completing is safe to repeat: finishing an upload that is already ready returns the ready item, and two requests at the same time give the same result.

Errors:

| Status | Message (`message`) | Meaning |
| --- | --- | --- |
| 422 | `Some pieces are missing. Resume the upload to send them.` | The list does not contain every piece exactly once. The upload stays open: send the rest and complete again |
| 422 | `Some pieces are missing or damaged. Resume the upload to send them again.` | Storage did not accept a receipt, or a non-last piece was under 5 MiB. The upload stays open |
| 422 | `The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.` | Size mismatch; the upload is gone |
| 422 | `That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).` | Wrong type or first bytes; the upload is gone |
| 422 | `That file is not a valid MP3 or M4A audio file, so it was discarded. Please choose another file.` | Wrong first bytes for an audio upload; the upload is gone |
| 409 | `This upload can no longer be continued. Cancel it and start again.` | Storage no longer has the upload (for example it was cancelled or cleaned up while completing) |
| 404 | `This upload no longer exists.` | It was cancelled while the pieces were being joined |

### `DELETE /api/media/uploads/:fileId`

Cancels an unfinished upload: the stored pieces are discarded and the hidden item is removed, together with its cover image if one was already attached (the web app sends the cover before the pieces). A failed verification and the 24-hour cleanup remove the cover the same way. 204 with no body. Allowed to the uploader or an Admin. It never touches a finished item: for one that is ready the answer is 409 (`This upload has already finished. Finished uploads cannot be cancelled here.`). Cancelling an upload that is already gone is a 404 (`Upload not found.`); a client that wanted it gone can treat that as success.

Do not cancel while the final `complete` request is running: a cancel racing with completion can make the upload fail even though it was fine. Cancel while still sending pieces; the web app only offers Cancel while sending.

## Covers

A cover is optional and can be added when uploading or later, and replaced at any time. Any signed-in person may set the cover of any item they can see.

| Rule | Value |
| --- | --- |
| Types | `image/jpeg`, `image/png`, `image/webp` |
| Size | 1 byte to 10 MiB (10,485,760 bytes) |
| Link lifetime | 1 hour |

1. `POST /api/media/items/:id/cover` with `{ "contentType": "image/png", "sizeBytes": 20480 }`. Response (201): `{ "fileId": UUID, "url": string, "headers": { "Content-Type": "image/png" } }`. Errors: 400 (`Covers must be JPEG, PNG or WebP images.`, `Covers can be at most 10 MB.`, `That file is empty.`), 404 `Item not found.`
2. `PUT` the image bytes to `url` in a single request with exactly the headers returned in `headers`. The link is signed over the content type, so the declared `Content-Type` must be sent unchanged.
3. `POST /api/media/items/:id/cover/:fileId/complete` (no body). The server checks the stored size, the stored type and the first bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 ...`, WebP `RIFF....WEBP`), then attaches the cover. A replaced cover is deleted from storage. Returns the `ItemView` with a fresh `coverUrl`. Repeating the call for a cover that is already attached returns the item again.

The completion route carries the item id as well as the file id so that no extra record is needed to know which item the cover belongs to. The server does not check that a pending cover file was issued for the item in the path: a cover can be completed on any item the caller can see, and only the uploader of the cover or an Admin can complete it.

Known limitation (accepted risk): the cover upload link stays usable for its hour after the cover is verified, so its holder can overwrite the stored cover until it expires. See "Security notes" in `docs/storage.md`.

| Status | Message | Meaning |
| --- | --- | --- |
| 422 | `The cover image has not been uploaded yet. Try again.` | Nothing is stored yet (the `PUT` did not happen or failed) |
| 422 | `That is not a valid JPEG, PNG or WebP image of the declared size, so it was discarded. Please choose another file.` | Wrong size, type or first bytes; the file is deleted and `file.upload_failed` is recorded |
| 403 | `This upload belongs to someone else.` | Only the person who started the cover upload, or an Admin, may complete it |
| 404 | `Item not found.` / `Cover upload not found.` | Unknown or invisible item, or unknown cover |
| 409 | `That cover was already used.` | The cover file is already attached to a different item |

## Playing an item

`POST /api/media/items/:id/play` (no body). The item must be ready. Response (200):

```json
{ "url": "https://<storage-host>/videos/...?...", "expiresAt": "2026-10-09T10:12:44.318Z", "contentType": "video/mp4" }
```

For podcasts and songs the `url` points at `audio/<id>` and `contentType` is `audio/mpeg` or `audio/mp4`.

- The `url` is valid for one hour (`expiresAt`). Pass it straight to the player; the storage supports range requests, so seeking and partial downloads work.
- **Every link that is issued is recorded** in the audit log as `playback.played`, including when you ask again for a fresh link during the same viewing. So request a link when the person starts watching, and again only if playback fails or the link has expired, not on every screen redraw.
- If the link expires mid-viewing, ask again and seek to the same position.
- 404 `Item not found.` (unknown, or someone else's unfinished upload); 409 `This is still uploading.` (your own unfinished upload).

## Visibility and ownership

- An item that is still `uploading` belongs to the person uploading it. To everyone else, **including Admins**, it does not exist yet: it is not listed, and edit, cover and play answer 404. Once it is `ready` everyone signed in sees it.
- The upload routes (`part-urls`, status, `complete`, cancel) answer 403 `This upload belongs to someone else.` to anyone but the uploader, unless the caller is an Admin, who may manage any unfinished upload. An unknown `fileId` is 404 `Upload not found.`
- `GET /uploads/mine` lists only the caller's own unfinished uploads.
- Cancel and cleanup remove records only while the upload is still unfinished, so a ready item can never be removed by them.

## Errors

Error bodies follow the shape in `docs/api/auth.md`: `{ statusCode, error?, message, fieldErrors?, requestId }`.

400 validation failure (several fields can be reported at once):

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "fieldErrors": { "contentType": ["Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake)."] },
  "requestId": "4b0f6a58-5a3c-4f37-9a52-2f0c6f1f0c11"
}
```

`fieldErrors` is keyed by the body field name; rely on the key and show `message` (or the field message) to the person.

| Status | Meaning |
| --- | --- |
| 400 | Invalid body or a path id that is not a UUID; piece numbers out of range |
| 401 | Missing, invalid or expired access token, or the user is deactivated |
| 403 | Someone else's upload (see above) |
| 404 | Category, folder, item, upload or cover not found, or not visible to you |
| 409 | Conflict: folder name taken, the list changed since it was loaded, the upload is no longer pending or can no longer be continued, the item is still uploading |
| 422 | Failed verification or missing pieces (the messages above); the plain message is safe to show |
| 429 | Rate limited. The global limit is 120 requests per minute per IP; the `/api/media/uploads/...` routes allow 600 per minute so that a 128-piece upload with retries fits. All limits are off when the API runs with `THROTTLE_ENABLED=false` (tests and local work only) |

Errors never contain links, signatures or storage keys.

## What is written to the audit log

Each entry is written in the same database transaction as the change it describes. None contains a link, token or storage key. See `docs/api/audit.md` for how they are presented (label, tone, category, sentence).

| Action | Written by |
| --- | --- |
| `content.folder.created` | `POST /:category/folders` |
| `content.folder.renamed` | `PATCH /folders/:id` (only when the name changed; before and after in `changes`) |
| `content.folder.reordered` | `PUT /:category/folders/order` (only when the order changed) |
| `file.upload_started` | `POST /uploads` (metadata: file id, size, piece count) |
| `file.upload_completed` | `POST /uploads/:fileId/complete`, on success |
| `content.video.added` | `POST /uploads/:fileId/complete`, on success (the item became ready in a folder) |
| `file.upload_failed` | a failed verification (reason `size_mismatch`, `not_mp4`, `not_audio` or `bad_image`), or the cleanup of an abandoned upload (reason `expired`, no actor: written by the system) |
| `file.upload_cancelled` | `DELETE /uploads/:fileId` |
| `content.video.edited` | `PATCH /items/:id` (only when something changed; before and after in `changes`) |
| `content.video.reordered` | `PUT /folders/:id/items/order` (only when the order changed) |
| `content.video.cover_set` | `POST /items/:id/cover/:fileId/complete`, when the cover is attached |
| `playback.played` | `POST /items/:id/play`, once for every link issued |

Content entries (`content.folder.*`, `content.video.*`) record `metadata.category` (`video`, `movie`, `podcast`, `song`). Entries about an item use the category as `target.type`. `file.upload_failed` reasons: `size_mismatch`, `not_mp4`, `not_audio`, `bad_image`, `expired`. The action names keep the word `video` for compatibility; they cover every category.

Starting a cover upload, asking for piece links, checking an upload and listing write nothing.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` (development only, refused when `NODE_ENV=production`) or `r2` |
| `STORAGE_LOCAL_DIR` | `./.storage` | Where the local driver keeps files |
| `STORAGE_SIGNING_SECRET` | random at start-up | Signs the local driver's links (at least 32 characters, optional) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | none | Required when `STORAGE_DRIVER=r2` |

Set in `apps/api/.env`; see `apps/api/.env.example` and `docs/storage.md`. With the local driver (development only) the links are paths on the API itself, such as `/api/dev-storage/<token>` with no host name; put the API's address in front of them. Production links with R2 are always complete addresses.

## Database notes

Three tables (migration `0003`): `files` (one row per stored file; storage keys are random and never contain typed text), `media_folders` and `media_items`. Rows of one item are always locked in the same order, the `media_items` row before its `files` row, so overlapping completions, cancels and cleanups cannot deadlock.

Migration `0004` renamed `media_items.video_file_id` to `media_file_id` and added `audio` to `file_purpose` (audio files have purpose `audio` and keys `audio/<uuid>`).
