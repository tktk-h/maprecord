# 場所検索（Google マップ風ライブ候補） 設計

日付: 2026-08-08
状態: 設計合意済み（実装計画待ち）

## 目的

検索ボックスに文字を入力すると、Google マップのように**入力中に候補（オートコンプリート）**が
バーの真下へ出る。候補には**自分の記録（名前一致）**と**Google の場所候補**を混ぜて表示し、
場所候補は**現在の地図の表示範囲で近い順**にする。候補を選ぶと、記録は詳細、場所は場所カードへ。

既存の「記録の名前検索（Enter）」「#タグ検索（Enter）」は残す。

## スコープ外（今回やらない）

- Enter で地図上に大量の検索結果を出す全文検索（Text Search）。将来の拡張候補として記載のみ。
- 矢印キーでの候補移動（キーボードナビ）。MVP では Enter で先頭のみ。

## ユーザー体験

- バーの真下にピタッと付くカードが、入力に応じて**スッと下に開く**（フェード＋わずかな下スライド、約150ms）。
- **見出しラベルなしのフラット一覧**。**自分の記録が上**（丸いサムネ or ジャンル色の丸＋小さな★「記録済み」）、
  **Google の場所が下**（グレー丸＋ピンのアイコン＋住所）。
- 各行 = 丸アイコン ＋ 主テキスト（太字・1行省略）＋ サブテキスト（薄い）。
  - 記録のサブ: 「ジャンル ・ N回訪問」または「ジャンル ・ 日付」
  - 場所のサブ: 住所（secondaryText）
- **件数は固定しない**。Google が返す件数をそのまま表示（固有名詞＝1件、チェーン＝近くの複数。
  ライブ候補なので通常は最大5件程度＝Google マップのドロップダウンと同じ）。記録側もスクロールで一致分を表示。
- 選択: 記録 → `flyTo` ＋ 詳細（`showDetail`）／場所 → 場所カード（`showPlaceCard(placeId,{fly:true})`）。

## モジュール構成

- **新規 `js/search.js`（`App.search`）** — 検索ボックスの `input`/`keydown`/`focus`/`blur` 処理、
  候補ドロップダウンの生成・描画・選択、デバウンス、セッショントークン、レース対策を担当。
  検索まわりの配線は `app.js` の `wireUI` から本モジュールへ移す（records.js/app.js の肥大化を回避）。
- **`js/places.js` に追加**
  - `async searchPlaces(query, { bias, token })` → 正規化 `[{ placeId, mainText, secondaryText }]` を返す。
    新 API `AutocompleteSuggestion.fetchAutocompleteSuggestions` を使用。返ってきた件数はそのまま（人為的に切らない）。
  - `newSessionToken()` → `new AutocompleteSessionToken()`。
- **`js/records.js` に追加**
  - `suggestRecords(q, limit)` を export — 既存の `countsByCoord`/`coordKey`/`firstPhotoAt` を再利用し、
    名前一致を座標でまとめた `[{ rep, count, photo }]` を返す（`limit` は安全上限。既定 8）。
  - `showPlaceCard(placeId, { fly } = {})` に地図移動オプションを追加（検索から選んだ時に `fly:true`）。
- **`js/map.js` に追加**
  - `getBounds()` — `map.getBounds()`（`LatLngBounds` または未取得時 `null`）。
- **`index.html`** — `#search-wrap` を `position:relative` にし、その中に `#search-suggest`（既定 hidden）を追加。
  `<script src="js/search.js">` を追加（他の `App.*` と同様、`app.js` の前）。
- **`js/app.js`** — `wireUI` から検索ボックスの `keydown`/`input` 配線を削除し、`startApp` で `App.search.init()` を呼ぶ
  （`App.records.init()` / `App.sheet.init()` の後）。
- **`style.css`** — `#search-suggest` と行のスタイル、開くアニメーション。

## データフロー

