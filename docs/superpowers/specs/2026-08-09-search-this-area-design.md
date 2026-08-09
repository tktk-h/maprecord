# 「このエリアを再検索」ボタン 設計

日付: 2026-08-09
状態: 設計合意済み（実装計画待ち）
前提: `2026-08-09-place-search-map-pins-design.md`（Enter で場所検索→ピン）実装済み。

## 目的

Google マップのように、場所検索の結果ピンが出ている状態で地図をドラッグして別のエリアへ動かすと、
上部中央に「このエリアを再検索」ボタンを出し、タップで**直前の検索語を現在の表示範囲で再検索**する。

## ユーザー体験

- Enter で場所検索 → ピン表示（既存）。
- その状態で**地図をドラッグして動かす**と、上部中央に「このエリアを再検索」ピルが出る。
- タップ → 直前の検索語を現在の表示範囲（`getBounds()`）で再検索 → ピン更新＋`fitTo`、ボタンは消える。
- 次のドラッグでまた出る。検索語を消す／記録候補を選ぶ／新しい Enter 検索をすると、ボタンは消える。
- 場所検索が有効なときだけ出す（記録閲覧中・ドロップダウンの単一場所選択後は出さない）。

## スコープ外

- ズーム変更のみでの表示（今回はドラッグ移動で表示）。将来必要なら `zoom_changed` を足す。
- 記録検索の再検索ボタン。

## モジュール構成（既存への小追加）

- **`js/map.js`**：`setUserPanHandler(cb)` を追加し、`map.addListener('dragend', cb)` を配線
  （`dragend` はユーザー操作でのみ発火し、`flyTo`/`fitTo`/`panTo` では発火しない＝誤表示なし）。export に追加。
- **`js/search.js`**：
  - 状態 `let lastPlaceQuery = null;`。
  - `runPlaceSearch(q)`：開始時にボタンを隠す。結果ありなら `lastPlaceQuery = q` を保持。
    0件（記録名検索フォールバック）なら `lastPlaceQuery = null`。
  - `showResearch()`/`hideResearch()`：`#research-btn` の表示切替。
  - `init()`：`App.map.setUserPanHandler(() => { if (lastPlaceQuery) showResearch(); })` を配線。
    `#research-btn` に click → `hideResearch(); runPlaceSearch(lastPlaceQuery);`。
  - ボタンを隠して状態をクリアする箇所：`onInput` の empty 分岐、`onKeydown` の empty 分岐、
    `activateRow` の rec 分岐（記録選択時）。いずれも `lastPlaceQuery = null; hideResearch();`。
- **`index.html`**：`#map` の近く（`#locate-btn` の並び）に
  `<button id="research-btn" hidden><i class="ph ph-arrows-clockwise"></i>このエリアを再検索</button>`。
- **`style.css`**：`#research-btn`（上部中央のフローティングピル。トップバーと重ならない位置、地図より前面）。

## データフロー

1. `runPlaceSearch(q)` 成功 → `lastPlaceQuery = q`、ピン描画（既存）。
2. ユーザーが地図をドラッグ → `dragend` → `setUserPanHandler` の cb → `lastPlaceQuery` があれば `showResearch()`。
3. ボタンタップ → `hideResearch()` → `runPlaceSearch(lastPlaceQuery)`（新 `getBounds()` で再検索）。
4. `runPlaceSearch` 開始時に `hideResearch()`（再検索の間は隠す）。

## エラー／エッジ

- `runPlaceSearch` の 0件時は `lastPlaceQuery = null` にし、以後パンしてもボタンを出さない。
- ボタン表示中に検索語を消す／記録を選ぶ → `lastPlaceQuery = null; hideResearch()`。
- `#research-btn` が無い環境（テスト等）でも落ちないようガードする。

## テスト

ハーネス（モック）で:
- `App.map.setUserPanHandler` に渡した cb を捕捉。`runPlaceSearch` 成功後に cb 実行 → `#research-btn` が表示。
- ボタン click → `App.places.searchText` が現在の bias で再度呼ばれる。
- `runPlaceSearch` が0件 → cb 実行してもボタンは出ない（`lastPlaceQuery` null）。
- `activateRow` rec／empty 入力 → ボタン非表示。
- 実 `dragend` の発火自体は実機で確認。

## 触るファイル

`js/map.js`, `js/search.js`, `index.html`, `style.css`
