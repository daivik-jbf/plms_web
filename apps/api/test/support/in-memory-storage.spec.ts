import { InMemoryStorage } from './in-memory-storage';
import { describeStorageContract } from './storage-contract';

describeStorageContract('InMemoryStorage', async () => {
  const storage = new InMemoryStorage();
  return {
    storage,
    putPart: async (url, body) => ({ status: 200, etag: storage.putPart(url, body).etag }),
    putObject: async (url, body) => {
      storage.putObject(url, body);
      return { status: 200 };
    },
    get: async (url, range) => storage.get(url, range),
    close: async () => undefined,
  };
});
