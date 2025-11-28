# Development Workflow Rules

このファイルは、Claude Codeを使用した開発ワークフローの標準手順を定義します。
新機能の追加やバグ修正を行う際は、以下のフローに従ってください。

## 基本方針

- **できるだけ全てのフェーズを実行する**（タイプ別の推奨フローは下記参照）
- **各フェーズで TodoWrite ツールを活用**して進捗を管理する
- **不明点があれば AskUserQuestion で確認**してから進める
- **エラーが発生したら必ず修正**してから次のフェーズに進む
- **コミット前にすべてのチェックがパス**していることを確認
- **段階的にコミット**し、大きすぎる変更を避ける

## 細かいルール

- 日本語で回答
- セクションで「1-1」みたいな番号つけない
- 末尾に「：」や「:」をつけない
- 本プロジェクトのランタイムは`Bun`で動いている

---

## クイックリファレンス

変更のタイプに応じて、適切なフローを選択してください：

| 変更タイプ | 推奨フロー | 所要時間目安 | 説明 |
|-----------|-----------|-------------|------|
| **新機能追加** | Phase 1-8 全て | 60-120分 | 完全なワークフロー |
| **中規模バグ修正** | 1,3,4,6,7,8 | 30-60分 | 調査→実装→確認 |
| **小規模リファクタ** | 1,3,4,6,7,8 | 15-30分 | 既存パターン踏襲 |
| **タイポ修正** | 4,6,7,8 | 5分 | 設定ファイルや小さな修正 |
| **ドキュメント更新** | 4,7,8 | 5-10分 | ドキュメントのみの変更 |

---

## フェーズ概要

### 必須フェーズ vs 任意フェーズ

#### 必須フェーズ（ほぼすべてのケースで実行）
1. **Phase 1: Investigation & Research** - Context7/Kiriで調査
3. **Phase 3: Planning** - TodoWriteで計画立案
4. **Phase 4: Implementation** - Serenaでコード実装
6. **Phase 6: Quality Checks** - bun run でチェック実行
7. **Phase 7: Git Commit** - コミット作成
8. **Phase 8: Push** - リモートへプッシュ

#### 状況に応じて実行（推奨）
2. **Phase 2: Architecture Design** - 新機能や大規模変更時
5. **Phase 5: Code Review** - リファクタリングが必要な場合

---

## 使用エージェント/コマンド

以下のカスタムコマンドが利用可能です：

- **`spec-document-creator`** (`.claude/agents/spec-document-creator.md`) - 拡張可能な仕様書作成コマンド。機能仕様、API仕様、アーキテクチャ仕様など複数のドキュメントタイプをサポート
- **`adr-memory-manager`** (`.claude/agents/adr-memory-manager.md`) - AI用のADR（Architecture Decision Record）を自動記録・検索・管理。JSON形式で機械可読性を最優先に設計
- **`project-onboarding`** (`.claude/agents/project-onboarding.md`) - プロジェクトの構造、ドメイン知識、技術スタック、アーキテクチャパターンを分析・記録。新規プロジェクトのオンボーディングに最適

---

## Workflow Steps

### Phase 1: Investigation & Research (調査フェーズ) 【必須】

**使用ツール**: Context7 MCP, Kiri MCP

#### 1. 既存コードベースの調査（Kiri MCPを使用）

Kiri MCPはSerenaより高度な検索機能を提供します。セマンティック検索、フレーズ認識、依存関係分析などを活用してください。

**1-1. コンテキスト自動取得（推奨）**
```
mcp__kiri__context_bundle
goal: 'user authentication, login flow, JWT validation'
limit: 10
compact: true
```
- タスクに関連するコードスニペットを自動でランク付けして取得
- `goal`には具体的なキーワードを使用（抽象的な動詞は避ける）
- `compact: true`でトークン消費を95%削減

**1-2. 具体的なキーワード検索**
```
mcp__kiri__files_search
query: 'validateToken'
lang: 'typescript'
path_prefix: 'src/auth/'
```
- 関数名、クラス名、エラーメッセージなど具体的な識別子で検索
- 広範な調査には`context_bundle`を使用

