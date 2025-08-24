import { App, Plugin, PluginSettingTab, Setting, Notice, normalizePath, Modal, TextAreaComponent, TFile, TFolder, ToggleComponent } from 'obsidian';
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
  groupMessagesByDate: boolean;
  groupedMessageTemplate: string;
  groupedFrontmatterTemplate: string;
  groupedFileNameTemplate: string;
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
  e2eeEnabled: true,
  groupMessagesByDate: false,
  groupedMessageTemplate: '{time}: {text}',
  groupedFrontmatterTemplate: 'source: LINE\ndate: {date}',
  groupedFileNameTemplate: '{date}'
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

// Helper function for template parsing
function parseMessageTemplate(template: string, message: LineMessage, messageText: string, getJSTTimeString: (timestamp: number) => string): string {
  return template
    .replace(/{time}/g, getJSTTimeString(message.timestamp))
    .replace(/{text}/g, messageText)
    .replace(/{messageId}/g, message.messageId)
    .replace(/{userId}/g, message.userId);
}

// Helper function for frontmatter template parsing
function parseFrontmatterTemplate(template: string, dateString: string): string {
  return template
    .replace(/{date}/g, dateString.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    .replace(/{datecompact}/g, dateString);
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
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to initialize E2EE:', error);
        }
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
    const currentData = await this.loadData() || {};
    const dataToSave = {
      ...currentData,
      ...this.settings
    };
    await this.saveData(dataToSave);
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

  public getJSTTimeString(timestamp: number): string {
    const jstDate = this.toJST(timestamp);
    const hour = String(jstDate.getHours()).padStart(2, '0');
    const minute = String(jstDate.getMinutes()).padStart(2, '0');
    const second = String(jstDate.getSeconds()).padStart(2, '0');

    return `${hour}:${minute}:${second}`;
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
      const file = this.app.vault.getAbstractFileByPath(fullPath);
      const exists = file !== null;

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

  private parseMessageTemplate(template: string, message: LineMessage, messageText: string): string {
    return parseMessageTemplate(template, message, messageText, (timestamp) => this.getJSTTimeString(timestamp));
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
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to initialize E2EE during sync:', error);
        }
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

      if (this.settings.groupMessagesByDate) {
        // Group messages by date
        const messagesByDate = new Map<string, LineMessage[]>();
        
        for (const message of messages) {
          if (message.synced) {
            continue;
          }
          const dateString = this.getJSTDateString(message.timestamp);
          if (!messagesByDate.has(dateString)) {
            messagesByDate.set(dateString, []);
          }
          messagesByDate.get(dateString)!.push(message);
        }

        // Process grouped messages
        for (const [dateString, dateMessages] of messagesByDate) {
          let folderPath: string;
          if (this.settings.organizeByDate) {
            folderPath = `${this.settings.noteFolderPath}/${dateString}`;
          } else {
            folderPath = this.settings.noteFolderPath;
          }

          try {
            // Create folders if needed
            const normalizedFolderPath = normalizePath(this.settings.noteFolderPath);
            const folder = this.app.vault.getAbstractFileByPath(normalizedFolderPath);
            if (!folder) {
              await this.app.vault.createFolder(normalizedFolderPath);
            }

            const normalizedTargetFolderPath = normalizePath(folderPath);
            const targetFolder = this.app.vault.getAbstractFileByPath(normalizedTargetFolderPath);
            if (!targetFolder) {
              await this.app.vault.createFolder(normalizedTargetFolderPath);
            }

            // Generate file name for date-based file
            const fileNameWithoutExt = parseFrontmatterTemplate(this.settings.groupedFileNameTemplate, dateString);
            const fileName = `${fileNameWithoutExt}.md`;
            const filePath = `${folderPath}/${fileName}`;
            const normalizedFilePath = normalizePath(filePath);

            // Check if file already exists
            let existingContent = '';
            const existingFile = this.app.vault.getAbstractFileByPath(normalizedFilePath);
            if (existingFile instanceof TFile) {
              existingContent = await this.app.vault.read(existingFile);
            }

            // Process all messages for this date
            const newMessages: string[] = [];
            for (const message of dateMessages) {
              let messageText: string;
              try {
                messageText = await this.messageEncryptor.processMessage(message);
              } catch (error) {
                try {
                  messageText = await this.errorHandler.handleError(error as Error, `message_${message.messageId}`);
                } catch (handlerError) {
                  if (process.env.NODE_ENV === 'development') {
                    console.error(`Failed to process message ${message.messageId}:`, handlerError);
                  }
                  messageText = message.text || '[メッセージを読み込めませんでした]';
                }
              }

              const messageContent = this.parseMessageTemplate(
                this.settings.groupedMessageTemplate,
                message,
                messageText
              );

              newMessages.push(messageContent);
              syncedMessageIds.push(message.messageId);
              newMessageCount++;
            }

            // Append new messages to existing content or create new file
            let finalContent: string;
            if (existingContent) {
              finalContent = existingContent.trimEnd() + '\n' + newMessages.join('\n');
            } else {
              // Create new file with frontmatter
              const parsedFrontmatter = parseFrontmatterTemplate(this.settings.groupedFrontmatterTemplate, dateString);
              const frontmatter = [
                `---`,
                parsedFrontmatter,
                `---`,
                ``,
                ''
              ].join('\n');
              finalContent = frontmatter + newMessages.join('\n');
            }

            const fileToWrite = this.app.vault.getAbstractFileByPath(normalizedFilePath);
            if (fileToWrite instanceof TFile) {
              await this.app.vault.modify(fileToWrite, finalContent);
            } else {
              await this.app.vault.create(normalizedFilePath, finalContent);
            }
          } catch (err) {
            if (process.env.NODE_ENV === 'development') {
              console.error(`Error processing messages for date ${dateString}: ${err}`);
            }
          }
        }
      } else {
        // Original logic: one file per message
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
            const baseFolder = this.app.vault.getAbstractFileByPath(normalizedFolderPath);
            if (!baseFolder) {
              await this.app.vault.createFolder(normalizedFolderPath);
            }

            const normalizedTargetFolderPath = normalizePath(folderPath);
            const targetFolder = this.app.vault.getAbstractFileByPath(normalizedTargetFolderPath);
            if (!targetFolder) {
              await this.app.vault.createFolder(normalizedTargetFolderPath);
            }

            let messageText: string;
            try {
              messageText = await this.messageEncryptor.processMessage(message);
            } catch (error) {
              try {
                messageText = await this.errorHandler.handleError(error as Error, `message_${message.messageId}`);
              } catch (handlerError) {
                if (process.env.NODE_ENV === 'development') {
                  console.error(`Failed to process message ${message.messageId}:`, handlerError);
                }
                messageText = message.text || '[メッセージを読み込めませんでした]';
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
            if (process.env.NODE_ENV === 'development') {
              console.error(`Error processing message ${message.messageId}: ${err}`);
            }
          }
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
        if (process.env.NODE_ENV === 'development') {
          console.error('LINE User ID not configured. Cannot update sync status.');
        }
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
        if (process.env.NODE_ENV === 'development') {
          console.error(`Failed to update sync status: ${response.status}`);
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`Error updating sync status: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
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
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to initialize keys after mapping:', keyError);
        }
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

    // Don't use top-level headings in settings tab

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

    let organizeBydateToggle: ToggleComponent;
    const organizeBydateSetting = new Setting(containerEl)
      .setName('Organize by date')
      .setDesc('日付ごとにフォルダを作成してメッセージを整理するかどうか（注意：「Group messages by date」をオンにすると自動的にオフになりますが、手動で再度オンにすることができます）')
      .addToggle(toggle => {
        organizeBydateToggle = toggle;
        toggle.setValue(this.plugin.settings.organizeByDate)
          .onChange(async (value) => {
            this.plugin.settings.organizeByDate = value;
            await this.plugin.saveSettings();
          });
      });

    // Add section header for file organization
    new Setting(containerEl)
      .setHeading()
      .setName('ファイル整理設定');

    new Setting(containerEl)
      .setName('Group messages by date')
      .setDesc('同じ日付のメッセージを1つのファイルにまとめるかどうか（チェックを外すとメッセージごとに個別のファイルを作成）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.groupMessagesByDate)
        .onChange(async (value) => {
          this.plugin.settings.groupMessagesByDate = value;
          
          // When enabling group by date, disable organize by date by default
          if (value && this.plugin.settings.organizeByDate) {
            this.plugin.settings.organizeByDate = false;
            // Update the toggle UI
            if (organizeBydateToggle) {
              organizeBydateToggle.setValue(false);
            }
          }
          
          await this.plugin.saveSettings();
          
          // Show/hide the grouped message related settings
          messageTemplateSetting.settingEl.toggle(value);
          frontmatterTemplateSetting.settingEl.toggle(value);
          groupedFileNameSetting.settingEl.toggle(value);
        }));

    const messageTemplateSetting = new Setting(containerEl)
      .setName('Grouped message template')
      .setDesc('日付でグループ化されたメッセージの表示テンプレート\n利用可能な変数: {time} - 時刻, {text} - メッセージ内容, {messageId} - メッセージID, {userId} - ユーザーID')
      .addTextArea(text => {
        text.setPlaceholder('{time}: {text}')
          .setValue(this.plugin.settings.groupedMessageTemplate)
          .onChange(async (value) => {
            this.plugin.settings.groupedMessageTemplate = value || '{time}: {text}';
            await this.plugin.saveSettings();
          });
        
        // Make text area large
        text.inputEl.rows = 3;
        
        return text;
      });
    

    // Initially hide the message template setting if grouping is disabled
    messageTemplateSetting.settingEl.toggle(this.plugin.settings.groupMessagesByDate);

    const frontmatterTemplateSetting = new Setting(containerEl)
      .setName('Grouped message frontmatter template')
      .setDesc('日付でグループ化されたファイルのフロントマター\n利用可能な変数: {date} - 日付, {datecompact} - 日付（ハイフンなし）')
      .addTextArea(text => {
        text.setPlaceholder('source: LINE\ndate: {date}')
          .setValue(this.plugin.settings.groupedFrontmatterTemplate)
          .onChange(async (value) => {
            this.plugin.settings.groupedFrontmatterTemplate = value || 'source: LINE\ndate: {date}';
            await this.plugin.saveSettings();
          });
        
        text.inputEl.rows = 5;
        
        return text;
      });
    
    // Initially hide the frontmatter template setting if grouping is disabled
    frontmatterTemplateSetting.settingEl.toggle(this.plugin.settings.groupMessagesByDate);

    const groupedFileNameSetting = new Setting(containerEl)
      .setName('Grouped file name template')
      .setDesc('日付ごとにまとめられたファイルの名前（「Group messages by date」がオンの場合に使用）\n利用可能な変数: {date} - 日付 (例: 2024-01-15), {datecompact} - 日付ハイフンなし (例: 20240115)')
      .addText(text => text
        .setPlaceholder('{date}')
        .setValue(this.plugin.settings.groupedFileNameTemplate)
        .onChange(async (value) => {
          this.plugin.settings.groupedFileNameTemplate = value || '{date}';
          await this.plugin.saveSettings();
        }));
    
    // Initially hide the grouped file name setting if grouping is disabled
    groupedFileNameSetting.settingEl.toggle(this.plugin.settings.groupMessagesByDate);

    // Add an info box to explain the difference
    const infoBox = containerEl.createDiv({ cls: 'setting-item-description' });
    infoBox.style.backgroundColor = 'var(--background-secondary)';
    infoBox.style.padding = '10px';
    infoBox.style.borderRadius = '5px';
    infoBox.style.marginBottom = '20px';
    // Use DOM API instead of innerHTML
    infoBox.createEl('strong', { text: 'ファイル名の使い分け：' });
    infoBox.createEl('br');
    infoBox.createEl('span', { text: '• ' });
    infoBox.createEl('strong', { text: 'Group messages by date がオン：' });
    infoBox.createEl('span', { text: ' 1日分のメッセージが1つのファイルにまとめられ、「Grouped file name template」が使用されます' });
    infoBox.createEl('br');
    infoBox.createEl('span', { text: '  ※ 固定のファイル名（例：{date}を使わずに「LINE-Messages」など）を設定すると、すべてのメッセージが常に同じファイルに追記されます' });
    infoBox.createEl('br');
    infoBox.createEl('span', { text: '• ' });
    infoBox.createEl('strong', { text: 'Group messages by date がオフ：' });
    infoBox.createEl('span', { text: ' 各メッセージが個別のファイルとして保存され、「Individual message file name template」が使用されます' });

    new Setting(containerEl)
      .setName('Individual message file name template')
      .setDesc('個別メッセージファイルのファイル名テンプレート（「Group messages by date」がオフの場合に使用）\n利用可能な変数: {date}, {datecompact}, {time}, {datetime}, {messageId}, {userId}, {timestamp}')
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
