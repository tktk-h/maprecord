# 設計：絞り込みパネルの再デザイン

作成日: 2026-08-12
対象アプリ: デート記録（maprecord）
世界観の方針: 温かみ・エモい思い出（テラコッタ系を深める）

## 目的

絞り込みパネルが「安っぽい」印象（ネイティブ `<select>`／`<input type=date>`、チェックボックス＋●、灰色の均一ピルの混在）。見た目を作り込み、触って気持ちいい・考え抜かれた質感にする。**フィルタの機能・状態管理は一切変えず、見た目（マークアップ＋CSS）だけを差し替える**のが大原則。

## 大原則（後方互換）

既存のフィルタ状態ロジックはそのまま使う。特に以下は**入出力を変えない**:
- `readFilterState()` … `#mode-select` の `.value` と `#genre-filters input:checked` を読む。
- `isFiltering()` … `#mode-select` の値とジャンルcheckboxのチェック数を見る。
- `applyUiFilter()` … mode に応じて `#day-input` / `#range-inputs` の表示を切替。
- `focusDay(dateStr)` … `#mode-select.value = 'day'`、`#day-input.value` を設定して `applyUiFilter()`。
- `resetFilters()` … `#mode-select.value='all'`、ジャンルcheckboxを全 `checked=true`。

→ したがって **`#mode-select`（select）とジャンルの `<input type="checkbox">` は DOM 上に残す**。見た目上は隠し、新しいUI（セグメント／チップ）がそれらを操作・反映する「ビュー」になる。

## コンポーネント設計

### 1. パネル全体
- 温かい面色・柔らかく大きめの影・角丸、余白リズムの整理。
- 先頭に小さなタイトル行（アイコン＋「絞り込み」）。
- `#filter-bar` を縦積み（`flex-direction: column; align-items: stretch`）にして、各ブロックが素直に縦に並ぶようにする。

### 2. モード切替（全部／特定の日／期間）＝セグメント式ピル
- `#mode-select`（native select）は残すが `display: none` で隠す（状態の真実はここ）。
- 新規に**セグメントUI**（3ボタンのピルグループ、`#view-toggle` と同じ手触り）を追加。
  - マークアップは `#mode-segment` として `#filter-bar` 内、隠した select の隣に置く。
  - ボタン押下 → 対応する値を `#mode-select.value` にセットして `change` を dispatch（→ 既存の `applyUiFilter` が走る）。
  - 表示（active 表示）は `#mode-select` の現在値から反映する `syncModeSegment()` を用意し、`applyUiFilter()` の中で毎回呼ぶ（`focusDay`/`resetFilters` 経由でも確実に同期する）。
- 実装は `js/records.js` に `buildModeSegment()` と `syncModeSegment()` を追加、`init()` で `buildModeSegment()` を呼ぶ。

### 3. ジャンル＝色付きトグルチップ
- `buildGenreFilters()` のマークアップを差し替え。native checkbox は**残すが視覚的に隠す**（`appearance:none; position:absolute; opacity:0; width:0`）。ラベル全体がチップ。
- 新マークアップ（例）:
  ```html
  <label class="gf" style="--gc:#c2703f">
    <input type="checkbox" value="food" checked>
    <span class="gf-dot"></span>ごはん
  </label>
  ```
  （`●` テキストは廃止。ジャンル色は `--gc` カスタムプロパティで渡す。）
- CSS:
  - 既定（未選択）: 面色 `--surface`、細い境界、ミュートな文字、`.gf-dot` は `--gc` を薄く（opacity .4）。
  - 選択時（`.gf:has(input:checked)`）: 背景 `color-mix(in srgb, var(--gc) 15%, transparent)`、境界 `color-mix(in srgb, var(--gc) 32%, transparent)`、文字 `color-mix(in srgb, var(--gc), #000 32%)`、`.gf-dot` は不透明な `--gc`。
  - フォーカス可視化・タップ時の軽い縮み等の手触りを付ける。
- `:has()` / `color-mix()` は近年の iOS Safari / Chrome で利用可（対象は本人たちの最近のスマホ）。未対応環境でも「ドットの色でジャンルは分かる」状態にフォールバックする（チップは成立する）。
- 状態の読み取りは従来どおり `#genre-filters input:checked`。ロジック変更なし。

### 4. 日付入力
- `#day-input` と範囲の2つの `input[type=date]` を、温かい枠（境界・角丸12・淡い背景 `#faf8f4` 相当のトークン・内側余白）で整える。ネイティブのカレンダーUIはそのまま活かし、深追いしない。
- 範囲の「〜」区切りの体裁を整える。

### 5. 設定系の分離（書き出し・招待コード・記念日・ログアウト）
- これらは絞り込みではないので、`#backup-bar` の上に**区切り線＋「設定」ラベル**を置いて視覚的に分離。
- ボタン（`#export-btn` / `#show-invite-btn` / `#anniv-btn` / `#logout-btn`）は**ID・ハンドラ据え置き**のまま、灰色ピルから「アイコン＋ラベルの静かな行」スタイルへ。
- 記念日はアクセント色のハート、ログアウトはミュートしたダンジャー色で軽く区別。
- マークアップは `#backup-bar` を小見出し付きのセクションで包む程度（構造は最小変更、機能は不変）。

## ファイル変更

- `index.html`
  - `#filter-panel` 内: タイトル行を追加、`#mode-segment` のマークアップ追加、`#mode-select` は残す（CSSで隠す）、`#backup-bar` を「設定」セクションで包む（区切り＋ラベル）。
  - アセットの `?v=` を更新（キャッシュ対策 [[maprecord-cache-busting]]）。
- `js/records.js`
  - `buildGenreFilters()` のマークアップ変更（`--gc` ＋ `.gf-dot`、`●` 廃止）。
  - `buildModeSegment()` / `syncModeSegment()` 追加。`init()` で `buildModeSegment()` を呼ぶ。`applyUiFilter()` の末尾で `syncModeSegment()` を呼ぶ。
  - 既存の `readFilterState` / `isFiltering` / `focusDay` / `resetFilters` の**ロジックは変更しない**。
- `style.css`
  - 絞り込みパネル、セグメント、ジャンルチップ（`color-mix` 有無両対応）、日付入力、設定セクションのスタイルを全面的に整える。既存の `.gf` / `#filter-clear` / `#backup-bar` 関連ルールを新デザインに置換。

## テスト方針

- 純粋ロジックは変更しないため、**回帰していないこと**を手動で確認するのが主。
  - セグメントで 全部/特定の日/期間 を切替 → 日付入力の出し分け・絞り込み結果が従来どおり。
  - ジャンルチップのトグルで地図のピンが増減する（`readFilterState` の結果が正しい）。
  - カレンダーで日付タップ → `focusDay` 経由でセグメントが「特定の日」に光る。
  - 「リセット」で全部＋全ジャンルに戻り、セグメント・チップの表示も戻る。
  - 「絞り込み中だけ出る×」（`#filter-clear-top`）が従来どおり出る/消える。
  - 設定の各ボタン（書き出し／招待コード／記念日／ログアウト）が従来どおり動く。
- 見た目は実機（スマホ）で確認。iOS Safari で `:has()`/`color-mix()` のチップ表示が出ること、非対応時もドット色でジャンルが判別できること。

## 非目標

- フィルタの機能追加・状態管理の変更はしない（見た目のみ）。
- 他画面（詳細・カレンダー・地図ピン等）のデザインは今回対象外（この画面で世界観を確立し、後続で展開）。
