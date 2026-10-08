import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  source: 'portal' | 'mobile' | 'system';
  appVersion: string | null;
}

const SYSTEM_META: RequestMeta = {
  requestId: 'system',
  ip: null,
  userAgent: null,
  source: 'system',
  appVersion: null,
};

const storage = new AsyncLocalStorage<RequestMeta>();

export const runWithRequestMeta = <T>(meta: RequestMeta, fn: () => T): T => storage.run(meta, fn);

export const currentRequestMeta = (): RequestMeta => storage.getStore() ?? SYSTEM_META;
