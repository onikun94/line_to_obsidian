import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../../src/worker';
import { createSyncRateLimiterNamespace } from '../sync-rate-limit-helper';

// 実際のHonoアプリにリクエストを通すルートレベルテスト。
// LINE署名・Stripe署名は実物と同じアルゴリズムで生成して検証を通す。

const LINE_CHANNEL_SECRET = 'test-channel-secret';
const STRIPE_WEBHOOK_SECRET = 'whsec_test';
const PAYMENT_PAGE_URL = 'https://pay.example.com';
const USER_ID = 'U' + 'a'.repeat(32);
const VAULT_ID = 'vault-1';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return Promise.resolve(null);
      return type === 'json' ? Promise.resolve(JSON.parse(value)) : Promise.resolve(value);
    }),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(({ prefix }: { prefix?: string } = {}) => Promise.resolve({
      keys: Array.from(store.keys())
        .filter(name => !prefix || name.startsWith(prefix))
        .map(name => ({ name })),
    })),
    _store: store,
  };
}

function createMockR2() {
  const store = new Map<string, ArrayBuffer>();
  return {
    put: vi.fn((key: string, value: ArrayBuffer) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    get: vi.fn((key: string) => {
      const value = store.get(key);
      if (!value) return Promise.resolve(null);
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(value) });
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    _store: store,
  };
}

async function lineSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(signed)));
}

