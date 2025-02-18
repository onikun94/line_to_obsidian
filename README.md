# Obsidian LINE Plugin

ObsidianとLINEを連携させるプラグインです。LINEからメッセージを送信すると、Obsidianのノートとして保存されます。

## プロジェクト構成

このプロジェクトは2つの主要なパッケージで構成されています：

1. `packages/cloudflare-worker`: LINEからのメッセージを受け取り、Obsidianに転送するCloudflare Worker
2. `packages/obsidian-plugin`: メッセージを受け取り、ノートとして保存するObsidianプラグイン

## 開発環境のセットアップ

1. 依存関係のインストール:
```bash
pnpm install
```

2. 開発モードの起動:

- Obsidianプラグインの開発:
```bash
pnpm dev
```

- Cloudflare Workerの開発:
```bash
pnpm --filter cloudflare-worker dev
```

## ビルドとデプロイ

### ビルド

全パッケージのビルド:
```bash
pnpm build
```

個別のパッケージのビルド:
```bash
pnpm --filter obsidian-plugin build
pnpm --filter cloudflare-worker build
```

### デプロイ

Cloudflare Workerのデプロイ:
```bash
pnpm --filter cloudflare-worker deploy
```

## 設定

### Cloudflare Worker

1. `wrangler.toml`の設定
2. LINE Messaging APIの設定
   - チャネルシークレット
   - チャネルアクセストークン

### Obsidianプラグイン

1. プラグインの有効化
2. Webhook URLの設定

## ライセンス

MIT 