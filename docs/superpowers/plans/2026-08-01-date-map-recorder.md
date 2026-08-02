# デート記録サイト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デートで行った場所を地図にピン留めし、日付・場所名・ジャンル・メモ・写真を記録して、日/期間/ジャンル/名前検索で見返せる個人用の静的サイトを作る。

**Architecture:** ビルドツールなしの静的サイト。`index.html` + `style.css` + 複数の `js/*.js`（クラシックスクリプトをグローバル名前空間 `App` にぶら下げる）。地図は Leaflet + OpenStreetMap（CDN）。データと写真は IndexedDB に保存（写真は Blob）。純粋な絞り込みロジックだけ切り出してコンソール自己テストで検証し、UI部分はブラウザでの手動確認で進める。

**Tech Stack:** HTML / CSS / Vanilla JS（クラシックスクリプト）/ Leaflet 1.9（CDN）/ IndexedDB / OpenStreetMap タイル

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | マークアップ、CDN/スクリプト読み込み、DOM構造 |
| `style.css` | レイアウトと見た目 |
| `js/db.js` | `App.db` — IndexedDB を開く / 記録のCRUD（写真Blob含む） |
| `js/filters.js` | `App.filters` — 記録配列＋絞り込み条件 → 表示する記録（純粋関数・自己テスト付き） |
| `js/genres.js` | `App.genres` — ジャンル定義と色の一覧（単一の情報源） |
| `js/map.js` | `App.map` — Leaflet地図の初期化、ピンの描画/クリア/移動 |
| `js/records.js` | `App.records` — 追加フォーム・閲覧パネル・編集・削除のUI配線 |
| `js/backup.js` | `App.backup` — 全データの JSON 書き出し / 読み込み |
| `js/app.js` | 起動処理。各モジュールを初期化して配線する |

> **注意:** Leaflet を CDN から読むためインターネット接続が必要。`index.html` はブラウザでファイルを直接開く（`file://`）想定なので、JSはESモジュールではなくクラシックスクリプトにして全ファイルを `<script>` で読み込む。共有状態はグローバル `window.App` オブジェクト経由。

---

## Task 1: プロジェクト骨組みと地図表示

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `js/app.js`
- Create: `js/map.js`

- [ ] **Step 1: `index.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>デート記録</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header id="topbar">
    <h1>デート記録</h1>
    <input id="search-box" type="search" placeholder="場所名で検索">
    <div id="filter-bar"><!-- 絞り込みUIは Task 7 で追加 --></div>
  </header>

  <main id="layout">
    <div id="map"></div>
    <aside id="panel">
      <div id="panel-content"><p class="hint">地図をクリックして記録を追加</p></div>
    </aside>
  </main>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="js/genres.js"></script>
  <script src="js/db.js"></script>
  <script src="js/filters.js"></script>
  <script src="js/map.js"></script>
  <script src="js/records.js"></script>
  <script src="js/backup.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `style.css` を作成**

```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
body { display: flex; flex-direction: column; height: 100vh; }

#topbar { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  background: #d6336c; color: #fff; flex-wrap: wrap; }
#topbar h1 { font-size: 18px; margin: 0; }
#search-box { padding: 6px 10px; border: none; border-radius: 6px; min-width: 180px; }

#layout { flex: 1; display: flex; min-height: 0; }
#map { flex: 1; min-height: 0; }
#panel { width: 320px; overflow-y: auto; background: #fafafa;
  border-left: 1px solid #ddd; padding: 12px; }
