import { randomUUID } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
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

  it('accepts audio keys and still refuses audio-looking keys that could escape or are not exact', async () => {
    const k = `audio/${randomUUID()}`;
    const uploadId = await storage.createMultipartUpload(k, 'audio/mpeg');
    await storage.abortMultipartUpload(k, uploadId);
    await expect(storage.head('audio/../videos/x')).rejects.toThrow('Invalid storage key');
    await expect(storage.presignGet(`audio/${randomUUID()}/../../x`, 60, { contentType: 'audio/mpeg' })).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`audios/${randomUUID()}`, 'audio/mpeg')).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload(`AUDIO/${randomUUID()}`, 'audio/mpeg')).rejects.toThrow('Invalid storage key');
    await expect(storage.createMultipartUpload('audio/not-a-uuid', 'audio/mpeg')).rejects.toThrow('Invalid storage key');
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

  it('reads back an empty object as an empty 200 and answers 416 to any range', async () => {
    const k = `covers/${randomUUID()}`;
    const put = await storage.presignPut(k, 'image/png', 3600);
    expect((await http().put(put).set('Content-Type', 'image/png').send(Buffer.alloc(0))).status).toBe(200);
    expect(await storage.head(k)).toEqual({ size: 0, contentType: 'image/png' });
    const url = await storage.presignGet(k, 3600, { contentType: 'image/png' });
    const whole = await http().get(url).buffer(true).parse(binary);
    expect(whole.status).toBe(200);
    expect(whole.headers['content-length']).toBe('0');
    expect((whole.body as Buffer).length).toBe(0);
    expect((await http().get(url).set('Range', 'bytes=0-').buffer(true).parse(binary)).status).toBe(416);
    expect((await http().get(url).set('Range', 'bytes=-5').buffer(true).parse(binary)).status).toBe(416);
  });

  it('answers 404 and keeps running when the file vanishes between the check and the read', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const piece = await storage.presignUploadPart(k, uploadId, 1, 3600);
    const etag = (await http().put(piece).set('Content-Type', 'application/octet-stream').send(Buffer.from('0123456789'))).headers.etag as string;
    await storage.completeMultipartUpload(k, uploadId, [{ partNumber: 1, etag }]);
    const url = await storage.presignGet(k, 3600, { contentType: 'video/mp4' });
    const info = { size: 10, contentType: 'video/mp4' };
    const head = jest.spyOn(storage, 'head').mockResolvedValueOnce(info).mockResolvedValueOnce(info);
    await storage.delete(k);
    const res = await http().get(url);
    head.mockRestore();
    expect(res.status).toBe(404);
    expect((await http().get(url)).status).toBe(404);
  });

  it('closes the file when the viewer abandons a download midway', async () => {
    const k = key();
    const uploadId = await storage.createMultipartUpload(k, 'video/mp4');
    const piece = await storage.presignUploadPart(k, uploadId, 1, 3600);
    const etag = (await http().put(piece).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(PART_SIZE))).headers.etag as string;
    await storage.completeMultipartUpload(k, uploadId, [{ partNumber: 1, etag }]);
    const url = await storage.presignGet(k, 3600, { contentType: 'video/mp4' });

    let opened: Readable | undefined;
    const original = storage.openObject.bind(storage);
    const spy = jest.spyOn(storage, 'openObject').mockImplementation(async (...args) => {
      const result = await original(...args);
      opened = result.stream;
      return result;
    });
    const server = app.getHttpServer().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => {
      const outgoing = httpGet({ host: '127.0.0.1', port, path: url }, (response) => {
        response.once('data', () => {
          outgoing.destroy();
          resolve();
        });
      });
      outgoing.on('error', () => undefined);
      setTimeout(() => reject(new Error('no data arrived')), 5000).unref();
    });
    for (let waited = 0; !opened?.destroyed && waited < 3000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    spy.mockRestore();
    expect(opened?.destroyed).toBe(true);
  }, 15_000);
});
