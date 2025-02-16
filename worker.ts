import { Hono } from 'hono';
import { cors } from 'hono/cors'
import type { Context } from 'hono';
import * as line from '@line/bot-sdk';

interface Bindings {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_MESSAGES: KVNamespace;  // KVストア
  NOTE_FOLDER_PATH: string;  // ノートの保存先フォルダ
  [key: string]: string | KVNamespace;
}

interface LineMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// CORSミドルウェアを追加
app.use('*', cors({
  origin: 'app://obsidian.md',
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// エラーハンドリングミドルウェア
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

// ヘルスチェックエンドポイント
app.get('/health', (c: Context) => c.json({ status: 'ok' }));

// メッセージ一覧取得エンドポイント
app.get('/messages/:vaultId', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    console.log(`Fetching messages for vaultId: ${vaultId}`);

    // KVストアの存在確認
    if (!c.env.LINE_MESSAGES) {
      console.error('LINE_MESSAGES KV namespace is not bound');
      return c.json({ error: 'KV store not configured' }, 500);
    }

    const messages: LineMessage[] = [];
    
    // KVストアからメッセージを取得
    const { keys } = await c.env.LINE_MESSAGES.list({ prefix: `${vaultId}/` });
    console.log(`Found ${keys.length} messages for vaultId: ${vaultId}`);

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
    console.error('Error in /messages/:vaultId:', err);
    return c.json({
      error: 'Failed to fetch messages',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// Webhookエンドポイント
app.post('/webhook/:vaultId', async (c: Context) => {
  try {
    const vaultId = c.req.param('vaultId');
    console.log(`Received webhook for vaultId: ${vaultId}`);
    
    // 署名の検証
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
    
    // メッセージイベントの処理
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const message: LineMessage = {
          timestamp: event.timestamp,
          messageId: event.message.id,
          userId: event.source.userId || 'unknown',
          text: event.message.text,
          vaultId: vaultId
        };

        // KVストアにメッセージを保存
        await c.env.LINE_MESSAGES.put(
          `${vaultId}/${event.message.id}`,
          JSON.stringify(message)
        );
        
        console.log(`Saved message: ${event.message.id}`);
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