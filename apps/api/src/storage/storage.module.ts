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
