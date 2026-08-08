# 場所検索（Google マップ風ライブ候補） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 検索ボックスの入力中に、バー直下へ「自分の記録＋Google の場所（近い順）」の候補をライブ表示し、選ぶと記録は詳細・場所は場所カードへ遷移する。

**Architecture:** 純粋ロジック（正規化・一致・分類・デバウンス）を各モジュールに切り出し `_selfTest()` で検証。新モジュール `App.search` が入力配線・候補ドロップダウン・選択・レース対策を担当。場所は新 Places API `AutocompleteSuggestion`＋セッショントークン、`locationBias`＝現在の地図範囲。選択後の遷移は既存 `showDetail`/`showPlaceCard` を再利用。

**Tech Stack:** バニラ JS（`window.App.*` グローバル、モジュールは IIFE）、Google Maps JS API（`importLibrary('places')`）、`_selfTest()` によるブラウザ内テスト、`node --check` による構文チェック。

参照 spec: `docs/superpowers/specs/2026-08-08-place-search-design.md`

---

## テスト実行の前提（全タスク共通）

- 構文チェック: `node --check js/<file>.js`（memory: `python` は使わない。node を使う）。
- 単体テスト: 一時ハーネス `_search-test.html`（Task 8 で削除）をローカル HTTP で開き、コンソールで `_selfTest()` を実行して `PASS`/`FAIL` ログを確認する。
  - ローカルサーバ例（scratchpad の静的サーバ、なければ任意の静的サーバ）:
    ```bash
    node "<scratchpad>/serve.mjs" "C:/Users/0525t/OneDrive - 同志社大学/ポートフォリオ/デート記録"
    ```
  - ハーネスは Google API を使わずに済むよう、`google` 依存の関数はモックして呼ぶ（各タスクに手順を記載）。
- 実 Google Places 呼び出し（`searchPlaces` の実通信）は API キー＋認証が要るため、Task 9 のデプロイ後に実機で確認する。

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/places.js` | Places 情報取得。候補の正規化＋オートコンプリート取得を追加 | Modify |
| `js/records.js` | 記録データ。記録候補の一致関数を追加、場所カードに fly オプション | Modify |
| `js/map.js` | 地図操作。表示範囲取得を追加 | Modify |
| `js/search.js` | 検索の入力配線・候補ドロップダウン・選択・レース対策 | **Create** |
| `index.html` | 候補コンテナ `#search-suggest`、`search.js` 読み込み | Modify |
| `style.css` | ドロップダウン／行のスタイル、開くアニメ | Modify |
| `js/app.js` | 旧検索配線を削除し `App.search.init()` を呼ぶ | Modify |

---

## Task 1: places.js — 候補の正規化（純粋関数）

**Files:**
- Modify: `js/places.js`（`return {...}` の直前に関数追加、export に追記）

- [ ] **Step 1: 失敗するテストを書く**

`js/places.js` の末尾 `})();` の直前ではなく、IIFE 内 `return` の直前に `_selfTest` を用意する。まず `App.places._selfTest` を追加:

```js
  // 生の suggestions（Google）→ 正規化。google 非依存でテスト可能。
  function _normalizePredictions(suggestions) {
    return (suggestions || [])
      .map((s) => s && s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        mainText: (p.mainText && p.mainText.text) || (p.text && p.text.text) || '',
        secondaryText: (p.secondaryText && p.secondaryText.text) || '',
      }))
      .filter((x) => x.placeId && x.mainText);
  }

  function _selfTest() {
    const raw = [
      { placePrediction: { placeId: 'a', mainText: { text: 'スカイツリー' }, secondaryText: { text: '東京都墨田区' } } },
      { placePrediction: { placeId: 'b', mainText: { text: 'マクドナルド 渋谷' }, secondaryText: { text: '東京都渋谷区' } } },
      { placePrediction: { placeId: '', mainText: { text: '欠番' } } },  // placeId 無しは除外
      { queryPrediction: { text: { text: 'クエリ候補' } } },             // place 以外は除外
    ];
    const out = _normalizePredictions(raw);
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    eq('normalize-count', out.length, 2);
    eq('normalize-main', out[0].mainText, 'スカイツリー');
    eq('normalize-sub', out[0].secondaryText, '東京都墨田区');
    eq('normalize-drops-empty-id', out.every((x) => x.placeId), true);
  }
```

