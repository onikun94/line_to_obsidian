# LINE Notes Sync - プロジェクト概要

## プロジェクトの目的
LINE Notes Syncは、LINEとObsidianを連携するプラグインです。LINEから送信されたメッセージを自動的にObsidianノートとして保存し、情報管理を効率化します。

### 主な機能
- **自動同期**: LINEメッセージをObsidianノートとして自動保存
- **メッセージ暗号化**: 送信前にメッセージを暗号化してセキュリティを確保
- **柔軟な整理**: 日付ごとにノートを整理可能
- **カスタムファイル名**: {date}, {time}, {messageId}などのテンプレート変数を使用可能
- **重複防止**: 重複メッセージを自動処理
- **マルチボールト対応**: 複数のObsidianボールトを一意のVault IDで管理

### セキュリティ
- メッセージはサーバー送信前に暗号化
- Cloudflareサーバーには暗号化された状態で一時保存
- サーバーはメッセージ内容を復号化できない
- メッセージは10日後に自動削除
- サーバーは日本リージョンで動作

## システムアーキテクチャ

### コンポーネント構成
1. **LINE Messaging API**: ユーザーからのメッセージを受信
2. **Cloudflare Worker**: メッセージを処理・転送（Hono フレームワーク使用）
3. **Obsidian Plugin**: メッセージを受信してノートとして保存

### データフロー
LINE → Webhook → Cloudflare Worker（暗号化メッセージ処理） → Obsidian Plugin（復号化・保存）

## 新機能要件（進行中）
docs/requirements.md に記載されている「記事本文自動取得機能」を開発中：
- LINEからURLを送信すると、Browser Rendering APIを使ってHTML→Markdown変換
- 変換したMarkdownをObsidian Dailyノートに自動保存
- 人間の判断時間を短縮し、情報資産の循環を促進

## プロジェクト構造
```
line_to_obsidian/
├── packages/
│   ├── obsidian-plugin/     # Obsidian プラグイン本体
│   │   ├── src/
│   │   │   ├── main.ts      # メインプラグインクラス
│   │   │   ├── constants.ts
│   │   │   └── crypto/      # 暗号化関連機能
│   │   └── tests/
│   └── cloudflare-worker/   # Cloudflare Worker（メッセージ処理）
│       ├── src/
│       │   └── worker.ts    # Worker メインファイル（Hono app）
│       └── tests/
├── docs/                    # ドキュメント
│   └── requirements.md      # 新機能要件定義
├── biome.jsonc             # コード品質設定
├── package.json            # ルートパッケージ設定
└── pnpm-workspace.yaml     # monorepo 設定
```

## 制限事項
- **デスクトップのみ**: Obsidian モバイルでは利用不可
- **テキストメッセージのみ**: 画像・動画などは未対応
- **一方向同期**: LINE → Obsidian のみ
- **メッセージ有効期限**: サーバー上で10日後に削除
