# コードベース構造

## プロジェクト全体構造
```
line_to_obsidian/
├── .github/                  # GitHub Actions ワークフロー
│   └── workflows/
│       ├── auto-release.yml  # 自動リリースワークフロー
│       └── pr.yml            # PR チェックワークフロー
├── .serena/                  # Serena MCP メモリ
├── .vscode/                  # VS Code 設定
├── docs/                     # ドキュメント
│   └── requirements.md       # 新機能要件定義（記事本文取得機能）
├── packages/                 # monorepo パッケージ
│   ├── obsidian-plugin/     # Obsidian プラグイン
│   └── cloudflare-worker/   # Cloudflare Worker
├── biome.jsonc              # Biome 設定（フォーマット・リント）
├── CONTRIBUTING.md          # コントリビューションガイド
├── LICENSE                  # MIT ライセンス
├── manifest.json            # Obsidian プラグインマニフェスト
├── package.json             # ルートパッケージ設定
├── pnpm-lock.yaml           # pnpm ロックファイル
├── pnpm-workspace.yaml      # pnpm workspace 設定
├── README.md                # プロジェクト README
├── version-bump.mjs         # バージョン管理スクリプト
├── versions.json            # バージョン履歴
└── wrangler.toml            # Cloudflare Wrangler 設定
```

## Obsidian Plugin パッケージ構造
```
packages/obsidian-plugin/
├── src/
│   ├── main.ts              # メインプラグインクラス
│   │   - LinePlugin: Plugin のメインクラス
│   │   - LinePluginSettings: 設定インターフェース
│   │   - LineSettingTab: 設定タブ UI
│   │   - LineMessage: メッセージ型定義
│   │   - parseFrontmatterTemplate: Frontmatter テンプレート解析
│   │   - parseMessageTemplate: メッセージテンプレート解析
│   ├── constants.ts         # 定数定義
│   └── crypto/              # 暗号化機能
│       ├── cryptoUtils.ts   # 暗号化ユーティリティ
│       ├── errorHandler.ts  # エラーハンドリング
│       ├── keyManager.ts    # 鍵管理
│       └── messageEncryptor.ts  # メッセージ暗号化
├── tests/
│   ├── setup.ts             # テスト環境セットアップ
│   ├── mocks/
│   │   └── obsidian.ts      # Obsidian API モック
│   ├── unit/
│   │   ├── main.test.ts     # メインロジックテスト
│   │   └── constants.test.ts
│   └── crypto/
│       ├── cryptoUtils.test.ts
│       └── messageEncryptor.test.ts
├── esbuild.config.mjs       # esbuild ビルド設定
├── package.json
├── tsconfig.json            # TypeScript 設定
└── vitest.config.ts         # Vitest テスト設定
```

### 主要機能モジュール

#### crypto/ ディレクトリ
- **cryptoUtils.ts**: 暗号化・復号化の基本機能
- **keyManager.ts**: 公開鍵・秘密鍵の管理
- **messageEncryptor.ts**: メッセージの暗号化・復号化
- **errorHandler.ts**: 暗号化関連エラーの統一処理

#### main.ts の主要クラス
1. **LinePlugin**: 
   - Obsidian Plugin の基底クラスを継承
   - プラグインのライフサイクル管理（onload, onunload）
   - 設定の読み込み・保存
   - リボンアイコン、コマンドパレット登録
   - メッセージ同期処理

2. **LineSettingTab**:
   - 設定画面の UI 構築
   - Vault ID, LINE User ID の入力
   - 同期設定（自動同期、同期間隔など）
   - 公開鍵登録処理

## Cloudflare Worker パッケージ構造
```
packages/cloudflare-worker/
├── src/
│   └── worker.ts            # Worker メインファイル（Hono app）
│       - Hono アプリケーション定義
│       - CORS ミドルウェア
│       - エンドポイント:
│         * GET /health
│         * POST /webhook (LINE Webhook)
│         * POST /publickey/register
│         * GET /publickey/:userId
│         * POST /mapping (VaultID ↔ UserID マッピング)
│         * GET /messages/:vaultId/:userId
│         * GET /messages/:vaultId
│         * POST /messages/update-sync-status
│       - ユーティリティ関数:
│         * arrayBufferToBase64, base64ToArrayBuffer
│         * pemToBase64
│         * getVaultIdForUser
├── tests/
│   ├── setup.ts
│   └── unit/
│       └── worker.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Worker の主要機能
1. **LINE Webhook 処理**: LINE からのメッセージ受信
2. **公開鍵管理**: Obsidian からの公開鍵登録・取得
3. **Vault-User マッピング**: Vault ID と LINE User ID の紐付け
4. **メッセージ保存**: 暗号化メッセージを D1 データベースに保存
5. **メッセージ取得**: Obsidian からの同期リクエスト処理

## 設定ファイル

### biome.jsonc
- フォーマット、リント、インポート整理の設定
- 対象: `packages/**/*.{js,jsx,ts,tsx}`, `**/*.json`
- 除外: `node_modules`, `dist`

### tsconfig.json（共通設定）
- `noImplicitAny: true`: 暗黙の any を禁止
- `strictNullChecks: true`: Null 安全性
- `target: ES6`: Obsidian 互換
- `module: ESNext`: ESM モジュール

### vitest.config.ts
- テスト環境: jsdom（DOM API サポート）
- グローバル API: 有効
- セットアップファイル: `tests/setup.ts`
- カバレッジ: v8 プロバイダー
- エイリアス: `@/` → `src/`, `obsidian` → モック

## データフロー概要

### メッセージ送信フロー
1. ユーザーが LINE にメッセージ送信
2. LINE Webhook が Cloudflare Worker に POST
3. Worker がメッセージを処理・D1 に保存
4. Obsidian Plugin が定期的に Worker から取得
5. Plugin がメッセージを復号化してノートとして保存

### 公開鍵登録フロー
1. Obsidian Plugin が鍵ペアを生成
2. 公開鍵を Worker に POST
3. Worker が D1 に保存
4. LINE からのメッセージ暗号化に使用

## ビルド成果物
- **Obsidian Plugin**: `main.js`（esbuild でバンドル）
- **Cloudflare Worker**: `dist/worker.js`（esbuild でバンドル）
