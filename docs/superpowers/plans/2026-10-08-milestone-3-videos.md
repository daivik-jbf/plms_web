# Milestone 3: Videos (Upload, Storage and Playback) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff and Admin can create folders in the Videos category, upload MP4 videos of up to 2 GiB (with an optional cover image) in pieces with retry and resume, and play them in the portal. Storage is Cloudflare R2 in production; development and tests use stand-ins.

**Architecture:** A `StoragePort` interface with three implementations: `R2Storage` (AWS SDK v3 against R2's S3 API), `LocalStorage` (signed, expiring links served by the API itself from a git-ignored folder; development only) and an in-memory fake (tests). The API owns the database rows and all checks; the browser sends file pieces directly to storage using temporary links. An upload engine in the web app runs the pieces (three in parallel, retries with waits, resume) inside an app-wide upload manager with a progress panel.

**Tech Stack:** Unchanged (NestJS 11, Drizzle, PostgreSQL 17, zod 4; React 19, react-router-dom 7, Vite, Vitest) plus two official dependencies: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (Task 3 only).

**Spec:** `docs/superpowers/specs/2026-10-08-milestone-3-videos-design.md` (binding). Parent spec: `docs/superpowers/specs/2026-10-08-jbf-lms-portal-design.md`. Milestone 1 and 2 code is the baseline.

**Planned deviations from the spec (the user may overrule):**
1. Cover completion path is `POST /api/media/items/:id/cover/:fileId/complete` (the item id is in the path, so the pending cover file needs no extra column). The spec's `POST /covers/:fileId/complete` is replaced by it.
2. `StorageError` has four codes (`no_such_upload`, `invalid_part`, `part_too_small`, `not_found`); a wrong receipt and an unknown piece are both `invalid_part` because R2 answers both the same way.
3. In development, if `STORAGE_SIGNING_SECRET` is missing the local driver generates a random one at start-up (links then stop working when the API restarts), so existing `.env` files keep working. Production refuses the local driver, so this never applies there.

## Global Constraints

- Branch `milestone-3-videos` (already created from `main`; the spec is committed on it). Work only on this branch. Run `git status` before starting and before the final handoff. **Do not push or merge to `main`** until the user approves the milestone. Never force-push; on a conflict stop and show the user.
- Environment for every shell command: `export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"`. Only Task 3 installs packages; it uses `NODE_EXTRA_CA_CERTS=/private/tmp/claude-501/-Users-jbfit-Documents-GitHub-plms-web/54da702a-c25d-4d71-afc1-e140ab238f7f/scratchpad/ca.pem` for `npm view/install/audit` and never disables strict SSL. Verify each new package with `npm view <name> name version license` before installing.
- Decisions inherited (do not undo): NestJS on the 11 line; TypeScript 6 with `module: commonjs` + `moduleResolution: bundler` (API); zod 4; drizzle-orm 0.45; Jest runs serially against one shared, recreated database so tests create their own rows with unique ids; Vitest + Testing Library for the web; native `<dialog>` components from milestone 2.
- **Limits (exact):** max video `2 GiB = 2,147,483,648` bytes; piece size `16 MiB = 16,777,216` bytes (so at most 128 pieces); every piece except the last must be at least `5 MiB`; cover max `10 MiB = 10,485,760`; video type `video/mp4` only; cover types `image/jpeg`, `image/png`, `image/webp`; temporary link lifetime 1 hour; pending uploads older than 24 hours are cleaned up; title 1–200, description at most 2,000, folder name 1–100 (unique per category ignoring case), file name at most 255.
- Every media endpoint needs a signed-in person (Admin or Staff). Nothing in this milestone deletes content. Cancelling a **pending** upload is allowed to its uploader or an Admin; other people's pending uploads answer 403 (their items answer 404 where they must stay invisible).
- Storage keys are random (`videos/<uuid>`, `covers/<uuid>`) and never contain user-typed text. File names are display-only, stripped of path separators and control characters.
- **Links and keys are secrets-adjacent:** no temporary link, signature, token or storage key may appear in any audit entry, log line, error message or API response other than the one that issues that link. The request logger redacts `/api/dev-storage/<token>` paths (Task 2).
- Database change and its audit entry are written in the SAME transaction. Storage calls happen OUTSIDE transactions, in the order given in each task, with best-effort compensation (abort/delete) if the transaction fails.
- Verification on completion is mandatory and server-side: stored size must equal the declared size; stored type must equal the declared type; the first bytes must match the declared kind (MP4 `ftyp` at bytes 4–7; JPEG `FF D8 FF`; PNG `89 50 4E 47`; WebP `RIFF`…`WEBP`). A mismatch deletes the object, aborts the upload, removes the half-created rows, records `file.upload_failed` and answers 422.
- `LocalStorage` and its public `/api/dev-storage/*` routes only work when the storage in use is a `LocalStorage` (otherwise 404); the environment check refuses `STORAGE_DRIVER=local` when `NODE_ENV=production`.
- Web: attacker-influenced text (titles, descriptions, file names, names) is rendered only as React text; no `dangerouslySetInnerHTML`. Temporary links are never stored (no localStorage/sessionStorage) or logged. Files are cut with `Blob.slice` (never read whole into memory) and pieces are sent with `XMLHttpRequest` for progress. Dialogs/drawers use the milestone 2 `Dialog` (including `blocked` while a request runs). Keyboard operable, labelled fields, visible focus, AA contrast, responsive, only design tokens.
- No dead code, no unused exports/imports, no `any`, no `eslint-disable`, no `console.log` outside `apps/api/src/cli`. Commit messages `<type>: <what changed, plain language>`, first line under ~72 characters, followed by a blank line and the attribution trailer your session instructions require. Commit after every task.
- All milestone 1–2 tests keep passing. Test-only code lives under `apps/api/test/` (including the in-memory storage), never in `src/`.

## Review Focus

Inputs and failure modes the spec implies but a happy-path test would miss. Each has a test in the task that owns the code.

1. **Lying declarations:** a size smaller or larger than declared, non-MP4 bytes declared as `video/mp4`, a cover with wrong magic bytes, exactly 2 GiB accepted, 2 GiB + 1 and 0 bytes refused (Tasks 7, 8).
2. **Double and racing completion:** completing twice, completing concurrently, completing after cancel, completing after cleanup: idempotent and never deleting a Ready item (Tasks 7, 9).
3. **Visibility and ownership:** another person's `uploading` item is invisible (list, edit, cover, play = 404); another person's upload endpoints answer 403; an Admin may manage any pending upload (Tasks 6, 7, 8).
4. **Piece arithmetic:** piece count is `ceil(size / 16 MiB)`; the last piece may be small; a non-last piece below 5 MiB is refused; missing pieces refused at completion (422, upload stays pending and resumable) (Tasks 1, 2, 7).
5. **Local links:** expired, tampered, wrong-operation, wrong-object links and path-traversal keys are refused; an oversized piece is refused with 413 (Task 2).
6. **Resume:** the server reports pieces from storage even if the client forgot; the web refuses to resume with a different file (name and size) (Tasks 7, 12).
7. **Cleanup:** after 24 hours only stale pending uploads are removed; Ready and recent ones are untouched; running twice is harmless; a concurrently finishing upload is not damaged (Task 9).
8. **Hostile text and secrets:** titles, descriptions and file names render as inert text; file names are sanitized; links and keys never appear in audit entries, logs or errors (Tasks 2, 5, 6, 10–13).

---

## File Structure

```
apps/api/
  drizzle/0003_media_tables.sql                      (generated)
  src/
    config/env.ts                                    + storage settings
    common/app-logger.ts                             + redact dev-storage link paths
    db/schema.ts                                     + enums/tables: files, media_folders, media_items
    storage/
      storage.constants.ts                           limits (shared by API and tests)
      storage.port.ts                                StoragePort, StorageError, STORAGE token
      signed-token.ts (+ .spec.ts)                   HMAC link tokens for the local driver
      local.storage.ts                               LocalStorage (+ parseRange)
      dev-storage.controller.ts                      public token-authorised routes (local only)
      r2.storage.ts (+ .spec.ts)                     R2Storage + createR2Client
      cors-check.ts (+ .spec.ts)                     pure CORS evaluation for storage:check
      storage.module.ts                              global module, driver factory
    audit/audit.actions.ts, audit-presentation.ts    + 12 media actions
    media/
      media.module.ts  media.schemas.ts  media-views.ts  file-checks.ts (+ spec)
      folders.service.ts  items.service.ts  uploads.service.ts  covers.service.ts
      media.controller.ts  uploads.controller.ts  upload-cleanup.service.ts
    cli/storage-check.ts  cli/storage-cleanup.ts
  test/
    support/ in-memory-storage.ts  storage-contract.ts  in-memory-storage.spec.ts
    helpers/ app.ts (+ storage), media.ts
    storage/ local-storage.e2e-spec.ts  dev-storage.e2e-spec.ts
    media-*.e2e-spec.ts
apps/web/src/
  api/ media.ts
  uploads/ engine.ts  xhr.ts  duration.ts  UploadsContext.tsx  UploadPanel.tsx (+ specs)
  pages/videos/ VideosPage  FolderPage  FolderDialog  UploadDialog  EditVideoDialog  PlayerDialog
                PendingUploads  VideosTable (+ specs)
  components/ nav-items.ts, AppShell.tsx (panel mount)
docs/ storage.md  api/media.md
```

---

### Task 1: Storage port, limits, in-memory stand-in and the shared contract tests

**Files:**
- Create: `apps/api/src/storage/storage.constants.ts`, `apps/api/src/storage/storage.port.ts`
- Create: `apps/api/test/support/in-memory-storage.ts`, `apps/api/test/support/storage-contract.ts`
- Test: `apps/api/test/support/in-memory-storage.spec.ts`

**Interfaces:**
- Produces:

```ts
// storage.constants.ts
MAX_VIDEO_BYTES = 2_147_483_648; PART_SIZE = 16_777_216; MIN_PART_SIZE = 5_242_880; MAX_COVER_BYTES = 10_485_760
VIDEO_CONTENT_TYPE = 'video/mp4'; COVER_CONTENT_TYPES = ['image/jpeg','image/png','image/webp'] as const
LINK_TTL_SECONDS = 3600; MAX_PART_URLS_PER_REQUEST = 16; PENDING_UPLOAD_MAX_AGE_MS = 86_400_000
partCountFor(sizeBytes: number): number
// storage.port.ts
interface StoredPart { partNumber: number; size: number; etag: string }; interface ObjectInfo { size: number; contentType: string }
class StorageError extends Error { code: 'no_such_upload' | 'invalid_part' | 'part_too_small' | 'not_found' }
interface StoragePort { createMultipartUpload(key, contentType): Promise<string>; presignUploadPart(key, uploadId, partNumber, expiresInSeconds): Promise<string>;
  listParts(key, uploadId): Promise<StoredPart[]>; completeMultipartUpload(key, uploadId, parts: {partNumber; etag}[]): Promise<void>;
  abortMultipartUpload(key, uploadId): Promise<void>; presignPut(key, contentType, expiresInSeconds): Promise<string>;
  head(key): Promise<ObjectInfo | null>; readRange(key, start, endInclusive): Promise<Uint8Array>;
  presignGet(key, expiresInSeconds, options: { contentType: string }): Promise<string>; delete(key): Promise<void> }
const STORAGE: unique symbol
// test/support/in-memory-storage.ts
class InMemoryStorage implements StoragePort { putPart(url, body): { etag }; putObject(url, body): void; get(url, range?): { status; body; contentType };
  has(key): boolean; pendingUploadCount(): number; seed(key, body, contentType): void }
// test/support/storage-contract.ts
interface StorageHarness { storage; putPart(url, body): Promise<{status; etag: string | null}>; putObject(url, body, contentType): Promise<{status}>;
  get(url, range?): Promise<{status; body: Uint8Array; contentType: string | null}>; close(): Promise<void> }
describeStorageContract(name: string, create: () => Promise<StorageHarness>): void
```

- [ ] **Step 1: Constants and the port**

`apps/api/src/storage/storage.constants.ts`:

```ts
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const PART_SIZE = 16 * 1024 ** 2;
// S3 and R2 require every piece except the last to be at least this large.
export const MIN_PART_SIZE = 5 * 1024 ** 2;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const VIDEO_CONTENT_TYPE = 'video/mp4';
export const COVER_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const LINK_TTL_SECONDS = 3600;
export const MAX_PART_URLS_PER_REQUEST = 16;
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const partCountFor = (sizeBytes: number): number => Math.ceil(sizeBytes / PART_SIZE);
```

`apps/api/src/storage/storage.port.ts`:

```ts
export interface StoredPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface ObjectInfo {
  size: number;
  contentType: string;
}

export type StorageErrorCode = 'no_such_upload' | 'invalid_part' | 'part_too_small' | 'not_found';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface StoragePort {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<StoredPart[]>;
  completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectInfo | null>;
  readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;
  presignGet(key: string, expiresInSeconds: number, options: { contentType: string }): Promise<string>;
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');
```

- [ ] **Step 2: The shared contract tests (written first; they fail until the stand-in exists)**

`apps/api/test/support/storage-contract.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { MIN_PART_SIZE } from '../../src/storage/storage.constants';
import type { StoragePort } from '../../src/storage/storage.port';

export interface StorageHarness {
  storage: StoragePort;
  putPart(url: string, body: Uint8Array): Promise<{ status: number; etag: string | null }>;
  putObject(url: string, body: Uint8Array, contentType: string): Promise<{ status: number }>;
  get(url: string, range?: { start: number; end: number }): Promise<{ status: number; body: Uint8Array; contentType: string | null }>;
  close(): Promise<void>;
}

const filled = (length: number, value: number): Uint8Array => new Uint8Array(length).fill(value);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const newKey = (prefix: 'videos' | 'covers' = 'videos'): string => `${prefix}/${randomUUID()}`;

export function describeStorageContract(name: string, create: () => Promise<StorageHarness>): void {
  describe(`storage contract: ${name}`, () => {
    let harness: StorageHarness;

    beforeAll(async () => {
      harness = await create();
    });

    afterAll(async () => {
      await harness.close();
    });

    async function uploadPiece(key: string, uploadId: string, partNumber: number, body: Uint8Array) {
      const url = await harness.storage.presignUploadPart(key, uploadId, partNumber, 3600);
      const result = await harness.putPart(url, body);
      expect(result.status).toBe(200);
      expect(result.etag).toBeTruthy();
      return { partNumber, etag: result.etag as string };
    }

    it('joins the pieces in order and reports the stored size and type', async () => {
      const { storage } = harness;
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const second = await uploadPiece(key, uploadId, 2, text('tail!'));
      const first = await uploadPiece(key, uploadId, 1, filled(MIN_PART_SIZE, 1));
      await storage.completeMultipartUpload(key, uploadId, [first, second]);

      expect(await storage.head(key)).toEqual({ size: MIN_PART_SIZE + 5, contentType: 'video/mp4' });
      const across = await storage.readRange(key, MIN_PART_SIZE - 2, MIN_PART_SIZE + 1);
      expect(Array.from(across)).toEqual([1, 1, 116, 97]);
    });

    it('lists the pieces stored so far with their size and receipt', async () => {
      const { storage } = harness;
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      expect(await storage.listParts(key, uploadId)).toEqual([]);
      const piece = await uploadPiece(key, uploadId, 3, text('0123456789'));
      expect(await storage.listParts(key, uploadId)).toEqual([{ partNumber: 3, size: 10, etag: piece.etag }]);
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('refuses to finish when a piece other than the last is smaller than 5 MiB', async () => {
      const { storage } = harness;
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const first = await uploadPiece(key, uploadId, 1, text('small'));
      const second = await uploadPiece(key, uploadId, 2, text('also small'));
      await expect(storage.completeMultipartUpload(key, uploadId, [first, second])).rejects.toMatchObject({ code: 'part_too_small' });
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('refuses a wrong receipt and a piece that was never uploaded', async () => {
      const { storage } = harness;
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const only = await uploadPiece(key, uploadId, 1, text('hello'));
      await expect(storage.completeMultipartUpload(key, uploadId, [{ partNumber: 1, etag: '"not-the-receipt"' }])).rejects.toMatchObject({
        code: 'invalid_part',
      });
      await expect(storage.completeMultipartUpload(key, uploadId, [only, { partNumber: 2, etag: only.etag }])).rejects.toMatchObject({
        code: 'invalid_part',
      });
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('forgets an aborted upload and refuses a second completion', async () => {
      const { storage } = harness;
      const aborted = newKey();
      const abortedId = await storage.createMultipartUpload(aborted, 'video/mp4');
      await storage.abortMultipartUpload(aborted, abortedId);
      await expect(storage.listParts(aborted, abortedId)).rejects.toMatchObject({ code: 'no_such_upload' });
      await expect(storage.abortMultipartUpload(aborted, abortedId)).rejects.toMatchObject({ code: 'no_such_upload' });

      const finished = newKey();
      const finishedId = await storage.createMultipartUpload(finished, 'video/mp4');
      const piece = await uploadPiece(finished, finishedId, 1, text('done'));
      await storage.completeMultipartUpload(finished, finishedId, [piece]);
      await expect(storage.completeMultipartUpload(finished, finishedId, [piece])).rejects.toMatchObject({ code: 'no_such_upload' });
    });

    it('stores a single small object through a temporary upload link', async () => {
      const { storage } = harness;
      const key = newKey('covers');
      const url = await storage.presignPut(key, 'image/png', 3600);
      expect((await harness.putObject(url, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'image/png')).status).toBe(200);
      expect(await storage.head(key)).toEqual({ size: 6, contentType: 'image/png' });
      expect(Array.from(await storage.readRange(key, 0, 3))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('answers "not found" for missing objects and deletes idempotently', async () => {
      const { storage } = harness;
      const key = newKey('covers');
      expect(await storage.head(key)).toBeNull();
      await expect(storage.readRange(key, 0, 3)).rejects.toMatchObject({ code: 'not_found' });
      const url = await storage.presignPut(key, 'image/webp', 3600);
      await harness.putObject(url, text('webp'), 'image/webp');
      await storage.delete(key);
      await storage.delete(key);
      expect(await storage.head(key)).toBeNull();
    });

    it('serves a stored object through a temporary read link, including byte ranges', async () => {
      const { storage } = harness;
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const piece = await uploadPiece(key, uploadId, 1, text('0123456789'));
      await storage.completeMultipartUpload(key, uploadId, [piece]);
      const url = await storage.presignGet(key, 3600, { contentType: 'video/mp4' });

      const whole = await harness.get(url);
      expect(whole.status).toBe(200);
      expect(whole.contentType).toMatch(/^video\/mp4/);
      expect(new TextDecoder().decode(whole.body)).toBe('0123456789');

      const slice = await harness.get(url, { start: 2, end: 5 });
      expect(slice.status).toBe(206);
      expect(new TextDecoder().decode(slice.body)).toBe('2345');
    });
  });
}
```

- [ ] **Step 3: The in-memory stand-in**

`apps/api/test/support/in-memory-storage.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { MIN_PART_SIZE } from '../../src/storage/storage.constants';
import { type ObjectInfo, type StoragePort, StorageError, type StoredPart } from '../../src/storage/storage.port';

interface PendingUpload {
  key: string;
  contentType: string;
  parts: Map<number, { body: Buffer; etag: string }>;
}

interface StoredObject {
  body: Buffer;
  contentType: string;
}

const etagOf = (body: Uint8Array): string => `"${createHash('md5').update(body).digest('hex')}"`;

// A faithful stand-in for R2 in tests: real multipart rules (receipts, ordering, the 5 MiB minimum), but links
// are plain strings that only this class understands.
export class InMemoryStorage implements StoragePort {
  private readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, PendingUpload>();

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { key, contentType, parts: new Map() });
    return uploadId;
  }

  async presignUploadPart(_key: string, uploadId: string, partNumber: number, expiresInSeconds: number): Promise<string> {
    return `memory://part/${uploadId}/${partNumber}?expires=${expiresInSeconds}`;
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const upload = this.requireUpload(key, uploadId);
    return [...upload.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([partNumber, part]) => ({ partNumber, size: part.body.length, etag: part.etag }));
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const upload = this.requireUpload(key, uploadId);
    let previous = 0;
    const chosen: Buffer[] = [];
    for (const [index, requested] of parts.entries()) {
      const stored = upload.parts.get(requested.partNumber);
      if (requested.partNumber <= previous || !stored || stored.etag !== requested.etag) {
        throw new StorageError('invalid_part', 'A piece is missing or does not match its receipt.');
      }
      if (index < parts.length - 1 && stored.body.length < MIN_PART_SIZE) {
        throw new StorageError('part_too_small', 'Every piece except the last must be at least 5 MiB.');
      }
      previous = requested.partNumber;
      chosen.push(stored.body);
    }
    this.objects.set(key, { body: Buffer.concat(chosen), contentType: upload.contentType });
    this.uploads.delete(uploadId);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.requireUpload(key, uploadId);
    this.uploads.delete(uploadId);
  }

  async presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return `memory://put/${encodeURIComponent(key)}?type=${encodeURIComponent(contentType)}&expires=${expiresInSeconds}`;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const object = this.objects.get(key);
    return object ? { size: object.body.length, contentType: object.contentType } : null;
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new StorageError('not_found', 'No such object.');
    return new Uint8Array(object.body.subarray(start, endInclusive + 1));
  }

  async presignGet(key: string, expiresInSeconds: number, options: { contentType: string }): Promise<string> {
    return `memory://get/${encodeURIComponent(key)}?type=${encodeURIComponent(options.contentType)}&expires=${expiresInSeconds}`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  // ---- Test helpers: what a browser (or R2) would do with the links above. ----

  putPart(url: string, body: Uint8Array): { etag: string } {
    const match = /^memory:\/\/part\/([^/]+)\/(\d+)\?/.exec(url);
    if (!match) throw new Error('Not a piece link');
    const upload = this.uploads.get(match[1] as string);
    if (!upload) throw new Error('That upload no longer exists');
    const etag = etagOf(body);
    upload.parts.set(Number(match[2]), { body: Buffer.from(body), etag });
    return { etag };
  }

  putObject(url: string, body: Uint8Array): void {
    const match = /^memory:\/\/put\/([^?]+)\?type=([^&]+)/.exec(url);
    if (!match) throw new Error('Not an upload link');
    this.objects.set(decodeURIComponent(match[1] as string), {
      body: Buffer.from(body),
      contentType: decodeURIComponent(match[2] as string),
    });
  }

  get(url: string, range?: { start: number; end: number }): { status: number; body: Uint8Array; contentType: string | null } {
    const match = /^memory:\/\/get\/([^?]+)\?type=([^&]+)/.exec(url);
    if (!match) throw new Error('Not a read link');
    const object = this.objects.get(decodeURIComponent(match[1] as string));
    if (!object) return { status: 404, body: new Uint8Array(), contentType: null };
    const contentType = decodeURIComponent(match[2] as string);
    if (range) return { status: 206, body: new Uint8Array(object.body.subarray(range.start, range.end + 1)), contentType };
    return { status: 200, body: new Uint8Array(object.body), contentType };
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  pendingUploadCount(): number {
    return this.uploads.size;
  }

  // Puts a finished object straight into the store (for tests that need a stored file without uploading it).
  seed(key: string, body: Uint8Array, contentType: string): void {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  private requireUpload(key: string, uploadId: string): PendingUpload {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new StorageError('no_such_upload', 'That upload does not exist.');
    return upload;
  }
}
```

`apps/api/test/support/in-memory-storage.spec.ts`:

```ts
import { InMemoryStorage } from './in-memory-storage';
import { describeStorageContract } from './storage-contract';

describeStorageContract('InMemoryStorage', async () => {
  const storage = new InMemoryStorage();
  return {
    storage,
    putPart: async (url, body) => ({ status: 200, etag: storage.putPart(url, body).etag }),
    putObject: async (url, body) => {
      storage.putObject(url, body);
      return { status: 200 };
    },
    get: async (url, range) => storage.get(url, range),
    close: async () => undefined,
  };
});
```

- [ ] **Step 4: Run, lint, build**

Run: `npm test -w @jbf/api -- in-memory-storage && npm run lint && npm run build -w @jbf/api`
Expected: the 8 contract tests PASS, lint clean (no unused exports: `InMemoryStorage.has/pendingUploadCount/seed` are used by later tasks' tests; `MAX_VIDEO_BYTES`, `COVER_CONTENT_TYPES`, `LINK_TTL_SECONDS`, `MAX_PART_URLS_PER_REQUEST`, `PENDING_UPLOAD_MAX_AGE_MS`, `partCountFor`, `VIDEO_CONTENT_TYPE`, `MAX_COVER_BYTES`, `PART_SIZE` are consumed by Tasks 2–9). If lint flags an export as unused, leave it: the plan consumes it later in this same milestone.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage apps/api/test/support
git commit -m "feat: add the storage interface, limits and an in-memory stand-in"
```

---

### Task 2: Local development storage (signed links, dev routes, settings, log redaction)

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`, `apps/api/src/common/app-logger.ts`, `apps/api/src/app.module.ts`, `apps/api/test/helpers/app.ts`, `.gitignore`, `apps/api/.env.example`
- Create: `apps/api/src/storage/{signed-token.ts,signed-token.spec.ts,local.storage.ts,dev-storage.controller.ts,storage.module.ts}`
- Create: `apps/api/src/common/app-logger.spec.ts`
- Test: `apps/api/test/storage/local-storage.e2e-spec.ts`

**Interfaces:**
- Consumes: `StoragePort`, `StorageError`, `STORAGE`, constants (Task 1); `ENV`, `Public`, `describeStorageContract`.
- Produces:

```ts
// signed-token.ts
type LinkPayload = { op: 'part'; key; uploadId; partNumber; exp } | { op: 'put'; key; contentType; exp } | { op: 'get'; key; contentType; exp }   // exp = unix seconds
signLink(payload, secret): string; verifyLink(token, secret, nowMs): LinkPayload | null
// local.storage.ts
class LocalStorage implements StoragePort { constructor(options: { rootDir: string; signingSecret: string; now?: () => number });
  verify(token): LinkPayload | null; acceptPart(link, source: Readable): Promise<string /*etag*/>; acceptObject(link, source): Promise<void>;
  openObject(key, range?: { start; end }): Promise<{ stream: Readable; size; start; end; contentType }> }
class LinkTooLargeError extends Error;  parseRange(header: string | undefined, size: number): { start; end } | null | 'invalid'
// env: STORAGE_DRIVER ('local' for now), STORAGE_LOCAL_DIR (default './.storage'), STORAGE_SIGNING_SECRET (optional, >= 32 chars)
// HTTP (public, token-authorised, local driver only): PUT /api/dev-storage/:token, GET /api/dev-storage/:token
// createTestApp() now also returns { storage: InMemoryStorage }
```

- [ ] **Step 1: Failing unit tests for tokens, env and the logger redaction**

`apps/api/src/storage/signed-token.spec.ts`:

```ts
import { signLink, verifyLink } from './signed-token';

const SECRET = 's'.repeat(40);
const now = Date.UTC(2026, 9, 8, 12, 0, 0);
const exp = Math.floor(now / 1000) + 3600;
const part = { op: 'part', key: 'videos/4c0d6f0e-5a49-4c0b-8f43-8a4a9d6a0f11', uploadId: 'u-1', partNumber: 3, exp } as const;

describe('signed links', () => {
  it('round-trips a payload', () => {
    expect(verifyLink(signLink(part, SECRET), SECRET, now)).toEqual(part);
  });

  it('rejects a tampered body, a tampered signature and another secret', () => {
    const token = signLink(part, SECRET);
    const [body, signature] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...part, partNumber: 4 })).toString('base64url');
    expect(verifyLink(`${forgedBody}.${signature}`, SECRET, now)).toBeNull();
    expect(verifyLink(`${body}.${signature.slice(0, -2)}xx`, SECRET, now)).toBeNull();
    expect(verifyLink(token, 'o'.repeat(40), now)).toBeNull();
  });

  it('rejects an expired link (the expiry second itself is already too late)', () => {
    expect(verifyLink(signLink({ ...part, exp: Math.floor(now / 1000) }, SECRET), SECRET, now)).toBeNull();
    expect(verifyLink(signLink({ ...part, exp: Math.floor(now / 1000) + 1 }, SECRET), SECRET, now)).not.toBeNull();
  });

  it.each(['', 'garbage', 'a.b.c', '.', 'a.', '.b'])('rejects malformed token %p', (token) => {
    expect(verifyLink(token, SECRET, now)).toBeNull();
  });

  it('rejects a payload with an unknown operation even when correctly signed', () => {
    const odd = signLink({ op: 'delete', key: 'x', exp } as never, SECRET);
    expect(verifyLink(odd, SECRET, now)).toBeNull();
  });
});
```

In `apps/api/src/config/env.spec.ts` add inside the existing `describe('parseEnv', …)`:

```ts
  it('defaults the storage settings for development', () => {
    const env = parseEnv(base);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_LOCAL_DIR).toBe('./.storage');
    expect(env.STORAGE_SIGNING_SECRET).toBeUndefined();
  });

  it('rejects a short signing secret', () => {
    expect(() => parseEnv({ ...base, STORAGE_SIGNING_SECRET: 'short' })).toThrow(/STORAGE_SIGNING_SECRET/);
  });
```

`apps/api/src/common/app-logger.spec.ts`:

```ts
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { type AppLogger, requestLogger } from './app-logger';

function run(path: string): Record<string, unknown> {
  const logged: Record<string, unknown>[] = [];
  const logger = { event: (fields: Record<string, unknown>) => logged.push(fields) } as unknown as AppLogger;
  const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
  requestLogger(logger)({ method: 'PUT', path } as Request, res, () => undefined);
  res.emit('finish');
  return logged[0] as Record<string, unknown>;
}

describe('requestLogger', () => {
  it('logs the path of ordinary requests', () => {
    expect(run('/api/audit').path).toBe('/api/audit');
  });

  it('never logs the signed link inside a development storage path', () => {
    const entry = run('/api/dev-storage/eyJvcCI6InB1dCJ9.c2lnbmF0dXJl');
    expect(entry.path).toBe('/api/dev-storage/[link]');
    expect(JSON.stringify(entry)).not.toContain('eyJ');
  });
});
```

Run: `npm test -w @jbf/api -- signed-token env.spec app-logger` → FAIL.

- [ ] **Step 2: Implement tokens, env settings and log redaction**

`apps/api/src/storage/signed-token.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LinkPayload =
  | { op: 'part'; key: string; uploadId: string; partNumber: number; exp: number }
  | { op: 'put'; key: string; contentType: string; exp: number }
  | { op: 'get'; key: string; contentType: string; exp: number };

const OPERATIONS = new Set(['part', 'put', 'get']);

const sign = (body: string, secret: string): string => createHmac('sha256', secret).update(body).digest('base64url');

