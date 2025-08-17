import { App, Plugin, PluginSettingTab, Setting, Notice, normalizePath } from 'obsidian';
import { requestUrl } from 'obsidian';
import { API_ENDPOINTS } from './constants';
import { KeyManager } from './crypto/keyManager';
import { MessageEncryptor } from './crypto/messageEncryptor';
import { E2EEErrorHandler } from './crypto/errorHandler';

interface LinePluginSettings {
  noteFolderPath: string;
  vaultId: string;
  lineUserId: string;
  autoSync: boolean;
  syncInterval: number;
  syncOnStartup: boolean;
  organizeByDate: boolean;
  fileNameTemplate: string;
  e2eeEnabled: boolean;
  apiUrl?: string;
}

const DEFAULT_SETTINGS: LinePluginSettings = {
  noteFolderPath: 'LINE',
  vaultId: '',
  lineUserId: '',
  autoSync: false,
  syncInterval: 2,
  syncOnStartup: false,
  organizeByDate: false,
  fileNameTemplate: '{date}-{messageId}',
  e2eeEnabled: true  // デフォルトで有効
}

interface LineMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
  synced?: boolean;
  encrypted?: boolean;
  encryptedContent?: string;
  encryptedAESKey?: string;
  iv?: string;
  senderKeyId?: string;
  recipientUserId?: string;
  version?: string;
}

export default class LinePlugin extends Plugin {
  settings: LinePluginSettings;
  syncIntervalId: number | null = null;
  keyManager: KeyManager;
  messageEncryptor: MessageEncryptor;
  errorHandler: E2EEErrorHandler;

  async onload() {
    await this.loadSettings();

    this.keyManager = new KeyManager(this);
    this.messageEncryptor = new MessageEncryptor(this.keyManager);
    this.errorHandler = new E2EEErrorHandler(this.keyManager, this.messageEncryptor);

    if (this.settings.lineUserId && this.settings.vaultId) {
      try {
        await this.keyManager.initialize();
      } catch (error) {
        console.error('Failed to initialize E2EE:', error);
      }
    }

    this.addSettingTab(new LineSettingTab(this.app, this));

    this.addCommand({
      id: 'sync-line-messages',
      name: 'Sync LINE messages',
      callback: async () => {
        await this.syncMessages();
      },
    });

    this.addRibbonIcon('refresh-cw', 'Sync LINE messages', async () => {
      await this.syncMessages();
    });

    this.setupAutoSync();

    if (this.settings.syncOnStartup) {
      setTimeout(() => {
        this.syncMessages(true);
      }, 3000);
    }
  }

  onunload() {
    this.clearAutoSync();
  }

  async loadSettings() {
    const data = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.setupAutoSync();
  }

  private toJST(timestamp: number): Date {
    return new Date(timestamp);
  }

  private getJSTDateString(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    return jstDate.toISOString().split('T')[0].replace(/-/g, '');
  }

  private getJSTDateWithHyphens(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    return jstDate.toISOString().split('T')[0];
  }

  private getJSTISOString(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    return jstDate.toISOString();
  }

