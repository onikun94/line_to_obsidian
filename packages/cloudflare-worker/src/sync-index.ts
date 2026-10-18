// KV is eventually consistent. Periodically rebuild even an unchanged index so
// delayed writes, old deployments and a failed activity write cannot hide data.
export const SYNC_INDEX_TTL = 6 * 60 * 60;

interface Activity {
  revision: string;
  key: string;
}

interface SyncIndex {
  keys: string[];
  createdAt: number;
}

function activityKey(prefix: string): string {
  return `_sync/activity/${prefix}`;
}

export async function recordSyncActivity(
  kv: KVNamespace, prefix: string, key: string, expirationTtl: number,
): Promise<void> {
  await kv.put(activityKey(prefix), JSON.stringify({
    revision: crypto.randomUUID(), key,
  } satisfies Activity), { expirationTtl });
}

/** Keep the existing array response, including support for unmodified clients. */
export async function getPendingMessages<T extends { synced?: boolean }>(
  kv: KVNamespace, prefix: string,
): Promise<T[]> {
  // Capture the generation BEFORE listing. An arrival during this request gets
  // its own index key and can never be cleared by this request finishing late.
  const activity = await kv.get<Activity>(activityKey(prefix), 'json');
  const indexKey = `_sync/index/${prefix}${activity?.revision ?? 'legacy'}`;
  const cached = await kv.get<SyncIndex>(indexKey, 'json');
  const usable = cached && Date.now() - cached.createdAt < SYNC_INDEX_TTL * 1000;
  let keys: string[];
  let cacheable = true;
  if (usable) {
    keys = cached.keys;
  } else {
    keys = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, ...(cursor ? { cursor } : {}) });
      keys.push(...page.keys.map(key => key.name));
      if (page.list_complete !== false) break;
      if (!page.cursor || page.cursor === cursor) {
        throw new Error('KV returned an incomplete message listing without a new cursor');
      }
      cursor = page.cursor;
    } while (cursor !== undefined);
    // The activity and payload can propagate separately. Do not persist an
    // incomplete listing that has not yet seen the event that invalidated it.
    cacheable = !activity || keys.includes(activity.key);
  }

  const pending: T[] = [];
  const pendingKeys: string[] = [];
  for (const key of keys) {
    // A failed read must not be mistaken for an empty, fully synced inbox.
    const message = await kv.get<T>(key, 'json');
    if (!message) {
      // A listed key can arrive before its value is visible. Retain it for a
      // later get instead of caching a false "nothing pending" result.
      pendingKeys.push(key);
    } else if (!message.synced) {
      pending.push(message);
      pendingKeys.push(key);
    }
  }

  if (cacheable && (!usable || pendingKeys.length !== keys.length)) {
    const index: SyncIndex = {
      keys: pendingKeys,
      // Compacting after acknowledgments must not postpone reconciliation.
      createdAt: usable ? cached.createdAt : Date.now(),
    };
    try {
      await kv.put(indexKey, JSON.stringify(index), {
        expirationTtl: Math.max(60, Math.ceil(
          (index.createdAt + SYNC_INDEX_TTL * 1000 - Date.now()) / 1000,
        )),
      });
    } catch {
      // Cache writes are an optimization; never fail delivery after reading it.
      console.warn('Unable to cache sync index');
    }
  }
  return pending;
}