export function signLink(payload: LinkPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyLink(token: string, secret: string, nowMs: number): LinkPayload | null {
  const pieces = token.split('.');
  const [body, signature] = pieces;
  if (pieces.length !== 2 || !body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: LinkPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkPayload;
  } catch {
    return null;
  }
  if (!OPERATIONS.has(payload.op) || typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
  return payload;
}
```

`apps/api/src/config/env.ts`: add to the zod object after `AUDIT_EXPORT_MAX_ROWS`:

```ts
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./.storage'),
    STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
```

`apps/api/src/common/app-logger.ts`: in `requestLogger`, replace the `path: req.path` field with `path: loggablePath(req.path)` and add above the function:

```ts
// Links for the development storage routes carry a signed token in the path; it must never reach the logs.
const loggablePath = (path: string): string => (path.startsWith('/api/dev-storage/') ? '/api/dev-storage/[link]' : path);
```

`.gitignore`: append `.storage/`. `apps/api/.env.example`: append

```
# Storage: "local" keeps files in STORAGE_LOCAL_DIR (development only). The signing secret is optional in
# development; if it is missing a random one is generated at start-up.
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./.storage
# STORAGE_SIGNING_SECRET=change-me-to-a-random-string-of-at-least-32-characters
```

Run: `npm test -w @jbf/api -- signed-token env.spec app-logger` → PASS.

- [ ] **Step 3: The local driver**

`apps/api/src/storage/local.storage.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import { Transform, type TransformCallback, type Readable } from 'node:stream';
import { MAX_COVER_BYTES, MIN_PART_SIZE, PART_SIZE } from './storage.constants';
import { type LinkPayload, signLink, verifyLink } from './signed-token';
import { type ObjectInfo, type StoragePort, StorageError, type StoredPart } from './storage.port';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^(videos|covers)/${UUID}$`);
const UPLOAD_ID_PATTERN = new RegExp(`^${UUID}$`);

export class LinkTooLargeError extends Error {}

class Digest extends Transform {
  size = 0;
  private readonly hash = createHash('md5');

  constructor(private readonly limit: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.limit) {
      callback(new LinkTooLargeError());
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  etag(): string {
    return `"${this.hash.digest('hex')}"`;
  }
}

// "bytes=a-b", "bytes=a-" and "bytes=-n" (the last n bytes). Returns null when no range was asked for and
// 'invalid' when the range cannot be satisfied.
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export interface LocalStorageOptions {
  rootDir: string;
  signingSecret: string;
  now?: () => number;
}

interface UploadMeta {
  key: string;
  contentType: string;
}

export class LocalStorage implements StoragePort {
  private readonly now: () => number;

  constructor(private readonly options: LocalStorageOptions) {
    this.now = options.now ?? Date.now;
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    this.assertKey(key);
    const uploadId = randomUUID();
    const dir = this.uploadDir(uploadId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ key, contentType } satisfies UploadMeta));
    return uploadId;
  }

  async presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number): Promise<string> {
    this.assertKey(key);
    return this.link({ op: 'part', key, uploadId, partNumber, exp: this.expiry(expiresInSeconds) });
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const dir = this.uploadDir(uploadId);
    await this.readUploadMeta(dir, key);
    const entries = await readdir(dir);
    const parts: StoredPart[] = [];
    for (const entry of entries.filter((name) => /^\d+\.json$/.test(name))) {
      parts.push(JSON.parse(await readFile(join(dir, entry), 'utf8')) as StoredPart);
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const dir = this.uploadDir(uploadId);
    const meta = await this.readUploadMeta(dir, key);
    const stored: StoredPart[] = [];
    let previous = 0;
    for (const requested of parts) {
      const found = await this.readPartMeta(dir, requested.partNumber);
      if (requested.partNumber <= previous || !found || found.etag !== requested.etag) {
        throw new StorageError('invalid_part', 'A piece is missing or does not match its receipt.');
      }
      previous = requested.partNumber;
      stored.push(found);
    }
    stored.slice(0, -1).forEach((part) => {
      if (part.size < MIN_PART_SIZE) throw new StorageError('part_too_small', 'Every piece except the last must be at least 5 MiB.');
    });

    const target = this.objectPath(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const output = createWriteStream(temporary);
    for (const part of stored) {
      await pipeline(createReadStream(join(dir, String(part.partNumber))), output, { end: false });
    }
    output.end();
    await finished(output);
    await rename(temporary, target);
    await writeFile(this.metaPath(key), JSON.stringify({ contentType: meta.contentType }));
    await rm(dir, { recursive: true, force: true });
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const dir = this.uploadDir(uploadId);
    await this.readUploadMeta(dir, key);
    await rm(dir, { recursive: true, force: true });
  }

  async presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    this.assertKey(key);
    return this.link({ op: 'put', key, contentType, exp: this.expiry(expiresInSeconds) });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const [info, meta] = await Promise.all([stat(this.objectPath(key)), readFile(this.metaPath(key), 'utf8')]);
      return { size: info.size, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    let handle;
    try {
      handle = await open(this.objectPath(key), 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageError('not_found', 'No such object.');
      throw error;
    }
    try {
      const { size } = await handle.stat();
      const last = Math.min(endInclusive, size - 1);
      if (start > last) return new Uint8Array();
      const buffer = Buffer.alloc(last - start + 1);
      await handle.read(buffer, 0, buffer.length, start);
      return new Uint8Array(buffer);
    } finally {
      await handle.close();
    }
  }

  async presignGet(key: string, expiresInSeconds: number, options: { contentType: string }): Promise<string> {
    this.assertKey(key);
    return this.link({ op: 'get', key, contentType: options.contentType, exp: this.expiry(expiresInSeconds) });
  }

  async delete(key: string): Promise<void> {
    await rm(this.objectPath(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  // ---- Used by the development routes ----

  verify(token: string): LinkPayload | null {
    return verifyLink(token, this.options.signingSecret, this.now());
  }

  async acceptPart(link: Extract<LinkPayload, { op: 'part' }>, source: Readable): Promise<string> {
    const dir = this.uploadDir(link.uploadId);
    await this.readUploadMeta(dir, link.key);
    const target = join(dir, String(link.partNumber));
    const temporary = `${target}.${randomUUID()}.tmp`;
    const digest = new Digest(PART_SIZE);
    try {
      await pipeline(source, digest, createWriteStream(temporary));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    const etag = digest.etag();
    await rename(temporary, target);
    await writeFile(`${target}.json`, JSON.stringify({ partNumber: link.partNumber, size: digest.size, etag } satisfies StoredPart));
    return etag;
  }

  async acceptObject(link: Extract<LinkPayload, { op: 'put' }>, source: Readable): Promise<void> {
    const target = this.objectPath(link.key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await pipeline(source, new Digest(MAX_COVER_BYTES), createWriteStream(temporary));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await rename(temporary, target);
    await writeFile(this.metaPath(link.key), JSON.stringify({ contentType: link.contentType }));
  }

  async openObject(
    key: string,
    range: { start: number; end: number } | null,
  ): Promise<{ stream: Readable; size: number; start: number; end: number; contentType: string }> {
    const info = await this.head(key);
    if (!info) throw new StorageError('not_found', 'No such object.');
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    return { stream: createReadStream(this.objectPath(key), { start, end }), size: info.size, start, end, contentType: info.contentType };
  }

  // ---- Internals ----

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
  }

  private objectPath(key: string): string {
    this.assertKey(key);
    return join(this.options.rootDir, 'objects', key);
  }

  private metaPath(key: string): string {
    return `${this.objectPath(key)}.json`;
  }

  private uploadDir(uploadId: string): string {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new StorageError('no_such_upload', 'That upload does not exist.');
    return join(this.options.rootDir, 'uploads', uploadId);
  }

  private async readUploadMeta(dir: string, key: string): Promise<UploadMeta> {
    try {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as UploadMeta;
      if (meta.key === key) return meta;
    } catch {
      // Falls through to the error below: a missing or unreadable upload is the same as an unknown one.
    }
    throw new StorageError('no_such_upload', 'That upload does not exist.');
  }

  private async readPartMeta(dir: string, partNumber: number): Promise<StoredPart | null> {
    try {
      return JSON.parse(await readFile(join(dir, `${partNumber}.json`), 'utf8')) as StoredPart;
    } catch {
      return null;
    }
  }

  private expiry(seconds: number): number {
    return Math.floor(this.now() / 1000) + seconds;
  }

  private link(payload: LinkPayload): string {
    return `/api/dev-storage/${signLink(payload, this.options.signingSecret)}`;
  }
}
```

- [ ] **Step 4: The public development routes and the module**

`apps/api/src/storage/dev-storage.controller.ts`:

```ts
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { LinkTooLargeError, LocalStorage, parseRange } from './local.storage';
import { STORAGE, StorageError, type StoragePort } from './storage.port';

// Token-authorised stand-ins for R2's temporary links. They only exist while the storage in use is the local
// driver; with any other driver every route answers 404. They are public (no sign-in) because the signed,
// expiring token in the path is the credential, exactly like an R2 link.
@Public()
@SkipThrottle()
@Controller('dev-storage')
export class DevStorageController {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  @Put(':token')
  async put(@Req() req: Request, @Res() res: Response): Promise<void> {
    const local = this.local();
    const link = local.verify(String(req.params.token));
    if (!link || link.op === 'get') throw new ForbiddenException('This link is invalid or has expired.');
    try {
      if (link.op === 'part') {
        res.setHeader('ETag', await local.acceptPart(link, req));
      } else {
        if (req.headers['content-type'] !== link.contentType) throw new ForbiddenException('This link is invalid or has expired.');
        await local.acceptObject(link, req);
      }
    } catch (error) {
      if (error instanceof LinkTooLargeError) throw new PayloadTooLargeException('That file is too large for this link.');
      if (error instanceof StorageError) throw new NotFoundException('That upload does not exist.');
      throw error;
    }
    res.status(200).end();
  }

  @Get(':token')
  async read(@Req() req: Request, @Res() res: Response): Promise<void> {
    const local = this.local();
    const link = local.verify(String(req.params.token));
    if (!link || link.op !== 'get') throw new ForbiddenException('This link is invalid or has expired.');
    const info = await local.head(link.key);
    if (!info) throw new NotFoundException('Not found.');
    const range = parseRange(req.headers.range, info.size);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${info.size}`).end();
      return;
    }
    const opened = await local.openObject(link.key, range);
    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', link.contentType);
    res.setHeader('Content-Length', String(opened.end - opened.start + 1));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    if (range) res.setHeader('Content-Range', `bytes ${opened.start}-${opened.end}/${opened.size}`);
    opened.stream.pipe(res);
  }

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new NotFoundException();
    return this.storage;
  }
}
```

`apps/api/src/storage/storage.module.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DevStorageController } from './dev-storage.controller';
import { LocalStorage } from './local.storage';
import { STORAGE, type StoragePort } from './storage.port';

export function createStorage(env: Env): StoragePort {
  // A missing development secret means links stop working when the API restarts, which is fine for development.
  return new LocalStorage({
    rootDir: resolve(env.STORAGE_LOCAL_DIR),
    signingSecret: env.STORAGE_SIGNING_SECRET ?? randomBytes(32).toString('hex'),
  });
}

@Global()
@Module({
  controllers: [DevStorageController],
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: createStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
```

`apps/api/src/app.module.ts`: add `import { StorageModule } from './storage/storage.module';` and `StorageModule` to the `imports` array (after `MailModule`).

`apps/api/test/helpers/app.ts` (replace): keep everything as is, plus the storage override:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { DB, PG_POOL, type Database } from '../../src/db/db.module';
import { MAILER } from '../../src/mail/mailer';
import { STORAGE } from '../../src/storage/storage.port';
import { InMemoryStorage } from '../support/in-memory-storage';
import { MemoryMailer } from './memory-mailer';

export async function createTestApp() {
  const mailer = new MemoryMailer();
  const storage = new InMemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(STORAGE)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const logger = new AppLogger('silent');
  app.useLogger(logger);
  configureApp(app, parseEnv(process.env), logger);
  await app.init();
  // Listen once on an ephemeral port. Without this supertest starts a server per request and closes the
  // shared one when any request ends, which breaks requests that are built before an awaited login.
  await app.listen(0);
  // Open several pool connections up front so tests that fire requests concurrently do not skew timing
  // by one request waiting on a fresh connection.
  await Promise.all(Array.from({ length: 4 }, () => app.get<Pool>(PG_POOL).query('select 1')));
  return { app, db: app.get<Database>(DB), mailer, storage };
}
```

(Before overwriting, read the current `apps/api/test/helpers/app.ts` and keep any line that differs from the above and is not related to storage.)

- [ ] **Step 5: The e2e tests for the local driver (contract suite over HTTP, plus local-only cases)**

`apps/api/test/storage/local-storage.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppLogger } from '../../src/common/app-logger';
import { parseEnv } from '../../src/config/env';
import { LocalStorage } from '../../src/storage/local.storage';
import { MIN_PART_SIZE, PART_SIZE } from '../../src/storage/storage.constants';
import { STORAGE } from '../../src/storage/storage.port';
import { describeStorageContract } from '../support/storage-contract';

const SECRET = 'e2e-secret-e2e-secret-e2e-secret-123';

let app: NestExpressApplication;
let storage: LocalStorage;
let root: string;
let clock = Date.now();

const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jbf-storage-'));
  storage = new LocalStorage({ rootDir: root, signingSecret: SECRET, now: () => clock });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(STORAGE).useValue(storage).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  const logger = new AppLogger('silent');
  app.useLogger(logger);
  configureApp(app, parseEnv(process.env), logger);
  await app.init();
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const http = () => request(app.getHttpServer());

describeStorageContract('LocalStorage over HTTP', async () => ({
  storage,
  putPart: async (url, body) => {
    const res = await http().put(url).set('Content-Type', 'application/octet-stream').send(Buffer.from(body));
    return { status: res.status, etag: (res.headers.etag as string | undefined) ?? null };
  },
  putObject: async (url, body, contentType) => {
    const res = await http().put(url).set('Content-Type', contentType).send(Buffer.from(body));
    return { status: res.status };
  },
  get: async (url, range) => {
    const req = http().get(url).buffer(true).parse(binary);
    if (range) req.set('Range', `bytes=${range.start}-${range.end}`);
    const res = await req;
    return { status: res.status, body: new Uint8Array(res.body as Buffer), contentType: (res.headers['content-type'] as string | undefined) ?? null };
  },
  close: async () => undefined,
}));

describe('LocalStorage development routes', () => {
  const key = () => `videos/${randomUUID()}`;

  it('refuses expired links', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const url = await storage.presignUploadPart(k, uploadId, 1, 60);
    clock += 61_000;
    const res = await http().put(url).send(Buffer.from('late'));
    clock -= 61_000;
    expect(res.status).toBe(403);
  });

  it('refuses a tampered link, a link for another operation, and a missing token', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const url = await storage.presignUploadPart(k, uploadId, 1, 3600);
    expect((await http().put(`${url}x`).send(Buffer.from('a'))).status).toBe(403);
    expect((await http().get(url)).status).toBe(403);
    expect((await http().put('/api/dev-storage/').send(Buffer.from('a'))).status).toBe(404);
    const readUrl = await storage.presignGet(k, 3600, { contentType: 'video/mp4' });
    expect((await http().put(readUrl).send(Buffer.from('a'))).status).toBe(403);
  });

  it('refuses a piece larger than 16 MiB with 413 and keeps nothing', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const url = await storage.presignUploadPart(k, uploadId, 1, 3600);
    const res = await http().put(url).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(PART_SIZE + 1));
    expect(res.status).toBe(413);
    expect(await storage.listParts(k, uploadId)).toEqual([]);
  });

  it('accepts a piece of exactly 16 MiB and one of the minimum size', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const full = await storage.presignUploadPart(k, uploadId, 1, 3600);
    expect((await http().put(full).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(PART_SIZE))).status).toBe(200);
    const minimum = await storage.presignUploadPart(k, uploadId, 2, 3600);
    expect((await http().put(minimum).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(MIN_PART_SIZE))).status).toBe(200);
  });

  it('requires the declared content type for a single upload link', async () => {
    const k = `covers/${randomUUID()}`;
    const url = await storage.presignPut(k, 'image/png', 3600);
    expect((await http().put(url).set('Content-Type', 'image/jpeg').send(Buffer.from('x'))).status).toBe(403);
    expect((await http().put(url).set('Content-Type', 'image/png').send(Buffer.from('x'))).status).toBe(200);
  });

  it('answers 404 for a piece of an upload that does not exist', async () => {
    const k = key();
    const url = await storage.presignUploadPart(k, randomUUID(), 1, 3600);
    expect((await http().put(url).send(Buffer.from('x'))).status).toBe(404);
  });

  it('refuses keys that could escape the storage folder', async () => {
    await expect(storage.presignGet('../../etc/passwd', 60, { contentType: 'text/plain' })).rejects.toThrow('Invalid storage key');
    await expect(storage.head('videos/../../x')).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload('videos/not-a-uuid', 'video/mp4')).rejects.toThrow('Invalid storage key');
  });

  it('answers 416 for a range outside the file and supports open and suffix ranges', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const piece = await storage.presignUploadPart(k, uploadId, 1, 3600);
    const etag = (await http().put(piece).set('Content-Type', 'application/octet-stream').send(Buffer.from('0123456789'))).headers.etag as string;
    await storage.completeMultipartUpload(k, uploadId, [{ partNumber: 1, etag }]);
    const url = await storage.presignGet(k, 3600, { contentType: 'video/mp4' });
    const ranged = async (range: string) => http().get(url).set('Range', range).buffer(true).parse(binary);
    expect((await ranged('bytes=50-60')).status).toBe(416);
    const open = await ranged('bytes=6-');
    expect(open.status).toBe(206);
    expect(open.headers['content-range']).toBe('bytes 6-9/10');
    expect((open.body as Buffer).toString()).toBe('6789');
    expect(((await ranged('bytes=-3')).body as Buffer).toString()).toBe('789');
  });
});
```

`apps/api/test/storage/dev-storage.e2e-spec.ts` (the routes are inert with any other driver; uses the standard test app with the in-memory storage):

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('development storage routes without the local driver', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(() => app.close());

  it('answer 404 for every method, so nothing is exposed when another driver is in use', async () => {
    await request(app.getHttpServer()).put('/api/dev-storage/anything.signature').send('x').expect(404);
    await request(app.getHttpServer()).get('/api/dev-storage/anything.signature').expect(404);
  });
});
```

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS, including the 8 contract tests over HTTP and the 8 local-driver tests. If supertest cannot send a 17 MiB body or times out, raise the Jest timeout for that single test (`, 30_000`) rather than shrinking the body. If `Response.on('data')` is not available in the installed supertest typings, use the `.buffer(true).parse(...)` pattern already used in `audit-export.e2e-spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A apps/api .gitignore
git commit -m "feat: add local development storage with signed, expiring links"
```

---

### Task 3: The Cloudflare R2 driver, settings, and the "check my setup" script

**Files:**
- Modify: `apps/api/package.json` + `package-lock.json` (two dependencies), `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`, `apps/api/src/storage/storage.module.ts`, `apps/api/.env.example`, `apps/api/package.json` scripts
- Create: `apps/api/src/storage/{r2.storage.ts,r2.storage.spec.ts,cors-check.ts,cors-check.spec.ts}`, `apps/api/src/cli/storage-check.ts`

**Interfaces:**
- Consumes: `StoragePort`, `StorageError`, `createStorage` (Task 2), constants.
- Produces:

```ts
createR2Client(config: { accountId; accessKeyId; secretAccessKey }): S3Client       // endpoint https://<account>.r2.cloudflarestorage.com, region 'auto', checksums WHEN_REQUIRED
class R2Storage implements StoragePort { constructor(client: S3Client, bucket: string) }
evaluateCors(response: { allowOrigin: string | null; allowMethods: string | null; exposeHeaders: string | null }, origin: string): string[]   // problems; empty = fine
env: STORAGE_DRIVER 'local' | 'r2'; R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (required when r2); production refuses 'local'
npm run storage:check -w @jbf/api
```

- [ ] **Step 1: Verify and install the two packages**

```bash
export NODE_EXTRA_CA_CERTS=/private/tmp/claude-501/-Users-jbfit-Documents-GitHub-plms-web/54da702a-c25d-4d71-afc1-e140ab238f7f/scratchpad/ca.pem
npm view @aws-sdk/client-s3 name version license
npm view @aws-sdk/s3-request-presigner name version license
npm install -w @jbf/api @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm audit --audit-level=high
```

Expected: both are the official `@aws-sdk` packages (Apache-2.0); install succeeds; audit exits 0 (dev-only moderate advisories are acceptable, high or critical must be reported). If the installed SDK does not accept `requestChecksumCalculation` / `responseChecksumValidation` (old version), report it; do not remove the options.

- [ ] **Step 2: Failing tests**

`apps/api/src/storage/cors-check.spec.ts`:

```ts
import { evaluateCors } from './cors-check';

const ORIGIN = 'https://lms.example.org';

describe('evaluateCors', () => {
  it('accepts a bucket that allows the origin, PUT and exposes ETag', () => {
    expect(evaluateCors({ allowOrigin: ORIGIN, allowMethods: 'GET, PUT, HEAD', exposeHeaders: 'ETag' }, ORIGIN)).toEqual([]);
  });

  it('accepts a wildcard origin and different header casing', () => {
    expect(evaluateCors({ allowOrigin: '*', allowMethods: 'put', exposeHeaders: 'x-other, etag' }, ORIGIN)).toEqual([]);
  });

  it('reports every problem in plain words', () => {
    const problems = evaluateCors({ allowOrigin: null, allowMethods: null, exposeHeaders: null }, ORIGIN);
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/allow the web address/i);
    expect(problems.join(' ')).toMatch(/PUT/);
    expect(problems.join(' ')).toMatch(/ETag/);
  });

  it('reports a different origin and a missing ETag separately', () => {
    const problems = evaluateCors({ allowOrigin: 'https://other.example', allowMethods: 'PUT', exposeHeaders: 'x-amz-request-id' }, ORIGIN);
    expect(problems).toHaveLength(2);
  });
});
```

`apps/api/src/storage/r2.storage.spec.ts`:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { createR2Client, R2Storage } from './r2.storage';

const KEY = 'videos/4c0d6f0e-5a49-4c0b-8f43-8a4a9d6a0f11';

function fake() {
  const send = jest.fn();
  const client = { send } as unknown as S3Client;
  return { send, storage: new R2Storage(client, 'jbf-media') };
}

const input = (call: number, send: jest.Mock) => (send.mock.calls[call]?.[0] as { constructor: { name: string }; input: Record<string, unknown> });

describe('R2Storage', () => {
  it('starts a multipart upload and returns its id', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({ UploadId: 'up-1' });
    expect(await storage.createMultipartUpload(KEY, 'video/mp4')).toBe('up-1');
    expect(input(0, send).constructor.name).toBe('CreateMultipartUploadCommand');
    expect(input(0, send).input).toEqual({ Bucket: 'jbf-media', Key: KEY, ContentType: 'video/mp4' });
  });

  it('fails clearly if the service does not return an upload id', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({});
    await expect(storage.createMultipartUpload(KEY, 'video/mp4')).rejects.toThrow(/upload id/i);
  });

  it('lists pieces as number, size and receipt', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({ Parts: [{ PartNumber: 2, Size: 7, ETag: '"b"' }, { PartNumber: 1, Size: 16, ETag: '"a"' }] });
    expect(await storage.listParts(KEY, 'up-1')).toEqual([
      { partNumber: 1, size: 16, etag: '"a"' },
      { partNumber: 2, size: 7, etag: '"b"' },
    ]);
    expect(input(0, send).input).toMatchObject({ Bucket: 'jbf-media', Key: KEY, UploadId: 'up-1' });
  });

  it('completes with the pieces in ascending order', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({});
    await storage.completeMultipartUpload(KEY, 'up-1', [{ partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' }]);
    expect(input(0, send).input).toMatchObject({
      UploadId: 'up-1',
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"a"' }, { PartNumber: 2, ETag: '"b"' }] },
    });
  });

  it.each([
    ['NoSuchUpload', 'no_such_upload'],
    ['InvalidPart', 'invalid_part'],
    ['InvalidPartOrder', 'invalid_part'],
    ['EntityTooSmall', 'part_too_small'],
  ])('maps the service error %s to %s', async (name, code) => {
    const { send, storage } = fake();
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name }));
    await expect(storage.completeMultipartUpload(KEY, 'up-1', [{ partNumber: 1, etag: '"a"' }])).rejects.toMatchObject({ code });
  });

  it('lets unexpected errors through unchanged', async () => {
    const { send, storage } = fake();
    send.mockRejectedValueOnce(new Error('network down'));
    await expect(storage.listParts(KEY, 'up-1')).rejects.toThrow('network down');
  });

  it('reads size and type with HEAD and answers null when the object is missing', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({ ContentLength: 42, ContentType: 'video/mp4' });
    expect(await storage.head(KEY)).toEqual({ size: 42, contentType: 'video/mp4' });
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFound' }));
    expect(await storage.head(KEY)).toBeNull();
  });

  it('reads a byte range', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]) } });
    expect(Array.from(await storage.readRange(KEY, 0, 7))).toEqual([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]);
    expect(input(0, send).input).toMatchObject({ Range: 'bytes=0-7' });
  });

  it('maps a missing object for a range read to not_found', async () => {
    const { send, storage } = fake();
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    await expect(storage.readRange(KEY, 0, 7)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deletes and aborts', async () => {
    const { send, storage } = fake();
    send.mockResolvedValue({});
    await storage.delete(KEY);
    await storage.abortMultipartUpload(KEY, 'up-1');
    expect(input(0, send).constructor.name).toBe('DeleteObjectCommand');
    expect(input(1, send).constructor.name).toBe('AbortMultipartUploadCommand');
  });
});

describe('R2Storage temporary links (signed offline, nothing is sent)', () => {
  const client = createR2Client({ accountId: 'acct123', accessKeyId: 'AKIA-TEST', secretAccessKey: 'secret-test-secret' });
  const storage = new R2Storage(client, 'jbf-media');

  it('signs a piece link for the right object, upload and piece with a one hour expiry', async () => {
    const url = new URL(await storage.presignUploadPart(KEY, 'up-1', 7, 3600));
    expect(url.hostname).toBe('jbf-media.acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/${KEY}`);
    expect(url.searchParams.get('partNumber')).toBe('7');
    expect(url.searchParams.get('uploadId')).toBe('up-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('signs a single upload link bound to its content type, and a read link', async () => {
    const put = new URL(await storage.presignPut(`covers/4c0d6f0e-5a49-4c0b-8f43-8a4a9d6a0f11`, 'image/png', 600));
    expect(put.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(put.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    const get = new URL(await storage.presignGet(KEY, 3600, { contentType: 'video/mp4' }));
    expect(get.searchParams.get('response-content-type')).toBe('video/mp4');
  });
});
```

In `apps/api/src/config/env.spec.ts` replace the Task 2 `STORAGE_DRIVER` default test and add:

```ts
  it('accepts the r2 driver only with all four Cloudflare settings', () => {
    const r2 = { ...base, STORAGE_DRIVER: 'r2' };
    expect(() => parseEnv(r2)).toThrow(/R2_ACCOUNT_ID/);
    const complete = { ...r2, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' };
    expect(parseEnv(complete).STORAGE_DRIVER).toBe('r2');
    expect(() => parseEnv({ ...complete, R2_BUCKET: '' })).toThrow(/R2_BUCKET/);
  });

  it('refuses the local storage driver in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x' })).toThrow(/STORAGE_DRIVER/);
  });
```

Run: `npm test -w @jbf/api -- cors-check r2.storage env.spec` → FAIL.

- [ ] **Step 3: Implement the driver, settings and factory**

`apps/api/src/storage/r2.storage.ts`:

```ts
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type ObjectInfo, type StoragePort, StorageError, type StoredPart } from './storage.port';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Newer SDK versions add checksum headers by default, which R2 has rejected for some requests. Only add them
    // where the protocol requires them. `npm run storage:check` proves this against the real service.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

const errorName = (error: unknown): string => (error as { name?: string } | null)?.name ?? '';

function translate(error: unknown): never {
  switch (errorName(error)) {
    case 'NoSuchUpload':
      throw new StorageError('no_such_upload', 'That upload does not exist.');
    case 'InvalidPart':
    case 'InvalidPartOrder':
      throw new StorageError('invalid_part', 'A piece is missing or does not match its receipt.');
    case 'EntityTooSmall':
      throw new StorageError('part_too_small', 'Every piece except the last must be at least 5 MiB.');
    case 'NoSuchKey':
    case 'NotFound':
      throw new StorageError('not_found', 'No such object.');
    default:
      throw error;
  }
}

export class R2Storage implements StoragePort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!result.UploadId) throw new Error('The storage service did not return an upload id');
    return result.UploadId;
  }

  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: expiresInSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    try {
      const result = await this.client.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
      return (result.Parts ?? [])
        .map((part) => ({ partNumber: part.PartNumber ?? 0, size: part.Size ?? 0, etag: part.ETag ?? '' }))
        .sort((a, b) => a.partNumber - b.partNumber);
    } catch (error) {
      return translate(error);
    }
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
        }),
      );
    } catch (error) {
      translate(error);
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    } catch (error) {
      translate(error);
    }
  }

  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn: expiresInSeconds,
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (['NotFound', 'NoSuchKey'].includes(errorName(error))) return null;
      throw error;
    }
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${endInclusive}` }));
      return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
    } catch (error) {
      return translate(error);
    }
  }

  presignGet(key: string, expiresInSeconds: number, options: { contentType: string }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

`apps/api/src/storage/cors-check.ts`:

```ts
export interface CorsResponse {
  allowOrigin: string | null;
  allowMethods: string | null;
  exposeHeaders: string | null;
}

const tokens = (value: string | null): string[] => (value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);

// Judges the CORS headers the bucket sent back for a browser upload from `origin`. Returns plain-words problems.
export function evaluateCors(response: CorsResponse, origin: string): string[] {
  const problems: string[] = [];
  if (response.allowOrigin !== '*' && response.allowOrigin !== origin) {
    problems.push(`The bucket's browser permissions (CORS) do not allow the web address ${origin} to upload.`);
  }
  if (!tokens(response.allowMethods).includes('put')) {
    problems.push('The bucket does not allow the PUT method from the browser.');
  }
  if (!tokens(response.exposeHeaders).includes('etag')) {
    problems.push('The bucket does not expose the ETag header, so the browser cannot read each piece\'s receipt.');
  }
  return problems;
}
```

`apps/api/src/config/env.ts`: change `STORAGE_DRIVER` to `z.enum(['local', 'r2']).default('local')`, add

```ts
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
```

and extend the `superRefine` (before its closing) with:

```ts
    if (env.STORAGE_DRIVER === 'r2') {
      for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
        if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required when STORAGE_DRIVER=r2` });
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'STORAGE_DRIVER=local is not allowed in production (it keeps files on the server disk with development links)',
      });
    }
```

(Note: an empty string such as `R2_BUCKET=''` fails the `.min(1)` of the optional field itself, which satisfies the test.)

`apps/api/src/storage/storage.module.ts`: replace `createStorage` with

```ts
function requireSetting(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=r2`);
  return value;
}