1. `input`（250ms デバウンス）
   - 空 → ドロップダウンを閉じ、`App.records.clearSearch()`。
   - `#…` で始まる → タグ用なので候補は出さない（従来通り Enter で `searchTag`）。
   - 通常語 → `seq` を採番。**記録候補（ローカル・即時）** を描画してドロップダウンを開き、
     **場所候補（非同期）** を投げる。解決時、その応答の `seq` が最新なら場所行を追記（古い応答は破棄）。
2. `keydown` Enter
   - `#タグ` → `App.records.searchTag`。
   - それ以外 → ドロップダウンに先頭候補があればそれを実行。無ければ従来の `App.records.searchByName(q)`（下シートに全件リスト）にフォールバックし、ドロップダウンを閉じる。
3. 行タップ
   - 記録 → 閉じる → `App.map.flyTo(rep.lat, rep.lng)` → `App.records.showDetail(rep)`。
   - 場所 → 閉じる → `App.records.showPlaceCard(placeId, { fly:true })` → セッショントークンを破棄（次回は新セッション）。
4. 外側タップ / Escape / blur（クリック確定のため少し遅延）で閉じる。

## Places API の扱い

- `const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places')`。
- `fetchAutocompleteSuggestions({ input, sessionToken, locationBias, language:'ja', region:'JP' })`。
  - `locationBias` = `App.map.getBounds()`（現在の表示範囲）。`null` の時は省略。→ 近い順・近所優先。
- 応答 `suggestions[].placePrediction` から `placeId`、`mainText.text`、`secondaryText.text` を取り出して正規化。
- **課金最適化**: 1 検索セッション（入力〜選択）で同じ `AutocompleteSessionToken` を使い回し、
  場所を選んだ時点で破棄。次の検索で新規発行。
- 場所 API 呼び出しは **2 文字以上**から（記録候補は 1 文字から）。
- 既存キーで動作（`showPlaceCard`/`fetchPlace` が同じ Places(New) ライブラリで稼働中）。

## エラー処理・エッジ

- Places 失敗／キー無効 → 記録候補のみ表示し、控えめに「場所候補を取得できませんでした」を出す。本体は壊さない。
- 記録・場所とも 0 件 → 「該当なし」を薄く表示。
- デバウンス＋`seq` で連打・競合（古い応答が新しい表示を上書き）を防ぐ。
- `esc()` で記録名・住所などのユーザー/外部文字列をエスケープ。

## テスト

ハーネスで `App.places.searchPlaces` と `App.records`/`App.map` をモックし、以下を検証:

- `suggestRecords`: 名前一致・座標グルーピング・上限。
- デバウンス: 連打で API 呼び出しは 1 回。
- レース: 古い場所応答が新しい表示を上書きしない。
- 描画: 記録が上・場所が下のフラット一覧。件数が可変（固有名詞=1件、チェーン=複数）を反映。
- 選択: 記録 → `showDetail`、場所 → `showPlaceCard(placeId,{fly:true})` を呼ぶ。
- `#タグ` + Enter → `searchTag`。空 → 閉じる＋`clearSearch`。Enter → 先頭候補を実行。
- `locationBias` に地図範囲を渡している（`getBounds` の戻りが request に載る）。

実 Google Places 呼び出しは API キー＋認証が要るため、デプロイ後に実機で確認。

## 依存・リスク

- Places API (New) は稼働中（`showPlaceCard` 実績あり）。`AutocompleteSuggestion` は同ライブラリ。
- オートコンプリートは Google 側で概ね最大 5 件程度。5 件を超える「近くの多数」を出したい場合は
  将来 Enter → Text Search（`searchByText`＋`locationBias`）で地図に多数表示、を別途追加（今回スコープ外）。

## 触るファイル一覧

`js/search.js`(新), `js/places.js`, `js/records.js`, `js/map.js`, `js/app.js`, `index.html`, `style.css`
