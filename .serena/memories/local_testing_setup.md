# ローカル結合テスト設定ガイド

## 概要

ObsidianプラグインとLINE Messaging APIを結合してローカル環境でテストするための設定手順。

---

## 1. LINE Messaging API設定

### LINE Developersコンソール
URL: https://developers.line.biz/console/

### 必要な情報を取得
1. **Channel Secret**: チャネル基本設定から取得
2. **Channel Access Token**: Messaging API設定からLong-lived tokenを発行
3. **Webhook URL**: Cloudflare Workerのデプロイ後のURL（例: `https://your-worker.workers.dev/webhook`）
4. **Webhookを有効化**: Messaging API設定で「Use webhook」をONにする

### LINE User IDの取得方法
- LINEアプリから自分のBotにメッセージを送信
- Cloudflare WorkerのログまたはKVストアを確認してUser IDを取得

---

## 2. Cloudflare Worker設定

### 環境変数

**`.dev.vars`ファイル（ローカル開発用）**
```env
LINE_CHANNEL_SECRET="your-channel-secret-here"
LINE_CHANNEL_ACCESS_TOKEN="your-long-lived-token-here"
CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
```

**`wrangler.toml`（本番デプロイ用）**
```toml
name = "line-to-obsidian-worker"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "LINE_MESSAGES"
id = "your-kv-namespace-id"

[[kv_namespaces]]
binding = "LINE_USER_MAPPINGS"
id = "your-kv-namespace-id"

[vars]
# 環境変数はwrangler secret putで設定
# wrangler secret put LINE_CHANNEL_SECRET
# wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# wrangler secret put CLOUDFLARE_ACCOUNT_ID
# wrangler secret put CLOUDFLARE_API_TOKEN
```

### KVネームスペースの作成
```bash
# LINE_MESSAGES用
wrangler kv:namespace create LINE_MESSAGES

# LINE_USER_MAPPINGS用
wrangler kv:namespace create LINE_USER_MAPPINGS
```

### ローカル実行
```bash
cd packages/cloudflare-worker
bun run dev  # または wrangler dev
```

### デプロイ
```bash
bun run deploy  # または wrangler deploy
```

---

## 3. Obsidian Plugin設定

### プラグイン設定画面での入力項目

#### 必須設定
1. **Vault ID**: 任意のユニークID（例: `my-vault-123`）
   - 複数のObsidian Vaultを区別するためのID
   
2. **LINE User ID**: LINEアプリから取得したUser ID
   - LINE Botにメッセージを送った際に取得できるID
   
3. **API URL**: Cloudflare WorkerのURL
   - 本番: `https://your-worker.workers.dev`
   - ローカル: `http://localhost:8787`（wrangler dev使用時）

#### オプション設定
- **Auto sync**: 自動同期の有効/無効
- **Sync interval**: 同期間隔（時間単位）
- **Sync on startup**: Obsidian起動時に同期
- **Organize by date**: 日付ごとにフォルダ分け
- **Group messages by date**: 同じ日付のメッセージを1ファイルにまとめる

#### LiteratureNote設定
- **Enable Article Extraction**: URL記事抽出機能の有効/無効（デフォルト: ON）
- **Literature Note Folder**: LiteratureNote保存先（デフォルト: `LINE/Literature`）
- **Literature Note Frontmatter Template**: Frontmatterテンプレート

### マッピング登録
1. 設定画面で「Register mapping」ボタンをクリック
2. Vault IDとLINE User IDのマッピングをWorker側のKVに登録
3. これにより、該当User IDからのメッセージがこのVaultで同期可能になる

---

## 4. ローカル開発環境

### Obsidian Pluginのビルドと配置

**開発モードでビルド**
```bash
cd packages/obsidian-plugin
bun run dev  # watchモードで自動ビルド
```

**プラグインの配置先**
```
<Your Obsidian Vault>/.obsidian/plugins/obsidian-line/
├── main.js
├── manifest.json
└── styles.css
```

**Obsidianでプラグインを有効化**
1. Obsidian設定 → Community plugins
2. 「obsidian-line」を有効化
3. プラグイン設定を開いて必要な情報を入力

---

