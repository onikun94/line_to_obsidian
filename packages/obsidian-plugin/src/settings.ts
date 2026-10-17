import { App, Notice, PluginSettingTab, Setting, requireApiVersion } from 'obsidian';
import type LinePlugin from './main';
import { PAYMENT_PAGE_URL } from './constants';

type TextSettingKey = 'noteFolderPath' | 'vaultId' | 'lineUserId' | 'groupedMessageTemplate'
  | 'groupedFrontmatterTemplate' | 'groupedFileNameTemplate' | 'fileNameTemplate'
  | 'imageFolderPath' | 'imageFileNameTemplate';
type ToggleSettingKey = 'autoSync' | 'syncOnStartup' | 'organizeByDate' | 'groupMessagesByDate' | 'syncImages';
// 自前の構造型なので旧Obsidianでも新しいAPIオブジェクトに依存せず描画できる。
interface SettingRow {
  name: string;
  desc?: string;
  visible?: () => boolean;
  searchable?: boolean;
  render: (setting: Setting) => void;
}

export class LineSettingTab extends PluginSettingTab {
  constructor(app: App, public plugin: LinePlugin, private confirmReset: () => void) {
    super(app, plugin);
  }

  private refreshSettings(): void {
    if (requireApiVersion('1.13.0')) {
      this.update();
    } else {
      this.renderLegacySettings();
    }
  }