export function createStorage(env: Env): StoragePort {
  if (env.STORAGE_DRIVER === 'r2') {
    return new R2Storage(
      createR2Client({
        accountId: requireSetting('R2_ACCOUNT_ID', env.R2_ACCOUNT_ID),
        accessKeyId: requireSetting('R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID),
        secretAccessKey: requireSetting('R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY),
      }),
      requireSetting('R2_BUCKET', env.R2_BUCKET),
    );
  }
  // A missing development secret means links stop working when the API restarts, which is fine for development.
  return new LocalStorage({
    rootDir: resolve(env.STORAGE_LOCAL_DIR),
    signingSecret: env.STORAGE_SIGNING_SECRET ?? randomBytes(32).toString('hex'),
  });
}
```

and add `import { R2Storage, createR2Client } from './r2.storage';`. `apps/api/.env.example`: add after the storage lines:

```
# For Cloudflare R2 (see docs/storage.md): STORAGE_DRIVER=r2 and
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=
```

- [ ] **Step 4: The check script**

`apps/api/src/cli/storage-check.ts`:

```ts
import '../config/load-env';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '../config/env';
import { createStorage } from '../storage/storage.module';
import { evaluateCors } from '../storage/cors-check';
import { MIN_PART_SIZE } from '../storage/storage.constants';

interface Step {
  name: string;
  run: () => Promise<string[] | void>;
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  if (env.STORAGE_DRIVER !== 'r2') {
    console.error('Set STORAGE_DRIVER=r2 and the four R2_* settings in apps/api/.env first (see docs/storage.md).');
    process.exit(1);
  }
  const storage = createStorage(env);
  const small = `covers/${randomUUID()}`;
  const big = `videos/${randomUUID()}`;
  const text = new TextEncoder().encode('jbf storage check');

  const steps: Step[] = [
    {
      name: 'Upload a small file with a temporary link',
      run: async () => {
        const url = await storage.presignPut(small, 'image/png', 300);
        const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: text });
        if (!res.ok) throw new Error(`The service answered ${res.status}`);
      },
    },
    {
      name: 'Read it back with a temporary link',
      run: async () => {
        const res = await fetch(await storage.presignGet(small, 300, { contentType: 'image/png' }));
        if (!res.ok || new TextDecoder().decode(await res.arrayBuffer()) !== 'jbf storage check') throw new Error('The file did not match');
      },
    },
    {
      name: 'Check its size and first bytes',
      run: async () => {
        const info = await storage.head(small);
        if (!info || info.size !== text.length) throw new Error('The size did not match');
        if (new TextDecoder().decode(await storage.readRange(small, 0, 2)) !== 'jbf') throw new Error('The first bytes did not match');
      },
    },
    {
      name: 'Upload in two pieces and finish',
      run: async () => {
        const uploadId = await storage.createMultipartUpload(big, 'video/mp4');
        const bodies = [new Uint8Array(MIN_PART_SIZE).fill(7), new TextEncoder().encode('last piece')];
        const parts: { partNumber: number; etag: string }[] = [];
        for (const [index, body] of bodies.entries()) {
          const url = await storage.presignUploadPart(big, uploadId, index + 1, 300);
          const res = await fetch(url, { method: 'PUT', body });
          const etag = res.headers.get('etag');
          if (!res.ok || !etag) throw new Error(`Piece ${index + 1}: the service answered ${res.status} and ${etag ? 'a' : 'no'} receipt`);
          parts.push({ partNumber: index + 1, etag });
        }
        const listed = await storage.listParts(big, uploadId);
        if (listed.length !== 2) throw new Error('The stored pieces were not listed');
        await storage.completeMultipartUpload(big, uploadId, parts);
        const info = await storage.head(big);
        if (!info || info.size !== MIN_PART_SIZE + 10) throw new Error('The finished file has the wrong size');
      },
    },
    {
      name: `Browser permissions (CORS) for ${env.WEB_ORIGIN}`,
      run: async () => {
        const key = `videos/${randomUUID()}`;
        const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
        try {
          const url = await storage.presignUploadPart(key, uploadId, 1, 300);
          const preflight = await fetch(url, {
            method: 'OPTIONS',
            headers: { Origin: env.WEB_ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
          });
          const actual = await fetch(url, { method: 'PUT', headers: { Origin: env.WEB_ORIGIN }, body: text });
          return evaluateCors(
            {
              allowOrigin: actual.headers.get('access-control-allow-origin') ?? preflight.headers.get('access-control-allow-origin'),
              allowMethods: preflight.headers.get('access-control-allow-methods'),
              exposeHeaders: actual.headers.get('access-control-expose-headers'),
            },
            env.WEB_ORIGIN,
          );
        } finally {
          await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
        }
      },
    },
  ];

  let failed = false;
  for (const step of steps) {
    try {
      const problems = (await step.run()) ?? [];
      if (problems.length > 0) {
        failed = true;
        console.log(`✗ ${step.name}`);
        problems.forEach((problem) => console.log(`    ${problem}`));
      } else {
        console.log(`✓ ${step.name}`);
      }
    } catch (error) {
      failed = true;
      console.log(`✗ ${step.name}\n    ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await storage.delete(small).catch(() => undefined);
  await storage.delete(big).catch(() => undefined);
  console.log(failed ? '\nSome checks failed. See docs/storage.md.' : '\nStorage is ready.');
  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`apps/api/package.json` scripts: add `"storage:check": "ts-node src/cli/storage-check.ts",`.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: all PASS (new: cors-check 4, r2.storage 16, env 3). Run `npm run storage:check -w @jbf/api` once with the default `.env`: it must exit 1 with the "Set STORAGE_DRIVER=r2…" message (it must not need the network). Do NOT try to run it against Cloudflare; no credentials exist yet.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api package-lock.json
git commit -m "feat: add the Cloudflare R2 storage driver and the setup check script"
```

---

### Task 4: Database tables and the twelve new audit actions

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/audit/audit.actions.ts`, `apps/api/src/audit/audit-presentation.ts`
- Create: `apps/api/drizzle/0003_media_tables.sql` (+ `meta/0003_snapshot.json`, `meta/_journal.json` updated; all generated), `apps/api/src/audit/audit-presentation-media.spec.ts`
- Test: `apps/api/test/media-schema.e2e-spec.ts`

**Interfaces:**
- Produces (schema): `filePurpose`, `fileStatus`, `mediaCategory`, `mediaItemStatus` enums; tables `files`, `mediaFolders`, `mediaItems`; types `FileRow`, `MediaFolder`, `MediaItem`.
- Produces (audit): twelve new `AUDIT_ACTIONS` exactly as listed in step 3, each with a `SPECS` entry.

- [ ] **Step 1: Failing tests**

`apps/api/src/audit/audit-presentation-media.spec.ts`:

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
    ['content.video.added', { targetLabel: 'Fire exits' }, 'Video added', 'change', 'content', 'Anita added the video Fire exits'],
    ['content.video.edited', { targetLabel: 'Fire exits' }, 'Video edited', 'change', 'content', 'Anita edited the video Fire exits'],
    [
      'content.video.reordered',
      { targetLabel: 'Safety' },
      'Videos reordered',
      'neutral',
      'content',
      'Anita changed the order of the videos in Safety',
    ],
    ['content.video.cover_set', { targetLabel: 'Fire exits' }, 'Cover set', 'change', 'content', 'Anita set the cover image of Fire exits'],
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
    ['not_mp4', 'the file is not a valid MP4'],
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

  it('files the new actions under the right categories', () => {
    const media = AUDIT_ACTIONS.filter((action) => /^(content\.(folder|video)|file\.upload|playback\.)/.test(action));
    expect(media).toHaveLength(12);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played']);
  });
});
```

`apps/api/test/media-schema.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '../src/db/db.module';
import { isUniqueViolation } from '../src/db/errors';
import { files, mediaFolders, mediaItems } from '../src/db/schema';
import { createTestApp } from './helpers/app';
import { createUser } from './helpers/users';

const isRejectedAsDuplicate = (promise: PromiseLike<unknown>): Promise<boolean> => Promise.resolve(promise).then(() => false, isUniqueViolation);

describe('media tables', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const folder = (createdBy: string, name: string, category: 'video' | 'movie' = 'video') =>
    db.insert(mediaFolders).values({ category, name, position: 0, createdBy }).returning();

  const videoFile = async (uploadedBy: string, sizeBytes = 1000) => {
    const [file] = await db
      .insert(files)
      .values({ purpose: 'video', storageKey: `videos/${randomUUID()}`, originalName: 'a.mp4', contentType: 'video/mp4', sizeBytes, uploadedBy })
      .returning();
    return file;
  };

  it('keeps folder names unique per category, ignoring case', async () => {
    const user = await createUser(db);
    const name = `Safety ${randomUUID()}`;
    await folder(user.id, name);
    expect(await isRejectedAsDuplicate(folder(user.id, name.toUpperCase()))).toBe(true);
    expect(await isRejectedAsDuplicate(folder(user.id, name.toLowerCase()))).toBe(true);
    await expect(folder(user.id, name, 'movie')).resolves.toHaveLength(1);
  });

  it('stores sizes above 2^31 without overflow', async () => {
    const user = await createUser(db);
    const file = await videoFile(user.id, 2_147_483_648);
    const [stored] = await db.select().from(files).where(eq(files.id, file.id));
    expect(stored.sizeBytes).toBe(2_147_483_648);
    expect(stored.status).toBe('pending');
  });

  it('refuses a second item for the same video file and a duplicate storage key', async () => {
    const user = await createUser(db);
    const [parent] = await folder(user.id, `Folder ${randomUUID()}`);
    const file = await videoFile(user.id);
    const item = { folderId: parent.id, title: 'T', position: 0, videoFileId: file.id, status: 'uploading' as const, createdBy: user.id };
    await db.insert(mediaItems).values(item);
    expect(await isRejectedAsDuplicate(db.insert(mediaItems).values(item))).toBe(true);
    const sameKey = db
      .insert(files)
      .values({ purpose: 'video', storageKey: file.storageKey, originalName: 'b.mp4', contentType: 'video/mp4', sizeBytes: 1, uploadedBy: user.id });
    expect(await isRejectedAsDuplicate(sameKey)).toBe(true);
  });
});
```

Run: `npm test -w @jbf/api -- audit-presentation-media media-schema` → FAIL.

- [ ] **Step 2: Schema**

In `apps/api/src/db/schema.ts` add `bigint` to the pg-core import and, after the `auditLog` table, append:

```ts
export const filePurpose = pgEnum('file_purpose', ['video', 'cover']);
export const fileStatus = pgEnum('file_status', ['pending', 'ready']);
export const mediaCategory = pgEnum('media_category', ['video', 'movie', 'podcast', 'song']);
export const mediaItemStatus = pgEnum('media_item_status', ['uploading', 'ready']);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: filePurpose('purpose').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: fileStatus('status').notNull().default('pending'),
    uploadId: text('upload_id'),
    partSize: integer('part_size'),
    partCount: integer('part_count'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
  },
  (table) => [uniqueIndex('files_storage_key_unique').on(table.storageKey), index('files_pending_idx').on(table.status, table.createdAt)],
);

export const mediaFolders = pgTable(
  'media_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: mediaCategory('category').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('media_folders_name_unique').on(table.category, sql`lower(${table.name})`)],
);

export const mediaItems = pgTable(
  'media_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => mediaFolders.id),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    videoFileId: uuid('video_file_id')
      .notNull()
      .references(() => files.id),
    coverFileId: uuid('cover_file_id').references(() => files.id),
    durationSeconds: integer('duration_seconds'),
    status: mediaItemStatus('status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('media_items_video_file_unique').on(table.videoFileId),
    index('media_items_folder_idx').on(table.folderId, table.position),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type MediaFolder = typeof mediaFolders.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
```

Generate the migration (no database needed) and inspect it:

```bash
cd apps/api && npx drizzle-kit generate --name media_tables && cat drizzle/0003_media_tables.sql
```

Expected: four `CREATE TYPE`, three `CREATE TABLE`, foreign keys, `CREATE UNIQUE INDEX "media_folders_name_unique" ON "media_folders" USING btree ("category",lower("name"))`, the two other unique indexes and two plain indexes. If the generated file name differs from `0003_media_tables.sql`, keep the generated name and use it in the commit. Do not hand-edit the SQL.

- [ ] **Step 3: Audit actions and sentences**

`apps/api/src/audit/audit.actions.ts`: add after `'audit.exported'`:

```ts
  'content.folder.created',
  'content.folder.renamed',
  'content.folder.reordered',
  'content.video.added',
  'content.video.edited',
  'content.video.reordered',
  'content.video.cover_set',
  'file.upload_started',
  'file.upload_completed',
  'file.upload_failed',
  'file.upload_cancelled',
  'playback.played',
```

`apps/api/src/audit/audit-presentation.ts`: add above `SPECS`:

```ts
const UPLOAD_FAILURE_REASONS: Record<string, string> = {
  size_mismatch: 'the file size did not match',
  not_mp4: 'the file is not a valid MP4',
  bad_image: 'the cover image is not valid',
  expired: 'it was not finished within 24 hours',
};

function uploadFailed({ target, entry }: Context): string {
  const code = entry.metadata?.reason;
  const reason = typeof code === 'string' && Object.hasOwn(UPLOAD_FAILURE_REASONS, code) ? UPLOAD_FAILURE_REASONS[code] : undefined;
  return reason ? `The upload of ${target} failed (${reason})` : `The upload of ${target} failed`;
}

function folderRenamed({ actor, target, entry }: Context): string {
  const { before, after } = entry.changes?.name ?? {};
  if (typeof before !== 'string' || typeof after !== 'string') return `${actor} renamed the folder ${target}`;
  return `${actor} renamed the folder from ${before} to ${after}`;
}
```

and these entries inside `SPECS` (after `'audit.exported'`):

```ts
  'content.folder.created': {
    label: 'Folder created',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} created the folder ${target}`,
  },
  'content.folder.renamed': { label: 'Folder renamed', tone: 'change', summary: folderRenamed },
  'content.folder.reordered': {
    label: 'Folders reordered',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} changed the order of the video folders`,
  },
  'content.video.added': {
    label: 'Video added',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} added the video ${target}`,
  },
  'content.video.edited': {
    label: 'Video edited',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} edited the video ${target}`,
  },
  'content.video.reordered': {
    label: 'Videos reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the videos in ${target}`,
  },
  'content.video.cover_set': {
    label: 'Cover set',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} set the cover image of ${target}`,
  },
  'file.upload_started': {
    label: 'Upload started',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} started uploading ${target}`,
  },
  'file.upload_completed': {
    label: 'Upload finished',
    tone: 'success',
    summary: ({ actor, target }) => `${actor} finished uploading ${target}`,
  },
  'file.upload_failed': { label: 'Upload failed', tone: 'warning', summary: uploadFailed },
  'file.upload_cancelled': {
    label: 'Upload cancelled',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} cancelled the upload of ${target}`,
  },
  'playback.played': {
    label: 'Played',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} played ${target}`,
  },
```

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS. The audit page's category and action filters come from the API presentation, so no other file changes. If an existing audit test enumerates actions and fails because of the new ones, fix the test's expectation (it must not be weakened to skip the new actions).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat: add the media tables and the audit actions for folders, videos and uploads"
```

---

### Task 5: Media module and the folder endpoints

**Files:**
- Create: `apps/api/src/media/{media.module.ts,media.schemas.ts,actor.ts,folders.service.ts,media.controller.ts}`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/helpers/media.ts` (first part), `apps/api/test/media-folders.e2e-spec.ts`

**Interfaces:**
- Consumes: `mediaFolders`, `mediaItems` (Task 4), `AuditService`, `ZodPipe`, `CurrentUser`, `isUniqueViolation`.
- Produces:

```ts
// actor.ts
actorOf(actor: AuthUser): { id: string; role: Role; label: string }
// media.schemas.ts
folderBodySchema, orderSchema ({ ids: uuid[] }), titleSchema, descriptionSchema, updateItemSchema, startUploadSchema, partUrlsSchema, completeUploadSchema, coverStartSchema  (all defined here, used by later tasks)
// folders.service.ts
interface FolderView { id: string; name: string; position: number; itemCount: number }
class FoldersService { list(executor?: DbExecutor): Promise<FolderView[]>; create(actor, name): Promise<FolderView>; rename(actor, id, name): Promise<FolderView>; reorder(actor, ids: string[]): Promise<FolderView[]> }
// HTTP: GET/POST /api/media/videos/folders, PATCH /api/media/folders/:id, PUT /api/media/videos/folders/order
// test/helpers/media.ts: signIn(app, db, role?) -> { user, session }; createFolderViaApi(app, session, name?) -> FolderView; seedFolder(db, createdBy, name?) -> MediaFolder
```

- [ ] **Step 1: Failing tests and helpers**

`apps/api/test/helpers/media.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Database } from '../../src/db/db.module';
import { type MediaFolder, mediaFolders, type Role, type User } from '../../src/db/schema';
import { bearer, loginMobile, type Session } from './auth';
import { createUser } from './users';

export async function signIn(app: INestApplication, db: Database, role: Role = 'staff'): Promise<{ user: User; session: Session }> {
  const user = await createUser(db, { role });
  return { user, session: await loginMobile(app, user.email) };
}

export const uniqueName = (prefix = 'Folder'): string => `${prefix} ${randomUUID().slice(0, 8)}`;

export async function createFolderViaApi(
  app: INestApplication,
  session: Session,
  name = uniqueName(),
): Promise<{ id: string; name: string; position: number; itemCount: number }> {
  const res = await request(app.getHttpServer()).post('/api/media/videos/folders').set(...bearer(session)).send({ name }).expect(201);
  return res.body;
}

export async function seedFolder(db: Database, createdBy: string, name = uniqueName()): Promise<MediaFolder> {
  const [folder] = await db.insert(mediaFolders).values({ category: 'video', name, position: 0, createdBy }).returning();
  return folder;
}
```

`apps/api/test/media-folders.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { createFolderViaApi, signIn, uniqueName } from './helpers/media';

describe('media folders', () => {
  let app: NestExpressApplication;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  it('needs a signed-in person, and lets both Staff and Admin in', async () => {
    await http().get('/api/media/videos/folders').expect(401);
    await http().post('/api/media/videos/folders').send({ name: 'x' }).expect(401);
    for (const role of ['staff', 'admin'] as const) {
      const { session } = await signIn(app, db, role);
      await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200);
    }
  });

  it('creates a folder at the end, lists it with zero videos, and audits it', async () => {
    const { user, session } = await signIn(app, db);
    const first = await createFolderViaApi(app, session);
    const second = await createFolderViaApi(app, session);
    expect(second.position).toBeGreaterThan(first.position);
    expect(first).toEqual({ id: expect.any(String), name: expect.any(String), position: expect.any(Number), itemCount: 0 });
    const list = (await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body;
    const ids = list.map((folder: { id: string }) => folder.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    const [entry] = await auditFor('content.folder.created', first.id);
    expect(entry).toMatchObject({ actorId: user.id, targetType: 'folder', targetLabel: first.name });
  });

  it('trims the name, and rejects an empty, blank, over-long or non-text name', async () => {
    const { session } = await signIn(app, db);
    const trimmed = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: `  ${uniqueName()}  ` }).expect(201);
    expect(trimmed.body.name).toBe(trimmed.body.name.trim());
    for (const name of ['', '   ', 'x'.repeat(101), 5, null]) {
      const res = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name }).expect(400);
      expect(res.body.fieldErrors.name).toBeDefined();
    }
    await http().post('/api/media/videos/folders').set(...bearer(session)).send({}).expect(400);
    await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: 'x'.repeat(100) }).expect(201);
  });

  it('stores hostile names as inert text', async () => {
    const { session } = await signIn(app, db);
    const name = `<img src=x onerror=alert(1)> ${uniqueName()}`;
    const created = await createFolderViaApi(app, session, name);
    expect(created.name).toBe(name);
  });

  it('refuses a duplicate name ignoring case with 409', async () => {
    const { session } = await signIn(app, db);
    const name = uniqueName();
    await createFolderViaApi(app, session, name);
    const res = await http().post('/api/media/videos/folders').set(...bearer(session)).send({ name: name.toUpperCase() }).expect(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('renames, records before and after, and does nothing when the name is unchanged', async () => {
    const { session } = await signIn(app, db);
    const folder = await createFolderViaApi(app, session);
    const newName = uniqueName('Renamed');
    const renamed = await http().patch(`/api/media/folders/${folder.id}`).set(...bearer(session)).send({ name: newName }).expect(200);
    expect(renamed.body).toMatchObject({ id: folder.id, name: newName });
    const [entry] = await auditFor('content.folder.renamed', folder.id);
    expect(entry.changes).toEqual({ name: { before: folder.name, after: newName } });
    await http().patch(`/api/media/folders/${folder.id}`).set(...bearer(session)).send({ name: newName }).expect(200);
    expect(await auditFor('content.folder.renamed', folder.id)).toHaveLength(1);
  });

  it('allows changing only the capitals of a name, and refuses another folder\'s name', async () => {
    const { session } = await signIn(app, db);
    const a = await createFolderViaApi(app, session, uniqueName('alpha'));
    const b = await createFolderViaApi(app, session);
    await http().patch(`/api/media/folders/${a.id}`).set(...bearer(session)).send({ name: a.name.toUpperCase() }).expect(200);
    await http().patch(`/api/media/folders/${a.id}`).set(...bearer(session)).send({ name: b.name.toLowerCase() }).expect(409);
  });

  it('answers 404 for an unknown folder and 400 for a malformed id', async () => {
    const { session } = await signIn(app, db);
    await http().patch('/api/media/folders/00000000-0000-4000-8000-000000000000').set(...bearer(session)).send({ name: 'x' }).expect(404);
    await http().patch('/api/media/folders/nope').set(...bearer(session)).send({ name: 'x' }).expect(400);
  });

  it('reorders when given exactly the current folders, and audits only a real change', async () => {
    const { session } = await signIn(app, db);
    await createFolderViaApi(app, session);
    const current = (await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string }[];
    const reversed = current.map((folder) => folder.id).reverse();
    const res = await http().put('/api/media/videos/folders/order').set(...bearer(session)).send({ ids: reversed }).expect(200);
    expect(res.body.map((folder: { id: string }) => folder.id)).toEqual(reversed);
    const after = (await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string }[];
    expect(after.map((folder) => folder.id)).toEqual(reversed);

    const before = await db.select().from(auditLog).where(eq(auditLog.action, 'content.folder.reordered'));
    await http().put('/api/media/videos/folders/order').set(...bearer(session)).send({ ids: reversed }).expect(200);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'content.folder.reordered'))).toHaveLength(before.length);
  });

  it('refuses an order that is missing, adds, repeats or invents a folder', async () => {
    const { session } = await signIn(app, db);
    await createFolderViaApi(app, session);
    await createFolderViaApi(app, session);
    const ids = ((await http().get('/api/media/videos/folders').set(...bearer(session)).expect(200)).body as { id: string }[]).map((f) => f.id);
    const put = (body: unknown) => http().put('/api/media/videos/folders/order').set(...bearer(session)).send(body);
    await put({ ids: ids.slice(1) }).expect(409);
    await put({ ids: [...ids, '00000000-0000-4000-8000-000000000000'] }).expect(409);
    await put({ ids: [ids[0], ...ids] }).expect(409);
    await put({ ids: ['00000000-0000-4000-8000-000000000000', ...ids.slice(1)] }).expect(409);
    await put({ ids: ['not-a-uuid'] }).expect(400);
    await put({ ids: 'x' }).expect(400);
    await put({}).expect(400);
  });
});
```

Run: `npm test -w @jbf/api -- media-folders` → FAIL (routes missing).

- [ ] **Step 2: Schemas, actor helper and the folders service**

`apps/api/src/media/actor.ts`:

```ts
import type { AuthUser } from '../auth/auth.types';

export const actorOf = (actor: AuthUser) => ({ id: actor.id, role: actor.role, label: actor.email });
```

`apps/api/src/media/media.schemas.ts` (all schemas for the milestone live here so later tasks only import them):

```ts
import { z } from 'zod';
import {
  COVER_CONTENT_TYPES,
  MAX_COVER_BYTES,
  MAX_PART_URLS_PER_REQUEST,
  MAX_VIDEO_BYTES,
  partCountFor,
  VIDEO_CONTENT_TYPE,
} from '../storage/storage.constants';

export const folderNameSchema = z
  .string('Enter a folder name.')
  .trim()
  .min(1, 'Enter a folder name.')
  .max(100, 'Folder name must be 100 characters or fewer.');

export const folderBodySchema = z.object({ name: folderNameSchema });

export const orderSchema = z.object({ ids: z.array(z.uuid()).max(2000) });

export const titleSchema = z.string('Enter a title.').trim().min(1, 'Enter a title.').max(200, 'Title must be 200 characters or fewer.');

// An empty description means "no description".
export const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Description must be 2,000 characters or fewer.')
  .transform((value) => (value === '' ? null : value));

export const updateItemSchema = z
  .object({ title: titleSchema.optional(), description: descriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

const MAX_PARTS = partCountFor(MAX_VIDEO_BYTES);

export const startUploadSchema = z.object({
  folderId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema.nullish(),
  fileName: z.string().min(1, 'The file needs a name.').max(1000),
  contentType: z
    .string()
    .refine((value) => value === VIDEO_CONTENT_TYPE, 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).'),
  sizeBytes: z
    .number('Choose a file.')
    .int('Choose a file.')
    .min(1, 'That file is empty.')
    .max(MAX_VIDEO_BYTES, 'Videos can be at most 2 GB.'),
  durationSeconds: z.number().int().min(0).max(1_000_000).nullish(),
});

export const partUrlsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(MAX_PART_URLS_PER_REQUEST),
});

export const completeUploadSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(MAX_PARTS), etag: z.string().min(1).max(200) })).min(1).max(MAX_PARTS),
});

export const coverStartSchema = z.object({
  contentType: z.enum(COVER_CONTENT_TYPES, 'Covers must be JPEG, PNG or WebP images.'),
  sizeBytes: z.number().int().min(1, 'That file is empty.').max(MAX_COVER_BYTES, 'Covers can be at most 10 MB.'),
});

export const ORDER_CHANGED_MESSAGE = 'The list changed while you were editing it. Reload and try again.';

export type StartUploadInput = z.infer<typeof startUploadSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CoverStartInput = z.infer<typeof coverStartSchema>;
```

`apps/api/src/media/folders.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { mediaFolders, mediaItems } from '../db/schema';
import { actorOf } from './actor';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';

const CATEGORY = 'video' as const;
const NAME_TAKEN = 'A folder with that name already exists.';

export interface FolderView {
  id: string;
  name: string;
  position: number;
  itemCount: number;
}

@Injectable()
export class FoldersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(executor: DbExecutor = this.db): Promise<FolderView[]> {
    return executor
      .select({
        id: mediaFolders.id,
        name: mediaFolders.name,
        position: mediaFolders.position,
        itemCount: sql<number>`count(${mediaItems.id}) filter (where ${mediaItems.status} = 'ready')`.mapWith(Number),
      })
      .from(mediaFolders)
      .leftJoin(mediaItems, eq(mediaItems.folderId, mediaFolders.id))
      .where(eq(mediaFolders.category, CATEGORY))
      .groupBy(mediaFolders.id)
      .orderBy(asc(mediaFolders.position), asc(mediaFolders.createdAt), asc(mediaFolders.id));
  }

  create(actor: AuthUser, name: string): Promise<FolderView> {
    return this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mediaFolders.position}), -1) + 1`.mapWith(Number) })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, CATEGORY));
      let folder;
      try {
        [folder] = await tx.insert(mediaFolders).values({ category: CATEGORY, name, position: next, createdBy: actor.id }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
        throw error;
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.folder.created',
        target: { type: 'folder', id: folder.id, label: folder.name },
      });
      return { id: folder.id, name: folder.name, position: folder.position, itemCount: 0 };
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
        });
      }
      const view = (await this.list(tx)).find((candidate) => candidate.id === id);
      if (!view) throw new NotFoundException('Folder not found.');
      return view;
    });
  }

  reorder(actor: AuthUser, ids: string[]): Promise<FolderView[]> {
    return this.db.transaction(async (tx) => {
      // Locked in id order so two people reordering at once cannot deadlock.
      const locked = await tx
        .select({ id: mediaFolders.id, position: mediaFolders.position, createdAt: mediaFolders.createdAt })
        .from(mediaFolders)
        .where(eq(mediaFolders.category, CATEGORY))
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
          target: { type: 'category', id: CATEGORY, label: 'Video folders' },
        });
      }
      return this.list(tx);
    });
  }
}
```

(Reading `list(tx)` inside the transaction after the updates sees the new positions.)

- [ ] **Step 3: Controller, module and wiring**

`apps/api/src/media/media.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type FolderView, FoldersService } from './folders.service';
import { folderBodySchema, orderSchema } from './media.schemas';

// Every route needs a signed-in person (Admin or Staff); there is no @Roles because both may do everything here.
@Controller('media')
export class MediaController {
  constructor(private readonly folders: FoldersService) {}

  @Get('videos/folders')
  listFolders(): Promise<FolderView[]> {
    return this.folders.list();
  }

  @Post('videos/folders')
  createFolder(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(folderBodySchema)) body: z.infer<typeof folderBodySchema>): Promise<FolderView> {
    return this.folders.create(actor, body.name);
  }

  @Put('videos/folders/order')
  reorderFolders(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>): Promise<FolderView[]> {
    return this.folders.reorder(actor, body.ids);
  }

  @Patch('folders/:id')
  renameFolder(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(folderBodySchema)) body: z.infer<typeof folderBodySchema>,
  ): Promise<FolderView> {
    return this.folders.rename(actor, id, body.name);
  }
}
```


`apps/api/src/media/media.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FoldersService } from './folders.service';
import { MediaController } from './media.controller';

@Module({
  imports: [AuditModule],
  controllers: [MediaController],
  providers: [FoldersService],
})
export class MediaModule {}
```

`apps/api/src/app.module.ts`: import `MediaModule` from `./media/media.module` and add it to `imports` after `UsersModule`.

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS (media-folders: 9 tests). If `.for('update')` cannot be combined with `orderBy` in the installed drizzle version, call `.for('update')` last as written; do not remove the lock.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat: add the media module with folder create, rename, list and reorder"
```

---

### Task 6: Videos in a folder: list, edit, reorder

**Files:**
- Create: `apps/api/src/media/items.service.ts`
- Modify: `apps/api/src/media/media.controller.ts`, `apps/api/src/media/media.module.ts`, `apps/api/test/helpers/media.ts`
- Test: `apps/api/test/media-items.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 5 (schemas, `actorOf`, `FoldersService`), `STORAGE`, `LINK_TTL_SECONDS`.
- Produces:

```ts
interface ItemView { id; folderId; title; description: string | null; durationSeconds: number | null; sizeBytes: number; status: 'uploading' | 'ready'; coverUrl: string | null;
  createdBy: { id: string; name: string }; createdAt: Date; position: number }
class ItemsService {
  list(actor, folderId): Promise<ItemView[]>
  view(itemId, actor): Promise<ItemView>                        // 404 if missing or invisible
  requireVisible(executor, itemId, actor): Promise<MediaItem>   // 404 if missing or another person's uploading item
  update(actor, id, input: UpdateItemInput): Promise<ItemView>
  reorder(actor, folderId, ids): Promise<ItemView[]>
}
// HTTP: GET /api/media/folders/:id/items, PATCH /api/media/items/:id, PUT /api/media/folders/:id/items/order
// test helper: seedItem(db, options) -> { itemId, fileId, storageKey, coverFileId? }; pngBytes(), mp4Bytes(size), jpegBytes(), webpBytes()
```

- [ ] **Step 1: Test helpers and failing tests**

Append to `apps/api/test/helpers/media.ts` (adding the imports it needs: `files`, `mediaItems` from the schema, `InMemoryStorage` from `../support/in-memory-storage`):

```ts
const bytes = (size: number, start: number[]): Uint8Array => {
  const out = new Uint8Array(Math.max(size, start.length)).fill(7);
  out.set(start);
  return out;
};

// The first bytes the server checks for, followed by filler.
export const mp4Bytes = (size = 64): Uint8Array => bytes(size, [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
export const jpegBytes = (size = 64): Uint8Array => bytes(size, [0xff, 0xd8, 0xff, 0xe0]);
export const pngBytes = (size = 64): Uint8Array => bytes(size, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const webpBytes = (size = 64): Uint8Array => bytes(size, [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

export interface SeedItemOptions {
  folderId: string;
  createdBy: string;
  title?: string;
  description?: string | null;
  status?: 'uploading' | 'ready';
  sizeBytes?: number;
  position?: number;
  durationSeconds?: number | null;
  storage?: InMemoryStorage; // when given, the video and cover bytes are put into it
  withCover?: boolean;
}

export async function seedItem(db: Database, options: SeedItemOptions) {
  const status = options.status ?? 'ready';
  const storageKey = `videos/${randomUUID()}`;
  const bytesToStore = mp4Bytes(options.sizeBytes ?? 64);
  const [video] = await db
    .insert(files)
    .values({
      purpose: 'video',
      storageKey,
      originalName: 'seed.mp4',
      contentType: 'video/mp4',
      sizeBytes: options.sizeBytes ?? 64,
      status: status === 'ready' ? 'ready' : 'pending',
      uploadId: status === 'ready' ? null : randomUUID(),
      partSize: status === 'ready' ? null : 16_777_216,
      partCount: status === 'ready' ? null : 1,
      uploadedBy: options.createdBy,
      completedAt: status === 'ready' ? new Date() : null,
    })
    .returning();
  if (status === 'ready') options.storage?.seed(storageKey, bytesToStore, 'video/mp4');
  let coverFileId: string | null = null;
  if (options.withCover) {
    const coverKey = `covers/${randomUUID()}`;
    const [cover] = await db
      .insert(files)
      .values({ purpose: 'cover', storageKey: coverKey, originalName: 'cover', contentType: 'image/png', sizeBytes: 64, status: 'ready', uploadedBy: options.createdBy, completedAt: new Date() })
      .returning();
    options.storage?.seed(coverKey, pngBytes(), 'image/png');
    coverFileId = cover.id;
  }
  const [item] = await db
    .insert(mediaItems)
    .values({
      folderId: options.folderId,
      title: options.title ?? `Video ${randomUUID().slice(0, 8)}`,
      description: options.description ?? null,
      position: options.position ?? 0,
      videoFileId: video.id,
      coverFileId,
      durationSeconds: options.durationSeconds ?? null,
      status,
      createdBy: options.createdBy,
    })
    .returning();
  return { itemId: item.id, fileId: video.id, storageKey, coverFileId };
}
```

`apps/api/test/media-items.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import type { InMemoryStorage } from './support/in-memory-storage';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedFolder, seedItem, signIn } from './helpers/media';

describe('videos in a folder', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    return { owner, other, admin, folder };
  }

  it('needs a signed-in person', async () => {
    const { folder } = await setup();
    await http().get(`/api/media/folders/${folder.id}/items`).expect(401);
    await http().patch('/api/media/items/00000000-0000-4000-8000-000000000000').send({ title: 'x' }).expect(401);
  });

  it('lists videos in order with size, uploader and a cover link, and never exposes storage keys', async () => {
    const { owner, folder } = await setup();
    const second = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Second', position: 1, sizeBytes: 2048, storage });
    const first = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'First', position: 0, withCover: true, durationSeconds: 90, description: 'Hello', storage });
    const res = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(res.body.map((item: { id: string }) => item.id)).toEqual([first.itemId, second.itemId]);
    expect(res.body[0]).toEqual({
      id: first.itemId,
      folderId: folder.id,
      title: 'First',
      description: 'Hello',
      durationSeconds: 90,
      sizeBytes: 64,
      status: 'ready',
      coverUrl: expect.stringMatching(/^memory:\/\/get\//),
      createdBy: { id: owner.user.id, name: 'Test User' },
      createdAt: expect.any(String),
      position: 0,
    });
    expect(res.body[1].coverUrl).toBeNull();
    expect(res.body[1].sizeBytes).toBe(2048);
    expect(JSON.stringify(res.body)).not.toMatch(/videos\/|covers\/|storageKey/);
  });

  it('hides other people\'s uploading videos, including from Admins, but shows your own', async () => {
    const { owner, other, admin, folder } = await setup();
    const ready = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Ready' });
    const uploading = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Mine', status: 'uploading' });
    const idsFor = async (who: { session: Parameters<typeof bearer>[0] }) =>
      ((await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(who.session)).expect(200)).body as { id: string }[]).map((item) => item.id);
    expect(await idsFor(owner)).toEqual([ready.itemId, uploading.itemId]);
    expect(await idsFor(other)).toEqual([ready.itemId]);
    expect(await idsFor(admin)).toEqual([ready.itemId]);
    const own = (await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session))).body[1];
    expect(own.status).toBe('uploading');
  });

  it('answers 404 for an unknown folder and 400 for a malformed id', async () => {
    const { owner } = await setup();
    await http().get('/api/media/folders/00000000-0000-4000-8000-000000000000/items').set(...bearer(owner.session)).expect(404);
    await http().get('/api/media/folders/nope/items').set(...bearer(owner.session)).expect(400);
  });

  it('counts only ready videos in the folder list', async () => {
    const { owner, folder } = await setup();
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id });
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    const folders = (await http().get('/api/media/videos/folders').set(...bearer(owner.session)).expect(200)).body as { id: string; itemCount: number }[];
    expect(folders.find((candidate) => candidate.id === folder.id)?.itemCount).toBe(1);
  });

  it('edits title and description, trims them, and records before and after', async () => {
    const { owner, other, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Old', description: 'Old text' });
    const res = await http().patch(`/api/media/items/${itemId}`).set(...bearer(other.session)).send({ title: '  New  ', description: ' New text ' }).expect(200);
    expect(res.body).toMatchObject({ id: itemId, title: 'New', description: 'New text' });
    const [entry] = await auditFor('content.video.edited', itemId);
    expect(entry.actorId).toBe(other.user.id);
    expect(entry.changes).toEqual({ title: { before: 'Old', after: 'New' }, description: { before: 'Old text', after: 'New text' } });
    expect(entry.targetLabel).toBe('New');
  });

  it('clears the description with an empty string and does not audit an unchanged edit', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Same', description: 'Text' });
    const cleared = await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ description: '' }).expect(200);
    expect(cleared.body.description).toBeNull();
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ title: 'Same', description: null }).expect(200);
    expect(await auditFor('content.video.edited', itemId)).toHaveLength(1);
  });

  it('rejects an empty, over-long or missing change, and keeps hostile text inert', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id });
    const patch = (body: unknown) => http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send(body);
    expect((await patch({ title: '' }).expect(400)).body.fieldErrors.title).toBeDefined();
    await patch({ title: '   ' }).expect(400);
    await patch({ title: 'x'.repeat(201) }).expect(400);
    await patch({ description: 'x'.repeat(2001) }).expect(400);
    await patch({}).expect(400);
    await patch({ title: 'x'.repeat(200) }).expect(200);
    const hostile = '<script>alert(1)</script>';
    expect((await patch({ title: hostile, description: hostile }).expect(200)).body).toMatchObject({ title: hostile, description: hostile });
  });

  it('treats another person\'s uploading video as not found for edits', async () => {
    const { owner, other, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(other.session)).send({ title: 'x' }).expect(404);
    await http().patch(`/api/media/items/${itemId}`).set(...bearer(owner.session)).send({ title: 'Mine' }).expect(200);
    await http().patch('/api/media/items/00000000-0000-4000-8000-000000000000').set(...bearer(owner.session)).send({ title: 'x' }).expect(404);
    await http().patch('/api/media/items/nope').set(...bearer(owner.session)).send({ title: 'x' }).expect(400);
  });

  it('reorders exactly the ready videos of the folder and leaves uploading ones out', async () => {
    const { owner, folder } = await setup();
    const a = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 0 });
    const b = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 1 });
    await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 2, status: 'uploading' });
    const put = (body: unknown) => http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(owner.session)).send(body);
    const res = await put({ ids: [b.itemId, a.itemId] }).expect(200);
    expect(res.body.map((item: { id: string }) => item.id).slice(0, 2)).toEqual([b.itemId, a.itemId]);
    const [entry] = await auditFor('content.video.reordered', folder.id);
    expect(entry.targetLabel).toBe(folder.name);
    await put({ ids: [b.itemId, a.itemId] }).expect(200);
    expect(await auditFor('content.video.reordered', folder.id)).toHaveLength(1);
  });

  it('refuses an order that is missing, repeats, invents or includes another folder\'s video', async () => {
    const { owner, folder } = await setup();
    const a = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 0 });
    const b = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 1 });
    const elsewhere = await seedItem(db, { folderId: (await seedFolder(db, owner.user.id)).id, createdBy: owner.user.id });
    const put = (body: unknown) => http().put(`/api/media/folders/${folder.id}/items/order`).set(...bearer(owner.session)).send(body);
    await put({ ids: [a.itemId] }).expect(409);
    await put({ ids: [a.itemId, a.itemId] }).expect(409);
    await put({ ids: [a.itemId, b.itemId, elsewhere.itemId] }).expect(409);
    await put({ ids: [a.itemId, elsewhere.itemId] }).expect(409);
    await put({ ids: ['x'] }).expect(400);
    await http().put('/api/media/folders/00000000-0000-4000-8000-000000000000/items/order').set(...bearer(owner.session)).send({ ids: [] }).expect(404);
  });
});
```

