# Obsidian LINE Plugin

LINEからのメッセージを自動的にObsidianのノートとして保存するプラグインです。

## 機能

- LINEメッセージの自動保存
- 複数のObsidian Vault対応
- カスタマイズ可能な保存先フォルダ
- デバッグモード対応

## システム構成

システムの詳細な流れについては、[シーケンス図](docs/sequence-diagram.md)を参照してください。

## インストール方法

1. Obsidianのプラグイン設定から「Community Plugins」を開く
2. 「Browse」をクリックし、「LINE」で検索
3. 「LINE Plugin」をインストール

## 設定

1. LINE Developers Consoleで以下を取得：
   - Channel Access Token
   - Channel Secret
2. プラグイン設定で以下を設定：
   - LINE Channel Access Token
   - LINE Channel Secret
   - Vault ID（一意の識別子）
   - サーバーポート番号（デフォルト: 3000）
   - 保存先フォルダパス
3. LINE DevelopersでWebhook URLを設定：
   - 形式: `https://あなたのドメイン/webhook/あなたのVaultID`
   - 例: `https://example.ngrok.io/webhook/your-vault-id`

## 使用方法

1. プラグインをインストールし、設定を完了
2. LINEボットに対してメッセージを送信
3. 自動的にObsidianのノートとして保存

## 注意事項

- Vault IDは他のユーザーと重複しないようにしてください
- サーバーポートが他のアプリケーションと競合しないよう注意してください
- デバッグモードはトラブルシューティング時のみ有効にしてください
- Webhook URLには必ずVault IDを含めてください

## トラブルシューティング
- 403エラーが発生する場合：
  - Webhook URLに正しいVault IDが含まれているか確認
  - プラグイン設定のVault IDと一致しているか確認
- Webhookが動作しない場合：
  - ngrokが正常に動作しているか確認
  - ポート番号が正しいか確認
  - Webhook URLが正しく設定されているか確認
- メッセージが保存されない場合：
  - プラグインの設定を確認
  - 保存先フォルダのパスが正しいか確認
  - LINEの認証情報が正しいか確認

## セキュリティ注意事項
- チャネルシークレットとアクセストークンは安全に保管
- Vault IDは推測されにくい値を使用（UUIDを推奨）
- ngrokのURLは定期的に変更される為、その都度Webhook URLの更新が必要

## サポート
問題や質問がある場合は、GitHubのIssuesにて報告してください。 