.hint { color: #888; }

/* スマホ: 縦積み */
@media (max-width: 700px) {
  #layout { flex-direction: column; }
  #panel { width: auto; height: 40%; border-left: none; border-top: 1px solid #ddd; }
}
```

- [ ] **Step 3: `js/map.js` を作成（地図の初期化とピン管理の土台）**

```javascript
window.App = window.App || {};
App.map = (function () {
  let map, layer;
  let onMapClick = null; // (lat, lng) => void  ... Task 4 で設定

  function init() {
    map = L.map('map').setView([35.681236, 139.767125], 13); // 東京駅あたり
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng); });
  }

  function setClickHandler(fn) { onMapClick = fn; }
  function clearPins() { layer.clearLayers(); }
  function flyTo(lat, lng) { map.setView([lat, lng], 16); }

  return { init, setClickHandler, clearPins, flyTo,
           _getMap: () => map, _getLayer: () => layer };
})();
```

- [ ] **Step 4: `js/app.js` を作成（起動処理）**

```javascript
window.App = window.App || {};
document.addEventListener('DOMContentLoaded', () => {
  App.map.init();
});
```

- [ ] **Step 5: 空の他ファイルを作成してスクリプト読み込みエラーを防ぐ**

以下を最小の中身で作成（各Taskで埋める）:

`js/genres.js`:
```javascript
window.App = window.App || {};
App.genres = { list: [] };
```
`js/db.js`:
```javascript
window.App = window.App || {};
App.db = {};
```
`js/filters.js`:
```javascript
window.App = window.App || {};
App.filters = {};
```
`js/records.js`:
```javascript
window.App = window.App || {};
App.records = {};
```
`js/backup.js`:
```javascript
window.App = window.App || {};
App.backup = {};
```

- [ ] **Step 6: ブラウザで確認**

`index.html` をブラウザで開く。
期待: OpenStreetMap の地図が表示され、東京駅付近が中心。右（スマホでは下）にサイドパネルとヒント文が見える。コンソールにエラーが出ていないこと。

- [ ] **Step 7: コミット（gitを使う場合のみ／未使用ならスキップ）**

```bash
git add index.html style.css js/
git commit -m "feat: 地図表示の骨組みを追加"
```

---

## Task 2: ジャンル定義

**Files:**
- Modify: `js/genres.js`

- [ ] **Step 1: ジャンルと色を定義**

`js/genres.js` を次で置き換え:
```javascript
window.App = window.App || {};
App.genres = {
  // 表示順。key はデータ保存に使う不変ID、label は画面表示、color はピン色。
  list: [
    { key: 'food',      label: 'ごはん',   color: '#e8590c' },
    { key: 'cafe',      label: 'カフェ',   color: '#a9743a' },
    { key: 'facility',  label: '施設',     color: '#1c7ed6' },
    { key: 'sightsee',  label: '観光',     color: '#2f9e44' },
    { key: 'shopping',  label: '買い物',   color: '#ae3ec9' },
    { key: 'other',     label: 'その他',   color: '#868e96' },
  ],
  color(key) {
    const g = this.list.find((x) => x.key === key);
    return g ? g.color : '#868e96';
  },
  label(key) {
    const g = this.list.find((x) => x.key === key);
    return g ? g.label : 'その他';
  },
};
```

- [ ] **Step 2: ブラウザのコンソールで確認**

`index.html` を開き、コンソールで:
```javascript
App.genres.color('cafe'); // => "#a9743a"
App.genres.label('food'); // => "ごはん"
App.genres.color('unknown'); // => "#868e96"
```
期待: 上記の戻り値になる。

- [ ] **Step 3: コミット**

```bash
git add js/genres.js
git commit -m "feat: ジャンル定義と色を追加"
```

---

## Task 3: 絞り込みロジック（純粋関数＋自己テスト）

**Files:**
- Modify: `js/filters.js`

絞り込み条件 `state` の形:
```
state = {
  mode: 'all' | 'day' | 'range',
  day: 'YYYY-MM-DD' | null,          // mode==='day' のとき使用
  from: 'YYYY-MM-DD' | null,         // mode==='range' のとき使用
  to: 'YYYY-MM-DD' | null,           // mode==='range' のとき使用
  genres: Set<string>                // 表示するジャンルkeyの集合。空なら全ジャンル表示
}
```

- [ ] **Step 1: 失敗するテストを書く（自己テストとして）**

`js/filters.js` を次で置き換え:
```javascript
window.App = window.App || {};
App.filters = (function () {
  // 記録が日付条件にマッチするか
  function matchDate(record, state) {
    if (state.mode === 'all') return true;
    if (state.mode === 'day') return record.date === state.day;
    if (state.mode === 'range') {
      if (state.from && record.date < state.from) return false;
      if (state.to && record.date > state.to) return false;
      return true;
    }
    return true;
  }

  // 記録がジャンル条件にマッチするか（空集合＝全ジャンル表示）
  function matchGenre(record, state) {
    if (!state.genres || state.genres.size === 0) return true;
    return state.genres.has(record.genre);
  }

  // 表示すべき記録だけ返す
  function apply(records, state) {
    return records.filter((r) => matchDate(r, state) && matchGenre(r, state));
  }

  return { apply, matchDate, matchGenre };
})();
```

続けて、同じファイル末尾に自己テストを追加:
```javascript
App.filters._selfTest = function () {
  const recs = [
    { id: 1, date: '2026-07-01', genre: 'food' },
    { id: 2, date: '2026-07-15', genre: 'cafe' },
    { id: 3, date: '2026-08-01', genre: 'food' },
  ];
  const S = (o) => Object.assign({ mode: 'all', day: null, from: null, to: null, genres: new Set() }, o);
  const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);

  eq('all',        App.filters.apply(recs, S({})).length, 3);
  eq('day',        App.filters.apply(recs, S({ mode: 'day', day: '2026-07-15' })).length, 1);
  eq('range',      App.filters.apply(recs, S({ mode: 'range', from: '2026-07-01', to: '2026-07-31' })).length, 2);
  eq('range-open', App.filters.apply(recs, S({ mode: 'range', from: '2026-08-01', to: null })).length, 1);
  eq('genre',      App.filters.apply(recs, S({ genres: new Set(['food']) })).length, 2);
  eq('day+genre',  App.filters.apply(recs, S({ mode: 'day', day: '2026-08-01', genres: new Set(['food']) })).length, 1);
  eq('genre-empty',App.filters.apply(recs, S({ genres: new Set() })).length, 3);
};
```

- [ ] **Step 2: テストを実行して確認**

`index.html` を開き、コンソールで:
```javascript
App.filters._selfTest();
```
期待: 7行すべて `PASS ...` と表示される。

- [ ] **Step 3: コミット**

```bash
git add js/filters.js
git commit -m "feat: 絞り込みロジックと自己テストを追加"
```

---

## Task 4: IndexedDB 保存層

**Files:**
- Modify: `js/db.js`

記録の保存形:
```
{ id?, date, name, genre, lat, lng, memo, photos: Blob[] }
```
（id は autoIncrement。写真は Blob 配列でそのまま保存）

- [ ] **Step 1: IndexedDB アクセス層を実装**

`js/db.js` を次で置き換え:
```javascript
window.App = window.App || {};
App.db = (function () {
  const DB_NAME = 'date-recorder';
  const STORE = 'records';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }
  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function add(record)    { return wrap((await tx('readwrite')).add(record)); }
  async function put(record)    { return wrap((await tx('readwrite')).put(record)); }
  async function remove(id)     { return wrap((await tx('readwrite')).delete(id)); }
  async function getAll()       { return wrap((await tx('readonly')).getAll()); }
  async function clear()        { return wrap((await tx('readwrite')).clear()); }

  return { add, put, remove, getAll, clear };
})();
```

- [ ] **Step 2: コンソールで動作確認（自己テスト）**

`index.html` を開き、コンソールで順に実行:
```javascript
await App.db.clear();
const id = await App.db.add({ date: '2026-08-01', name: 'テスト店', genre: 'food', lat: 35.68, lng: 139.76, memo: 'メモ', photos: [] });
(await App.db.getAll()).length; // => 1
await App.db.put({ id, date: '2026-08-01', name: '更新後', genre: 'cafe', lat: 35.68, lng: 139.76, memo: '', photos: [] });
(await App.db.getAll())[0].name; // => "更新後"
await App.db.remove(id);
(await App.db.getAll()).length; // => 0
```
期待: コメント通りの戻り値。エラーなし。

- [ ] **Step 3: コミット**

```bash
git add js/db.js
git commit -m "feat: IndexedDB保存層を追加"
```

---

## Task 5: 記録の追加フロー（地図クリック→フォーム→保存→ピン）

**Files:**
- Modify: `js/map.js`
- Modify: `js/records.js`
- Modify: `js/app.js`
- Modify: `style.css`

- [ ] **Step 1: `js/map.js` にピン描画関数を追加**

`js/map.js` の `clearPins` の下に追記し、`return` に公開を追加:
```javascript
  // records: [{id, lat, lng, name, genre, ...}], onClick: (record)=>void
  function renderPins(records, onClick) {
    clearPins();
    records.forEach((r) => {
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 9, color: '#fff', weight: 2,
        fillColor: App.genres.color(r.genre), fillOpacity: 1,
      });
      marker.bindTooltip(r.name || '(名称未設定)');
      marker.on('click', () => onClick(r));
      marker.addTo(layer);
    });
  }