Run: `npm test -w @jbf/api -- media-items` → FAIL.

- [ ] **Step 2: The items service**

`apps/api/src/media/items.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database, type DbExecutor } from '../db/db.module';
import { type AuditChanges, type FileRow, files, type MediaItem, mediaFolders, mediaItems, users } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { ORDER_CHANGED_MESSAGE, type UpdateItemInput } from './media.schemas';

export interface ItemView {
  id: string;
  folderId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  status: MediaItem['status'];
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  position: number;
}

interface ItemRow {
  item: MediaItem;
  video: FileRow;
  cover: FileRow | null;
  creator: { id: string; name: string };
}

const NOT_FOUND = 'Video not found.';
const coverFile = alias(files, 'cover_file');

// A video that is still uploading belongs to the person uploading it; to everyone else it does not exist yet.
const visibleTo = (item: Pick<MediaItem, 'status' | 'createdBy'>, actor: AuthUser): boolean =>
  item.status === 'ready' || item.createdBy === actor.id;

@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, folderId: string): Promise<ItemView[]> {
    await this.requireFolder(this.db, folderId);
    const rows = await this.rows(
      this.db,
      and(eq(mediaItems.folderId, folderId), or(eq(mediaItems.status, 'ready'), eq(mediaItems.createdBy, actor.id))),
    );
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async view(itemId: string, actor: AuthUser): Promise<ItemView> {
    const [row] = await this.rows(this.db, eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    return this.toView(row);
  }

  async requireVisible(executor: DbExecutor, itemId: string, actor: AuthUser): Promise<MediaItem> {
    const [item] = await executor.select().from(mediaItems).where(eq(mediaItems.id, itemId));
    if (!item || !visibleTo(item, actor)) throw new NotFoundException(NOT_FOUND);
    return item;
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
      await tx.update(mediaItems).set({ title: input.title, description: input.description, updatedAt: new Date() }).where(eq(mediaItems.id, id));
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.edited',
        target: { type: 'video', id, label: input.title ?? item.title },
        changes,
      });
    });
    return this.view(id, actor);
  }

  async reorder(actor: AuthUser, folderId: string, ids: string[]): Promise<ItemView[]> {
    await this.db.transaction(async (tx) => {
      const folder = await this.requireFolder(tx, folderId, true);
      const locked = await tx
        .select({ id: mediaItems.id, position: mediaItems.position, createdAt: mediaItems.createdAt })
        .from(mediaItems)
        .where(and(eq(mediaItems.folderId, folderId), eq(mediaItems.status, 'ready')))
        .orderBy(asc(mediaItems.id))
        .for('update');
      const current = [...locked]
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((item) => item.id);
      const known = new Set(current);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new ConflictException(ORDER_CHANGED_MESSAGE);
      }
      if (ids.some((id, index) => id !== current[index])) {
        for (const [index, id] of ids.entries()) {
          await tx.update(mediaItems).set({ position: index, updatedAt: new Date() }).where(eq(mediaItems.id, id));
        }
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'content.video.reordered',
          target: { type: 'folder', id: folderId, label: folder.name },
        });
      }
    });
    return this.list(actor, folderId);
  }

  private async requireFolder(executor: DbExecutor, folderId: string, lock = false) {
    const query = executor.select().from(mediaFolders).where(eq(mediaFolders.id, folderId));
    const [folder] = lock ? await query.for('update') : await query;
    if (!folder) throw new NotFoundException('Folder not found.');
    return folder;
  }

  private rows(executor: DbExecutor, where: SQL | undefined): Promise<ItemRow[]> {
    return executor
      .select({ item: mediaItems, video: files, cover: coverFile, creator: { id: users.id, name: users.name } })
      .from(mediaItems)
      .innerJoin(files, eq(files.id, mediaItems.videoFileId))
      .leftJoin(coverFile, eq(coverFile.id, mediaItems.coverFileId))
      .innerJoin(users, eq(users.id, mediaItems.createdBy))
      .where(where)
      .orderBy(asc(mediaItems.position), asc(mediaItems.createdAt), asc(mediaItems.id));
  }

  private async toView(row: ItemRow): Promise<ItemView> {
    const coverUrl =
      row.cover && row.cover.status === 'ready'
        ? await this.storage.presignGet(row.cover.storageKey, LINK_TTL_SECONDS, { contentType: row.cover.contentType })
        : null;
    return {
      id: row.item.id,
      folderId: row.item.folderId,
      title: row.item.title,
      description: row.item.description,
      durationSeconds: row.item.durationSeconds,
      sizeBytes: row.video.sizeBytes,
      status: row.item.status,
      coverUrl,
      createdBy: row.creator,
      createdAt: row.item.createdAt,
      position: row.item.position,
    };
  }
}
```


- [ ] **Step 3: Routes and module wiring**

`apps/api/src/media/media.controller.ts`: add to the imports `Put` is already there; add `ItemsService, ItemView` import, the `updateItemSchema`, and the routes (constructor gets `private readonly items: ItemsService`):

```ts
  @Get('folders/:id/items')
  listItems(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ItemView[]> {
    return this.items.list(actor, id);
  }

  @Put('folders/:id/items/order')
  reorderItems(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<ItemView[]> {
    return this.items.reorder(actor, id, body.ids);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateItemSchema)) body: UpdateItemInput,
  ): Promise<ItemView> {
    return this.items.update(actor, id, body);
  }
```

`apps/api/src/media/media.module.ts`: add `ItemsService` to `providers` and `exports: [ItemsService]`.

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS (media-items: 11 tests).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat: list, edit and reorder the videos in a folder"
```

---

### Task 7: Uploading a video in pieces (start, piece links, resume, complete, cancel)

**Files:**
- Create: `apps/api/src/media/{file-checks.ts,file-checks.spec.ts,discard.ts,uploads.service.ts,uploads.controller.ts}`
- Modify: `apps/api/src/media/media.module.ts`, `apps/api/test/helpers/media.ts`
- Test: `apps/api/test/media-uploads.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 4–6 (`StoragePort`, `StorageError`, constants, schemas, `ItemsService.view`, `actorOf`, `seedFolder`, `signIn`, byte helpers).
- Produces:

```ts
// file-checks.ts
sanitizeFileName(input: string): string; hasMp4Signature(bytes: Uint8Array): boolean; imageMatches(bytes: Uint8Array, contentType: string): boolean
// discard.ts
discardStoredFile(storage: StoragePort, logger: Logger, file: Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>): Promise<void>   // best effort, never throws
// uploads.service.ts
class UploadsService { start(actor, input: StartUploadInput): Promise<{ itemId; fileId; partSize; partCount }>;
  partUrls(actor, fileId, partNumbers: number[]): Promise<{ urls: Record<string, string> }>;
  status(actor, fileId): Promise<{ fileId; itemId; status; partSize; partCount; uploadedParts: StoredPart[] }>;
  complete(actor, fileId, parts): Promise<ItemView>; cancel(actor, fileId): Promise<void>;
  mine(actor): Promise<{ fileId; itemId; folderId; title; fileName; sizeBytes; createdAt }[]> }
// HTTP (all under /api/media): POST uploads, GET uploads/mine, POST uploads/:fileId/part-urls, GET uploads/:fileId, POST uploads/:fileId/complete, DELETE uploads/:fileId
// test helpers: startUploadViaApi, putPieces, uploadVideo
```

- [ ] **Step 1: Unit tests for the file checks**

`apps/api/src/media/file-checks.spec.ts`:

```ts
import { hasMp4Signature, imageMatches, sanitizeFileName } from './file-checks';

const mp4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32];

describe('sanitizeFileName', () => {
  it.each([
    ['Fire exits.mp4', 'Fire exits.mp4'],
    ['../../etc/passwd', 'etc passwd'],
    ['C:\\videos\\a.mp4', 'C: videos a.mp4'],
    ['  spaced   out.mp4 ', 'spaced out.mp4'],
    ['bad\u0000name\u0007.mp4', 'bad name .mp4'],
    ['...hidden.mp4', 'hidden.mp4'],
    ['///', 'video.mp4'],
    ['', 'video.mp4'],
    ['<b>x</b>.mp4', '<b>x< b>.mp4'],
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('cuts to 255 characters', () => {
    expect(sanitizeFileName('a'.repeat(400))).toHaveLength(255);
  });
});

describe('hasMp4Signature', () => {
  it('accepts ftyp at byte 4', () => expect(hasMp4Signature(new Uint8Array(mp4))).toBe(true));
  it('refuses other bytes, short input and a shifted marker', () => {
    expect(hasMp4Signature(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBe(false);
    expect(hasMp4Signature(new Uint8Array([0, 0, 0, 0x66, 0x74, 0x79, 0x70]))).toBe(false);
    expect(hasMp4Signature(new Uint8Array())).toBe(false);
    expect(hasMp4Signature(new Uint8Array([0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('imageMatches', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
  const webp = [0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50];

  it('accepts each format only under its own type', () => {
    expect(imageMatches(new Uint8Array(png), 'image/png')).toBe(true);
    expect(imageMatches(new Uint8Array(jpeg), 'image/jpeg')).toBe(true);
    expect(imageMatches(new Uint8Array(webp), 'image/webp')).toBe(true);
    expect(imageMatches(new Uint8Array(png), 'image/jpeg')).toBe(false);
    expect(imageMatches(new Uint8Array(jpeg), 'image/webp')).toBe(false);
    expect(imageMatches(new Uint8Array(webp), 'image/png')).toBe(false);
  });

  it('refuses a RIFF file that is not WebP, short input, and unknown types', () => {
    expect(imageMatches(new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x41, 0x56, 0x49, 0x20]), 'image/webp')).toBe(false);
    expect(imageMatches(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBe(false);
    expect(imageMatches(new Uint8Array(png), 'image/gif')).toBe(false);
    expect(imageMatches(new Uint8Array(mp4), 'image/png')).toBe(false);
  });
});
```

Run: `npm test -w @jbf/api -- file-checks` → FAIL.

- [ ] **Step 2: File checks and the discard helper**

`apps/api/src/media/file-checks.ts`:

```ts
// Display-only: nothing derived from a file name is ever used as a storage path.
export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[\p{Cc}\\/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 255)
    .trim();
  return cleaned === '' ? 'video.mp4' : cleaned;
}

const startsWith = (bytes: Uint8Array, offset: number, expected: number[]): boolean =>
  bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

// An MP4 starts with a box whose type, at bytes 4 to 7, is "ftyp".
export const hasMp4Signature = (bytes: Uint8Array): boolean => startsWith(bytes, 4, ascii('ftyp'));

export function imageMatches(bytes: Uint8Array, contentType: string): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(bytes, 0, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'));
    default:
      return false;
  }
}
```

`apps/api/src/media/discard.ts`:

```ts
import type { Logger } from '@nestjs/common';
import type { FileRow } from '../db/schema';
import { StorageError, type StoragePort } from '../storage/storage.port';

// Removes whatever storage holds for a file: an unfinished multipart upload and/or a finished object. Best effort:
// the database is the source of truth and a leftover object is harmless, so this never throws and logs ids only.
export async function discardStoredFile(
  storage: StoragePort,
  logger: Logger,
  file: Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>,
): Promise<void> {
  if (file.uploadId) {
    await storage.abortMultipartUpload(file.storageKey, file.uploadId).catch((error: unknown) => {
      if (!(error instanceof StorageError && error.code === 'no_such_upload')) {
        logger.warn(`Could not abort the unfinished upload for file ${file.id}`);
      }
    });
  }
  await storage.delete(file.storageKey).catch(() => logger.warn(`Could not delete the stored object for file ${file.id}`));
}
```

Run: `npm test -w @jbf/api -- file-checks` → PASS.

- [ ] **Step 3: Test helpers for the whole flow**

Append to `apps/api/test/helpers/media.ts` (add `PART_SIZE` import from `../../src/storage/storage.constants`):

```ts
export interface StartedUpload {
  itemId: string;
  fileId: string;
  partSize: number;
  partCount: number;
}

export async function startUploadViaApi(
  app: INestApplication,
  session: Session,
  folderId: string,
  overrides: Record<string, unknown> = {},
): Promise<StartedUpload> {
  const res = await request(app.getHttpServer())
    .post('/api/media/uploads')
    .set(...bearer(session))
    .send({ folderId, title: uniqueName('Video'), fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 100, ...overrides })
    .expect(201);
  return res.body;
}

// Asks for piece links and "uploads" the pieces to the in-memory storage; returns the receipts.
export async function putPieces(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  fileId: string,
  body: Uint8Array,
  only?: number[],
): Promise<{ partNumber: number; etag: string }[]> {
  const count = Math.max(1, Math.ceil(body.length / PART_SIZE));
  const numbers = only ?? Array.from({ length: count }, (_, index) => index + 1);
  const receipts: { partNumber: number; etag: string }[] = [];
  for (let start = 0; start < numbers.length; start += 16) {
    const batch = numbers.slice(start, start + 16);
    const res = await request(app.getHttpServer())
      .post(`/api/media/uploads/${fileId}/part-urls`)
      .set(...bearer(session))
      .send({ partNumbers: batch })
      .expect(200);
    for (const partNumber of batch) {
      const slice = body.subarray((partNumber - 1) * PART_SIZE, partNumber * PART_SIZE);
      receipts.push({ partNumber, etag: storage.putPart(res.body.urls[String(partNumber)], slice).etag });
    }
  }
  return receipts;
}

export const completeViaApi = (app: INestApplication, session: Session, fileId: string, parts: { partNumber: number; etag: string }[]) =>
  request(app.getHttpServer()).post(`/api/media/uploads/${fileId}/complete`).set(...bearer(session)).send({ parts });

// The happy path end to end. `declaredSize` defaults to the real size.
export async function uploadVideo(
  app: INestApplication,
  storage: InMemoryStorage,
  session: Session,
  folderId: string,
  body: Uint8Array = mp4Bytes(100),
  overrides: Record<string, unknown> = {},
) {
  const started = await startUploadViaApi(app, session, folderId, { sizeBytes: body.length, ...overrides });
  const parts = await putPieces(app, storage, session, started.fileId, body);
  const res = await completeViaApi(app, session, started.fileId, parts);
  return { ...started, parts, res };
}
```

- [ ] **Step 4: Failing end-to-end tests**

`apps/api/test/media-uploads.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { MAX_VIDEO_BYTES, MIN_PART_SIZE, PART_SIZE } from '../src/storage/storage.constants';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import {
  completeViaApi,
  mp4Bytes,
  pngBytes,
  putPieces,
  seedFolder,
  seedItem,
  signIn,
  startUploadViaApi,
  uploadVideo,
} from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('uploading videos', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const admin = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    return { owner, other, admin, folder };
  }

  it('needs a signed-in person on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await http().post('/api/media/uploads').send({}).expect(401);
    await http().get('/api/media/uploads/mine').expect(401);
    await http().get(`/api/media/uploads/${id}`).expect(401);
    await http().post(`/api/media/uploads/${id}/part-urls`).send({}).expect(401);
    await http().post(`/api/media/uploads/${id}/complete`).send({}).expect(401);
    await http().delete(`/api/media/uploads/${id}`).expect(401);
  });

  describe('starting', () => {
    it('creates an uploading video and a pending file, audits it, and reports the piece arithmetic', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { title: '  Fire exits ', description: 'About exits', sizeBytes: 100, durationSeconds: 12 });
      expect(started).toEqual({ itemId: expect.any(String), fileId: expect.any(String), partSize: PART_SIZE, partCount: 1 });
      expect(await itemRow(started.itemId)).toMatchObject({ title: 'Fire exits', description: 'About exits', status: 'uploading', durationSeconds: 12, createdBy: owner.user.id });
      expect(await fileRow(started.fileId)).toMatchObject({ purpose: 'video', status: 'pending', sizeBytes: 100, partCount: 1, partSize: PART_SIZE, contentType: 'video/mp4' });
      const [entry] = await auditFor('file.upload_started', started.itemId);
      expect(entry).toMatchObject({ actorId: owner.user.id, targetLabel: 'Fire exits' });
      expect(JSON.stringify(entry)).not.toMatch(/videos\/|memory:/);
    });

    it.each([
      [1, 1],
      [PART_SIZE, 1],
      [PART_SIZE + 1, 2],
      [MAX_VIDEO_BYTES, 128],
    ])('a %i byte video is %i piece(s), and exactly 2 GiB is accepted', async (sizeBytes, partCount) => {
      const { owner, folder } = await setup();
      expect((await startUploadViaApi(app, owner.session, folder.id, { sizeBytes })).partCount).toBe(partCount);
    });

    it.each([
      ['empty file', { sizeBytes: 0 }, 'sizeBytes'],
      ['negative size', { sizeBytes: -5 }, 'sizeBytes'],
      ['over 2 GiB', { sizeBytes: MAX_VIDEO_BYTES + 1 }, 'sizeBytes'],
      ['fractional size', { sizeBytes: 1.5 }, 'sizeBytes'],
      ['text size', { sizeBytes: '100' }, 'sizeBytes'],
      ['not an MP4', { contentType: 'video/webm' }, 'contentType'],
      ['blank type', { contentType: '' }, 'contentType'],
      ['empty title', { title: '  ' }, 'title'],
      ['long title', { title: 'x'.repeat(201) }, 'title'],
      ['long description', { description: 'x'.repeat(2001) }, 'description'],
      ['no file name', { fileName: '' }, 'fileName'],
      ['negative length', { durationSeconds: -1 }, 'durationSeconds'],
    ])('refuses %s', async (_name, overrides, field) => {
      const { owner, folder } = await setup();
      const res = await http()
        .post('/api/media/uploads')
        .set(...bearer(owner.session))
        .send({ folderId: folder.id, title: 'T', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100, ...overrides })
        .expect(400);
      expect(res.body.fieldErrors[field]).toBeDefined();
    });

    it('explains how to convert a non-MP4 file', async () => {
      const { owner, folder } = await setup();
      const res = await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ folderId: folder.id, title: 'T', fileName: 'a.mov', contentType: 'video/quicktime', sizeBytes: 5 }).expect(400);
      expect(res.body.fieldErrors.contentType[0]).toMatch(/HandBrake/);
    });

    it('404s for an unknown folder and 400s for a malformed folder id', async () => {
      const { owner } = await setup();
      const body = { title: 'T', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 5 };
      await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ ...body, folderId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await http().post('/api/media/uploads').set(...bearer(owner.session)).send({ ...body, folderId: 'nope' }).expect(400);
    });

    it('stores a sanitized display name and never lets it near the storage key', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { fileName: '../../etc/passwd' });
      const row = await fileRow(started.fileId);
      expect(row.originalName).toBe('etc passwd');
      expect(row.storageKey).toMatch(/^videos\/[0-9a-f-]{36}$/);
    });

    it('puts a new video at the end of the folder', async () => {
      const { owner, folder } = await setup();
      await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 4 });
      const started = await startUploadViaApi(app, owner.session, folder.id);
      expect((await itemRow(started.itemId)).position).toBe(5);
    });
  });

  describe('piece links', () => {
    it('hands out links for the pieces asked for, and not for pieces that cannot exist', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: PART_SIZE * 2 + 1 });
      const post = (partNumbers: unknown) => http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers });
      const ok = await post([1, 3]).expect(200);
      expect(Object.keys(ok.body.urls)).toEqual(['1', '3']);
      await post([4]).expect(400);
      await post([0]).expect(400);
      await post([]).expect(400);
      await post(Array.from({ length: 17 }, (_, index) => (index % 3) + 1)).expect(400);
      await post(['1']).expect(400);
      await post(Array.from({ length: 16 }, (_, index) => (index % 3) + 1)).expect(200);
    });

    it('is for the uploader or an Admin only', async () => {
      const { owner, other, admin, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      const post = (session: typeof owner.session) => http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(session)).send({ partNumbers: [1] });
      await post(other.session).expect(403);
      await post(admin.session).expect(200);
      await post(owner.session).expect(200);
      await http().post('/api/media/uploads/00000000-0000-4000-8000-000000000000/part-urls').set(...bearer(owner.session)).send({ partNumbers: [1] }).expect(404);
      await http().post('/api/media/uploads/nope/part-urls').set(...bearer(owner.session)).send({ partNumbers: [1] }).expect(400);
    });
  });

  describe('resuming', () => {
    it('reports the pieces storage holds, even if the browser forgot them', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 10);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      const res = await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(200);
      expect(res.body).toMatchObject({ fileId: started.fileId, itemId: started.itemId, status: 'pending', partSize: PART_SIZE, partCount: 2 });
      expect(res.body.uploadedParts).toEqual([{ partNumber: 2, size: 10, etag: expect.any(String) }]);
    });

    it('is for the uploader or an Admin only', async () => {
      const { owner, other, admin, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(other.session)).expect(403);
      await http().get(`/api/media/uploads/${started.fileId}`).set(...bearer(admin.session)).expect(200);
    });

    it('lists only my unfinished uploads', async () => {
      const { owner, other, folder } = await setup();
      const mine = await startUploadViaApi(app, owner.session, folder.id, { title: 'Mine', fileName: 'mine.mp4', sizeBytes: 321 });
      await startUploadViaApi(app, other.session, folder.id);
      const finished = await uploadVideo(app, storage, owner.session, folder.id);
      expect(finished.res.status).toBe(200);
      const res = await http().get('/api/media/uploads/mine').set(...bearer(owner.session)).expect(200);
      expect(res.body).toEqual([
        { fileId: mine.fileId, itemId: mine.itemId, folderId: folder.id, title: 'Mine', fileName: 'mine.mp4', sizeBytes: 321, createdAt: expect.any(String) },
      ]);
    });
  });

  describe('finishing', () => {
    it('makes the video ready for everyone, at the end of the folder, with two audit entries', async () => {
      const { owner, other, folder } = await setup();
      await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, position: 3 });
      const { itemId, fileId, res } = await uploadVideo(app, storage, owner.session, folder.id, mp4Bytes(200), { title: 'Fire exits' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: itemId, title: 'Fire exits', status: 'ready', sizeBytes: 200, position: 4 });
      expect(await fileRow(fileId)).toMatchObject({ status: 'ready', uploadId: null, completedAt: expect.any(Date) });
      const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(other.session)).expect(200);
      expect(list.body.map((item: { id: string }) => item.id)).toContain(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
      expect(await auditFor('content.video.added', itemId)).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/videos\/|storageKey|uploadId/);
    });

    it('joins several pieces, including a small last piece', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 1024);
      const { fileId, parts, res } = await uploadVideo(app, storage, owner.session, folder.id, body);
      expect(parts).toHaveLength(2);
      expect(res.status).toBe(200);
      const key = (await fileRow(fileId)).storageKey;
      expect(await storage.head(key)).toEqual({ size: body.length, contentType: 'video/mp4' });
    });

    it('is safe to repeat: the second call returns the ready video and adds nothing', async () => {
      const { owner, folder } = await setup();
      const { itemId, fileId, parts } = await uploadVideo(app, storage, owner.session, folder.id);
      const again = await completeViaApi(app, owner.session, fileId, parts);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(itemId);
      expect(await auditFor('file.upload_completed', itemId)).toHaveLength(1);
    });

    it('is safe when two requests finish the same upload at once', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(300);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const results = await Promise.all([
        completeViaApi(app, owner.session, started.fileId, parts),
        completeViaApi(app, owner.session, started.fileId, parts),
        completeViaApi(app, owner.session, started.fileId, parts),
      ]);
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(await auditFor('file.upload_completed', started.itemId)).toHaveLength(1);
      expect(await auditFor('content.video.added', started.itemId)).toHaveLength(1);
      expect((await itemRow(started.itemId)).status).toBe('ready');
    });

    it('refuses while pieces are missing, keeps the upload, and works after the missing piece arrives', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(PART_SIZE + 10);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const first = await putPieces(app, storage, owner.session, started.fileId, body, [1]);
      const refused = await completeViaApi(app, owner.session, started.fileId, first);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/missing/i);
      expect((await fileRow(started.fileId)).status).toBe('pending');
      const second = await putPieces(app, storage, owner.session, started.fileId, body, [2]);
      expect((await completeViaApi(app, owner.session, started.fileId, [...second, ...first])).status).toBe(200);
    });

    it('refuses a wrong receipt without damaging the upload', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      const wrong = await completeViaApi(app, owner.session, started.fileId, [{ partNumber: 1, etag: '"wrong"' }]);
      expect(wrong.status).toBe(422);
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(200);
    });

    it('refuses a first piece under 5 MiB when there are two pieces, and keeps the upload', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: PART_SIZE + 10 });
      const urls = (await http().post(`/api/media/uploads/${started.fileId}/part-urls`).set(...bearer(owner.session)).send({ partNumbers: [1, 2] })).body.urls;
      const parts = [
        { partNumber: 1, etag: storage.putPart(urls['1'], mp4Bytes(MIN_PART_SIZE - 1)).etag },
        { partNumber: 2, etag: storage.putPart(urls['2'], new Uint8Array(10)).etag },
      ];
      expect((await completeViaApi(app, owner.session, started.fileId, parts)).status).toBe(422);
      expect((await fileRow(started.fileId)).status).toBe('pending');
    });

    it.each([
      ['more bytes than declared', 150, 100, 'size_mismatch'],
      ['fewer bytes than declared', 60, 100, 'size_mismatch'],
    ])('discards a file with %s, removes its rows and records why', async (_name, actualSize, declaredSize, reason) => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: declaredSize });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(actualSize));
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/size/i);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
      const [entry] = await auditFor('file.upload_failed', started.itemId);
      expect(entry.metadata).toMatchObject({ reason });
      const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session));
      expect(list.body.map((item: { id: string }) => item.id)).not.toContain(started.itemId);
    });

    it('discards a file that is not an MP4 even though it was declared as one', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: 64 });
      const key = (await fileRow(started.fileId)).storageKey;
      const parts = await putPieces(app, storage, owner.session, started.fileId, pngBytes(64));
      const res = await completeViaApi(app, owner.session, started.fileId, parts);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/MP4/);
      expect(storage.has(key)).toBe(false);
      expect((await auditFor('file.upload_failed', started.itemId))[0].metadata).toMatchObject({ reason: 'not_mp4' });
    });

    it('is for the uploader or an Admin only, and 404s once the upload is gone', async () => {
      const { owner, other, admin, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      expect((await completeViaApi(app, other.session, started.fileId, parts)).status).toBe(403);
      expect((await completeViaApi(app, admin.session, started.fileId, parts)).status).toBe(200);
      await http().post('/api/media/uploads/00000000-0000-4000-8000-000000000000/complete').set(...bearer(owner.session)).send({ parts }).expect(404);
    });

    it('rejects a malformed list of pieces', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      const post = (body: unknown) => http().post(`/api/media/uploads/${started.fileId}/complete`).set(...bearer(owner.session)).send(body);
      await post({}).expect(400);
      await post({ parts: [] }).expect(400);
      await post({ parts: [{ partNumber: 1 }] }).expect(400);
      await post({ parts: [{ partNumber: 0, etag: 'x' }] }).expect(400);
      await post({ parts: [{ partNumber: 1, etag: 'x' }, { partNumber: 1, etag: 'x' }] }).expect(422);
    });
  });

  describe('cancelling', () => {
    it('removes a pending upload, aborts it in storage and audits it', async () => {
      const { owner, folder } = await setup();
      const started = await startUploadViaApi(app, owner.session, folder.id);
      await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(100));
      const before = storage.pendingUploadCount();
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      expect(storage.pendingUploadCount()).toBe(before - 1);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(await itemRow(started.itemId)).toBeUndefined();
      expect(await auditFor('file.upload_cancelled', started.itemId)).toHaveLength(1);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(404);
    });

    it('lets an Admin cancel anyone\'s upload but not another Staff member', async () => {
      const { owner, other, admin, folder } = await setup();
      const first = await startUploadViaApi(app, owner.session, folder.id);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(other.session)).expect(403);
      await http().delete(`/api/media/uploads/${first.fileId}`).set(...bearer(admin.session)).expect(204);
    });

    it('never touches a finished video', async () => {
      const { owner, folder } = await setup();
      const { itemId, fileId } = await uploadVideo(app, storage, owner.session, folder.id);
      const key = (await fileRow(fileId)).storageKey;
      await http().delete(`/api/media/uploads/${fileId}`).set(...bearer(owner.session)).expect(409);
      expect((await itemRow(itemId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    });

    it('stops a later finish with 404 instead of resurrecting the video', async () => {
      const { owner, folder } = await setup();
      const body = mp4Bytes(100);
      const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
      const parts = await putPieces(app, storage, owner.session, started.fileId, body);
      await http().delete(`/api/media/uploads/${started.fileId}`).set(...bearer(owner.session)).expect(204);
      await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
    });
  });

  it('never puts links or storage keys in any audit entry of these uploads', async () => {
    const { owner, folder } = await setup();
    const { itemId, fileId } = await uploadVideo(app, storage, owner.session, folder.id);
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, itemId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const key = (await fileRow(fileId)).storageKey;
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(rows)).not.toMatch(/memory:|videos\/|X-Amz|dev-storage/);
  });
});
```

(`completeViaApi(...).expect(404)` returns a supertest `Test`; it is thenable, so `await` works. Keep `await` on those lines.)

Run: `npm test -w @jbf/api -- media-uploads` → FAIL.

- [ ] **Step 5: The uploads service**

`apps/api/src/media/uploads.service.ts`:

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
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuditAction } from '../audit/audit.actions';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaFolders, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS, PART_SIZE, partCountFor, VIDEO_CONTENT_TYPE } from '../storage/storage.constants';
import { STORAGE, StorageError, type StoragePort, type StoredPart } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { hasMp4Signature, sanitizeFileName } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import type { StartUploadInput } from './media.schemas';

const GONE = 'This upload no longer exists.';
const LOST_UPLOAD = 'This upload can no longer be continued. Cancel it and start again.';
const MISSING_PIECES = 'Some pieces are missing. Resume the upload to send them.';
const BAD_PIECES = 'Some pieces are missing or damaged. Resume the upload to send them again.';
const FINISHED = 'This video has already finished uploading.';

const FAILURE_MESSAGES = {
  size_mismatch: 'The uploaded file is not the size it was declared to be, so it was discarded. Please upload it again.',
  not_mp4: 'That file is not a valid MP4 video, so it was discarded. Convert it to MP4 first (for example with HandBrake).',
} as const;

