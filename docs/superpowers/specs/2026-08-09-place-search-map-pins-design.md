# 検索結果のマップピン表示（Enter 検索） 設計

日付: 2026-08-09
状態: 設計合意済み（実装計画待ち）
前提: `docs/superpowers/specs/2026-08-08-place-search-design.md`（ライブ候補ドロップダウン）実装済み。

## 目的

場所検索の結果を「候補ドロップダウン（文字）」だけでなく **マップ上のピン** としても出し、
ピンからも場所を選べるようにする。Google マップと同じく、Enter で検索を実行すると結果ピンが並ぶ。

## ユーザー体験

- 入力中：従来通り候補ドロップダウン（記録＋場所）。
- **Enter（通常語）**：ドロップダウンを閉じ、Places テキスト検索を実行 → 座標付き結果（最大10件）を
  マップに **複数ピン** で表示し、全体が見えるよう `fitTo`。0件なら従来の記録名検索へフォールバック。
  - 従来の「Enter＝先頭候補を選ぶ」は廃止し、「Enter＝検索実行（ピン表示）」に変更。個別選択は
    ドロップダウンの行タップ、またはピンのタップで行う。
- **ピンをタップ** → 既存の場所カード（`showPlaceCard(placeId, { fly:true })`）。
- **ドロップダウンの場所を選択** → 従来通りカード＋`flyTo` に加え、その1地点にも場所ピンを1つ表示。
- `#タグ` + Enter は従来通りタグ検索。検索欄を空にすると候補もピンもクリア。

## スコープ外（今回やらない）

- 検索結果の一覧を下シートに出すこと（今回はマップピン＋タップでカードのみ）。
- 入力中（1文字ごと）に全候補をピン表示すること（コスト・複雑さのため）。

## モジュール構成（既存への小追加）

- **`js/places.js` に追加**
  - `async searchText(query, opts)` → 正規化 `[{ placeId, name, lat, lng, genre }]`（最大10件）。
    新 API `Place.searchByText({ textQuery, fields:['id','displayName','location','types'],
    locationBias, language:'ja', region:'JP', maxResultCount:10 })` を使用。座標は `location` から取得、
    `genre` は既存 `genreFromTypes(types)` で推定。`_normalizeTextResults(places)` を純粋関数として切り出しテスト。
- **`js/map.js` に追加**
  - 場所検索ピン専用レイヤー（記録ピン `markers` とは別配列 `searchMarkers`）:
    - `renderPlaceResults(places, onSelect)` — `places=[{placeId,name,lat,lng,genre}]`。各ピンを立て、
      タップで `onSelect(placeId)` を呼ぶ。記録ピンとは別スタイル（赤系の検索ピン）。
    - `clearPlaceResults()` — 場所検索ピンだけ消す（`clearPins()` では消えない／`clearPins` も searchMarkers を消さない）。
  - ピン要素は既存 `makeMarker`＋`el('<div class="search-pin">…</div>')` を利用。
- **`js/records.js` を微修正**
  - `showPlaceCard(placeId, opts)` に `opts.pin`（真なら取得座標に単一の場所ピンを表示）を追加。
    既存の POI タップ経路（`setPlaceClickHandler(showPlaceCard)`）は引数なしなので影響なし。
  - `clearSearch()` で `App.map.clearPlaceResults()` も呼ぶ。
- **`js/search.js` を修正**
  - `onKeydown` の Enter（text）を「先頭候補を選ぶ」から「テキスト検索→ピン表示」に変更:
    `App.map.clearPlaceResults()` → `App.places.searchText(q,{bias})` → 0件なら `App.records.searchByName(q)`、
    それ以外は `App.map.renderPlaceResults(results, (id)=>App.records.showPlaceCard(id,{fly:true}))` と
    `App.map.fitTo(results)`。ドロップダウンは閉じる。
  - ドロップダウンの場所選択（`activateRow` place）は `showPlaceCard(id,{fly:true,pin:true})` に変更（単一ピン付き）。
  - 検索欄が空（onInput empty）で `App.records.clearSearch()`（→ 場所ピンもクリア）。

## データフロー（Enter 検索）

1. Enter（text）→ `seq++`（保留中のオートコンプリートを無効化）、ドロップダウンを閉じる。
2. `bias = App.map.getBounds()`、`results = await App.places.searchText(q, { bias })`。
3. `App.map.clearPlaceResults()` → 0件: `App.records.searchByName(q)`（従来の記録リスト）。
   それ以外: `App.map.renderPlaceResults(results, onSelect)` ＋ `App.map.fitTo(results)`。
4. ピン `onSelect(placeId)` → `App.records.showPlaceCard(placeId, { fly:true })`。

## クリア／記録ピンとの共存

- 場所ピン（`searchMarkers`）は記録ピン（`markers`）と別レイヤー。`clearPins()`（再描画時）では消えない。
- 場所ピンをクリアするタイミング：検索欄を空にした時（`clearSearch`）、新しい Enter 検索の直前、
  記録候補をドロップダウンから選んだ時（`activateRow` rec の中で `clearPlaceResults()`）。

## エラー／エッジ

- `searchText` 失敗 → ピンは出さず、控えめに通知して記録名検索へフォールバック（`searchByName`）。
- 0件 → 記録名検索へフォールバック。
- `getBounds()` が null → `locationBias` 省略。
- 結果の `location` 欠落は除外（`_normalizeTextResults` で `lat/lng` 必須フィルタ）。

## テスト

- `App.places._normalizeTextResults(rawPlaces)`：座標付き→`{placeId,name,lat,lng,genre}`、location 欠落は除外、`_selfTest`。
- ハーネス（モック）で:
  - Enter → `searchText` が呼ばれ `opts.bias` に `getBounds()` が載る。
  - 結果あり → `renderPlaceResults(results, cb)` と `fitTo(results)` が呼ばれる。ピン `cb(placeId)` → `showPlaceCard(id,{fly:true})`。
  - 結果0件 → `searchByName(q)` フォールバック。
  - ドロップダウン場所選択 → `showPlaceCard(id,{fly:true,pin:true})`。
  - 空入力 → `clearSearch()`（→ `clearPlaceResults()`）。
- 実 `Place.searchByText` 通信はデプロイ後に実機確認。

## 触るファイル

`js/places.js`, `js/map.js`, `js/records.js`, `js/search.js`, `style.css`（`.search-pin` スタイル）