## 5. 結合テストの流れ

### 基本的なメッセージ同期テスト

1. **LINEでメッセージ送信**
   - LINE Botにテキストメッセージを送信
   
2. **Webhook → Cloudflare Worker**
   - WorkerがWebhookを受信してKVにメッセージを保存
   - ログで確認: `wrangler tail`
   
3. **Obsidian Pluginで同期**
   - Obsidianで「Sync LINE messages」コマンド実行
   - または自動同期が有効な場合は自動的に同期
   
4. **ファイル確認**
   - Obsidian Vaultの`LINE/`フォルダ（設定したフォルダ）にファイルが作成される

### URL記事抽出機能のテスト

1. **LINEでURL単体を送信**
   ```
   https://example.com/article
   ```
   
2. **Worker側で処理**
   - Browser Rendering APIがMarkdown化
   - OGP情報（title, description, author, imageなど）を取得
   - KVに保存（`isUrlOnly: true`, `article`フィールド付き）
   
3. **Obsidian側でLiteratureNote作成**
   - 同期時に`isUrlOnly`と`article`が存在するメッセージを検知
   - `LINE/Literature/`フォルダにMarkdownファイルを作成
   - ファイル名: タイトルをスラッグ化（日本語対応）
   - Frontmatter: title, source, author, created, description, image, tags
   
4. **確認事項**
   - LiteratureNoteファイルが作成されているか
   - Frontmatterが正しく設定されているか
   - 記事本文がMarkdown形式で保存されているか
   - Dailyノート（有効な場合）にもリンクが追加されているか

### URLとテキスト混在メッセージのテスト

1. **LINEでURLとテキストを同時送信**
   ```
   これ読んで https://example.com/article
   ```
   
2. **期待される動作**
   - `isUrlOnly: false`として保存される
   - 従来通りDailyノートにそのまま記載される
   - LiteratureNoteは作成されない

---

## 6. トラブルシューティング

### Workerのログ確認
```bash
wrangler tail
```

### KVの内容確認
```bash
# メッセージ一覧
wrangler kv:key list --namespace-id="your-kv-id"

# 特定のメッセージ取得
wrangler kv:key get "vault-id/user-id/message-id" --namespace-id="your-kv-id"
```

### Obsidian Pluginのデバッグ
- Obsidianの開発者ツールを開く: `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac)
- Consoleでエラーログを確認

### よくある問題

**同期ボタンを押してもメッセージが取得できない**
- Vault IDとLINE User IDが正しく設定されているか確認
- マッピング登録が完了しているか確認
- Worker側のKVにメッセージが保存されているか確認

**LiteratureNoteが作成されない**
- `Enable Article Extraction`がONになっているか確認
- メッセージが本当にURL単体か確認（改行や空白が含まれていないか）
- Worker側で`article`フィールドが正しく保存されているか確認

**Browser Rendering APIでエラー**
- `CLOUDFLARE_ACCOUNT_ID`と`CLOUDFLARE_API_TOKEN`が正しく設定されているか確認
- Cloudflareアカウントでbrowser-rendering.aiが有効か確認

---

## 7. 環境変数一覧（まとめ）

### Cloudflare Worker
| 変数名 | 説明 | 取得方法 |
|--------|------|----------|
| `LINE_CHANNEL_SECRET` | LINEチャネルのシークレット | LINE Developers Console |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEチャネルのアクセストークン | LINE Developers Console |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID | Cloudflare Dashboard |
| `CLOUDFLARE_API_TOKEN` | CloudflareAPIトークン | Cloudflare Dashboard → API Tokens |

### Obsidian Plugin
| 設定項目 | 説明 | 例 |
|----------|------|-----|
| Vault ID | Vault識別用ID | `my-vault-123` |
| LINE User ID | LINEユーザーID | `Uxxxxxxxxxxxx` |
| API URL | WorkerのURL | `https://your-worker.workers.dev` |

---

## 8. 参考リンク

- LINE Messaging API: https://developers.line.biz/ja/docs/messaging-api/
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare KV: https://developers.cloudflare.com/kv/
- Browser Rendering API: https://developers.cloudflare.com/browser-rendering/