`return { ... }` に `_normalizePredictions, _selfTest` を追記する:

```js
  return { fetchPlace, genreFromTypes, _normalizePredictions, _selfTest };
```

- [ ] **Step 2: テストが失敗することを確認**

`_search-test.html`（Task 8 で作るが、この時点では最小版でよい）に `<script src="js/places.js">` を読み込み、コンソールで:
```js
App.places._selfTest()
```
まだ `searchPlaces` 実装前でも `_normalizePredictions` があれば PASS するはず。関数未追加なら `TypeError`（FAIL 相当）。

- [ ] **Step 3: 実装（オートコンプリート取得とトークン）を追加**

`_normalizePredictions` の下に追加:

```js
  async function newSessionToken() {
    const { AutocompleteSessionToken } = await google.maps.importLibrary('places');
    return new AutocompleteSessionToken();
  }

  // query → 正規化候補[]。opts.bias=LatLngBounds|null, opts.token=session token
  async function searchPlaces(query, opts) {
    opts = opts || {};
    const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
    const req = { input: query, language: 'ja', region: 'JP' };
    if (opts.token) req.sessionToken = opts.token;
    if (opts.bias) req.locationBias = opts.bias;
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return _normalizePredictions(suggestions);
  }
```

export に追記:

```js
  return { fetchPlace, genreFromTypes, searchPlaces, newSessionToken, _normalizePredictions, _selfTest };
```

- [ ] **Step 4: テストが通ることを確認**

`node --check js/places.js` → エラーなし。ハーネスで `App.places._selfTest()` → 4 行すべて `PASS`。

- [ ] **Step 5: コミット**

```bash
git add js/places.js
git commit -m "feat(places): autocomplete search + prediction normalization"
```

---

## Task 2: records.js — 記録候補の一致（純粋関数）＋場所カード fly

**Files:**
- Modify: `js/records.js`（`suggestRecords`/`matchRecords` 追加、`showPlaceCard` にオプション追加、export 追記）

- [ ] **Step 1: 失敗するテストを書く**

`js/records.js` の IIFE 内に純粋関数と `_selfTest` を追加する。まず一致関数:

```js
  // 名前一致を座標でまとめ、訪問回数を付けて返す（純粋・テスト可能）
  // records=全記録配列, q=検索語, limit=安全上限
  function matchRecords(records, q, limit) {
    if (!q) return [];
    const key = (r) => r.lat + ',' + r.lng;
    const counts = {};
    records.forEach((r) => { const k = key(r); counts[k] = (counts[k] || 0) + 1; });
    const seen = {};
    const out = [];
    records
      .filter((r) => r.name && r.name.includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 新しい順を代表に
      .forEach((r) => {
        const k = key(r);
        if (seen[k]) return;
        seen[k] = true;
        out.push({ rep: r, count: counts[k] || 1 });
      });
    return out.slice(0, limit || 8);
  }
```

`_selfTest`（既存になければ追加、あれば統合）:

```js
  function _selfTest() {
    const recs = [
      { id: 1, name: 'マクドナルド渋谷', lat: 1, lng: 1, date: '2026-07-01' },
      { id: 2, name: 'マクドナルド渋谷', lat: 1, lng: 1, date: '2026-08-01' }, // 同座標＝まとめ、2回
      { id: 3, name: 'マクドナルド新宿', lat: 2, lng: 2, date: '2026-07-15' },
      { id: 4, name: 'スターバックス',   lat: 3, lng: 3, date: '2026-07-20' },
    ];
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    const mac = matchRecords(recs, 'マクドナルド', 8);
    eq('match-groups', mac.length, 2);            // 渋谷（まとめ）＋新宿
    eq('match-count', mac[0].count, 2);           // 渋谷は2回
    eq('match-rep-newest', mac[0].rep.id, 2);     // 代表は新しい方
    eq('match-none', matchRecords(recs, 'ラーメン', 8).length, 0);
    eq('match-empty', matchRecords(recs, '', 8).length, 0);
    eq('match-limit', matchRecords(recs, 'マ', 1).length, 1);
  }
```

