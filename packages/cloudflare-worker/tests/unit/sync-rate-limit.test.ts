import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/worker';
import { SyncRateLimiter } from '../../src/sync-rate-limit';
import { createLimiterState, createSyncRateLimiterNamespace } from '../sync-rate-limit-helper';

afterEach(() => vi.useRealTimers());

describe('persistent sync cooldown', () => {
  it('keeps the original deadline on rejection and survives object recreation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const state = createLimiterState();
    const request = () => new Request('https://limiter/messages');
    const first = await new SyncRateLimiter(state).fetch(request());
    expect(first.status).toBe(204);

    vi.advanceTimersByTime(60_001);
    const restarted = new SyncRateLimiter(state);
    const rejected = await restarted.fetch(request());
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('Retry-After')).toBe('240');

    vi.advanceTimersByTime(239_998);
    expect((await restarted.fetch(request())).status).toBe(429);
    vi.advanceTimersByTime(1);
    expect((await restarted.fetch(request())).status).toBe(204);
  });
});

describe('Worker sync admission before KV', () => {
  function environment() {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ keys: [] }),
      put: vi.fn(), delete: vi.fn(),
    };
    return {
      kv,
      env: {
        SYNC_RATE_LIMIT_ACCOUNTS: 'user, another-target',
        SYNC_RATE_LIMITER: createSyncRateLimiterNamespace(),
        LINE_USER_MAPPINGS: kv, LINE_MESSAGES: kv, LINE_SUBSCRIPTIONS: kv,
      },
    };
  }

  it.each(['/messages/vault/user', '/images/vault/user', '/subscription/user'])(
    'rejects repeat %s without any additional KV calls', async path => {
      const { kv, env } = environment();
      await app.request(path, {}, env as any);
      Object.values(kv).forEach(mock => mock.mockClear());
      const response = await app.request(path, {}, env as any);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('300');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      Object.values(kv).forEach(mock => expect(mock).not.toHaveBeenCalled());
    },
  );

  it('separates accounts and APIs but does not let a changed vault bypass the limit', async () => {
    const { env } = environment();
    expect((await app.request('/messages/vault/user', {}, env as any)).status).toBe(403);
    expect((await app.request('/messages/other-vault/user', {}, env as any)).status).toBe(429);
    expect((await app.request('/messages/vault/other-user', {}, env as any)).status).toBe(403);
    expect((await app.request('/images/vault/user', {}, env as any)).status).toBe(403);
    expect((await app.request('/subscription/user', {}, env as any)).status).toBe(200);
  });

  it.each(['/messages/vault/other-user', '/images/vault/other-user', '/subscription/other-user'])(
    'never limits an unlisted account on %s or calls the Durable Object', async path => {
      const { kv, env } = environment();
      const get = vi.fn(() => { throw new Error('must not use limiter'); });
      const unlistedEnv = { ...env, SYNC_RATE_LIMITER: { get } };
      for (let i = 0; i < 10; i++) {
        const response = await app.request(path, {}, unlistedEnv as any);
        expect(response.status).toBe(path.startsWith('/subscription/') ? 200 : 403);
      }
      expect(get).not.toHaveBeenCalled();
      expect(kv.get).toHaveBeenCalledTimes(10);
    },
  );

  it('does not restrict anyone when the target secret is absent or empty', async () => {
    const { env } = environment();
    for (const targets of [undefined, '', '   ']) {
      for (let i = 0; i < 2; i++) {
        const result = await app.request('/subscription/user', {}, {
          ...env, SYNC_RATE_LIMIT_ACCOUNTS: targets, SYNC_RATE_LIMITER: undefined,
        } as any);
        expect(result.status).toBe(200);
      }
    }
  });

  it('does not bypass the cooldown through the legacy redirect', async () => {
    const { kv, env } = environment();
    await app.request('/messages/vault/user', {}, env as any);
    kv.get.mockClear();
    const redirect = await app.request('/messages/vault?userId=user', {}, env as any);
    expect(redirect.status).toBe(302);
    expect(kv.get).not.toHaveBeenCalled();
    const result = await app.request(redirect.headers.get('Location')!, {}, env as any);
    expect(result.status).toBe(429);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('allows only one simultaneous request into KV for the same account and API', async () => {
    const { kv, env } = environment();
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      app.request('/messages/vault/user', {}, env as any),
    ));
    expect(results.filter(result => result.status === 403)).toHaveLength(1);
    expect(results.filter(result => result.status === 429)).toHaveLength(9);
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('fails closed before KV when the binding is missing or unavailable', async () => {
    const { kv, env } = environment();
    for (const binding of [undefined, { idFromName: () => { throw new Error('unavailable'); } }]) {
      const response = await app.request('/messages/vault/user', {}, {
        ...env, SYNC_RATE_LIMITER: binding,
      } as any);
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('300');
      expect(kv.get).not.toHaveBeenCalled();
    }
  });

  it('leaves image downloads, health checks, and preflight outside the polling cooldown', async () => {
    const { env } = environment();
    await app.request('/images/vault/user', {}, env as any);
    expect((await app.request('/images/vault/user/id/content', {}, env as any)).status).toBe(403);
    expect((await app.request('/health', {}, env as any)).status).toBe(200);
    expect((await app.request('/messages/vault/user', { method: 'OPTIONS' }, env as any)).status).toBe(204);
  });
});
