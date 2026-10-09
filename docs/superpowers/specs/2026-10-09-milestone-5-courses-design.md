# Milestone 5: Courses, Lessons, Topics and attachments — design

Status: written 2026-10-09 for review. Builds on `2026-10-08-jbf-lms-portal-design.md` (parent spec), `2026-10-08-milestone-3-videos-design.md` and `2026-10-09-milestone-4-media-categories-design.md` (both merged). Where this document is silent, those apply.

## 1. Goal

Staff and Admin can build Courses: a Course holds Lessons, a Lesson holds Topics, in any number and a manual order. A Topic has a text description and any number of attachments (video, audio, PDF, image), each either **uploaded into the topic** or **picked from the library** (Videos, Movies, Podcasts, Songs). People open attachments from the course page: videos in the existing pop-up, audio in the docked player, PDFs in a new browser tab, images in a pop-up.

## 2. Decisions made in discovery

| Topic | Decision |
|---|---|
| Attachment sources | **Both**: upload a file into the topic, or attach an existing ready library item. A library attachment stays linked (its title, cover and file are the library item's; a later edit shows up in the course). |
| Course screen | **One page with an expandable tree** on the left (lessons expand to topics, with Add, Rename, Move up/down) and the selected topic's text and attachments in a panel on the right; on a phone the panel replaces the tree, with a Back button. |
| Ordering | Move up/down buttons at every level (as in the library); no drag-and-drop. |
| Text | Plain text with line breaks. No rich text, no HTML. |
| Lesson | A title only. |
| Deleting | **None** in this milestone, including removing an attachment (the Trash is milestone 6). |
| Upload engine | Unchanged: 16 MiB pieces, resume, retries, verification on completion, 24-hour cleanup. Only the place a finished upload ends up is new. |
| Opening | Video: pop-up player. Audio: docked player. PDF: new browser tab (one-hour link). Image: thumbnail, larger in a pop-up. |

## 3. Data model (one new migration, `0005`)

- **`courses`**: `id`, `title` (1–200), `description` text null (≤ 2,000), `position` int, `cover_file_id` fk files null, `created_by`, `created_at`, `updated_at`.
- **`lessons`**: `id`, `course_id` fk, `title` (1–200), `position`, `created_by`, timestamps.
- **`topics`**: `id`, `lesson_id` fk, `title` (1–200), `description` text null (≤ 10,000), `position`, `created_by`, timestamps.
- **`topic_attachments`**: `id`, `topic_id` fk, `position`, `kind` (`video`, `audio`, `pdf`, `image`), `title` (1–200; defaults to the file name without its extension, or the library item's title), `file_id` fk files null **or** `library_item_id` fk media_items null (exactly one is set; a check constraint enforces it; `file_id` is unique), `status` (`uploading`, `ready`; library attachments are always `ready`), `created_by`, timestamps.
- `files.purpose` gains `pdf` and `image`; uploaded attachments of kind video and audio use the existing `video` and `audio` purposes. Storage keys: `videos/<uuid>`, `audio/<uuid>`, `documents/<uuid>` (PDF), `images/<uuid>`; random, never user text. The local development driver's key pattern accepts the two new prefixes.
- Titles may repeat inside a course; only the order identifies a position. No `deleted_at` yet.

## 4. File rules for uploaded attachments

The declared content type decides the kind (attachments do not live in a folder); the server never trusts the browser beyond the declared type and re-checks the real bytes on completion.

| Kind | Content types | Largest | First bytes |
|---|---|---|---|
| video | `video/mp4` | 2,147,483,648 bytes | `ftyp` at bytes 4–7 |
| audio | `audio/mpeg`, `audio/mp4` | 524,288,000 bytes | as in milestone 4 |
| pdf | `application/pdf` | 52,428,800 bytes (50 MiB) | starts with `%PDF-` |
| image | `image/jpeg`, `image/png`, `image/webp` | 10,485,760 bytes | as for covers |

A wrong type, wrong bytes or too large a file is refused or discarded exactly as in the library (400 with the allowed formats named; 422 and removal on completion; new failure reasons `not_pdf` and `not_image`; the audit sentences name them). The existing kinds table gains the `pdf` and `image` kinds; the library categories keep using only `video` and `audio`.

## 5. API (all under `/api`; any signed-in person; nothing deletes)

| Route | Purpose |
|---|---|
| `GET /courses`, `POST /courses`, `PUT /courses/order` | List (with lesson and topic counts), create, reorder |
| `GET /courses/:id` | The whole tree in one answer: the course, its lessons in order, each lesson's topics in order (id, title, position, attachment count) |
| `PATCH /courses/:id` | Edit title and description |
| `POST /courses/:id/cover`, `POST /courses/:id/cover/:fileId/complete` | Set or replace the cover (the library's cover flow and checks) |
| `POST /courses/:id/lessons`, `PUT /courses/:id/lessons/order`, `PATCH /lessons/:id` | Add, reorder, rename lessons |
| `POST /lessons/:id/topics`, `PUT /lessons/:id/topics/order`, `PATCH /topics/:id` | Add, reorder, edit topics |
| `GET /topics/:id` | The topic with its attachments (title, kind, source, size, length, a one-hour cover or thumbnail link, library item id and category) |
| `POST /topics/:id/attachments/library` | Attach a ready library item (`{ itemId, title? }`); an item still uploading is refused |
| `POST /topics/:id/attachments/uploads` | Start an uploaded attachment (`{ title?, fileName, contentType, sizeBytes, durationSeconds? }`); then the existing `/api/media/uploads/...` routes (piece links, status, complete, cancel, `mine`) work on it unchanged |
| `PUT /topics/:id/attachments/order`, `PATCH /attachments/:id` | Reorder, rename |
| `POST /attachments/:id/open` | A one-hour link `{ url, expiresAt, contentType, kind }` to view or play, recorded in the audit log |

Rules: reorder routes take exactly the current ids or answer 409; unknown ids 404; text fields refuse NUL characters (400); the creator-only visibility of unfinished uploads, the lock order (the attachment row before its file rows), conditional deletes in cancel, failure and cleanup so a ready attachment can never be removed, idempotent completion, and 404/409 (never 500) when an object vanishes during verification all apply to attachments exactly as to library items. A library attachment opens the library item's file; an attachment whose library item is not ready cannot be opened.

## 6. Audit

New actions follow the existing pattern (labels, tones, categories, plain sentences, same-transaction writes, no links or keys): `content.course.created|edited|reordered|cover_set`, `content.lesson.added|renamed|reordered`, `content.topic.added|edited|reordered`, `content.attachment.added|renamed|reordered` (added covers both uploaded and library; metadata says which), and `playback.viewed` for opening a PDF or image (video and audio use `playback.played`). Upload entries reuse `file.upload_started|completed|failed|cancelled` with the attachment as the target. Example sentence: "Anita Rao added the PDF 'Exit map' to the topic 'Fire exits'". Older entries are unchanged.

## 7. Web

- Sidebar: **Courses** first (above Videos). Routes: `/courses` (table: cover or placeholder, title, lessons, topics, Open, Rename, Move up/down; New course dialog) and `/courses/:courseId?topic=<id>` (the two-pane page).
- Course page: left pane is the course title and cover (Edit) and a tree widget (arrow-key navigation, expanded/collapsed announced) with Add lesson / Add topic, Rename and Move up/down per row; right pane is the selected topic (title, text, Edit) and its attachments in order with Rename and Move up/down. **Add** offers "Upload a file" (the upload dialog accepting all four types) and "From the library" (a picker of ready items by category and folder, searchable by title). On a phone the selected topic replaces the tree, with a Back button.
- Attachment rows show an icon or cover, title, kind, size or length, and an Open action: video → the existing pop-up; audio → the docked player (label "Course › Lesson › Topic", or "Songs › folder" for library items); PDF → a new tab; image → thumbnail, larger in a pop-up. A failed or expired link asks once for a fresh one.
- The upload manager, progress panel, resume list and dock are reused as they are. Plain text only, tokens only, labelled, keyboard operable; skeletons, empty states ("No lessons yet", "No attachments yet") and errors with Retry.

## 8. Testing

Server: every route with its 401/403/404/409/400 cases; the tree answer and its order; reorder exactness; the four kinds at their exact size edges and wrong-bytes discards (including `%PDF-` edge cases); library attachments (not-ready refused, stays current after a library edit, opens the library file); upload, complete, cancel, cleanup and complete-race cases for attachments (including a cover on the course); the migration on a database that already holds media and uploads in progress; audit sentences and the no-keys rule. Web: the tree (expand, select, keyboard, add, rename, reorder, deep link), the topic panel, both Add paths, each Open action, the phone Back behaviour, hostile text, no link stored.

## 9. Acceptance criteria

- A person can build a course with lessons and topics, reorder every level, and attach uploaded files and library items of each type; every attachment opens the right way.
- Wrong or oversized files are refused or discarded and cleaned up; abandoned attachment uploads are cleaned up after 24 hours.
- Every change appears in the audit log with a plain sentence; no link, token or storage key appears anywhere but the response that issues a link.
- Lint, builds and all tests pass (milestone 1–4 included).

## 10. Out of scope

Deleting or removing anything (milestone 6), drag-and-drop, rich text, lesson descriptions, progress or completion tracking, quizzes, sharing, search across courses, mobile sync endpoints (milestone 6), dashboard counts.

## 11. Risks and notes

1. A PDF opens in the browser's own viewer; a phone may download it instead.
2. The tree's keyboard behaviour, the two-pane layout and the phone Back behaviour can only be fully checked in a real browser.
3. A library attachment follows the library item: if the item is later trashed (milestone 6) the attachment will show as unavailable; that behaviour is designed in milestone 6.
4. A wrong file kind sent under an allowed type (for example an MP4 declared as audio) passes the first-bytes check by design, as in milestone 4.
5. Cloudflare is still not connected; `npm run storage:check` is still the only proof for the real service.
