# フェーズ1（クイック記録＋1年前の今日・記念日）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在地から一瞬で記録できる「クイック記録」と、起動時に過去の同月同日／記念日を見せる「思い出カード」を追加し、記録→振り返り→再訪の循環を作る。

**Architecture:** 既存のバニラJS構成（`window.App.*` の IIFE モジュール＋非モジュール `<script>`、ES module は `app.js` 系のみ）を踏襲。純粋ロジックは `_selfTest` 方式（console に PASS/FAIL）でテストし、UI は実機/ブラウザ手動確認。クラウドは `spaces/{id}` に `anniversary` を1項目追加するのみで後方互換。

**Tech Stack:** Vanilla JS, Google Maps/Places JS API (`Place.searchNearby`), Firebase Firestore, Phosphor icons, GitHub Pages。

---

## ファイル構成

- `js/places.js`（変更）: 近傍検索 `nearbyPlaces(lat,lng)` を追加。既存 `_normalizeTextResults` を再利用。
- `js/records.js`（変更）: `showQuickLog(lat,lng)` を追加。`showAddForm` は据え置き。
- `js/memories.js`（新規）: `pickMemories`（純粋）＋ `show/render/dismiss/setAnniversary`。
- `js/space.js`（変更）: `setAnniversary(spaceId,date)` を追加。
- `js/app.js`（変更）: 現在地→`showQuickLog`、初回ロード後に思い出カード、記念日設定ボタン、`sp.anniversary` の受け渡し。
- `index.html`（変更）: 思い出カードの入れ物、記念日ボタン、`memories.js` 読み込み、`?v=` 更新。
- `style.css`（変更）: 思い出カード／クイックカードのスタイル＋追加フォームの余白・ボタン整え。

---

## Task 1: places.nearbyPlaces（近くの店を距離順に取得）

**Files:**
- Modify: `js/places.js`（`searchText` の直後、`return {...}` の前）

近傍検索は `Place.searchNearby` の薄いラッパで、正規化は既存の（テスト済み）`_normalizeTextResults` を再利用する。新しい純粋ロジックは無いため、確認はブラウザ手動。

- [ ] **Step 1: `nearbyPlaces` を追加**

`js/places.js` の `searchText` 関数定義の直後に以下を追加:

```javascript
  // (lat,lng) の近くの店・施設を距離順に取得。正規化は searchText と同型。
  // opts.radius=半径m（既定120）, opts.max=最大件数（既定8）
  async function nearbyPlaces(lat, lng, opts) {
    opts = opts || {};
    const { Place, SearchNearbyRankPreference } =
      await google.maps.importLibrary('places');
    const req = {
      fields: ['id', 'displayName', 'location', 'types'],
      locationRestriction: { center: { lat, lng }, radius: opts.radius || 120 },
      maxResultCount: opts.max || 8,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
      language: 'ja', region: 'JP',
    };
    const { places } = await Place.searchNearby(req);
    return _normalizeTextResults(places); // [{ placeId, name, lat, lng, genre }]
  }
```

- [ ] **Step 2: エクスポートに追加**

`js/places.js` 末尾の `return { ... }` に `nearbyPlaces,` を追加（`searchText,` の隣）:

```javascript
  return { fetchPlace, genreFromTypes, searchPlaces, searchText, nearbyPlaces, newSessionToken,
           _normalizePredictions, _normalizeTextResults, _selfTest, _selfTestText };
```

- [ ] **Step 3: 手動確認（後続タスクで実地確認）**

この関数は Task 5 のクイックカードから使う。単体の確認は Task 5 の実機確認に含める（Google の実 API が必要なため console 単体テストは行わない）。

- [ ] **Step 4: Commit**

```bash
git add js/places.js
git commit -m "feat(places): add nearbyPlaces() for quick-log candidates"
```

---

## Task 2: memories.pickMemories（純粋ロジック＋自己テスト）

**Files:**
- Create: `js/memories.js`

「今日と同じ月日の過去記録」と「記念日一致」を判定する純粋関数を、先にテストから作る。テストは既存コードと同じ `_selfTest`（console PASS/FAIL）方式。

- [ ] **Step 1: 失敗するテストを書く（骨組み＋自己テスト）**

`js/memories.js` を新規作成:

```javascript
window.App = window.App || {};
App.memories = (function () {
  // records=記録配列, today='YYYY-MM-DD', anniversary='YYYY-MM-DD'|null
  // → 記念日一致: { type:'anniversary', years, date }
  //   過去同月同日: { type:'onThisDay', items:[{date,record,yearsAgo}], count }（新しい順）
  //   どちらも無し: null
  function pickMemories(records, today, anniversary) {
    return null; // ← Step 3 で実装
  }

  function _selfTest() {
    const eq = (n, got, want) =>
      console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, got);
    const recs = [
      { id: 1, name: 'A', date: '2025-08-12' },
      { id: 2, name: 'B', date: '2024-08-12' },
      { id: 3, name: 'C', date: '2025-08-11' },
      { id: 4, name: 'D', date: '2027-08-12' }, // 未来は無視
    ];
    const anniv = pickMemories([], '2026-08-12', '2024-08-12');
    eq('anniv-type', anniv && anniv.type, 'anniversary');
    eq('anniv-years', anniv && anniv.years, 2);

    const otd = pickMemories(recs, '2026-08-12', null);
    eq('otd-type', otd && otd.type, 'onThisDay');
    eq('otd-count', otd && otd.count, 2);                 // id1,id2 のみ
    eq('otd-newest-first', otd && otd.items[0].record.id, 1);
    eq('otd-yearsAgo', otd && otd.items[0].yearsAgo, 1);

    eq('none', pickMemories([{ id: 9, date: '2025-08-11' }], '2026-08-12', null), null);
    // 記念日が同年（years=0）は祝わない → onThisDay/null にフォールバック
    eq('anniv-year0', pickMemories([], '2026-08-12', '2026-08-12'), null);
  }

  return { pickMemories, _selfTest };
})();
```

- [ ] **Step 2: テストが失敗することを確認**

`index.html` に読み込む前でも確認できる。ブラウザで `index.html` を開き（ログイン画面のままでOK。非モジュール `<script>` は起動前に読み込まれる）、DevTools コンソールで:

Run: `App.memories._selfTest()`
Expected: `App.memories` は Task 3 まで index に未登録なら `undefined`。まず先に **Task 3 Step 1 の `<script>` 追加を済ませてから**このテストを実行する。実装前は `otd-type` などが `FAIL`（すべて `null` を返すため）になること。

> 補足: このタスク単体でテストを走らせたい場合は、`index.html` の `<script src="js/records.js...">` 群の隣に `<script src="js/memories.js?v=20260812a"></script>` を先に追加してよい（Task 5 でどのみち追加する）。

- [ ] **Step 3: `pickMemories` を実装**

`js/memories.js` の `pickMemories` を置き換え:

```javascript
  function pickMemories(records, today, anniversary) {
    const md = today.slice(5);              // 'MM-DD'
    const ty = Number(today.slice(0, 4));   // 今年
    if (anniversary && anniversary.slice(5) === md) {
      const years = ty - Number(anniversary.slice(0, 4));
      if (years >= 1) return { type: 'anniversary', years, date: anniversary };
    }
    const items = (records || [])
      .filter((r) => r.date && r.date.slice(5) === md && Number(r.date.slice(0, 4)) < ty)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 新しい順
      .map((r) => ({ date: r.date, record: r, yearsAgo: ty - Number(r.date.slice(0, 4)) }));
    if (items.length) return { type: 'onThisDay', items, count: items.length };
    return null;
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run（ブラウザコンソール）: `App.memories._selfTest()`
Expected: 全行が `PASS`。

- [ ] **Step 5: Commit**

```bash
git add js/memories.js
git commit -m "feat(memories): pickMemories() for on-this-day and anniversary"
```

---

## Task 3: 思い出カードの表示（show/render/dismiss）＋入れ物＋スタイル

**Files:**
- Modify: `js/memories.js`（`_selfTest` の前にビュー関数を追加、return に公開）
- Modify: `index.html`（カードの入れ物、`memories.js` 読み込み）
- Modify: `style.css`（カードのスタイル）

- [ ] **Step 1: `index.html` にカードの入れ物と読み込みを追加**

`#layout` 内、`#research-btn` の直後（`<aside id="panel"` の前）に追加:

```html
    <div id="memory-card" hidden></div>
```

`<script src="js/search.js?v=...">` の直前に追加:

```html
  <script src="js/memories.js?v=20260812a"></script>
```

- [ ] **Step 2: `js/memories.js` にビュー関数を追加**

`return { ... }` の直前に以下を追加:

```javascript
  let anniv = null;
  function setAnniversary(date) { anniv = date || null; }

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function dismissedKey(d) { return 'memoryDismissed:' + d; }
  function escName(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dismiss(host, today) {
    try { localStorage.setItem(dismissedKey(today), '1'); } catch (_) { /* noop */ }
    host.hidden = true;
  }

  function render(host, mem, today) {
    if (mem.type === 'anniversary') {
      host.innerHTML = `
        <div class="mem-inner">
          <div class="mem-icon mem-icon-accent"><i class="ph ph-confetti"></i></div>
          <div class="mem-text">
            <div class="mem-label"><i class="ph ph-heart"></i>記念日</div>
            <div class="mem-title">今日で${mem.years}年！</div>
          </div>
          <button type="button" class="mem-x" aria-label="閉じる"><i class="ph ph-x"></i></button>
        </div>`;
      host.hidden = false;
      host.querySelector('.mem-x').onclick = () => dismiss(host, today);
      return;
    }
    const it = mem.items[0]; // 一番新しい過去の年
    const r = it.record;
    const photo = (r.photos || [])[0];
    const thumb = photo
      ? `<div class="mem-icon" style="background-image:url(${photo.url})"></div>`
      : `<div class="mem-icon mem-icon-accent"><i class="ph ph-map-pin"></i></div>`;
    const more = mem.count > 1 ? ` ・ ほか${mem.count - 1}件` : '';
    host.innerHTML = `
      <div class="mem-inner">
        ${thumb}
        <button type="button" class="mem-text mem-open">
          <div class="mem-label"><i class="ph ph-clock-counter-clockwise"></i>${it.yearsAgo}年前の今日</div>
          <div class="mem-title">${escName(r.name) || '(名称未設定)'}</div>
          <div class="mem-sub">${r.date.replace(/-/g, '.')}${more}</div>
        </button>
        <button type="button" class="mem-x" aria-label="閉じる"><i class="ph ph-x"></i></button>
      </div>`;
    host.hidden = false;
    host.querySelector('.mem-open').onclick = () => App.records.focusDay(it.date);
    host.querySelector('.mem-x').onclick = () => dismiss(host, today);
  }

  function show() {
    const host = document.getElementById('memory-card');
    if (!host) return;
    const today = todayStr();
    if (localStorage.getItem(dismissedKey(today))) { host.hidden = true; return; }
    const mem = pickMemories(App.records.getAll(), today, anniv);
    if (!mem) { host.hidden = true; return; }
    render(host, mem, today);
  }
```

`return { pickMemories, _selfTest };` を次に置き換え:

```javascript
  return { pickMemories, setAnniversary, show, _selfTest };
```

- [ ] **Step 3: `style.css` に思い出カードのスタイルを追加**

`/* ===== スマホ最適化 ... */` のブロックより前（例: `#map-loading` 定義の後）に追加:

```css
/* ===== 思い出カード（起動時：過去の同月同日／記念日） ===== */
#memory-card { position: absolute; top: 66px; left: 12px; right: 12px; z-index: 45;
  max-width: 380px; }
#memory-card[hidden] { display: none; }
.mem-inner { display: flex; align-items: center; gap: 11px;
  background: var(--surface); border-radius: 14px; box-shadow: var(--shadow-md);
  padding: 10px; }
.mem-icon { width: 52px; height: 52px; border-radius: 11px; flex: 0 0 auto;
  background-size: cover; background-position: center; }
.mem-icon-accent { background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 22px; }
.mem-text { flex: 1; min-width: 0; text-align: left; background: none; border: none;
  padding: 0; cursor: pointer; }
.mem-label { display: flex; align-items: center; gap: 4px;
  color: var(--accent-strong); font-size: 11px; font-weight: 600; margin-bottom: 2px; }
.mem-title { font-size: 14px; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mem-sub { font-size: 11px; color: var(--text-muted); }
.mem-x { width: 24px; height: 24px; border-radius: 50%; flex: 0 0 auto;
  background: var(--surface-2); color: var(--text-muted); font-size: 13px;
  display: flex; align-items: center; justify-content: center; }
.mem-x:hover { background: var(--border); color: var(--text); }
@media (max-width: 700px) {
  #memory-card { top: 60px; }
}
```

- [ ] **Step 4: 手動確認**

`js/app.js` の配線は Task 4 で行う。この段階では console から手動描画して見た目を確認する。ブラウザでアプリにログインして記録が表示された状態で、コンソールに:

