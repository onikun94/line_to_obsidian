import { Hono } from 'hono';
import { cors } from 'hono/cors'
import type { Context } from 'hono';
import * as line from '@line/bot-sdk';
import { createCheckoutSession, createPortalSession, verifyWebhookSignature } from './stripe/client';
import {
  getSubscription,
  updateSubscription,
  canSendImage,
  incrementImageCount,
  toSubscriptionResponse,
  findUserByCustomerId,
  saveCustomerIndex
} from './stripe/subscription';
import type { SubscriptionData, StripeSubscription, StripeInvoice } from './stripe/types';

interface Bindings {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_MESSAGES: KVNamespace;
  LINE_USER_MAPPINGS: KVNamespace;
  LINE_PUBLIC_KEYS: KVNamespace;
  LINE_IMAGES: R2Bucket;
  LINE_SUBSCRIPTIONS: KVNamespace;
  NOTE_FOLDER_PATH: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  STRIPE_PUBLISHABLE_KEY: string;
  PAYMENT_PAGE_URL: string;
  [key: string]: string | KVNamespace | R2Bucket;
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

// Maximum image size: 10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
// Image expiration: 7 days
const IMAGE_EXPIRATION_TTL = 60 * 60 * 24 * 7;

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
            expirationTtl: 60 * 60 * 24 * 10
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
    const isValid = line.validateSignature(body, c.env.LINE_CHANNEL_SECRET, signature);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const events = JSON.parse(body).events as line.WebhookEvent[];
    
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        if (!userId) {
          console.error('Missing userId in event');
          continue;
        }

        // Handle /myid command - always show LINE User ID regardless of mapping status
        if (event.message.text === '/myid' || event.message.text === 'IDを確認') {
          const client = new line.Client({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
          });
          const existingVaultId = await getVaultIdForUser(c, userId);

          const replyText = existingVaultId
            ? `あなたのLINE User ID: ${userId}\n\n現在 Vault と連携中です。\n別のVaultに変更したい場合は、Obsidianプラグインの設定から「Reset Mapping」を実行してください。`
            : `あなたのLINE User ID: ${userId}\n\nObsidianプラグインの設定画面でこのIDを入力し、「Register Mapping」をクリックしてください。`;

          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: replyText
          });
          continue;
        }

        // Handle /status command - show subscription plan and image usage
        if (event.message.text === '/status') {
          const client = new line.Client({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
          });
          const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

          let statusText: string;
          if (subscription.status === 'active') {
            statusText = `現在のプラン: プレミアム\n画像送信: 無制限\n\nサブスクリプションの管理はこちら:\n${c.env.PAYMENT_PAGE_URL}/portal.html?userId=${userId}`;
          } else if (subscription.status === 'past_due') {
            statusText = `現在のプラン: プレミアム（支払い遅延中）\n\n支払い状況を確認してください:\n${c.env.PAYMENT_PAGE_URL}/portal.html?userId=${userId}`;
          } else {
            const remaining = Math.max(0, subscription.freeLimit - subscription.imageCount);
            statusText = `現在のプラン: 無料\n画像送信: 残り${remaining}枚 / ${subscription.freeLimit}枚\n\nプレミアムプラン（月額300円）で画像送信が無制限に:\n${c.env.PAYMENT_PAGE_URL}?userId=${userId}`;
          }

          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: statusText
          });
          continue;
        }

        const vaultId = await getVaultIdForUser(c, userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId}`);
          const client = new line.Client({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
          });
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `Obsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度メッセージを送信してください。`
          });
          continue;
        }

        const publicKeyData = await c.env.LINE_PUBLIC_KEYS.get(`publickey/${userId}`, 'json') as PublicKeyData | null;
        
        let message: LineMessage;
        
        if (publicKeyData && publicKeyData.publicKey) {
          try {
            const aesKey = await crypto.subtle.generateKey(
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt']
            ) as CryptoKey;
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            const encoder = new TextEncoder();
            const encryptedContent = await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              aesKey,
              encoder.encode(event.message.text)
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
            
            message = {
              timestamp: event.timestamp,
              messageId: event.message.id,
              userId: userId,
              text: '',
              vaultId: vaultId,
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
            message = {
              timestamp: event.timestamp,
              messageId: event.message.id,
              userId: userId,
              text: event.message.text,
              vaultId: vaultId,
              synced: false,
              encrypted: false
            };
          }
        } else {
          message = {
            timestamp: event.timestamp,
            messageId: event.message.id,
            userId: userId,
            text: event.message.text,
            vaultId: vaultId,
            synced: false,
            encrypted: false
          };
        }

        await c.env.LINE_MESSAGES.put(
          `${vaultId}/${userId}/${event.message.id}`,
          JSON.stringify(message),
          { expirationTtl: 60 * 60 * 24 * 10 }
        );
      }

      // Handle image messages
      if (event.type === 'message' && event.message.type === 'image') {
        const userId = event.source.userId;
        if (!userId) {
          console.error('Missing userId in image event');
          continue;
        }

        const vaultId = await getVaultIdForUser(c, userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId} (image)`);
          const client = new line.Client({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
          });
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `画像を保存するにはObsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度画像を送信してください。`
          });
          continue;
        }

        // ===== Subscription check =====
        const subscription = await getSubscription(c.env.LINE_SUBSCRIPTIONS, userId);

        if (!canSendImage(subscription)) {
          const client = new line.Client({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
          });

          const limitMessage = subscription.status === 'free'
            ? `無料の画像送信枠（${subscription.freeLimit}枚）を使い切りました。\n\n引き続き画像を送信するには、プレミアムプラン（月額300円）へのアップグレードが必要です。\n\n▶ プレミアムプランに登録する\n${c.env.PAYMENT_PAGE_URL}?userId=${userId}`
            : `サブスクリプションの支払いに問題があります。\n\n▶ 支払い状況を確認する\n${c.env.PAYMENT_PAGE_URL}/portal.html?userId=${userId}`;

          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: limitMessage
          });

          console.log(`Image send blocked for user ${userId}: ${subscription.status}, count: ${subscription.imageCount}/${subscription.freeLimit}`);
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
            const client = new line.Client({
              channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
            });
            await client.replyMessage(event.replyToken, {
              type: 'text',
              text: '画像サイズが大きすぎます（上限: 10MB）。より小さい画像を送信してください。'
            });
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
                { name: 'AES-GCM', iv },
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
              const client = new line.Client({
                channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN
              });
              // Use pushMessage to avoid consuming replyToken
              await client.pushMessage(userId, {
                type: 'text',
                text: `無料の画像送信枠が残り3枚になりました。\n\n枠を使い切った後も画像を送信したい場合は、プレミアムプラン（月額300円）をご検討ください。\n\n▶ プレミアムプランを見る\n${c.env.PAYMENT_PAGE_URL}?userId=${userId}`
              });
            }
          }
          // ===== End increment and notify =====
        } catch (err) {
          console.error(`Error processing image message ${event.message.id}:`, err);
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

    console.log(`Processing Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
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

        console.log(`Subscription activated for user: ${lineUserId}`);
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

        console.log(`Subscription updated for user: ${lineUserId}, status: ${status}`);
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

        console.log(`Subscription canceled for user: ${lineUserId}`);
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

        console.log(`Payment failed for user: ${lineUserId}`);
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
          console.log(`Payment recovered for user: ${lineUserId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
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