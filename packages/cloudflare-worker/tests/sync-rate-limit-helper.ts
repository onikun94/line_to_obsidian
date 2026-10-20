import { SyncRateLimiter } from '../src/sync-rate-limit';

export function createLimiterState() {
  const values = new Map<string, unknown>();
  let pending = Promise.resolve();
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value); },
    transaction: <T>(callback: (store: unknown) => Promise<T>): Promise<T> => {
      const result = pending.then(() => callback(storage));
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { storage } as unknown as DurableObjectState;
}

export function createSyncRateLimiterNamespace() {
  const objects = new Map<string, SyncRateLimiter>();
  return {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: (url: string, init?: RequestInit) => {
        let object = objects.get(name);
        if (!object) {
          object = new SyncRateLimiter(createLimiterState());
          objects.set(name, object);
        }
        return object.fetch(new Request(url, init));
      },
    }),
  };
}