  // 1.13未満でも同じ定義を使い、設定項目のずれを防ぐ。
  display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    this.containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      if (definition.visible && !definition.visible()) continue;
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    }
  }

  private textSetting(key: TextSettingKey, name: string, desc: string, placeholder: string,
    fallback = false, rows = 0, visible?: () => boolean): SettingRow {
    return {
      name, desc, visible,
      render: setting => {
        const configure = (text: import('obsidian').TextComponent | import('obsidian').TextAreaComponent) => {
          text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async value => {
            this.plugin.settings[key] = fallback ? value || placeholder : value;
            await this.plugin.saveSettings();
          });
        };
        if (rows) {
          setting.addTextArea(text => {
            configure(text);
            text.inputEl.rows = rows;
          });
        } else {
          setting.addText(configure);
        }
      },
    };
  }

  private toggleSetting(key: ToggleSettingKey, name: string, desc: string): SettingRow {
    return {
      name, desc,
      render: setting => {
        setting.addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => {
          this.plugin.settings[key] = value;
          if (key === 'groupMessagesByDate' && value) {
            this.plugin.settings.organizeByDate = false;
          }
          await this.plugin.saveSettings();
          this.refreshSettings();
        }));
      },
    };
  }

  private heading(name: string): SettingRow {
    return { name, searchable: false, render: setting => { setting.setHeading(); } };
  }

  private getSubscriptionStatusText(): string {
    const settings = this.plugin.settings;
    const usage = `画像: ${settings.imageCount || 0}/${settings.freeLimit || 10}枚・音声文字起こし: ${settings.voiceCount || 0}/${settings.voiceFreeLimit || 10}回使用済み`;
    switch (settings.subscriptionStatus) {
      case 'active': return 'プレミアムプラン（画像・音声文字起こし無制限）';
      case 'past_due': return '支払い遅延中 - 支払い方法を確認してください';
      case 'canceled': return `キャンセル済み（${usage}）`;
      default: return `無料プラン（${usage}）`;
    }
  }

  getSettingDefinitions(): SettingRow[] {
    const grouped = () => this.plugin.settings.groupMessagesByDate;
    const images = () => this.plugin.settings.syncImages;
    return [
      this.textSetting('noteFolderPath', 'Note folder path', 'LINEメッセージが保存されるフォルダパス', 'LINE'),
      this.textSetting('vaultId', 'Vault ID', 'このObsidian Vault用の一意の識別子（任意のユニークなIDを作成してください）', 'Enter vault ID'),
      this.textSetting('lineUserId', 'LINE user ID', 'LINEボットとの会話で取得したユーザーIDを入力してください', 'Enter your LINE User ID'),
      this.toggleSetting('autoSync', 'Auto sync', 'LINEメッセージを自動的に同期するかどうか'),
      {
        name: 'Sync interval', desc: 'LINEメッセージを同期する間隔（時間単位）',
        visible: () => this.plugin.settings.autoSync,
        render: setting => {
          setting.addDropdown(dropdown => {
            for (const hour of [1, 2, 3, 4, 5]) dropdown.addOption(String(hour), `${hour}時間`);
            dropdown.setValue(String(this.plugin.settings.syncInterval)).onChange(async value => {
              const interval = Number(value);
              if (Number.isInteger(interval) && interval >= 1 && interval <= 5) {
                this.plugin.settings.syncInterval = interval;
                await this.plugin.saveSettings();
              }
            });
          });
        },
      },
      this.toggleSetting('syncOnStartup', 'Sync on startup', 'Obsidian起動時にLINEメッセージを同期するかどうか'),
      this.toggleSetting('organizeByDate', 'Organize by date', '日付ごとにフォルダを作成してメッセージを整理するかどうか（注意：「Group messages by date」をオンにすると自動的にオフになりますが、手動で再度オンにすることができます）'),
      this.heading('ファイル整理設定'),
      this.toggleSetting('groupMessagesByDate', 'Group messages by date', '同じ日付のメッセージを1つのファイルにまとめるかどうか（チェックを外すとメッセージごとに個別のファイルを作成）'),
      this.textSetting('groupedMessageTemplate', 'Grouped message template', '日付でグループ化されたメッセージの表示テンプレート\n利用可能な変数: {time} - 時刻, {text} - メッセージ内容, {messageId} - メッセージID, {userId} - ユーザーID', '{time}: {text}', true, 3, grouped),
      this.textSetting('groupedFrontmatterTemplate', 'Grouped message frontmatter template', '日付でグループ化されたファイルのフロントマター\n利用可能な変数: {date} - 日付, {datecompact} - 日付（ハイフンなし）', 'source: LINE\ndate: {date}', true, 5, grouped),
      this.textSetting('groupedFileNameTemplate', 'Grouped file name template', '日付ごとにまとめられたファイルの名前（「Group messages by date」がオンの場合に使用）\n利用可能な変数: {date} - 日付 (例: 2024-01-15), {datecompact} - 日付ハイフンなし (例: 20240115)', '{date}', true, 0, grouped),
      {
        name: 'ファイル名の使い分け', searchable: false,
        desc: 'Group messages by date がオン：1日分のメッセージが1つのファイルにまとめられ、「Grouped file name template」が使用されます。固定のファイル名（例：LINE-Messages）を設定すると、すべてのメッセージが同じファイルに追記されます。オフ：各メッセージが個別のファイルとして保存され、「Individual message file name template」が使用されます。',
        render: () => {},
      },
      this.textSetting('fileNameTemplate', 'Individual message file name template', '個別メッセージファイルのファイル名テンプレート（「Group messages by date」がオフの場合に使用）\n利用可能な変数: {date}, {datecompact}, {time}, {datetime}, {messageId}, {userId}, {timestamp}\n{date}: 日付 (例: 2024-01-15)、{datecompact}: 日付ハイフンなし、{time}: 時刻 (例: 103045)、{datetime}: 日時 (例: 20240115103045)、{messageId}: メッセージID、{userId}: ユーザーID、{timestamp}: Unixタイムスタンプ', '{date}-{messageId}', true),
      this.heading('画像設定'),
      this.toggleSetting('syncImages', 'Sync images', 'LINEで送信した画像を同期するかどうか'),
      this.textSetting('imageFolderPath', 'Image folder path', '画像ファイルの保存先フォルダ', 'LINE/images', true, 0, images),
      this.textSetting('imageFileNameTemplate', 'Image file name template', '画像ファイルの命名テンプレート（拡張子は自動で付与されます）\n利用可能な変数: {date}, {datecompact}, {time}, {datetime}, {messageId}, {userId}, {timestamp}', '{date}-{messageId}', true, 0, images),
      this.heading('プレミアムプラン'),
      {
        name: '現在のプラン', desc: this.getSubscriptionStatusText(),
        render: setting => {
          const active = this.plugin.settings.subscriptionStatus === 'active';
          setting.addButton(button => {
            button.setButtonText(active ? 'サブスクリプション管理' : 'プレミアムプランにアップグレード');
            if (!active) button.setCta();
            button.onClick(() => {
              const baseUrl = active ? `${PAYMENT_PAGE_URL}/portal.html` : PAYMENT_PAGE_URL;
              const userId = this.plugin.settings.lineUserId;
              window.open(userId ? `${baseUrl}?userId=${userId}` : baseUrl, '_blank');
            });
          });
        },
      },
      {
        name: 'サブスクリプション状態を更新', desc: 'サーバーから最新のサブスクリプション状態を取得します',
        render: setting => {
          setting.addButton(button => button.setButtonText('更新').onClick(async () => {
            button.setDisabled(true).setButtonText('更新中...');
            try {
              await this.plugin.fetchSubscriptionStatus();
              new Notice('サブスクリプション状態を更新しました');
              this.refreshSettings();
            } catch {
              new Notice('サブスクリプション状態の取得に失敗しました');
            } finally {
              button.setDisabled(false).setButtonText('更新');
            }
          }));
        },
      },
      this.heading('接続設定'),
      {
        name: 'Register mapping', desc: 'LINE UserIDとVault IDのマッピングとE2EE公開鍵を登録します。メッセージを読み込めない場合もこの操作で接続を修復できます',
        render: setting => {
          setting.addButton(button => button.setButtonText('Register').onClick(async () => {
            await this.plugin.registerMapping();
          }));
        },
      },
      this.heading('詳細設定'),
      {
        name: 'Reset mapping', desc: 'LINE UserIDとVault IDのマッピングをリセットします（KV上の紐づけを削除し、再登録可能にします）',
        render: setting => {
          setting.addButton(button => {
            button.setButtonText('Reset');
            if (requireApiVersion('1.13.0')) {
              button.setDestructive();
            } else {
              button.buttonEl.addClass('mod-warning');
            }
            button.onClick(this.confirmReset);
          });
        },
      },
    ];
  }
}