Run:
```javascript
App.memories.setAnniversary(null);
const h = document.getElementById('memory-card');
App.memories.pickMemories(App.records.getAll(), new Date().toISOString().slice(0,10), null);
App.memories.show();
```
Expected: 今日と同月同日の過去記録があればカードが表示され、タップでその日へ移動、×で消える。無ければ `show()` で `memory-card` は hidden のまま（正常）。

- [ ] **Step 5: Commit**

```bash
git add js/memories.js index.html style.css
git commit -m "feat(memories): render on-this-day/anniversary card"
```

---

## Task 4: 起動時に思い出カードを出す＋記念日の受け渡し

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: モジュールスコープに現在スペースと表示済みフラグを追加**

`js/app.js` の `let started = false;` の下に追加:

```javascript
let currentSpace = null;
let memoriesShown = false;
```

- [ ] **Step 2: `startApp` でスペース保持・記念日設定・初回カード表示**

`js/app.js` の `startApp` を次のように変更（`cloud.setSpace(sp.id);` の直後に `currentSpace = sp;`、購読コールバックを差し替え）:

```javascript
async function startApp(sp) {
  cloud.setSpace(sp.id);
  currentSpace = sp;
  showMapLoading();
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});
  if (!started) {
    await App.map.init();
    App.records.init();
    App.sheet.init();
    App.search.init();
    wireUI();
    started = true;
  }
  App.memories.setAnniversary(sp.anniversary || null);
  cloud.subscribe((records) => {
    App.records.setRecords(records);
    hideMapLoading();
    if (!memoriesShown) { memoriesShown = true; App.memories.show(); } // 初回ロード後に一度だけ
  });
}
```

- [ ] **Step 3: 手動確認**

ブラウザでアプリを開く。今日と同月同日の過去記録がある場合、起動直後にヘッダー下へ思い出カードが出ること。×で閉じ、リロードしても当日は再表示されないこと（localStorage 記憶）。別日として試すには DevTools で `localStorage.removeItem('memoryDismissed:' + new Date().toISOString().slice(0,10))` 後にリロード。

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(app): show memory card once after first records load"
```

---

## Task 5: クイック記録（現在地→クイックカード）

**Files:**
- Modify: `js/records.js`（`showAddForm` の直後に `showQuickLog` を追加、return に公開）
- Modify: `js/app.js`（現在地ボタン → `showQuickLog`）
- Modify: `style.css`（クイックカードのスタイル）

- [ ] **Step 1: `js/records.js` に `showQuickLog` を追加**

`showAddForm` 関数の閉じ `}` の直後に追加:

```javascript
  // クイック記録：現在地から一瞬で保存。近くの店を候補表示、写真/メモは後から。
  async function showQuickLog(lat, lng) {
    searchResults = null;
    activeTag = null;
    const today = new Date().toISOString().slice(0, 10);
    const state = { name: '', genre: 'food', candidates: [] };

    function draw() {
      const chips = state.candidates.length
        ? `<div class="ql-cands-label">近くの候補</div>
           <div class="ql-cands">
             ${state.candidates.map((c, i) =>
               `<button type="button" class="ql-chip" data-i="${i}">${esc(c.name)}</button>`).join('')}
             <button type="button" class="ql-chip ql-chip-manual" data-manual="1">手動で入力</button>
           </div>`
        : '';
      panel().innerHTML = `
        <div id="quick-log">
          <h2>今ここを記録</h2>
          <p class="meta">${today} ・ 今日</p>
          <label>場所名<input type="text" id="ql-name" value="${esc(state.name)}" placeholder="お店・施設の名前"></label>
          ${chips}
          <label>ジャンル<select id="ql-genre">${genreOptions(state.genre)}</select></label>
          <div class="form-actions">
            <button type="button" id="ql-save">保存</button>
          </div>
          <button type="button" id="ql-more" class="back-btn ql-more"><i class="ph ph-pencil-simple"></i>詳しく書く</button>
        </div>`;
      const nameInput = document.getElementById('ql-name');
      nameInput.oninput = () => { state.name = nameInput.value; };
      document.getElementById('ql-genre').onchange = (e) => { state.genre = e.target.value; };
      panel().querySelectorAll('.ql-chip').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.manual) { document.getElementById('ql-name').focus(); return; }
          const c = state.candidates[Number(b.dataset.i)];
          state.name = c.name;
          if (c.genre) state.genre = c.genre;
          draw();
        };
      });
      document.getElementById('ql-save').onclick = save;
      document.getElementById('ql-more').onclick = () =>
        showAddForm(lat, lng, { name: state.name, genre: state.genre });
    }

    async function save() {
      const btn = document.getElementById('ql-save');
      btn.disabled = true; btn.textContent = '保存中…';
      const name = state.name.trim();
      const genre = state.genre;
      try {
        const order = all.filter((r) => r.date === today).length;
        const id = await App.cloud.add({
          date: today, name, genre, memo: '', tags: [], order, lat, lng, photos: [],
        });
        showDetail({ id, date: today, name, genre, memo: '', tags: [], order, lat, lng, photos: [] });
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '保存';
      }
    }

    App.map.showTempMarker(lat, lng);
    if (App.sheet) App.sheet.snapTo('half');
    draw(); // まず即描画（候補取得を待たない）

    try {
      const cands = await App.places.nearbyPlaces(lat, lng);
      state.candidates = cands.slice(0, 3);
      if (cands.length && !state.name) {
        state.name = cands[0].name;
        if (cands[0].genre) state.genre = cands[0].genre;
      }
      draw();
    } catch (_) { /* 候補取得失敗は空のまま */ }
  }
