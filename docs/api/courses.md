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