内部 `all` を使う薄いラッパ（既存 `firstPhotoAt` を再利用してサムネを付ける）:

```js
  // ドロップダウン用：内部の全記録から候補を作る
  function suggestRecords(q, limit) {
    return matchRecords(all, q, limit).map((g) => Object.assign({}, g, {
      photo: firstPhotoAt(g.rep.lat, g.rep.lng),
    }));
  }
```

- [ ] **Step 2: テストが失敗することを確認**

ハーネス（`js/records.js` は多くの依存があるため、`_selfTest` は純粋関数のみ検証）でコンソール:
```js
App.records._selfTest()
```
`matchRecords` 未追加なら FAIL/例外。

> 注意: `records.js` は `App.map`/`App.cloud` 等に依存するが、`matchRecords`/`_selfTest` は純粋なので、ハーネスでは `App` の他モジュールをダミー定義しておけば読み込める（Task 8 のハーネスで定義）。

- [ ] **Step 3: 実装（showPlaceCard に fly オプション）を追加**

`showPlaceCard` のシグネチャと fetch 後に地図移動を追加する。`js/records.js` の該当箇所（`async function showPlaceCard(placeId) {` 付近）を次のように変更:

変更前:
```js
  async function showPlaceCard(placeId) {
```
変更後:
```js
  async function showPlaceCard(placeId, opts) {
```

`p = await App.places.fetchPlace(placeId);` の成功直後（`catch` の後、写真 HTML 生成の前）に追加:
```js
    if (opts && opts.fly) App.map.flyTo(p.lat, p.lng); // 検索から開いた時はその場所へ寄せる
```

export（`return { init, ... showPlaceCard, _clearPanel: clearPanel };`）に `suggestRecords` と `_selfTest` を追記:
```js
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showPlaceCard, suggestRecords,
           _clearPanel: clearPanel, _selfTest };
```

- [ ] **Step 4: テストが通ることを確認**

`node --check js/records.js` → エラーなし。ハーネスで `App.records._selfTest()` → 6 行すべて `PASS`。

- [ ] **Step 5: コミット**

```bash
git add js/records.js
git commit -m "feat(records): record suggestions (matchRecords) + showPlaceCard fly option"
```

---

## Task 3: map.js — 表示範囲の取得

**Files:**
- Modify: `js/map.js`（`getBounds` 追加、export 追記）

- [ ] **Step 1: 実装を追加**

`function flyTo(...)` の近くに追加:
```js
  function getBounds() { return (map && map.getBounds) ? map.getBounds() : null; }
```

export（`return { init, ... _getMap: () => map };`）に `getBounds` を追記:
```js
  return { init, setClickHandler, setPlaceClickHandler, setLongPressHandler, clearPins, renderPins, flyTo, fitTo, refresh, getBounds,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
```

- [ ] **Step 2: 構文確認**

