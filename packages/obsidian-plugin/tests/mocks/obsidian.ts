import { vi } from 'vitest';

// Plugin クラスのモック
export class Plugin {
  app: any;
  manifest: any;
  
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand = vi.fn();
  addSettingTab = vi.fn();
  addRibbonIcon = vi.fn();
  registerDomEvent = vi.fn();
  registerInterval = vi.fn();
  loadData = vi.fn();
  saveData = vi.fn();
  onload = vi.fn();
  onunload = vi.fn();
}

// PluginSettingTab クラスのモック
export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty: vi.fn(),
      createEl: vi.fn().mockReturnValue({
        setText: vi.fn(),
        createEl: vi.fn().mockReturnValue({
          setText: vi.fn(),
          setAttr: vi.fn(),
          addEventListener: vi.fn(),
        }),
        appendChild: vi.fn(),
      }),
    };
  }

  display = vi.fn();
  hide = vi.fn();
}

// Setting クラスのモック
export class Setting {
  settingEl: any;

  constructor(containerEl: any) {
    this.settingEl = {
      setName: vi.fn().mockReturnThis(),
      setDesc: vi.fn().mockReturnThis(),
      addText: vi.fn().mockReturnThis(),
      addToggle: vi.fn().mockReturnThis(),
      addSlider: vi.fn().mockReturnThis(),
      addButton: vi.fn().mockReturnThis(),
    };
  }

  setName = vi.fn().mockReturnThis();
  setDesc = vi.fn().mockReturnThis();
  addText = vi.fn().mockReturnThis();
  addToggle = vi.fn().mockReturnThis();
  addSlider = vi.fn().mockReturnThis();
  addButton = vi.fn().mockReturnThis();
  setClass = vi.fn().mockReturnThis();
}

// Notice 関数のモック
export const Notice = vi.fn();

// normalizePath 関数のモック
export const normalizePath = vi.fn((path: string) => path);

// requestUrl 関数のモック
export const requestUrl = vi.fn();

// App インターフェースのモック
export const mockApp = {
  vault: {
    adapter: {
      exists: vi.fn(),
    },
    createFolder: vi.fn(),
    create: vi.fn(),
    modify: vi.fn(),
    delete: vi.fn(),
    getAbstractFileByPath: vi.fn(),
  },
  workspace: {
    getActiveFile: vi.fn(),
    openLinkText: vi.fn(),
  },
  metadataCache: {
    getFileCache: vi.fn(),
  },
};

// デフォルトエクスポート
export default {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  normalizePath,
  requestUrl,
  mockApp,
}; 