type FailureReason = keyof typeof FAILURE_MESSAGES;
type UploadRow = { file: FileRow; item: MediaItem };

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
      .select({ id: mediaFolders.id })
      .from(mediaFolders)
      .where(and(eq(mediaFolders.id, input.folderId), eq(mediaFolders.category, 'video')));
    if (!folder) throw new NotFoundException('Folder not found.');

    const key = `videos/${randomUUID()}`;
    const partCount = partCountFor(input.sizeBytes);
    // Storage first, then the database: if the transaction fails the storage side is rolled back below.
    const uploadId = await this.storage.createMultipartUpload(key, VIDEO_CONTENT_TYPE);
    try {
      return await this.db.transaction(async (tx) => {
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
          .from(mediaItems)
          .where(eq(mediaItems.folderId, folder.id));
        const [file] = await tx
          .insert(files)
          .values({
            purpose: 'video',
            storageKey: key,
            originalName: sanitizeFileName(input.fileName),
            contentType: VIDEO_CONTENT_TYPE,
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
            videoFileId: file.id,
            durationSeconds: input.durationSeconds ?? null,
            status: 'uploading',
            createdBy: actor.id,
          })
          .returning();
        await this.audit.record(tx, {
          actor: actorOf(actor),
          action: 'file.upload_started',
          target: { type: 'video', id: item.id, label: item.title },
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
    const { file, item } = await this.load(fileId, actor);
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
    if (info.size !== file.sizeBytes) return this.fail(actor, { file, item }, 'size_mismatch');
    const head = await this.storage.readRange(file.storageKey, 0, 15);
    if (info.contentType !== VIDEO_CONTENT_TYPE || !hasMp4Signature(head)) return this.fail(actor, { file, item }, 'not_mp4');
    return this.finish(actor, { file, item });
  }

  async cancel(actor: AuthUser, fileId: string): Promise<void> {
    const row = await this.load(fileId, actor);
    if (row.file.status === 'ready') throw new ConflictException(`${FINISHED} Finished videos cannot be cancelled here.`);
    const removed = await this.removePending(row, { actor, action: 'file.upload_cancelled', metadata: { fileId } });
    if (!removed) {
      const [current] = await this.db.select({ status: files.status }).from(files).where(eq(files.id, fileId));
      if (current?.status === 'ready') throw new ConflictException(`${FINISHED} Finished videos cannot be cancelled here.`);
      return;
    }
    await discardStoredFile(this.storage, this.logger, row.file);
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
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(and(eq(files.uploadedBy, actor.id), eq(files.purpose, 'video'), eq(files.status, 'pending')))
      .orderBy(desc(files.createdAt));
  }

  private async load(fileId: string, actor: AuthUser): Promise<UploadRow> {
    const [row] = await this.db
      .select({ file: files, item: mediaItems })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(and(eq(files.id, fileId), eq(files.purpose, 'video')));
    if (!row) throw new NotFoundException('Upload not found.');
    if (row.file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    return row;
  }

  // The object is not in storage any more: either another request finished the job, or the upload was cancelled.
  private async afterVanish(actor: AuthUser, fileId: string): Promise<ItemView> {
    const [row] = await this.db
      .select({ status: files.status, itemId: mediaItems.id })
      .from(files)
      .innerJoin(mediaItems, eq(mediaItems.videoFileId, files.id))
      .where(eq(files.id, fileId));
    if (!row) throw new NotFoundException(GONE);
    if (row.status === 'ready') return this.items.view(row.itemId, actor);
    throw new ConflictException(LOST_UPLOAD);
  }

  // Removes the rows of a still-pending upload and records why. Returns false when someone else already did
  // (or the upload finished meanwhile), so a ready video can never be removed by this path.
  private async removePending(
    { file, item }: UploadRow,
    outcome: { actor: AuthUser; action: AuditAction; metadata: Record<string, unknown> },
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(mediaItems)
        .where(and(eq(mediaItems.id, item.id), eq(mediaItems.status, 'uploading')))
        .returning({ id: mediaItems.id });
      if (!gone) return false;
      await tx.delete(files).where(eq(files.id, file.id));
      await this.audit.record(tx, {
        actor: actorOf(outcome.actor),
        action: outcome.action,
        target: { type: 'video', id: item.id, label: item.title },
        metadata: outcome.metadata,
      });
      return true;
    });
  }

  private async fail(actor: AuthUser, row: UploadRow, reason: FailureReason): Promise<never> {
    const removed = await this.removePending(row, { actor, action: 'file.upload_failed', metadata: { fileId: row.file.id, reason } });
    if (removed) await discardStoredFile(this.storage, this.logger, row.file);
    throw new UnprocessableEntityException(FAILURE_MESSAGES[reason]);
  }

  private async finish(actor: AuthUser, { file, item }: UploadRow): Promise<ItemView> {
    const outcome = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(files).where(eq(files.id, file.id)).for('update');
      if (!locked) return 'gone' as const;
      if (locked.status === 'ready') return 'done' as const;
      const [{ end }] = await tx
        .select({ end: sql<number>`coalesce(max(${mediaItems.position}), -1) + 1`.mapWith(Number) })
        .from(mediaItems)
        .where(and(eq(mediaItems.folderId, item.folderId), eq(mediaItems.status, 'ready')));
      const now = new Date();
      await tx.update(files).set({ status: 'ready', uploadId: null, completedAt: now }).where(eq(files.id, file.id));
      await tx.update(mediaItems).set({ status: 'ready', position: end, updatedAt: now }).where(eq(mediaItems.id, item.id));
      const target = { type: 'video', id: item.id, label: item.title };
      await this.audit.record(tx, { actor: actorOf(actor), action: 'file.upload_completed', target, metadata: { fileId: file.id, sizeBytes: file.sizeBytes } });
      await this.audit.record(tx, { actor: actorOf(actor), action: 'content.video.added', target, metadata: { folderId: item.folderId } });
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

(`await storage.readRange` needs the file to be at least 16 bytes for a full read; a 1-byte object returns 1 byte and the signature check fails correctly.)

- [ ] **Step 6: The controller and module**

`apps/api/src/media/uploads.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import type { ItemView } from './items.service';
import { completeUploadSchema, partUrlsSchema, startUploadSchema } from './media.schemas';
import { UploadsService } from './uploads.service';

// A 2 GiB upload is about 128 pieces plus retries, so these routes are throttled far more generously than the default.
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('media/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  start(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(startUploadSchema)) body: z.infer<typeof startUploadSchema>) {
    return this.uploads.start(actor, body);
  }

  // Declared before ":fileId" so "mine" is not read as an id.
  @Get('mine')
  mine(@CurrentUser() actor: AuthUser) {
    return this.uploads.mine(actor);
  }

  @Post(':fileId/part-urls')
  @HttpCode(200)
  partUrls(
    @CurrentUser() actor: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body(new ZodPipe(partUrlsSchema)) body: z.infer<typeof partUrlsSchema>,
  ) {
    return this.uploads.partUrls(actor, fileId, body.partNumbers);
  }

  @Get(':fileId')
  status(@CurrentUser() actor: AuthUser, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.uploads.status(actor, fileId);
  }

  @Post(':fileId/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body(new ZodPipe(completeUploadSchema)) body: z.infer<typeof completeUploadSchema>,
  ): Promise<ItemView> {
    return this.uploads.complete(actor, fileId, body.parts);
  }

  @Delete(':fileId')
  @HttpCode(204)
  cancel(@CurrentUser() actor: AuthUser, @Param('fileId', ParseUUIDPipe) fileId: string): Promise<void> {
    return this.uploads.cancel(actor, fileId);
  }
}
```

`apps/api/src/media/media.module.ts`: add `UploadsController` to `controllers` and `UploadsService` to `providers`.

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS. If the three-way concurrent completion produces a 409 or 500 for one request, the finish logic has a race: read the failing response before changing anything. Do not weaken the test. `part-urls` with 17 numbers of repeated values must be refused by the schema's `max(16)` before deduplication (that is the intended behaviour).

- [ ] **Step 8: Commit**

```bash
git add -A apps/api
git commit -m "feat: upload videos in pieces with resume, verification and cancel"
```

---

### Task 8: Cover images and playback links

**Files:**
- Create: `apps/api/src/media/covers.service.ts`
- Modify: `apps/api/src/media/items.service.ts` (add `play`), `apps/api/src/media/media.controller.ts`, `apps/api/src/media/uploads.controller.ts` (no change) → covers routes go on `MediaController`, `apps/api/src/media/media.module.ts`
- Test: `apps/api/test/media-covers.e2e-spec.ts`, `apps/api/test/media-play.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:

```ts
class CoversService { start(actor, itemId, input: CoverStartInput): Promise<{ fileId: string; url: string; headers: { 'Content-Type': string } }>;
  complete(actor, itemId, fileId): Promise<ItemView> }
ItemsService.play(actor, itemId): Promise<{ url: string; expiresAt: string; contentType: string }>
// HTTP: POST /api/media/items/:id/cover; POST /api/media/items/:id/cover/:fileId/complete; POST /api/media/items/:id/play
```

- [ ] **Step 1: Failing tests**

`apps/api/test/media-covers.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { MAX_COVER_BYTES } from '../src/storage/storage.constants';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { jpegBytes, mp4Bytes, pngBytes, seedFolder, seedItem, signIn, webpBytes } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('cover images', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const fileRow = async (fileId: string) => (await db.select().from(files).where(eq(files.id, fileId)))[0];
  const auditFor = (action: string, targetId: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

  async function setup() {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    const item = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    return { owner, other, folder, item };
  }

  const startCover = (session: Parameters<typeof bearer>[0], itemId: string, body: unknown) =>
    http().post(`/api/media/items/${itemId}/cover`).set(...bearer(session)).send(body);
  const completeCover = (session: Parameters<typeof bearer>[0], itemId: string, fileId: string) =>
    http().post(`/api/media/items/${itemId}/cover/${fileId}/complete`).set(...bearer(session));

  it('needs a signed-in person', async () => {
    const { item } = await setup();
    await http().post(`/api/media/items/${item.itemId}/cover`).send({}).expect(401);
    await http().post(`/api/media/items/${item.itemId}/cover/${item.fileId}/complete`).expect(401);
  });

  it('sets a cover end to end and shows it as a link in the list', async () => {
    const { owner, other, folder, item } = await setup();
    const body = pngBytes(200);
    const started = await startCover(other.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length }).expect(201);
    expect(started.body).toEqual({ fileId: expect.any(String), url: expect.stringMatching(/^memory:\/\/put\//), headers: { 'Content-Type': 'image/png' } });
    storage.putObject(started.body.url, body);
    const done = await completeCover(other.session, item.itemId, started.body.fileId).expect(200);
    expect(done.body.coverUrl).toMatch(/^memory:\/\/get\//);
    expect((await fileRow(started.body.fileId)).status).toBe('ready');
    const [entry] = await auditFor('content.video.cover_set', item.itemId);
    expect(entry.actorId).toBe(other.user.id);
    expect(JSON.stringify(entry)).not.toMatch(/covers\/|memory:/);
    const list = await http().get(`/api/media/folders/${folder.id}/items`).set(...bearer(owner.session)).expect(200);
    expect(list.body.find((candidate: { id: string }) => candidate.id === item.itemId).coverUrl).toMatch(/^memory:\/\/get\//);
  });

  it.each([
    ['image/jpeg', jpegBytes],
    ['image/webp', webpBytes],
  ] as const)('accepts %s', async (contentType, make) => {
    const { owner, item } = await setup();
    const body = make(100);
    const started = await startCover(owner.session, item.itemId, { contentType, sizeBytes: body.length }).expect(201);
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
  });

  it('replaces an earlier cover and removes the old file', async () => {
    const { owner, item } = await setup();
    const put = async (bytes: Uint8Array) => {
      const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: bytes.length });
      storage.putObject(started.body.url, bytes);
      await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
      return started.body.fileId as string;
    };
    const first = await put(pngBytes(100));
    const firstKey = (await fileRow(first)).storageKey;
    const second = await put(pngBytes(120));
    expect(await fileRow(first)).toBeUndefined();
    expect(storage.has(firstKey)).toBe(false);
    expect((await db.select().from(mediaItems).where(eq(mediaItems.id, item.itemId)))[0].coverFileId).toBe(second);
  });

  it('is safe to complete twice', async () => {
    const { owner, item } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    expect(await auditFor('content.video.cover_set', item.itemId)).toHaveLength(1);
  });

  it.each([
    ['an unsupported type', { contentType: 'image/gif', sizeBytes: 10 }],
    ['an empty file', { contentType: 'image/png', sizeBytes: 0 }],
    ['a file over 10 MB', { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES + 1 }],
    ['a fractional size', { contentType: 'image/png', sizeBytes: 1.5 }],
    ['no type', { sizeBytes: 10 }],
  ])('refuses %s when starting', async (_name, body) => {
    const { owner, item } = await setup();
    await startCover(owner.session, item.itemId, body).expect(400);
  });

  it('accepts exactly 10 MB when starting', async () => {
    const { owner, item } = await setup();
    await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: MAX_COVER_BYTES }).expect(201);
  });

  it('discards a cover whose bytes are not the declared image type', async () => {
    const { owner, item } = await setup();
    const body = mp4Bytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    const key = (await fileRow(started.body.fileId)).storageKey;
    storage.putObject(started.body.url, body);
    const res = await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/JPEG, PNG or WebP/);
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await auditFor('file.upload_failed', item.itemId))[0].metadata).toMatchObject({ reason: 'bad_image' });
  });

  it('discards a cover whose size differs from the declared size', async () => {
    const { owner, item } = await setup();
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: 500 });
    storage.putObject(started.body.url, pngBytes(100));
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect((await auditFor('file.upload_failed', item.itemId))[0].metadata).toMatchObject({ reason: 'size_mismatch' });
  });

  it('asks the browser to try again when nothing was uploaded yet, and keeps the file', async () => {
    const { owner, item } = await setup();
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: 10 });
    const res = await completeCover(owner.session, item.itemId, started.body.fileId).expect(422);
    expect(res.body.message).toMatch(/not been uploaded/i);
    expect((await fileRow(started.body.fileId)).status).toBe('pending');
  });

  it('is limited to the uploader of the cover (or an Admin), and to videos you can see', async () => {
    const { owner, other, item } = await setup();
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(other.session, item.itemId, started.body.fileId).expect(403);
    const admin = await signIn(app, db, 'admin');
    await completeCover(admin.session, item.itemId, started.body.fileId).expect(200);

    const hidden = await seedItem(db, { folderId: (await seedFolder(db, owner.user.id)).id, createdBy: owner.user.id, status: 'uploading' });
    await startCover(other.session, hidden.itemId, { contentType: 'image/png', sizeBytes: 5 }).expect(404);
    await startCover(owner.session, hidden.itemId, { contentType: 'image/png', sizeBytes: 5 }).expect(201);
    await completeCover(owner.session, item.itemId, '00000000-0000-4000-8000-000000000000').expect(404);
    await completeCover(owner.session, 'nope', started.body.fileId).expect(400);
  });

  it('will not attach one cover file to a second video', async () => {
    const { owner, folder, item } = await setup();
    const second = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const body = pngBytes(100);
    const started = await startCover(owner.session, item.itemId, { contentType: 'image/png', sizeBytes: body.length });
    storage.putObject(started.body.url, body);
    await completeCover(owner.session, item.itemId, started.body.fileId).expect(200);
    await completeCover(owner.session, second.itemId, started.body.fileId).expect(409);
  });

  it('refuses a video file id in place of a cover file id', async () => {
    const { owner, item } = await setup();
    await completeCover(owner.session, item.itemId, item.fileId).expect(404);
  });
});
```

`apps/api/test/media-play.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog } from '../src/db/schema';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedFolder, seedItem, signIn } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

describe('playing a video', () => {
  let app: NestExpressApplication;
  let db: Database;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    ({ app, db, storage } = await createTestApp());
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('needs a signed-in person', async () => {
    await http().post('/api/media/items/00000000-0000-4000-8000-000000000000/play').expect(401);
  });

  it('gives a one-hour link that reads the stored video, and audits the play', async () => {
    const owner = await signIn(app, db);
    const viewer = await signIn(app, db, 'admin');
    const folder = await seedFolder(db, owner.user.id);
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, title: 'Fire exits', sizeBytes: 300, storage });
    const before = Date.now();
    const res = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(viewer.session)).expect(200);
    expect(res.body).toEqual({ url: expect.stringMatching(/^memory:\/\/get\//), expiresAt: expect.any(String), contentType: 'video/mp4' });
    expect(Date.parse(res.body.expiresAt) - before).toBeGreaterThan(3_590_000);
    expect(Date.parse(res.body.expiresAt) - before).toBeLessThanOrEqual(3_601_000);
    const fetched = storage.get(res.body.url);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toHaveLength(300);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'playback.played'), eq(auditLog.targetId, itemId)));
    expect(entry).toMatchObject({ actorId: viewer.user.id, targetLabel: 'Fire exits' });
    expect(JSON.stringify(entry)).not.toMatch(/memory:|videos\//);
  });

  it('answers 404 for an unknown or malformed id, and for another person\'s uploading video', async () => {
    const owner = await signIn(app, db);
    const other = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, status: 'uploading' });
    await http().post(`/api/media/items/${itemId}/play`).set(...bearer(other.session)).expect(404);
    await http().post('/api/media/items/00000000-0000-4000-8000-000000000000/play').set(...bearer(owner.session)).expect(404);
    await http().post('/api/media/items/nope/play').set(...bearer(owner.session)).expect(400);
    const mine = await http().post(`/api/media/items/${itemId}/play`).set(...bearer(owner.session)).expect(409);
    expect(mine.body.message).toMatch(/still uploading/i);
  });
});
```

Run: `npm test -w @jbf/api -- media-covers media-play` → FAIL.

- [ ] **Step 2: The covers service and `play`**

`apps/api/src/media/covers.service.ts`:

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
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, type MediaItem, mediaItems } from '../db/schema';
import { LINK_TTL_SECONDS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { actorOf } from './actor';
import { discardStoredFile } from './discard';
import { imageMatches } from './file-checks';
import { type ItemView, ItemsService } from './items.service';
import type { CoverStartInput } from './media.schemas';

const NOT_UPLOADED = 'The cover image has not been uploaded yet. Try again.';
const REJECTED = 'That is not a valid JPEG, PNG or WebP image of the declared size, so it was discarded. Please choose another file.';

@Injectable()
export class CoversService {
  private readonly logger = new Logger(CoversService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
  ) {}

  async start(
    actor: AuthUser,
    itemId: string,
    input: CoverStartInput,
  ): Promise<{ fileId: string; url: string; headers: { 'Content-Type': string } }> {
    await this.items.requireVisible(this.db, itemId, actor);
    const key = `covers/${randomUUID()}`;
    const url = await this.storage.presignPut(key, input.contentType, LINK_TTL_SECONDS);
    const [file] = await this.db
      .insert(files)
      .values({ purpose: 'cover', storageKey: key, originalName: 'cover', contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedBy: actor.id })
      .returning({ id: files.id });
    return { fileId: file.id, url, headers: { 'Content-Type': input.contentType } };
  }

  async complete(actor: AuthUser, itemId: string, fileId: string): Promise<ItemView> {
    const item = await this.items.requireVisible(this.db, itemId, actor);
    const [file] = await this.db.select().from(files).where(and(eq(files.id, fileId), eq(files.purpose, 'cover')));
    if (!file) throw new NotFoundException('Cover upload not found.');
    if (file.uploadedBy !== actor.id && actor.role !== 'admin') throw new ForbiddenException('This upload belongs to someone else.');
    if (file.status === 'ready') return this.alreadyAttached(actor, item, file);

    const info = await this.storage.head(file.storageKey);
    if (!info) throw new UnprocessableEntityException(NOT_UPLOADED);
    if (info.size !== file.sizeBytes) return this.reject(actor, item, file, 'size_mismatch');
    const head = await this.storage.readRange(file.storageKey, 0, 15);
    if (info.contentType !== file.contentType || !imageMatches(head, file.contentType)) return this.reject(actor, item, file, 'bad_image');
    return this.attach(actor, item, file);
  }

  private alreadyAttached(actor: AuthUser, item: MediaItem, file: FileRow): Promise<ItemView> {
    if (item.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
    return this.items.view(item.id, actor);
  }

  private async reject(actor: AuthUser, item: MediaItem, file: FileRow, reason: 'size_mismatch' | 'bad_image'): Promise<never> {
    const removed = await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'file.upload_failed',
        target: { type: 'video', id: item.id, label: item.title },
        metadata: { fileId: file.id, reason },
      });
      return true;
    });
    if (removed) await discardStoredFile(this.storage, this.logger, { id: file.id, storageKey: file.storageKey, uploadId: null });
    throw new UnprocessableEntityException(REJECTED);
  }

  private async attach(actor: AuthUser, item: MediaItem, file: FileRow): Promise<ItemView> {
    const replaced = await this.db.transaction(async (tx) => {
      const [lockedItem] = await tx.select().from(mediaItems).where(eq(mediaItems.id, item.id)).for('update');
      const [lockedFile] = await tx.select().from(files).where(eq(files.id, file.id)).for('update');
      if (!lockedItem || !lockedFile) throw new NotFoundException('Cover upload not found.');
      if (lockedFile.status === 'ready') {
        if (lockedItem.coverFileId !== file.id) throw new ConflictException('That cover was already used.');
        return null;
      }
      const now = new Date();
      await tx.update(files).set({ status: 'ready', completedAt: now }).where(eq(files.id, file.id));
      await tx.update(mediaItems).set({ coverFileId: file.id, updatedAt: now }).where(eq(mediaItems.id, item.id));
      let old: Pick<FileRow, 'id' | 'storageKey'> | null = null;
      if (lockedItem.coverFileId) {
        [old] = await tx.delete(files).where(eq(files.id, lockedItem.coverFileId)).returning({ id: files.id, storageKey: files.storageKey });
      }
      await this.audit.record(tx, {
        actor: actorOf(actor),
        action: 'content.video.cover_set',
        target: { type: 'video', id: item.id, label: lockedItem.title },
        metadata: { fileId: file.id },
      });
      return old;
    });
    if (replaced) await discardStoredFile(this.storage, this.logger, { id: replaced.id, storageKey: replaced.storageKey, uploadId: null });
    return this.items.view(item.id, actor);
  }
}
```

Note: `lockedItem.coverFileId` still points at the old file when the old row is deleted, but the item row is updated to the new file first in the same transaction, so the foreign key holds (the update runs before the delete).

In `apps/api/src/media/items.service.ts` add `ConflictException` (already imported), and this method after `reorder`:

```ts
  async play(actor: AuthUser, itemId: string): Promise<{ url: string; expiresAt: string; contentType: string }> {
    const [row] = await this.rows(this.db, eq(mediaItems.id, itemId));
    if (!row || !visibleTo(row.item, actor)) throw new NotFoundException(NOT_FOUND);
    if (row.item.status !== 'ready') throw new ConflictException('This video is still uploading.');
    const url = await this.storage.presignGet(row.video.storageKey, LINK_TTL_SECONDS, { contentType: row.video.contentType });
    // Written only after the link exists, and every issued link is recorded (including a renewal while watching).
    await this.audit.record(this.db, {
      actor: actorOf(actor),
      action: 'playback.played',
      target: { type: 'video', id: itemId, label: row.item.title },
    });
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(), contentType: row.video.contentType };
  }
```

- [ ] **Step 3: Routes and module**

`apps/api/src/media/media.controller.ts`: inject `CoversService` and add (importing `CoversService`, `coverStartSchema`, `CoverStartInput`, and `HttpCode`):

```ts
  @Post('items/:id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.covers.start(actor, id, body);
  }

  @Post('items/:id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<ItemView> {
    return this.covers.complete(actor, id, fileId);
  }

  @Post('items/:id/play')
  @HttpCode(200)
  play(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.play(actor, id);
  }
```

`apps/api/src/media/media.module.ts`: add `CoversService` to `providers`.

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat: add cover images and playback links for videos"
```

---

### Task 9: Cleaning up abandoned uploads

**Files:**
- Create: `apps/api/src/media/upload-cleanup.service.ts`, `apps/api/src/cli/storage-cleanup.ts`
- Modify: `apps/api/src/media/media.module.ts`, `apps/api/package.json`
- Test: `apps/api/test/media-cleanup.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 4–8 (`discardStoredFile`, `PENDING_UPLOAD_MAX_AGE_MS`, helpers).
- Produces: `UploadCleanupService.run(now?: Date): Promise<{ removed: number }>`; hourly timer (not in tests); `npm run storage:cleanup -w @jbf/api`.

- [ ] **Step 1: Failing tests**

`apps/api/test/media-cleanup.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, files, mediaItems } from '../src/db/schema';
import { UploadCleanupService } from '../src/media/upload-cleanup.service';
import { bearer } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { completeViaApi, mp4Bytes, pngBytes, putPieces, seedFolder, seedItem, signIn, startUploadViaApi, uploadVideo } from './helpers/media';
import type { InMemoryStorage } from './support/in-memory-storage';

const HOUR = 3_600_000;

describe('cleaning up abandoned uploads', () => {
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
  const itemRow = async (itemId: string) => (await db.select().from(mediaItems).where(eq(mediaItems.id, itemId)))[0];

  async function setup() {
    const owner = await signIn(app, db);
    const folder = await seedFolder(db, owner.user.id);
    return { owner, folder };
  }

  it('removes a pending upload older than 24 hours, aborts it in storage and records why', async () => {
    const { owner, folder } = await setup();
    const started = await startUploadViaApi(app, owner.session, folder.id);
    await putPieces(app, storage, owner.session, started.fileId, mp4Bytes(100));
    await age(started.fileId, 25);
    const pending = storage.pendingUploadCount();

    const result = await cleanup.run();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await fileRow(started.fileId)).toBeUndefined();
    expect(await itemRow(started.itemId)).toBeUndefined();
    expect(storage.pendingUploadCount()).toBe(pending - 1);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'file.upload_failed'), eq(auditLog.targetId, started.itemId)));
    expect(entry).toMatchObject({ actorId: null, metadata: expect.objectContaining({ reason: 'expired' }) });
  });

  it('leaves recent uploads and ready videos alone', async () => {
    const { owner, folder } = await setup();
    const recent = await startUploadViaApi(app, owner.session, folder.id);
    await age(recent.fileId, 23);
    const ready = await uploadVideo(app, storage, owner.session, folder.id);
    await age(ready.fileId, 500);
    const readyKey = (await fileRow(ready.fileId)).storageKey;

    await cleanup.run();
    expect((await fileRow(recent.fileId)).status).toBe('pending');
    expect((await itemRow(ready.itemId)).status).toBe('ready');
    expect(storage.has(readyKey)).toBe(true);
  });

  it('is harmless to run twice', async () => {
    const { owner, folder } = await setup();
    const started = await startUploadViaApi(app, owner.session, folder.id);
    await age(started.fileId, 30);
    await cleanup.run();
    const second = await cleanup.run();
    expect(second.removed).toBe(0);
  });

  it('removes an abandoned cover file too', async () => {
    const { owner, folder } = await setup();
    const { itemId } = await seedItem(db, { folderId: folder.id, createdBy: owner.user.id, storage });
    const started = await http().post(`/api/media/items/${itemId}/cover`).set(...bearer(owner.session)).send({ contentType: 'image/png', sizeBytes: 100 }).expect(201);
    storage.putObject(started.body.url, pngBytes(100));
    const key = (await fileRow(started.body.fileId)).storageKey;
    await age(started.body.fileId, 48);
    await cleanup.run();
    expect(await fileRow(started.body.fileId)).toBeUndefined();
    expect(storage.has(key)).toBe(false);
    expect((await itemRow(itemId)).status).toBe('ready');
  });

  it('answers 404 to a later finish of a cleaned-up upload', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    await age(started.fileId, 26);
    await cleanup.run();
    await completeViaApi(app, owner.session, started.fileId, parts).expect(404);
  });

  it('never damages an upload that finishes at the same moment: it ends fully ready or fully gone', async () => {
    const { owner, folder } = await setup();
    const body = mp4Bytes(100);
    const started = await startUploadViaApi(app, owner.session, folder.id, { sizeBytes: body.length });
    const parts = await putPieces(app, storage, owner.session, started.fileId, body);
    const key = (await fileRow(started.fileId)).storageKey;
    await age(started.fileId, 26);
    const [finish] = await Promise.all([completeViaApi(app, owner.session, started.fileId, parts), cleanup.run()]);
    const item = await itemRow(started.itemId);
    if (item) {
      expect(finish.status).toBe(200);
      expect(item.status).toBe('ready');
      expect((await fileRow(started.fileId)).status).toBe('ready');
      expect(storage.has(key)).toBe(true);
    } else {
      expect([404, 409]).toContain(finish.status);
      expect(await fileRow(started.fileId)).toBeUndefined();
      expect(storage.has(key)).toBe(false);
    }
  });
});
```

Run: `npm test -w @jbf/api -- media-cleanup` → FAIL.

- [ ] **Step 2: The service**

`apps/api/src/media/upload-cleanup.service.ts`:

```ts
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { type FileRow, files, mediaItems } from '../db/schema';
import { PENDING_UPLOAD_MAX_AGE_MS } from '../storage/storage.constants';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { discardStoredFile } from './discard';

const INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Tests call run() directly; a background timer would only add noise to them.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runSafely(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<{ removed: number }> {
    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS);
    const stale = await this.db.select().from(files).where(and(eq(files.status, 'pending'), lt(files.createdAt, cutoff)));
    let removed = 0;
    for (const file of stale) {
      if (await this.expire(file)) {
        removed += 1;
        await discardStoredFile(this.storage, this.logger, file);
      }
    }
    return { removed };
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { removed } = await this.run();
      if (removed > 0) this.logger.log(`Removed ${removed} abandoned upload(s)`);
    } catch (error) {
      this.logger.error(`Cleanup of abandoned uploads failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  // Deletes the rows only if the file is still pending, so a video that finished a moment ago is never touched.
  private expire(file: FileRow): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (file.purpose === 'video') {
        const [item] = await tx
          .delete(mediaItems)
          .where(and(eq(mediaItems.videoFileId, file.id), eq(mediaItems.status, 'uploading')))
          .returning({ id: mediaItems.id, title: mediaItems.title });
        if (!item) return false;
        await tx.delete(files).where(eq(files.id, file.id));
        await this.audit.record(tx, {
          actor: null,
          action: 'file.upload_failed',
          target: { type: 'video', id: item.id, label: item.title },
          metadata: { fileId: file.id, reason: 'expired' },
        });
        return true;
      }
      const [gone] = await tx
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
        .returning({ id: files.id });
      if (!gone) return false;
      await this.audit.record(tx, {
        actor: null,
        action: 'file.upload_failed',
        target: { type: 'cover', id: file.id, label: 'a cover image' },
        metadata: { fileId: file.id, reason: 'expired' },
      });
      return true;
    });
  }
}
```

`apps/api/src/media/media.module.ts`: add `UploadCleanupService` to `providers`.

`apps/api/src/cli/storage-cleanup.ts`:

```ts
import '../config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UploadCleanupService } from '../media/upload-cleanup.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { removed } = await app.get(UploadCleanupService).run();
    console.log(`Removed ${removed} abandoned upload${removed === 1 ? '' : 's'}.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`apps/api/package.json` scripts: add `"storage:cleanup": "ts-node src/cli/storage-cleanup.ts",`. (Note: `createApplicationContext` runs `onModuleInit`, which starts the hourly timer; it is `unref`'d and cleared by `close()` so the process exits.)

- [ ] **Step 3: Run everything**

Run: `npm run lint && npm run build -w @jbf/api && npm test -w @jbf/api`
Expected: PASS. Then, as a smoke test only (no data is created), run `npm run storage:cleanup -w @jbf/api` against the development database: it must print `Removed 0 abandoned uploads.` and exit. If the development database is not migrated, run `npm run db:migrate -w @jbf/api` first.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api
git commit -m "feat: clean up abandoned uploads every hour and on demand"
```

---

## Web tasks (Tasks 10–13)

Conventions for every web task (they follow milestone 2): CSS Modules with tokens only (`var(--space-*)`, `var(--color-*)` and so on); the existing `Button`, `Dialog` (with `blocked` while a request runs), `ConfirmDialog`, `Alert`, `Badge`, `Table` (cells carry `data-label`), `EmptyState`, `Skeleton`, `TextField`, `Select`; errors shown with `describeError`; dialogs mount their form only while open; Vitest + Testing Library with `mockSession` / `renderWithSession` from `src/test/session.tsx`. Visible words come from the spec's section 8. The visual design was approved in the brainstorm (layout **B**, a table with small pictures, plus a corner progress panel); nothing in these tasks invents another look. `main.tsx` uses `StrictMode`, so effects that cause a server-side record (playing a video) must be guarded against the development double-run.

---

### Task 10: Web API client, formatting helpers, Videos navigation and the folders page

**Files:**
- Create: `apps/web/src/api/media.ts`, `apps/web/src/api/media.spec.ts`
- Create: `apps/web/src/pages/videos/{VideosPage.tsx,FolderDialog.tsx,Videos.module.css,VideosPage.spec.tsx}`
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.spec.ts`, `apps/web/src/components/nav-items.ts`, `apps/web/src/App.tsx`

**Interfaces:**
- Produces (`api/media.ts`):

```ts
interface Folder { id: string; name: string; position: number; itemCount: number }
interface VideoItem { id; folderId; title; description: string | null; durationSeconds: number | null; sizeBytes: number; status: 'uploading' | 'ready'; coverUrl: string | null; createdBy: { id: string; name: string }; createdAt: string; position: number }
interface StartedUpload { itemId: string; fileId: string; partSize: number; partCount: number }
interface UploadPart { partNumber: number; size: number; etag: string }
interface UploadStatus { fileId; itemId; status: 'pending' | 'ready'; partSize; partCount; uploadedParts: UploadPart[] }
interface PendingUpload { fileId; itemId; folderId; title; fileName; sizeBytes; createdAt: string }
interface PlayLink { url: string; expiresAt: string; contentType: string }
listFolders(); createFolder(name); renameFolder(id, name); reorderFolders(ids)
listItems(folderId); updateItem(id, { title?, description? }); reorderItems(folderId, ids); playItem(id)
startUpload(input); getPartUrls(fileId, partNumbers); getUploadStatus(fileId); completeUpload(fileId, parts); cancelUpload(fileId); listMyUploads(); uploadCover(itemId, file)
```

- Produces (`lib/format.ts`): `formatBytes(bytes: number): string` and `formatDuration(seconds: number | null): string`.
- Produces: `FolderDialog` with `FolderDialogMode = { kind: 'create' } | { kind: 'rename'; folder: Folder }`; route `/videos`; nav item "Videos".

- [ ] **Step 1: Failing tests**

Append to `apps/web/src/lib/format.spec.ts` (add the two names to its import):

```ts
describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [412 * 1024 ** 2, '412 MB'],
    [1_288_490_189, '1.2 GB'],
    [2 * 1024 ** 3, '2 GB'],
  ])('%i bytes is %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0:00'],
    [65, '1:05'],
    [724, '12:04'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('%s is %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
```

`apps/web/src/api/media.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { ApiError } from './client';
import {
  cancelUpload,
  completeUpload,
  createFolder,
  getPartUrls,
  getUploadStatus,
  listFolders,
  listItems,
  listMyUploads,
  playItem,
  renameFolder,
  reorderFolders,
  reorderItems,
  startUpload,
  updateItem,
  uploadCover,
} from './media';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function record(responses: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const method = init.method ?? 'GET';
    calls.push({
      method,
      url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const key = `${method} ${url}`;
    return key in responses ? { body: responses[key] } : { status: 204 };
  });
  return calls;
}

describe('media api', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('talks to the folder endpoints', async () => {
    const calls = record({ 'GET /api/media/videos/folders': [], 'POST /api/media/videos/folders': { id: 'f1' } });
    await listFolders();
    await createFolder('Safety');
    await renameFolder('f1', 'Safe');
    await reorderFolders(['b', 'a']);
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

  it('talks to the video endpoints', async () => {
    const calls = record();
    await listItems('f1');
    await updateItem('v1', { title: 'New' });
    await reorderItems('f1', ['v2', 'v1']);
    await playItem('v1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/media/folders/f1/items',
      'PATCH /api/media/items/v1',
      'PUT /api/media/folders/f1/items/order',
      'POST /api/media/items/v1/play',
    ]);
    expect(calls[1]?.body).toEqual({ title: 'New' });
    expect(calls[2]?.body).toEqual({ ids: ['v2', 'v1'] });
  });

  it('talks to the upload endpoints', async () => {
    const calls = record();
    await startUpload({ folderId: 'f1', title: 'T', description: '', fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 5, durationSeconds: null });
    await getPartUrls('u1', [1, 2]);
    await getUploadStatus('u1');
    await completeUpload('u1', [{ partNumber: 1, etag: '"a"' }]);
    await cancelUpload('u1');
    await listMyUploads();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/media/uploads',
      'POST /api/media/uploads/u1/part-urls',
      'GET /api/media/uploads/u1',
      'POST /api/media/uploads/u1/complete',
      'DELETE /api/media/uploads/u1',
      'GET /api/media/uploads/mine',
    ]);
    expect(calls[0]?.body).toMatchObject({ contentType: 'video/mp4', sizeBytes: 5, durationSeconds: null });
    expect(calls[1]?.body).toEqual({ partNumbers: [1, 2] });
    expect(calls[3]?.body).toEqual({ parts: [{ partNumber: 1, etag: '"a"' }] });
  });

  it('uploads a cover in three steps and sends the file straight to the returned link without the sign-in header', async () => {
    const cover = new File(['png'], 'cover.png', { type: 'image/png' });
    const calls = record({
      'POST /api/media/items/v1/cover': { fileId: 'c1', url: 'https://bucket.example/covers/x?sig=1', headers: { 'Content-Type': 'image/png' } },
      'POST /api/media/items/v1/cover/c1/complete': { id: 'v1' },
    });
    await uploadCover('v1', cover);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/media/items/v1/cover',
      'PUT https://bucket.example/covers/x?sig=1',
      'POST /api/media/items/v1/cover/c1/complete',
    ]);
    expect(calls[0]?.body).toEqual({ contentType: 'image/png', sizeBytes: cover.size });
    expect(calls[1]?.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(calls[1]?.body).toBe(cover);
  });

  it('stops without completing when the storage refuses the cover', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url === '/api/media/items/v1/cover') return { body: { fileId: 'c1', url: 'https://bucket.example/x', headers: { 'Content-Type': 'image/png' } } };
      return { status: 403, body: {} };
    });
    await expect(uploadCover('v1', new File(['x'], 'c.png', { type: 'image/png' }))).rejects.toBeInstanceOf(ApiError);
    expect(calls).toEqual(['POST /api/media/items/v1/cover', 'PUT https://bucket.example/x']);
  });
});
```

`apps/web/src/pages/videos/VideosPage.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '../../api/media';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { VideosPage } from './VideosPage';