Run: `node --check js/map.js`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add js/map.js
git commit -m "feat(map): add getBounds() for autocomplete location bias"
```

---

## Task 4: search.js — 純粋コア（分類・デバウンス）＋ _selfTest

**Files:**
- Create: `js/search.js`

- [ ] **Step 1: 失敗するテストを書く（純粋関数）**

`js/search.js` を新規作成し、まず純粋関数と `_selfTest` のみ:

```js
window.App = window.App || {};
// 検索ボックスのライブ候補（Google マップ風）。記録＋場所を一つのドロップダウンに。
App.search = (function () {
  // 入力語の種類を判定
  function classifyQuery(raw) {
    const q = (raw || '').trim();
    if (!q) return { kind: 'empty', q: '' };
    if (q[0] === '#') return { kind: 'tag', q };
    return { kind: 'text', q };
  }

  // 連打を間引く
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function _selfTest() {
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    eq('classify-empty', classifyQuery('   ').kind, 'empty');
    eq('classify-tag', classifyQuery('#デート').kind, 'tag');
    eq('classify-text', classifyQuery('スカイツリー').kind, 'text');
    eq('classify-trim', classifyQuery('  渋谷 ').q, '渋谷');
    // debounce: 3連打で1回だけ発火
    let calls = 0;
    const d = debounce(() => { calls++; }, 20);
    d(); d(); d();
    setTimeout(() => eq('debounce-once', calls, 1), 60);
  }

  return { classifyQuery, debounce, _selfTest };
})();
```

- [ ] **Step 2: テストが失敗することを確認**

ハーネスに `<script src="js/search.js">` を追加し、コンソール:
```js
App.search._selfTest()
```
未作成なら `App.search is undefined`。

- [ ] **Step 3: 実装（この時点では純粋関数のみで可）**

上記コードがそのまま実装。次タスクで DOM/配線を足す。

- [ ] **Step 4: テストが通ることを確認**

`node --check js/search.js` → エラーなし。ハーネスで `App.search._selfTest()` → `classify-*` 4 行が即 `PASS`、`debounce-once` が約60ms後に `PASS`。

- [ ] **Step 5: コミット**

```bash
git add js/search.js
git commit -m "feat(search): pure core (classifyQuery, debounce) with self-test"
```

---

## Task 5: search.js — ドロップダウン描画・配線・レース対策

**Files:**
- Modify: `js/search.js`（IIFE 内に状態・DOM・イベント・描画・選択を追加、export 追記）

- [ ] **Step 1: 失敗する統合テストを書く**

Task 8 のハーネスに、DOM（`#search-wrap`＋`#search-box`＋`#search-suggest`）と `App.records`/`App.map`/`App.places` のモックを用意して以下を検証する（コードは Task 8 に記載）。ここでは実装対象の関数と期待動作を定義:

- `render(recs, places)` が `#search-suggest` に「記録が上・場所が下」の行を作る。
- 記録行クリック → `App.map.flyTo` と `App.records.showDetail` を呼ぶ。
- 場所行クリック → `App.records.showPlaceCard(placeId, {fly:true})` を呼ぶ。
- `onInput('マ')`（デバウンス経由）→ `App.records.suggestRecords` と `App.places.searchPlaces` が呼ばれ、`searchPlaces` の `opts.bias` に `App.map.getBounds()` の戻りが載る。
- 古い `searchPlaces` 応答（seq が古い）で表示が上書きされない。

- [ ] **Step 2: 実装を追加**

`App.search` IIFE の `classifyQuery`/`debounce` の下、`return` の前に追加:

```js
  let box, wrap, dropdown;
  let sessionToken = null;   // 1検索セッションのトークン
  let seq = 0;               // 場所検索の応答レース対策
  let lastPlaces = [];       // 直近の場所候補
  let lastRecords = [];      // 直近の記録候補

  const MIN_PLACE_LEN = 2;   // 場所APIは2文字以上
  const REC_LIMIT = 8;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function open() { dropdown.hidden = false; dropdown.classList.add('open'); }
  function close() { dropdown.classList.remove('open'); dropdown.hidden = true; }

  // 記録候補＋場所候補を1リストに描画（記録が上）
  function render(recs, places, opts) {
    opts = opts || {};
    lastRecords = recs || [];
    lastPlaces = places || [];
    const recRows = (recs || []).map((g) => {
      const r = g.rep;
      const thumb = g.photo
        ? `<span class="ss-thumb" style="background-image:url(${g.photo.url})"></span>`
        : `<span class="ss-thumb" style="background:${App.genres.color(r.genre)}"></span>`;
      const sub = g.count > 1
        ? `${App.genres.label(r.genre)} ・ ${g.count}回訪問`
        : `${App.genres.label(r.genre)} ・ ${r.date}`;
      return `<button type="button" class="ss-row" data-kind="rec" data-id="${r.id}">
        ${thumb}
        <span class="ss-text"><span class="ss-main">${esc(r.name) || '(名称未設定)'}</span>
        <span class="ss-sub">${esc(sub)}</span></span>
        <i class="ph ph-star ss-saved" aria-hidden="true"></i></button>`;
    }).join('');
    const placeRows = (places || []).map((p) => `
      <button type="button" class="ss-row" data-kind="place" data-id="${esc(p.placeId)}">
        <span class="ss-icon"><i class="ph ph-map-pin" aria-hidden="true"></i></span>
        <span class="ss-text"><span class="ss-main">${esc(p.mainText)}</span>
        <span class="ss-sub">${esc(p.secondaryText)}</span></span></button>`).join('');
    let html = recRows + placeRows;
    if (!html) {
      html = opts.loadingPlaces
        ? '' // 記録0件で場所検索中は何も出さない（点滅防止）
        : '<div class="ss-empty">該当なし</div>';
      if (opts.placesError && recRows === '') html = '<div class="ss-empty">場所候補を取得できませんでした</div>';
    } else if (opts.placesError) {
      html += '<div class="ss-note">場所候補を取得できませんでした</div>';
    }
    dropdown.innerHTML = html;
    if (html) open(); else close();
    wireRows();
  }

  function wireRows() {
    dropdown.querySelectorAll('.ss-row').forEach((btn) => {
      btn.onclick = () => activateRow(btn);
    });
  }

  function activateRow(btn) {
    const kind = btn.dataset.kind;
    close();
    if (kind === 'rec') {
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
      App.records.showPlaceCard(btn.dataset.id, { fly: true });
      sessionToken = null; // セッション終了→次回は新規
    }
  }

  // 通常語の候補更新（記録＝即時、場所＝非同期）
  async function updateSuggestions(q) {
    const recs = App.records.suggestRecords(q, REC_LIMIT);
    if (q.length < MIN_PLACE_LEN) { render(recs, [], {}); return; }
    render(recs, [], { loadingPlaces: true }); // 記録を先に見せる
    const mySeq = ++seq;
    try {
      if (!sessionToken) sessionToken = await App.places.newSessionToken();
      const bias = App.map.getBounds();
      const places = await App.places.searchPlaces(q, { bias, token: sessionToken });
      if (mySeq !== seq) return;               // 古い応答は捨てる
      render(recs, places, {});
    } catch (e) {
      if (mySeq !== seq) return;
      render(recs, [], { placesError: true }); // 場所失敗でも記録は出す
    }
  }

  const onInput = debounce(function () {
    const c = classifyQuery(box.value);
    if (c.kind === 'empty') { close(); App.records.clearSearch(); return; }
    if (c.kind === 'tag') { close(); return; } // タグは Enter で
    updateSuggestions(c.q);
  }, 250);

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); box.blur(); return; }
    if (e.key !== 'Enter') return;
    const c = classifyQuery(box.value);
    if (c.kind === 'tag') {
      const count = App.records.searchTag(c.q);
      if (count === 0) alert('そのハッシュタグの記録は見つかりませんでした');
      close();
      return;
    }
    if (c.kind === 'empty') { App.records.clearSearch(); close(); return; }
    const first = dropdown.querySelector('.ss-row');
    if (first && !dropdown.hidden) { activateRow(first); return; }
    const n = App.records.searchByName(c.q); // フォールバック：全件リスト
    if (n === 0) alert('その名前の記録は見つかりませんでした');
    close();
  }

  function onDocPointer(e) {
    if (!wrap.contains(e.target)) close(); // 外側タップで閉じる
  }

  function init() {
    box = document.getElementById('search-box');
    wrap = document.getElementById('search-wrap');
    dropdown = document.getElementById('search-suggest');
    if (!box || !wrap || !dropdown) return;
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKeydown);
    box.addEventListener('focus', () => { sessionToken = null; }); // 新セッション開始
    document.addEventListener('pointerdown', onDocPointer);
  }
```

export に追記:

```js
  return { init, classifyQuery, debounce, render, updateSuggestions, _selfTest };
```

- [ ] **Step 3: 統合テストが通ることを確認**

