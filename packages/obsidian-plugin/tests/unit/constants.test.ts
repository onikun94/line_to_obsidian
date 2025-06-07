import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('constants', () => {
  beforeEach(() => {
    delete process.env.OBSIDIAN_LINE_API_URL;
    delete process.env.NODE_ENV;
    vi.resetModules();
  });

  // テストヘルパー関数：環境変数設定後にconstantsをインポート
  const importConstants = async () => {
    const { API_ENDPOINTS } = await import('../../src/constants');
    return { API_ENDPOINTS };
  };

  describe('API_ENDPOINTS', () => {
    it('NODE_ENVがlocalでAPI_URLが未設定の場合、デフォルトのローカルURLが使用される', async () => {
      process.env.NODE_ENV = 'local';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(API_ENDPOINTS.BASE_URL).toBe('http://localhost:8787');
    });

    it('OBSIDIAN_LINE_API_URL環境変数が設定されている場合、その値が使用される', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(API_ENDPOINTS.BASE_URL).toBe('https://example.com');
    });

    it('MESSAGESエンドポイントのURLが正しく生成される', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      const vaultId = 'test-vault';
      const userId = 'test-user';
      const expectedUrl = 'https://api.example.com/messages/test-vault/test-user';
      
      expect(API_ENDPOINTS.MESSAGES(vaultId, userId)).toBe(expectedUrl);
    });

    it('MAPPINGエンドポイントのURLが正しく生成される', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(API_ENDPOINTS.MAPPING).toBe('https://api.example.com/mapping');
    });

    it('UPDATE_SYNC_STATUSエンドポイントのURLが正しく生成される', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(API_ENDPOINTS.UPDATE_SYNC_STATUS).toBe('https://api.example.com/messages/update-sync-status');
    });

    it('MESSAGESエンドポイントで空のvaultIdが渡された場合、エラーが投げられる', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(() => API_ENDPOINTS.MESSAGES('', 'user')).toThrow('vaultIdとuserIdは必須パラメータです');
    });

    it('MESSAGESエンドポイントで空のuserIdが渡された場合、エラーが投げられる', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(() => API_ENDPOINTS.MESSAGES('vault', '')).toThrow('vaultIdとuserIdは必須パラメータです');
    });

    it('MESSAGESエンドポイントで両方とも空の場合、エラーが投げられる', async () => {
      process.env.OBSIDIAN_LINE_API_URL = 'https://api.example.com';
      
      const { API_ENDPOINTS } = await importConstants();
      expect(() => API_ENDPOINTS.MESSAGES('', '')).toThrow('vaultIdとuserIdは必須パラメータです');
    });
  });
}); 