**1-3. 依存関係の調査**
```
mcp__kiri__deps_closure
path: 'src/auth/login.ts'
direction: 'inbound'
max_depth: 3
```
- 影響範囲分析（inbound）や依存チェーン（outbound）を取得
- リファクタリング時の影響調査に最適

**1-4. コードの詳細取得**
```
mcp__kiri__snippets_get
path: 'src/auth/login.ts'
```
- ファイルパスがわかっている場合に使用
- シンボル境界を認識して適切なセクションを抽出

#### 2. ライブラリドキュメントの確認
- Context7 MCPを使用して最新のライブラリドキュメントを取得
- 使用するライブラリの最新情報を確認
- `mcp__context7__resolve-library-id` → `mcp__context7__get-library-docs` の順で実行

#### 3. 既存決定の確認（ADR参照）【必須】

**⚠️ 重要: このステップは必ず実行すること**
- **コード調査だけでは不十分**: `codebase_search`やKiri MCPで既存パターンを確認しても、ADR確認は別途必須
- **実装前に必ず確認**: 既存のアーキテクチャ決定に従うか、新しい決定が必要かを判断
- **ADR確認方法**:
  1. `docs/adr/index.json`を確認して関連ADRを特定
  2. 関連するADRファイル（`docs/adr/decisions/*.json`）を読み込む
  3. 実装がADRの決定と一致しているか確認
  4. 新しい決定が必要な場合は`adr-memory-manager`エージェントを使用して記録

**ADR確認のタイミング:**
- Phase 1で初回確認（必須）
- Phase 3（Planning）の前に再確認（推奨）
- Phase 4（Implementation）の前に最終確認（推奨）

#### 4. 調査結果の整理
- 既存パターンやコーディング規約を把握
- 再利用可能なコンポーネントやユーティリティを特定
- Kiriで取得したコンテキストを基に実装方針を決定
- **既存ADRと照合して決定の一貫性を確認**（必須）

**完了チェックリスト:**
- [ ] Kiri MCPで関連コードを特定
- [ ] 必要なライブラリのドキュメントを確認
- [ ] 既存パターンと依存関係を把握
- [ ] **ADRを確認し、既存決定を理解**（必須 - コード調査とは別に実行）
- [ ] 実装がADRの決定と一致していることを確認

---

### Phase 2: Architecture Design (アーキテクチャ設計) 【推奨：新機能/大規模変更時】

**使用エージェント**: spec-document-creator, adr-memory-manager

**このフェーズをスキップできるケース:**
- 既存パターンに完全に倣う場合
- 1ファイル以内の小さな修正
- ドキュメントやスタイルのみの変更

#### 1. 技術的方針の決定
- ファイル配置、ディレクトリ構造の決定
- データフローとモジュール間の関係性の設計
- APIエンドポイントやデータ取得戦略の決定
- **重要な決定は `adr-memory-manager` で記録**

#### 2. 仕様書の作成
- `spec-document-creator` エージェントを使用して仕様書を作成
- 機能仕様、API仕様、アーキテクチャ仕様など必要に応じて作成
- 既存コードからリバースエンジニアリングする場合は、コード分析機能を活用

#### 3. アーキテクチャ決定の記録
- `adr-memory-manager` エージェントを使用して重要な決定を記録
- 決定のコンテキスト、根拠、代替案を記録
- 影響を受けるファイルやモジュールを記録
- 関連するADRとリンク

**完了チェックリスト:**
- [ ] ファイル配置とディレクトリ構造を決定
- [ ] データフローを設計
- [ ] 必要に応じて仕様書を作成
- [ ] 重要なアーキテクチャ決定をADRとして記録

---

### Phase 3: Planning (計画立案) 【必須】

**使用ツール**: TodoWrite tool

**⚠️ 重要: Phase 1の確認**
- **Phase 3の前に必ず確認**:
  - **Phase 1のADR確認が完了しているか確認**（必須）
- **ADRの決定に従った実装計画になっているか確認**

