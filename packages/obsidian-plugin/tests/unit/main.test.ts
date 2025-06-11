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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
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
        fileNameTemplate: '{date}-{messageId}'
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
    it('YYYYMMDD形式のJST日付文字列が返される（ハイフンなし）', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC
      const result = (plugin as any).getJSTDateString(timestamp);
      
      expect(result).toBe('20220101');
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
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
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
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

  describe('JST時刻関連のメソッド', () => {
    it('getJSTTimeForFileName - ファイル名用のJST日時文字列が返される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC -> JST 09:00:00
      const result = (plugin as any).getJSTTimeForFileName(timestamp);
      
      expect(result).toBe('20220101180000');
    });

    it('getJSTDateWithHyphens - ハイフン付きの日付文字列が返される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC
      const result = (plugin as any).getJSTDateWithHyphens(timestamp);
      
      expect(result).toBe('2022-01-01');
    });

    it('getTimeOnly - 時刻のみの文字列が返される', () => {
      const timestamp = 1640995200000; // 2022-01-01 00:00:00 UTC -> JST 09:00:00
      const result = (plugin as any).getTimeOnly(timestamp);
      
      expect(result).toBe('180000');
    });

    it('getTimeOnly - 午後の時刻が正しく返される', () => {
      const timestamp = 1641024000000; // 2022-01-01 08:00:00 UTC -> JST 17:00:00
      const result = (plugin as any).getTimeOnly(timestamp);
      
      expect(result).toBe('020000');
    });
  });

  describe('ファイル名生成', () => {
    const testMessage = {
      timestamp: 1640995200000, // 2022-01-01 00:00:00 UTC -> JST 09:00:00
      messageId: 'msg-123',
      userId: 'user-456',
      text: 'テストメッセージ',
      vaultId: 'test-vault'
    };

    beforeEach(() => {
      plugin.settings = {
        noteFolderPath: 'LINE',
        vaultId: 'test-vault',
        lineUserId: 'test-user',
        autoSync: false,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}'
      };
    });

    it('デフォルトテンプレート {date}-{messageId} でファイル名が生成される', () => {
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('2022-01-01-msg-123.md');
    });

    it('{date} テンプレートでファイル名が生成される（ハイフン付き）', () => {
      plugin.settings.fileNameTemplate = '{date}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('2022-01-01.md');
    });

    it('{datecompact} テンプレートでファイル名が生成される（ハイフンなし）', () => {
      plugin.settings.fileNameTemplate = '{datecompact}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('20220101.md');
    });

    it('{time} テンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{time}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('180000.md');
    });

    it('{datetime} テンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{datetime}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('20220101180000.md');
    });

    it('{messageId} テンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{messageId}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('msg-123.md');
    });

    it('{userId} テンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{userId}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('user-456.md');
    });

    it('{timestamp} テンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{timestamp}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('1640995200000.md');
    });

    it('複数の変数を組み合わせたテンプレートでファイル名が生成される', () => {
      plugin.settings.fileNameTemplate = '{datecompact}_{time}_{messageId}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('20220101_180000_msg-123.md');
    });

    it('同じ変数が複数回使用されても正しく置換される', () => {
      plugin.settings.fileNameTemplate = '{date}-{date}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('2022-01-01-2022-01-01.md');
    });

    it('変数以外の文字列がそのまま保持される', () => {
      plugin.settings.fileNameTemplate = 'LINE_{datetime}_message';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('LINE_20220101180000_message.md');
    });

    it('未知の変数はそのまま残される', () => {
      plugin.settings.fileNameTemplate = '{date}_{unknown}';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('2022-01-01_{unknown}.md');
    });

    it('.md拡張子が既に含まれている場合は重複しない', () => {
      plugin.settings.fileNameTemplate = '{date}-{messageId}.md';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('2022-01-01-msg-123.md');
    });

    it('空のテンプレートの場合は.mdのみが返される', () => {
      plugin.settings.fileNameTemplate = '';
      const result = (plugin as any).generateFileName(testMessage);
      
      expect(result).toBe('.md');
    });

    it('変数のブレースがエスケープされて正規表現で正しく処理される', () => {
      // 実際のメッセージIDに{}が含まれるケースをテスト
      const messageWithBraces = {
        ...testMessage,
        messageId: 'msg-{123}'
      };
      plugin.settings.fileNameTemplate = '{messageId}';
      const result = (plugin as any).generateFileName(messageWithBraces);
      
      expect(result).toBe('msg-{123}.md');
    });
  });
}); 