async function stripeSignature(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

function lineApiCalls(kind: 'reply' | 'push'): { url: string; body: any }[] {
  return (global.fetch as any).mock.calls
    .filter(([url]: [string]) => String(url).includes(`api.line.me/v2/bot/message/${kind}`))
    .map(([url, init]: [string, RequestInit]) => ({ url: String(url), body: JSON.parse(String(init?.body)) }));
}

describe('Worker routes (実アプリ)', () => {
  afterEach(() => vi.restoreAllMocks());
  let env: Record<string, unknown>;
  let messagesKV: ReturnType<typeof createMockKV>;
  let mappingsKV: ReturnType<typeof createMockKV>;
  let publicKeysKV: ReturnType<typeof createMockKV>;
  let subscriptionsKV: ReturnType<typeof createMockKV>;
  let imagesR2: ReturnType<typeof createMockR2>;
  let aiRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    messagesKV = createMockKV();
    mappingsKV = createMockKV();
    publicKeysKV = createMockKV();
    subscriptionsKV = createMockKV();
    imagesR2 = createMockR2();
    aiRun = vi.fn();

    env = {
      SYNC_RATE_LIMITER: createSyncRateLimiterNamespace(),
      LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
      LINE_CHANNEL_SECRET,
      LINE_MESSAGES: messagesKV,
      LINE_USER_MAPPINGS: mappingsKV,
      LINE_PUBLIC_KEYS: publicKeysKV,
      LINE_SUBSCRIPTIONS: subscriptionsKV,
      LINE_IMAGES: imagesR2,
      AI: { run: aiRun },
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET,
      STRIPE_PRICE_ID: 'price_test',
      STRIPE_PUBLISHABLE_KEY: 'pk_test',
      PAYMENT_PAGE_URL,
    };

    (global.fetch as any).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('api-data.line.me')) {
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/aac' },
        });
      }
      if (u.includes('api.line.me/v2/bot/message')) {
        return new Response('{}', { status: 200 });
      }
      if (u.includes('api.stripe.com/v1/checkout/sessions')) {
        return new Response(JSON.stringify({
          id: 'cs_test',
          url: 'https://checkout.stripe.com/c/pay_test123',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { lineUserId: USER_ID },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
  });

  async function postWebhook(events: unknown[]): Promise<Response> {
    const body = JSON.stringify({ events });
    return app.request('/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': await lineSignature(body),
      },
      body,
    }, env as any);
  }

  describe('新着時だけKV一覧を再取得する同期', () => {
    it.each(['text', 'image', 'audio'])('%s受信で新着を検知し、再試行・同期完了後にはlistしない', async type => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      aiRun.mockResolvedValue({ text: 'transcript' });
      const route = type === 'image' ? 'images' : 'messages';
      const path = `/${route}/${VAULT_ID}/${USER_ID}`;
      let now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const get = () => {
        now += 5 * 60 * 1000;
        return app.request(path, {}, env as any);
      };
      expect(await (await get()).json()).toEqual([]);
      expect(await (await get()).json()).toEqual([]);
      expect(messagesKV.list).toHaveBeenCalledTimes(1);
      const received = await postWebhook([{
        type: 'message', timestamp: Date.now(), replyToken: 'test-reply',
        source: { userId: USER_ID },
        message: { id: 'new-message', type, text: 'hello' },
      }]);
      expect(received.status).toBe(200);
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await get();
        expect(result.status).toBe(200);
        expect(await result.json()).toEqual([expect.objectContaining({ messageId: 'new-message', synced: false })]);
      }
      expect(messagesKV.list).toHaveBeenCalledTimes(2);
      const acknowledged = await app.request(`/${route}/update-sync-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: VAULT_ID, userId: USER_ID, messageIds: ['new-message'] }),
      }, env as any);
      expect(acknowledged.status).toBe(200);
      expect(await (await get()).json()).toEqual([]);
      expect(await (await get()).json()).toEqual([]);
      expect(messagesKV.list).toHaveBeenCalledTimes(2);
    });
    it('認証失敗では一覧もキャッシュも読み出さない', async () => {
      mappingsKV._store.set(USER_ID, 'different-vault');
      const result = await app.request(`/messages/${VAULT_ID}/${USER_ID}`, {}, env as any);
      expect(result.status).toBe(403);
      expect(messagesKV.get).not.toHaveBeenCalled();
      expect(messagesKV.list).not.toHaveBeenCalled();
    });
  });

  describe('画像同期完了時のR2削除', () => {
    it('同期済みにした画像のR2オブジェクトを削除する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      const r2Key = `${VAULT_ID}/${USER_ID}/msg1`;
      const metadataKey = `image/${VAULT_ID}/${USER_ID}/msg1`;
      messagesKV._store.set(metadataKey, JSON.stringify({
        timestamp: 1700000000000,
        messageId: 'msg1',
        userId: USER_ID,
        vaultId: VAULT_ID,
        synced: false,
        type: 'image',
        contentType: 'image/jpeg',
        fileSize: 4,
        encrypted: false,
        r2Key,
      }));
      imagesR2._store.set(r2Key, new Uint8Array([1, 2, 3, 4]).buffer);

      const res = await app.request('/images/update-sync-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: VAULT_ID, userId: USER_ID, messageIds: ['msg1'] }),
      }, env as any);

      expect(res.status).toBe(200);
      expect(imagesR2.delete).toHaveBeenCalledWith(r2Key);
      expect(imagesR2._store.has(r2Key)).toBe(false);
      const metadata = JSON.parse(messagesKV._store.get(metadataKey)!);
      expect(metadata.synced).toBe(true);
    });
  });

  describe('アップグレードコマンド', () => {
    it('連携済みの無料ユーザーにはStripe CheckoutのURLを直接返信する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      const res = await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-1',
        source: { userId: USER_ID },
        message: { id: 'msg-up', type: 'text', text: 'アップグレード' },
      }]);

      expect(res.status).toBe(200);
      const replies = lineApiCalls('reply');
      expect(replies).toHaveLength(1);
      expect(replies[0].body.messages[0].text).toContain('https://checkout.stripe.com/c/pay_test123');
    });

    it('未連携ユーザーにはセットアップ手順を案内する', async () => {
      const res = await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-2',
        source: { userId: USER_ID },
        message: { id: 'msg-up2', type: 'text', text: '/upgrade' },
      }]);

      expect(res.status).toBe(200);
      const replies = lineApiCalls('reply');
      expect(replies).toHaveLength(1);
      expect(replies[0].body.messages[0].text).toContain('連携設定が必要');
      expect(replies[0].body.messages[0].text).toContain(USER_ID);
    });

    it('プレミアムユーザーには支払い管理ページのボタンを出す', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: 'cus_1',
        subscriptionId: 'sub_1',
        status: 'active',
        imageCount: 0,
        freeLimit: 10,
        voiceCount: 0,
        voiceFreeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      const res = await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-3',
        source: { userId: USER_ID },
        message: { id: 'msg-up3', type: 'text', text: 'アップグレード' },
      }]);

      expect(res.status).toBe(200);
      const message = lineApiCalls('reply')[0].body.messages[0];
      expect(message.text).toContain('すでにプレミアムプラン');
      expect(message.quickReply.items[0].action).toEqual({
        type: 'uri',
        label: '支払い管理',
        uri: `${PAYMENT_PAGE_URL}/portal.html?userId=${USER_ID}`,
      });
    });
  });

  describe('音声メッセージの文字起こし', () => {
    const audioEvent = {
      type: 'message',
      timestamp: 1700000000000,
      replyToken: 'reply-token-audio',
      source: { userId: USER_ID },
      message: { id: 'msg-audio1', type: 'audio' },
    };

    it('文字起こしをテキストメッセージとして保存し、プレビューを返信する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      aiRun.mockResolvedValue({ text: 'こんにちは、テストです' });

      const res = await postWebhook([audioEvent]);

      expect(res.status).toBe(200);
      expect(aiRun).toHaveBeenCalledWith('@cf/openai/whisper-large-v3-turbo', expect.objectContaining({
        audio: expect.any(String),
      }));

      // 文字起こし結果が通常のテキストメッセージとして保存される
      const stored = JSON.parse(messagesKV._store.get(`${VAULT_ID}/${USER_ID}/msg-audio1`)!);
      expect(stored.text).toBe('こんにちは、テストです');
      expect(stored.synced).toBe(false);

      // 音声カウントがインクリメントされる
      const subscription = JSON.parse(subscriptionsKV._store.get(USER_ID)!);
      expect(subscription.voiceCount).toBe(1);

      // プレビューと残り回数を返信する
      const replies = lineApiCalls('reply');
      expect(replies).toHaveLength(1);
      expect(replies[0].body.messages[0].text).toContain('こんにちは、テストです');
      expect(replies[0].body.messages[0].text).toContain('残り9回');
    });

    it('無料枠を使い切ったユーザーには文字起こしせずアップグレードを案内する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: '',
        subscriptionId: null,
        status: 'free',
        imageCount: 0,
        freeLimit: 10,
        voiceCount: 10,
        voiceFreeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      const res = await postWebhook([audioEvent]);

      expect(res.status).toBe(200);
      expect(aiRun).not.toHaveBeenCalled();
      expect(messagesKV._store.has(`${VAULT_ID}/${USER_ID}/msg-audio1`)).toBe(false);

      const message = lineApiCalls('reply')[0].body.messages[0];
      expect(message.text).toContain('使い切りました');
      // URLを本文に貼る代わりに、その場で押せるボタンを出す
      expect(message.quickReply.items.map((i: any) => i.action.label)).toEqual(['プレミアム登録', 'プラン確認']);
      expect(message.quickReply.items[0].action.uri).toBe(`${PAYMENT_PAGE_URL}/checkout.html?userId=${USER_ID}`);
    });

    it('未連携ユーザーにはセットアップ手順を案内する', async () => {
      const res = await postWebhook([audioEvent]);

      expect(res.status).toBe(200);
      expect(aiRun).not.toHaveBeenCalled();
      const replies = lineApiCalls('reply');
      expect(replies[0].body.messages[0].text).toContain('連携設定が必要');
    });
  });

  describe('クイックリプライ', () => {
    function replyQuickReply() {
      const message = lineApiCalls('reply')[0].body.messages[0];
      return message.quickReply?.items.map((i: any) => ({
        label: i.action.label,
        type: i.action.type,
        target: i.action.data ?? i.action.uri,
      }));
    }

    async function sendText(text: string) {
      return postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-qr',
        source: { userId: USER_ID },
        message: { id: `msg-${text}`, type: 'text', text },
      }]);
    }

    it('未連携ユーザーへの案内には「使い方」ボタンを付ける', async () => {
      await sendText('メモしたい内容');

      expect(replyQuickReply()).toEqual([
        { label: '使い方', type: 'postback', target: 'menu:help' },
      ]);
    });

    it('無料ユーザーの /status には料金ページを開く「プレミアム登録」を先頭に出す', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      await sendText('/status');

      // 課金導線はワンタップでページを開く uri アクション
      expect(replyQuickReply()).toEqual([
        { label: 'プレミアム登録', type: 'uri', target: `${PAYMENT_PAGE_URL}/checkout.html?userId=${USER_ID}` },
        { label: '使い方', type: 'postback', target: 'menu:help' },
      ]);
    });

    it('プレミアムユーザーの /status には支払い管理ページを開くボタンを出す', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', status: 'active',
        imageCount: 0, freeLimit: 10, voiceCount: 0, voiceFreeLimit: 10,
        currentPeriodEnd: null, createdAt: Date.now(), updatedAt: Date.now(),
      }));

      await sendText('/status');

      expect(replyQuickReply()[0]).toEqual({
        label: '支払い管理',
        type: 'uri',
        target: `${PAYMENT_PAGE_URL}/portal.html?userId=${USER_ID}`,
      });
    });

    it('プレミアムユーザーの /status には登録ボタンを出さない', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', status: 'active',
        imageCount: 0, freeLimit: 10, voiceCount: 0, voiceFreeLimit: 10,
        currentPeriodEnd: null, createdAt: Date.now(), updatedAt: Date.now(),
      }));

      await sendText('/status');

      expect(replyQuickReply().some((i: any) => i.label === 'プレミアム登録')).toBe(false);
    });

    it('決済リンクを返せたときはボタンを付けない（リンクを押させる）', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      await sendText('アップグレード');

      expect(replyQuickReply()).toBeUndefined();
    });

    it('音声の文字起こしは枠が残っていればボタンを出さない', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      aiRun.mockResolvedValue({ text: 'テスト' });

      await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-audio',
        source: { userId: USER_ID },
        message: { id: 'msg-audio-plenty', type: 'audio' },
      }]);

      expect(replyQuickReply()).toBeUndefined();
    });

    it('音声の残り枠が3回以下になったら「プレミアム登録」を出す', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: '', subscriptionId: null, status: 'free',
        imageCount: 0, freeLimit: 10, voiceCount: 7, voiceFreeLimit: 10,
        currentPeriodEnd: null, createdAt: Date.now(), updatedAt: Date.now(),
      }));
      aiRun.mockResolvedValue({ text: 'テスト' });

      await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-audio',
        source: { userId: USER_ID },
        message: { id: 'msg-audio-low', type: 'audio' },
      }]);

      const message = lineApiCalls('reply')[0].body.messages[0];
      expect(message.text).toContain('残り2回');
      expect(replyQuickReply()).toEqual([
        { label: 'プレミアム登録', type: 'uri', target: `${PAYMENT_PAGE_URL}/checkout.html?userId=${USER_ID}` },
      ]);
    });

    it('ボタンはpostbackならmenu:*、uriなら決済ページを指し、ラベルは20文字以内', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      await sendText('/status');

      for (const item of replyQuickReply()) {
        if (item.type === 'postback') {
          expect(['menu:help', 'menu:status', 'menu:upgrade']).toContain(item.target);
        } else {
          expect(item.target.startsWith(PAYMENT_PAGE_URL)).toBe(true);
          // uriアクションはユーザー個別のIDを引き継ぐので再入力が不要
          expect(item.target).toContain(`userId=${USER_ID}`);
        }
        expect(item.label.length).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('リッチメニューのpostback', () => {
    function postbackEvent(data: string) {
      return {
        type: 'postback',
        timestamp: 1700000000000,
        replyToken: 'reply-token-pb',
        source: { userId: USER_ID },
        postback: { data },
      };
    }

    it('menu:status はテキストの /status と同じ応答を返す', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      const viaPostback = await postWebhook([postbackEvent('menu:status')]);
      expect(viaPostback.status).toBe(200);
      const postbackReply = lineApiCalls('reply')[0].body.messages[0].text;

      vi.clearAllMocks();
      await postWebhook([{
        type: 'message',
        timestamp: 1700000000000,
        replyToken: 'reply-token-text',
        source: { userId: USER_ID },
        message: { id: 'msg-status', type: 'text', text: '/status' },
      }]);
      const textReply = lineApiCalls('reply')[0].body.messages[0].text;

      expect(postbackReply).toBe(textReply);
      expect(postbackReply).toContain('現在のプラン: 無料');
    });

    it('menu:upgrade はStripe CheckoutのURLを返信する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      const res = await postWebhook([postbackEvent('menu:upgrade')]);

      expect(res.status).toBe(200);
      expect(lineApiCalls('reply')[0].body.messages[0].text)
        .toContain('https://checkout.stripe.com/c/pay_test123');
    });

    it('menu:help は未連携ならLINE User IDつきのセットアップ手順を返す', async () => {
      const res = await postWebhook([postbackEvent('menu:help')]);

      expect(res.status).toBe(200);
      const text = lineApiCalls('reply')[0].body.messages[0].text;
      expect(text).toContain('使い方');
      expect(text).toContain(USER_ID);
      expect(text).toContain('Register Mapping');
      expect(text).toContain('https://note.com/shotovim/n/n55c363144d86');
    });

    it('menu:help は連携済みなら送れるものと無料枠を案内する', async () => {
      mappingsKV._store.set(USER_ID, VAULT_ID);

      const res = await postWebhook([postbackEvent('menu:help')]);

      expect(res.status).toBe(200);
      const text = lineApiCalls('reply')[0].body.messages[0].text;
      expect(text).toContain('音声メッセージ');
      expect(text).not.toContain('Register Mapping');
      expect(text).toContain('https://note.com/shotovim/n/n55c363144d86');
    });

    it('未知のpostback dataには返信しない', async () => {
      const res = await postWebhook([postbackEvent('menu:unknown')]);

      expect(res.status).toBe(200);
      expect(lineApiCalls('reply')).toHaveLength(0);
    });
  });

  describe('Stripe Webhook通知', () => {
    it('checkout.session.completed でKVを更新しLINEにpush通知する', async () => {
      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            url: '',
            customer: 'cus_1',
            subscription: 'sub_1',
            metadata: { lineUserId: USER_ID },
          },
        },
      });

      const res = await app.request('/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': await stripeSignature(payload),
        },
        body: payload,
      }, env as any);

      expect(res.status).toBe(200);

      const subscription = JSON.parse(subscriptionsKV._store.get(USER_ID)!);
      expect(subscription.status).toBe('active');

      const pushes = lineApiCalls('push');
      expect(pushes).toHaveLength(1);
      expect(pushes[0].body.to).toBe(USER_ID);
      expect(pushes[0].body.messages[0].text).toContain('プレミアムプランの登録が完了しました');
    });

    it('push通知の失敗はWebhook処理を失敗させない', async () => {
      (global.fetch as any).mockImplementation(async (url: string) => {
        if (String(url).includes('api.line.me/v2/bot/message/push')) {
          return new Response('error', { status: 500 });
        }
        return new Response('{}', { status: 200 });
      });

      const payload = JSON.stringify({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_2',
            url: '',
            customer: 'cus_2',
            subscription: 'sub_2',
            metadata: { lineUserId: USER_ID },
          },
        },
      });

      const res = await app.request('/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': await stripeSignature(payload),
        },
        body: payload,
      }, env as any);

      expect(res.status).toBe(200);
      const subscription = JSON.parse(subscriptionsKV._store.get(USER_ID)!);
      expect(subscription.status).toBe('active');
    });

    it('invoice.payment_failed でpast_dueに更新しLINEに通知する', async () => {
      subscriptionsKV._store.set(USER_ID, JSON.stringify({
        stripeCustomerId: 'cus_1',
        subscriptionId: 'sub_1',
        status: 'active',
        imageCount: 0,
        freeLimit: 10,
        voiceCount: 0,
        voiceFreeLimit: 10,
        currentPeriodEnd: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      subscriptionsKV._store.set('customer:cus_1', USER_ID);

      const payload = JSON.stringify({
        id: 'evt_3',
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1' } },
      });

      const res = await app.request('/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': await stripeSignature(payload),
        },
        body: payload,
      }, env as any);

      expect(res.status).toBe(200);
      const subscription = JSON.parse(subscriptionsKV._store.get(USER_ID)!);
      expect(subscription.status).toBe('past_due');

      const pushes = lineApiCalls('push');
      expect(pushes).toHaveLength(1);
      expect(pushes[0].body.messages[0].text).toContain('お支払いに失敗しました');
    });
  });
});
