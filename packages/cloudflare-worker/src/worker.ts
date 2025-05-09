import { Hono } from 'hono';
import { cors } from 'hono/cors'
import type { Context } from 'hono';
import * as line from '@line/bot-sdk';

interface Bindings {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_MESSAGES: KVNamespace;
  LINE_USER_MAPPINGS: KVNamespace;
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
}

const app = new Hono<{ Bindings: Bindings }>();

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
    
    console.log(`Successfully retrieved ${messages.length} messages`);
    return c.json(messages);
  } catch (err) {
    console.error('Error in /messages/:vaultId/:userId:', err);
    return c.json({
      error: 'Failed to fetch messages',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// 後方互換性のために古いエンドポイントをリダイレクト(Obsidianにリリースされたら削除)
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

    console.log(`Updating sync status for ${messageIds.length} messages in vault ${vaultId}`);

    for (const messageId of messageIds) {
      const key = `${vaultId}/${userId}/${messageId}`;
      try {
        const message = await c.env.LINE_MESSAGES.get(key, 'json') as LineMessage | null;
        
        if (message) {
          message.synced = true;
          await c.env.LINE_MESSAGES.put(key, JSON.stringify(message), {
            expirationTtl: 60 * 60 * 24 * 10 // Keep the same expiration
          });
          console.log(`Updated sync status for message ${messageId}`);
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
    console.log('Received webhook');
    
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
    console.log(`Processing ${events.length} events`);
    
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

        const message: LineMessage = {
          timestamp: event.timestamp,
          messageId: event.message.id,
          userId: userId,
          text: event.message.text,
          vaultId: vaultId,
          synced: false
        };

        await c.env.LINE_MESSAGES.put(
          `${vaultId}/${userId}/${event.message.id}`,
          JSON.stringify(message),
          { expirationTtl: 60 * 60 * 24 * 10 }
        );
        
        console.log(`Saved message: ${event.message.id} for vault: ${vaultId} and user: ${userId}`);
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

export default app; 