import { App, Plugin, Notice, normalizePath, Modal, TFile } from 'obsidian';
import { LineSettingTab } from './settings';
import { requestUrl } from 'obsidian';
import { API_ENDPOINTS } from './constants';
import { KeyManager } from './crypto/keyManager';
import { MessageEncryptor } from './crypto/messageEncryptor';
import { E2EEErrorHandler } from './crypto/errorHandler';
import { getDateString, getDateWithHyphens, getISOString, getDateTimeForFileName, getTimeOnly, getTimeString } from './dateUtils';

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
  // Image settings
  syncImages: boolean;
  imageFolderPath: string;
  imageFileNameTemplate: string;
  // Subscription settings (read from API, cached locally)
  subscriptionStatus?: 'free' | 'active' | 'past_due' | 'canceled';
  imageCount?: number;
  freeLimit?: number;
  voiceCount?: number;
  voiceFreeLimit?: number;
}

interface SubscriptionResponse {
  status: 'free' | 'active' | 'past_due' | 'canceled';
  imageCount: number;
  freeLimit: number;
  // Voice fields are absent on servers deployed before the voice feature
  voiceCount?: number;
  voiceFreeLimit?: number;
  canSendImage: boolean;
  remainingFreeImages: number | null;
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
  groupedFileNameTemplate: '{date}',
  // Image defaults
  syncImages: true,
  imageFolderPath: 'LINE/images',
  imageFileNameTemplate: '{date}-{messageId}',
  // Subscription defaults
  subscriptionStatus: 'free',
  imageCount: 0,
  freeLimit: 10,
  voiceCount: 0,
  voiceFreeLimit: 10,
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

interface ImageMessage {
  timestamp: number;
  messageId: string;
  userId: string;
  vaultId: string;
  synced: boolean;
  type: 'image';
  contentType: string;
  fileSize: number;
  encrypted: boolean;
  encryptedAESKey?: string;
  iv?: string;
  senderKeyId?: string;
  recipientUserId?: string;
  version?: string;
  r2Key: string;
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
      } catch {
        // Sync falls back to unreadable-message placeholders if E2EE cannot initialize.
      }
    }

    this.addSettingTab(new LineSettingTab(this.app, this, () => {
      new ConfirmResetModal(this.app, () => { void this.resetMapping(); }).open();
    }));

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
      this.registerInterval(
        window.setTimeout(() => {
          void this.syncMessages(true);
        }, 3000)
      );
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

  private generateFileName(message: LineMessage): string {
    const template = this.settings.fileNameTemplate;
    const timestamp = message.timestamp;

    const variables = {
      '{date}': getDateWithHyphens(timestamp),
      '{datecompact}': getDateString(timestamp),
      '{time}': getTimeOnly(timestamp),
      '{datetime}': getDateTimeForFileName(timestamp),
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
        void this.syncMessages(true);
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
    return parseMessageTemplate(template, message, messageText, getTimeString);
  }

  /**
   * Fetch subscription status from the server
   * Returns true if successful, false otherwise
   */
  async fetchSubscriptionStatus(): Promise<boolean> {
    if (!this.settings.lineUserId) {
      return false;
    }

    try {
      const url = API_ENDPOINTS.SUBSCRIPTION(this.settings.lineUserId);
      const response = await requestUrl({
        url: url,
        method: 'GET',
      });

      if (response.status === 200) {
        const data = JSON.parse(response.text) as SubscriptionResponse;
        this.settings.subscriptionStatus = data.status;
        this.settings.imageCount = data.imageCount;
        this.settings.freeLimit = data.freeLimit;
        this.settings.voiceCount = data.voiceCount ?? 0;
        this.settings.voiceFreeLimit = data.voiceFreeLimit ?? 10;
        await this.saveSettings();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async syncMessages(isAutoSync = false) {
    if (!this.settings.vaultId) {
      new Notice('Vault ID not configured. Please set it in plugin settings.');
      return;
    }

    // Fetch subscription status at the beginning of sync
    if (this.settings.lineUserId) {
      await this.fetchSubscriptionStatus();
    }

    const keys = await this.keyManager.loadKeys();

    if (!keys && this.settings.lineUserId) {
      try {
        await this.keyManager.initialize();
      } catch {
        // Continue syncing; encrypted messages will use the standard unreadable placeholder.
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
      } catch {
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
          const dateString = getDateString(message.timestamp);
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
                  const handled = await this.errorHandler.handleError(error as Error, `message_${message.messageId}`);
                  messageText = handled ?? (message.text || '[メッセージを読み込めませんでした]');
                } catch {
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
          } catch {
            // Skip the date group that failed and continue with the remaining messages.
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
            const dateString = getDateString(message.timestamp);
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
                const handled = await this.errorHandler.handleError(error as Error, `message_${message.messageId}`);
                messageText = handled ?? (message.text || '[メッセージを読み込めませんでした]');
              } catch {
                messageText = message.text || '[メッセージを読み込めませんでした]';
              }
            }

            const content = [
              `---`,
              `source: LINE`,
              `date: ${getISOString(message.timestamp)}`,
              `messageId: ${message.messageId}`,
              `userId: ${message.userId}`,
              `---`,
              ``,
              `${messageText}`
            ].join('\n');

            await this.app.vault.create(normalizedFilePath, content);
            newMessageCount++;
            syncedMessageIds.push(message.messageId);
          } catch {
            // Skip the failed message and continue syncing subsequent messages.
          }
        }
      }

      if (syncedMessageIds.length > 0) {
        await this.updateSyncStatus(syncedMessageIds);
      }

      // Sync images if enabled
      let newImageCount = 0;
      if (this.settings.syncImages) {
        newImageCount = await this.syncImages();
      }

      if (newMessageCount > 0 || newImageCount > 0 || !isAutoSync) {
        const parts = [];
        if (newMessageCount > 0) parts.push(`${newMessageCount} new messages`);
        if (newImageCount > 0) parts.push(`${newImageCount} new images`);
        const summary = parts.length > 0 ? parts.join(', ') : 'No new content';
        new Notice(`LINE sync completed. ${summary}.`);
      }
    } catch (err) {
      new Notice(`Failed to sync LINE messages: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async syncImages(): Promise<number> {
    try {
      const url = API_ENDPOINTS.IMAGES(this.settings.vaultId, this.settings.lineUserId);
      const response = await requestUrl({
        url: url,
        method: 'GET',
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch images: ${response.status}`);
      }

      const images: ImageMessage[] = JSON.parse(response.text);
      let newImageCount = 0;
      const syncedImageIds: string[] = [];

      for (const image of images) {
        if (image.synced) {
          continue;
        }

        try {
          // Fetch image content
          const contentUrl = API_ENDPOINTS.IMAGE_CONTENT(
            this.settings.vaultId,
            this.settings.lineUserId,
            image.messageId
          );
          const contentResponse = await requestUrl({
            url: contentUrl,
            method: 'GET',
          });

          if (contentResponse.status !== 200) {
            continue;
          }

          // Decrypt image if encrypted
          let imageData: ArrayBuffer;
          if (image.encrypted) {
            imageData = await this.messageEncryptor.decryptImageData(
              contentResponse.arrayBuffer,
              {
                encrypted: image.encrypted,
                encryptedAESKey: image.encryptedAESKey,
                iv: image.iv,
                senderKeyId: image.senderKeyId,
                recipientUserId: image.recipientUserId,
                version: image.version
              }
            );
          } else {
            imageData = contentResponse.arrayBuffer;
          }

          // Ensure image folder exists
          const normalizedImageFolderPath = normalizePath(this.settings.imageFolderPath);
          const imageFolder = this.app.vault.getAbstractFileByPath(normalizedImageFolderPath);
          if (!imageFolder) {
            await this.app.vault.createFolder(normalizedImageFolderPath);
          }

          // Generate image file name
          const extension = this.getExtensionFromContentType(image.contentType);
          const imageFileName = this.generateImageFileName(image, extension);
          const imageFilePath = normalizePath(`${this.settings.imageFolderPath}/${imageFileName}`);

          // Save image file
          await this.app.vault.createBinary(imageFilePath, imageData);

          // Create note for the image
          await this.createImageNote(image, imageFileName);

          newImageCount++;
          syncedImageIds.push(image.messageId);
        } catch {
          // Skip the failed image and continue syncing subsequent images.
        }
      }

      if (syncedImageIds.length > 0) {
        await this.updateImageSyncStatus(syncedImageIds);
      }

      return newImageCount;
    } catch {
      return 0;
    }
  }

  private getExtensionFromContentType(contentType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    };
    return mimeToExt[contentType] || 'jpg';
  }

  private generateImageFileName(image: ImageMessage, extension: string): string {
    const template = this.settings.imageFileNameTemplate;
    const timestamp = image.timestamp;

    const variables: Record<string, string> = {
      '{date}': getDateWithHyphens(timestamp),
      '{datecompact}': getDateString(timestamp),
      '{time}': getTimeOnly(timestamp),
      '{datetime}': getDateTimeForFileName(timestamp),
      '{messageId}': image.messageId,
      '{userId}': image.userId,
      '{timestamp}': timestamp.toString()
    };

    let fileName = template;
    for (const [variable, value] of Object.entries(variables)) {
      fileName = fileName.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return `${fileName}.${extension}`;
  }

  private async createImageNote(image: ImageMessage, imageFileName: string) {
    // Determine note folder path
    let noteFolderPath: string;
    if (this.settings.organizeByDate) {
      const dateString = getDateString(image.timestamp);
      noteFolderPath = `${this.settings.noteFolderPath}/${dateString}`;
    } else {
      noteFolderPath = this.settings.noteFolderPath;
    }

    // Ensure note folder exists
    const normalizedNoteFolderPath = normalizePath(noteFolderPath);
    const noteFolder = this.app.vault.getAbstractFileByPath(normalizedNoteFolderPath);
    if (!noteFolder) {
      // Create parent folder first if needed
      const normalizedBaseFolderPath = normalizePath(this.settings.noteFolderPath);
      const baseFolder = this.app.vault.getAbstractFileByPath(normalizedBaseFolderPath);
      if (!baseFolder) {
        await this.app.vault.createFolder(normalizedBaseFolderPath);
      }
      await this.app.vault.createFolder(normalizedNoteFolderPath);
    }

    // Calculate relative path from note to image
    const imageFullPath = `${this.settings.imageFolderPath}/${imageFileName}`;

    if (this.settings.groupMessagesByDate) {
      // Append to grouped file
      const dateString = getDateString(image.timestamp);
      const fileNameWithoutExt = parseFrontmatterTemplate(this.settings.groupedFileNameTemplate, dateString);
      const fileName = `${fileNameWithoutExt}.md`;
      const filePath = `${noteFolderPath}/${fileName}`;
      const normalizedFilePath = normalizePath(filePath);

      const imageEmbed = `![[${imageFullPath}]]`;
      const timeString = getTimeString(image.timestamp);
      const messageContent = `${timeString}: ${imageEmbed}`;

      // Check if file exists
      let existingContent = '';
      const existingFile = this.app.vault.getAbstractFileByPath(normalizedFilePath);
      if (existingFile instanceof TFile) {
        existingContent = await this.app.vault.read(existingFile);
      }

      let finalContent: string;
      if (existingContent) {
        finalContent = existingContent.trimEnd() + '\n' + messageContent;
      } else {
        const parsedFrontmatter = parseFrontmatterTemplate(this.settings.groupedFrontmatterTemplate, dateString);
        const frontmatter = [
          `---`,
          parsedFrontmatter,
          `---`,
          ``,
          ''
        ].join('\n');
        finalContent = frontmatter + messageContent;
      }

      const fileToWrite = this.app.vault.getAbstractFileByPath(normalizedFilePath);
      if (fileToWrite instanceof TFile) {
        await this.app.vault.modify(fileToWrite, finalContent);
      } else {
        await this.app.vault.create(normalizedFilePath, finalContent);
      }
    } else {
      // Create individual note for image
      const noteFileName = this.generateImageFileName(image, 'md').replace(/\.md\.md$/, '.md');
      const notePath = normalizePath(`${noteFolderPath}/${noteFileName}`);

      const content = [
        `---`,
        `source: LINE`,
        `date: ${getISOString(image.timestamp)}`,
        `messageId: ${image.messageId}`,
        `userId: ${image.userId}`,
        `type: image`,
        `---`,
        ``,
        `![[${imageFullPath}]]`
      ].join('\n');

      await this.app.vault.create(notePath, content);
    }
  }

  private async updateImageSyncStatus(messageIds: string[]) {
    try {
      if (!this.settings.lineUserId) {
        return;
      }

      const response = await requestUrl({
        url: API_ENDPOINTS.UPDATE_IMAGE_SYNC_STATUS,
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
        return;
      }
    } catch {
      return;
    }
  }

  private async updateSyncStatus(messageIds: string[]) {
    try {
      if (!this.settings.lineUserId) {
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
        return;
      }
    } catch {
      return;
    }
  }

  private async registerCurrentPublicKey(): Promise<void> {
    try {
      await this.keyManager.initialize();
    } catch (error) {
      const keys = await this.keyManager.loadKeys();
      if (!keys) {
        throw error;
      }

      // Existing keys are enough to refresh the Worker-side public key.
    }

    await this.keyManager.forceRegisterPublicKey();
  }

  async registerMapping() {
    const lineUserId = this.settings.lineUserId.trim();
    const vaultId = this.settings.vaultId.trim();

    if (!lineUserId || !vaultId) {
      new Notice('LINE UserIDとVault IDの両方を設定してください。');
      return;
    }

    this.settings.lineUserId = lineUserId;
    this.settings.vaultId = vaultId;
    await this.saveSettings();

    try {
      const response = await requestUrl({
        url: API_ENDPOINTS.MAPPING,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: lineUserId,
          vaultId: vaultId,
        }),
      });

      if (response.status !== 200) {
        throw new Error('マッピングの登録に失敗しました');
      }

      try {
        await this.registerCurrentPublicKey();
      } catch (keyError) {
        new Notice(`マッピングは登録されましたが、E2EE公開鍵の登録に失敗しました: ${keyError instanceof Error ? keyError.message : 'Unknown error'}`);
        return;
      }

      new Notice('LINE UserIDとVault IDのマッピングとE2EE公開鍵を登録しました。');
    } catch (error) {
      new Notice(`マッピングの登録に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async resetMapping() {
    if (!this.settings.lineUserId || !this.settings.vaultId) {
      new Notice('LINE UserIDとVault IDの両方を設定してください。');
      return;
    }

    try {
      const response = await requestUrl({
        url: API_ENDPOINTS.DELETE_MAPPING,
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: this.settings.lineUserId,
          vaultId: this.settings.vaultId,
        }),
      });

      if (response.status !== 200) {
        throw new Error('マッピングのリセットに失敗しました');
      }

      // Clear local settings
      this.settings.lineUserId = '';
      await this.saveSettings();

      new Notice('LINE UserIDとVault IDのマッピングをリセットしました。');
    } catch (error) {
      new Notice(`マッピングのリセットに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

class ConfirmResetModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'マッピングをリセットしますか？' });
    contentEl.createEl('p', { text: 'この操作により、LINE UserIDとVault IDの紐づけが削除されます。再度LINEを使用するには、マッピングの再登録が必要になります。' });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    buttonContainer.createEl('button', { text: 'キャンセル' })
      .addEventListener('click', () => {
        this.close();
      });

    const confirmBtn = buttonContainer.createEl('button', {
      text: 'リセットする',
      cls: 'mod-warning'
    });
    confirmBtn.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
