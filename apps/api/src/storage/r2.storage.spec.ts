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

  it('sends the pieces to the service as given', async () => {
    const { send, storage } = fake();
    send.mockResolvedValueOnce({});
    await storage.completeMultipartUpload(KEY, 'up-1', [{ partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' }]);
    expect(input(0, send).input).toMatchObject({
      UploadId: 'up-1',
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"a"' }, { PartNumber: 2, ETag: '"b"' }] },
    });
  });

  it('rejects an out-of-order or duplicated list through the service error mapping', async () => {
    const { send, storage } = fake();
    send.mockRejectedValue(Object.assign(new Error('x'), { name: 'InvalidPartOrder' }));
    await expect(
      storage.completeMultipartUpload(KEY, 'up-1', [{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a"' }]),
    ).rejects.toMatchObject({ code: 'invalid_part' });
    await expect(
      storage.completeMultipartUpload(KEY, 'up-1', [{ partNumber: 1, etag: '"a"' }, { partNumber: 1, etag: '"a"' }]),
    ).rejects.toMatchObject({ code: 'invalid_part' });
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
