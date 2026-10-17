/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { cors } from 'hono/cors'
import type { Context } from 'hono';
import { createCheckoutSession, createPortalSession, verifyWebhookSignature } from './stripe/client';
import {
  getSubscription,
  updateSubscription,
  canSendImage,
  canUseVoice,
  incrementImageCount,
  incrementVoiceCount,
  toSubscriptionResponse,
  findUserByCustomerId,
  saveCustomerIndex
} from './stripe/subscription';
import type { SubscriptionData, StripeCheckoutSession, StripeSubscription, StripeInvoice } from './stripe/types';

// Workers AI binding (only the subset we call)
interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<{ text?: string }>;
}

interface Bindings {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_MESSAGES: KVNamespace;
  LINE_USER_MAPPINGS: KVNamespace;
  LINE_PUBLIC_KEYS: KVNamespace;
  LINE_IMAGES: R2Bucket;
  LINE_SUBSCRIPTIONS: KVNamespace;
  AI: AiBinding;
  NOTE_FOLDER_PATH: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  STRIPE_PUBLISHABLE_KEY: string;
  PAYMENT_PAGE_URL: string;
  [key: string]: string | KVNamespace | R2Bucket | AiBinding;
}

interface LineMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
  synced?: boolean;
  encrypted?: boolean;
  encryptedContent?: string;
  encryptedAESKey?: string;
  iv?: string;
  senderKeyId?: string;
  recipientUserId?: string;
  version?: string;
}

interface PublicKeyData {
  userId: string;
  publicKey: string;
  keyId: string;
  registeredAt: number;
}

interface ImageMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  vaultId: string;
  synced: boolean;
  type: 'image';
  contentType: string;
  fileSize: number;
  encrypted: boolean;
  encryptedAESKey?: string;
  iv?: string;
  senderKeyId?: string;
  recipientUserId?: string;
  version?: string;
  r2Key: string;
}

interface QuickReplyItem {
  type: 'action';
  action:
    | { type: 'postback'; label: string; data: string }
    | { type: 'uri'; label: string; uri: string };
}

interface LineTextMessage {
  type: 'text';
  text: string;
  quickReply?: { items: QuickReplyItem[] };
}

interface LineWebhookEvent {
  type: string;
  timestamp: number;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
  };
  postback?: {
    data: string;
  };
}

// Maximum image size: 10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
// Maximum audio size for voice transcription: 10MB
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
// Image expiration: 7 days
const IMAGE_EXPIRATION_TTL = 60 * 60 * 24 * 7;
// Text message expiration: 10 days
const TEXT_EXPIRATION_TTL = 60 * 60 * 24 * 10;
// Workers AI model for voice transcription
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

const app = new Hono<{ Bindings: Bindings }>();

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function validateLineSignature(body: string, channelSecret: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return timingSafeStringEqual(arrayBufferToBase64(signed), signature);
}

async function callLineMessageApi(
  channelAccessToken: string,
  endpoint: 'reply' | 'push',
  payload: unknown
): Promise<void> {
  const response = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`LINE ${endpoint} API failed: ${response.status}`);
  }
}

async function replyMessage(
  channelAccessToken: string,
  replyToken: string,
  messages: LineTextMessage[]
): Promise<void> {
  await callLineMessageApi(channelAccessToken, 'reply', { replyToken, messages });
}

async function pushMessage(
  channelAccessToken: string,
  to: string,
  messages: LineTextMessage[]
): Promise<void> {
  await callLineMessageApi(channelAccessToken, 'push', { to, messages });
}

app.use('*', cors({
  origin: ['app://obsidian.md', 'https://line-notes-sync.pages.dev'],
  allowMethods: ['GET', 'POST', 'DELETE'],
  allowHeaders: ['Content-Type', 'X-Vault-Id'],
  exposeHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400,
}));

