# 検索結果のマップピン表示（Enter 検索） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter で Places テキスト検索を実行し、座標付き結果をマップに複数ピンで表示、ピンタップで場所カードを開けるようにする（ドロップダウンの場所選択では単一ピン）。

**Architecture:** 場所検索ピンを記録ピンとは別レイヤー（`searchMarkers`）で管理。`App.places.searchText`（`Place.searchByText`）で座標付き結果を取得し、`App.map.renderPlaceResults` で描画。`App.search` の Enter を「検索実行＝ピン表示」に変更。純粋な正規化関数を `_selfTest` で、配線をモックハーネスで検証。

**Tech Stack:** バニラ JS（`window.App.*` IIFE）、Google Maps JS API（`importLibrary('places')` の `Place.searchByText`）、`_selfTest()`＋モックハーネス、`node --check`。

参照 spec: `docs/superpowers/specs/2026-08-09-place-search-map-pins-design.md`

---

## テスト実行の前提（全タスク共通）

- 構文: `node --check js/<file>.js`（この環境の `python` は壊れているので node を使う）。
- 単体/統合: 一時ハーネス（Task 5、最後に削除）をローカル HTTP で開き、コンソールで `_selfTest`/`__run` を実行し `PASS` を確認。Google 依存関数はモックする。
- 実 `Place.searchByText` 通信は Task 6 のデプロイ後に実機確認。

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/places.js` | `searchText` ＋結果正規化 `_normalizeTextResults` を追加 | Modify |
| `js/map.js` | 場所検索ピン専用レイヤー `renderPlaceResults`/`clearPlaceResults` を追加 | Modify |
| `js/records.js` | `showPlaceCard` に `{pin}` 追加、`clearSearch` で場所ピンもクリア | Modify |
| `js/search.js` | Enter＝テキスト検索→ピン、行選択の挙動更新 | Modify |
| `style.css` | `.search-pin` スタイル | Modify |

---

## Task 1: places.js — テキスト検索と結果正規化

**Files:** Modify `js/places.js`

- [ ] **Step 1: 失敗するテスト（純粋関数）を追加**

`js/places.js` の IIFE 内（`return` の前）に追加:

```js
  // Place.searchByText の結果 → 正規化（google 非依存でテスト可能）
  function _normalizeTextResults(places) {
    return (places || []).map((p) => {
      const loc = p && p.location;
      const lat = loc ? (typeof loc.lat === 'function' ? loc.lat() : loc.lat) : null;
      const lng = loc ? (typeof loc.lng === 'function' ? loc.lng() : loc.lng) : null;
      const name = (p && (typeof p.displayName === 'string'
        ? p.displayName : (p.displayName && p.displayName.text))) || '';
      return { placeId: p && p.id, name, lat, lng, genre: genreFromTypes(p && p.types) };
    }).filter((x) => x.placeId && x.lat != null && x.lng != null);
  }

  function _selfTestText() {
    const raw = [
      { id: 'a', displayName: 'スカイツリー', location: { lat: 35.7, lng: 139.8 }, types: ['tourist_attraction'] },
      { id: 'b', displayName: { text: 'マック渋谷' }, location: { lat: () => 35.6, lng: () => 139.7 }, types: ['restaurant'] },
      { id: 'c', displayName: '座標なし', types: ['store'] },
    ];
    const out = _normalizeTextResults(raw);
    const eq = (n, g, w) => console.log((g === w ? 'PASS' : 'FAIL') + ' ' + n, g);
    eq('text-count', out.length, 2);
    eq('text-name-str', out[0].name, 'スカイツリー');
    eq('text-name-obj', out[1].name, 'マック渋谷');
    eq('text-latfn', out[1].lat, 35.6);
    eq('text-genre-sightsee', out[0].genre, 'sightsee');
    eq('text-genre-food', out[1].genre, 'food');
    eq('text-drop-noloc', out.every((x) => x.lat != null), true);
  }
```

- [ ] **Step 2: テストが失敗することを確認**

Task 5 のハーネスで `App.places._selfTestText()` を実行。未追加なら `TypeError`。

- [ ] **Step 3: `searchText` 実装を追加**

`_normalizeTextResults` の下に:

```js
  // query → 座標付き候補[]（最大10）。opts.bias=LatLngBounds|null
  async function searchText(query, opts) {
    opts = opts || {};
    const { Place } = await google.maps.importLibrary('places');
    const req = {
      textQuery: query,
      fields: ['id', 'displayName', 'location', 'types'],
      language: 'ja', region: 'JP', maxResultCount: 10,
    };
    if (opts.bias) req.locationBias = opts.bias;
    const { places } = await Place.searchByText(req);
    return _normalizeTextResults(places);
  }
