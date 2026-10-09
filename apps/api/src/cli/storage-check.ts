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
