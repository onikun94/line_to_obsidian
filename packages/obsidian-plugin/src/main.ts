import { App, Plugin, PluginSettingTab, Setting, Notice, normalizePath } from 'obsidian';
import { requestUrl } from 'obsidian';
import { API_ENDPOINTS } from './constants';

interface LinePluginSettings {
  noteFolderPath: string;
  vaultId: string;
  lineUserId: string;
  autoSync: boolean;
  syncInterval: number;
  syncOnStartup: boolean;
  organizeByDate: boolean;
}

const DEFAULT_SETTINGS: LinePluginSettings = {
  noteFolderPath: 'LINE',
  vaultId: '',
  lineUserId: '',
  autoSync: false,
  syncInterval: 2,
  syncOnStartup: false,
  organizeByDate: false
}

interface LineMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
  synced?: boolean;
}

export default class LinePlugin extends Plugin {
  settings: LinePluginSettings;
  syncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.setupAutoSync();
  }

  private toJST(timestamp: number): Date {
    const date = new Date(timestamp);
    return new Date(date.getTime() + 9 * 60 * 60 * 1000);
  }

  private getJSTDateString(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    return jstDate.toISOString().split('T')[0];
  }

  private getJSTISOString(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    return jstDate.toISOString();
  }

  private setupAutoSync() {
    this.clearAutoSync();

    if (this.settings.autoSync) {
      const interval = Math.max(1, Math.min(5, this.settings.syncInterval));
      
      const intervalMs = interval * 60 * 60 * 1000;
      
      this.syncIntervalId = window.setInterval(() => {
        this.syncMessages(true);
      }, intervalMs);
      
      console.log(`自動同期が有効化されました。間隔: ${interval}時間`);
    }
  }

  private clearAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      console.log('自動同期が無効化されました');
    }
  }

  private async syncMessages(isAutoSync = false) {
    if (!this.settings.vaultId) {
      new Notice('Vault ID not configured. Please set it in plugin settings.');
      return;
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

        const dateString = this.getJSTDateString(message.timestamp);
        const fileName = `${dateString}-${message.messageId}.md`;
        
        let filePath: string;
        if (this.settings.organizeByDate) {
          const dateFolderPath = `${this.settings.noteFolderPath}/${dateString}`;
          filePath = `${dateFolderPath}/${fileName}`;
        } else {
          filePath = `${this.settings.noteFolderPath}/${fileName}`;
        }

        try {
          const normalizedFilePath = normalizePath(filePath);
          const exists = await this.app.vault.adapter.exists(normalizedFilePath);
          if (exists) {
            syncedMessageIds.push(message.messageId);
            continue;
          }

          const normalizedFolderPath = normalizePath(this.settings.noteFolderPath);
          if (!(await this.app.vault.adapter.exists(normalizedFolderPath))) {
            await this.app.vault.createFolder(normalizedFolderPath);
          }

          if (this.settings.organizeByDate) {
            const dateFolderPath = `${this.settings.noteFolderPath}/${dateString}`;
            const normalizedDateFolderPath = normalizePath(dateFolderPath);
            if (!(await this.app.vault.adapter.exists(normalizedDateFolderPath))) {
              await this.app.vault.createFolder(normalizedDateFolderPath);
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
            `${message.text}`
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
    const {containerEl} = this;
    containerEl.empty();

    containerEl.createEl('h2', {text: 'LINE Integration Settings'});

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
      .setName('Register mapping')
      .setDesc('LINE UserIDとVault IDのマッピングを登録します')
      .addButton(button => button
        .setButtonText('Register')
        .onClick(async () => {
          await this.plugin.registerMapping();
        }));
  }
}