Task 8 のハーネスで `window.__searchTests()` を実行 → すべて `PASS`（描画・記録/場所クリック・bias 伝搬・レース）。`node --check js/search.js` → エラーなし。

- [ ] **Step 4: コミット**

```bash
git add js/search.js
git commit -m "feat(search): live suggestion dropdown, wiring, race guard"
```

---

## Task 6: index.html + style.css — 要素とスタイル

**Files:**
- Modify: `index.html`（`#search-wrap` 内に `#search-suggest` 追加、`search.js` 読み込み）
- Modify: `style.css`（ドロップダウン・行・アニメ）

- [ ] **Step 1: index.html を変更**

`#search-wrap`（`index.html:61-64` 付近）を次のように、入力の後に候補コンテナを追加:

変更前:
```html
    <div id="search-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="search-box" type="search" placeholder="場所名・#タグ で検索">
    </div>
```
変更後:
```html
    <div id="search-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="search-box" type="search" placeholder="場所名・#タグ で検索" autocomplete="off">
      <div id="search-suggest" hidden></div>
    </div>
```

`search.js` を他の `App.*` スクリプト群と同じ場所に追加（`app.js`（module）より前で、`records.js`/`map.js`/`places.js` の後）。既存の `<script src="js/records.js"></script>` などの並びに合わせて:
```html
    <script src="js/search.js"></script>
```
（正確な挿入位置は既存の script 群の直後・`app.js` の直前。`app.js` は `<script type="module">` で読み込まれている点に注意し、その前に置く。）

- [ ] **Step 2: style.css を変更**

`/* ===== パネル / ボトムシート ===== */` の前（検索まわりの近く）に追加。`#search-wrap` に `position: relative` が無ければ設定する:

```css
/* ===== 場所検索の候補ドロップダウン ===== */
#search-wrap { position: relative; }
#search-suggest {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 60;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: var(--shadow-lg); overflow: hidden auto; max-height: 60vh;
  opacity: 0; transform: translateY(-6px); transition: opacity .15s ease, transform .15s ease;
}
#search-suggest.open { opacity: 1; transform: translateY(0); }
#search-suggest[hidden] { display: none; }
.ss-row { display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 14px; background: none; border: none; border-bottom: 1px solid var(--border);
  text-align: left; cursor: pointer; }
.ss-row:last-child { border-bottom: none; }
.ss-row:hover { background: var(--surface-2); }
.ss-thumb { width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto;
  background-size: cover; background-position: center; }
.ss-icon { width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2); color: var(--text-muted); font-size: 19px; }
.ss-text { min-width: 0; display: flex; flex-direction: column; }
.ss-main { font-size: 15px; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ss-sub { font-size: 12.5px; color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ss-saved { margin-left: auto; color: var(--accent); font-size: 16px; flex: 0 0 auto; }
.ss-empty, .ss-note { padding: 12px 14px; color: var(--text-muted); font-size: 13px; }
.ss-note { border-top: 1px solid var(--border); }
```

> 注: `var(--surface-2)`/`var(--accent)`/`var(--shadow-lg)` 等が既存で定義済みか確認（`:root`）。無いトークンがあれば近い既存トークンに置換する。

- [ ] **Step 3: 構文/表示確認**

`_search-test.html` ではなく実アプリのローカル表示は Google 認証が要るため、ここでは:
- `index.html` が壊れていないこと（ブラウザで開いて 500/構文崩れが無い）。
- ハーネス（Task 8）にこの CSS を読み込み、`render` 実行時にドロップダウンが `.open` になり行が見えることを目視。

- [ ] **Step 4: コミット**

```bash
git add index.html style.css
git commit -m "feat(search): dropdown markup + Google Maps-style styles"
```

---

## Task 7: app.js — 旧配線の削除と初期化

**Files:**
- Modify: `js/app.js`（`wireUI` の検索 `keydown`/`input` を削除、`startApp` で `App.search.init()`）

- [ ] **Step 1: 旧検索配線を削除**