```
`return { ... }` に `renderPins` を追加:
```javascript
  return { init, setClickHandler, clearPins, renderPins, flyTo,
           _getMap: () => map, _getLayer: () => layer };
```

- [ ] **Step 2: `js/records.js` に状態と再描画・フォームを実装**

`js/records.js` を次で置き換え:
```javascript
window.App = window.App || {};
App.records = (function () {
  let all = [];                 // 全記録（メモリ上のキャッシュ）
  let filterState = { mode: 'all', day: null, from: null, to: null, genres: new Set() };
  const panel = () => document.getElementById('panel-content');

  async function reload() {
    all = await App.db.getAll();
    render();
  }
  function setFilterState(state) { filterState = state; render(); }
  function getAll() { return all; }

  function render() {
    const visible = App.filters.apply(all, filterState);
    App.map.renderPins(visible, showDetail);
  }

  function genreOptions(selected) {
    return App.genres.list.map((g) =>
      `<option value="${g.key}" ${g.key === selected ? 'selected' : ''}>${g.label}</option>`
    ).join('');
  }

  // 追加フォーム表示（地図クリック時）
  function showAddForm(lat, lng) {
    const today = new Date().toISOString().slice(0, 10);
    panel().innerHTML = `
      <h2>記録を追加</h2>
      <form id="rec-form">
        <label>日付<input type="date" name="date" value="${today}" required></label>
        <label>場所名<input type="text" name="name" placeholder="お店・施設の名前" required></label>
        <label>ジャンル<select name="genre">${genreOptions('food')}</select></label>
        <label>メモ・感想<textarea name="memo" rows="4"></textarea></label>
        <label>写真<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="form-actions">
          <button type="submit">保存</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;
    document.getElementById('cancel-btn').onclick = clearPanel;
    document.getElementById('rec-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const photos = Array.from(f.photos.files); // File は Blob なのでそのまま保存可
      await App.db.add({
        date: f.date.value, name: f.name.value, genre: f.genre.value,
        memo: f.memo.value, lat, lng, photos,
      });
      clearPanel();
      await reload();
    };
  }

  function clearPanel() {
    panel().innerHTML = '<p class="hint">地図をクリックして記録を追加</p>';
  }

  // 閲覧・編集・削除は Task 6 で実装。今は最小表示。
  function showDetail(record) {
    panel().innerHTML = `<h2>${record.name}</h2><p>${App.genres.label(record.genre)} / ${record.date}</p>`;
  }

  function init() {
    App.map.setClickHandler(showAddForm);
    reload();
  }

  return { init, reload, render, getAll, setFilterState,
           showDetail, showAddForm, _clearPanel: clearPanel };
})();
```

- [ ] **Step 3: `js/app.js` で records を起動**

`js/app.js` を次で置き換え:
```javascript
window.App = window.App || {};
document.addEventListener('DOMContentLoaded', () => {
  App.map.init();
  App.records.init();
});
```

- [ ] **Step 4: フォームの見た目を `style.css` に追加**

末尾に追記:
```css
#rec-form label, #panel h2 { display: block; margin: 10px 0 4px; font-size: 14px; }
#rec-form input, #rec-form select, #rec-form textarea { width: 100%; padding: 6px; }
.form-actions { margin-top: 12px; display: flex; gap: 8px; }
.form-actions button { padding: 6px 14px; cursor: pointer; }
```

- [ ] **Step 5: ブラウザで確認**

`index.html` を開き:
1. 地図上の任意の場所をクリック → 右パネルに追加フォームが出る。
2. 場所名を入れ、ジャンルを選び、写真を1枚以上選んで「保存」。
3. クリックした場所にピンが立つ（色はジャンルの色）。
4. ピンにマウスを乗せると場所名がツールチップで出る。
5. ピンをクリックすると場所名・ジャンル・日付が出る。
6. ページを再読み込みしてもピンが残っている。

- [ ] **Step 6: コミット**

```bash
git add js/map.js js/records.js js/app.js style.css
git commit -m "feat: 記録の追加とピン表示を実装"
```

---

## Task 6: 閲覧パネル（写真表示）・編集・削除

**Files:**
- Modify: `js/records.js`
- Modify: `style.css`

- [ ] **Step 1: `showDetail` を写真付き・編集/削除ボタン付きに差し替え**

`js/records.js` の `showDetail` 関数を次で置き換え:
```javascript
  function showDetail(record) {
    const photosHtml = (record.photos || []).map((blob) => {
      const url = URL.createObjectURL(blob);
      return `<img class="thumb" src="${url}" alt="">`;
    }).join('');
    panel().innerHTML = `
      <h2>${record.name}</h2>
      <p class="meta">${App.genres.label(record.genre)} ・ ${record.date}</p>
      <div class="photos">${photosHtml || '<span class="hint">写真なし</span>'}</div>
      <p class="memo">${(record.memo || '').replace(/\n/g, '<br>') || '<span class="hint">メモなし</span>'}</p>
      <div class="form-actions">
        <button id="edit-btn">編集</button>
        <button id="del-btn">削除</button>
      </div>`;
    document.getElementById('edit-btn').onclick = () => showEditForm(record);
    document.getElementById('del-btn').onclick = async () => {
      if (!confirm(`「${record.name}」を削除しますか？`)) return;
      await App.db.remove(record.id);
      clearPanel();
      await reload();
    };
  }
```

- [ ] **Step 2: `showEditForm` を追加（`showDetail` の下に追記）**

```javascript
  function showEditForm(record) {
    panel().innerHTML = `
      <h2>記録を編集</h2>
      <form id="edit-form">
        <label>日付<input type="date" name="date" value="${record.date}" required></label>
        <label>場所名<input type="text" name="name" value="${record.name}" required></label>
        <label>ジャンル<select name="genre">${genreOptions(record.genre)}</select></label>
        <label>メモ・感想<textarea name="memo" rows="4">${record.memo || ''}</textarea></label>
        <label>写真を追加<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="form-actions">
          <button type="submit">更新</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;
    document.getElementById('cancel-btn').onclick = () => showDetail(record);
    document.getElementById('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const newPhotos = Array.from(f.photos.files);
      const updated = {
        id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
        memo: f.memo.value, lat: record.lat, lng: record.lng,
        photos: (record.photos || []).concat(newPhotos), // 既存写真＋追加分
      };
      await App.db.put(updated);
      await reload();
      showDetail(updated);
    };
  }
```

`return { ... }` に `showEditForm` を追加:
```javascript
  return { init, reload, render, getAll, setFilterState,
           showDetail, showEditForm, showAddForm, _clearPanel: clearPanel };
```

- [ ] **Step 3: 写真サムネイルの見た目を `style.css` に追加**

末尾に追記:
```css
.meta { color: #666; font-size: 13px; }
.photos { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.thumb { width: 88px; height: 88px; object-fit: cover; border-radius: 6px; }
.memo { white-space: normal; line-height: 1.6; }
```

- [ ] **Step 4: ブラウザで確認**

1. 写真付きで保存した記録のピンをクリック → 写真サムネイル・ジャンル・日付・メモが表示される。
2. 「編集」→ 場所名やメモを変更し「更新」→ 表示が更新される。
3. 編集フォームで写真を追加 → 既存写真に追加されて表示される。
4. 「削除」→ 確認ダイアログでOK → ピンが消え、リロード後も消えている。

- [ ] **Step 5: コミット**

```bash
git add js/records.js style.css
git commit -m "feat: 閲覧パネル・編集・削除を実装"
```

---

## Task 7: 絞り込みバーと場所名検索

**Files:**
- Modify: `index.html`
- Modify: `js/records.js`
- Modify: `js/app.js`
- Modify: `style.css`

- [ ] **Step 1: `index.html` の `#filter-bar` に絞り込みUIを追加**

`<div id="filter-bar"></div>` を次で置き換え:
```html
    <div id="filter-bar">
      <select id="mode-select">
        <option value="all">全部</option>
        <option value="day">特定の日</option>
        <option value="range">期間</option>
      </select>
      <input type="date" id="day-input" hidden>
      <span id="range-inputs" hidden>
        <input type="date" id="from-input"> 〜 <input type="date" id="to-input">
      </span>
      <span id="genre-filters"><!-- チェックボックスをJSで生成 --></span>
    </div>
```

- [ ] **Step 2: `js/records.js` に絞り込みUI制御を追加**

`js/records.js` の `init` 関数を次で置き換え、その上に `buildGenreFilters` と `readFilterState` を追加:
```javascript
  function buildGenreFilters() {
    const box = document.getElementById('genre-filters');
    box.innerHTML = App.genres.list.map((g) =>
      `<label class="gf"><input type="checkbox" value="${g.key}" checked>
        <span style="color:${g.color}">●</span>${g.label}</label>`
    ).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', applyUiFilter));
  }

  function readFilterState() {
    const mode = document.getElementById('mode-select').value;
    const checked = Array.from(
      document.querySelectorAll('#genre-filters input:checked')).map((c) => c.value);
    // 全ジャンルON = 空Set（＝全表示）として扱う
    const genres = checked.length === App.genres.list.length ? new Set() : new Set(checked);
    return {
      mode,
      day: document.getElementById('day-input').value || null,
      from: document.getElementById('from-input').value || null,
      to: document.getElementById('to-input').value || null,
      genres,
    };
  }

  function applyUiFilter() {
    // mode に応じて日付入力の表示切替
    const mode = document.getElementById('mode-select').value;
    document.getElementById('day-input').hidden = mode !== 'day';
    document.getElementById('range-inputs').hidden = mode !== 'range';
    setFilterState(readFilterState());
  }

  function init() {
    App.map.setClickHandler(showAddForm);
    buildGenreFilters();
    ['mode-select', 'day-input', 'from-input', 'to-input'].forEach((id) =>
      document.getElementById(id).addEventListener('change', applyUiFilter));
    reload();
  }
```

`return { ... }` に `applyUiFilter` を追加:
```javascript
  return { init, reload, render, getAll, setFilterState, applyUiFilter,
           showDetail, showEditForm, showAddForm, _clearPanel: clearPanel };
```

- [ ] **Step 3: 場所名検索を `js/app.js` に配線**

`js/app.js` を次で置き換え:
```javascript
window.App = window.App || {};
document.addEventListener('DOMContentLoaded', () => {
  App.map.init();
  App.records.init();

  const search = document.getElementById('search-box');
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (!q) return;
    const hit = App.records.getAll().find((r) => r.name && r.name.includes(q));
    if (hit) {
      App.map.flyTo(hit.lat, hit.lng);
      App.records.showDetail(hit);
    } else {
      alert('その名前の記録は見つかりませんでした');
    }
  });
});
```

- [ ] **Step 4: 絞り込みバーの見た目を `style.css` に追加**

末尾に追記:
```css
#filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px; }
#filter-bar select, #filter-bar input[type=date] { padding: 4px; border-radius: 4px; border: none; }
.gf { background: #fff2; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
.gf input { vertical-align: middle; }
```

- [ ] **Step 5: ブラウザで確認**

事前に日付やジャンルの異なる記録を3件ほど作成しておく。
1. モードを「特定の日」にする → 日付入力が現れ、選んだ日の記録だけピン表示。
2. モードを「期間」にする → 開始・終了入力が現れ、範囲内のピンだけ表示。
3. モードを「全部」に戻す → 全ピン表示。
4. ジャンルのチェックを外す → そのジャンルのピンが消える。
5. 検索ボックスに登録済みの場所名を入れて Enter → その地点に地図が移動し、詳細が表示。
6. 存在しない名前で Enter → 「見つかりませんでした」のアラート。

- [ ] **Step 6: コミット**

```bash
git add index.html js/records.js js/app.js style.css
git commit -m "feat: 絞り込みバーと場所名検索を実装"
```

---

## Task 8: JSON バックアップ（書き出し / 読み込み）

**Files:**
- Modify: `js/backup.js`
- Modify: `index.html`
- Modify: `js/app.js`

写真Blobは JSON に直接入らないため、書き出し時に dataURL（Base64文字列）へ変換し、読み込み時に Blob へ戻す。

- [ ] **Step 1: `js/backup.js` を実装**

```javascript
window.App = window.App || {};
App.backup = (function () {
  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  async function exportJson() {
    const records = await App.db.getAll();
    const out = [];
    for (const r of records) {
      const photos = [];
      for (const b of (r.photos || [])) photos.push(await blobToDataURL(b));
      out.push({ ...r, photos });
    }
    const blob = new Blob([JSON.stringify({ version: 1, records: out }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `date-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // merge=false なら既存を全消去して置き換え
  async function importJson(file, merge) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.records)) throw new Error('不正なファイル形式');
    if (!merge) await App.db.clear();
    for (const r of data.records) {
      const photos = [];
      for (const d of (r.photos || [])) photos.push(await dataURLToBlob(d));
      const rec = { date: r.date, name: r.name, genre: r.genre,
        lat: r.lat, lng: r.lng, memo: r.memo, photos };
      await App.db.add(rec); // idは再採番（重複回避）
    }
  }

  return { exportJson, importJson };
})();
```

- [ ] **Step 2: `index.html` の `#topbar` にボタンを追加**

