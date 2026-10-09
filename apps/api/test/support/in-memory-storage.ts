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
