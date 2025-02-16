# Obsidian LINE Plugin

LINEからのメッセージを自動的にObsidianのノートとして保存するプラグインです。

## 機能

- LINEメッセージの自動保存
- 複数のObsidian Vault対応
- カスタマイズ可能な保存先フォルダ
- 複数ユーザーサポート（各ユーザーが独自のVaultにメッセージを保存可能）

## システム構成

システムの詳細な流れについては、[シーケンス図](docs/sequence-diagram.md)を参照してください。

## インストール方法

### コミュニティプラグインから（推奨）
1. Obsidianの設定を開く
2. 「サードパーティプラグイン」を選択
3. 「安全モード」をオフにする
4. 「コミュニティプラグインを閲覧」をクリック
5. "LINE Integration"を検索
6. インストールをクリック

### 手動インストール
1. [最新のリリース](https://github.com/yourusername/obsidian-line/releases/latest)をダウンロード
2. ファイルを`.obsidian/plugins/obsidian-line/`に展開
3. Obsidianを再起動
4. 設定でプラグインを有効化

## セットアップ

### LINE Bot の設定
1. [LINE Developers Console](https://developers.line.biz/)にアクセス
2. 新しいプロバイダーを作成
3. 新しいチャネル（Messaging API）を作成
4. 以下の情報を取得：
   - Channel Access Token
   - Channel Secret
5. Webhook URLを設定：
   - URL: `https://obsidian-line-plugin.line-to-obsidian.workers.dev/webhook`
   - Webhook送信を有効化

### プラグインの設定
1. プラグインの設定を開く
2. 以下の項目を設定：
   - LINE Channel Access Token
   - LINE Channel Secret
   - Vault ID（任意の一意の文字列）
   - 保存先フォルダパス
3. LINEボットに適当なメッセージを送信
4. 表示されたLINE User IDをプラグインの設定画面に入力
5. "Register Mapping"ボタンをクリック

## 使用方法

1. LINEボットにメッセージを送信
2. 自動的にObsidianのノートとして保存
3. プラグインのリボンアイコンをクリックして手動同期も可能

## セキュリティ

- 各ユーザーのメッセージは、設定したVaultにのみ保存されます
- 他のユーザーのメッセージが混ざることはありません
- LINE User IDとVault IDのマッピングは安全に管理されています

## トラブルシューティング

### メッセージが保存されない
1. プラグインの設定を確認
2. LINE User IDとVault IDのマッピングが正しく設定されているか確認
3. デバッグモードを有効にして詳細なログを確認

### 連携エラー
1. Channel Access TokenとChannel Secretが正しいか確認
2. Webhookが有効になっているか確認
3. Webhook URLが正しく設定されているか確認

## サポート

問題や質問がある場合は、[GitHub Issues](https://github.com/yourusername/obsidian-line/issues)にて報告してください。

## ライセンス

[MIT License](LICENSE) 