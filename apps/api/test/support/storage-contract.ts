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
      // Large enough to be a legal non-last piece, so only the missing piece 2 can be the reason for the refusal.
      const only = await uploadPiece(key, uploadId, 1, filled(MIN_PART_SIZE, 7));
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
