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
      // By default the presigner leaves Content-Type out of the signature. Signing it binds the link to this type, so
      // the browser must send exactly this header.
      signableHeaders: new Set(['content-type']),
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
