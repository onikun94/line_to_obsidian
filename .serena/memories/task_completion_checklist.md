# タスク完了時のチェックリスト

コードの変更や新機能の実装後、以下のステップを実行して品質を確保してください。

## 1. フォーマットチェック
```bash
pnpm format
```
- Biome による自動フォーマットを適用
- コードスタイルの統一を保証
- インデント、クォート、セミコロンなどを自動修正

## 2. リントチェック
```bash
pnpm lint
```
- Biome によるリントチェック
- コード品質の問題を検出

エラーがある場合は自動修正を試す：
```bash
pnpm lint:fix
```

## 3. 型チェック（自動実行）
```bash
pnpm build
```
- ビルドプロセスで TypeScript の型チェックが自動実行される
- `tsc -noEmit -skipLibCheck` が内部で実行される
- 型エラーがないことを確認

## 4. テスト実行
```bash
pnpm test:run
```
- すべてのユニットテストを1回実行
- Obsidian プラグインと Cloudflare Worker の両方をテスト

パッケージ別にテストしたい場合：
```bash
pnpm test:obsidian        # Obsidian プラグインのみ
pnpm test:worker          # Cloudflare Worker のみ
```

## 5. カバレッジ確認（オプション）
重要な機能追加の場合：
```bash
pnpm test:coverage
```
- テストカバレッジレポートを生成
- 未テストコードを確認

## 6. ドキュメント更新
必要に応じて以下を更新：
- `README.md`: 機能追加や使い方の変更
- `CONTRIBUTING.md`: 開発プロセスの変更
- `docs/`: 要件や設計ドキュメント

## 7. コミット前の最終確認
```bash
git status                # 変更ファイルを確認
git diff                  # 変更内容を確認
```

すべてのチェックをパスしたら：
```bash
git add .
git commit -m "適切なコミットメッセージ"
git push
```

## クイックチェックコマンド（推奨）
一度にすべてのチェックを実行：
```bash
pnpm format && pnpm lint && pnpm test:run
```

## GitHub PR 作成時の確認
PR作成前に以下を確認：
1. ✅ フォーマット・リントが通る
2. ✅ TypeScript 型チェックが通る
3. ✅ すべてのテストがパス
4. ✅ 新機能にはテストが追加されている
5. ✅ ドキュメントが更新されている（必要な場合）