`<div id="filter-bar">...</div>` の直後、`</header>` の前に追加:
```html
    <div id="backup-bar">
      <button id="export-btn">書き出し</button>
      <label id="import-label">読み込み<input type="file" id="import-input" accept="application/json" hidden></label>
    </div>
```

- [ ] **Step 3: `js/app.js` にボタンを配線**

`js/app.js` の `DOMContentLoaded` 内、末尾に追加:
```javascript
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());
  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const merge = confirm('OK＝今のデータに追加読み込み / キャンセル＝全消去して置き換え');
    try {
      await App.backup.importJson(file, merge);
      await App.records.reload();
      alert('読み込み完了');
    } catch (err) {
      alert('読み込み失敗: ' + err.message);
    }
    e.target.value = '';
  });
```

- [ ] **Step 4: ボタンの見た目を `style.css` に追加**

末尾に追記:
```css
#backup-bar { display: flex; gap: 6px; }
#backup-bar button, #import-label { background: #fff; color: #d6336c;
  border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
```

- [ ] **Step 5: ブラウザで確認**

1. 記録が数件ある状態で「書き出し」→ `date-records-YYYY-MM-DD.json` がダウンロードされる。
2. 「読み込み」→ そのJSONを選ぶ → 「置き換え」を選択 → 同じピンと写真が復元される。
3. 別ブラウザ or シークレットウィンドウで同じJSONを読み込んでも記録・写真が復元される。

- [ ] **Step 6: コミット**

```bash
git add js/backup.js index.html js/app.js style.css
git commit -m "feat: JSONバックアップの書き出し/読み込みを実装"
```

---

## 完了条件（Definition of Done）
- 地図をクリックして日付・場所名・ジャンル・メモ・写真を保存でき、ピンが色付きで表示される。
- ピンから閲覧・編集・削除ができ、写真がサムネイル表示される。
- 「全部/特定の日/期間」＋ジャンルで絞り込め、場所名検索でその地点に移動できる。
- リロードしてもデータが残る（IndexedDB）。
- JSON で書き出し・読み込みができ、写真も復元される。
