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
        groupedMessageTemplate: '{time}: {text}'
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
        e2eeEnabled: true,
        syncInterval: 2,
        syncOnStartup: false,
        organizeByDate: false,
        fileNameTemplate: '{date}-{messageId}',
        groupMessagesByDate: false,
        groupedFileNameTemplate: '{date}',
        groupedFrontmatterTemplate: 'source: LINE\ndate: {date}',
        groupedMessageTemplate: '{time}: {text}'
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
        60 * 60 * 1000
      );

      setIntervalSpy.mockClear();

      plugin.settings.syncInterval = 6;
      (plugin as any).setupAutoSync();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 60 * 1000
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

  describe('日付・時刻変換関数', () => {
    // JST 2025-09-12 07:54:38 = UTC 2025-09-11 22:54:38
    // このケースで {date} が前日になるバグがあった
    const jst20250912_075438 = new Date('2025-09-12T07:54:38+09:00').getTime();

    // JST 2025-09-12 09:00:00 = UTC 2025-09-12 00:00:00
    const jst20250912_090000 = new Date('2025-09-12T09:00:00+09:00').getTime();

    // JST 2025-01-15 23:59:59 = UTC 2025-01-15 14:59:59
    const jst20250115_235959 = new Date('2025-01-15T23:59:59+09:00').getTime();

    describe('getJSTDateString (datecompact)', () => {
      it('JST午前9時前でも当日の日付を返す（UTCでは前日でもJSTでは当日）', () => {
        const result = (plugin as any).getJSTDateString(jst20250912_075438);
        expect(result).toBe('20250912');
      });

      it('JST午前9時以降は当日の日付を返す', () => {
        const result = (plugin as any).getJSTDateString(jst20250912_090000);
        expect(result).toBe('20250912');
      });

      it('JST深夜でも当日の日付を返す', () => {
        const result = (plugin as any).getJSTDateString(jst20250115_235959);
        expect(result).toBe('20250115');
      });
    });

    describe('getJSTDateWithHyphens (date)', () => {
      it('JST午前9時前でも当日の日付を返す（UTCでは前日でもJSTでは当日）', () => {
        const result = (plugin as any).getJSTDateWithHyphens(jst20250912_075438);
        expect(result).toBe('2025-09-12');
      });

      it('JST午前9時以降は当日の日付を返す', () => {
        const result = (plugin as any).getJSTDateWithHyphens(jst20250912_090000);
        expect(result).toBe('2025-09-12');
      });

      it('JST深夜でも当日の日付を返す', () => {
        const result = (plugin as any).getJSTDateWithHyphens(jst20250115_235959);
        expect(result).toBe('2025-01-15');
      });
    });

    describe('getJSTTimeForFileName (datetime)', () => {
      it('JST午前9時前でも正しい日時を返す', () => {
        const result = (plugin as any).getJSTTimeForFileName(jst20250912_075438);
        expect(result).toBe('20250912075438');
      });

      it('JST午前9時以降で正しい日時を返す', () => {
        const result = (plugin as any).getJSTTimeForFileName(jst20250912_090000);
        expect(result).toBe('20250912090000');
      });
    });

    describe('getTimeOnly (time)', () => {
      it('JST午前9時前でも正しい時刻を返す', () => {
        const result = (plugin as any).getTimeOnly(jst20250912_075438);
        expect(result).toBe('075438');
      });

      it('JST午前9時以降で正しい時刻を返す', () => {
        const result = (plugin as any).getTimeOnly(jst20250912_090000);
        expect(result).toBe('090000');
      });
    });

    describe('getJSTTimeString', () => {
      it('コロン区切りの時刻を返す', () => {
        const result = plugin.getJSTTimeString(jst20250912_075438);
        expect(result).toBe('07:54:38');
      });
    });

    describe('日付変数の一貫性', () => {
      it('{date}と{datetime}の日付部分が一致する', () => {
        const date = (plugin as any).getJSTDateWithHyphens(jst20250912_075438);
        const datetime = (plugin as any).getJSTTimeForFileName(jst20250912_075438);
        const datetimeDatePart = datetime.slice(0, 4) + '-' + datetime.slice(4, 6) + '-' + datetime.slice(6, 8);
        expect(date).toBe(datetimeDatePart);
      });

      it('{datecompact}と{datetime}の日付部分が一致する', () => {
        const datecompact = (plugin as any).getJSTDateString(jst20250912_075438);
        const datetime = (plugin as any).getJSTTimeForFileName(jst20250912_075438);
        const datetimeDatePart = datetime.slice(0, 8);
        expect(datecompact).toBe(datetimeDatePart);
      });
    });
  });
});
