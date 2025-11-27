## 1. 現状（As-Is）
ユーザーのネタ管理プロセスは、以下4段階に整理できる。

1. 情報収集  
   - スマホ閲覧中に「面白そう」と思ったURLをLINEへ手動投稿  
   - URLにメモ文が混在する場合あり

2. 永続化（自動）  
   - LINE → Cloudflare → Obsidianへ自動連携  
   - Obsidian内ではDaily形式にまとめられる  
   - URLは**リンク列挙に留まり、構造情報を持たない**

3. 選別（手動）  
   - 各URLを実際に開き、読む/捨てるを判断  
   - 判断には全文読解が必要 → 時間コスト大  
   - 内容の薄い記事を読んで帰着するストレスが発生

4. 記事化（ノート化・手動）  
   - 読む価値があると判断した記事のみ  
     LiteratureNote等に転記  
   - タイトル・説明・タグなど全て手入力

現状の問題：
- Obsidianへの**情報流入が増え続ける**
- **判断材料が無い**ままリンクが溜まる  
- 結果として **価値ある情報が埋もれる**

---

## 2. 前提（Constraints & Non-Functional Conditions）

- LINE は **唯一の情報流入チャネル**
- Cloudflare Worker が **処理の中枢**
- Obsidian への同期フローは **既存を変更しない**
- **最終判断は人間**
- **状態管理（未評価/執筆中など）は導入しない**
- GitHub Actionsなどの外部バッチ不要
- Workers上で Browser Rendering を利用して Markdown を取得可能とする  
  （新規に追加される前提）

---

## 3. To-Be（理想像：あるべき姿）

URL送信＝  
**自動で記事本文（Markdown）もObsidian上に保存される**

人間が行うこと:
- LINEにURLを送る
- Obsidian上で内容を見て「読む / 捨てる」

システムが行うこと:
- URL抽出
- **Browser Rendering による HTML→Markdown 化**
- 作成日時付与
- Dailyノートへ本文を格納

成果:
- 人間の判断時間を短縮
- 情報資産の循環が始まる  
- 「しょうもない記事」を読む必要がなくなる

---

## 4. 情報構造（MECE）

| レイヤ | 保存先 | 情報内容 | 作成者 | 説明 |
|-------|-------|---------|-------|-----|
| A. 収集（生情報） | Obsidian Daily | URL列挙・短文メモ | 人間 | 原石の集合 |
| B. 本文格納 | Obsidian Daily（既存構成を拡張） | Markdown本文 / URL / 取得日 | システム | 判断可能な素材 |
| C. 確定（咀嚼情報） | Obsidian LiteratureNote | 自分の理解/記録 | 人間 | 知識として確定 |

Dailyが「情報の玄関・蓄積庫」の役割を維持したまま、  
**中身を持てる**状態になる。

---

## 5. 自動生成ノート仕様
（Daily拡張仕様）

保存先：
- 既存Dailyファイルに**本文ブロックを追記**

フォーマット（例）：
```md
---
source: LINE
date: 2025-11-24T15:26:21.625Z
messageId: 589014965064040621
---

## Clipped Content
source: https://example.com/xxx
clipped_at: 2025-11-24T15:26:21.625Z

# 以下、Browser Rendering /markdownで取得した本文
<取得Markdownをそのまま挿入>
```

※タイトル推定・タグ付与などは行わない（既存運用踏襲）

---

## 6. システム構成概要（責務境界）

| 役割              | コンポーネント                    |
| --------------- | -------------------------- |
| トリガー            | LINE Messaging API Webhook |
| URL抽出            | Cloudflare Worker          |
| **HTML→Markdown抽出** | **Browser Rendering /markdown** |
| 保存              | line_to_obsidian ＋ Obsidian |
| 人間判断          | Obsidian |

※外部バッチ不要、Workers内で完結

---

## 7. 成果物（期待効果）

| Before | After |
|--------|-------|
| URLリストのみ | 本文も残る（Obsidian内完結） |
| 記事化のために毎回ブラウザで表示 | Obsidian内で読める |
| 情報が増えるだけ | 自動整備された資産へ更新 |
| タブ墓場 | リンクが「読み物」に戻る |

---

## 8. 非対象（やらないこと）
- AIによる要約生成
- AIによるタグ生成
- 優先度判定
- 大量既存リンクの再処理
- カンバン化等の状態管理

---

## 9. 成功基準（KPI）
- 記事を開き直す手間の軽減
- Obsidian内中心の読書フロー定着
- 情報インボックスの詰まり解消
