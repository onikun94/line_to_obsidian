import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { Client, middleware, WebhookEvent, MessageEvent } from '@line/bot-sdk';
import express, { Request, Response, Application } from 'express';
import { createServer, Server } from 'http';

interface LinePluginSettings {
  lineToken: string;
  lineSecret: string;
  serverPort: number;
  noteFolderPath: string;
  debugMode: boolean;
  vaultId: string;  // Obsidian vaultを識別するためのID
}

const DEFAULT_SETTINGS: LinePluginSettings = {
  lineToken: '',
  lineSecret: '',
  serverPort: 3000,
  noteFolderPath: 'LINE',
  debugMode: false,
  vaultId: ''  // デフォルトは空文字列
}

export default class LinePlugin extends Plugin {
  settings: LinePluginSettings;
  server: Server;
  client: Client;
  private isServerRunning: boolean = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new LineSettingTab(this.app, this));
    
    // サーバー起動を試みる
    await this.startServer();
    
    // コマンドの追加
    this.addCommand({
      id: 'restart-line-server',
      name: 'Restart LINE Server',
      callback: async () => {
        await this.restartServer();
      },
    });
  }

  private log(message: string, error?: Error) {
    if (this.settings.debugMode) {
      console.log(`[LINE Plugin] ${message}`);
      if (error) {
        console.error(error);
      }
    }
  }

  private async startServer() {
    if (!this.settings.lineToken || !this.settings.lineSecret) {
      new Notice('LINE credentials not configured. Please set them in plugin settings.');
      this.log('Missing LINE credentials');
      return;
    }

    if (!this.settings.vaultId) {
      new Notice('Vault ID not configured. Please set it in plugin settings.');
      this.log('Missing Vault ID');
      return;
    }

    try {
      // LINE Clientの初期化
      this.client = new Client({
        channelAccessToken: this.settings.lineToken,
        channelSecret: this.settings.lineSecret
      });

      // Expressサーバーの設定
      const app: Application = express();
      
      // raw bodyを保持するための設定
      app.use(express.json({
        verify: (req: any, res, buf) => {
          req.rawBody = buf;
        }
      }));
      app.use(express.urlencoded({ extended: true }));

      // ヘルスチェックエンドポイント
      app.get('/health', (req: Request, res: Response) => {
        res.status(200).json({ status: 'ok' });
      });

      // Webhookエンドポイント
      app.post('/webhook/:vaultId', middleware({
        channelAccessToken: this.settings.lineToken,
        channelSecret: this.settings.lineSecret
      }), (req: Request, res: Response, next) => {
        if (this.settings.debugMode) {
          this.log(`Webhook request received for vaultId: ${req.params.vaultId}`);
          this.log(`Expected vaultId: ${this.settings.vaultId}`);
          this.log(`Request path: ${req.path}`);
          this.log(`Request method: ${req.method}`);
        }
        
        // vaultIdの検証
        const requestVaultId = req.params.vaultId;
        if (requestVaultId !== this.settings.vaultId) {
          this.log(`Invalid vault ID received: ${requestVaultId}`);
          res.status(403).json({ error: 'Invalid vault ID' });
          return;
        }
        
        if (this.settings.debugMode) {
          this.log('VaultID verification passed');
        }
        
        next();
      }, async (req: Request, res: Response) => {
        try {
          const events = req.body?.events as WebhookEvent[];
          if (events) {
            await this.handleEvents(events);
          }
          res.status(200).end();
        } catch (err) {
          this.log('Webhook error', err as Error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      // サーバーの起動
      this.server = createServer(app);
      this.server.listen(this.settings.serverPort, () => {
        this.isServerRunning = true;
        this.log(`LINE Webhook server is running on port ${this.settings.serverPort}`);
        new Notice(`LINE server started on port ${this.settings.serverPort}`);
      });

      // エラーハンドリング
      this.server.on('error', (error: Error) => {
        if ((error as any).code === 'EADDRINUSE') {
          this.log(`Port ${this.settings.serverPort} is already in use`);
          new Notice(`Failed to start LINE server: Port ${this.settings.serverPort} is already in use`);
        } else {
          this.log('Server error', error);
          new Notice('LINE server error occurred');
        }
        this.isServerRunning = false;
      });

    } catch (error) {
      this.log('Server startup error', error as Error);
      new Notice('Failed to start LINE server');
    }
  }

  async restartServer() {
    if (this.isServerRunning) {
      this.server.close();
      this.isServerRunning = false;
    }
    await this.startServer();
  }

  async handleEvents(events: WebhookEvent[]) {
    for (const event of events) {
      try {
        if (event.type === 'message' && event.message.type === 'text') {
          await this.saveMessageAsNote(event as MessageEvent);
        }
      } catch (error) {
        this.log(`Error handling event: ${JSON.stringify(event)}`, error as Error);
      }
    }
  }

  async saveMessageAsNote(event: MessageEvent) {
    if (event.message.type !== 'text') return;
    if (!event.source.userId) {
      this.log('No user ID in event');
      return;
    }

    const timestamp = new Date(event.timestamp);
    const fileName = `${timestamp.toISOString().split('T')[0]}-${event.message.id}.md`;
    const folderPath = this.settings.noteFolderPath;

    try {
      // フォルダが存在しない場合は作成
      if (!(await this.app.vault.adapter.exists(folderPath))) {
        await this.app.vault.createFolder(folderPath);
        this.log(`Created folder: ${folderPath}`);
      }
      
      // ノートの内容を作成
      const content = [
        `---`,
        `source: LINE`,
        `date: ${timestamp.toISOString()}`,
        `messageId: ${event.message.id}`,
        `userId: ${event.source.userId}`,
        `---`,
        ``,
        `${event.message.text}`
      ].join('\n');

      // ノートを保存
      const filePath = `${folderPath}/${fileName}`;
      await this.app.vault.create(filePath, content);
      this.log(`Saved message to: ${filePath}`);
      new Notice(`New LINE message saved: ${fileName}`);

    } catch (error) {
      this.log('Error saving message', error as Error);
      new Notice('Failed to save LINE message');
    }
  }

  onunload() {
    if (this.server) {
      this.server.close();
      this.log('Server stopped');
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.restartServer();
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
      .setName('LINE Channel Access Token')
      .setDesc('Enter your LINE Channel Access Token from LINE Developers Console')
      .addText(text => text
        .setPlaceholder('Enter your token')
        .setValue(this.plugin.settings.lineToken)
        .onChange(async (value) => {
          this.plugin.settings.lineToken = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('LINE Channel Secret')
      .setDesc('Enter your LINE Channel Secret from LINE Developers Console')
      .addText(text => text
        .setPlaceholder('Enter your secret')
        .setValue(this.plugin.settings.lineSecret)
        .onChange(async (value) => {
          this.plugin.settings.lineSecret = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Server Port')
      .setDesc('Port number for the webhook server (default: 3000)')
      .addText(text => text
        .setPlaceholder('3000')
        .setValue(String(this.plugin.settings.serverPort))
        .onChange(async (value) => {
          this.plugin.settings.serverPort = Number(value);
          await this.plugin.saveSettings();
        }));

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
      .setName('Debug Mode')
      .setDesc('Enable detailed logging for troubleshooting')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));
  }
} 