const fixture: Folder[] = [
  { id: 'f1', name: 'Safety Training', position: 0, itemCount: 4 },
  { id: 'f2', name: 'Kitchen', position: 1, itemCount: 0 },
  { id: 'f3', name: '<img src=x onerror=alert(1)>', position: 2, itemCount: 1 },
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: Folder[] = fixture) {
  const state = { folders: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/media/videos/folders') return { body: state.folders };
    if (key === 'POST /api/media/videos/folders') {
      const folder = { id: 'f-new', name: String(body.name), position: state.folders.length, itemCount: 0 };
      state.folders.push(folder);
      return { status: 201, body: folder };
    }
    const rename = /^PATCH \/api\/media\/folders\/([^/]+)$/.exec(key);
    if (rename) {
      const folder = state.folders.find((candidate) => candidate.id === rename[1])!;
      folder.name = String(body.name);
      return { body: folder };
    }
    if (key === 'PUT /api/media/videos/folders/order') {
      const ids = body.ids as string[];
      state.folders = ids.map((id, index) => ({ ...state.folders.find((folder) => folder.id === id)!, position: index }));
      return { body: state.folders };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('VideosPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists the folders with their video counts and an Open link to each', async () => {
    startServer();
    renderWithSession(<VideosPage />);
    const table = await screen.findByRole('table', { name: 'Video folders' });
    const row = within(table).getByRole('row', { name: /Safety Training/ });
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open Safety Training' })).toHaveAttribute('href', '/videos/f1');
  });

  it('shows hostile folder names as plain text', async () => {
    startServer();
    renderWithSession(<VideosPage />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an empty state with a way forward', async () => {
    startServer({}, []);
    renderWithSession(<VideosPage />);
    expect(await screen.findByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText(/create a folder/i)).toBeInTheDocument();
  });

  it('offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/media/videos/folders': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<VideosPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Video folders' })).toBeInTheDocument();
  });

  it('creates a folder and shows it', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    await userEvent.type(within(dialog).getByLabelText('Folder name'), '  Orientation ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Folder "Orientation" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/media/videos/folders')?.body).toEqual({ name: 'Orientation' });
    expect(await screen.findByRole('link', { name: 'Open Orientation' })).toBeInTheDocument();
  });

  it('asks for a name before sending anything', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Enter a folder name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder name')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('keeps the dialog open and explains a name that already exists', async () => {
    startServer({ 'POST /api/media/videos/folders': { status: 409, body: { message: 'A folder with that name already exists.' } } });
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Kitchen');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
  });

  it('renames a folder, starting from its current name', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Kitchen' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename folder' });
    const field = within(dialog).getByLabelText('Folder name');
    expect(field).toHaveValue('Kitchen');
    await userEvent.clear(field);
    await userEvent.type(field, 'Canteen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Folder renamed to "Canteen".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/media/folders/f2')?.body).toEqual({ name: 'Canteen' });
  });

  it('moves a folder down and disables the moves that are not possible', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await screen.findByRole('table', { name: 'Video folders' });
    expect(screen.getByRole('button', { name: 'Move Safety Training up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move <img src=x onerror=alert(1)> down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Safety Training down' }));
    await screen.findByRole('button', { name: 'Move Safety Training up' });
    expect(calls.find((call) => call.key === 'PUT /api/media/videos/folders/order')?.body).toEqual({ ids: ['f2', 'f1', 'f3'] });
    const rows = within(screen.getByRole('table', { name: 'Video folders' })).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Open Kitchen' })).toBeInTheDocument();
  });

  it('reloads and says so when the order changed under you', async () => {
    startServer({ 'PUT /api/media/videos/folders/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Safety Training down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
  });
});
```

Run: `npm test -w @jbf/web -- format media VideosPage` → FAIL.

- [ ] **Step 2: Helpers and the API client**

`apps/web/src/lib/format.ts` (append):

```ts
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${BYTE_UNITS[unit]}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
```

`apps/web/src/api/media.ts`:

```ts
import { ApiError, api } from './client';

export interface Folder {
  id: string;
  name: string;
  position: number;
  itemCount: number;
}

export interface VideoItem {
  id: string;
  folderId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  status: 'uploading' | 'ready';
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  position: number;
}

export interface StartedUpload {
  itemId: string;
  fileId: string;
  partSize: number;
  partCount: number;
}

export interface UploadPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface UploadStatus {
  fileId: string;
  itemId: string;
  status: 'pending' | 'ready';
  partSize: number;
  partCount: number;
  uploadedParts: UploadPart[];
}

export interface PendingUpload {
  fileId: string;
  itemId: string;
  folderId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PlayLink {
  url: string;
  expiresAt: string;
  contentType: string;
}

export interface StartUploadInput {
  folderId: string;
  title: string;
  description: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export const listFolders = (): Promise<Folder[]> => api<Folder[]>('/api/media/videos/folders');

export const createFolder = (name: string): Promise<Folder> => api<Folder>('/api/media/videos/folders', { method: 'POST', body: { name } });

export const renameFolder = (id: string, name: string): Promise<Folder> =>
  api<Folder>(`/api/media/folders/${id}`, { method: 'PATCH', body: { name } });

export const reorderFolders = (ids: string[]): Promise<Folder[]> =>
  api<Folder[]>('/api/media/videos/folders/order', { method: 'PUT', body: { ids } });

export const listItems = (folderId: string): Promise<VideoItem[]> => api<VideoItem[]>(`/api/media/folders/${folderId}/items`);

export const updateItem = (id: string, input: { title?: string; description?: string }): Promise<VideoItem> =>
  api<VideoItem>(`/api/media/items/${id}`, { method: 'PATCH', body: input });

export const reorderItems = (folderId: string, ids: string[]): Promise<VideoItem[]> =>
  api<VideoItem[]>(`/api/media/folders/${folderId}/items/order`, { method: 'PUT', body: { ids } });

export const playItem = (id: string): Promise<PlayLink> => api<PlayLink>(`/api/media/items/${id}/play`, { method: 'POST' });

export const startUpload = (input: StartUploadInput): Promise<StartedUpload> =>
  api<StartedUpload>('/api/media/uploads', { method: 'POST', body: input });

export const getPartUrls = (fileId: string, partNumbers: number[]): Promise<{ urls: Record<string, string> }> =>
  api(`/api/media/uploads/${fileId}/part-urls`, { method: 'POST', body: { partNumbers } });

export const getUploadStatus = (fileId: string): Promise<UploadStatus> => api<UploadStatus>(`/api/media/uploads/${fileId}`);

export const completeUpload = (fileId: string, parts: { partNumber: number; etag: string }[]): Promise<VideoItem> =>
  api<VideoItem>(`/api/media/uploads/${fileId}/complete`, { method: 'POST', body: { parts } });

export const cancelUpload = (fileId: string): Promise<void> => api<void>(`/api/media/uploads/${fileId}`, { method: 'DELETE' });

export const listMyUploads = (): Promise<PendingUpload[]> => api<PendingUpload[]>('/api/media/uploads/mine');

// Three steps: ask for a one-time link, send the file straight to storage (no sign-in header: the link is the
// credential), then tell the API to check and attach it.
export async function uploadCover(itemId: string, file: File): Promise<VideoItem> {
  const started = await api<{ fileId: string; url: string; headers: Record<string, string> }>(`/api/media/items/${itemId}/cover`, {
    method: 'POST',
    body: { contentType: file.type, sizeBytes: file.size },
  });
  const response = await fetch(started.url, { method: 'PUT', headers: started.headers, body: file });
  if (!response.ok) throw new ApiError(response.status, 'The cover image could not be uploaded. Please try again.');
  return api<VideoItem>(`/api/media/items/${itemId}/cover/${started.fileId}/complete`, { method: 'POST' });
}
```

- [ ] **Step 3: Navigation, routes, styles and the folders page**

`apps/web/src/components/nav-items.ts`: add after the Dashboard entry:

```ts
  { to: '/videos', label: 'Videos', group: 'main' },
```

(No `end`, so the link stays highlighted on `/videos/:folderId`.)

`apps/web/src/App.tsx`: import `VideosPage` from `./pages/videos/VideosPage` and add, beside the other signed-in routes (outside `AdminRoute`): `<Route path="/videos" element={<VideosPage />} />`.

`apps/web/src/pages/videos/Videos.module.css` (shared by every videos component):

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

.crumbs {
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
}

.name {
  display: block;
  font-weight: 500;
  overflow-wrap: anywhere;
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

.videoCell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.cover,
.coverPlaceholder {
  flex: none;
  width: 44px;
  height: 28px;
  border-radius: 4px;
}

.cover {
  object-fit: cover;
  background: var(--color-surface);
}

.coverPlaceholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  color: var(--color-text-muted);
}

.titleButton {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 500;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.titleButton:focus-visible {
  outline: var(--focus-outline);
  outline-offset: 2px;
}

.clickable {
  cursor: pointer;
}

.video {
  width: 100%;
  max-height: 70vh;
  background: #000;
}

.description {
  margin: var(--space-3) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

`apps/web/src/pages/videos/FolderDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { createFolder, type Folder, renameFolder } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/TextField';
import styles from './Videos.module.css';

export type FolderDialogMode = { kind: 'create' } | { kind: 'rename'; folder: Folder };

interface FolderDialogProps {
  mode: FolderDialogMode | null;
  onClose: () => void;
  onSaved: (folder: Folder, kind: FolderDialogMode['kind']) => void;
}

export function FolderDialog({ mode, onClose, onSaved }: FolderDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={mode !== null} onClose={onClose} title={mode?.kind === 'rename' ? 'Rename folder' : 'New folder'} blocked={busy}>
      {mode ? <FolderForm mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function FolderForm({
  mode,
  busy,
  setBusy,
  onClose,
  onSaved,
}: Pick<FolderDialogProps, 'onClose' | 'onSaved'> & { mode: FolderDialogMode; busy: boolean; setBusy: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(mode.kind === 'rename' ? mode.folder.name : '');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so focus returns to the field even when the same error repeats.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!name.trim()) {
      setError('Enter a folder name.');
      setFocusRequest({});
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const saved = mode.kind === 'rename' ? await renameFolder(mode.folder.id, name) : await createFolder(name);
      onSaved(saved, mode.kind);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors.name) {
        setError(caught.fieldErrors.name.join(' '));
        setFocusRequest({});
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
        ref={inputRef}
        label="Folder name"
        autoComplete="off"
        maxLength={100}
        data-autofocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={error}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {mode.kind === 'rename' ? 'Save' : 'Create folder'}
        </Button>
      </div>
    </form>
  );
}
```

`apps/web/src/pages/videos/VideosPage.tsx`:

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
import { FolderDialog, type FolderDialogMode } from './FolderDialog';
import styles from './Videos.module.css';

type Notice = { tone: 'error' | 'success'; text: string };

export function VideosPage() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setFolders(await listFolders());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

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
      setFolders(await reorderFolders(ids));
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
        <h1>Videos</h1>
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
        <EmptyState title="No folders yet">Create a folder to start adding videos.</EmptyState>
      ) : (
        <Table caption="Video folders">
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">Videos</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((folder, index) => (
              <tr key={folder.id}>
                <td data-label="Folder">
                  <Link className={styles.name} to={`/videos/${folder.id}`}>
                    {folder.name}
                  </Link>
                </td>
                <td data-label="Videos">{folder.itemCount}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Link className={styles.link} to={`/videos/${folder.id}`} aria-label={`Open ${folder.name}`}>
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

      <FolderDialog mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
    </>
  );
}
```

(The row-name link and the "Open" link both go to the folder; the second exists so a keyboard or screen-reader user finds an explicit action in the Actions column, matching the Staff table. The test finds the Open link by its accessible name `Open <folder>`.)

- [ ] **Step 4: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. If a milestone 2 test that lists the sidebar links fails because "Videos" is new, update that test's expectation to include "Videos" (do not delete the assertion). In the test above `getByRole('link', { name: 'Open Safety Training' })` must find exactly one element (the name-link's accessible name is the folder name, not "Open …").

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the Videos folders page, media API client and size/length formatting"
```

---

### Task 11: A folder's videos: table, player, edit dialog, reorder

**Files:**
- Create: `apps/web/src/components/TextArea.tsx` (+ `TextArea.spec.tsx`), `apps/web/src/uploads/limits.ts` (+ `limits.spec.ts`)
- Create: `apps/web/src/pages/videos/{FolderPage.tsx,VideosTable.tsx,PlayerDialog.tsx,EditVideoDialog.tsx,FolderPage.spec.tsx}`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 10 (`api/media.ts`, `Videos.module.css`, `formatBytes`, `formatDuration`, `formatDate`).
- Produces:

```ts
// uploads/limits.ts
MAX_VIDEO_BYTES = 2 * 1024 ** 3; MAX_COVER_BYTES = 10 * 1024 ** 2; MP4_HELP: string
checkVideoFile(file: File): string | null; checkCoverFile(file: File): string | null     // plain-words problem, or null
// VideosTable props
{ items: VideoItem[]; busy: boolean; progress: Record<string, number>   /* itemId -> percent while uploading here */;
  onOpen(item): void; onEdit(item): void; onMove(item, delta: -1 | 1): void }
// PlayerDialog props: { item: VideoItem | null; onClose(): void }
// EditVideoDialog props: { item: VideoItem | null; onClose(): void; onChanged(): void }
// route: /videos/:folderId
```

- [ ] **Step 1: Failing tests**

`apps/web/src/uploads/limits.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkCoverFile, checkVideoFile, MAX_COVER_BYTES, MAX_VIDEO_BYTES, MP4_HELP } from './limits';

const file = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

describe('checkVideoFile', () => {
  it('accepts an MP4 up to exactly 2 GB', () => {
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 1))).toBeNull();
    expect(checkVideoFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toBeNull();
  });

  it('accepts an .mp4 whose type the system did not report', () => {
    expect(checkVideoFile(file('Clip.MP4', '', 10))).toBeNull();
  });

  it('explains how to convert anything else', () => {
    for (const bad of [file('a.mov', 'video/quicktime', 10), file('a.webm', 'video/webm', 10), file('a.txt', '', 10), file('a.mp4.exe', '', 10)]) {
      expect(checkVideoFile(bad)).toBe(MP4_HELP);
    }
    expect(MP4_HELP).toMatch(/HandBrake/);
  });

  it('refuses an empty file and a file over 2 GB', () => {
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 0))).toMatch(/empty/i);
    expect(checkVideoFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/at most 2 GB/);
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

`apps/web/src/components/TextArea.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextArea } from './TextArea';

describe('TextArea', () => {
  it('ties its label, hint and error to the field', () => {
    render(<TextArea label="Description" hint="Optional." error="Too long." />);
    const field = screen.getByLabelText('Description');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Optional. Too long.');
  });
});
```

`apps/web/src/pages/videos/FolderPage.spec.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, VideoItem } from '../../api/media';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { FolderPage } from './FolderPage';

const folder: Folder = { id: 'f1', name: 'Safety Training', position: 0, itemCount: 3 };
const item = (overrides: Partial<VideoItem> & { id: string; title: string }): VideoItem => ({
  folderId: 'f1',
  description: null,
  durationSeconds: 724,
  sizeBytes: 412 * 1024 ** 2,
  status: 'ready',
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-08T10:00:00Z',
  position: 0,
  ...overrides,
});
const fixture: VideoItem[] = [
  item({ id: 'v1', title: 'Fire exits', description: 'Where to go.', coverUrl: 'https://cdn.example/c1?sig=1' }),
  item({ id: 'v2', title: 'First aid basics', durationSeconds: null, sizeBytes: 280 * 1024 ** 2, position: 1 }),
  item({ id: 'v3', title: '<b>Kitchen</b> hygiene', position: 2, status: 'uploading', createdBy: { id: 'staff-1', name: 'Ben Okoye' } }),
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, items: VideoItem[] = fixture, folders: Folder[] = [folder]) {
  const state = { items: structuredClone(items) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/media/videos/folders') return { body: folders };
    if (key === 'GET /api/media/folders/f1/items') return { body: state.items };
    const edit = /^PATCH \/api\/media\/items\/([^/]+)$/.exec(key);
    if (edit) {
      const target = state.items.find((candidate) => candidate.id === edit[1])!;
      Object.assign(target, body);
      return { body: target };
    }
    if (key === 'PUT /api/media/folders/f1/items/order') {
      const ids = body.ids as string[];
      const ready = ids.map((id) => state.items.find((candidate) => candidate.id === id)!);
      state.items = [...ready, ...state.items.filter((candidate) => !ids.includes(candidate.id))];
      return { body: state.items };
    }
    if (key === 'POST /api/media/items/v1/play') {
      return { body: { url: 'https://cdn.example/video-1?sig=1', expiresAt: '2026-10-08T11:00:00Z', contentType: 'video/mp4' } };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

function renderPage(route = '/videos/f1') {
  return renderWithSession(
    <Routes>
      <Route path="/videos/:folderId" element={<FolderPage />} />
    </Routes>,
    route,
  );
}

describe('FolderPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the folder name, a way back, and the videos with length, size, adder and date', async () => {
    startServer();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Safety Training' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Videos');
    expect(screen.getByRole('link', { name: 'Videos' })).toHaveAttribute('href', '/videos');
    const row = screen.getByRole('row', { name: /Fire exits/ });
    expect(within(row).getByText('12:04')).toBeInTheDocument();
    expect(within(row).getByText('412 MB')).toBeInTheDocument();
    expect(within(row).getByText(/Anita Rao/)).toBeInTheDocument();
  });

  it('shows a cover picture where there is one and a placeholder where there is not', async () => {
    startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    const pictures = document.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toHaveAttribute('src', 'https://cdn.example/c1?sig=1');
    expect(pictures[0]).toHaveAttribute('alt', '');
  });

  it('shows your uploading video with a badge, no actions, and hostile text as plain text', async () => {
    startServer();
    renderPage();
    const row = (await screen.findByText('<b>Kitchen</b> hygiene')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Uploading')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says so when the folder is empty, and when it does not exist', async () => {
    startServer({}, []);
    const first = renderPage();
    expect(await screen.findByText('No videos in this folder yet')).toBeInTheDocument();
    first.unmount();

    startServer({ 'GET /api/media/folders/f1/items': { status: 404, body: { message: 'Folder not found.' } } });
    renderPage();
    expect(await screen.findByText('Folder not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Videos' })).toHaveAttribute('href', '/videos');
  });

  it('offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/media/folders/f1/items': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Safety Training' })).toBeInTheDocument();
  });

  it('opens the player from the title or from the row, and asks for a playback link once', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fire exits' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-1?sig=1'));
    expect(within(dialog).getByText('Where to go.')).toBeInTheDocument();
    expect(calls.filter((call) => call.key === 'POST /api/media/items/v1/play')).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('video')).toBeNull());

    await userEvent.click(screen.getByText('12:04'));
    expect(await screen.findByRole('dialog', { name: 'Fire exits' })).toBeInTheDocument();
  });

  it('edits the title and description and shows the result', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    const title = within(dialog).getByLabelText('Title');
    expect(title).toHaveValue('Fire exits');
    await userEvent.clear(title);
    await userEvent.type(title, 'Fire exits and drills');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Fire exits and drills' })).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/media/items/v1')?.body).toEqual({ title: 'Fire exits and drills' });
  });

  it('refuses an empty title and an unsuitable cover without calling the server', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'cover.gif', { type: 'image/gif' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('PATCH') || call.key.includes('/cover'))).toBe(false);
  });

  it('shows a server refusal inside the dialog and keeps it open', async () => {
    startServer({ 'PATCH /api/media/items/v1': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    await userEvent.type(within(dialog).getByLabelText('Title'), ' more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
  });

  it('moves a ready video down and sends only the ready videos, disabling impossible moves', async () => {
    const calls = startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    expect(screen.getByRole('button', { name: 'Move Fire exits up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move First aid basics down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Fire exits down' }));
    await waitFor(() => expect(calls.find((call) => call.key === 'PUT /api/media/folders/f1/items/order')?.body).toEqual({ ids: ['v2', 'v1'] }));
    expect(await screen.findByRole('button', { name: 'Move Fire exits up' })).not.toBeDisabled();
  });

  it('reloads and explains when the order changed under you', async () => {
    startServer({ 'PUT /api/media/folders/f1/items/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move Fire exits down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
  });

  it('asks once for a fresh link when the video stops loading, then gives up with a message', async () => {
    let plays = 0;
    startServer({
      'POST /api/media/items/v1/play': () => {
        plays += 1;
        return { body: { url: `https://cdn.example/video-${plays}?sig=1`, expiresAt: '2026-10-08T11:00:00Z', contentType: 'video/mp4' } };
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fire exits' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-1?sig=1'));
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-2?sig=1'));
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be played');
    expect(plays).toBe(2);
  });
});
```

Run: `npm test -w @jbf/web -- limits TextArea FolderPage` → FAIL.

- [ ] **Step 2: Limits and the text area**

`apps/web/src/uploads/limits.ts`:

```ts
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MP4_HELP = 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Returns a plain-words problem, or null when the file is fine. The server checks everything again.
export function checkVideoFile(file: File): string | null {
  const isMp4 = file.type === 'video/mp4' || (file.type === '' && /\.mp4$/i.test(file.name));
  if (!isMp4) return MP4_HELP;
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_VIDEO_BYTES) return 'Videos can be at most 2 GB. Choose a smaller file or compress it first.';
  return null;
}

export function checkCoverFile(file: File): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_COVER_BYTES) return 'Covers can be at most 10 MB.';
  return null;
}
```

`apps/web/src/components/TextArea.tsx`:

```tsx
import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';
import { useFieldIds } from './use-field-ids';

