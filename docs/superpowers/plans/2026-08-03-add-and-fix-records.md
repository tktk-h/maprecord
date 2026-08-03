# 記録の「追加・修正をラクにする」3機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 場所名検索での記録追加(A)・Googleマップで開く(C)・編集画面からのピン位置修正(D) を追加し、記録の追加と修正の手間を減らす。

**Architecture:** 既存のバニラJS + `window.App.*` モジュール構成に沿う。ジオコーディングは新モジュール `js/geocode.js`（Nominatim、プロバイダ非依存の `search()` のみ公開）。地図操作は `js/map.js` にヘルパー追加。UIは `js/records.js` に集約。Firestore のスキーマ変更・移行は不要（既存 `lat/lng/name` を使う）。

**Tech Stack:** Vanilla JS (ES modules + グローバル `window.App`), Leaflet 1.9.4, Nominatim(OSM) ジオコーディング, Firebase Firestore（既存）。

**テスト方針（重要）:** このリポジトリは自動テストランナーを持たない。`js/photos.js` の `_selfTest()`（コンソールに PASS/FAIL を出す）パターンに倣い、**純粋ロジックはコンソール自己テスト**で確認する。DOM/地図/認証が絡む挙動は**手動確認**（アプリはGoogleログイン後にのみ地図が初期化されるため、確認は本番 https://tktk-h.github.io/maprecord/ もしくはログイン済み環境で行う）。各タスクは「セルフテスト or 手動確認手順」を明示する。