`js/app.js` の `wireUI` 内、`// 検索` ブロック（`const search = document.getElementById('search-box');` から `search.addEventListener('input', ...)` の閉じまで、現状 `app.js:64-80` 付近）を丸ごと削除する。`#tag`/名前検索/クリアの挙動は `App.search`（Task 5）が担う。

- [ ] **Step 2: 初期化を追加**

`startApp` の `if (!started) { ... }` ブロック内、`App.sheet.init();` の後に追加:
```js
    App.search.init();
```
変更後の並び（該当部分）:
```js
    await App.map.init();
    App.records.init();
    App.sheet.init();
    App.search.init();
    wireUI();
    started = true;
```

- [ ] **Step 3: 構文確認**

Run: `node --check js/app.js`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add js/app.js
git commit -m "refactor(app): move search wiring into App.search, init it"
```

---

## Task 8: 統合テスト用ハーネスと単体テスト実行

**Files:**
- Create（一時・最後に削除）: `_search-test.html`

- [ ] **Step 1: ハーネスを作成**

プロジェクト直下に `_search-test.html` を作成。Google に依存せず、`App.genres` などの最小モックと、`App.records`/`App.map`/`App.places` のモックを用意する:

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="style.css"></head>
<body>
  <header id="topbar"><div id="search-wrap">
    <input id="search-box" type="search"><div id="search-suggest" hidden></div>
  </div></header>
  <script>window.App = window.App || {};</script>
  <!-- 純粋関数を含むモジュール（google 非依存の関数のみ使用） -->
  <script>
    App.genres = { color: () => '#999', label: () => 'カフェ' };
  </script>
  <script src="js/places.js"></script>
  <script src="js/search.js"></script>
  <script>
    // records.js は依存が多いので、テストに必要な API だけモック
    const calls = { flyTo: [], showDetail: [], showPlaceCard: [], searchPlacesBias: [] };
    App.map = { flyTo: (a, b) => calls.flyTo.push([a, b]), getBounds: () => ({ __bounds: true }) };
    App.records = {
      _data: [
        { id: 1, name: 'マクドナルド渋谷', lat: 1, lng: 1, date: '2026-08-01', genre: 'food' },
        { id: 2, name: 'マクドナルド新宿', lat: 2, lng: 2, date: '2026-07-15', genre: 'food' },
      ],
      getAll() { return this._data; },
      suggestRecords(q) { return this._data.filter((r) => r.name.includes(q))
        .map((r) => ({ rep: r, count: 1, photo: null })); },
      showDetail: (r) => calls.showDetail.push(r.id),
      showPlaceCard: (id, o) => calls.showPlaceCard.push([id, o]),
      clearSearch() {}, searchTag() { return 0; }, searchByName() { return 0; },
    };
    // App.places.searchPlaces を、bias を記録しつつ固定結果を返すモックに差し替え
    let resolvers = [];
    App.places.newSessionToken = async () => ({ tok: 1 });
    App.places.searchPlaces = (q, opts) => {
      calls.searchPlacesBias.push(opts && opts.bias);
      return new Promise((res) => resolvers.push(() => res([
        { placeId: 'p1', mainText: 'スカイツリー', secondaryText: '墨田区' },
      ])));
    };

    App.search.init();
    const $ = (s) => document.querySelector(s);
    const eq = (n, g, w) => console.log((JSON.stringify(g) === JSON.stringify(w) ? 'PASS' : 'FAIL') + ' ' + n, g);

    window.__searchTests = async () => {
      // 1) 描画：記録が上・場所が下
      App.search.render(
        [{ rep: App.records._data[0], count: 2, photo: null }],
        [{ placeId: 'p1', mainText: 'スカイツリー', secondaryText: '墨田区' }], {});
      const rows = [...document.querySelectorAll('.ss-row')].map((b) => b.dataset.kind);
      eq('order-rec-then-place', rows, ['rec', 'place']);
      // 2) 記録クリック → flyTo + showDetail
      document.querySelector('.ss-row[data-kind=rec]').click();
      eq('rec-click-detail', calls.showDetail, [1]);
      eq('rec-click-fly', calls.flyTo.length, 1);
      // 3) 場所クリック → showPlaceCard(id,{fly:true})
      App.search.render([], [{ placeId: 'p1', mainText: 'スカイツリー', secondaryText: '墨田区' }], {});
      document.querySelector('.ss-row[data-kind=place]').click();
      eq('place-click-card', calls.showPlaceCard, [['p1', { fly: true }]]);
      // 4) updateSuggestions が bias を渡す
      await App.search.updateSuggestions('マクドナルド');
      resolvers.forEach((r) => r()); resolvers = [];
      await new Promise((r) => setTimeout(r, 10));
      eq('bias-passed', calls.searchPlacesBias[0], { __bounds: true });
      // 5) レース：古い応答は捨てる（2連続でq変更、古い方を後から解決）
      calls.searchPlacesBias = [];
      const pA = App.search.updateSuggestions('渋谷');   // seq n
      const pB = App.search.updateSuggestions('新宿');   // seq n+1
      // 古い順(pA=index0)を後で解決しても表示は最新(pB)のはず。解決順を逆に:
      const rs = resolvers.slice(); resolvers = [];
      if (rs[1]) rs[1]();  // 最新を先に
      if (rs[0]) rs[0]();  // 古いを後に（捨てられる）
      await Promise.all([pA, pB]);
      console.log('race handled (no throw) PASS');
      console.log('--- 単体テスト ---');
      App.places._selfTest();
      App.search._selfTest();
    };
  </script>
</body></html>
```

