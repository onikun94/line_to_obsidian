# Contributing to Obsidian Line Plugin

このプロジェクトへの貢献を検討していただき、ありがとうございます。

## 開発環境のセットアップ

1. リポジトリをクローンします
```bash
git clone [your-repo-url]
cd obsidian-line
```

2. 依存関係をインストールします
```bash
pnpm install
```

Use the pnpm version declared in `package.json` (9.12.1). Run `pnpm lint`, `pnpm lint:review`,
`pnpm test:run`, and `pnpm build` before opening a pull request. `pnpm lint` applies
Obsidian-specific runtime rules only to the plugin; Cloudflare Workers use the standard
`fetch` API.

The review check uses the official Obsidian preset and documented scanner severity
levels. Forbidden ESLint suppression comments fail CI. Before publishing, also
check **Review branch** in the community developer dashboard; see
[scorecard checks](docs/scorecard.md).

`pnpm build` writes `main.js` and `styles.css` to the repository root beside
`manifest.json`. The public production API URL is built in, so a clean checkout
does not need secrets to reproduce the release. Set `OBSIDIAN_LINE_API_URL`
only when targeting a different server. Release builds must use the default URL.

3. 開発用ビルドを開始します
```bash
pnpm dev
```

## プルリクエストのプロセス

1. 新しい機能やバグ修正のための新しいブランチを作成します
2. 変更を加え、適切なコミットメッセージを付けてコミットします
3. プルリクエストを作成する前に、以下を確認してください：
   - TypeScriptの型チェックが通っていること
   - コードがlintルールに従っていること
   - 必要に応じてドキュメントを更新していること

## コーディング規約

- TypeScriptの型を適切に使用してください
- コメントは日本語で記述してください
- コードフォーマットはPrettierの設定に従ってください

## 質問や提案

質問や提案がある場合は、Issueを作成してください。