type TextAreaProps = ComponentPropsWithRef<'textarea'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextArea({ label, hint, error, id, rows = 4, ...rest }: TextAreaProps) {
  const { inputId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <textarea {...rest} id={inputId} rows={rows} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
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

- [ ] **Step 3: The table, player and edit dialog**

`apps/web/src/pages/videos/VideosTable.tsx`:

```tsx
import type { VideoItem } from '../../api/media';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import styles from './Videos.module.css';

interface VideosTableProps {
  items: VideoItem[];
  busy: boolean;
  // Percent sent for videos being uploaded from this browser right now, by item id.
  progress: Record<string, number>;
  onOpen: (item: VideoItem) => void;
  onEdit: (item: VideoItem) => void;
  onMove: (item: VideoItem, delta: -1 | 1) => void;
}

export function VideosTable({ items, busy, progress, onOpen, onEdit, onMove }: VideosTableProps) {
  // Only ready videos can be ordered; a video that is still uploading keeps its place until it finishes.
  const ready = items.filter((item) => item.status === 'ready');

  return (
    <Table caption="Videos in this folder">
      <thead>
        <tr>
          <th scope="col">Video</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Added</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isReady = item.status === 'ready';
          const readyIndex = ready.indexOf(item);
          const percent = progress[item.id];
          return (
            <tr key={item.id} className={isReady ? styles.clickable : undefined} onClick={isReady ? () => onOpen(item) : undefined}>
              <td data-label="Video">
                <div className={styles.videoCell}>
                  {item.coverUrl ? (
                    <img className={styles.cover} src={item.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.coverPlaceholder} aria-hidden="true">
                      {isReady ? '▶' : '⏳'}
                    </span>
                  )}
                  <div>
                    {isReady ? (
                      <button type="button" className={styles.titleButton} onClick={() => onOpen(item)}>
                        {item.title}
                      </button>
                    ) : (
                      <>
                        <span className={styles.name}>{item.title}</span>
                        <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>
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

`apps/web/src/pages/videos/PlayerDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { playItem, type VideoItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import { formatDate } from '../../lib/format';
import styles from './Videos.module.css';

const PLAYBACK_FAILED = 'This video could not be played. Please try again later.';

export function PlayerDialog({ item, onClose }: { item: VideoItem | null; onClose: () => void }) {
  return (
    <Dialog open={item !== null} onClose={onClose} title={item?.title ?? 'Video'}>
      {item ? <Player item={item} /> : null}
    </Dialog>
  );
}

function Player({ item }: { item: VideoItem }) {
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
      setSrc((await playItem(item.id)).url);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [item.id]);

  useEffect(() => {
    if (requestedFor.current === item.id) return;
    requestedFor.current = item.id;
    void fetchLink();
  }, [item.id, fetchLink]);

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
    const video = videoRef.current;
    if (!video || resumeAt.current <= 0) return;
    video.currentTime = resumeAt.current;
    resumeAt.current = 0;
    void video.play().catch(() => undefined);
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
      {item.description ? <p className={styles.description}>{item.description}</p> : null}
      <p className={styles.muted}>
        Added by {item.createdBy.name} · {formatDate(item.createdAt)}
      </p>
    </>
  );
}
```

`apps/web/src/pages/videos/EditVideoDialog.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { updateItem, uploadCover, type VideoItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { checkCoverFile } from '../../uploads/limits';
import styles from './Videos.module.css';

interface EditVideoDialogProps {
  item: VideoItem | null;
  onClose: () => void;
  // Called whenever something was saved, even if a later step failed, so the list never shows stale data.
  onChanged: () => void;
}

export function EditVideoDialog({ item, onClose, onChanged }: EditVideoDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={item !== null} onClose={onClose} title="Edit video" blocked={busy}>
      {item ? <EditForm item={item} busy={busy} setBusy={setBusy} onClose={onClose} onChanged={onChanged} /> : null}
    </Dialog>
  );
}

type Errors = { title?: string; description?: string; cover?: string };

function EditForm({
  item,
  busy,
  setBusy,
  onClose,
  onChanged,
}: Pick<EditVideoDialogProps, 'onClose' | 'onChanged'> & { item: VideoItem; busy: boolean; setBusy: (busy: boolean) => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'title' | 'cover' } | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.field === 'title' ? titleRef : coverRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next: Errors = {
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    if (next.title || next.cover) {
      setFocusRequest({ field: next.title ? 'title' : 'cover' });
      return;
    }

    const changes: { title?: string; description?: string } = {};
    if (title.trim() !== item.title) changes.title = title;
    if (description.trim() !== (item.description ?? '')) changes.description = description;
    setBusy(true);
    let saved = false;
    try {
      if (Object.keys(changes).length > 0) {
        await updateItem(item.id, changes);
        saved = true;
      }
      if (cover) {
        await uploadCover(item.id, cover);
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
      <TextField ref={titleRef} label="Title" autoComplete="off" maxLength={200} data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <TextArea label="Description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <TextField
        ref={coverRef}
        label="Cover image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hint={item.coverUrl ? 'Choosing a file replaces the current cover. JPEG, PNG or WebP, up to 10 MB.' : 'Optional. JPEG, PNG or WebP, up to 10 MB.'}
        onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        error={errors.cover}
      />
      <div className={styles.dialogActions}>
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

- [ ] **Step 4: The folder page and its route**

`apps/web/src/pages/videos/FolderPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, describeError } from '../../api/client';
import { type Folder, listFolders, listItems, reorderItems, type VideoItem } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { EditVideoDialog } from './EditVideoDialog';
import { PlayerDialog } from './PlayerDialog';
import styles from './Videos.module.css';
import { VideosTable } from './VideosTable';

type Notice = { tone: 'error' | 'success'; text: string };

export function FolderPage() {
  const { folderId = '' } = useParams();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const [editing, setEditing] = useState<VideoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const [folders, loaded] = await Promise.all([listFolders(), listItems(folderId)]);
      const found = folders.find((candidate) => candidate.id === folderId) ?? null;
      setMissing(found === null);
      setFolder(found);
      setItems(loaded);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setMissing(true);
      else setLoadError(describeError(error));
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(item: VideoItem, delta: -1 | 1) {
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

  if (missing) {
    return (
      <EmptyState title="Folder not found">
        <Link to="/videos">Back to Videos</Link>
      </EmptyState>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to="/videos">Videos</Link> › {folder?.name ?? ''}
      </nav>
      <div className={styles.header}>
        <h1>{folder?.name ?? 'Folder'}</h1>
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
        <EmptyState title="No videos in this folder yet">Videos you upload here will appear in this list.</EmptyState>
      ) : (
        <VideosTable items={items} busy={busy} progress={{}} onOpen={setPlaying} onEdit={setEditing} onMove={(item, delta) => void move(item, delta)} />
      )}

      <PlayerDialog item={playing} onClose={() => setPlaying(null)} />
      <EditVideoDialog
        item={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setNotice({ tone: 'success', text: 'Video saved.' });
          void load();
        }}
      />
    </>
  );
}
```

`apps/web/src/App.tsx`: import `FolderPage` and add `<Route path="/videos/:folderId" element={<FolderPage />} />` next to the `/videos` route.

(The heading shows "Folder" until the first load completes; the tests wait for the real name. `progress={{}}` is replaced by real data in Task 13.)

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. Notes for the implementer: `userEvent.upload` with an `accept` attribute filters files that do not match; the test above passes `{ applyAccept: false }` so the gif reaches the component's own check. `getByRole('row', { name: /Fire exits/ })` relies on the row's accessible name being its cell text. If the `<video>` `error` handler is not reached by `fireEvent.error`, dispatch it with `fireEvent(video, new Event('error'))`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "feat: show a folder's videos with a player, edit dialog and reordering"
```

---

### Task 12: The upload engine and the app-wide upload manager with its progress panel

**Files:**
- Create: `apps/web/src/uploads/{engine.ts,engine.spec.ts,xhr.ts,xhr.spec.ts,browser-deps.ts,browser-deps.spec.ts,duration.ts,duration.spec.ts,describe-upload-error.ts,describe-upload-error.spec.ts,UploadsContext.tsx,UploadsContext.spec.tsx,UploadPanel.tsx,UploadPanel.module.css,UploadPanel.spec.tsx}`
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/AppShell.spec.tsx`

**Interfaces:**
- Consumes: Task 10 (`api/media.ts`), `ApiError`/`describeError`, `formatBytes`.
- Produces:

```ts
// engine.ts
interface Receipt { partNumber: number; etag: string }
interface EngineDeps { getPartUrl(partNumber): Promise<string>; sendPart(url, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string>;
  sleep(ms, signal): Promise<void>; isOnline(): boolean; waitForOnline(signal): Promise<void> }
interface EngineInput { file: Blob; partSize: number; partCount: number; already: ReadonlyMap<number, string>; concurrency: number; maxAttempts: number; signal: AbortSignal; onProgress(bytesSent: number): void }
uploadPieces(input: EngineInput, deps: EngineDeps): Promise<Receipt[]>      // sorted by piece number
class PieceFailedError extends Error { partNumber: number; cause: unknown }
backoffMs(failedAttempt: number): number                                       // 1000, 2000, 4000, 8000 ... capped at 30000
// xhr.ts
sendPiece(url, body, onProgress, signal): Promise<string /*ETag*/>; class HttpPieceError { status }; class MissingReceiptError
// browser-deps.ts
createBrowserDeps(fileId: string): EngineDeps
// duration.ts
readDuration(file: File): Promise<number | null>
// describe-upload-error.ts
describeUploadError(error: unknown): string
// UploadsContext.tsx
type UploadStatus = 'sending' | 'finishing' | 'done' | 'failed'
interface UploadJob { id: string /* file id */; itemId; folderId; title; fileName; sizeBytes; bytesSent; status: UploadStatus; message: string | null; coverWarning: boolean }
interface StartInput { file: File; folderId: string; title: string; description: string; durationSeconds: number | null; cover: File | null }
interface UploadsValue { jobs: UploadJob[]; finishedCount: number; start(input: StartInput): Promise<void>; resume(pending: PendingUpload, file: File): Promise<void>;
  retry(id: string): Promise<void>; cancel(id: string): Promise<void>; dismiss(id: string): void }
UploadsContext, UploadsProvider, useUploads(); class FileMismatchError extends Error
// UploadPanel.tsx: <UploadPanel /> (renders nothing when there are no jobs)
```

- [ ] **Step 1: Failing tests for the engine**

`apps/web/src/uploads/engine.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { backoffMs, type EngineDeps, type EngineInput, PieceFailedError, uploadPieces } from './engine';

const MB = 1024 * 1024;

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps & { sent: number[]; sizes: Map<number, number> } {
  const sent: number[] = [];
  const sizes = new Map<number, number>();
  const urls = new Map<string, number>();
  return {
    sent,
    sizes,
    getPartUrl: async (partNumber) => {
      const url = `https://storage.test/part/${partNumber}/${urls.size}`;
      urls.set(url, partNumber);
      return url;
    },
    sendPart: async (url, body, onProgress) => {
      const partNumber = urls.get(url) as number;
      sent.push(partNumber);
      sizes.set(partNumber, body.size);
      onProgress(body.size);
      return `"etag-${partNumber}"`;
    },
    sleep: async () => undefined,
    isOnline: () => true,
    waitForOnline: async () => undefined,
    ...overrides,
  };
}

const input = (overrides: Partial<EngineInput> = {}): EngineInput => ({
  file: new Blob([new Uint8Array(40 * MB)]),
  partSize: 16 * MB,
  partCount: 3,
  already: new Map(),
  concurrency: 3,
  maxAttempts: 5,
  signal: new AbortController().signal,
  onProgress: () => undefined,
  ...overrides,
});

describe('backoffMs', () => {
  it('grows from one second and stops at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('uploadPieces', () => {
  it('cuts the file into full pieces and a smaller last one, and returns the receipts in order', async () => {
    const deps = makeDeps();
    const receipts = await uploadPieces(input(), deps);
    expect(receipts).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect([...deps.sizes.entries()].sort()).toEqual([[1, 16 * MB], [2, 16 * MB], [3, 8 * MB]]);
  });

  it('never sends more pieces at once than allowed', async () => {
    let active = 0;
    let peak = 0;
    const deps = makeDeps({
      sendPart: async (_url, body, onProgress) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        onProgress(body.size);
        active -= 1;
        return '"e"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(100 * MB)]), partCount: 7 }), deps);
    expect(peak).toBe(3);
  });

  it('skips pieces the server already has and counts their bytes from the start', async () => {
    const deps = makeDeps();
    const progress: number[] = [];
    const receipts = await uploadPieces(input({ already: new Map([[1, '"old-1"'], [3, '"old-3"']]), onProgress: (bytes) => progress.push(bytes) }), deps);
    expect(deps.sent).toEqual([2]);
    expect(progress[0]).toBe(16 * MB + 8 * MB);
    expect(progress.at(-1)).toBe(40 * MB);
    expect(receipts.map((receipt) => receipt.etag)).toEqual(['"old-1"', '"etag-2"', '"old-3"']);
  });

  it('reports bytes sent, never more than the file and ending at the whole file', async () => {
    const progress: number[] = [];
    await uploadPieces(input({ onProgress: (bytes) => progress.push(bytes) }), makeDeps());
    expect(Math.max(...progress)).toBe(40 * MB);
    expect(progress.every((bytes) => bytes >= 0 && bytes <= 40 * MB)).toBe(true);
    expect(progress.at(-1)).toBe(40 * MB);
  });

  it('asks for a fresh link on every attempt, waits longer each time, and then succeeds', async () => {
    let failures = 0;
    const sleeps: number[] = [];
    const getPartUrl = vi.fn(async (partNumber: number) => `https://storage.test/${partNumber}/${failures}`);
    const deps = makeDeps({
      getPartUrl,
      sleep: async (ms) => void sleeps.push(ms),
      sendPart: async (_url, body, onProgress) => {
        if (failures < 4) {
          failures += 1;
          throw new Error('network');
        }
        onProgress(body.size);
        return '"ok"';
      },
    });
    await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(getPartUrl).toHaveBeenCalledTimes(5);
  });

  it('gives up after five failed attempts with an error that names the piece', async () => {
    const sleeps: number[] = [];
    const deps = makeDeps({
      sleep: async (ms) => void sleeps.push(ms),
      sendPart: async () => {
        throw new Error('network');
      },
    });
    const failure = await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PieceFailedError);
    expect((failure as PieceFailedError).partNumber).toBe(1);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it('waits for the network instead of using up attempts while offline', async () => {
    let online = false;
    let attempts = 0;
    let waited = 0;
    const deps = makeDeps({
      isOnline: () => online,
      waitForOnline: async () => {
        waited += 1;
        online = true;
      },
      sendPart: async (_url, body, onProgress) => {
        attempts += 1;
        if (attempts <= 7) {
          online = false;
          throw new Error('offline');
        }
        onProgress(body.size);
        return '"ok"';
      },
    });
    const receipts = await uploadPieces(input({ file: new Blob([new Uint8Array(5)]), partCount: 1 }), deps);
    expect(receipts).toEqual([{ partNumber: 1, etag: '"ok"' }]);
    expect(waited).toBeGreaterThanOrEqual(8);
  });

  it('stops everything when asked, without sending further pieces', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      sendPart: async (_url, _body, _onProgress, signal) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        throw new DOMException('Aborted', 'AbortError');
      },
    });
    await expect(uploadPieces(input({ signal: controller.signal }), deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.sent).toEqual([]);
  });

  it('stops the other pieces when one piece cannot be sent', async () => {
    const started: number[] = [];
    const deps = makeDeps({
      sendPart: async (url, body, onProgress, signal) => {
        const partNumber = Number(/part\/(\d+)\//.exec(url)?.[1]);
        started.push(partNumber);
        if (partNumber === 1) throw new Error('boom');
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          setTimeout(resolve, 50);
        });
        onProgress(body.size);
        return '"e"';
      },
    });
    const failure = await uploadPieces(input({ maxAttempts: 1, concurrency: 2, partCount: 5, file: new Blob([new Uint8Array(70 * MB)]) }), deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PieceFailedError);
    expect(started).not.toContain(4);
    expect(started).not.toContain(5);
  });
});
```

(The `getPartUrl` in `makeDeps` encodes the piece number as `part/<n>/<k>` so the fake `sendPart` can tell which piece it received; the same convention is used by the last test.)

Run: `npm test -w @jbf/web -- engine` → FAIL.

- [ ] **Step 2: Implement the engine**

`apps/web/src/uploads/engine.ts`:

```ts
export interface Receipt {
  partNumber: number;
  etag: string;
}

export interface EngineDeps {
  getPartUrl(partNumber: number): Promise<string>;
  sendPart(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  isOnline(): boolean;
  waitForOnline(signal: AbortSignal): Promise<void>;
}

export interface EngineInput {
  file: Blob;
  partSize: number;
  partCount: number;
  // Pieces the server already holds (piece number to receipt); they are not sent again.
  already: ReadonlyMap<number, string>;
  concurrency: number;
  maxAttempts: number;
  signal: AbortSignal;
  onProgress: (bytesSent: number) => void;
}

export class PieceFailedError extends Error {
  constructor(
    readonly partNumber: number,
    cause: unknown,
  ) {
    super(`Piece ${partNumber} could not be sent`, { cause });
  }
}

// After the first failure wait one second, then two, four, eight ... never more than thirty.
export const backoffMs = (failedAttempt: number): number => Math.min(30_000, 1000 * 2 ** (failedAttempt - 1));

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

export async function uploadPieces(input: EngineInput, deps: EngineDeps): Promise<Receipt[]> {
  const { file, partSize, partCount, already, concurrency, maxAttempts, onProgress } = input;
  const pieceBytes = (partNumber: number): number => Math.min(partSize, file.size - (partNumber - 1) * partSize);

  const receipts = new Map<number, string>(already);
  const inFlight = new Map<number, number>();
  let finishedBytes = 0;
  for (const partNumber of already.keys()) finishedBytes += pieceBytes(partNumber);
  const report = (): void => {
    let sending = 0;
    for (const loaded of inFlight.values()) sending += loaded;
    onProgress(finishedBytes + sending);
  };
  report();

  const queue: number[] = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!already.has(partNumber)) queue.push(partNumber);
  }

  // One signal for the pieces in flight: stopped by the caller, or by the first piece that cannot be sent.
  const stopper = new AbortController();
  const stop = (): void => stopper.abort();
  if (input.signal.aborted) stop();
  input.signal.addEventListener('abort', stop, { once: true });
  let failure: unknown = null;

  async function sendOne(partNumber: number): Promise<void> {
    let attempts = 0;
    for (;;) {
      if (stopper.signal.aborted) throw abortError();
      if (!deps.isOnline()) await deps.waitForOnline(stopper.signal);
      attempts += 1;
      try {
        // A fresh link for every attempt: links last an hour and a long upload can outlive one.
        const url = await deps.getPartUrl(partNumber);
        const body = file.slice((partNumber - 1) * partSize, partNumber * partSize);
        inFlight.set(partNumber, 0);
        report();
        const etag = await deps.sendPart(url, body, (loaded) => {
          inFlight.set(partNumber, loaded);
          report();
        }, stopper.signal);
        inFlight.delete(partNumber);
        finishedBytes += body.size;
        receipts.set(partNumber, etag);
        report();
        return;
      } catch (error) {
        inFlight.delete(partNumber);
        report();
        if (stopper.signal.aborted) throw error;
        // Losing the network is not the piece's fault: wait for it to come back without using up an attempt.
        if (!deps.isOnline()) {
          attempts -= 1;
          continue;
        }
        if (attempts >= maxAttempts) throw new PieceFailedError(partNumber, error);
        await deps.sleep(backoffMs(attempts), stopper.signal);
      }
    }
  }

  async function worker(): Promise<void> {
    while (!stopper.signal.aborted) {
      const partNumber = queue.shift();
      if (partNumber === undefined) return;
      try {
        await sendOne(partNumber);
      } catch (error) {
        failure ??= error;
        stop();
        return;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } finally {
    input.signal.removeEventListener('abort', stop);
  }
  if (failure !== null) throw failure;
  if (input.signal.aborted) throw abortError();
  return [...receipts.entries()].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber);
}
```

Run: `npm test -w @jbf/web -- engine` → PASS. (If the offline test never terminates, the loop is not decrementing `attempts` on the offline path; fix the engine, not the test.)

- [ ] **Step 3: Tests and code for the browser pieces (XHR, waiting, duration, error text)**

`apps/web/src/uploads/xhr.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPieceError, MissingReceiptError, sendPiece } from './xhr';

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  sent: unknown = null;
  aborted = false;
  status = 0;
  timeout = 0;
  headers: Record<string, string> = {};
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  getResponseHeader(name: string) {
    return name.toLowerCase() === 'etag' ? this.headers.etag ?? null : null;
  }
}

describe('sendPiece', () => {
  beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr));
  afterEach(() => vi.unstubAllGlobals());

  const blob = new Blob(['abc']);

  it('PUTs the piece, reports progress and resolves with the receipt', async () => {
    const progress: number[] = [];
    const done = sendPiece('https://s.test/p', blob, (loaded) => progress.push(loaded), new AbortController().signal);
    const xhr = FakeXhr.last;
    expect([xhr.method, xhr.url, xhr.sent]).toEqual(['PUT', 'https://s.test/p', blob]);
    xhr.upload.onprogress?.({ loaded: 2 });
    xhr.upload.onprogress?.({ loaded: 3 });
    xhr.status = 200;
    xhr.headers.etag = '"abc123"';
    xhr.onload?.();
    await expect(done).resolves.toBe('"abc123"');
    expect(progress).toEqual([2, 3]);
  });

  it('rejects with the status when the storage refuses', async () => {
    const done = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(done).rejects.toMatchObject({ status: 403 });
    await expect(done).rejects.toBeInstanceOf(HttpPieceError);
  });

  it('explains a missing receipt (the usual sign of wrong browser permissions on the bucket)', async () => {
    const done = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.status = 200;
    FakeXhr.last.onload?.();
    await expect(done).rejects.toBeInstanceOf(MissingReceiptError);
  });

  it('rejects on network errors and timeouts', async () => {
    const first = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.onerror?.();
    await expect(first).rejects.toThrow(/network/i);
    const second = sendPiece('https://s.test/p', blob, () => undefined, new AbortController().signal);
    FakeXhr.last.ontimeout?.();
    await expect(second).rejects.toThrow(/too long/i);
  });

  it('stops the request when asked, and never starts one that is already cancelled', async () => {
    const controller = new AbortController();
    const done = sendPiece('https://s.test/p', blob, () => undefined, controller.signal);
    controller.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    const before = FakeXhr.last;
    await expect(sendPiece('https://s.test/p', blob, () => undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last).toBe(before);
  });
});
```

`apps/web/src/uploads/xhr.ts`:

```ts
export class HttpPieceError extends Error {
  constructor(readonly status: number) {
    super(`The storage answered ${status}`);
  }
}

export class MissingReceiptError extends Error {
  constructor() {
    super('The storage did not return a receipt (ETag) for the piece');
  }
}

const PIECE_TIMEOUT_MS = 10 * 60 * 1000;

// XMLHttpRequest rather than fetch because only it reports upload progress. The piece's receipt (ETag) is read
// from the response; the bucket must expose that header to the browser (docs/storage.md).
export function sendPiece(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = (): void => xhr.abort();
    const finish = (): void => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });

    xhr.open('PUT', url);
    xhr.timeout = PIECE_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      finish();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new HttpPieceError(xhr.status));
        return;
      }
      const etag = xhr.getResponseHeader('ETag');
      if (etag) resolve(etag);
      else reject(new MissingReceiptError());
    };
    xhr.onerror = () => {
      finish();
      reject(new Error('Network error while sending a piece'));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error('Sending a piece took too long'));
    };
    xhr.onabort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send(body);
  });
}
```

`apps/web/src/uploads/browser-deps.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/fetch-mock';
import { createBrowserDeps } from './browser-deps';

describe('browser deps', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sleeps for the time asked and stops sleeping when cancelled', async () => {
    const deps = createBrowserDeps('u1');
    const done = vi.fn();
    void deps.sleep(1000, new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();

    const controller = new AbortController();
    const stopped = deps.sleep(60_000, controller.signal);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('waits until the browser says it is online again, or until cancelled', async () => {
    const deps = createBrowserDeps('u1');
    const resumed = vi.fn();
    void deps.waitForOnline(new AbortController().signal).then(resumed);
    await vi.advanceTimersByTimeAsync(10);
    expect(resumed).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(resumed).toHaveBeenCalled();

    const controller = new AbortController();
    const stopped = deps.waitForOnline(controller.signal);
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('asks the API for the link of exactly one piece', async () => {
    const calls: { url: string; body: unknown }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { body: { urls: { '4': 'https://storage.test/4' } } };
    });
    expect(await createBrowserDeps('u1').getPartUrl(4)).toBe('https://storage.test/4');
    expect(calls).toEqual([{ url: '/api/media/uploads/u1/part-urls', body: { partNumbers: [4] } }]);
  });

  it('fails clearly if the API returns no link for the piece', async () => {
    mockFetch(() => ({ body: { urls: {} } }));
    await expect(createBrowserDeps('u1').getPartUrl(4)).rejects.toThrow(/link/i);
  });
});
```

`apps/web/src/uploads/browser-deps.ts`:

```ts
import { getPartUrls } from '../api/media';
import type { EngineDeps } from './engine';
import { sendPiece } from './xhr';

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onOnline = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      window.removeEventListener('online', onOnline);
      reject(abortError());
    };
    window.addEventListener('online', onOnline, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createBrowserDeps(fileId: string): EngineDeps {
  return {
    getPartUrl: async (partNumber) => {
      const { urls } = await getPartUrls(fileId, [partNumber]);
      const url = urls[String(partNumber)];
      if (!url) throw new Error(`The server returned no link for piece ${partNumber}`);
      return url;
    },
    sendPart: sendPiece,
    sleep,
    isOnline: () => navigator.onLine,
    waitForOnline,
  };
}
```

`apps/web/src/uploads/duration.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDuration } from './duration';

