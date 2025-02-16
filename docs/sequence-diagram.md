# LINE to Obsidian シーケンス図

このドキュメントでは、LINEメッセージからObsidianへの保存までの流れを説明します。

## システム構成図

```mermaid
sequenceDiagram
    actor User
    participant LINE
    participant LINE_Bot
    participant Obsidian_Plugin
    participant Obsidian_Vault

    Note over User,Obsidian_Vault: 初期設定フェーズ
    User->>Obsidian_Plugin: プラグインインストール
    User->>Obsidian_Plugin: 設定入力<br/>(LINE Token, Secret, VaultID等)
    Obsidian_Plugin->>Obsidian_Plugin: サーバー起動
    
    Note over User,Obsidian_Vault: メッセージ送信フェーズ
    User->>LINE: メッセージ送信
    LINE->>LINE_Bot: Webhookイベント送信
    LINE_Bot->>Obsidian_Plugin: POSTリクエスト<br/>/webhook
    
    Note over Obsidian_Plugin: VaultID検証
    
    alt VaultID不一致
        Obsidian_Plugin-->>LINE_Bot: 403 Forbidden
    else VaultID一致
        Obsidian_Plugin->>Obsidian_Plugin: メッセージ処理
        Obsidian_Plugin->>Obsidian_Vault: Markdownファイル作成
        Obsidian_Plugin-->>LINE_Bot: 200 OK
        Obsidian_Plugin->>User: 通知表示<br/>(メッセージ保存完了)
    end
```

## フローの説明

### 初期設定フェーズ
1. ユーザーがObsidianプラグインをインストール
2. プラグイン設定で必要な情報を入力
   - LINE Channel Access Token
   - LINE Channel Secret
   - Vault ID
   - サーバーポート番号
   - 保存先フォルダパス
3. プラグインがローカルサーバーを起動

### メッセージ送信フェーズ
1. ユーザーがLINEでメッセージを送信
2. LINEがWebhookイベントをLINE Botに送信
3. LINE BotがObsidianプラグインのWebhookエンドポイントにPOSTリクエスト
4. プラグインがVault IDを検証
   - 不一致の場合：403エラーを返す
   - 一致の場合：
     - メッセージを処理
     - Markdownファイルを作成
     - 200 OKを返す
     - ユーザーに通知を表示

## 重要なポイント
- すべてのメッセージはVault IDによって適切なObsidian Vaultに振り分けられる
- メッセージの保存は非同期で行われる
- エラーが発生した場合でも、LINEボットには適切なレスポンスが返される
- ユーザーは保存完了時に通知を受け取る 