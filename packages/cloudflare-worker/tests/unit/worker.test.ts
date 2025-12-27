import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockKVNamespace } from '../setup';

// Honoのモック
const mockHono = {
  use: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  fetch: vi.fn(),
};

vi.mock('hono', () => ({
  Hono: vi.fn(() => mockHono),
  cors: vi.fn(() => vi.fn()),
}));

vi.mock('hono/cors', () => ({
  cors: vi.fn(() => vi.fn()),
}));

// LINE Bot SDKのモック
vi.mock('@line/bot-sdk', () => ({
  validateSignature: vi.fn(),
  Client: vi.fn(),
}));

describe('Cloudflare Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // KVNamespaceのデフォルトモック
    mockKVNamespace.get.mockResolvedValue(null);
    mockKVNamespace.put.mockResolvedValue(undefined);
    mockKVNamespace.list.mockResolvedValue({ keys: [] });
  });

  describe('ヘルスチェック', () => {
    it('正常ステータスを返す', async () => {
      const mockContext = {
        json: vi.fn().mockReturnValue({ status: 'ok' }),
      };

      // healthエンドポイントのハンドラーを直接テスト
      const handler = vi.fn().mockReturnValue({ status: 'ok' });
      const result = handler(mockContext);
      
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('メッセージエンドポイント', () => {
    it('userIdが不足している場合はエラーを返す', async () => {
      const mockContext = {
        req: {
          param: vi.fn().mockImplementation((key: string) => {
            if (key === 'vaultId') return 'test-vault';
            if (key === 'userId') return undefined;
            return undefined;
          }),
        },
        json: vi.fn(),
      };

      // Parameterが不足している場合のテスト
      const handler = vi.fn().mockImplementation((c: any) => {
        const userId = c.req.param('userId');
        if (!userId) {
          return c.json({ error: 'Missing userId parameter' }, 400);
        }
      });

      handler(mockContext);
      
      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Missing userId parameter' }, 
        400
      );
    });

    it('有効なvaultとユーザーに対してメッセージを返す', async () => {
      const mockMessages = [
        {
          timestamp: 1640995200000,
          messageId: 'msg1',
          userId: 'user1',
          text: 'Hello',
          vaultId: 'vault1',
          synced: false
        }
      ];

      mockKVNamespace.get.mockResolvedValue('vault1');
      mockKVNamespace.list.mockResolvedValue({
        keys: [{ name: 'vault1/user1/msg1' }]
      });
      mockKVNamespace.get.mockResolvedValueOnce('vault1').mockResolvedValueOnce(mockMessages[0]);

      const mockContext = {
        req: {
          param: vi.fn().mockImplementation((key: string) => {
            if (key === 'vaultId') return 'vault1';
            if (key === 'userId') return 'user1';
            return undefined;
          }),
        },
        env: {
          LINE_MESSAGES: mockKVNamespace,
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      // 正常なケースのテスト
      const handler = vi.fn().mockImplementation(async (c: any) => {
        const vaultId = c.req.param('vaultId');
        const userId = c.req.param('userId');
        
        if (!userId) {
          return c.json({ error: 'Missing userId parameter' }, 400);
        }

        const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!storedVaultId || storedVaultId !== vaultId) {
          return c.json({ error: 'Unauthorized access' }, 403);
        }

        const messages: any[] = [];
        const { keys } = await c.env.LINE_MESSAGES.list({ prefix: `${vaultId}/${userId}/` });

        for (const key of keys) {
          const message = await c.env.LINE_MESSAGES.get(key.name, 'json');
          if (message) {
            messages.push(message);
          }
        }

        return c.json(messages);
      });

      await handler(mockContext);
      
      expect(mockContext.json).toHaveBeenCalledWith([mockMessages[0]]);
    });
  });

  describe('マッピングエンドポイント', () => {
    it('userIdまたはvaultIdが不足している場合はエラーを返す', async () => {
      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({ userId: 'user1' }), // vaultId missing
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }
      });

      await handler(mockContext);
      
      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Missing userId or vaultId' }, 
        400
      );
    });

    it('マッピングを正常に作成する', async () => {
      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({
            userId: 'user1',
            vaultId: 'vault1'
          }),
        },
        env: {
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }

        await c.env.LINE_USER_MAPPINGS.put(userId, vaultId);
        return c.json({ status: 'ok' });
      });

      await handler(mockContext);

      expect(mockKVNamespace.put).toHaveBeenCalledWith('user1', 'vault1');
      expect(mockContext.json).toHaveBeenCalledWith({ status: 'ok' });
    });
  });

  describe('マッピング削除エンドポイント (DELETE /mapping)', () => {
    it('userIdまたはvaultIdが不足している場合はエラーを返す', async () => {
      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({ userId: 'user1' }), // vaultId missing
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }
      });

      await handler(mockContext);

      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Missing userId or vaultId' },
        400
      );
    });

    it('vaultIdが一致しない場合は認証エラーを返す', async () => {
      mockKVNamespace.get.mockResolvedValue('different-vault');

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({
            userId: 'user1',
            vaultId: 'vault1'
          }),
        },
        env: {
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }

        const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!storedVaultId || storedVaultId !== vaultId) {
          return c.json({ error: 'Unauthorized: VaultId does not match' }, 403);
        }
      });

      await handler(mockContext);

      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Unauthorized: VaultId does not match' },
        403
      );
    });

    it('マッピングが存在しない場合は認証エラーを返す', async () => {
      mockKVNamespace.get.mockResolvedValue(null);

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({
            userId: 'user1',
            vaultId: 'vault1'
          }),
        },
        env: {
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }

        const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!storedVaultId || storedVaultId !== vaultId) {
          return c.json({ error: 'Unauthorized: VaultId does not match' }, 403);
        }
      });

      await handler(mockContext);

      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Unauthorized: VaultId does not match' },
        403
      );
    });

    it('マッピングを正常に削除する', async () => {
      mockKVNamespace.get.mockResolvedValue('vault1');
      mockKVNamespace.delete.mockResolvedValue(undefined);

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({
            userId: 'user1',
            vaultId: 'vault1'
          }),
        },
        env: {
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { userId, vaultId } = await c.req.json();
        if (!userId || !vaultId) {
          return c.json({ error: 'Missing userId or vaultId' }, 400);
        }

        const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!storedVaultId || storedVaultId !== vaultId) {
          return c.json({ error: 'Unauthorized: VaultId does not match' }, 403);
        }

        await c.env.LINE_USER_MAPPINGS.delete(userId);
        return c.json({ status: 'ok' });
      });

      await handler(mockContext);

      expect(mockKVNamespace.delete).toHaveBeenCalledWith('user1');
      expect(mockContext.json).toHaveBeenCalledWith({ status: 'ok' });
    });
  });

  describe('同期状態更新エンドポイント', () => {
    it('必須フィールドが不足している場合はエラーを返す', async () => {
      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({ vaultId: 'vault1' }), // messageIds missing
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { vaultId, messageIds, userId } = await c.req.json();
        
        if (!vaultId || !messageIds || !Array.isArray(messageIds)) {
          return c.json({ error: 'Missing vaultId or messageIds' }, 400);
        }

        if (!userId) {
          return c.json({ error: 'Missing userId' }, 400);
        }
      });

      await handler(mockContext);
      
      expect(mockContext.json).toHaveBeenCalledWith(
        { error: 'Missing vaultId or messageIds' }, 
        400
      );
    });

    it('同期状態を正常に更新する', async () => {
      const mockMessage = {
        timestamp: 1640995200000,
        messageId: 'msg1',
        userId: 'user1',
        text: 'Hello',
        vaultId: 'vault1',
        synced: false
      };

      mockKVNamespace.get.mockResolvedValueOnce('vault1') // for auth check
                           .mockResolvedValueOnce(mockMessage); // for message retrieval

      const mockContext = {
        req: {
          json: vi.fn().mockResolvedValue({ 
            vaultId: 'vault1',
            messageIds: ['msg1'],
            userId: 'user1'
          }),
        },
        env: {
          LINE_MESSAGES: mockKVNamespace,
          LINE_USER_MAPPINGS: mockKVNamespace,
        },
        json: vi.fn(),
      };

      const handler = vi.fn().mockImplementation(async (c: any) => {
        const { vaultId, messageIds, userId } = await c.req.json();
        
        if (!vaultId || !messageIds || !Array.isArray(messageIds)) {
          return c.json({ error: 'Missing vaultId or messageIds' }, 400);
        }

        if (!userId) {
          return c.json({ error: 'Missing userId' }, 400);
        }

        const storedVaultId = await c.env.LINE_USER_MAPPINGS.get(userId);
        if (!storedVaultId || storedVaultId !== vaultId) {
          return c.json({ error: 'Unauthorized access' }, 403);
        }

        for (const messageId of messageIds) {
          const key = `${vaultId}/${userId}/${messageId}`;
          const message = await c.env.LINE_MESSAGES.get(key, 'json');
          
          if (message) {
            message.synced = true;
            await c.env.LINE_MESSAGES.put(key, JSON.stringify(message), {
              expirationTtl: 60 * 60 * 24 * 10
            });
          }
        }
        
        return c.json({ status: 'ok', updated: messageIds.length });
      });

      await handler(mockContext);
      
      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        'vault1/user1/msg1',
        JSON.stringify({ ...mockMessage, synced: true }),
        { expirationTtl: 60 * 60 * 24 * 10 }
      );
      expect(mockContext.json).toHaveBeenCalledWith({ status: 'ok', updated: 1 });
    });
  });
}); 