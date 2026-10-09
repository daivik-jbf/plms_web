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
