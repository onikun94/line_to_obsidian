import { Hono } from 'hono';
import { cors } from 'hono/cors'
import type { Context } from 'hono';
import * as line from '@line/bot-sdk';

interface Bindings {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_MESSAGES: KVNamespace;
  LINE_USER_MAPPINGS: KVNamespace;
  LINE_PUBLIC_KEYS: KVNamespace;
  NOTE_FOLDER_PATH: string;
  [key: string]: string | KVNamespace;
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
  origin: 'app://obsidian.md',
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type'],
  exposeHeaders: ['Content-Length'],
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

export default app; 