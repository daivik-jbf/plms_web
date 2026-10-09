import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { MAX_COVER_BYTES, MIN_PART_SIZE, PART_SIZE } from './storage.constants';
import { type LinkPayload, signLink, verifyLink } from './signed-token';
import { type ObjectInfo, type StoragePort, StorageError, type StoredPart } from './storage.port';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^(videos|audio|covers)/${UUID}$`);
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
    // An empty object has no bytes to stream (and no valid byte range).
    if (info.size === 0) return { stream: Readable.from([]), size: 0, start: 0, end: -1, contentType: info.contentType };
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const stream = createReadStream(this.objectPath(key), { start, end });
    // Wait until the file is really open: a file that vanished after the check above must surface here, as an
    // error the caller can answer, and not later as an unhandled stream error.
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
      });
    } catch (error) {
      stream.destroy();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageError('not_found', 'No such object.');
      throw error;
    }
    return { stream, size: info.size, start, end, contentType: info.contentType };
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