#### 1. 実装計画の作成
- タスクを細分化し、実装順序を決定
- TodoWriteツールで作業項目をトラッキング
- 各タスクの依存関係を明確化
- **ADRの決定に従った実装方針を確認**

#### 2. 計画のレビュー
- 不明確な要件や仕様の洗い出し
- 必要に応じて `AskUserQuestion` で確認
- **実装計画がADRの決定と一致しているか確認**

**注意**: ExitPlanModeツールはplan modeでのみ使用されます。通常の実装フローではTodoWriteのみを使用してください。

**完了チェックリスト:**
- [ ] **Phase 1のADR確認が完了している**（必須）
- [ ] TodoWriteで全タスクを登録
- [ ] **実装計画がADRの決定と一致している**
- [ ] タスクの実行順序を決定
- [ ] 不明点をすべて解消

---

### Phase 4: Implementation (実装) 【必須】

**使用ツール**: Serena MCP (シンボルベース編集), Edit, Write, Read

**⚠️ 重要: Phase 1の確認**
- **実装前に必ず確認**:
  - **Phase 1のADR確認が完了しているか確認**（必須）
- **実装がADRの決定と一致しているか確認**

#### 1. コード実装（Serena MCPを使用）

Serena MCPはシンボルベースのコード編集に特化しています。Phase 1でKiriで調査した内容を基に、Serenaで正確に実装してください。

**1-1. シンボルの置換**
```
mcp__serena__replace_symbol_body
name_path: 'UserAuth/validateToken'
relative_path: 'src/auth/user.ts'
body: '新しい関数実装'
```
- 既存の関数、メソッド、クラスの本体を置換
- シンボルのname_pathで正確に特定

**1-2. 新しいコードの挿入**
```
mcp__serena__insert_after_symbol
name_path: 'UserAuth'
relative_path: 'src/auth/user.ts'
body: '新しいメソッドの実装'
```
- 既存シンボルの後に新しいコードを挿入
- クラスへのメソッド追加、ファイル末尾への関数追加などに使用

**1-3. シンボルのリネーム**
```
mcp__serena__rename_symbol
name_path: 'validateToken'
relative_path: 'src/auth/user.ts'
new_name: 'verifyJwtToken'
```
- シンボルをプロジェクト全体でリネーム
- すべての参照が自動的に更新される

**1-4. 参照の確認**
```
mcp__serena__find_referencing_symbols
name_path: 'validateToken'
relative_path: 'src/auth/user.ts'
```
- 変更前に影響範囲を確認
- どのファイル・シンボルが参照しているか特定

#### 2. コーディング規約の遵守
- TypeScriptの型定義を厳密に
- 日本語コメントで意図を明確に
- ESLint、Prettierの設定に従う
- プロジェクト固有のパターンを踏襲
- **バレルインポート禁止**（`@/` aliasを使用した個別インポート）

#### 3. 進捗管理
- TodoWriteツールでタスクを `in_progress` → `completed` に更新
- 一度に1つのタスクに集中

#### 4. ADRの更新（実装完了後）
- `adr-memory-manager` エージェントを使用して実装内容をADRに反映
- Phase 2で記録したADRに実装の詳細を追記
- 実際に実装されたファイル、コンポーネント、パターンを記録
- 実装時の変更点や追加の決定事項があれば記録
- コード例を追加してADRをより実用的に

**完了チェックリスト:**
- [ ] **Phase 1のADR確認が完了している**（必須）
- [ ] Serena MCPでシンボルベース編集を実施
- [ ] TypeScript型定義が厳密
- [ ] バレルインポート未使用
- [ ] 既存パターンに準拠
- [ ] **実装がADRの決定と一致している**
- [ ] 日本語コメントで意図を説明
- [ ] TodoWriteで進捗更新済み
- [ ] 実装完了後、関連するADRを更新・追記（新しい決定が必要な場合）

---

### Phase 5: Code Review (コードレビュー) 【推奨：リファクタリング時】

**このフェーズを実行すべきケース:**
- コードの品質に不安がある場合
- リファクタリングが必要な場合
- 複雑なロジックを実装した場合