app.use('*', async (c, next) => {
  try {
    await next();
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.get('/health', (c: Context) => c.json({ status: 'ok' }));

app.get('/messages/:vaultId/:userId', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    const userId = c.req.param('userId');
    
    if (!userId) {
      console.error('Missing userId parameter');
      return c.json({ error: 'Missing userId parameter' }, 400);
    }

    if (!c.env.LINE_MESSAGES) {
      console.error('LINE_MESSAGES KV namespace is not bound');
      return c.json({ error: 'KV store not configured' }, 500);
    }
    
    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      console.error(`Authentication failed: User ${userId} is not authorized for vault ${vaultId}`);
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    const messages: LineMessage[] = [];
    const { keys } = await c.env.LINE_MESSAGES.list({ prefix: `${vaultId}/${userId}/` });

    for (const key of keys) {
      try {
        const message = await c.env.LINE_MESSAGES.get(key.name, 'json');
        if (message) {
          messages.push(message as LineMessage);
        }
      } catch (err) {
        console.error(`Error fetching message ${key.name}:`, err);
      }
    }
    
    return c.json(messages);
  } catch (err) {
    console.error('Error in /messages/:vaultId/:userId:', err);
    return c.json({
      error: 'Failed to fetch messages',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.get('/messages/:vaultId', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    const userId = c.req.query('userId');
    
    if (!userId) {
      console.error('Missing userId parameter in legacy endpoint');
      return c.json({ error: 'Missing userId parameter' }, 400);
    }
    
    return c.redirect(`/messages/${vaultId}/${userId}`);
  } catch (err) {
    console.error('Error in legacy /messages/:vaultId endpoint:', err);
    return c.json({
      error: 'Failed to redirect',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

async function getVaultIdForUser(c: Context, userId: string): Promise<string | null> {
  try {
    return await c.env.LINE_USER_MAPPINGS.get(userId);
  } catch (err) {
    console.error(`Error fetching vault mapping for user ${userId}:`, err);
    return null;
  }
}

function checkoutUrlFor(c: Context, userId: string): string {
  return `${c.env.PAYMENT_PAGE_URL}/checkout.html?userId=${userId}`;
}

function portalUrlFor(c: Context, userId: string): string {
  return `${c.env.PAYMENT_PAGE_URL}/portal.html?userId=${userId}`;
}

// ===== Quick reply =====
// 入力欄の上に出るピル型ボタン。1メッセージ13個までだが、押すか次のメッセージが
// 送られると消えるため、常設の導線ではなく「その場で次の一手を示す」用途で使う。
// postback data はリッチメニューと同じものを使い、webhookのpostback分岐に合流する。

// 課金系（登録・支払い管理）はページを直接開く uri アクション。ワンタップで
// 料金と特典を見せられるので、Botの返信を1往復挟むより速い。
// 一方 プラン確認 は残り枠というユーザー個別のデータを返すため postback のまま。
type QuickReplyKey = 'help' | 'status' | 'upgrade' | 'billing';

function quickReplyItem(c: Context, userId: string, key: QuickReplyKey): QuickReplyItem {
  switch (key) {
    case 'help':
      return { type: 'action', action: { type: 'postback', label: '使い方', data: 'menu:help' } };
    case 'status':
      return { type: 'action', action: { type: 'postback', label: 'プラン確認', data: 'menu:status' } };
    case 'upgrade':
      return { type: 'action', action: { type: 'uri', label: 'プレミアム登録', uri: checkoutUrlFor(c, userId) } };
    case 'billing':
      return { type: 'action', action: { type: 'uri', label: '支払い管理', uri: portalUrlFor(c, userId) } };
  }
}

function quickReply(c: Context, userId: string, ...keys: QuickReplyKey[]): { items: QuickReplyItem[] } {
  return { items: keys.map(key => quickReplyItem(c, userId, key)) };
}

// ===== Bot command bodies =====
// テキストコマンドとリッチメニューのpostback・クイックリプライが同じ文面・同じ処理に
// 合流するよう、応答メッセージの組み立てをここに集約する。

async function buildMyIdMessage(c: Context, userId: string): Promise<LineTextMessage> {
  const existingVaultId = await getVaultIdForUser(c, userId);

  if (existingVaultId) {
    return {
      type: 'text',
      text: `あなたのLINE User ID: ${userId}\n\n現在 Vault と連携中です。\n別のVaultに変更したい場合は、Obsidianプラグインの設定から「Reset Mapping」を実行してください。`,
      quickReply: quickReply(c, userId, 'status', 'help')
    };
  }

  return {
    type: 'text',
    text: `あなたのLINE User ID: ${userId}\n\nObsidianプラグインの設定画面でこのIDを入力し、「Register Mapping」をクリックしてください。`,
    quickReply: quickReply(c, userId, 'help')
  };
}

async function buildStatusMessage(c: Context, userId: string): Promise<LineTextMessage> {
  const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

  if (subscription.status === 'active') {
    return {
      type: 'text',
      text: `現在のプラン: プレミアム\n画像送信・音声文字起こし: 無制限`,
      quickReply: quickReply(c, userId, 'billing', 'help')
    };
  }

  if (subscription.status === 'past_due') {
    return {
      type: 'text',
      text: `現在のプラン: プレミアム（支払い遅延中）\n\nお支払い方法をご確認ください。`,
      quickReply: quickReply(c, userId, 'billing')
    };
  }

  const remainingImages = Math.max(0, subscription.freeLimit - subscription.imageCount);
  const remainingVoice = Math.max(0, subscription.voiceFreeLimit - subscription.voiceCount);
  return {
    type: 'text',
    text: `現在のプラン: 無料\n画像送信: 残り${remainingImages}枚 / ${subscription.freeLimit}枚\n音声文字起こし: 残り${remainingVoice}回 / ${subscription.voiceFreeLimit}回\n\nプレミアムプラン（月額300円）で両方とも無制限になります。`,
    quickReply: quickReply(c, userId, 'upgrade', 'help')
  };
}

async function buildUpgradeMessage(c: Context, userId: string): Promise<LineTextMessage> {
  const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

  if (subscription.status === 'active') {
    return {
      type: 'text',
      text: `すでにプレミアムプランをご利用中です。`,
      quickReply: quickReply(c, userId, 'billing', 'status')
    };
  }

  const mappedVaultId = await getVaultIdForUser(c, userId);
  if (!mappedVaultId) {
    return {
      type: 'text',
      text: `プレミアムプランに登録する前に、Obsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定が終わったら、もう一度「プレミアム登録」を押してください。`,
      quickReply: quickReply(c, userId, 'help')
    };
  }

  try {
    const session = await createCheckoutSession({
      secretKey: c.env.STRIPE_SECRET_KEY,
      priceId: c.env.STRIPE_PRICE_ID,
      lineUserId: userId,
      successUrl: `${c.env.PAYMENT_PAGE_URL}/success.html`,
      cancelUrl: `${c.env.PAYMENT_PAGE_URL}/cancel.html`,
    });
    return {
      type: 'text',
      text: `プレミアムプラン（月額300円）の登録はこちらから:\n${session.url}\n\n・画像送信が無制限になります\n・音声メッセージの文字起こしが無制限になります\n\n※リンクの有効期限は24時間です`
    };
  } catch (err) {
    console.error('Failed to create checkout session from LINE command:', err);
    return {
      type: 'text',
      text: `決済リンクの作成に失敗しました。下のボタンから登録ページを開いてください。`,
      quickReply: quickReply(c, userId, 'upgrade')
    };
  }
}

const HELP_ARTICLE_URL = 'https://note.com/shotovim/n/n55c363144d86';

/**
 * 「使い方」の応答。連携済みかどうかで案内を変える。
 * 未連携ならセットアップ手順、連携済みなら送れるものと無料枠の案内。
 */
async function buildHelpMessage(c: Context, userId: string): Promise<LineTextMessage> {
  const vaultId = await getVaultIdForUser(c, userId);

  if (!vaultId) {
    return {
      type: 'text',
      text: `LINE Notes Sync の使い方\n\nまずObsidianとの連携設定が必要です。\n\n1. Obsidianのコミュニティプラグインから「LINE Notes Sync」をインストール\n2. プラグイン設定で Vault ID（任意の文字列）を入力\n3. LINE user ID に次の値を入力\n   ${userId}\n4. "Register Mapping"ボタンをクリック\n\n設定が終わったら、このトークにメッセージを送るだけでObsidianに同期されます。\n\n画像や音声の送信、料金プランなど詳しい使い方はこちら:\n${HELP_ARTICLE_URL}`
    };
  }

  return {
    type: 'text',
    text: `LINE Notes Sync の使い方\n\nこのトークに送ったものがObsidianに同期されます。\n\n・テキスト: 無制限\n・画像: 無料プランは累計10枚まで\n・音声メッセージ: 自動で文字起こし（無料プランは累計10回まで）\n\n同期はObsidian側で実行します（自動同期の間隔は設定画面から変更できます）。\n\n詳しい使い方はこちら:\n${HELP_ARTICLE_URL}`,
    quickReply: quickReply(c, userId, 'status')
  };
}
// ===== End bot command bodies =====

/**
 * Build a LineMessage for storage, encrypting the text with the user's
 * registered public key when available (falls back to plaintext).
 * Used for both incoming text messages and voice transcripts.
 */
async function buildTextMessage(
  c: Context,
  userId: string,
  vaultId: string,
  messageId: string,
  timestamp: number,
  text: string
): Promise<LineMessage> {
  const plainMessage: LineMessage = {
    timestamp,
    messageId,
    userId,
    text,
    vaultId,
    synced: false,
    encrypted: false
  };

  const publicKeyData = await c.env.LINE_PUBLIC_KEYS.get(`publickey/${userId}`, 'json') as PublicKeyData | null;
  if (!publicKeyData || !publicKeyData.publicKey) {
    return plainMessage;
  }

  try {
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    ) as CryptoKey;

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encoder = new TextEncoder();
    const encryptedContent = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer },
      aesKey,
      encoder.encode(text)
    );

    const publicKeyBase64 = pemToBase64(publicKeyData.publicKey);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToArrayBuffer(publicKeyBase64),
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      false,
      ['encrypt']
    );

    const exportedAesKey = await crypto.subtle.exportKey('raw', aesKey);
    const encryptedAesKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      exportedAesKey as ArrayBuffer
    );

    return {
      timestamp,
      messageId,
      userId,
      text: '',
      vaultId,
      synced: false,
      encrypted: true,
      encryptedContent: arrayBufferToBase64(encryptedContent),
      encryptedAESKey: arrayBufferToBase64(encryptedAesKey),
      iv: arrayBufferToBase64(iv),
      senderKeyId: publicKeyData.keyId,
      recipientUserId: userId,
      version: '1.0'
    };
  } catch (error) {
    console.error('Encryption failed:', error);
    console.error('Error details:', error instanceof Error ? error.stack : 'Unknown error');
    return plainMessage;
  }
}

app.post('/mapping', async (c: Context) => {
  try {
    const { userId, vaultId } = await c.req.json();
    if (!userId || !vaultId) {
      return c.json({ error: 'Missing userId or vaultId' }, 400);
    }

    await c.env.LINE_USER_MAPPINGS.put(userId, vaultId);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /mapping:', err);
    return c.json({
      error: 'Failed to set mapping',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.delete('/mapping', async (c: Context) => {
  try {
    const { userId, vaultId } = await c.req.json();
    if (!userId || !vaultId) {
      return c.json({ error: 'Missing userId or vaultId' }, 400);
    }

    // Verify that the vaultId matches before deleting
    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized: VaultId does not match' }, 403);
    }

    await c.env.LINE_USER_MAPPINGS.delete(userId);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in DELETE /mapping:', err);
    return c.json({
      error: 'Failed to delete mapping',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.post('/messages/update-sync-status', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { vaultId, messageIds, userId } = body;
    
    if (!vaultId || !messageIds || !Array.isArray(messageIds)) {
      return c.json({ error: 'Missing vaultId or messageIds' }, 400);
    }

    if (!userId) {
      return c.json({ error: 'Missing userId' }, 400);
    }
    
    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      console.error(`Authentication failed: User ${userId} is not authorized for vault ${vaultId}`);
      return c.json({ error: 'Unauthorized access' }, 403);
    }


    for (const messageId of messageIds) {
      const key = `${vaultId}/${userId}/${messageId}`;
      try {
        const message = await c.env.LINE_MESSAGES.get(key, 'json') as LineMessage | null;
        
        if (message) {
          message.synced = true;
          await c.env.LINE_MESSAGES.put(key, JSON.stringify(message), {
            expirationTtl: TEXT_EXPIRATION_TTL
          });
        } else {
          console.warn(`Message ${messageId} not found when updating sync status`);
        }
      } catch (err) {
        console.error(`Error updating sync status for message ${messageId}:`, err);
      }
    }
    
    return c.json({ status: 'ok', updated: messageIds.length });
  } catch (err) {
    console.error('Error in /messages/update-sync-status:', err);
    return c.json({
      error: 'Failed to update sync status',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.post('/webhook', async (c: Context) => {
  try {
    
    const signature = c.req.header('x-line-signature');
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const body = await c.req.text();
    const isValid = await validateLineSignature(body, c.env.LINE_CHANNEL_SECRET, signature);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const events = JSON.parse(body).events as LineWebhookEvent[];

    for (const event of events) {
      // リッチメニューのtap area(postback)。テキストコマンドと同じ処理に合流させる。
      if (event.type === 'postback') {
        const userId = event.source?.userId;
        const replyToken = event.replyToken;
        const data = event.postback?.data ?? '';
        if (!userId || !replyToken) {
          console.error('Missing userId or replyToken in postback event');
          continue;
        }

        let postbackMessage: LineTextMessage | null = null;
        if (data === 'menu:help') {
          postbackMessage = await buildHelpMessage(c, userId);
        } else if (data === 'menu:status') {
          postbackMessage = await buildStatusMessage(c, userId);
        } else if (data === 'menu:upgrade') {
          postbackMessage = await buildUpgradeMessage(c, userId);
        } else {
          console.warn(`unknown postback data: ${data}`);
        }

        if (postbackMessage) {
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [postbackMessage]
          );
        }
        continue;
      }

      if (event.type === 'message' && event.message?.type === 'text') {
        const userId = event.source?.userId;
        const replyToken = event.replyToken;
        const messageText = event.message.text ?? '';
        if (!userId || !replyToken) {
          console.error('Missing userId or replyToken in event');
          continue;
        }

        // Handle /myid command - always show LINE User ID regardless of mapping status
        if (messageText === '/myid' || messageText === 'IDを確認') {
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [await buildMyIdMessage(c, userId)]
          );
          continue;
        }

        // Handle /status command - show subscription plan and usage
        if (messageText === '/status') {
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [await buildStatusMessage(c, userId)]
          );
          continue;
        }

        // Handle upgrade command - reply with a Stripe Checkout link directly
        if (messageText === '/upgrade' || messageText === 'アップグレード') {
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [await buildUpgradeMessage(c, userId)]
          );
          continue;
        }

        const vaultId = await getVaultIdForUser(c, userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId}`);
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [{
              type: 'text',
              text: `Obsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度メッセージを送信してください。`,
              quickReply: quickReply(c, userId, 'help')
            }]
          );
          continue;
        }

        const message = await buildTextMessage(
          c,
          userId,
          vaultId,
          event.message.id,
          event.timestamp,
          messageText
        );

        await c.env.LINE_MESSAGES.put(
          `${vaultId}/${userId}/${event.message.id}`,
          JSON.stringify(message),
          { expirationTtl: TEXT_EXPIRATION_TTL }
        );
      }

      // Handle image messages
      if (event.type === 'message' && event.message?.type === 'image') {
        const userId = event.source?.userId;
        const replyToken = event.replyToken;
        if (!userId || !replyToken) {
          console.error('Missing userId or replyToken in image event');
          continue;
        }

        const vaultId = await getVaultIdForUser(c, userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId} (image)`);
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [{
              type: 'text',
              text: `画像を保存するにはObsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度画像を送信してください。`,
              quickReply: quickReply(c, userId, 'help')
            }]
          );
          continue;
        }

        // ===== Subscription check =====
        const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

        if (!canSendImage(subscription)) {
          // 無料枠を使い切った瞬間が最も課金意図が高いので、その場で登録ボタンを出す
          const limitMessage: LineTextMessage = subscription.status !== 'past_due'
            ? {
                type: 'text',
                text: `無料の画像送信枠（${subscription.freeLimit}枚）を使い切りました。\n\n引き続き画像を送信するには、プレミアムプラン（月額300円）へのアップグレードが必要です。`,
                quickReply: quickReply(c, userId, 'upgrade', 'status')
              }
            : {
                type: 'text',
                text: `サブスクリプションの支払いに問題があります。お支払い方法をご確認ください。`,
                quickReply: quickReply(c, userId, 'billing')
              };

          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [limitMessage]
          );

          continue;
        }
        // ===== End subscription check =====

        try {
          // Fetch image from LINE Content API
          const contentResponse = await fetch(
            `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
            {
              headers: {
                Authorization: `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`
              }
            }
          );

          if (!contentResponse.ok) {
            console.error(`Failed to fetch image content: ${contentResponse.status}`);
            continue;
          }

          const imageData = await contentResponse.arrayBuffer();
          const contentType = contentResponse.headers.get('Content-Type') || 'image/jpeg';

          // Check image size (10MB limit)
          if (imageData.byteLength > MAX_IMAGE_SIZE) {
            console.error(`Image too large: ${imageData.byteLength} bytes`);
            await replyMessage(
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              replyToken,
              [{
                type: 'text',
                text: '画像サイズが大きすぎます（上限: 10MB）。より小さい画像を送信してください。'
              }]
            );
            continue;
          }

          const publicKeyData = await c.env.LINE_PUBLIC_KEYS.get(`publickey/${userId}`, 'json') as PublicKeyData | null;
          const r2Key = `${vaultId}/${userId}/${event.message.id}`;

          let imageMessage: ImageMessage;

          if (publicKeyData && publicKeyData.publicKey) {
            try {
              // Generate AES key for image encryption
              const aesKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
              ) as CryptoKey;

              const iv = crypto.getRandomValues(new Uint8Array(12));

              // Encrypt image data
              const encryptedContent = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv.buffer },
                aesKey,
                imageData
              );

              // Encrypt AES key with public key
              const publicKeyBase64 = pemToBase64(publicKeyData.publicKey);
              const publicKey = await crypto.subtle.importKey(
                'spki',
                base64ToArrayBuffer(publicKeyBase64),
                {
                  name: 'RSA-OAEP',
                  hash: 'SHA-256'
                },
                false,
                ['encrypt']
              );

              const exportedAesKey = await crypto.subtle.exportKey('raw', aesKey);
              const encryptedAesKey = await crypto.subtle.encrypt(
                { name: 'RSA-OAEP' },
                publicKey,
                exportedAesKey as ArrayBuffer
              );

              // Store encrypted image in R2
              await c.env.LINE_IMAGES.put(r2Key, encryptedContent, {
                customMetadata: {
                  contentType,
                  originalSize: imageData.byteLength.toString(),
                  encrypted: 'true'
                }
              });

              imageMessage = {
                timestamp: event.timestamp,
                messageId: event.message.id,
                userId: userId,
                vaultId: vaultId,
                synced: false,
                type: 'image',
                contentType,
                fileSize: imageData.byteLength,
                encrypted: true,
                encryptedAESKey: arrayBufferToBase64(encryptedAesKey),
                iv: arrayBufferToBase64(iv),
                senderKeyId: publicKeyData.keyId,
                recipientUserId: userId,
                version: '1.0',
                r2Key
              };
            } catch (encryptError) {
              console.error('Image encryption failed:', encryptError);
              // Fall back to unencrypted storage
              await c.env.LINE_IMAGES.put(r2Key, imageData, {
                customMetadata: {
                  contentType,
                  originalSize: imageData.byteLength.toString(),
                  encrypted: 'false'
                }
              });

              imageMessage = {
                timestamp: event.timestamp,
                messageId: event.message.id,
                userId: userId,
                vaultId: vaultId,
                synced: false,
                type: 'image',
                contentType,
                fileSize: imageData.byteLength,
                encrypted: false,
                r2Key
              };
            }
          } else {
            // Store unencrypted image
            await c.env.LINE_IMAGES.put(r2Key, imageData, {
              customMetadata: {
                contentType,
                originalSize: imageData.byteLength.toString(),
                encrypted: 'false'
              }
            });

            imageMessage = {
              timestamp: event.timestamp,
              messageId: event.message.id,
              userId: userId,
              vaultId: vaultId,
              synced: false,
              type: 'image',
              contentType,
              fileSize: imageData.byteLength,
              encrypted: false,
              r2Key
            };
          }

          // Store image metadata in KV
          await c.env.LINE_MESSAGES.put(
            `image/${vaultId}/${userId}/${event.message.id}`,
            JSON.stringify(imageMessage),
            { expirationTtl: IMAGE_EXPIRATION_TTL }
          );

          // ===== Increment image count and notify if needed =====
          const newCount = await incrementImageCount(c.env.LINE_SUBSCRIPTIONS, userId);

          // Notify when 3 images remaining (for free users)
          if (subscription.status === 'free') {
            const remaining = subscription.freeLimit - newCount;
            if (remaining === 3) {
              // Use pushMessage to avoid consuming replyToken
              await pushMessage(
                c.env.LINE_CHANNEL_ACCESS_TOKEN,
                userId,
                [{
                  type: 'text',
                  text: `無料の画像送信枠が残り3枚になりました。\n\n枠を使い切った後も画像を送信したい場合は、プレミアムプラン（月額300円）をご検討ください。`,
                  quickReply: quickReply(c, userId, 'upgrade', 'status')
                }]
              );
            }
          }
          // ===== End increment and notify =====
        } catch (err) {
          console.error(`Error processing image message ${event.message.id}:`, err);
        }
      }

      // Handle audio (voice) messages - transcribe with Workers AI and store as text
      if (event.type === 'message' && event.message?.type === 'audio') {
        const userId = event.source?.userId;
        const replyToken = event.replyToken;
        if (!userId || !replyToken) {
          console.error('Missing userId or replyToken in audio event');
          continue;
        }

        const vaultId = await getVaultIdForUser(c, userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId} (audio)`);
          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [{
              type: 'text',
              text: `音声を文字起こしするにはObsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度音声を送信してください。`,
              quickReply: quickReply(c, userId, 'help')
            }]
          );
          continue;
        }

        // ===== Subscription check =====
        const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

        if (!canUseVoice(subscription)) {
          const limitMessage: LineTextMessage = subscription.status !== 'past_due'
            ? {
                type: 'text',
                text: `無料の音声文字起こし枠（${subscription.voiceFreeLimit}回）を使い切りました。\n\n引き続き音声を文字起こしするには、プレミアムプラン（月額300円）へのアップグレードが必要です。`,
                quickReply: quickReply(c, userId, 'upgrade', 'status')
              }
            : {
                type: 'text',
                text: `サブスクリプションの支払いに問題があります。お支払い方法をご確認ください。`,
                quickReply: quickReply(c, userId, 'billing')
              };

          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [limitMessage]
          );
          continue;
        }
        // ===== End subscription check =====

        try {
          // Fetch audio from LINE Content API
          const contentResponse = await fetch(
            `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
            {
              headers: {
                Authorization: `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`
              }
            }
          );

          if (!contentResponse.ok) {
            console.error(`Failed to fetch audio content: ${contentResponse.status}`);
            await replyMessage(
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              replyToken,
              [{
                type: 'text',
                text: '音声の取得に失敗しました。もう一度お試しください。'
              }]
            );
            continue;
          }

          const audioData = await contentResponse.arrayBuffer();

          if (audioData.byteLength > MAX_AUDIO_SIZE) {
            console.error(`Audio too large: ${audioData.byteLength} bytes`);
            await replyMessage(
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              replyToken,
              [{
                type: 'text',
                text: '音声ファイルが大きすぎます（上限: 10MB）。短めの音声で再度お試しください。'
              }]
            );
            continue;
          }

          // Transcribe with Workers AI. The audio itself is not stored anywhere;
          // only the transcript is saved (encrypted like a normal text message).
          const result = await c.env.AI.run(WHISPER_MODEL, {
            audio: arrayBufferToBase64(audioData)
          });

          const transcript = result.text?.trim();
          if (!transcript) {
            await replyMessage(
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              replyToken,
              [{
                type: 'text',
                text: '音声を認識できませんでした。もう一度お試しください。'
              }]
            );
            continue;
          }

          const message = await buildTextMessage(
            c,
            userId,
            vaultId,
            event.message.id,
            event.timestamp,
            transcript
          );

          await c.env.LINE_MESSAGES.put(
            `${vaultId}/${userId}/${event.message.id}`,
            JSON.stringify(message),
            { expirationTtl: TEXT_EXPIRATION_TTL }
          );

          const newCount = await incrementVoiceCount(c.env.LINE_SUBSCRIPTIONS, userId);

          const preview = transcript.length > 120 ? `${transcript.slice(0, 120)}…` : transcript;
          const voiceMessage: LineTextMessage = {
            type: 'text',
            text: `音声を文字起こししました:\n「${preview}」\n\n次回の同期でObsidianに保存されます。`
          };

          if (subscription.status === 'free' || subscription.status === 'canceled') {
            const remaining = Math.max(0, subscription.voiceFreeLimit - newCount);
            voiceMessage.text += `\n\n無料の文字起こし枠: 残り${remaining}回`;
            // 枠が尽きかけたときだけCTAを出す。毎回出すと通知が煩わしくなる。
            if (remaining <= 3) {
              voiceMessage.quickReply = quickReply(c, userId, 'upgrade');
            }
          }

          await replyMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken,
            [voiceMessage]
          );
        } catch (err) {
          console.error(`Error processing audio message ${event.message.id}:`, err);
          try {
            await replyMessage(
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              replyToken,
              [{
                type: 'text',
                text: '音声の処理に失敗しました。時間をおいて再度お試しください。'
              }]
            );
          } catch (replyErr) {
            console.error('Failed to send error reply for audio message:', replyErr);
          }
        }
      }
    }

    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /webhook:', err);
    return c.json({
      error: 'Webhook processing failed',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.post('/publickey/register', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userId, vaultId, publicKey, keyId } = body;
    
    if (!userId || !vaultId || !publicKey || !keyId) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }
    
    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }
    
    const keyData: PublicKeyData = {
      userId,
      publicKey,
      keyId,
      registeredAt: Date.now()
    };
    
    await c.env.LINE_PUBLIC_KEYS.put(
      `publickey/${userId}`,
      JSON.stringify(keyData),
      { expirationTtl: 60 * 60 * 24 * 365 }
    );
    
    return c.json({ success: true });
  } catch (err) {
    console.error('Error in /publickey/register:', err);
    return c.json({
      error: 'Failed to register public key',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.get('/publickey/:userId', async (c: Context) => {
  try {
    const userId = c.req.param('userId');
    const vaultId = c.req.header('X-Vault-Id');

    if (!userId) {
      return c.json({ error: 'Missing userId parameter' }, 400);
    }

    if (!vaultId) {
      return c.json({ error: 'Missing X-Vault-Id header' }, 400);
    }

    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    const keyData = await c.env.LINE_PUBLIC_KEYS.get(`publickey/${userId}`, 'json');
    if (!keyData) {
      return c.json({ error: 'Public key not found' }, 404);
    }

    return c.json(keyData as PublicKeyData);
  } catch (err) {
    console.error('Error in /publickey/:userId:', err);
    return c.json({
      error: 'Failed to fetch public key',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// Image endpoints
app.get('/images/:vaultId/:userId', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    const userId = c.req.param('userId');

    if (!userId) {
      return c.json({ error: 'Missing userId parameter' }, 400);
    }

    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    const images: ImageMessage[] = [];
    const { keys } = await c.env.LINE_MESSAGES.list({ prefix: `image/${vaultId}/${userId}/` });

    for (const key of keys) {
      try {
        const image = await c.env.LINE_MESSAGES.get(key.name, 'json');
        if (image) {
          images.push(image as ImageMessage);
        }
      } catch (err) {
        console.error(`Error fetching image metadata ${key.name}:`, err);
      }
    }

    return c.json(images);
  } catch (err) {
    console.error('Error in /images/:vaultId/:userId:', err);
    return c.json({
      error: 'Failed to fetch images',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.get('/images/:vaultId/:userId/:messageId/content', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    const userId = c.req.param('userId');
    const messageId = c.req.param('messageId');

    if (!userId || !messageId) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    // Get image metadata from KV
    const metadataKey = `image/${vaultId}/${userId}/${messageId}`;
    const metadata = await c.env.LINE_MESSAGES.get(metadataKey, 'json') as ImageMessage | null;

    if (!metadata) {
      return c.json({ error: 'Image not found' }, 404);
    }

    // Get image data from R2
    const r2Object = await c.env.LINE_IMAGES.get(metadata.r2Key);

    if (!r2Object) {
      return c.json({ error: 'Image data not found' }, 404);
    }

    const imageData = await r2Object.arrayBuffer();

    return new Response(imageData, {
      headers: {
        'Content-Type': metadata.contentType,
        'Content-Length': imageData.byteLength.toString(),
      }
    });
  } catch (err) {
    console.error('Error in /images/:vaultId/:userId/:messageId/content:', err);
    return c.json({
      error: 'Failed to fetch image content',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

app.post('/images/update-sync-status', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { vaultId, messageIds, userId } = body;

    if (!vaultId || !messageIds || !Array.isArray(messageIds)) {
      return c.json({ error: 'Missing vaultId or messageIds' }, 400);
    }

    if (!userId) {
      return c.json({ error: 'Missing userId' }, 400);
    }

    const storedVaultId = await getVaultIdForUser(c, userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    for (const messageId of messageIds) {
      const key = `image/${vaultId}/${userId}/${messageId}`;
      try {
        const image = await c.env.LINE_MESSAGES.get(key, 'json') as ImageMessage | null;

        if (image) {
          image.synced = true;
          await c.env.LINE_MESSAGES.put(key, JSON.stringify(image), {
            expirationTtl: IMAGE_EXPIRATION_TTL
          });

          // The plugin has already saved the image to the vault, so the R2
          // copy is no longer needed. Delete it to stop storage from growing.
          try {
            await c.env.LINE_IMAGES.delete(image.r2Key);
          } catch (deleteErr) {
            console.error(`Error deleting R2 object ${image.r2Key}:`, deleteErr);
          }
        }
      } catch (err) {
        console.error(`Error updating sync status for image ${messageId}:`, err);
      }
    }

    return c.json({ status: 'ok', updated: messageIds.length });
  } catch (err) {
    console.error('Error in /images/update-sync-status:', err);
    return c.json({
      error: 'Failed to update sync status',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// ==================== Stripe Payment Endpoints ====================

// Create Stripe Checkout Session
app.post('/stripe/create-checkout-session', async (c: Context) => {
  try {
    const { lineUserId } = await c.req.json();

    if (!lineUserId) {
      return c.json({ error: 'Missing lineUserId' }, 400);
    }

    // Validate LINE User ID format (starts with 'U' and has 33 characters)
    if (typeof lineUserId !== 'string' || !/^U[a-f0-9]{32}$/.test(lineUserId)) {
      return c.json({ error: 'Invalid lineUserId format' }, 400);
    }

    // Verify the user has a vault mapping (i.e., has used the service)
    const vaultId = await getVaultIdForUser(c, lineUserId);
    if (!vaultId) {
      return c.json({
        error: 'Vault not configured. Please set up the Obsidian plugin first.'
      }, 400);
    }

    const session = await createCheckoutSession({
      secretKey: c.env.STRIPE_SECRET_KEY,
      priceId: c.env.STRIPE_PRICE_ID,
      lineUserId,
      successUrl: `${c.env.PAYMENT_PAGE_URL}/success.html`,
      cancelUrl: `${c.env.PAYMENT_PAGE_URL}/cancel.html`,
    });

    return c.json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    return c.json({
      error: 'Failed to create checkout session',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// Stripe Webhook handler
app.post('/stripe/webhook', async (c: Context) => {
  try {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing stripe-signature header' }, 401);
    }

    const body = await c.req.text();

    // Verify webhook signature
    const event = await verifyWebhookSignature(
      body,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as StripeCheckoutSession;
        const lineUserId = session.metadata?.lineUserId;

        if (!lineUserId) {
          console.error('CRITICAL: LINE User ID not found in session metadata', {
            sessionId: session.id,
            customerId: session.customer,
          });
          // Return error to Stripe so they can retry or alert
          return c.json({ error: 'Missing lineUserId in metadata' }, 400);
        }

        await updateSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId, {
          stripeCustomerId: session.customer,
          subscriptionId: session.subscription,
          status: 'active',
        });

        // Save reverse index for efficient customer lookup
        if (session.customer) {
          await saveCustomerIndex(c.env.LINE_SUBSCRIPTIONS, session.customer, lineUserId);
        }

        // Notify the user on LINE. Failure here must not fail the webhook.
        try {
          await pushMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            lineUserId,
            [{
              type: 'text',
              text: `プレミアムプランの登録が完了しました。ありがとうございます！\n\n・画像送信が無制限になりました\n・音声メッセージの文字起こしが無制限になりました`,
              quickReply: quickReply(c, lineUserId, 'status', 'help')
            }]
          );
        } catch (pushErr) {
          console.error('Failed to send subscription confirmation to LINE:', pushErr);
        }

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as StripeSubscription;
        const customerId = subscription.customer;

        const lineUserId = await findUserByCustomerId(c.env.LINE_SUBSCRIPTIONS, customerId);
        if (!lineUserId) {
          console.error(`No LINE user found for customer: ${customerId} (subscription.updated)`, {
            subscriptionId: subscription.id,
            status: subscription.status,
          });
          // This is a data inconsistency - the customer exists in Stripe but not in our system
          // Return 200 to acknowledge receipt but log the error
          break;
        }

        // Map Stripe status to our status
        let status: SubscriptionData['status'] = 'free';
        if (subscription.status === 'active') {
          status = 'active';
        } else if (subscription.status === 'past_due') {
          status = 'past_due';
        } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
          status = 'canceled';
        }

        await updateSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId, {
          subscriptionId: subscription.id,
          status,
          currentPeriodEnd: subscription.current_period_end * 1000,
        });

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as StripeSubscription;
        const customerId = subscription.customer;

        const lineUserId = await findUserByCustomerId(c.env.LINE_SUBSCRIPTIONS, customerId);
        if (!lineUserId) {
          console.warn(`No LINE user found for customer: ${customerId} (subscription.deleted)`);
          break;
        }

        await updateSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId, {
          status: 'canceled',
          subscriptionId: null,
          currentPeriodEnd: null,
        });

        try {
          await pushMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            lineUserId,
            [{
              type: 'text',
              text: `プレミアムプランの解約が完了しました。ご利用ありがとうございました。\n\n無料プランでは画像送信・音声文字起こしがそれぞれ累計10回まで利用できます（過去の利用分を含む）。`,
              quickReply: quickReply(c, lineUserId, 'upgrade')
            }]
          );
        } catch (pushErr) {
          console.error('Failed to send cancellation notice to LINE:', pushErr);
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as StripeInvoice;
        const customerId = invoice.customer;

        const lineUserId = await findUserByCustomerId(c.env.LINE_SUBSCRIPTIONS, customerId);
        if (!lineUserId) {
          console.warn(`No LINE user found for customer: ${customerId} (invoice.payment_failed)`);
          break;
        }

        await updateSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId, {
          status: 'past_due',
        });

        try {
          await pushMessage(
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            lineUserId,
            [{
              type: 'text',
              text: `プレミアムプランのお支払いに失敗しました。\n\nプレミアム特典が停止する前に、お支払い方法をご確認ください。`,
              quickReply: quickReply(c, lineUserId, 'billing')
            }]
          );
        } catch (pushErr) {
          console.error('Failed to send payment failure notice to LINE:', pushErr);
        }

        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as StripeInvoice;
        const customerId = invoice.customer;

        const lineUserId = await findUserByCustomerId(c.env.LINE_SUBSCRIPTIONS, customerId);
        if (!lineUserId) {
          console.warn(`No LINE user found for customer: ${customerId} (invoice.paid)`);
          break;
        }

        const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId);
        if (subscription.status === 'past_due') {
          await updateSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId, {
            status: 'active',
          });
        }
        break;
      }

      default:
        break;
    }

    return c.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({
      error: 'Webhook processing failed',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 400);
  }
});

// Create Stripe Customer Portal Session
app.post('/stripe/create-portal-session', async (c: Context) => {
  try {
    const { lineUserId } = await c.req.json();

    if (!lineUserId) {
      return c.json({ error: 'Missing lineUserId' }, 400);
    }

    const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId);

    if (!subscription.stripeCustomerId) {
      return c.json({ error: 'No Stripe customer found. Please subscribe first.' }, 404);
    }

    const session = await createPortalSession({
      secretKey: c.env.STRIPE_SECRET_KEY,
      customerId: subscription.stripeCustomerId,
      returnUrl: c.env.PAYMENT_PAGE_URL,
    });

    return c.json({ url: session.url });
  } catch (err) {
    console.error('Error creating portal session:', err);
    return c.json({
      error: 'Failed to create portal session',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// Get subscription status
app.get('/subscription/:lineUserId', async (c: Context) => {
  try {
    const lineUserId = c.req.param('lineUserId');

    if (!lineUserId) {
      return c.json({ error: 'Missing lineUserId' }, 400);
    }

    const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, lineUserId);
    const response = toSubscriptionResponse(subscription);

    return c.json(response);
  } catch (err) {
    console.error('Error fetching subscription:', err);
    return c.json({
      error: 'Failed to fetch subscription',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

export default app;
