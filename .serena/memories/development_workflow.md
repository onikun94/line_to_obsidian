# 開発ワークフロー

## 開発環境セットアップ

### 初回セットアップ
1. リポジトリをクローン
```bash
git clone https://github.com/onikun94/line_to_obsidian.git
cd line_to_obsidian
```

2. 依存関係をインストール
```bash
pnpm install
```

3. 環境変数設定（必要な場合）
```bash
# packages/obsidian-plugin/.env を作成
cp packages/obsidian-plugin/.env.sample packages/obsidian-plugin/.env
# 必要な環境変数を設定
```

## 通常の開発フロー

### 1. ブランチ作成
新機能やバグ修正のために新しいブランチを作成：
```bash
git checkout -b feature/<feature-name>
# または
git checkout -b fix/<bug-name>
```

現在のブランチ: `feature-ai-summary-articles`
メインブランチ: `main`

### 2. 開発
#### Obsidian Plugin 開発
```bash
pnpm dev
# または
pnpm --filter obsidian-plugin dev
```
- esbuild が watch モードで起動
- ファイル変更を検知して自動リビルド
- Obsidian の開発用 vault にシンボリックリンクを設定すると便利

#### Cloudflare Worker 開発
```bash
pnpm --filter cloudflare-worker dev
```
- Wrangler の開発サーバーが起動
- ローカルで Worker をテスト可能

### 3. テスト駆動開発（推奨）
新機能実装時：
1. テストを先に書く（`tests/` ディレクトリ）
2. テストを実行（失敗することを確認）
```bash
pnpm test:watch
```
3. 実装してテストをパスさせる
4. リファクタリング

### 4. コード品質チェック
実装中に定期的に実行：
```bash
pnpm format          # フォーマット自動適用
pnpm lint            # リントチェック
```

### 5. コミット
```bash
git add .
git status           # 変更内容を確認
git diff --cached    # ステージングされた変更を確認
git commit -m "feat: 機能の説明"
```

#### コミットメッセージ規約（推奨）
- `feat:` - 新機能
- `fix:` - バグ修正
- `docs:` - ドキュメント変更
- `style:` - コードスタイル変更（機能変更なし）
- `refactor:` - リファクタリング
- `test:` - テスト追加・修正
- `chore:` - ビルドプロセスやツールの変更

### 6. プッシュ
```bash
git push origin feature/<feature-name>
```

### 7. プルリクエスト作成
1. GitHub でプルリクエストを作成
2. ベースブランチ: `main`
3. PR テンプレートに従って記述
4. CI チェックが通ることを確認

#### PR チェック内容（`.github/workflows/pr.yml`）
- フォーマットチェック
- リントチェック
- テスト実行

## リリースフロー

### バージョンアップ
```bash
# パッチバージョン（0.4.2 → 0.4.3）
pnpm release:patch

# マイナーバージョン（0.4.2 → 0.5.0）
pnpm release:minor

# メジャーバージョン（0.4.2 → 1.0.0）
pnpm release:major
```

これにより以下が自動実行：
1. `version-bump.mjs` でバージョン番号を更新
2. `manifest.json`, `versions.json` を更新
3. Git コミット作成
4. Git タグ作成
5. リモートにプッシュ（コミット + タグ）

### 自動リリース（`.github/workflows/auto-release.yml`）
タグプッシュ時に以下が自動実行：
1. ビルド実行
2. GitHub Release 作成
3. リリースノート自動生成

## デバッグ

### Obsidian Plugin のデバッグ
1. Obsidian の開発者ツールを開く（Ctrl/Cmd + Shift + I）
2. Console でログ確認
3. ブレークポイント設定

### Cloudflare Worker のデバッグ
1. Wrangler の開発サーバーでローカルテスト
```bash
pnpm --filter cloudflare-worker dev
```
2. `console.log()` でログ出力
3. Cloudflare Dashboard でログ確認

### テストのデバッグ
```bash
# UI モード（推奨）
pnpm --filter obsidian-plugin test --ui

# 特定のテストファイルのみ実行
pnpm --filter obsidian-plugin test main.test.ts

# デバッグモード
pnpm --filter obsidian-plugin test --inspect-brk
```

## トラブルシューティング

### 依存関係の問題
```bash
# node_modules と lockfile を削除して再インストール
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
```

### ビルドエラー
```bash
# TypeScript の型チェックのみ実行
pnpm --filter obsidian-plugin build

# 詳細なエラー情報を確認
tsc --noEmit --skipLibCheck
```

### テスト失敗
```bash
# 特定のテストファイルのみ実行
pnpm --filter obsidian-plugin test <test-file>

# カバレッジを確認して未テストコードを特定
pnpm --filter obsidian-plugin test:coverage
```

## ベストプラクティス

1. **小さいコミット**: 機能ごとに小さくコミット
2. **テスト追加**: 新機能には必ずテストを追加
3. **型安全**: TypeScript の型を適切に定義
4. **コードレビュー**: PR は他の開発者にレビューを依頼
5. **ドキュメント**: 重要な変更はドキュメントも更新
6. **定期的なリベース**: main ブランチの変更を定期的に取り込む

```bash
git fetch origin
git rebase origin/main
```