  private getJSTTimeForFileName(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    const year = jstDate.getFullYear();
    const month = String(jstDate.getMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getDate()).padStart(2, '0');
    const hour = String(jstDate.getHours()).padStart(2, '0');
    const minute = String(jstDate.getMinutes()).padStart(2, '0');
    const second = String(jstDate.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}${second}`;
  }

  private getTimeOnly(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    const hour = String(jstDate.getHours()).padStart(2, '0');
    const minute = String(jstDate.getMinutes()).padStart(2, '0');
    const second = String(jstDate.getSeconds()).padStart(2, '0');

    return `${hour}${minute}${second}`;
  }

  private generateFileName(message: LineMessage): string {
    const template = this.settings.fileNameTemplate;
    const timestamp = message.timestamp;

    const variables = {
      '{date}': this.getJSTDateWithHyphens(timestamp),
      '{datecompact}': this.getJSTDateString(timestamp),
      '{time}': this.getTimeOnly(timestamp),
      '{datetime}': this.getJSTTimeForFileName(timestamp),
      '{messageId}': message.messageId,
      '{userId}': message.userId,
      '{timestamp}': timestamp.toString()
    };

    let fileName = template;
    for (const [variable, value] of Object.entries(variables)) {
      fileName = fileName.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    if (!fileName.endsWith('.md')) {
      fileName += '.md';
    }

    return fileName;
  }

  private async generateUniqueFileName(message: LineMessage, folderPath: string): Promise<string> {
    const baseFileName = this.generateFileName(message);
    const baseName = baseFileName.replace(/\.md$/, '');
    const extension = '.md';

    let uniqueFileName = baseFileName;
    let counter = 1;

    while (true) {
      const fullPath = normalizePath(`${folderPath}/${uniqueFileName}`);
      const exists = await this.app.vault.adapter.exists(fullPath);

      if (!exists) {
        return uniqueFileName;
      }

      uniqueFileName = `${baseName}_${counter}${extension}`;
      counter++;
    }
  }

  private setupAutoSync() {
    this.clearAutoSync();

    if (this.settings.autoSync) {
      const interval = Math.max(1, Math.min(5, this.settings.syncInterval));

      const intervalMs = interval * 60 * 60 * 1000;

      this.syncIntervalId = window.setInterval(() => {
        this.syncMessages(true);
      }, intervalMs);
    }
  }

  private clearAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private async syncMessages(isAutoSync = false) {
    if (!this.settings.vaultId) {
      new Notice('Vault ID not configured. Please set it in plugin settings.');
      return;
    }

    const keys = await this.keyManager.loadKeys();

    if (!keys && this.settings.lineUserId) {
      try {
        await this.keyManager.initialize();
      } catch (error) {
        console.error('Failed to initialize E2EE during sync:', error);
      }
    }

    try {
      if (!isAutoSync) {
        new Notice('Syncing LINE messages...');
      }

      const url = API_ENDPOINTS.MESSAGES(this.settings.vaultId, this.settings.lineUserId);

      const response = await requestUrl({
        url: url,
        method: 'GET',
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const responseText = response.text;

      let messages: LineMessage[];
      try {
        messages = JSON.parse(responseText) as LineMessage[];
      } catch (parseError) {
        throw new Error('Invalid response format');
      }

      let newMessageCount = 0;
      const syncedMessageIds: string[] = [];

      for (const message of messages) {
        if (message.synced) {
          continue;
        }

        let folderPath: string;
        if (this.settings.organizeByDate) {
          const dateString = this.getJSTDateString(message.timestamp);
          folderPath = `${this.settings.noteFolderPath}/${dateString}`;
        } else {
          folderPath = this.settings.noteFolderPath;
        }

        try {
          const fileName = await this.generateUniqueFileName(message, folderPath);
          const filePath = `${folderPath}/${fileName}`;
          const normalizedFilePath = normalizePath(filePath);

          const normalizedFolderPath = normalizePath(this.settings.noteFolderPath);
          if (!(await this.app.vault.adapter.exists(normalizedFolderPath))) {
            await this.app.vault.createFolder(normalizedFolderPath);
          }

          const normalizedTargetFolderPath = normalizePath(folderPath);
          if (!(await this.app.vault.adapter.exists(normalizedTargetFolderPath))) {
            await this.app.vault.createFolder(normalizedTargetFolderPath);
          }

          let messageText: string;
          try {
            messageText = await this.messageEncryptor.processMessage(message);
          } catch (error) {
            try {
              messageText = await this.errorHandler.handleError(error as Error, `message_${message.messageId}`);
            } catch (handlerError) {
              console.error(`Failed to process message ${message.messageId}:`, handlerError);
              messageText = message.text || '🔒 暗号化されたメッセージ（復号化できません）';
            }
          }

          const content = [
            `---`,
            `source: LINE`,
            `date: ${this.getJSTISOString(message.timestamp)}`,
            `messageId: ${message.messageId}`,
            `userId: ${message.userId}`,
            `---`,
            ``,
            `${messageText}`
          ].join('\n');

          await this.app.vault.create(normalizedFilePath, content);
          newMessageCount++;
          syncedMessageIds.push(message.messageId);
        } catch (err) {
          console.error(`Error processing message ${message.messageId}: ${err}`);
        }
      }

      if (syncedMessageIds.length > 0) {
        await this.updateSyncStatus(syncedMessageIds);
      }

      if (newMessageCount > 0 || !isAutoSync) {
        new Notice(`LINE messages synced successfully. ${newMessageCount} new messages.`);
      }
    } catch (err) {
      new Notice(`Failed to sync LINE messages: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async updateSyncStatus(messageIds: string[]) {
    try {
      if (!this.settings.lineUserId) {
        console.error('LINE User ID not configured. Cannot update sync status.');
        return;
      }

      const response = await requestUrl({
        url: API_ENDPOINTS.UPDATE_SYNC_STATUS,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vaultId: this.settings.vaultId,
          messageIds: messageIds,
          userId: this.settings.lineUserId,
        }),
      });

      if (response.status !== 200) {
        console.error(`Failed to update sync status: ${response.status}`);
      }
    } catch (err) {
      console.error(`Error updating sync status: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  async registerMapping() {
    if (!this.settings.lineUserId || !this.settings.vaultId) {
      new Notice('LINE UserIDとVault IDの両方を設定してください。');
      return;
    }

    try {
      const response = await requestUrl({
        url: API_ENDPOINTS.MAPPING,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: this.settings.lineUserId,
          vaultId: this.settings.vaultId,
        }),
      });

      if (response.status !== 200) {
        throw new Error('マッピングの登録に失敗しました');
      }

      try {
        await this.keyManager.initialize();
      } catch (keyError) {
        console.error('Failed to initialize keys after mapping:', keyError);
      }

      new Notice('LINE UserIDとVault IDのマッピングを登録しました。');
    } catch (error) {
      new Notice(`マッピングの登録に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

class LineSettingTab extends PluginSettingTab {
  plugin: LinePlugin;

  constructor(app: App, plugin: LinePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'LINE Integration Settings' });

    new Setting(containerEl)
      .setName('Note folder path')
      .setDesc('LINEメッセージが保存されるフォルダパス')
      .addText(text => text
        .setPlaceholder('LINE')
        .setValue(this.plugin.settings.noteFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.noteFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Vault ID')
      .setDesc('このObsidian Vault用の一意の識別子（任意のユニークなIDを作成してください）')
      .addText(text => text
        .setPlaceholder('Enter vault ID')
        .setValue(this.plugin.settings.vaultId)
        .onChange(async (value) => {
          this.plugin.settings.vaultId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('LINE user ID')
      .setDesc('LINEボットとの会話で取得したユーザーIDを入力してください')
      .addText(text => text
        .setPlaceholder('Enter your LINE User ID')
        .setValue(this.plugin.settings.lineUserId)
        .onChange(async (value) => {
          this.plugin.settings.lineUserId = value;
          await this.plugin.saveSettings();
        }));

    const autoSyncSetting = new Setting(containerEl)
      .setName('Auto sync')
      .setDesc('LINEメッセージを自動的に同期するかどうか')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();

          syncIntervalSetting.settingEl.toggle(value);
        }));

    const syncIntervalSetting = new Setting(containerEl)
      .setName('Sync interval')
      .setDesc('LINEメッセージを同期する間隔（時間単位）')
      .addDropdown(dropdown => {
        const hours = [1, 2, 3, 4, 5];
        hours.forEach(hour => {
          dropdown.addOption(hour.toString(), `${hour}時間`);
        });

        dropdown.setValue(this.plugin.settings.syncInterval.toString())
        dropdown.onChange(async (value) => {
          const interval = parseInt(value);
          if (!isNaN(interval) && interval >= 1 && interval <= 5) {
            this.plugin.settings.syncInterval = interval;
            await this.plugin.saveSettings();
          }
        });
      });

    syncIntervalSetting.settingEl.toggle(this.plugin.settings.autoSync);

    new Setting(containerEl)
      .setName('Sync on startup')
      .setDesc('Obsidian起動時にLINEメッセージを同期するかどうか')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Organize by date')
      .setDesc('日付ごとにフォルダを作成してメッセージを整理するかどうか')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.organizeByDate)
        .onChange(async (value) => {
          this.plugin.settings.organizeByDate = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('File name template')
      .setDesc('ファイル名のテンプレート（.md拡張子は自動で付与されます）。利用可能な変数: {date}, {datecompact}, {time}, {datetime}, {messageId}, {userId}, {timestamp}')
      .addText(text => text
        .setPlaceholder('{date}-{messageId}')
        .setValue(this.plugin.settings.fileNameTemplate)
        .onChange(async (value) => {
          this.plugin.settings.fileNameTemplate = value || '{date}-{messageId}';
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('div', {
      text: '変数の説明:',
      cls: 'setting-item-description'
    });
    containerEl.createEl('ul', {}, (ul) => {
      ul.createEl('li', { text: '{date}: 日付 (例: 2024-01-15)' });
      ul.createEl('li', { text: '{datecompact}: 日付（ハイフンなし） (例: 20240115)' });
      ul.createEl('li', { text: '{time}: 時刻 (例: 103045)' });
      ul.createEl('li', { text: '{datetime}: 日時 (例: 20240115103045)' });
      ul.createEl('li', { text: '{messageId}: メッセージID' });
      ul.createEl('li', { text: '{userId}: ユーザーID' });
      ul.createEl('li', { text: '{timestamp}: Unixタイムスタンプ' });
    });

    new Setting(containerEl)
      .setName('Register mapping')
      .setDesc('LINE UserIDとVault IDのマッピングを登録します')
      .addButton(button => button
        .setButtonText('Register')
        .onClick(async () => {
          await this.plugin.registerMapping();
        }));
  }
}