**参照ファイル（既存の書き方に合わせる）:**
- モジュールの形: `js/map.js`, `js/records.js`（`window.App.x = (function(){ ... return {...}; })();`）
- 自己テストの形: `js/photos.js:43-49` の `_selfTest`
- 追加フォームの合流点: `App.records.showAddForm(lat, lng, { name, genre })`（`js/records.js:249`）
- 候補リストの既存スタイル: `.result-list / .result-row / .result-thumb / .result-name / .result-sub / .result-caret`（`style.css:152-162`）
- 現在地ボタンの見た目/配置: `#locate-btn`（`style.css:84-91`, モバイル `style.css:307-308`）

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/geocode.js` | Nominatim 呼び出し（`search()`/`parseResults()`/`_selfTest()`）。プロバイダ非依存の唯一の入口 | **新規** |
| `js/map.js` | 表示範囲取得 `getViewbox()`、位置修正用ドラッグマーカー `startPickLocation/getPickedLatLng/stopPickLocation` | 変更 |
| `js/records.js` | A: `showPlaceSearch()/renderPlaceResults()`。C: 詳細に Googleマップリンク。D: 編集に「位置を修正」＋座標上書き | 変更 |
| `index.html` | 「場所を検索」ボタン、`geocode.js` の読み込み | 変更 |
| `js/app.js` | 「場所を検索」ボタンの配線、ビュー切替時の表示/非表示 | 変更 |
| `style.css` | 場所検索ボタン・候補リストのアイコンサムネ・Googleマップボタン・位置修正ヒント | 変更 |

---

## Task 1: `js/geocode.js` — Nominatim ジオコーディングモジュール（新規）

**Files:**
- Create: `js/geocode.js`

- [ ] **Step 1: `js/geocode.js` を新規作成（`search`/`parseResults`/`_selfTest` を実装）**

```js
window.App = window.App || {};
// 場所名 → 座標（ジオコーディング）。プロバイダは Nominatim(OSM)・無料・キー不要。
// records.js からはこの search() だけを使う（プロバイダ非依存にしておき、将来差し替え可能に）。
App.geocode = (function () {
  const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const LIMIT = 5;

  // Nominatim の生JSON配列 → [{ name, address, lat, lng }]（最大 limit 件、無効座標は除外）
  function parseResults(json, limit) {
    if (!Array.isArray(json)) return [];
    return json.map((r) => {
      const full = r.display_name || '';
      const name = r.name || full.split(',')[0].trim() || '(名称不明)';
      return { name, address: full, lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).slice(0, limit);
  }

  // query を検索。opts.viewbox=[west,south,east,north] があれば近場を優先。返り値は parseResults の形。
  async function search(query, opts) {
    const q = (query || '').trim();
    if (!q) return [];
    const params = new URLSearchParams({
      format: 'jsonv2', q, limit: String(LIMIT),
      'accept-language': 'ja', addressdetails: '1',
    });
    if (opts && opts.viewbox && opts.viewbox.length === 4) {
      params.set('viewbox', opts.viewbox.join(',')); // [west,south,east,north]（両隅で範囲を示す）
      params.set('bounded', '0');                     // 範囲外も出すが近場を優先
    }
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('geocode HTTP ' + res.status);
    return parseResults(await res.json(), LIMIT);
  }

  function _selfTest() {
    const sample = [
      { display_name: '東京駅, 丸の内, 千代田区, 東京都, 日本', name: '東京駅', lat: '35.6812', lon: '139.7671' },
      { display_name: '無効座標の場所, どこか', lat: 'x', lon: 'y' }, // 除外される想定
    ];
    const out = parseResults(sample, 5);
    const ok = out.length === 1
      && out[0].name === '東京駅'
      && out[0].address.startsWith('東京駅')
      && Math.abs(out[0].lat - 35.6812) < 1e-6
      && Math.abs(out[0].lng - 139.7671) < 1e-6;
    console.log((ok ? 'PASS' : 'FAIL') + ' geocode.parseResults', JSON.stringify(out));
  }

  return { search, parseResults, _selfTest };
})();
```

- [ ] **Step 2: パーサの自己テストを実行して確認**

ブラウザで `js/geocode.js` を読み込んだページ（Task 3 で index.html に追加後、もしくは一時的に `<script src="js/geocode.js"></script>` を貼ったHTML）の DevTools コンソールで:

Run: `App.geocode._selfTest()`
Expected: `PASS geocode.parseResults [{"name":"東京駅",...}]`

（この時点で index.html にまだ読み込みを足していなければ、`file://` で最小HTMLに `<script src="js/geocode.js"></script>` を置いて確認してよい。Task 3 完了後は本番/ローカルのアプリ内コンソールで再確認できる。）

- [ ] **Step 3: コミット**

```bash
git add js/geocode.js
git commit -m "Add geocode module (Nominatim search, provider-agnostic)"
```

---

## Task 2: `js/map.js` — 表示範囲取得＋位置修正用ドラッグマーカー

**Files:**
- Modify: `js/map.js`（`return { ... }` に helper を追加。`tempMarker` の定義付近に `pickMarker` を追加）

- [ ] **Step 1: `pickMarker` 変数を追加**

`js/map.js` の先頭付近、`let tempMarker = null;`（`js/map.js:4`）の直後に追記:

```js
  let pickMarker = null; // 「位置を修正」中だけ出すドラッグ可能マーカー
```

- [ ] **Step 2: ヘルパー3種＋`getViewbox` を実装**

`js/map.js` の `clearTempMarker()` 関数（`js/map.js:59-61`）の直後に、以下の関数群を追加:

```js
  // 現在の地図表示範囲 [west, south, east, north]（ジオコーディングの近場バイアス用）
  function getViewbox() {
    if (!map) return null;
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  // 位置修正：対象地点へ寄せ、ドラッグ可能なマーカーを1つ出す
  function startPickLocation(lat, lng) {
    stopPickLocation();
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
    pickMarker = L.marker([lat, lng], {
      draggable: true, autoPan: true, zIndexOffset: 1200,
      icon: L.divIcon({ className: '', html: '<div class="temp-pin picking"></div>',
        iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(map);
  }
  // 現在のドラッグ位置 { lat, lng }（未開始なら null）
  function getPickedLatLng() {
    if (!pickMarker) return null;
    const ll = pickMarker.getLatLng();
    return { lat: ll.lat, lng: ll.lng };
  }
  function stopPickLocation() {
    if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  }
```

- [ ] **Step 3: `return { ... }` に公開関数を追加**

`js/map.js` の末尾 `return { ... };`（`js/map.js:121-123`）に `getViewbox, startPickLocation, getPickedLatLng, stopPickLocation` を追加する。変更後の return はこの形にする:

```js
  return { init, setClickHandler, clearPins, renderPins, flyTo, fitTo, refresh,
           showTempMarker, clearTempMarker,
           getViewbox, startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map, _getLayer: () => layer };
```

- [ ] **Step 4: 手動確認（ログイン済みアプリのコンソール）**

ログイン済みの地図画面の DevTools コンソールで:

Run:
```js
App.map.startPickLocation(35.681236, 139.767125);
```
Expected: 東京駅あたりへ地図が寄り、ドラッグできるマーカーが1個出る。マーカーをドラッグしてから:
```js
App.map.getPickedLatLng();
```
Expected: ドラッグ後の `{lat, lng}` が返る。続けて:
```js
App.map.stopPickLocation();
```
Expected: マーカーが消える。さらに:
```js
App.map.getViewbox();
```
Expected: `[west, south, east, north]` の4要素配列（例: `[139.7…, 35.6…, 139.8…, 35.7…]`）。

- [ ] **Step 5: コミット**

```bash
git add js/map.js
git commit -m "Add map helpers: getViewbox + draggable pick-location marker"
```

---

## Task 3: 機能A — 「場所を検索して追加」（ボタン＋検索UI＋候補選択）

**Files:**
- Modify: `index.html`（ボタン追加、`geocode.js` 読み込み）
- Modify: `js/app.js`（ボタン配線、ビュー切替での表示制御）
- Modify: `js/records.js`（`showPlaceSearch`/`renderPlaceResults` 追加、公開）
- Modify: `style.css`（ボタン配置、候補アイコンサムネ）

- [ ] **Step 1: `index.html` に `geocode.js` の読み込みを追加**

`js/records.js` を読み込む行（`index.html:90`）の**直前**に追加:

```html
  <script src="js/geocode.js"></script>
```

- [ ] **Step 2: `index.html` に「場所を検索」ボタンを追加**

`#locate-btn`（`index.html:78`）の**直後**に追加:

```html
    <button id="place-search-btn" title="場所を検索して追加"><i class="ph ph-map-pin-plus"></i><span>場所を検索</span></button>
```

- [ ] **Step 3: `js/records.js` に検索UIの2関数を追加**

`js/records.js` の `showAddForm` 関数の**直前**（`js/records.js:247` のコメント付近）に、以下の2関数を追加:

```js
  // 「場所を検索して追加」：下シートに検索フォームを出す（Aの入口）
  function showPlaceSearch() {
    searchResults = null;
    App.map.clearTempMarker();
    panel().innerHTML = `
      <button type="button" id="ps-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      <h2>場所を検索して追加</h2>
      <form id="ps-form" class="ps-form">
        <input type="text" id="ps-input" placeholder="店名・地名（例：渋谷 スターバックス）" autocomplete="off">
        <button type="submit" id="ps-go" title="検索"><i class="ph ph-magnifying-glass"></i></button>
      </form>
      <div id="ps-results"><p class="hint">場所名を入力して検索してください</p></div>`;
    if (App.sheet) App.sheet.snapTo('half');
    document.getElementById('ps-back').onclick = clearPanel;
    const form = document.getElementById('ps-form');
    const input = document.getElementById('ps-input');
    const results = document.getElementById('ps-results');
    const goBtn = document.getElementById('ps-go');
    input.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      goBtn.disabled = true;
      results.innerHTML = '<p class="hint">検索中…</p>';
      try {
        const list = await App.geocode.search(q, { viewbox: App.map.getViewbox() });
        renderPlaceResults(list);
      } catch (err) {
        results.innerHTML = '<p class="hint">検索に失敗しました。通信環境を確認してください。</p>';
      } finally {
        goBtn.disabled = false;
      }
    };
  }

  // 検索候補（最大5件）を下シートに描画。タップで追加フォームへ。
  function renderPlaceResults(list) {
    const results = document.getElementById('ps-results');
    if (!results) return;
    if (!list.length) {
      results.innerHTML = '<p class="hint">見つかりませんでした。別のキーワードでお試しください。</p>';
      return;
    }
    const esc = (s) => (s || '').replace(/</g, '&lt;');
    results.innerHTML = `<ul class="result-list">${list.map((p, i) => `
      <li><button type="button" class="result-row ps-pick" data-i="${i}">
        <span class="result-thumb icon"><i class="ph ph-map-pin"></i></span>
        <span class="result-text">
          <span class="result-name">${esc(p.name)}</span>
          <span class="result-sub">${esc(p.address)}</span>
        </span>
        <i class="ph ph-caret-right result-caret"></i>
      </button></li>`).join('')}</ul>`;
    results.querySelectorAll('.ps-pick').forEach((b) => {
      b.onclick = () => {
        const p = list[Number(b.dataset.i)];
        App.map.flyTo(p.lat, p.lng);
        showAddForm(p.lat, p.lng, { name: p.name });
      };
    });
  }
```

- [ ] **Step 4: `js/records.js` の `return { ... }` に `showPlaceSearch` を公開**

`js/records.js` 末尾の return（`js/records.js:480-482`）に `showPlaceSearch` を追加:

```js
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showPlaceSearch, _clearPanel: clearPanel };
```

- [ ] **Step 5: `js/app.js` にボタン配線とビュー切替の表示制御を追加**

(a) `js/app.js` の `showMap()` 内、`document.getElementById('locate-btn').hidden = false;`（`js/app.js:18`）の直後に追加:

```js
    document.getElementById('place-search-btn').hidden = false;
```

(b) `showCalendar()` 内、`document.getElementById('locate-btn').hidden = true;`（`js/app.js:28`）の直後に追加:

```js
    document.getElementById('place-search-btn').hidden = true;
```

(c) 現在地ボタンの配線（`js/app.js:39-56` の locateBtn ブロック）の**直後**に、場所検索ボタンの配線を追加:

```js
  // 場所を検索して追加
  document.getElementById('place-search-btn').addEventListener('click', () => {
    App.records.showPlaceSearch();
  });
```

- [ ] **Step 6: `style.css` にボタン配置と候補アイコンサムネのスタイルを追加**

`#locate-btn:disabled { ... }`（`style.css:91`）の直後に追加:

```css
/* 場所を検索して追加ボタン（現在地ボタンの上に重ねて配置） */
#place-search-btn { position: absolute; left: 16px; bottom: 74px; z-index: 500;
  display: inline-flex; align-items: center; gap: 7px;
  border-radius: var(--radius-pill); padding: 11px 16px;
  background: var(--surface); color: var(--accent-strong); font-size: 14px; font-weight: 600;
  box-shadow: var(--shadow-md); transition: transform .1s; }
#place-search-btn .ph { font-size: 18px; }
#place-search-btn:active { transform: scale(.96); }
#place-search-btn[hidden] { display: none; }
/* 場所検索フォーム */
.ps-form { display: flex; gap: 8px; margin: 10px 0 4px; }
.ps-form input { flex: 1 1 auto; }
.ps-form button { flex: 0 0 auto; padding: 0 14px; border-radius: var(--radius-sm); }
/* 候補のアイコンサムネ（写真がない場所検索用） */
.result-thumb.icon { display: flex; align-items: center; justify-content: center;
  background: var(--surface-2); color: var(--accent-strong); }
.result-thumb.icon .ph { font-size: 20px; }
```

モバイル配置。`#locate-btn { top: 14px; right: 14px; ... }`（`style.css:307`）の**直後**に追加:

```css
  #place-search-btn { top: 14px; right: 64px; left: auto; bottom: auto; padding: 11px; gap: 0; }
  #place-search-btn span { display: none; } /* スマホではアイコンのみの丸ボタン */
```

- [ ] **Step 7: 手動確認（ログイン済みアプリ）**

1. 地図画面に「場所を検索」ボタンが出る（PC=現在地ボタンの上、スマホ=右上の現在地ボタンの左）。
2. タップ → 下シートに検索フォーム。店名（例「渋谷 スターバックス」）を入れて検索 → 候補が最大5件、地図ピンアイコン＋名称＋住所で並ぶ。
3. 候補タップ → その地点へ地図が飛び、仮マーカーが出て「記録を追加」フォームが**場所名入り**で開く。日付=今日。
4. そのまま保存 → 記録が地図に出る（購読で反映）。
5. 見つからない語（例「asdfghjk」）→「見つかりませんでした」。
6. カレンダー画面に切り替えると「場所を検索」ボタンは消える。地図に戻ると再表示。
7. コンソールで `App.geocode._selfTest()` → `PASS`。

- [ ] **Step 8: コミット**

```bash
git add index.html js/app.js js/records.js style.css
git commit -m "feat: search a place by name and add a record (Nominatim)"
```

---

## Task 4: 機能C — 記録詳細に「Googleマップで開く」

**Files:**
- Modify: `js/records.js`（`showDetail` の HTML にリンク追加）
- Modify: `style.css`（`.gmaps-btn`）

- [ ] **Step 1: `showDetail` にGoogleマップリンクのHTMLを追加**

`js/records.js` の `showDetail`（`js/records.js:306`）内、`revisit-btn` の行（`js/records.js:329`）の**直後**に、以下の1行を追加する（`panel().innerHTML = ...` テンプレート文字列内）:

```js
      <a class="gmaps-btn" href="https://www.google.com/maps/search/?api=1&query=${record.lat},${record.lng}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i>Googleマップで開く</a>
```

追加後の該当箇所は次の並びになる:

```js
      <button type="button" id="revisit-btn" class="revisit-btn"><i class="ph ph-plus"></i>同じ場所にもう一度記録</button>
      <a class="gmaps-btn" href="https://www.google.com/maps/search/?api=1&query=${record.lat},${record.lng}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i>Googleマップで開く</a>
      <div class="form-actions">
```

（`<a>` なので追加のイベント配線は不要。）

- [ ] **Step 2: `style.css` に `.gmaps-btn` を追加**

`.revisit-btn` の定義を探し（`grep -n "revisit-btn" style.css`）、その直後に追加。見つからなければ `.hint { ... }`（`style.css:123`）の直後に追加:

```css
.gmaps-btn { display: inline-flex; align-items: center; gap: 7px; margin: 4px 0 2px;
  padding: 10px 14px; border-radius: var(--radius-sm); background: var(--surface-2);
  color: var(--accent-strong); font-size: 14px; font-weight: 600; text-decoration: none; }
.gmaps-btn .ph { font-size: 18px; }
.gmaps-btn:active { transform: scale(.98); }
```

- [ ] **Step 3: 手動確認（ログイン済みアプリ）**

1. 任意の記録ピンをタップ → 詳細に「Googleマップで開く」ボタンが出る。
2. タップ → 新規タブで Google マップが開き、その記録の**座標の地点**が表示される。
3. 既存の「編集/削除/もう一度記録」に影響なし。

- [ ] **Step 4: コミット**

```bash
git add js/records.js style.css
git commit -m "feat: open a record location in Google Maps"
```

---

## Task 5: 機能D — 編集画面から「位置を修正」（ピンをドラッグ）

**Files:**
- Modify: `js/records.js`（`showEditForm` にボタン・ヒント・座標上書き・後片付け）
- Modify: `style.css`（`.fix-loc-btn` と `.temp-pin.picking`）

- [ ] **Step 1: `showEditForm` のフォームに「位置を修正」UIを追加**

`js/records.js` の `showEditForm`（`js/records.js:357`）内、フォームの `写真を追加` の label 行（`js/records.js:369`）の**直後**、`<div class="form-actions">`（`js/records.js:370`）の**直前**に追加:

```js
        <label>場所の位置</label>
        <button type="button" id="fix-loc-btn" class="fix-loc-btn"><i class="ph ph-map-pin"></i>位置を修正</button>
        <p id="fix-loc-hint" class="hint" hidden>ピンをドラッグして正しい位置へ。「更新」で保存されます。</p>
```

- [ ] **Step 2: 「位置を修正」ボタンの配線を追加**

`js/records.js` の `showEditForm` 内、`renderExisting();` の呼び出し（`js/records.js:386`）の**直後**に追加:

```js
    document.getElementById('fix-loc-btn').onclick = () => {
      App.map.startPickLocation(record.lat, record.lng);
      const btn = document.getElementById('fix-loc-btn');
      btn.classList.add('active');
      btn.innerHTML = '<i class="ph ph-map-pin"></i>位置修正中（ドラッグ）';
      document.getElementById('fix-loc-hint').hidden = false;
      if (App.sheet) App.sheet.snapTo('peek'); // 地図を広く見せる
    };
```

- [ ] **Step 3: キャンセル時にドラッグマーカーを片付ける**

`js/records.js` の `showEditForm` 内、キャンセルの配線（`js/records.js:388`）を次のように変更:

変更前:
```js
    document.getElementById('cancel-btn').onclick = () => showDetail(record);
```
変更後:
```js
    document.getElementById('cancel-btn').onclick = () => { App.map.stopPickLocation(); showDetail(record); };
```

- [ ] **Step 4: 更新保存で修正後の座標を採用し、マーカーを片付ける**

`js/records.js` の `showEditForm` 内、`onsubmit` の中で `updated` を組み立てている箇所（`js/records.js:397-402`）を次のように変更する。

変更前:
```js
        const updated = {
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: record.lat, lng: record.lng,
          photos: keep.concat(uploaded), // 残した既存写真＋追加分
        };
        await App.cloud.put(updated);
        showDetail(updated);
```
変更後:
```js
        const picked = App.map.getPickedLatLng(); // 「位置を修正」していれば新座標
        const updated = {
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: picked ? picked.lat : record.lat,
          lng: picked ? picked.lng : record.lng,
          photos: keep.concat(uploaded), // 残した既存写真＋追加分
        };
        App.map.stopPickLocation();
        await App.cloud.put(updated);
        showDetail(updated);
```

- [ ] **Step 5: `style.css` に「位置を修正」ボタンとドラッグマーカーのスタイルを追加**

`.gmaps-btn` の定義（Task 4 で追加）の直後に追加:

```css
.fix-loc-btn { display: inline-flex; align-items: center; gap: 7px; margin: 2px 0 2px;
  padding: 10px 14px; border-radius: var(--radius-sm); background: var(--surface-2);
  color: var(--accent-strong); font-size: 14px; font-weight: 600; }
.fix-loc-btn.active { background: var(--accent); color: #fff; }
.fix-loc-btn .ph { font-size: 18px; }
```

ドラッグ中マーカーの見た目。`.temp-pin` の定義を探し（`grep -n "temp-pin" style.css`）、その直後に追加（既存の `.temp-pin` を基に、ドラッグ可能を示す強調）:

```css
.temp-pin.picking { cursor: grab; box-shadow: 0 0 0 4px rgba(183,110,100,.35); }
```

- [ ] **Step 6: 手動確認（ログイン済みアプリ）**

1. 記録の詳細 →「編集」→ フォーム下部に「位置を修正」ボタン。
2. タップ → 地図が対象地点に寄り、ドラッグ可能マーカーが出る。ボタンが「位置修正中（ドラッグ）」＆ヒント表示。下シートが下がって地図が見える。
3. マーカーをドラッグして別位置へ → 「更新」→ 詳細に戻り、地図のピンが**新しい位置**に移動している。
4. もう一度「編集」→「位置を修正」せずに「更新」→ 位置は変わらない。
5. 「編集」→「位置を修正」→「キャンセル」→ ドラッグマーカーが残らない。
6. 既存の編集（日付/名前/写真の追加削除）が従来どおり動く。

- [ ] **Step 7: コミット**

```bash
git add js/records.js style.css
git commit -m "feat: fix a record location by dragging the pin in edit mode"
```

---

## Task 6: 本番反映と通し確認

**Files:** （変更なし。デプロイのみ）

- [ ] **Step 1: 本番へプッシュ**

```bash
git push origin main
```

- [ ] **Step 2: 本番で通し確認（約1分後）**

https://tktk-h.github.io/maprecord/ にログインし、Task 3/4/5 の手動確認手順（A→C→D）を実機（できればスマホ）で通す。特に:
- A: 場所検索→候補→追加→保存が二人の端末で同期する。
- C: Googleマップが正しい地点で開く。
- D: 位置修正が保存され、相手側にも反映される。
- 既存機能（タップ追加・現在地・記録検索・タグ・カレンダー）が壊れていない。

- [ ] **Step 3: メモリ更新**

`maprecord-firebase-wip.md` はクラウド化完了済みなので、必要なら本タスク完了を反映（別途プロジェクトメモリの整理）。

---

## Self-Review（計画者による確認結果）

- **スペック網羅:**
  - A（場所検索追加）→ Task 1（geocode）+ Task 3（UI/入口/候補/フォーム合流）✓
  - C（Googleマップで開く）→ Task 4 ✓
  - D（位置修正・編集から・ドラッグ）→ Task 2（map helper）+ Task 5 ✓
  - Nominatim ポリシー（ユーザー操作起点・逐次検索なし・件数5・実行中ボタン無効化）→ Task 1 + Task 3 Step 3（`goBtn.disabled`）✓
  - スキーマ変更なし → 全タスクで既存 `lat/lng/name` のみ使用 ✓
- **プレースホルダ:** なし（全ステップに実コード/実コマンド/期待結果を記載）。自動テスト非対応の旨は冒頭で明記し、代替（自己テスト＋手動）を各タスクに用意。
- **型/名称整合:** `App.geocode.search/parseResults/_selfTest`、`App.map.getViewbox/startPickLocation/getPickedLatLng/stopPickLocation`、`App.records.showPlaceSearch/renderPlaceResults` は定義タスクと利用タスクで一致。`showAddForm(lat,lng,{name})`・`App.sheet.snapTo`・`App.cloud.put` は既存シグネチャに一致。