```

- [ ] **Step 2: `showQuickLog` を公開**

`js/records.js` 末尾の `return { ... }` の `showAddForm,` の隣に `showQuickLog,` を追加:

```javascript
           showDetail, showEditForm, showAddForm, showQuickLog, showPlaceCard, suggestRecords,
```

- [ ] **Step 3: 現在地ボタンを `showQuickLog` に差し替え**

`js/app.js` の現在地ボタンのハンドラ内、`App.records.showAddForm(latitude, longitude);` を次に変更:

```javascript
        App.records.showQuickLog(latitude, longitude);
```

- [ ] **Step 4: `style.css` にクイックカードのスタイルを追加**

`.mem-x:hover { ... }` の後（思い出カードのブロックの後）に追加:

```css
/* ===== クイック記録カード ===== */
#quick-log .ql-cands-label { font-size: 11px; color: var(--text-muted); margin: 8px 0 6px; }
#quick-log .ql-cands { display: flex; flex-wrap: wrap; gap: 6px; }
#quick-log .ql-chip { border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); border-radius: var(--radius-pill); padding: 6px 12px; font-size: 12px; }
#quick-log .ql-chip:hover { border-color: var(--accent); color: var(--accent-strong); }
#quick-log .ql-chip-manual { background: none; color: var(--text-muted); }
#quick-log .form-actions button#ql-save { background: var(--accent); color: #fff; }
#quick-log .form-actions button#ql-save:hover { background: var(--accent-strong); }
#quick-log .ql-more { display: inline-flex; margin-top: 12px; }
```

- [ ] **Step 5: 手動確認**

実機（スマホ）またはブラウザでアプリを開き、現在地ボタンを押す。位置許可後、近くの店が候補に出て、店名が自動で入ること／候補チップで差し替えできること／`保存` で即保存され詳細が開くこと／`詳しく書く` でフルフォームに引き継がれることを確認。候補が取れない場所でも空店名のまま保存できることを確認。

- [ ] **Step 6: Commit**

```bash
git add js/records.js js/app.js style.css
git commit -m "feat(records): quick-log card from current location"
```

---

## Task 6: 記念日の設定（保存＋設定ボタン）

**Files:**
- Modify: `js/space.js`（`setAnniversary` 追加）
- Modify: `index.html`（記念日ボタン）
- Modify: `js/app.js`（ボタン配線）

- [ ] **Step 1: `js/space.js` に `setAnniversary` を追加**

`touchLastSeen` 関数の直後に追加:

```javascript
  // スペースの記念日（YYYY-MM-DD、空文字で解除）を保存
  async function setAnniversary(spaceId, date) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { anniversary: date || '' });
  }
```

`js/space.js` の `return { ... }` に `setAnniversary,` を追加:

```javascript
  return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace,
           touchLastSeen, setAnniversary, _selfTest };
```

- [ ] **Step 2: `index.html` に記念日ボタンを追加**

`#backup-bar` 内、`show-invite-btn` の直後に追加:

```html
      <button id="anniv-btn"><i class="ph ph-heart"></i><span>記念日</span></button>
```

- [ ] **Step 3: `js/app.js` に記念日ボタンの配線を追加**

`wireUI` 内、招待コード再表示（`show-invite-btn` のハンドラ）の直後に追加:

```javascript
  document.getElementById('anniv-btn').addEventListener('click', async () => {
    const cur = (currentSpace && currentSpace.anniversary) || '';
    const input = prompt('記念日を入力（YYYY-MM-DD）。空にすると解除します。', cur);
    if (input == null) return;
    const v = input.trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { alert('YYYY-MM-DD の形式で入力してください'); return; }
    try {
      await space.setAnniversary(currentSpace.id, v);
      currentSpace.anniversary = v || null;
      App.memories.setAnniversary(currentSpace.anniversary);
      alert(v ? '記念日を保存しました' : '記念日を解除しました');
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    }
  });
```

- [ ] **Step 4: 手動確認**

絞り込みパネルを開き `記念日` を押す → 日付入力 → 保存。記念日を今日の日付に設定してリロード（＋ `localStorage.removeItem('memoryDismissed:'+new Date().toISOString().slice(0,10))`）すると「今日で◯年！」カードが出ること。空にして解除できること。

- [ ] **Step 5: Commit**

```bash
git add js/space.js index.html js/app.js
git commit -m "feat(space): anniversary setting drives celebration card"
```

---

## Task 7: デザイン洗練（追加フォーム）＋キャッシュバスト＋総合確認

**Files:**
- Modify: `style.css`（追加/クイックフォームの余白・主ボタン強調）
- Modify: `index.html`（全アセットの `?v=` を更新）

- [ ] **Step 1: 追加フォームの余白・主ボタンを整える**

`style.css` の `.form-actions button[type=submit] { ... }` の後に追加（保存を主役に、副ボタンを控えめに）:

```css
/* 追加/クイック：主ボタンを主役に、副操作は控えめ */
#rec-form .form-actions, #quick-log .form-actions { margin-top: 18px; }
#rec-form label, #quick-log label { margin-top: 14px; }
```

- [ ] **Step 2: `index.html` の `?v=` を一括更新**

`index.html` 内の `?v=20260811c`（style.css と js 各種）と Task 3 で入れた `memories.js?v=20260812a` を、すべて `?v=20260812a` に揃える。対象:
`style.css`, `js/genres.js`, `js/filters.js`, `js/map.js`, `js/places.js`, `js/records.js`, `js/lightbox.js`, `js/sheet.js`, `js/calendar.js`, `js/backup.js`, `js/search.js`, `js/memories.js`, `js/app.js`。

- [ ] **Step 3: 総合確認（実機）**

以下を通しで確認:
1. 現在地 → クイックカード → 候補選択 → 保存 → 詳細 → 編集で写真追記。
2. 候補が取れない場所で空店名のまま保存できる。
3. 地図長押し → 従来のフルフォームが出る（挙動が変わっていない）。
4. 今日と同月同日の過去記録を用意 → 起動時に思い出カード → タップでその日 → × で当日非表示。
5. 記念日を今日に設定 → リロードで「◯年！」カード。
6. カレンダー・検索・絞り込みが従来どおり動く（回帰なし）。
7. `App.memories._selfTest()` と `App.places._selfTestText()` が全 PASS。

- [ ] **Step 4: Commit**

```bash
git add style.css index.html
git commit -m "chore: refine add form + cache-bust assets (?v=20260812a)"
```

- [ ] **Step 5: 本番反映**

```bash
git push
```
GitHub Pages に反映。スマホで開き、Step 3 の1〜6を実機再確認。

---

## セルフレビュー結果

- **仕様カバレッジ:** 1-A（Task 5＋Task 1）/ 1-B 過去同月同日（Task 2,3,4）/ 記念日（Task 2,3,6）/ デザイン洗練（Task 5,7）/ キャッシュバスト（Task 7）— すべて対応タスクあり。
- **記念日の粒度:** 仕様どおり「毎年◯周年」のみで開始（`◯ヶ月記念` は未実装、後日判断）。
- **型の一貫性:** `nearbyPlaces` は `_normalizeTextResults` と同じ `{placeId,name,lat,lng,genre}`。`pickMemories` の返り型は Task 3 の `render` が参照する `type/years/items/count/yearsAgo/record/date` と一致。`showQuickLog` は既存 `cloud.add` / `showDetail` / `showAddForm` / `genreOptions` / `esc` / `all` / `panel()` と同一シグネチャを使用。
- **後方互換:** クラウドは `spaces.anniversary` 追加のみ。既存記録スキーマ不変。
