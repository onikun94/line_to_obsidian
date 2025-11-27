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
        e2eeEnabled: true,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
        groupMessagesByDate: false,
        groupedFileNameTemplate: '{date}',
        groupedFrontmatterTemplate: 'source: LINE\ndate: {date}',
        groupedMessageTemplate: '{time}: {text}',
      });
    });

    it('読み込まれたデータがデフォルト設定とマージされる', async () => {
      mockLoadData.mockResolvedValue({
        vaultId: 'test-vault',
        autoSync: true,
      });

      await plugin.loadSettings();

      expect(plugin.settings).toEqual({
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: '',
        autoSync: true,
        e2eeEnabled: true,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
        groupMessagesByDate: false,
        groupedFileNameTemplate: '{date}',
        groupedFrontmatterTemplate: 'source: LINE\ndate: {date}',
        groupedMessageTemplate: '{time}: {text}',
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
      };

      await plugin.saveSettings();

      expect(mockSaveData).toHaveBeenCalledWith(plugin.settings);
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
      };

      (plugin as any).setupAutoSync();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60 * 60 * 1000, // 1 hour in ms
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
      };

      (plugin as any).setupAutoSync();

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('同期間隔が1〜5時間の間に制限される', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: true,
        syncInterval: 0,
        syncOnStartup: false,
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
      };

      (plugin as any).setupAutoSync();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60 * 60 * 1000,
      );

      setIntervalSpy.mockClear();

      plugin.settings.syncInterval = 6;
      (plugin as any).setupAutoSync();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 60 * 1000,
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