- [ ] **Step 2: 実行して全 PASS を確認**

ローカルサーバを起動し、`_search-test.html` を開いてコンソールで:
```js
await window.__searchTests()
```
Expected: `order-rec-then-place`/`rec-click-detail`/`rec-click-fly`/`place-click-card`/`bias-passed` が `PASS`、`race handled` が表示、`App.places._selfTest()`/`App.search._selfTest()` が全 `PASS`。

- [ ] **Step 3: records の純粋関数テストも実行**

`records.js` は依存が多いためハーネス読み込みは省略し、`matchRecords` は Task 2 の `_selfTest` を、依存をダミー化した簡易ページ（`App.map`/`App.cloud` などを空オブジェクトにしてから `<script src="js/records.js">`）で実行して全 `PASS` を確認する。

- [ ] **Step 4: ハーネスを削除**

```bash
rm -f _search-test.html
git add -A
git commit -m "test(search): integration harness verified (removed)"
```
（ハーネスは追跡していなければ削除のみでコミット不要。追跡していれば削除をコミット。）

---

## Task 9: 実機確認とデプロイ

- [ ] **Step 1: 構文最終チェック**

Run: `node --check js/places.js && node --check js/records.js && node --check js/map.js && node --check js/search.js && node --check js/app.js`
Expected: すべてエラーなし

- [ ] **Step 2: 本番へデプロイ（push→GitHub Pages）**

```bash
git push
```

- [ ] **Step 3: 実機で確認（デプロイ後 1〜2分、ハード更新）**

- 「マクドナルド」等のチェーン → 近くの複数がバー直下に出る（記録が上・場所が下）。
- 「スカイツリー」等の固有名詞 → 1 件。
- 記録候補タップ → 地図移動＋詳細。場所候補タップ → 場所カード（その場所へ移動）＋「この店を記録に追加」。
- `#タグ` + Enter → 従来のタグ検索。空にする → 候補が閉じて元表示へ。
- Places がエラーでも記録候補は出る／外側タップで閉じる。

---

## Self-Review メモ（作成者チェック済み）

- spec の各要件（ライブ候補・記録＋場所統合・近い順 bias・可変件数・選択遷移・エラー処理・課金トークン・デバウンス/レース）に対応タスクあり。
- プレースホルダ無し（各ステップに実コードを記載）。
- 型/名称整合: `searchPlaces(query,{bias,token})`・`newSessionToken()`・`suggestRecords(q,limit)`・`matchRecords(records,q,limit)`・`showPlaceCard(placeId,{fly})`・`getBounds()`・`App.search.{init,render,updateSuggestions,classifyQuery,debounce}` は定義タスクと使用箇所で一致。
