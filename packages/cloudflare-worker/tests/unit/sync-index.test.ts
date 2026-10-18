import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPendingMessages, recordSyncActivity, SYNC_INDEX_TTL } from '../../src/sync-index';

const prefix = 'vault/user/';
const key = `${prefix}message-1`;
function mockKV() {
  const values = new Map<string, string>();
  const calls = {
    get: vi.fn(async (name: string, type?: string) => {
      const value = values.get(name);
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (name: string, value: string) => { values.set(name, value); }),
    list: vi.fn(async (_options: unknown): Promise<any> => ({
      keys: [...values.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })),
      list_complete: true,
    })),
  };
  return { values, kv: calls as unknown as KVNamespace, calls };
}

describe('sync index', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('migrates an empty legacy inbox once and skips list on unchanged polls', async () => {
    const { kv, calls } = mockKV();
    for (let i = 0; i < 20; i++) expect(await getPendingMessages(kv, prefix)).toEqual([]);
    expect(calls.list).toHaveBeenCalledTimes(1);
    expect(calls.put).toHaveBeenCalledTimes(1);
  });
  it('retries pending delivery without list, then compacts after acknowledgement', async () => {
    const { kv, values, calls } = mockKV();
    values.set(key, JSON.stringify({ synced: false, text: 'hello' }));
    const pending = [{ synced: false, text: 'hello' }];
    expect(await getPendingMessages(kv, prefix)).toEqual(pending);
    expect(await getPendingMessages(kv, prefix)).toEqual(pending);
    values.set(key, JSON.stringify({ synced: true, text: 'hello' }));
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    expect(calls.list).toHaveBeenCalledTimes(1);
    expect(calls.get.mock.calls.filter(([name]) => name === key)).toHaveLength(3);
  });
  it('invalidates on arrival without invalidating the image stream', async () => {
    const { kv, values, calls } = mockKV();
    await getPendingMessages(kv, prefix);
    await getPendingMessages(kv, `image/${prefix}`);
    values.set(key, JSON.stringify({ synced: false }));
    await recordSyncActivity(kv, prefix, key, 86400);
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    await getPendingMessages(kv, `image/${prefix}`);
    expect(calls.list).toHaveBeenCalledTimes(3);
  });
  it('does not hide an arrival during an old scan finishing late', async () => {
    const { kv, values, calls } = mockKV();
    values.set(key, JSON.stringify({ synced: true }));
    await recordSyncActivity(kv, prefix, key, 86400);
    const nextKey = `${prefix}message-2`;
    calls.list.mockImplementationOnce(async () => {
      values.set(nextKey, JSON.stringify({ synced: false }));
      await recordSyncActivity(kv, prefix, nextKey, 86400);
      return { keys: [{ name: key }], list_complete: true };
    });
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    expect(calls.list).toHaveBeenCalledTimes(2);
  });
  it('does not cache a listing before the new activity key is visible', async () => {
    const { kv, values, calls } = mockKV();
    values.set(key, JSON.stringify({ synced: false }));
    await recordSyncActivity(kv, prefix, key, 86400);
    calls.list.mockResolvedValueOnce({ keys: [], list_complete: true });
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    expect(calls.list).toHaveBeenCalledTimes(2);
  });
  it('retains a key whose value is not visible yet', async () => {
    const { kv, values, calls } = mockKV();
    calls.list.mockResolvedValueOnce({ keys: [{ name: key }], list_complete: true });
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    values.set(key, JSON.stringify({ synced: false }));
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    expect(calls.list).toHaveBeenCalledTimes(1);
  });
  it('does not compact unreadable data away', async () => {
    const { kv, values } = mockKV();
    values.set(key, JSON.stringify({ synced: false }));
    await getPendingMessages(kv, prefix);
    values.set(key, 'invalid json');
    await expect(getPendingMessages(kv, prefix)).rejects.toThrow();
    values.set(key, JSON.stringify({ synced: false }));
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
  });
  it('reconciles delayed legacy writes after six hours', async () => {
    const { kv, values, calls } = mockKV();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await getPendingMessages(kv, prefix);
    values.set(key, JSON.stringify({ synced: false }));
    vi.mocked(Date.now).mockReturnValue(now + SYNC_INDEX_TTL * 1000 - 1);
    expect(await getPendingMessages(kv, prefix)).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(now + SYNC_INDEX_TTL * 1000);
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    expect(calls.list).toHaveBeenCalledTimes(2);
  });
  it('follows empty incomplete pages before caching the index', async () => {
    const { kv, values, calls } = mockKV();
    values.set(key, JSON.stringify({ synced: false }));
    calls.list.mockResolvedValueOnce({ keys: [], list_complete: false, cursor: 'next' });
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
    expect(calls.list).toHaveBeenNthCalledWith(2, { prefix, cursor: 'next' });
    await getPendingMessages(kv, prefix);
    expect(calls.list).toHaveBeenCalledTimes(2);
  });
  it('does not fail receipt when the activity hint hits a KV write limit', async () => {
    const { kv, calls } = mockKV();
    calls.put.mockRejectedValueOnce(new Error('same-key write rate exceeded'));
    await expect(recordSyncActivity(kv, prefix, key, 86400)).resolves.toBeUndefined();
  });
  it('delivers messages even when the optional index write fails', async () => {
    const { kv, values, calls } = mockKV();
    values.set(key, JSON.stringify({ synced: false }));
    calls.put.mockRejectedValueOnce(new Error('write quota exceeded'));
    expect(await getPendingMessages(kv, prefix)).toEqual([{ synced: false }]);
  });
});