```

export（現在 `return { fetchPlace, genreFromTypes, searchPlaces, newSessionToken, _normalizePredictions, _selfTest };`）を次に変更:

```js
  return { fetchPlace, genreFromTypes, searchPlaces, searchText, newSessionToken,
           _normalizePredictions, _normalizeTextResults, _selfTest, _selfTestText };
```

- [ ] **Step 4: テストが通ることを確認**

`node --check js/places.js` → exit 0。ハーネスで `App.places._selfTestText()` → 7 行 `PASS`。

- [ ] **Step 5: コミット**

```bash
git add js/places.js
git commit -m "feat(places): text search (searchByText) + result normalization"
```

---

## Task 2: map.js — 場所検索ピン専用レイヤー

**Files:** Modify `js/map.js`, `style.css`

- [ ] **Step 1: 実装を追加**

`js/map.js` の IIFE 内、`let markers = [];` の近くに状態を追加:

```js
  let searchMarkers = [];      // 場所検索の結果ピン（記録ピン markers とは別レイヤー）
```

`clearPins` 関数の下あたりに:

```js
  function clearPlaceResults() {
    searchMarkers.forEach((m) => { m.map = null; });
    searchMarkers = [];
  }

  // places=[{placeId,name,lat,lng,genre}] を検索ピンとして表示。タップで onSelect(placeId)
  function renderPlaceResults(places, onSelect) {
    clearPlaceResults();
    (places || []).forEach((p) => {
      const content = el('<div class="search-pin"></div>');
      if (p.name) content.title = p.name;
      const m = makeMarker(p.lat, p.lng, content, { zIndex: 1100, centered: true });
      m.addListener('click', () => { if (onSelect) onSelect(p.placeId); });
      searchMarkers.push(m);
    });
  }
