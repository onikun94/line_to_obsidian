## 1. 現状（As-Is）

ユーザーのネタ管理プロセスは、以下4段階に整理できる。

1. 情報収集  
   - スマホ閲覧中に「面白そう」と思ったURLをLINEへ手動投稿  
   - URLにメモ文が混在する場合あり

1. 永続化（自動）  
   - LINE → Cloudflare → Obsidianへ自動連携  
   - Obsidian内ではDaily形式にまとめられる  
   - URLはリンク列挙に留まり、構造情報を持たない

1. 選別（手動）  
   - 各URLを実際に開き、読む/捨てるを判断  
   - 判断には全文読解が必要 → 時間コスト大  
   - 内容の薄い記事を読んで帰着するストレスが発生

1. 記事化（ノート化・手動）  
   - 読む価値があると判断した記事のみ LiteratureNote等に転記  
   - タイトル・説明・タグをすべて手入力

現状の問題：
- Obsidianへの情報流入が増え続ける
- 判断材料が無いままリンクが溜まる
- 結果として価値ある情報が埋もれる

---

## 2. 前提（Constraints & Non-Functional Conditions）

- LINEは唯一の情報流入チャネル
- Cloudflare Workerが処理の中枢
- Obsidianへの同期フローは既存を変更しない
- 最終判断は人間
- 状態管理（未評価/執筆中など）は導入しない
- 外部バッチ不要
- Workers上でBrowser Renderingを利用してMarkdownを取得可能とする
- 暗号化機能は不要（個人利用のため）

---

## 3. To-Be（理想像）

URL送信＝  
自動で記事本文（Markdown）がObsidianに保存される

人間が行うこと:
- LINEにURLを送る
- Obsidian上で内容を見て「読む / 捨てる」

システムが行うこと:
- URL抽出
- Browser RenderingによるHTML→Markdown化
- 作成日時付与
- **LiteratureNoteへ本文を格納**

成果:
- 判断時間を短縮
- 情報資産の循環が始まる
- 「しょうもない記事」を読む必要がなくなる

---

## 4. 情報構造（MECE）

| レイヤ         | 保存先                         | 情報内容                   | 作成者  | 説明      |
| ----------- | --------------------------- | ---------------------- | ---- | ------- |
| A. 収集（生情報）  | Obsidian Daily              | URL列挙・短文メモ             | 人間   | 原石の集合   |
| B. 本文格納     | **Obsidian LiteratureNote** | Markdown本文 / URL / 取得日 | システム | 判断可能な素材 |
| C. 確定（咀嚼情報） | Obsidian LiteratureNote     | 自分の理解/記録               | 人間   | 知識として確定 |

Dailyが「情報の玄関・蓄積庫」の役割を継続。  
本文はLiteratureNoteに集約。

---

## 5. 自動生成ノート仕様（改訂）

保存先：
- Obsidianの既存設定に従う（ディレクトリ固定はしない）

対象条件：
- **LINEのメッセージがURL単体の場合のみ**
- URLとテキストが混在する場合は従来どおりDailyへのリンク列挙のみ（本文抽出しない）

仕様：
- Cloudflare WorkerにてURLを検知
- `fetch()`でHTMLを取得し、OGP/タイトル/著者等を抽出
- Browser Rendering（/markdown）で本文をMarkdown化
- **新規のLiteratureNoteファイルを作成**し、本文を格納

フォーマット例：

```md
---
title: "<OGPまたは<title>。無ければ空文字>"
source: "<URL>"
author:
  - "<取得できる場合のみ>"
created: 2025-11-28
description: "<OGP descriptionがあれば>"
tags:
image: "<OGP imageがあれば>"
---

<Markdown本文>
```

ファイル名：
- タイトル取得可能: スラッグ化したタイトル `.md`
- タイトル取得不可: `NoTitle_YYYYMMDDHHMMSS.md`
- 同名が存在する場合はタイムスタンプ付与で避重複

異常時：
- fetch失敗時はDailyへのURL列挙のみ実施（従来維持）

---

## 6. システム構成概要（責務境界）

| 役割 | コンポーネント |
|------|---------------|
| トリガー | LINE Messaging API Webhook |
| URL抽出・分類 | Cloudflare Worker |
| HTML→Markdown抽出 | Browser Rendering /markdown |
| 保存 | Cloudflare連携によるObsidian自動生成 |
| 人間判断 | Obsidian |

---

## 7. 成果物（期待効果）

| Before | After |
|--------|-------|
| URLリストのみ | 本文も残る（Obsidian内完結） |
| 記事化のためにブラウザ必須 | Obsidian内で即読める |
| 情報が堆積 | 情報資産として循環 |
| 選別が苦痛 | 判断が容易になりストレス減 |

---

## 8. 非対象（やらないこと）

- AIによる要約
- AIによるタグ生成
- 優先度判定
- 既存リンクの再処理
- カンバン化等の状態管理
- エンドツーエンド暗号化（個人利用のため不要）

---

## 9. 成功基準（KPI）

- 記事を開き直す手間の軽減
- Obsidian内中心の読書フロー定着
- 情報インボックスの詰まり解消