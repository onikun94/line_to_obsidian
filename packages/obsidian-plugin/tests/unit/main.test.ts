import { describe, it, expect, vi, beforeEach } from 'vitest';
import LinePlugin from '../../src/main';

// Obsidian APIのモック
const mockApp = {
  vault: {
    adapter: {
      exists: vi.fn(),
    },
    createFolder: vi.fn(),
    create: vi.fn(),
  },
} as any;

const mockLoadData = vi.fn();
const mockSaveData = vi.fn();

// LinePluginクラスをテスト用に拡張
class TestLinePlugin extends LinePlugin {
  app = mockApp;
  loadData = mockLoadData;
  saveData = mockSaveData;
  addSettingTab = vi.fn();
  addCommand = vi.fn();
  addRibbonIcon = vi.fn();
}

describe('LinePlugin', () => {
  let plugin: TestLinePlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new TestLinePlugin(mockApp as any, {} as any);
    
    // デフォルトのモック戻り値を設定
    mockLoadData.mockResolvedValue({});
    mockSaveData.mockResolvedValue(undefined);
    mockApp.vault.adapter.exists.mockResolvedValue(false);
    mockApp.vault.createFolder.mockResolvedValue(undefined);
    mockApp.vault.create.mockResolvedValue(undefined);
  });

  describe('設定の読み込み', () => {
    it('データが存在しない場合、デフォルト設定が読み込まれる', async () => {
      mockLoadData.mockResolvedValue(null);
      
      await plugin.loadSettings();
      
      expect(plugin.settings).toEqual({
        noteFolderPath: 'LINE',
        vaultId: '',
        lineUserId: '',
        autoSync: false,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false
      });
    });

    it('読み込まれたデータがデフォルト設定とマージされる', async () => {
      mockLoadData.mockResolvedValue({
        vaultId: 'test-vault',
        autoSync: true
      });
      
      await plugin.loadSettings();
      
      expect(plugin.settings).toEqual({
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: '',
        autoSync: true,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false
      });
    });
  });

  describe('設定の保存', () => {
    it('設定が保存され、自動同期がセットアップされる', async () => {
      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: true,
        syncInterval: 1,
        syncOnStartup: false,
        organizeByDate: false
      };
      
      await plugin.saveSettings();
      
      expect(mockSaveData).toHaveBeenCalledWith(plugin.settings);
    });
  });

  describe('JST変換', () => {
    it('タイムスタンプがJSTに変換される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC
      const result = (plugin as any).toJST(timestamp);
      
      // JST is UTC+9
      expect(result.getTime()).toBe(timestamp + 9 * 60 * 60 * 1000);
    });
  });

  describe('JST日付文字列の取得', () => {
    it('YYYY-MM-DD形式のJST日付文字列が返される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC
      const result = (plugin as any).getJSTDateString(timestamp);
      
      expect(result).toBe('2022-01-01');
    });
  });

  describe('JST ISO文字列の取得', () => {
    it('JST ISO文字列が返される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC
      const result = (plugin as any).getJSTISOString(timestamp);
      
      // JST時刻でISO文字列を返す
      expect(result).toBe('2022-01-01T09:00:00.000Z');
    });
  });

  describe('自動同期のセットアップ', () => {
    it('有効な場合、自動同期がセットアップされる', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      
      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: true,
        syncInterval: 1,
        syncOnStartup: false,
        organizeByDate: false
      };
      
      (plugin as any).setupAutoSync();
      
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60 * 60 * 1000 // 1 hour in ms
      );
    });

    it('無効な場合、自動同期はセットアップされない', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      
      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: false,
        syncInterval: 1,
        syncOnStartup: false,
        organizeByDate: false
      };
      
      (plugin as any).setupAutoSync();
      
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('同期間隔が1〜5時間の間に制限される', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      
      // Test minimum (0 should become 1)
      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: true,
        syncInterval: 0,
        syncOnStartup: false,
        organizeByDate: false
      };
      
      (plugin as any).setupAutoSync();
      
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60 * 60 * 1000 // 1 hour minimum
      );
      
      setIntervalSpy.mockClear();
      
      // Test maximum (6 should become 5)
      plugin.settings.syncInterval = 6;
      (plugin as any).setupAutoSync();
      
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 60 * 1000 // 5 hours maximum
      );
    });
  });

  describe('自動同期のクリア', () => {
    it('既存のインターバルがクリアされる', () => {
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      
      plugin.syncIntervalId = 123;
      (plugin as any).clearAutoSync();
      
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
      expect(plugin.syncIntervalId).toBeNull();
    });

    it('nullのインターバルIDが適切に処理される', () => {
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      
      plugin.syncIntervalId = null;
      (plugin as any).clearAutoSync();
      
      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });
  });
}); 