```

export（現在 `return { init, ..., flyTo, fitTo, refresh, getBounds, showTempMarker, clearTempMarker, startPickLocation, getPickedLatLng, stopPickLocation, _getMap: () => map };`）に `renderPlaceResults, clearPlaceResults` を追加:

```js
  return { init, setClickHandler, setPlaceClickHandler, setLongPressHandler, clearPins, renderPins, flyTo, fitTo, refresh, getBounds,
           renderPlaceResults, clearPlaceResults,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
```

注意: `clearPins()` は `markers` のみを消す実装のまま（`searchMarkers` は触らない）。逆に `clearPlaceResults()` は `searchMarkers` のみ消す。確認すること。

- [ ] **Step 2: `.search-pin` スタイルを追加**

`style.css` の場所検索ドロップダウンのブロック（`/* ===== 場所検索の候補ドロップダウン ===== */`）の末尾付近に追加:

```css
/* 場所検索の結果ピン（Google 風の赤丸） */
.search-pin { width: 20px; height: 20px; border-radius: 50%;
  background: #ea4335; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(45,38,30,.5); }
```

- [ ] **Step 3: 構文確認**

`node --check js/map.js` → exit 0。

- [ ] **Step 4: コミット**

```bash
git add js/map.js style.css
git commit -m "feat(map): place-result pin layer (renderPlaceResults/clearPlaceResults)"
```

---

## Task 3: records.js — 場所カードに単一ピン、clearSearch で場所ピンもクリア

**Files:** Modify `js/records.js`

- [ ] **Step 1: `showPlaceCard` に `{pin}` を追加**

`showPlaceCard(placeId, opts)` 内、`if (opts && opts.fly) App.map.flyTo(p.lat, p.lng);` の直後に追加:

```js
    if (opts && opts.pin) App.map.renderPlaceResults(
      [{ placeId, name: p.name, lat: p.lat, lng: p.lng, genre: p.genre }],
      (id) => showPlaceCard(id, { fly: true }));
```

- [ ] **Step 2: `clearSearch` で場所ピンをクリア**

`function clearSearch()` の中（`searchResults = null;` などの並び）に追加:

```js
    if (App.map.clearPlaceResults) App.map.clearPlaceResults();
```

- [ ] **Step 3: 構文確認**

`node --check js/records.js` → exit 0。既存の POI タップ経路 `setPlaceClickHandler(showPlaceCard)` は引数なし呼び出しのため `opts` は `undefined` で影響なしであることを読んで確認。

- [ ] **Step 4: コミット**

```bash
git add js/records.js
git commit -m "feat(records): single pin on place card from search; clear place pins on clearSearch"
```

---

## Task 4: search.js — Enter＝テキスト検索→ピン、行選択の更新

**Files:** Modify `js/search.js`

- [ ] **Step 1: `runPlaceSearch` を追加**

`js/search.js` の `updateSuggestions` の下に追加:

```js
  // Enter：テキスト検索を実行し、結果をマップにピン表示（0件は記録名検索へ）
  async function runPlaceSearch(q) {
    App.map.clearPlaceResults();
    let results = [];
    try {
      results = await App.places.searchText(q, { bias: App.map.getBounds() });
    } catch (e) { results = []; }
    if (!results.length) {
      const n = App.records.searchByName(q);
      if (n === 0) alert('該当する場所・記録が見つかりませんでした');
      return;
    }
    App.map.renderPlaceResults(results, (id) => App.records.showPlaceCard(id, { fly: true }));
    App.map.fitTo(results);
  }
```

- [ ] **Step 2: `onKeydown` の Enter（text）を差し替え**

現在の `onKeydown` の、tag 分岐の後の部分:

```js
    if (c.kind === 'empty') { App.records.clearSearch(); close(); return; }
    const first = dropdown.querySelector('.ss-row');
    if (first && !dropdown.hidden) { activateRow(first); return; }
    const n = App.records.searchByName(c.q);
    if (n === 0) alert('その名前の記録は見つかりませんでした');
    close();
```

を次に置き換える:

```js
    if (c.kind === 'empty') { seq++; App.records.clearSearch(); close(); return; }
    seq++;              // 保留中のオートコンプリート応答を無効化
    close();
    runPlaceSearch(c.q);
```

- [ ] **Step 3: `activateRow` を更新**

現在の `activateRow` を次に置き換える:

```js
  function activateRow(btn) {
    const kind = btn.dataset.kind;
    close();
    if (kind === 'rec') {
      App.map.clearPlaceResults();           // 記録を選んだら場所ピンは消す
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
      App.records.showPlaceCard(btn.dataset.id, { fly: true, pin: true }); // 単一ピン付き
      sessionToken = null;
    }
  }
```

- [ ] **Step 4: export に `runPlaceSearch` を追加（テスト用）**

現在 `return { init, classifyQuery, debounce, render, updateSuggestions, _selfTest };` を:

```js
  return { init, classifyQuery, debounce, render, updateSuggestions, runPlaceSearch, _selfTest };
```

- [ ] **Step 5: 構文確認とコミット**

`node --check js/search.js` → exit 0。

```bash
git add js/search.js
git commit -m "feat(search): Enter runs text search -> map pins; row selection drops pins"
```

---

## Task 5: 統合ハーネスとテスト実行

**Files:** Create（一時・最後に削除）: `_pins-test.html`

- [ ] **Step 1: ハーネスを作成**

プロジェクト直下に `_pins-test.html`:

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head>
<body>
  <header id="topbar"><div id="search-wrap">
    <input id="search-box" type="search"><div id="search-suggest" hidden></div>
  </div></header>
  <script>window.App = window.App || {};</script>
  <script>App.genres = { color: () => '#999', label: () => 'カフェ' };</script>
  <script src="js/places.js"></script>
  <script src="js/search.js"></script>
  <script>
    const calls = { clearPlace: 0, renderPlace: [], fitTo: [], searchTextBias: [],
                    showPlaceCard: [], searchByName: [], showDetail: [], flyTo: 0 };
    App.map = {
      getBounds: () => ({ __bounds: true }),
      flyTo: () => { calls.flyTo++; },
      clearPlaceResults: () => { calls.clearPlace++; },
      renderPlaceResults: (places, cb) => { calls.renderPlace.push({ n: places.length, cb }); },
      fitTo: (arr) => { calls.fitTo.push(arr.length); },
    };
    let nameHits = 0;
    App.records = {
      getAll: () => [{ id: 1, name: 'X', lat: 1, lng: 1 }],
      suggestRecords: () => [],
      showDetail: (r) => calls.showDetail.push(r.id),
      showPlaceCard: (id, o) => calls.showPlaceCard.push([id, o]),
      clearSearch() {}, searchTag() { return 0; },
      searchByName: (q) => { calls.searchByName.push(q); return nameHits; },
    };
    let textResult = [{ placeId: 'p1', name: 'スカイツリー', lat: 35.7, lng: 139.8, genre: 'sightsee' },
                      { placeId: 'p2', name: 'マック', lat: 35.6, lng: 139.7, genre: 'food' }];
    App.places.searchText = (q, opts) => { calls.searchTextBias.push(opts && opts.bias); return Promise.resolve(textResult); };
    App.search.init();
    const eq = (n, g, w) => window.__logs.push((JSON.stringify(g) === JSON.stringify(w) ? 'PASS' : 'FAIL') + ' ' + n + ' ' + JSON.stringify(g));

    window.__run = async () => {
      window.__logs = [];
      // Enter（結果あり）→ clearPlace, searchText(bias), renderPlaceResults, fitTo
      await App.search.runPlaceSearch('スカイ');
      eq('enter-clears', calls.clearPlace >= 1, true);
      eq('enter-bias', calls.searchTextBias[0], { __bounds: true });
      eq('enter-render-n', calls.renderPlace[0].n, 2);
      eq('enter-fit-n', calls.fitTo[0], 2);
      // ピン onSelect → showPlaceCard(id,{fly:true})
      calls.renderPlace[0].cb('p1');
      eq('pin-select-card', calls.showPlaceCard[0], ['p1', { fly: true }]);
      // Enter（0件）→ searchByName フォールバック
      textResult = []; nameHits = 0;
      await App.search.runPlaceSearch('存在しない');
      eq('empty-fallback', calls.searchByName, ['存在しない']);
      // ドロップダウンの場所選択 → showPlaceCard(id,{fly:true,pin:true})
      App.search.render([], [{ placeId: 'p9', mainText: 'X', secondaryText: 'Y' }], {});
      document.querySelector('.ss-row[data-kind=place]').click();
      eq('dropdown-place-pin', calls.showPlaceCard[1], ['p9', { fly: true, pin: true }]);
      // 単体
      App.places._selfTestText();
      return window.__logs.join('\n');
    };
  </script>
</body></html>
```

- [ ] **Step 2: 実行して全 PASS を確認**

ローカルサーバを起動し `_pins-test.html` を開き、コンソールで:
```js
window.__run().then(r => r)
```
Expected: `enter-clears`/`enter-bias`/`enter-render-n`/`enter-fit-n`/`pin-select-card`/`empty-fallback`/`dropdown-place-pin` が `PASS`、続けて `_selfTestText` の 7 行が `PASS`。

- [ ] **Step 3: ハーネスを削除してコミット**

```bash
rm -f _pins-test.html
git add -A
git commit -m "test(search): map-pins integration harness verified (removed)" || echo "nothing to commit"
```

---

## Task 6: 実機確認とデプロイ

- [ ] **Step 1: 構文最終チェック**

Run: `node --check js/places.js && node --check js/map.js && node --check js/records.js && node --check js/search.js`
Expected: すべて exit 0

- [ ] **Step 2: マージ＆デプロイ**

機能ブランチで実装した場合は `main` へマージ後 `git push`（=GitHub Pages 反映）。

- [ ] **Step 3: 実機確認（デプロイ後 1〜2分、ハード更新）**

- 「マクドナルド」等で Enter → 近くの複数ピンがマップに出て全体が収まる。ピンをタップ → 場所カード。
- 「スカイツリー」で Enter → 1 ピン。
- ドロップダウンの場所を選択 → その地点に単一ピン＋カード。
- 検索欄を空にする → 場所ピンが消える。記録候補を選ぶ → 場所ピンが消えて詳細へ。
- 記録ピン（既存）は場所検索で消えない。

---

## Self-Review メモ（作成者チェック済み）

- spec 各要件に対応タスクあり：searchText/正規化(Task1)、ピンレイヤー(Task2)、単一ピン＋clearSearch連動(Task3)、Enter検索・行選択・フォールバック(Task4)、テスト(Task5)、デプロイ(Task6)。
- プレースホルダ無し（実コードを各ステップに記載）。
- 型/名称整合: `searchText(q,{bias})`→`[{placeId,name,lat,lng,genre}]`、`renderPlaceResults(places,onSelect)`/`clearPlaceResults()`、`showPlaceCard(id,{fly,pin})`、`runPlaceSearch(q)` は定義タスクと使用箇所で一致。`fitTo` は既存（lat/lng を持つ配列で動作）。
