# Payment Pages for LINE to Obsidian

Cloudflare Pages にデプロイする課金ページです。

## セットアップ

### 1. Cloudflare Pages プロジェクトの作成

```bash
# Cloudflare ダッシュボードからプロジェクトを作成
# または wrangler を使用
wrangler pages project create line-to-obsidian-payment
```

### 2. 環境変数の設定

Cloudflare Pages の設定で以下の環境変数を設定します：

- `API_BASE_URL`: Cloudflare Worker の URL (例: `https://line-to-obsidian.your-subdomain.workers.dev`)

### 3. ビルド設定

- **ビルドコマンド**: なし（静的HTML）
- **ビルド出力ディレクトリ**: `/`

### 4. デプロイ

```bash
# 手動デプロイ
wrangler pages deploy . --project-name=line-to-obsidian-payment
```

## ファイル構成

- `index.html` - サービス紹介ランディングページ
- `checkout.html` - 課金ページ（LINE User ID 入力 + 購入ボタン）
- `success.html` - 決済成功ページ
- `cancel.html` - 決済キャンセルページ
- `portal.html` - Stripe Customer Portal へのリダイレクトページ
- `tokushoho.html` - 特定商取引法に基づく表記
- `privacy.html` - プライバシーポリシー
- `terms.html` - 利用規約

## API Base URL の置換

デプロイ前に各HTMLファイル内の `{{API_BASE_URL}}` を実際のWorker URLに置き換えるか、
Cloudflare Pages の Functions を使用して動的に置換することができます。

### 簡易的な方法（sed）

```bash
API_URL="https://line-to-obsidian.your-subdomain.workers.dev"
sed -i '' "s|{{API_BASE_URL}}|$API_URL|g" *.html
```

### Cloudflare Pages Functions を使用する方法

`functions/_middleware.js` を作成して動的に置換することも可能です。