#### 1. 実装レビュー
- コードの品質、可読性、保守性を確認
- ベストプラクティスへの準拠を確認
- パフォーマンス上の問題がないか確認
- モジュールの責任分離が適切か確認

#### 2. リファクタリング
- 必要に応じてコードを改善
- 重複コードの削除
- 命名の改善
- モジュールの分割・統合の提案

#### 3. ADRの最終確認・更新
- `adr-memory-manager` エージェントを使用してADRを最終確認
- リファクタリングによる変更があればADRを更新
- 実装がADRの決定と一致しているか確認
- 新しいパターンや変更点があれば追記
- ADRのステータスを「accepted」に更新（実装完了時）

**完了チェックリスト:**
- [ ] コード品質が基準を満たす
- [ ] ベストプラクティスに準拠
- [ ] パフォーマンス問題なし
- [ ] 責任分離が適切
- [ ] 関連するADRを確認し、必要に応じて更新
- [ ] ADRの実装例とコードが一致していることを確認

---

### Phase 6: Quality Checks (品質チェック) 【必須】

**使用ツール**: Bash tool

#### 1. 静的解析とテスト実行

```bash
# 型チェック
bun run typecheck

# Lint
bun run lint

# テスト実行
bun run test

# ビルド確認
bun run build
```

#### 2. エラーの修正
- エラーが発生した場合は修正して再実行
- すべてのチェックがパスするまで繰り返す

**完了チェックリスト:**
- [ ] 型チェックが通る
- [ ] Lintエラーがゼロ
- [ ] すべてのテストが通る
- [ ] ビルドが成功

**トラブルシューティング:**
- エラーが続く場合は Phase 4 に戻って修正
- 必要に応じて `mcp__ide__getDiagnostics` で詳細確認

---

### Phase 7: Git Commit 【必須】

**使用ツール**: Bash tool

#### 1. 変更内容の確認
```bash
git status
git diff
```

#### 2. コミット作成
- 適切なコミットメッセージを作成（日本語、簡潔に、作成者とか不要な情報はいれない）
- コミットメッセージフォーマット：`<type>: <description>`
- type例：feat, fix, refactor, docs, test, style, chore

```bash
git add .
git commit -m "feat: 新機能の概要"
```

**完了チェックリスト:**
- [ ] git statusで意図しないファイルが含まれていない
- [ ] コミットメッセージが適切
- [ ] 変更内容が論理的にまとまっている

---

### Phase 8: Push 【必須】

**使用ツール**: Bash tool

#### 1. リモートへプッシュ
```bash
git push origin <branch-name>
```

#### 2. 必要に応じてPR作成
```bash
gh pr create --title "PR title" --body "PR description"
```

**完了チェックリスト:**
- [ ] プッシュが成功
- [ ] 必要に応じてPR作成

---

## トラブルシューティング

### Phase 6でビルドエラーが発生
1. エラーメッセージを詳細に確認
2. `mcp__ide__getDiagnostics` で型エラーの詳細を取得
3. 必要に応じて Phase 4 に戻って修正
4. Phase 6 を再実行

### テストが失敗する
1. テストエラーメッセージを確認
2. 期待値と実際の値を比較
3. Phase 4 に戻って修正
4. Phase 6 を再実行

---

## 補足資料

- **[MCP_REFERENCE.md](./MCP_REFERENCE.md)**: Kiri MCP、Serena MCPの詳細なコマンドリファレンス

## MCP使い分けまとめ

| フェーズ | 使用MCP | 主な用途 |
|---------|---------|---------|
| **Phase 1: 調査** | Kiri MCP | コードベース検索、コンテキスト抽出、依存関係分析 |
| **Phase 4: 実装** | Serena MCP | シンボルベース編集、リネーム、挿入・置換 |
| **全フェーズ** | Context7 MCP | ライブラリドキュメント取得 |

**Kiri vs Serenaの使い分け**:
- **調査（読み取り）**: Kiri → セマンティック検索、自動ランク付け、依存関係分析
- **実装（書き込み）**: Serena → シンボル編集、リネーム、挿入・置換
