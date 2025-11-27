# コードスタイル・規約

## コードフォーマット・リント
プロジェクトでは **Biome** を使用してコードの品質とスタイルを統一しています。

### Biome 設定（biome.jsonc）

#### フォーマット規則
- **インデント**: 2スペース（`indentStyle: "space", indentWidth: 2`）
- **行幅**: 80文字（`lineWidth: 80`）
- **クォート**: シングルクォート（`quoteStyle: 'single'`）
- **セミコロン**: 必須（`semicolons: "always"`）
- **末尾カンマ**: 常に付ける（`trailingCommas: "all"`）
- **JSX**: シングルクォート（`jsxQuoteStyle: 'single'`）

#### リント規則
- **推奨ルール**: すべて有効（`recommended: true`）
- **セキュリティ**: `noDangerouslySetInnerHtml` は無効化
- **インポート整理**: 自動ソート有効（`organizeImports: "on"`）

#### 対象ファイル
- TypeScript/JavaScript: `packages/**/*.{js,jsx,ts,tsx}`
- JSON: `**/*.json`
- 除外: `node_modules`, `dist` ディレクトリ

## TypeScript 規約

### 型チェック
- **型の明示**: `noImplicitAny: true` - 暗黙の any を禁止
- **Null安全**: `strictNullChecks: true` - null/undefined を厳格にチェック
- **厳格モード**: 型の安全性を最大限確保

### 型定義の例
```typescript
// インターフェース定義（packages/obsidian-plugin/src/main.ts より）
interface LinePluginSettings {
  vaultId: string;
  lineUserId: string;
  encryptionKey: string;
  // ...
}

// クラス定義
class LinePlugin extends Plugin {
  settings: LinePluginSettings;
  // ...
}
```

## 命名規約

### ファイル名
- **小文字 + camelCase**: 一般的なファイル名
  - 例: `main.ts`, `worker.ts`, `cryptoUtils.ts`
- **ディレクトリ名**: 小文字 + ハイフン
  - 例: `obsidian-plugin`, `cloudflare-worker`

### 変数・関数
- **camelCase**: 変数、関数、メソッド
  - 例: `lineUserId`, `getVaultIdForUser`, `arrayBufferToBase64`
- **UPPER_CASE**: 定数
  - 例: `DEFAULT_SETTINGS`

### クラス・インターフェース
- **PascalCase**: クラス名、インターフェース名、型名
  - 例: `LinePlugin`, `LineMessage`, `PublicKeyData`

## コメント
- **日本語**: コメントは日本語で記述（CONTRIBUTING.md より）
- **TSDoc**: 必要に応じて関数・クラスにドキュメントコメントを追加

```typescript
/**
 * メッセージを暗号化する
 * @param message - 暗号化するメッセージ
 * @returns 暗号化されたメッセージ
 */
async function encryptMessage(message: string): Promise<ArrayBuffer> {
  // ...
}
```

## インポート
- **自動整理**: Biome が自動でインポートをソート
- **絶対パス**: テストでは `@/` プレフィックスを使用（`@/crypto/cryptoUtils` など）
- **モック**: テストでは `obsidian` モジュールをモック（`tests/mocks/obsidian.ts`）

## テストコード

### テストファイル命名
- **`*.test.ts`**: ユニットテスト
- **`setup.ts`**: テスト環境セットアップ

### テスト構造
- **Vitest**: describe/it/expect パターン（Jest 互換）
- **globals: true**: グローバル API 使用可能
- **環境**: jsdom（DOM 操作テスト用）

## エラーハンドリング
- **明示的な型**: エラーは適切に型定義
- **Null チェック**: strictNullChecks により厳格に管理

## ベストプラクティス
1. **型安全**: any の使用を避け、明示的な型定義を使用
2. **分離**: 関心の分離（crypto/, main.ts など機能ごとにファイル分割）
3. **テスタビリティ**: モック可能な設計
4. **ドキュメント**: 必要に応じて日本語コメントを追加
