import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DevStorageController } from './dev-storage.controller';
import { LocalStorage } from './local.storage';
import { R2Storage, createR2Client } from './r2.storage';
import { STORAGE, type StoragePort } from './storage.port';

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

@Global()
@Module({
  controllers: [DevStorageController],
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: createStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
