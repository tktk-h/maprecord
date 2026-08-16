# 色のメリハリ（深いアクセントを数カ所に差す）— 設計

作成日: 2026-08-16 / 対象: デート記録アプリ / 種別: デザイン刷新④

## 背景・狙い

全体が「クリーム地 × 淡いテラコッタ」で温かく統一されているが、主役級の要素
（保存ボタン・選択中の状態・詳細ページ）まで同じ淡さで、視線が止まる**アンカーが無い**。
④の狙いは **全体を派手にせず、選んだ数カ所にだけ深い色を差して視線の芯を作る**こと。
地の淡さ・既存の淡いアクセントは「資産」として残す。

方針は案B（採用）＝**テラコッタ家族を深めたヒーロー用トーンを新設し、3カ所にだけ当てる**。
新しい色相（プラム/インク等）は足さない。世界観「温かみ・エモい思い出」を保つ。

## 新デザイントークン（`style.css` の `:root`）

```css
--accent-deep: #8f463d;                                   /* 選択状態の塗り・詳細の細ライン */
--cta-grad: linear-gradient(135deg, #a85a4f, #7e3b33);    /* 主役ボタン用グラデ */
--cta-shadow: 0 4px 14px rgba(126,59,51,.30);             /* CTA の淡い影 */
```

既存の `--accent #b76e64` / `--accent-strong #9c554c` / `--accent-soft #f1e6e3` は据え置き。

## 当てる3カ所（それ以外は触らない）

### 1. 主役 CTA（各画面に1つだけ現れる主ボタン）

フラットな `background: var(--accent)` → `--cta-grad` ＋ `--cta-shadow` に。
hover は現状の `--accent-strong` を維持（グラデ上に単色hoverでも可）。

対象セレクタ:
- `.form-actions button[type=submit]`（追加/編集の保存, style.css:259）
- `#quick-log .form-actions button#ql-save`（style.css:234）と `#quick-log #ql-save`（style.css:501）
- `.gate-btn.primary`（ゲートのスペース作成/参加, style.css:652）
- `.dt-primary`（詳細ページの主アクション, style.css:455）

副操作（`button[type=button]` 等）は淡いまま維持。CTA は「1画面に1つ」なので塗り過ぎにならない。

### 2. 選択中の状態

「今どれを選んでいるか」を淡いピンク地から**はっきり**させる。ただし複数同時選択が
起きうる箇所はフラッド（色の氾濫）を避けて控えめに深める。

- **単一選択のジャンルチップ**（追加/編集/クイックのフォーム）`.gp-chip.active`（style.css:483）
  → 淡い 15% ミックスから、そのジャンル色の**実色塗り＋白文字**へ。
  `background: var(--gc); border-color: var(--gc); color: #fff;`（ドットは既存 opacity:1）。
  常に1つだけ active なので強い芯になる。
- **複数選択のジャンル絞り込み**`.gf:has(input:checked)`（style.css:390）
  → 実色塗りにはせず**軽く深める**（`color-mix` を 15%→22%、border 34%→48%）。最大6個
  選択されても色が氾濫しないように。
- **アクセント系の現在/アクティブ**（フラット `--accent` 塗り）→ `--accent-deep` に置換:
  - `.visit-chip.current`（style.css:333）
  - `.dt-visits .visit-chip.current`（style.css:447）
  - `.fix-loc-btn.active`（style.css:306）
  - `#route-edit-btn.editing`（style.css:535）

### 3. 詳細ページ（思い出ページ）

写真が無くても芯が出るように、要所だけ深める。

- `.dt-date`（日付ラベル, style.css:437）: `color: var(--accent)` → `var(--accent-strong)`。
- `.visits` ボックス（この場所に何回来たか, style.css:326）: `border-left: 3px solid var(--accent-deep)`
  を追加（角丸は左辺のみになるので既存の radius は維持で可、視覚確認）。
- `.dt-primary`（前述, CTA としてグラデ）。
- **写真なしヒーローのジャンル色グラデ**（`js/records.js` 内でインライン設定）を一段深める。
  ジャンル色 → `color-mix(..., #000 12%)` 程度に沈めた 2 点グラデにする。※ここだけ JS の
  インラインスタイル変更（CSS 不可）。実装時に該当箇所を特定して最小変更。

## やらないこと（スコープ外）

- 背景 `--bg` / 面 `--surface` の色、絞り込みパネル全体のトーン。
- 思い出カード（1年前の今日）— これは別タスク。
- 地図スタイル（Google Cloud Console 側・保留）。
- タグチップ hover 等、既に十分な箇所。

## 検証

- 変更はほぼ CSS。純粋関数（`_selfTest`）に影響なし＝ロジック回帰は起きない。
- `color-mix()` / グラデは対応環境で確認済み（本人の iPhone）。非対応時もフラット色に
  自然フォールバック。
- 実挙動（ライブ Maps＋ログイン＋位置情報）はエージェントから確認不可 → **デプロイ後に
  本人がスマホ（本番 URL）で確認**。
- デプロイ手順: `index.html` の全 `?v=` と `.app-ver` を `20260812q` → 次番号（例 `20260816a`）に
  一括更新してから push。

## リスク／注意

- 単一選択ジャンルチップの「実色塗り＋白文字」は、明るめのジャンル色（`cafe #a07850`,
  `other #928b80`）でも白文字が読めるか実機確認。読みにくければ `color-mix(var(--gc), #000 12%)`
  で一段沈める。
- `.visits` の `border-left` と `border-radius` の相性（片側ボーダー＋角丸）を実機確認。
  不自然なら左辺だけ角丸を落とす。
- グラデ／影はストリーミング的な再描画とは無関係（本番は静的 CSS）だが、hover 遷移が
  グラデ→単色で不自然にならないよう確認。
