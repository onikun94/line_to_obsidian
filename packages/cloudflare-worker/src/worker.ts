import { validateSignature, type WebhookEvent } from '@line/bot-sdk';
import { MessagingApiClient } from '@line/bot-sdk/dist/messaging-api/api';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetchArticleMarkdown, isUrlOnly } from './lib/url-markdown-collector';

type LineMessage = {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
  synced?: boolean;
  isUrlOnly: boolean;
  article?: {
    url: string;
    title: string;
    description?: string;
    author?: string;
    image?: string;
    markdown: string;
  };
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: 'app://obsidian.md',
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  }),
);

app.use('*', async (c, next) => {
  try {
    await next();
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/messages/:vaultId/:userId', async (c) => {
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

    const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      console.error(
        `Authentication failed: User ${userId} is not authorized for vault ${vaultId}`,
      );
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    const messages: LineMessage[] = [];
    const { keys } = await c.env.LINE_MESSAGES.list({
      prefix: `${vaultId}/${userId}/`,
    });

    for (const key of keys) {
      try {
        const message = await c.env.LINE_MESSAGES.get<LineMessage>(
          key.name,
          'json',
        );
        if (message) {
          messages.push(message);
        }
      } catch (err) {
        console.error(`Error fetching message ${key.name}:`, err);
      }
    }

    return c.json(messages);
  } catch (err) {
    console.error('Error in /messages/:vaultId/:userId:', err);
    return c.json(
      {
        error: 'Failed to fetch messages',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

app.get('/messages/:vaultId', async (c) => {
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
    return c.json(
      {
        error: 'Failed to redirect',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

app.post('/mapping', async (c) => {
  try {
    const { userId, vaultId } = await c.req.json();
    if (!userId || !vaultId) {
      return c.json({ error: 'Missing userId or vaultId' }, 400);
    }

    await c.env.LINE_USER_MAPPINGS.put(userId, vaultId);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /mapping:', err);
    return c.json(
      {
        error: 'Failed to set mapping',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

app.post('/messages/update-sync-status', async (c) => {
  try {
    const body = await c.req.json();
    const { vaultId, messageIds, userId } = body;

    if (!vaultId || !messageIds || !Array.isArray(messageIds)) {
      return c.json({ error: 'Missing vaultId or messageIds' }, 400);
    }

    if (!userId) {
      return c.json({ error: 'Missing userId' }, 400);
    }

    const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
    if (!storedVaultId || storedVaultId !== vaultId) {
      console.error(
        `Authentication failed: User ${userId} is not authorized for vault ${vaultId}`,
      );
      return c.json({ error: 'Unauthorized access' }, 403);
    }

    for (const messageId of messageIds) {
      const key = `${vaultId}/${userId}/${messageId}`;
      try {
        const message = await c.env.LINE_MESSAGES.get<LineMessage>(key, 'json');

        if (message) {
          message.synced = true;
          await c.env.LINE_MESSAGES.put(key, JSON.stringify(message), {
            expirationTtl: 60 * 60 * 24 * 10,
          });
        } else {
          console.warn(
            `Message ${messageId} not found when updating sync status`,
          );
        }
      } catch (err) {
        console.error(
          `Error updating sync status for message ${messageId}:`,
          err,
        );
      }
    }

    return c.json({ status: 'ok', updated: messageIds.length });
  } catch (err) {
    console.error('Error in /messages/update-sync-status:', err);
    return c.json(
      {
        error: 'Failed to update sync status',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

app.post('/webhook', async (c) => {
  try {
    const signature = c.req.header('x-line-signature');
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const body = await c.req.text();
    const isValid = validateSignature(
      body,
      c.env.LINE_CHANNEL_SECRET,
      signature,
    );
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const events = JSON.parse(body).events as WebhookEvent[];

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        if (!userId) {
          console.error('Missing userId in event');
          continue;
        }

        const vaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!vaultId) {
          console.error(`No vault mapping found for user ${userId}`);
          const client = new MessagingApiClient({
            channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          });
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: `Obsidianとの連携設定が必要です。\n\nあなたのLINE User ID: ${userId}\n\n1. 上記のIDをObsidianプラグインの設定画面で入力\n2. "Register Mapping"ボタンをクリック\n\n設定完了後、もう一度メッセージを送信してください。`,
              },
            ],
          });
          continue;
        }

        const text = event.message.text;
        const urlOnly = isUrlOnly(text);

        const articleResult = urlOnly
          ? await fetchArticleMarkdown({ url: text.trim(), env: c.env })
          : null;

        const article = articleResult ?? undefined;

        const message: LineMessage = {
          timestamp: event.timestamp,
          messageId: event.message.id,
          userId: userId,
          text,
          vaultId: vaultId,
          synced: false,
          isUrlOnly: urlOnly,
          article,
        };

        await c.env.LINE_MESSAGES.put(
          `${vaultId}/${userId}/${event.message.id}`,
          JSON.stringify(message),
          { expirationTtl: 60 * 60 * 24 * 10 },
        );
      }
    }

    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in /webhook:', err);
    return c.json(
      {
        error: 'Webhook processing failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

export default app;
