import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { requestUrl } from 'obsidian';
import { API_ENDPOINTS } from './constants';

interface LinePluginSettings {
  noteFolderPath: string;
  vaultId: string;  // Obsidian vaultを識別するためのID
  lineUserId: string;  // LINE UserID
}

const DEFAULT_SETTINGS: LinePluginSettings = {
  noteFolderPath: 'LINE',
  vaultId: '',  // デフォルトは空文字列
  lineUserId: ''  // デフォルトは空文字列
}

interface LineMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
}

export default class LinePlugin extends Plugin {
  settings: LinePluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new LineSettingTab(this.app, this));
    
    // 同期コマンドの追加
    this.addCommand({
      id: 'sync-line-messages',
      name: 'Sync LINE Messages',
      callback: async () => {
        await this.syncMessages();
      },
    });

    // リボンアイコンの追加
    this.addRibbonIcon('refresh-cw', 'Sync LINE Messages', async () => {
      await this.syncMessages();
    });
  }

  private log(message: string, error?: Error) {
    console.log(`[LINE Plugin] ${message}`);
    if (error) {
      console.error(error);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async syncMessages() {
    if (!this.settings.vaultId) {
      new Notice('Vault ID not configured. Please set it in plugin settings.');
      this.log('Missing Vault ID');
      return;
    }

    try {
      new Notice('Syncing LINE messages...');
      this.log('Starting sync process...');
      
      // Cloudflare Workersからメッセージを取得
      const url = API_ENDPOINTS.MESSAGES(this.settings.vaultId);
      this.log(`Fetching messages from: ${url}`);
      
      const response = await requestUrl({
        url: url,
        method: 'GET',
      });
      this.log(`Response status: ${response.status}`);
      
      if (response.status !== 200) {
        const errorText = response.text;
        this.log(`Error response body: ${errorText}`);
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const responseText = response.text;
      this.log(`Response body: ${responseText}`);
      
      let messages: LineMessage[];
      try {
        messages = JSON.parse(responseText) as LineMessage[];
        this.log(`Parsed ${messages.length} messages`);
      } catch (parseError) {
        this.log('Failed to parse response as JSON', parseError as Error);
        throw new Error('Invalid response format');
      }

      let newMessageCount = 0;

      for (const message of messages) {
        const fileName = `${new Date(message.timestamp).toISOString().split('T')[0]}-${message.messageId}.md`;
        const filePath = `${this.settings.noteFolderPath}/${fileName}`;
        this.log(`Processing message: ${message.messageId}`);

        try {
          // ファイルが既に存在するかチェック
          const exists = await this.app.vault.adapter.exists(filePath);
          if (exists) {
            this.log(`File already exists: ${filePath}`);
            continue;
          }

          // フォルダが存在しない場合は作成
          if (!(await this.app.vault.adapter.exists(this.settings.noteFolderPath))) {
            await this.app.vault.createFolder(this.settings.noteFolderPath);
            this.log(`Created folder: ${this.settings.noteFolderPath}`);
          }

          // ノートの内容を作成
          const content = [
            `---`,
            `source: LINE`,
            `date: ${new Date(message.timestamp).toISOString()}`,
            `messageId: ${message.messageId}`,
            `userId: ${message.userId}`,
            `---`,
            ``,
            `${message.text}`
          ].join('\n');

          // ノートを保存
          await this.app.vault.create(filePath, content);
          newMessageCount++;
          this.log(`Created note: ${filePath}`);
        } catch (err) {
          this.log(`Error processing message ${message.messageId}`, err as Error);
        }
      }
      
      new Notice(`LINE messages synced successfully. ${newMessageCount} new messages.`);
    } catch (err) {
      this.log('Error syncing messages', err as Error);
      new Notice(`Failed to sync LINE messages: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      this.log('Error registering mapping', error as Error);
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
      .setName('Note Folder Path')
      .setDesc('Folder path where LINE messages will be saved')
      .addText(text => text
        .setPlaceholder('LINE')
        .setValue(this.plugin.settings.noteFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.noteFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Vault ID')
      .setDesc('Unique identifier for this Obsidian vault (required for deployment)')
      .addText(text => text
        .setPlaceholder('Enter vault ID')
        .setValue(this.plugin.settings.vaultId)
        .onChange(async (value) => {
          this.plugin.settings.vaultId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('LINE User ID')
      .setDesc('LINEボットとの会話で取得したユーザーIDを入力してください')
      .addText(text => text
        .setPlaceholder('Enter your LINE User ID')
        .setValue(this.plugin.settings.lineUserId)
        .onChange(async (value) => {
          this.plugin.settings.lineUserId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Register Mapping')
      .setDesc('LINE UserIDとVault IDのマッピングを登録します')
      .addButton(button => button
        .setButtonText('Register')
        .onClick(async () => {
          await this.plugin.registerMapping();
        }));

  }
}