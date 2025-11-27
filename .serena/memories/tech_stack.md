# 技術スタック

## プログラミング言語
- **TypeScript 4.7.4**: 主要開発言語
- **JavaScript ESNext**: ビルドターゲット（ES6互換）

## フレームワーク・ライブラリ

### Obsidian Plugin
- **Obsidian API**: プラグイン開発用公式API
- **crypto-browserify**: ブラウザ環境での暗号化処理
- **buffer**: Node.js Buffer API のポリフィル
- **stream-browserify**: Stream API のポリフィル

### Cloudflare Worker
- **Hono 3.12.0**: 軽量Webフレームワーク（Express/Fastify ライク）
- **@line/bot-sdk 9.7.1**: LINE Messaging API SDK
- **@cloudflare/workers-types**: Cloudflare Workers 型定義

## ビルド・開発ツール
- **pnpm 9.12.1**: パッケージマネージャー（monorepo サポート）
- **esbuild 0.17.3**: 高速バンドラー（TypeScript → JavaScript）
- **tsc**: TypeScript コンパイラ（型チェック用）

## コード品質ツール
- **Biome 2.3.7**: フォーマッター・リンター（Prettier + ESLint の代替）
  - フォーマット、リント、インポート整理を一括管理
  - 高速・設定が簡単

## テストツール
- **Vitest 3.2.4** (obsidian-plugin), **1.0.0** (cloudflare-worker): テストランナー（Vite ベース、Jest 互換API）
- **@vitest/coverage-v8**: カバレッジレポート生成
- **jsdom**: ブラウザ環境のモック（DOM操作テスト用）

## デプロイ・インフラ
- **Cloudflare Workers**: サーバーレス実行環境（日本リージョン）
- **Wrangler 3.x/4.x**: Cloudflare Workers CLI（デプロイ・開発サーバー）

## TypeScript 設定
- **厳格な型チェック**: `noImplicitAny: true`, `strictNullChecks: true`
- **モジュール解決**: Node.js スタイル（ESM）
- **ターゲット**: ES6（Obsidian 互換性）
- **ライブラリ**: DOM, ES5-ES7, WebWorker

## その他
- **Git**: バージョン管理
- **GitHub Actions**: CI/CD（自動リリース、PR チェック）
- **MIT License**: オープンソースライセンス