describe('readDuration', () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'video') video = element as HTMLVideoElement;
      return element;
    });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });

  it('reads the length in whole seconds from the file itself and lets the file go', async () => {
    const result = readDuration(file);
    Object.defineProperty(video, 'duration', { value: 724.4, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(724);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('answers null when the browser cannot read the file', async () => {
    const result = readDuration(file);
    video.dispatchEvent(new Event('error'));
    await expect(result).resolves.toBeNull();
  });

  it('answers null for a length that is not a finite number', async () => {
    const result = readDuration(file);
    Object.defineProperty(video, 'duration', { value: Number.POSITIVE_INFINITY, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBeNull();
  });

  it('gives up after ten seconds', async () => {
    vi.useFakeTimers();
    const result = readDuration(file);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
```

`apps/web/src/uploads/duration.ts`:

```ts
const TIMEOUT_MS = 10_000;

// The length is read by the browser from the file's own header; it is only shown to people, never trusted.
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const finish = (seconds: number | null): void => {
      clearTimeout(timer);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}
```

`apps/web/src/uploads/describe-upload-error.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { describeUploadError } from './describe-upload-error';
import { PieceFailedError } from './engine';
import { HttpPieceError, MissingReceiptError } from './xhr';

describe('describeUploadError', () => {
  it('blames the connection when a piece kept failing', () => {
    expect(describeUploadError(new PieceFailedError(3, new HttpPieceError(500)))).toMatch(/connection kept failing/i);
  });

  it('points at the storage setup when receipts are missing', () => {
    expect(describeUploadError(new PieceFailedError(1, new MissingReceiptError()))).toMatch(/Ask an Admin/);
  });

  it('shows the server\'s own explanation for a refusal, and a generic one for anything else', () => {
    expect(describeUploadError(new ApiError(422, 'That file is not a valid MP4 video, so it was discarded.'))).toBe('That file is not a valid MP4 video, so it was discarded.');
    expect(describeUploadError(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});
```

`apps/web/src/uploads/describe-upload-error.ts`:

```ts
import { describeError } from '../api/client';
import { PieceFailedError } from './engine';
import { MissingReceiptError } from './xhr';

export function describeUploadError(error: unknown): string {
  if (error instanceof PieceFailedError) {
    if (error.cause instanceof MissingReceiptError) {
      return 'Uploads are not set up correctly: the storage did not return a receipt for a piece. Ask an Admin to check docs/storage.md.';
    }
    return 'The connection kept failing. Check your internet connection, then press Try again.';
  }
  return describeError(error);
}
```

Run: `npm test -w @jbf/web -- xhr browser-deps duration describe-upload-error` → PASS after the code above is in place (write each test first, see it fail, then add the code).

- [ ] **Step 4: Failing tests for the manager and the panel**

`apps/web/src/uploads/UploadsContext.spec.tsx`:

```tsx
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpload } from '../api/media';
import type { MockResponse } from '../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../test/session';
import { FileMismatchError, UploadsProvider, useUploads } from './UploadsContext';
import * as xhr from './xhr';

vi.mock('./xhr', async (importOriginal) => ({ ...(await importOriginal<typeof import('./xhr')>()), sendPiece: vi.fn() }));
const sendPiece = vi.mocked(xhr.sendPiece);

const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
const cover = new File(['png'], 'cover.png', { type: 'image/png' });
const started = { itemId: 'v1', fileId: 'u1', partSize: 4, partCount: 3 };

type Handler = (body: Record<string, unknown>) => MockResponse;

function startServer(overrides: Record<string, Handler | MockResponse> = {}) {
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'POST /api/media/uploads') return { status: 201, body: started };
    const urls = /^POST \/api\/media\/uploads\/u1\/part-urls$/.exec(key);
    if (urls) return { body: { urls: { [String((body.partNumbers as number[])[0])]: `https://storage.test/p${(body.partNumbers as number[])[0]}` } } };
    if (key === 'POST /api/media/uploads/u1/complete') return { body: { id: 'v1', status: 'ready' } };
    if (key === 'DELETE /api/media/uploads/u1') return { status: 204 };
    return { status: 404, body: {} };
  });
  return calls;
}

let value: ReturnType<typeof useUploads>;
function Probe() {
  value = useUploads();
  return (
    <ul>
      {value.jobs.map((job) => (
        <li key={job.id}>{`${job.title}:${job.status}:${job.bytesSent}:${job.coverWarning}:${job.message ?? ''}`}</li>
      ))}
      <li>{`finished:${value.finishedCount}`}</li>
    </ul>
  );
}

const input = { file, folderId: 'f1', title: 'Fire exits', description: '', durationSeconds: 12, cover: null };

function setup() {
  return renderWithSession(
    <UploadsProvider>
      <Probe />
    </UploadsProvider>,
  );
}

describe('UploadsProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sendPiece.mockReset();
    sendPiece.mockImplementation(async (url, body, onProgress) => {
      onProgress(body.size);
      return `"etag-${url.at(-1)}"`;
    });
  });

  it('starts an upload, sends every piece with a fresh link, completes with the receipts and reports it finished', async () => {
    const calls = startServer();
    setup();
    await act(() => value.start(input));
    expect(calls.find((call) => call.key === 'POST /api/media/uploads')?.body).toMatchObject({
      folderId: 'f1',
      title: 'Fire exits',
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10,
      durationSeconds: 12,
    });
    expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
    expect(screen.getByText('finished:1')).toBeInTheDocument();
    expect(sendPiece).toHaveBeenCalledTimes(3);
    const sizes = sendPiece.mock.calls.map(([, body]) => body.size).sort();
    expect(sizes).toEqual([2, 4, 4]);
    expect(calls.find((call) => call.key === 'POST /api/media/uploads/u1/complete')?.body).toEqual({
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ],
    });
  });

  it('refuses to start when the server refuses, and records no job', async () => {
    startServer({ 'POST /api/media/uploads': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Enter a title.'] } } } });
    setup();
    await expect(act(() => value.start(input))).rejects.toMatchObject({ status: 400 });
    expect(value.jobs).toEqual([]);
  });

  it('uploads the cover first and still finishes the video if the cover fails', async () => {
    const calls = startServer({ 'POST /api/media/items/v1/cover': { status: 422, body: { message: 'Covers can be at most 10 MB.' } } });
    setup();
    await act(() => value.start({ ...input, cover }));
    expect(await screen.findByText('Fire exits:done:10:true:')).toBeInTheDocument();
    expect(calls.findIndex((call) => call.key === 'POST /api/media/items/v1/cover')).toBeLessThan(calls.findIndex((call) => call.key === 'POST /api/media/uploads/u1/complete'));
  });

  it('shows the server\'s explanation when finishing is refused, and keeps the job so it can be dismissed', async () => {
    startServer({ 'POST /api/media/uploads/u1/complete': { status: 422, body: { message: 'That file is not a valid MP4 video, so it was discarded.' } } });
    setup();
    await act(() => value.start(input));
    expect(await screen.findByText(/failed:.*not a valid MP4/)).toBeInTheDocument();
    expect(screen.getByText('finished:0')).toBeInTheDocument();
    act(() => value.dismiss('u1'));
    expect(screen.queryByText(/Fire exits/)).toBeNull();
  });

  it('cancels a running upload: stops sending and removes the upload on the server', async () => {
    const calls = startServer();
    sendPiece.mockImplementation((_url, _body, _progress, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    setup();
    await act(() => value.start(input));
    await screen.findByText(/Fire exits:sending/);
    await act(() => value.cancel('u1'));
    expect(calls.some((call) => call.key === 'DELETE /api/media/uploads/u1')).toBe(true);
    expect(screen.queryByText(/Fire exits/)).toBeNull();
    expect(calls.some((call) => call.key === 'POST /api/media/uploads/u1/complete')).toBe(false);
  });

  it('warns before the tab is closed while sending, and stops warning afterwards', async () => {
    startServer();
    let release: (etag: string) => void = () => undefined;
    sendPiece.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));
    setup();
    await act(() => value.start({ ...input, file: new File([new Uint8Array(3)], 'clip.mp4', { type: 'video/mp4' }) }));
    await waitFor(() => expect(sendPiece).toHaveBeenCalled());
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    await act(async () => release('"e"'));
    await screen.findByText(/Fire exits:done/);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  describe('resuming', () => {
    const pending: PendingUpload = { fileId: 'u1', itemId: 'v1', folderId: 'f1', title: 'Fire exits', fileName: 'clip.mp4', sizeBytes: 10, createdAt: '2026-10-08T10:00:00Z' };

    it('refuses a different file and says which one is needed', async () => {
      startServer();
      setup();
      await expect(act(() => value.resume(pending, new File(['x'], 'other.mp4', { type: 'video/mp4' })))).rejects.toBeInstanceOf(FileMismatchError);
      await expect(act(() => value.resume(pending, new File([new Uint8Array(11)], 'clip.mp4', { type: 'video/mp4' })))).rejects.toThrow(/clip\.mp4/);
    });

    it('sends only the missing pieces and completes with the stored receipts as well', async () => {
      const calls = startServer({
        'GET /api/media/uploads/u1': {
          body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [{ partNumber: 1, size: 4, etag: '"old-1"' }, { partNumber: 3, size: 2, etag: '"old-3"' }] },
        },
      });
      setup();
      await act(() => value.resume(pending, file));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(sendPiece).toHaveBeenCalledTimes(1);
      expect(calls.find((call) => call.key === 'POST /api/media/uploads/u1/complete')?.body).toEqual({
        parts: [
          { partNumber: 1, etag: '"old-1"' },
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 3, etag: '"old-3"' },
        ],
      });
    });

    it('lets Try again continue a failed upload from what the server holds', async () => {
      let attempt = 0;
      const calls = startServer({
        'POST /api/media/uploads/u1/complete': () => (++attempt === 1 ? { status: 500, body: {} } : { body: { id: 'v1', status: 'ready' } }),
        'GET /api/media/uploads/u1': { body: { fileId: 'u1', itemId: 'v1', status: 'pending', partSize: 4, partCount: 3, uploadedParts: [{ partNumber: 1, size: 4, etag: '"s1"' }, { partNumber: 2, size: 4, etag: '"s2"' }, { partNumber: 3, size: 2, etag: '"s3"' }] } },
      });
      setup();
      await act(() => value.start(input));
      await screen.findByText(/Fire exits:failed/);
      sendPiece.mockClear();
      await act(() => value.retry('u1'));
      expect(await screen.findByText('Fire exits:done:10:false:')).toBeInTheDocument();
      expect(sendPiece).not.toHaveBeenCalled();
      expect(calls.filter((call) => call.key === 'POST /api/media/uploads/u1/complete')).toHaveLength(2);
    });
  });

  it('keeps showing a finished upload until it is dismissed', async () => {
    startServer();
    setup();
    await act(() => value.start(input));
    await screen.findByText(/Fire exits:done/);
    await userEvent.click(document.body);
    expect(screen.getByText(/Fire exits:done/)).toBeInTheDocument();
  });
});
```

`apps/web/src/uploads/UploadPanel.spec.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type UploadJob, UploadsContext, type UploadsValue } from './UploadsContext';
import { UploadPanel } from './UploadPanel';

const job = (overrides: Partial<UploadJob> = {}): UploadJob => ({
  id: 'u1',
  itemId: 'v1',
  folderId: 'f1',
  title: 'Fire exits',
  fileName: 'fire-exits.mp4',
  sizeBytes: 2 * 1024 ** 3,
  bytesSent: Math.round(1.1 * 1024 ** 3),
  status: 'sending',
  message: null,
  coverWarning: false,
  ...overrides,
});

function renderPanel(jobs: UploadJob[]) {
  const value: UploadsValue = {
    jobs,
    finishedCount: 0,
    start: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    dismiss: vi.fn(),
  };
  render(
    <UploadsContext.Provider value={value}>
      <UploadPanel />
    </UploadsContext.Provider>,
  );
  return value;
}

describe('UploadPanel', () => {
  it('renders nothing when there are no uploads', () => {
    renderPanel([]);
    expect(screen.queryByRole('region', { name: 'Uploads' })).toBeNull();
  });

  it('shows a labelled progress bar with bytes sent, and Cancel', async () => {
    const value = renderPanel([job()]);
    const panel = screen.getByRole('region', { name: 'Uploads' });
    expect(within(panel).getByText('Fire exits')).toBeInTheDocument();
    expect(within(panel).getByText('fire-exits.mp4')).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar', { name: 'Upload progress for Fire exits' })).toHaveAttribute('value', String(Math.round(1.1 * 1024 ** 3)));
    expect(within(panel).getByText('1.1 GB of 2 GB')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel upload of Fire exits' }));
    expect(value.cancel).toHaveBeenCalledWith('u1');
  });

  it('says it is finishing, then finished, and lets the person dismiss', async () => {
    const value = renderPanel([job({ id: 'a', title: 'Finishing one', status: 'finishing' }), job({ id: 'b', title: 'Done one', status: 'done' })]);
    expect(screen.getByText('Finishing…')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Done one' }));
    expect(value.dismiss).toHaveBeenCalledWith('b');
  });

  it('shows what went wrong with Try again and Dismiss, and a cover warning on a finished video', async () => {
    const value = renderPanel([
      job({ id: 'a', status: 'failed', message: 'The connection kept failing. Check your internet connection, then press Try again.' }),
      job({ id: 'b', title: 'Covered', status: 'done', coverWarning: true }),
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('connection kept failing');
    expect(screen.getByText(/cover image could not be added/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again with Fire exits' }));
    expect(value.retry).toHaveBeenCalledWith('a');
  });

  it('shows hostile titles as plain text', () => {
    renderPanel([job({ title: '<img src=x onerror=alert(1)>' })]);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
```

Add to `apps/web/src/components/AppShell.spec.tsx`:

```tsx
  it('has a place for upload progress that stays empty until an upload starts', async () => {
    renderShell(ADMIN);
    await screen.findByText('Anita Rao · Admin');
    expect(screen.queryByRole('region', { name: 'Uploads' })).toBeNull();
  });
```

Run: `npm test -w @jbf/web -- UploadsContext UploadPanel AppShell` → FAIL.

- [ ] **Step 5: The manager and the panel**

`apps/web/src/uploads/UploadsContext.tsx`:

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import {
  cancelUpload,
  completeUpload,
  getUploadStatus,
  type PendingUpload,
  startUpload,
  type UploadStatus as ServerUploadStatus,
  uploadCover,
} from '../api/media';
import { formatBytes } from '../lib/format';
import { createBrowserDeps } from './browser-deps';
import { describeUploadError } from './describe-upload-error';
import { uploadPieces } from './engine';

export type UploadStatus = 'sending' | 'finishing' | 'done' | 'failed';

export interface UploadJob {
  id: string;
  itemId: string;
  folderId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  bytesSent: number;
  status: UploadStatus;
  message: string | null;
  coverWarning: boolean;
}

export interface StartInput {
  file: File;
  folderId: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  cover: File | null;
}

export interface UploadsValue {
  jobs: UploadJob[];
  // Goes up by one each time a video finishes, so pages showing videos know to reload.
  finishedCount: number;
  start: (input: StartInput) => Promise<void>;
  resume: (pending: PendingUpload, file: File) => Promise<void>;
  retry: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
}

export class FileMismatchError extends Error {
  constructor(pending: PendingUpload) {
    super(`Choose the same file you started with: "${pending.fileName}" (${formatBytes(pending.sizeBytes)}).`);
  }
}

export const UploadsContext = createContext<UploadsValue | null>(null);

export function useUploads(): UploadsValue {
  const value = useContext(UploadsContext);
  if (!value) throw new Error('useUploads must be used inside UploadsProvider');
  return value;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 5;
const PAINT_INTERVAL_MS = 200;

interface Source {
  file: File;
  itemId: string;
  partSize: number;
  partCount: number;
}

// Lives for as long as the person is signed in and the app is open, so uploads keep going while they browse
// other pages. A page reload ends them; the folder page then offers to resume (see PendingUploads).
export function UploadsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [finishedCount, setFinishedCount] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const sources = useRef(new Map<string, Source>());
  const lastPaint = useRef(new Map<string, number>());

  const patch = useCallback((id: string, changes: Partial<UploadJob>) => {
    setJobs((list) => list.map((job) => (job.id === id ? { ...job, ...changes } : job)));
  }, []);

  // Progress events arrive many times a second; painting them all would only make the page work harder.
  const paint = useCallback(
    (id: string, sent: number, total: number) => {
      const now = Date.now();
      if (sent < total && now - (lastPaint.current.get(id) ?? 0) < PAINT_INTERVAL_MS) return;
      lastPaint.current.set(id, now);
      patch(id, { bytesSent: sent });
    },
    [patch],
  );

  const run = useCallback(
    async (id: string, already: Map<number, string>, cover: File | null) => {
      const source = sources.current.get(id);
      if (!source) return;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      patch(id, { status: 'sending', message: null });
      try {
        if (cover) {
          try {
            await uploadCover(source.itemId, cover);
          } catch {
            patch(id, { coverWarning: true });
          }
        }
        const receipts = await uploadPieces(
          {
            file: source.file,
            partSize: source.partSize,
            partCount: source.partCount,
            already,
            concurrency: CONCURRENCY,
            maxAttempts: MAX_ATTEMPTS,
            signal: controller.signal,
            onProgress: (sent) => paint(id, sent, source.file.size),
          },
          createBrowserDeps(id),
        );
        patch(id, { status: 'finishing', bytesSent: source.file.size });
        await completeUpload(id, receipts);
        patch(id, { status: 'done', bytesSent: source.file.size });
        sources.current.delete(id);
        setFinishedCount((count) => count + 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(id, { status: 'failed', message: describeUploadError(error) });
      } finally {
        controllers.current.delete(id);
      }
    },
    [patch, paint],
  );

  // Starts (or restarts) sending from whatever the server already holds.
  const begin = useCallback(
    (pending: Pick<PendingUpload, 'fileId' | 'itemId' | 'folderId' | 'title' | 'fileName' | 'sizeBytes'>, file: File, status: ServerUploadStatus) => {
      sources.current.set(pending.fileId, { file, itemId: pending.itemId, partSize: status.partSize, partCount: status.partCount });
      const bytesSent = status.uploadedParts.reduce((sum, part) => sum + part.size, 0);
      const job: UploadJob = {
        id: pending.fileId,
        itemId: pending.itemId,
        folderId: pending.folderId,
        title: pending.title,
        fileName: pending.fileName,
        sizeBytes: pending.sizeBytes,
        bytesSent,
        status: 'sending',
        message: null,
        coverWarning: false,
      };
      setJobs((list) => [...list.filter((existing) => existing.id !== pending.fileId), job]);
      void run(pending.fileId, new Map(status.uploadedParts.map((part) => [part.partNumber, part.etag])), null);
    },
    [run],
  );

  const start = useCallback(
    async (input: StartInput) => {
      const created = await startUpload({
        folderId: input.folderId,
        title: input.title,
        description: input.description,
        fileName: input.file.name,
        contentType: 'video/mp4',
        sizeBytes: input.file.size,
        durationSeconds: input.durationSeconds,
      });
      sources.current.set(created.fileId, { file: input.file, itemId: created.itemId, partSize: created.partSize, partCount: created.partCount });
      setJobs((list) => [
        ...list,
        {
          id: created.fileId,
          itemId: created.itemId,
          folderId: input.folderId,
          title: input.title.trim(),
          fileName: input.file.name,
          sizeBytes: input.file.size,
          bytesSent: 0,
          status: 'sending',
          message: null,
          coverWarning: false,
        },
      ]);
      void run(created.fileId, new Map(), input.cover);
    },
    [run],
  );

  const resume = useCallback(
    async (pending: PendingUpload, file: File) => {
      if (file.name !== pending.fileName || file.size !== pending.sizeBytes) throw new FileMismatchError(pending);
      if (controllers.current.has(pending.fileId)) return;
      const status = await getUploadStatus(pending.fileId);
      if (status.status === 'ready') {
        setFinishedCount((count) => count + 1);
        return;
      }
      begin(pending, file, status);
    },
    [begin],
  );

  const retry = useCallback(
    async (id: string) => {
      const source = sources.current.get(id);
      const job = jobs.find((candidate) => candidate.id === id);
      if (!source || !job || controllers.current.has(id)) return;
      try {
        begin(job, source.file, await getUploadStatus(id));
      } catch (error) {
        patch(id, { status: 'failed', message: describeUploadError(error) });
      }
    },
    [begin, jobs, patch],
  );

  const cancel = useCallback(
    async (id: string) => {
      controllers.current.get(id)?.abort();
      try {
        await cancelUpload(id);
      } catch (error) {
        // Already gone on the server is the outcome we wanted.
        if (!(error instanceof ApiError && error.status === 404)) {
          patch(id, { status: 'failed', message: describeUploadError(error) });
          return;
        }
      }
      sources.current.delete(id);
      setJobs((list) => list.filter((job) => job.id !== id));
    },
    [patch],
  );

  const dismiss = useCallback((id: string) => {
    sources.current.delete(id);
    setJobs((list) => list.filter((job) => job.id !== id || (job.status !== 'done' && job.status !== 'failed')));
  }, []);

  // Leaving (signing out) stops everything still being sent.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const active = jobs.some((job) => job.status === 'sending' || job.status === 'finishing');
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const value = useMemo(
    () => ({ jobs, finishedCount, start, resume, retry, cancel, dismiss }),
    [jobs, finishedCount, start, resume, retry, cancel, dismiss],
  );
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}
```

`apps/web/src/uploads/UploadPanel.module.css`:

```css
.panel {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 10;
  width: min(22rem, calc(100vw - 2 * var(--space-4)));
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius);
  background: var(--color-bg);
  box-shadow: 0 4px 16px rgb(15 42 51 / 0.18);
}

.heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-base);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.job {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
}

.job:first-child {
  border-top: 0;
  padding-top: 0;
}

.title {
  margin: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.bar {
  width: 100%;
  height: 8px;
  margin: var(--space-2) 0;
  accent-color: var(--color-primary);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.error {
  margin: var(--space-2) 0 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}
```

`apps/web/src/uploads/UploadPanel.tsx`:

```tsx
import { Button } from '../components/Button';
import { formatBytes } from '../lib/format';
import styles from './UploadPanel.module.css';
import { type UploadJob, useUploads } from './UploadsContext';

function Progress({ job }: { job: UploadJob }) {
  if (job.status === 'sending') {
    return (
      <>
        <progress className={styles.bar} aria-label={`Upload progress for ${job.title}`} max={job.sizeBytes} value={job.bytesSent} />
        <p className={styles.muted}>
          {formatBytes(job.bytesSent)} of {formatBytes(job.sizeBytes)}
        </p>
      </>
    );
  }
  if (job.status === 'finishing') return <p className={styles.muted}>Finishing…</p>;
  if (job.status === 'done') return <p className={styles.muted}>Finished</p>;
  return (
    <p className={styles.error} role="alert">
      {job.message}
    </p>
  );
}

export function UploadPanel() {
  const { jobs, retry, cancel, dismiss } = useUploads();
  if (jobs.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Uploads">
      <h2 className={styles.heading}>Uploads</h2>
      <ul className={styles.list}>
        {jobs.map((job) => (
          <li key={job.id} className={styles.job}>
            <p className={styles.title}>{job.title}</p>
            <p className={styles.muted}>{job.fileName}</p>
            <Progress job={job} />
            {job.coverWarning ? <p className={styles.muted}>The cover image could not be added. You can add it later with Edit.</p> : null}
            <div className={styles.actions}>
              {job.status === 'sending' || job.status === 'finishing' ? (
                <Button variant="secondary" size="small" aria-label={`Cancel upload of ${job.title}`} onClick={() => void cancel(job.id)}>
                  Cancel
                </Button>
              ) : null}
              {job.status === 'failed' ? (
                <Button size="small" aria-label={`Try again with ${job.title}`} onClick={() => void retry(job.id)}>
                  Try again
                </Button>
              ) : null}
              {job.status === 'done' || job.status === 'failed' ? (
                <Button variant="secondary" size="small" aria-label={`Dismiss ${job.title}`} onClick={() => dismiss(job.id)}>
                  Dismiss
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/web/src/components/AppShell.tsx`: import `UploadPanel` from `../uploads/UploadPanel` and `UploadsProvider` from `../uploads/UploadsContext`; wrap the returned `<div className={styles.shell}>…</div>` in `<UploadsProvider>…</UploadsProvider>` and render `<UploadPanel />` as the last child inside the shell `div` (after the menu `Dialog`). The provider sits below the `state.status !== 'authenticated'` early return, so signing out unmounts it and stops any uploads.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the resumable upload engine, upload manager and progress panel"
```

---

### Task 13: The upload dialog and unfinished uploads on the folder page

**Files:**
- Create: `apps/web/src/pages/videos/{UploadDialog.tsx,UploadDialog.spec.tsx,PendingUploads.tsx,PendingUploads.spec.tsx}`
- Modify: `apps/web/src/pages/videos/FolderPage.tsx`, `apps/web/src/pages/videos/FolderPage.spec.tsx`

**Interfaces:**
- Consumes: Tasks 10–12 (`useUploads`, `UploadsContext`, `readDuration`, `checkVideoFile`, `checkCoverFile`, `listMyUploads`, `PendingUpload`, `FileMismatchError`).
- Produces: `UploadDialog({ open, folderId, onClose, onStarted })`; `PendingUploads({ folderId, reloadKey, onChanged })`.

- [ ] **Step 1: Failing tests**

`apps/web/src/pages/videos/UploadDialog.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { MAX_VIDEO_BYTES } from '../../uploads/limits';
import { UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { UploadDialog } from './UploadDialog';

vi.mock('../../uploads/duration', () => ({ readDuration: vi.fn(async () => 42) }));

const mp4 = () => new File([new Uint8Array(10)], 'Fire exits.mp4', { type: 'video/mp4' });

function setup(start: UploadsValue['start'] = vi.fn(async () => undefined)) {
  mockSession(STAFF);
  const value: UploadsValue = { jobs: [], finishedCount: 0, start, resume: vi.fn(), retry: vi.fn(), cancel: vi.fn(), dismiss: vi.fn() };
  const onClose = vi.fn();
  const onStarted = vi.fn();
  renderWithSession(
    <UploadsContext.Provider value={value}>
      <UploadDialog open folderId="f1" onClose={onClose} onStarted={onStarted} />
    </UploadsContext.Provider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Upload video' });
  return { dialog, start, onClose, onStarted };
}

const bigFile = () => {
  const file = new File(['x'], 'big.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: MAX_VIDEO_BYTES + 1 });
  return file;
};

describe('UploadDialog', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('fills in the title from the file name, without the extension, until the person types their own', async () => {
    const { dialog } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Fire exits');
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.type(within(dialog).getByLabelText('Title'), 'My own title');
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), new File([new Uint8Array(5)], 'Other.mp4', { type: 'video/mp4' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('My own title');
  });

  it('starts the upload with the trimmed title, the description, the length read from the file and the cover', async () => {
    const { dialog, start, onClose, onStarted } = setup();
    const file = mp4();
    const cover = new File(['png'], 'cover.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), file);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Fire exits  ');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Where to go.');
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), cover);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).toHaveBeenCalledWith({ file, folderId: 'f1', title: 'Fire exits', description: 'Where to go.', durationSeconds: 42, cover });
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a file and a title before sending anything', async () => {
    const { dialog, start } = setup();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a video file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Video file/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a file that is not an MP4 and explains how to convert it', async () => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), new File(['x'], 'clip.mov', { type: 'video/quicktime' }), { applyAccept: false });
    expect(await within(dialog).findByText(/HandBrake/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a file over 2 GB and an unsuitable cover', async () => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), bigFile());
    expect(await within(dialog).findByText(/at most 2 GB/)).toBeInTheDocument();
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'c.gif', { type: 'image/gif' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(400, 'Validation failed', { title: ['Title must be 200 characters or fewer.'] });
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a general failure in an alert and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(404, 'Folder not found.');
    });
    const { dialog } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Folder not found.');
  });
});
```

`apps/web/src/pages/videos/PendingUploads.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpload } from '../../api/media';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { FileMismatchError, type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { PendingUploads } from './PendingUploads';

const pending = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
  itemId: `item-${overrides.fileId}`,
  folderId: 'f1',
  title: 'Fire exits',
  fileName: 'fire.mp4',
  sizeBytes: 412 * 1024 ** 2,
  createdAt: '2026-10-08T10:00:00Z',
  ...overrides,
});

function setup(list: PendingUpload[], jobs: UploadJob[] = [], overrides: Partial<UploadsValue> = {}) {
  mockSession(STAFF, (url) => (url === '/api/media/uploads/mine' ? { body: list } : { status: 404, body: {} }));
  const value: UploadsValue = { jobs, finishedCount: 0, start: vi.fn(), resume: vi.fn(async () => undefined), retry: vi.fn(), cancel: vi.fn(async () => undefined), dismiss: vi.fn(), ...overrides };
  const onChanged = vi.fn();
  const view = renderWithSession(
    <UploadsContext.Provider value={value}>
      <PendingUploads folderId="f1" reloadKey={0} onChanged={onChanged} />
    </UploadsContext.Provider>,
  );
  return { value, onChanged, view };
}

describe('PendingUploads', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists unfinished uploads of this folder, and nothing else', async () => {
    setup([pending({ fileId: 'a', title: 'Mine here' }), pending({ fileId: 'b', title: 'Other folder', folderId: 'f2' })]);
    expect(await screen.findByRole('table', { name: 'Unfinished uploads' })).toBeInTheDocument();
    expect(screen.getByText('Mine here')).toBeInTheDocument();
    expect(screen.queryByText('Other folder')).toBeNull();
  });

  it('does not list uploads that are running in this browser right now', async () => {
    const running: UploadJob = { id: 'a', itemId: 'item-a', folderId: 'f1', title: 'Mine here', fileName: 'fire.mp4', sizeBytes: 5, bytesSent: 1, status: 'sending', message: null, coverWarning: false };
    setup([pending({ fileId: 'a', title: 'Mine here' })], [running]);
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Unfinished uploads' })).toBeNull());
  });

  it('renders nothing when there are none', async () => {
    const { view } = setup([]);
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  });

  it('resumes with the file the person chooses', async () => {
    const { value, view } = setup([pending({ fileId: 'a' })]);
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    const file = new File([new Uint8Array(3)], 'fire.mp4', { type: 'video/mp4' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume Fire exits' }));
    await userEvent.upload(view.container.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(value.resume).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'a' }), file));
  });

  it('says which file is needed when the wrong one is chosen', async () => {
    const entry = pending({ fileId: 'a' });
    const { view } = setup([entry], [], { resume: vi.fn(async () => Promise.reject(new FileMismatchError(entry))) });
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume Fire exits' }));
    await userEvent.upload(view.container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'other.mp4', { type: 'video/mp4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the same file you started with: "fire.mp4"');
  });

  it('cancels an unfinished upload after a confirmation', async () => {
    const { value, onChanged } = setup([pending({ fileId: 'a' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this upload?' });
    expect(value.cancel).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel upload' }));
    await waitFor(() => expect(value.cancel).toHaveBeenCalledWith('a'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows hostile titles as plain text', async () => {
    setup([pending({ fileId: 'a', title: '<img src=x onerror=alert(1)>' })]);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
```

In `apps/web/src/pages/videos/FolderPage.spec.tsx` replace `renderPage` so every test runs inside the manager, and add tests:

```tsx
import { UploadsContext, type UploadJob, type UploadsValue } from '../../uploads/UploadsContext';

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

function UploadsHarness({ initial }: { initial: UploadsValue }) {
  const [value, setValue] = useState(initial);
  setUploads = setValue;
  return (
    <UploadsContext.Provider value={value}>
      <Routes>
        <Route path="/videos/:folderId" element={<FolderPage />} />
      </Routes>
    </UploadsContext.Provider>
  );
}

function renderPage(route = '/videos/f1', uploads: UploadsValue = fakeUploads()) {
  return renderWithSession(<UploadsHarness initial={uploads} />, route);
}

  it('puts an Upload video button on the page that opens the upload dialog', async () => {
    startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Upload video' }));
    expect(screen.getByRole('dialog', { name: 'Upload video' })).toBeInTheDocument();
  });

  it('shows the progress of a video being sent from this browser in its row', async () => {
    startServer();
    const job: UploadJob = { id: 'u3', itemId: 'v3', folderId: 'f1', title: 'x', fileName: 'x.mp4', sizeBytes: 100, bytesSent: 62, status: 'sending', message: null, coverWarning: false };
    renderPage('/videos/f1', fakeUploads({ jobs: [job] }));
    expect(await screen.findByText('Uploading 62%')).toBeInTheDocument();
  });

  it('reloads the list when a video finishes uploading', async () => {
    const calls = startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    const before = calls.filter((call) => call.key === 'GET /api/media/folders/f1/items').length;
    act(() => setUploads(fakeUploads({ finishedCount: 1 })));
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/media/folders/f1/items').length).toBe(before + 1));
  });
```

In the same file's `startServer` handler add `if (key === 'GET /api/media/uploads/mine') return { body: [] };` (the page now asks for unfinished uploads), and add `import { useState } from 'react';` plus `act` to the existing `@testing-library/react` import.

Run: `npm test -w @jbf/web -- UploadDialog PendingUploads FolderPage` → FAIL.

- [ ] **Step 2: The upload dialog**

`apps/web/src/pages/videos/UploadDialog.tsx`:

```tsx
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea } from '../../components/TextArea';
import { TextField } from '../../components/TextField';
import { readDuration } from '../../uploads/duration';
import { checkCoverFile, checkVideoFile } from '../../uploads/limits';
import { useUploads } from '../../uploads/UploadsContext';
import styles from './Videos.module.css';

interface UploadDialogProps {
  open: boolean;
  folderId: string;
  onClose: () => void;
  // Called once the server has accepted the upload (sending continues in the background).
  onStarted: () => void;
}

export function UploadDialog({ open, folderId, onClose, onStarted }: UploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Upload video" blocked={busy}>
      <UploadForm folderId={folderId} busy={busy} setBusy={setBusy} onClose={onClose} onStarted={onStarted} />
    </Dialog>
  );
}

type Field = 'file' | 'title' | 'description' | 'cover';
type Errors = Partial<Record<Field, string>>;

function UploadForm({
  folderId,
  busy,
  setBusy,
  onClose,
  onStarted,
}: Pick<UploadDialogProps, 'folderId' | 'onClose' | 'onStarted'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const uploads = useUploads();
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
    ({ file: fileRef, title: titleRef, description: descriptionRef, cover: coverRef })[focusRequest.field].current?.focus();
  }, [focusRequest]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setErrors((previous) => ({ ...previous, file: chosen ? (checkVideoFile(chosen) ?? undefined) : undefined }));
    if (chosen && !titleTouched.current) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
    duration.current = chosen ? readDuration(chosen) : Promise.resolve(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next: Errors = {
      file: file ? (checkVideoFile(file) ?? undefined) : 'Choose a video file.',
      title: title.trim() ? undefined : 'Enter a title.',
      cover: cover ? (checkCoverFile(cover) ?? undefined) : undefined,
    };
    setErrors(next);
    const first = (['file', 'title', 'cover'] as const).find((field) => next[field]);
    if (first || !file) {
      setFocusRequest({ field: first ?? 'file' });
      return;
    }
    setBusy(true);
    try {
      await uploads.start({ file, folderId, title: title.trim(), description, durationSeconds: await duration.current, cover });
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
        label="Video file (MP4, up to 2 GB)"
        type="file"
        accept="video/mp4,.mp4"
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

- [ ] **Step 3: Unfinished uploads**

`apps/web/src/pages/videos/PendingUploads.tsx`:

```tsx
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { listMyUploads, type PendingUpload } from '../../api/media';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Table } from '../../components/Table';
import { formatBytes, formatDateTime } from '../../lib/format';
import { FileMismatchError, useUploads } from '../../uploads/UploadsContext';
import styles from './Videos.module.css';

interface PendingUploadsProps {
  folderId: string;
  // Changes whenever the list may be out of date (an upload started or finished).
  reloadKey: number;
  onChanged: () => void;
}

// Uploads that were interrupted (for example by closing the tab): the person can continue with the same file,
// from the pieces the server already holds, or abandon them.
export function PendingUploads({ folderId, reloadKey, onChanged }: PendingUploadsProps) {
  const uploads = useUploads();
  const [list, setList] = useState<PendingUpload[]>([]);
  const [target, setTarget] = useState<PendingUpload | null>(null);
  const [cancelling, setCancelling] = useState<PendingUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setList(await listMyUploads());
    } catch {
      // The rest of the page still works; this list simply stays as it was.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey, uploads.jobs.length]);

  const running = new Set(uploads.jobs.map((job) => job.id));
  const shown = list.filter((entry) => entry.folderId === folderId && !running.has(entry.fileId));

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !target) return;
    setError(null);
    try {
      await uploads.resume(target, file);
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof FileMismatchError ? caught.message : describeError(caught));
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      await uploads.cancel(cancelling.fileId);
      setCancelling(null);
      await load();
      onChanged();
    } catch (caught) {
      setError(describeError(caught));
      setCancelling(null);
    } finally {
      setBusy(false);
    }
  }

  if (shown.length === 0 && !error) return null;

  return (
    <section aria-label="Unfinished uploads">
      <h2>Unfinished uploads</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <input ref={inputRef} type="file" accept="video/mp4,.mp4" hidden tabIndex={-1} onChange={(event) => void onFileChosen(event)} />
      {shown.length > 0 ? (
        <Table caption="Unfinished uploads">
          <thead>
            <tr>
              <th scope="col">Video</th>
              <th scope="col">Size</th>
              <th scope="col">Started</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.fileId}>
                <td data-label="Video">
                  <span className={styles.name}>{entry.title}</span>
                  <span className={styles.muted}>{entry.fileName}</span>
                </td>
                <td data-label="Size">{formatBytes(entry.sizeBytes)}</td>
                <td data-label="Started">{formatDateTime(entry.createdAt)}</td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <Button
                      size="small"
                      aria-label={`Resume ${entry.title}`}
                      onClick={() => {
                        setTarget(entry);
                        inputRef.current?.click();
                      }}
                    >
                      Resume
                    </Button>
                    <Button variant="secondary" size="small" aria-label={`Cancel upload of ${entry.title}`} onClick={() => setCancelling(entry)}>
                      Cancel
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this upload?"
        confirmLabel="Cancel upload"
        cancelLabel="Keep it"
        tone="danger"
        busy={busy}
        onCancel={() => setCancelling(null)}
        onConfirm={() => void confirmCancel()}
      >
        {cancelling ? `What was already sent of "${cancelling.title}" will be discarded. You can upload the video again later.` : ''}
      </ConfirmDialog>
    </section>
  );
}
```

(The page-level "Resume" button hands the choice to one hidden file input; `userEvent.upload` in the test targets it directly. Showing the `Alert` when `shown` is empty keeps a mismatch or cancel failure visible.)

- [ ] **Step 4: Wire the dialog, list and progress into the folder page**

`apps/web/src/pages/videos/FolderPage.tsx`:
- add imports: `useUploads` from `../../uploads/UploadsContext`, `UploadDialog` from `./UploadDialog`, `PendingUploads` from `./PendingUploads`;
- inside the component add `const uploads = useUploads();`, `const [uploading, setUploading] = useState(false);` and
  ```tsx
  const progress = Object.fromEntries(
    uploads.jobs
      .filter((job) => job.folderId === folderId && job.status === 'sending' && job.sizeBytes > 0)
      .map((job) => [job.itemId, Math.floor((100 * job.bytesSent) / job.sizeBytes)]),
  );
  ```
- change the existing load effect to `useEffect(() => { void load(); }, [load, uploads.finishedCount]);`
- in the header `div`, after the `<h1>`, add `<Button onClick={() => setUploading(true)}>Upload video</Button>`;
- pass `progress={progress}` to `VideosTable` (replacing `progress={{}}`);
- after the items block, render `<PendingUploads folderId={folderId} reloadKey={uploads.finishedCount} onChanged={() => void load()} />` and, with the other dialogs, `<UploadDialog open={uploading} folderId={folderId} onClose={() => setUploading(false)} onStarted={() => void load()} />`.

(Because the empty state and the table are alternatives, the "Upload video" button is the way in for an empty folder.)

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build -w @jbf/web && npm test -w @jbf/web`
Expected: PASS. If the Task 11 `FolderPage` tests now fail because `useUploads` throws outside a provider, the test helper was not updated as described in step 1.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "feat: add the upload dialog and resumable unfinished uploads to a folder"
```

---

### Task 14: Documentation, the Cloudflare guide, and the final checks

**Files:**
- Create: `docs/storage.md`, `docs/api/media.md`
- Modify: `docs/api/audit.md`, `ARCHITECTURE.md`, `README.md`, `PROGRESS.md`, `CHANGELOG.md`, `DECISIONS.md`

**Interfaces:** none (documentation only). Read each file first and add to it in its existing style: dated one-line bullets in `CHANGELOG.md` and `DECISIONS.md` (newest last), headed sections in the others. Use the real date of the work for new dated entries.

- [ ] **Step 1: `docs/storage.md` (written for the person setting up Cloudflare, who may never have used it)**

Write the file with these sections and this content (plain words; no jargon without a one-line explanation):

1. **What this is for.** Videos and cover images are not kept on the server. They go to Cloudflare R2, a private online storage service. The browser sends each video in pieces (16 MB each) straight to R2 using temporary links the API hands out, and plays videos through temporary links as well. The bucket is never public.
2. **Before you start.** A Cloudflare account (free to create; R2 needs a payment method on file but has a free monthly allowance; see Cloudflare's current R2 pricing page for the numbers, which change). R2 does not charge for data leaving the bucket, which suits videos watched often.
3. **Step by step.**
   1. In the Cloudflare dashboard open **R2 Object Storage** and choose **Create bucket**. Name it (for example `jbf-media`). Leave **public access off**. Do not enable the `r2.dev` public URL.
   2. Note the **Account ID** (shown on the R2 overview page).
   3. Create an access key: **R2 → Manage API tokens → Create API token**, permission **Object Read & Write**, scope **this bucket only** (`jbf-media`). Copy the **Access Key ID** and **Secret Access Key** immediately; the secret is shown once. Treat both like passwords.
   4. Set the bucket's **CORS policy** (bucket → Settings → CORS policy), replacing `https://lms.example.org` with the exact address the web app is served from (no trailing slash; add `http://localhost:5173` only for a development bucket):
      ```json
      [
        {
          "AllowedOrigins": ["https://lms.example.org"],
          "AllowedMethods": ["GET", "PUT", "HEAD"],
          "AllowedHeaders": ["Content-Type"],
          "ExposeHeaders": ["ETag"],
          "MaxAgeSeconds": 3600
        }
      ]
      ```
      Explain: `PUT` lets the browser send pieces, `GET`/`HEAD` let it play videos and show covers, `Content-Type` is sent with cover images, and **`ExposeHeaders: ETag` is essential**: without it the browser cannot read each piece's receipt and every upload fails with "the storage did not return a receipt".
   5. Add an **object lifecycle rule** (bucket → Settings → Object lifecycle rules): *Abort incomplete multipart uploads* after 3 days. This is a safety net; the API also cleans up abandoned uploads itself after 24 hours.
   6. Put the settings in `apps/api/.env` on the server: `STORAGE_DRIVER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Never commit this file or paste the values into chat, tickets or logs.
4. **Check it works:** `npm run storage:check -w @jbf/api`. It uploads a small file through a temporary link, reads it back, uploads a two-piece file, checks the browser permissions for `WEB_ORIGIN`, and deletes everything it created. Each line shows ✓ or ✗ with a plain explanation. Table of the common ✗ results and fixes: `the service answered 403` (wrong key, key not allowed on this bucket, or clock far off), `NoSuchBucket` (wrong bucket name or account id), the CORS lines (policy missing the web address, `PUT`, or `ETag`).
5. **Local development without Cloudflare.** The default `STORAGE_DRIVER=local` keeps files under `apps/api/.storage` (git-ignored) and serves them through the API at `/api/dev-storage/...` with signed, expiring links. It is refused in production. It proves the application logic but **not** the Cloudflare setup; only `storage:check` against the real bucket does that.
6. **Limits and rules:** MP4 only, 2 GB per video, covers JPEG/PNG/WebP up to 10 MB; pieces are 16 MB (at most 128); abandoned uploads are removed after 24 hours (hourly timer in the API, or run `npm run storage:cleanup -w @jbf/api`).
7. **Security notes:** the bucket is private; temporary links last one hour and are never written to the audit log or server logs; the access key is limited to one bucket; rotate it by creating a new key, updating `.env`, restarting the API, then deleting the old key; a person with a playback link can watch that video until it expires (the same property as any temporary link).
8. **Cost note:** storage is billed per GB-month; a 2 GB video costs a fraction of a cent per month to keep; check the current pricing page before launch.

- [ ] **Step 2: `docs/api/media.md` (the contract for the mobile developer and for anyone reading the code)**

Write it in the style of `docs/api/audit.md` (base path, access, then a table of routes, then each route's request, response and errors), from the code in `apps/api/src/media/` and its tests. Cover exactly: the 15 routes of spec section 6 with the cover completion path `POST /api/media/items/:id/cover/:fileId/complete`; the item object (`id, folderId, title, description, durationSeconds, sizeBytes, status, coverUrl, createdBy{id,name}, createdAt, position`); the upload flow in order (start → part-urls → PUT each piece to its link and keep the `ETag` response header → complete) with the exact limits (16 MiB pieces, last piece may be smaller, others at least 5 MiB, at most 128 pieces, links last 1 hour); how to resume (`GET /uploads/:fileId`); the visibility rules (another person's uploading videos are invisible; upload endpoints answer 403 to others unless the caller is an Admin); the error list (400 validation with `fieldErrors`, 403, 404, 409, 422 with the plain messages, 429); the audit actions each route writes; and a short "playing a video" section (`POST /items/:id/play` returns a one-hour link; every issued link is audited; the URL may be passed straight to a video player; range requests are supported by the storage). State clearly that the mobile app must never store links, only ask again.

- [ ] **Step 3: Update the other documents**

- `docs/api/audit.md`: wherever it says there are 17 known actions, list all 29 (add the 12 new ones with their label, tone and category) and note that `content`, `files` and `playback` categories are now used (`playback.played` is hidden by "Changes only").
- `ARCHITECTURE.md`: add `storage/` (StoragePort and the three drivers, dev-storage routes) and `media/` (folders, items, uploads, covers, cleanup) to the API module map, the `uploads/` engine and `pages/videos/` to the web module map, a short "Files and storage" paragraph (browser to storage directly, API owns rows and checks, temporary links, verification on completion), and link `docs/storage.md` and `docs/api/media.md` under Related documents.
- `README.md`: new environment settings (table row per setting), the two new scripts (`storage:check`, `storage:cleanup`), the Videos page in the Pages list, a "Storage" paragraph pointing to `docs/storage.md` (local driver by default; production needs R2), and `.storage/` in the git-ignored list if such a list exists.
- `CHANGELOG.md` (one line each, newest last): milestone 3 design spec and plan; storage interface with R2, local and in-memory drivers; media tables and audit actions (migration 0003); folders; videos list/edit/reorder; resumable upload API with verification and cancel; covers and playback links; abandoned-upload cleanup; Videos pages, player, upload manager and progress panel; storage guide and API contract.
- `DECISIONS.md`: add a section "Engineering decisions (milestone 3)" with one dated bullet and its reason for each: Cloudflare R2 chosen (no download fees suits many phones downloading; S3-compatible so the code is portable); 2 GiB limit and MP4-only; the browser uploads straight to storage in 16 MiB pieces (the API never carries video bytes; pieces give retry and resume; 5 MiB is the storage minimum for all but the last piece); three storage drivers with the local one refused in production, and `storage:check` as the only proof against real R2; completion verifies size, type and first bytes and discards a mismatch; completion is idempotent and recovers when storage finished but the database did not; cancel, failure and cleanup remove database rows first, conditionally on the upload still being pending, so a ready video can never be removed by them; a video is invisible to everyone but its uploader (including Admins) until ready; every playback link issued is audited, including renewals; the cover completion route carries the item id so no extra column is needed; a replaced cover file is deleted (the only deletion in this milestone; deleting videos waits for the Trash in milestone 6); the upload manager keeps state in memory only, so a reload ends the sending and the folder page offers Resume from the server's record of unfinished uploads; the abandoned-upload cleanup is an in-process hourly timer plus a command, which suits one API instance.
- `PROGRESS.md`: add "Done: milestone 3 (built; awaiting approval)" summarising what exists and the final test counts (copy the real counts from the last run), move the milestone 2 "In progress" text to done, and list the open items: Cloudflare account and bucket not created yet, so `npm run storage:check` has never been run against R2 (do this before relying on production uploads); the browser parts (real `<video>` playback, XHR progress, the local dev links through the Vite proxy) were verified only with automated tests, not in a real browser; ask the user to try an upload and a playback in a browser.

- [ ] **Step 4: Final checks (run everything yourself and read the output)**

Run, from the repository root with the Node 24 PATH:

```bash
npm run lint
npm run build -w @jbf/api && npm run build -w @jbf/web
npm test -w @jbf/api
npm test -w @jbf/web
NODE_EXTRA_CA_CERTS=/private/tmp/claude-501/-Users-jbfit-Documents-GitHub-plms-web/54da702a-c25d-4d71-afc1-e140ab238f7f/scratchpad/ca.pem npm audit --audit-level=high
git status --short
git ls-files | grep -E '(^|/)\.storage/|\.env$' || echo "no storage or env files tracked"
grep -rnE "console\.log|eslint-disable|dangerouslySetInnerHTML|: any\b" apps/api/src apps/web/src --include=*.ts --include=*.tsx | grep -v "apps/api/src/cli" || echo "none found"
```

Expected: lint and both builds clean; every test passes (all milestone 1 and 2 tests included); audit exits 0 (report any high or critical advisory; moderate dev-only advisories are acceptable and must be mentioned); `git status` shows only `vibe-coding-master-prompt.md` and `.claude/` untracked; the last two commands print their "none" messages. Record the test counts in `PROGRESS.md`.

- [ ] **Step 5: Smoke test against the development database (no Cloudflare)**

With the API's development database migrated (`npm run db:migrate -w @jbf/api`), run `npm run storage:cleanup -w @jbf/api` (expect `Removed 0 abandoned uploads.`) and `npm run storage:check -w @jbf/api` (expect exit 1 with the "Set STORAGE_DRIVER=r2…" message). Do not create an admin or start the servers unless the user asks; the manual browser check below is the user's.

- [ ] **Step 6: Commit**

```bash
git add -A docs ARCHITECTURE.md README.md PROGRESS.md CHANGELOG.md DECISIONS.md
git commit -m "docs: add the storage guide, media API contract and milestone 3 notes"
```

**Manual check for the person approving the milestone (not part of automated verification):** (1) start the API and web app with the default local storage, sign in, open **Videos**, create a folder; (2) upload a small MP4 with a cover and watch the corner panel; open the video from the list and seek around in it; (3) start a second upload, close the tab midway, sign in again, open the folder and use **Resume** with the same file; (4) as an Admin open **Audit log** and confirm the entries (folder created, upload started/finished, video added, played) read clearly and show no links; (5) before production: follow `docs/storage.md` and run `npm run storage:check`.
