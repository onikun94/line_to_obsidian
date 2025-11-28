# URL記事抽出機能の実装記録

## 実装概要

LINEからURL単体を送信した際に、Browser Rendering APIでMarkdown化してLiteratureNoteとして保存する機能を実装中。

## システム要件

### 機能仕様
- **URL単体メッセージ**: LINEでURL単体を送信 → Worker側でBrowser Rendering APIを使ってMarkdown取得 → KVに保存 → Obsidian PluginでLiteratureNoteファイル作成 + Dailyにも記載
- **URL混在メッセージ**: URLとテキストが混在している場合 → 従来通りDailyノートにリンク列挙のみ

### データフロー
1. Worker: LINE Webhook受信 → URL単体判定 → Browser Rendering API呼び出し → Markdown + OGP取得 → KVに格納
2. Plugin: KV取得 → `isUrlOnly === true` かつ `article` が存在 → LiteratureNote作成 + Daily記載

## 完了したタスク（バックエンド実装）

### 1. LineMessage型の拡張 (packages/cloudflare-worker/src/worker.ts)

```typescript
type LineMessage = {
  timestamp: number;
  messageId: string;
  userId: string;
  text: string;
  vaultId: string;
  synced?: boolean;
  isUrlOnly: boolean;  // URL単体かどうか（必須フィールド）
  article?: {          // 記事情報（URL単体の場合のみ存在）
    url: string;
    title: string;
    description?: string;
    author?: string;
    image?: string;
    markdown: string;
  };
};
```

### 2. URL単体判定関数

```typescript
function isUrlOnly(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/.+$/.test(trimmed) && !trimmed.includes('\n');
}
```

- URL単体であることを判定
- 改行が含まれている場合はfalse（複数行メッセージ）
- http/https のみ対応

### 3. OGP/タイトル抽出関数

```typescript
function extractOgpMeta(html: string, property: string): string | undefined
function extractTitle(html: string): string
```

- OGPタグ優先、フォールバック: titleタグ
- 正規表現でHTML解析

### 4. Browser Rendering API呼び出し関数

```typescript
async function fetchArticleMarkdown({
  url,
  env,
}: {
  url: string;
  env: Env;
}): Promise<{...} | null>
```

- Cloudflare SDK (`cloudflare` パッケージ) を使用
- `client.browserRendering.markdown.create()` でMarkdown取得
- 不要な要素削除: `aside, header, footer`
- リソース除外: `stylesheet, image, media, font`
- エラー時は `null` を返す

### 5. Webhook処理への統合

```typescript
const text = event.message.text;
const urlOnly = isUrlOnly(text);

const articleResult = urlOnly
  ? await fetchArticleMarkdown({ url: text.trim(), env: c.env })
  : null;

const article = articleResult ?? undefined;

const message: LineMessage = {
  timestamp: event.timestamp,
  messageId: event.message.id,
  userId: userId,
  text,
  vaultId: vaultId,
  synced: false,
  isUrlOnly: urlOnly,
  article,
};
```

### 6. 環境変数確認

- `CLOUDFLARE_ACCOUNT_ID`: 既に `worker-configuration.d.ts` に定義済み
- `CLOUDFLARE_API_TOKEN`: 既に `worker-configuration.d.ts` に定義済み
- `cloudflare` パッケージ: 既にインストール済み

## 影響範囲分析

### KV構造
- **変更なし**: `${vaultId}/${userId}/${messageId}` のキー構造は維持
- **フィールド追加**: LineMessage型に `isUrlOnly` と `article` フィールドを追加
- **互換性**: 既存の取得・更新処理は互換性あり（新フィールドは単に追加されるだけ）

### LineMessage使用箇所
1. `GET /messages/:vaultId/:userId` - メッセージ取得（影響なし）
2. `POST /messages/update-sync-status` - 同期ステータス更新（影響なし）
3. `POST /webhook` - メッセージ作成（実装済み）

## 次にやるべきこと

### フロントエンド実装（Obsidian Plugin側）

1. **LineMessage型の同期** (packages/obsidian-plugin/src/main.ts)
   - Worker側と同じ型定義に更新

2. **LiteratureNote生成処理**
   - `syncMessages()` 内で `isUrlOnly` フラグを確認
   - `isUrlOnly === true` かつ `article` 存在 → `createLiteratureNote()` 呼び出し
   - 従来のDaily追記処理も実行（両方に記録）

3. **LiteratureNoteファイル作成関数**
   - ファイル名生成: タイトルからスラッグ化（日本語対応）
   - Frontmatter生成: title, source, author, created, description, image, tags
   - 本文: `article.markdown`
   - 重複ファイル処理: タイムスタンプ付与

4. **設定項目追加**
   - `enableArticleExtraction: boolean` - 機能の有効/無効
   - `literatureNoteFolder: string` - 保存先フォルダパス

5. **エラーハンドリング**
   - Browser Rendering API失敗時のフォールバック
   - タイムアウト処理

### テスト実装

1. Worker側テスト
   - URL単体判定テスト
   - OGP抽出テスト
   - Browser Rendering APIモックテスト

2. Plugin側テスト
   - LiteratureNote生成テスト
   - ファイル名スラッグ化テスト
   - 重複処理テスト

## コーディング規約

- **let禁止**: `const` のみ使用
- **バレルインポート禁止**: `@/` aliasで個別インポート
- **TypeScript型定義を厳密に**
- **日本語コメント**推奨
- **関数にJSDocコメント**必須

## 参考リポジトリ

- Browser Rendering実装例: https://github.com/Suntory-Y-Water/browser-rendering-markdown/blob/main/src/index.ts
