# よく使うコマンド

## パッケージ管理

### インストール
```bash
pnpm install              # 全依存関係をインストール
```

### パッケージ追加
```bash
pnpm add <package>        # ルートに追加
pnpm --filter obsidian-plugin add <package>     # Obsidian プラグインに追加
pnpm --filter cloudflare-worker add <package>   # Cloudflare Worker に追加
```

## 開発

### 開発モード
```bash
pnpm dev                  # Obsidian プラグインの開発ビルド（watchモード）
```

### ビルド
```bash
pnpm build                # Obsidian プラグインをビルド
pnpm --filter cloudflare-worker build  # Cloudflare Worker をビルド
```

## コード品質

### フォーマット
```bash
pnpm format               # Biomeでコードを自動フォーマット（書き込み）
pnpm format:check         # フォーマットチェックのみ（変更なし）
```

### リント
```bash
pnpm lint                 # Biomeでリントチェック
pnpm lint:fix             # リント問題を自動修正
```

## テスト

### すべてのテストを実行
```bash
pnpm test                 # 全パッケージのテスト（watchモード）
pnpm test:run             # 全パッケージのテストを1回実行
```

### パッケージ別テスト
```bash
pnpm test:obsidian        # Obsidian プラグインのみテスト
pnpm test:worker          # Cloudflare Worker のみテスト
```

### テストモード
```bash
pnpm --filter obsidian-plugin test:watch    # watchモード
pnpm --filter obsidian-plugin test:run      # 1回実行
pnpm --filter obsidian-plugin test:coverage # カバレッジレポート生成
```

### カバレッジ
```bash
pnpm test:coverage        # 全パッケージのカバレッジレポート生成
```

## デプロイ

### Cloudflare Worker
```bash
pnpm deploy               # Cloudflare Worker をデプロイ
pnpm --filter cloudflare-worker dev  # ローカル開発サーバー起動
```

## バージョン管理・リリース

### バージョンアップ
```bash
pnpm version patch        # パッチバージョンアップ（0.4.2 → 0.4.3）
pnpm version minor        # マイナーバージョンアップ（0.4.2 → 0.5.0）
pnpm version major        # メジャーバージョンアップ（0.4.2 → 1.0.0）
```

### リリース（タグ付きプッシュ）
```bash
pnpm release:patch        # パッチリリース（version + push + tag push）
pnpm release:minor        # マイナーリリース
pnpm release:major        # メジャーリリース
```

## Git コマンド（Darwin/macOS）

### 基本操作
```bash
git status                # 変更状況確認
git add .                 # 全変更をステージング
git commit -m "message"   # コミット
git push                  # リモートにプッシュ
git push --tags           # タグをプッシュ
```

### ブランチ操作
```bash
git checkout -b <branch>  # 新しいブランチを作成・切り替え
git branch                # ブランチ一覧
git merge <branch>        # ブランチをマージ
```

## ファイル操作（Darwin/macOS）

### 検索
```bash
find . -name "*.ts"       # ファイル検索
grep -r "keyword" .       # テキスト検索（再帰的）
```

### 一覧・表示
```bash
ls -la                    # ファイル一覧（詳細）
cat <file>                # ファイル内容表示
head -n 20 <file>         # 先頭20行表示
tail -n 20 <file>         # 末尾20行表示
```

### ディレクトリ操作
```bash
cd <directory>            # ディレクトリ移動
pwd                       # 現在のディレクトリパス表示
mkdir <directory>         # ディレクトリ作成
```

## ワークフロー確認

### GitHub Actions
```bash
gh run list               # ワークフロー実行履歴
gh run view <run-id>      # 実行詳細表示
gh pr checks              # PR のチェック状況
```

## 推奨: タスク完了時の確認コマンド
```bash
pnpm format               # フォーマット
pnpm lint                 # リント
pnpm test:run             # テスト実行
```
