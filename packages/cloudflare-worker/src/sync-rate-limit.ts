import type { MiddlewareHandler } from 'hono';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
type SyncApi = 'messages' | 'images' | 'subscription';

// One object per LINE account, shared by all Worker instances and locations.
// This storage is SQLite-backed Durable Object storage, not Workers KV.
export class SyncRateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const api = new URL(request.url).pathname.slice(1);
    if (!['messages', 'images', 'subscription'].includes(api)) {
      return new Response('Not found', { status: 404 });
    }

    const retryAfter = await this.state.storage.transaction(async storage => {
      const now = Date.now();
      const nextAllowedAt = await storage.get<number>(api) ?? 0;
      if (now < nextAllowedAt) {
        return Math.ceil((nextAllowedAt - now) / 1000);
      }
      await storage.put(api, now + SYNC_INTERVAL_MS);
      return 0;
    });

    if (retryAfter > 0) {
      return Response.json({ error: 'Too many requests', retryAfter }, {
        status: 429,
        headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
      });
    }
    return new Response(null, { status: 204 });
  }
}

export function limitSyncRequests(api: SyncApi, accountParam: string): MiddlewareHandler {
  return async (c, next) => {
    const accountId = c.req.param(accountParam);
    if (!accountId) return c.json({ error: 'Missing userId parameter' }, 400);

    // Keep account identifiers out of the public source and deployment bundle.
    // Unlisted users never call the limiter or spend Durable Object operations.
    const accounts = (c.env.SYNC_RATE_LIMIT_ACCOUNTS as string | undefined) ?? '';
    if (!accounts.split(',').some(value => value.trim() === accountId)) {
      await next();
      return;
    }

    try {
      const namespace = c.env.SYNC_RATE_LIMITER as DurableObjectNamespace;
      const limiter = namespace.get(namespace.idFromName(accountId));
      const result = await limiter.fetch(`https://sync-rate-limit/${api}`, { method: 'POST' });
      if (result.status === 429) return result;
      if (result.status !== 204) throw new Error('Unexpected rate limiter response');
    } catch {
      // Fail closed: never spend KV operations when the guard is unavailable.
      return c.json({ error: 'Sync temporarily unavailable' }, 503, {
        'Retry-After': '300', 'Cache-Control': 'no-store',
      });
    }

    await next();
  };
}
