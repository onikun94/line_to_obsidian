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

// Modal クラスのモック
export class Modal {
  app: any;
  contentEl: any;

  constructor(app: any) {
    this.app = app;
    this.contentEl = {
      createEl: vi.fn().mockReturnValue({
        setText: vi.fn(),
        createEl: vi.fn().mockReturnValue({
          addEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
      }),
      createDiv: vi.fn().mockReturnValue({
        createEl: vi.fn().mockReturnValue({
          addEventListener: vi.fn(),
        }),
      }),
      empty: vi.fn(),
    };
  }

  open = vi.fn();
  close = vi.fn();
  onOpen = vi.fn();
  onClose = vi.fn();
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

// TextAreaComponent クラスのモック
export class TextAreaComponent {
  inputEl: any;

  constructor(containerEl: any) {
    this.inputEl = {
      value: '',
      addEventListener: vi.fn(),
    };
  }

  setValue = vi.fn().mockReturnThis();
  getValue = vi.fn().mockReturnValue('');
  onChange = vi.fn().mockReturnThis();
  setPlaceholder = vi.fn().mockReturnThis();
}

// ToggleComponent クラスのモック
export class ToggleComponent {
  constructor(containerEl: any) {}

  setValue = vi.fn().mockReturnThis();
  getValue = vi.fn().mockReturnValue(false);
  onChange = vi.fn().mockReturnThis();
}

// TFile クラスのモック
export class TFile {
  path: string = '';
  name: string = '';
  basename: string = '';
  extension: string = '';
  stat: any = {};
  vault: any = {};
  parent: any = null;
}

// TFolder クラスのモック
export class TFolder {
  path: string = '';
  name: string = '';
  children: any[] = [];
  parent: any = null;
  vault: any = {};
  isRoot = vi.fn().mockReturnValue(false);
}

// App クラスのモック
export const App = vi.fn().mockImplementation(() => mockApp);

// デフォルトエクスポート
export default {
  Plugin,
  Modal,
  PluginSettingTab,
  Setting,
  Notice,
  normalizePath,
  requestUrl,
  mockApp,
  TextAreaComponent,
  ToggleComponent,
  TFile,
  TFolder,
  App,
}; 