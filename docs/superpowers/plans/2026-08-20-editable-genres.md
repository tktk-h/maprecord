# 編集可能なジャンル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ジャンル（ピンの種類・色）を、ふたりで自由に追加・編集・削除・並べ替えできるようにする（保存先は space、既存記録は壊さない）。

**Architecture:** `App.genres` を動的化（`setList` で中身をその場置換）し、起動時に `spaces/{id}.genres` を流し込む。編集UIは新モジュール `js/genre-edit.js`（`App.genreEdit`）に分離、保存は `App.space.setGenres`。既存の参照箇所（フォーム/フィルタ/地図/ふりかえり）は描画時に `App.genres` を読むので無変更。

**Tech Stack:** バニラJS（非ESMの `window.App` グローバル）、Firestore（既存 `updateDoc`）、`<input type="color">`。ビルド無し。純粋関数は `_selfTest()` を Node 実行。

**参照:** 仕様 `docs/superpowers/specs/2026-08-20-editable-genres-design.md`。

**版運用:** 実装完了後に `index.html` 内の現行版 `20260819v` を **`20260819w`** へ全置換（Task 8）。途中コミットでは版を上げない。

---

## File Structure

- **Modify `js/genres.js`** — `DEFAULTS` 定数化＋`setList(arr)`＋`_selfTest`。resolver（`color`/`label`）は現状維持。オブジェクトリテラルからIIFEに変更（`list`/`color`/`label`/`setList` を公開）。
- **Modify `js/space.js`** — `setGenres(spaceId, genres)` 追加。
- **Modify `js/records.js`** — `refreshGenres()`（フィルタチップ再生成＋再描画）追加・公開。
- **Create `js/genre-edit.js`** — `App.genreEdit`：純粋ロジック（`validate`/`usageCount`/`newKey`/`normalize`/`_selfTest`）＋編集UI（`open`/`setSpaceId`）。トップレベルで `document` に触れない。
- **Modify `index.html`** — 設定メニューに `#genre-btn`、オーバーレイ `#genre-editor`、`?v=` 付き `<script src="js/genre-edit.js">`。
- **Modify `js/app.js`** — `startApp` で `App.genres.setList(sp.genres)`＋`App.genreEdit.setSpaceId(sp.id)`、`wireUI` で `#genre-btn` 配線。
- **Modify `style.css`** — `#genre-editor` と行UIのスタイル。

---

## Task 1: `js/genres.js` を動的化（setList）＋テスト

**Files:**
- Modify: `js/genres.js`（全面書き換え）
- Test: Node ワンライナー

- [ ] **Step 1: `js/genres.js` を以下で全面置換**

```js
window.App = window.App || {};
App.genres = (function () {
  // key はデータ保存に使う不変ID、label は画面表示、color はピン色。
  var DEFAULTS = [
    { key: 'food',      label: 'ごはん',   color: '#c2703f' },
    { key: 'cafe',      label: 'カフェ',   color: '#a07850' },
    { key: 'facility',  label: '施設',     color: '#6b8299' },
    { key: 'sightsee',  label: '観光',     color: '#7a9471' },
    { key: 'shopping',  label: '買い物',   color: '#9a7099' },
    { key: 'other',     label: 'その他',   color: '#928b80' },
  ];
  function clone(arr) {
    return arr.map(function (g) { return { key: g.key, label: g.label, color: g.color }; });
  }
  var list = clone(DEFAULTS); // 現在有効なジャンル（消費者はこの配列を描画時に読む）
  function color(key) { var g = list.find(function (x) { return x.key === key; }); return g ? g.color : '#868e96'; }
  function label(key) { var g = list.find(function (x) { return x.key === key; }); return g ? g.label : 'その他'; }
  // arr が非空配列ならその内容で list を「その場置換」（参照を保持している消費者にも反映）。falsy/空なら DEFAULTS。
  function setList(arr) {
    var next = (arr && arr.length) ? clone(arr) : clone(DEFAULTS);
    list.length = 0;
    next.forEach(function (g) { list.push(g); });
  }
  function _selfTest() {
    var fails = 0;
    function eq(n, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    }
    eq('default-color-food', color('food'), '#c2703f');
    eq('default-label-cafe', label('cafe'), 'カフェ');
    eq('unknown-color', color('zzz'), '#868e96');
    eq('unknown-label', label('zzz'), 'その他');
    var ref = list;
    setList([{ key: 'x', label: 'エックス', color: '#123456' }]);
    eq('setList-len', list.length, 1);
    eq('setList-color', color('x'), '#123456');
    eq('same-ref', list === ref, true);            // その場置換で参照維持
    setList(null);                                  // 空→DEFAULTS
    eq('reset-len', list.length, 6);
    eq('reset-color', color('food'), '#c2703f');
    setList([]);                                    // 空配列→DEFAULTS
    eq('empty-reset-len', list.length, 6);
    console.log(fails === 0 ? '✅ genres ALL PASS' : ('❌ genres ' + fails + ' FAIL'));
    return fails;
  }
  return { list: list, DEFAULTS: DEFAULTS, color: color, label: label, setList: setList, _selfTest: _selfTest };
})();
```

- [ ] **Step 2: Node でテスト実行**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/genres.js');process.exit(global.App.genres._selfTest())"
```
Expected: 全 PASS、`✅ genres ALL PASS`、終了コード0。

- [ ] **Step 3: 既存消費者が壊れていないか静的確認**

Run:
```bash
grep -rnE "App\.genres\.(list|color|label)" js/ | grep -v "js/genres.js" | wc -l
```
Expected: 20 前後（数値は参考）。`App.genres.list`/`color`/`label` の呼び出し形は変えていないので互換。

- [ ] **Step 4: Commit**

```bash
git add js/genres.js
git commit -m "feat(genres): dynamic genre list with setList (defaults preserved)"
```

---

## Task 2: `js/space.js` に `setGenres` を追加

**Files:**
- Modify: `js/space.js`

- [ ] **Step 1: `setAnniversary` の直後に `setGenres` を追加**

`js/space.js` の次の関数：
```js
  async function setAnniversary(spaceId, date) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { anniversary: date || '' });
  }
```
の直後に追加：
```js
  async function setGenres(spaceId, genres) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { genres: genres || [] });
  }
```

- [ ] **Step 2: 返り値に `setGenres` を公開**

`return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace, touchLastSeen, setAnniversary, _selfTest };` を次に変更：
```js
  return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace,
           touchLastSeen, setAnniversary, setGenres, _selfTest };
```

- [ ] **Step 3: 構文確認**

Run:
```bash
node --input-type=module -e "process.stdout.write('ok')" && node --check js/space.js 2>/dev/null || echo "(ESM import 由来の --check 警告は無視可。編集はupdateDoc 1行追加のみ＝差分を目視で確認)"
```
（`js/space.js` は ESM。`--check` が import で警告しても、追加は `setGenres` 関数1つと return への1語追加なので diff を目視で確認する。）

- [ ] **Step 4: Commit**

```bash
git add js/space.js
git commit -m "feat(space): setGenres persists custom genres to space doc"
```

---

## Task 3: `js/records.js` に `refreshGenres` を追加・公開

**Files:**
- Modify: `js/records.js`

ジャンル保存後、開いているビューへ即反映するためのフック。`buildGenreFilters()`（フィルタチップ再生成）と `applyUiFilter()`（現在の絞り込みで再描画＝地図ピンも `App.genres.color` を読み直す）は既に records 内にある。

- [ ] **Step 1: `refreshGenres` 関数を追加**

`js/records.js` の `function applyUiFilter() { ... }` 定義の直後に追加：
```js
  // ジャンル編集の保存後に呼ぶ：フィルタチップを作り直し、現在の絞り込みで再描画（ピン色も更新）。
  function refreshGenres() { buildGenreFilters(); applyUiFilter(); }
```

- [ ] **Step 2: 公開（return に追加）**

`js/records.js` の末尾 return：
```js
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showQuickLog, showPlaceCard, suggestRecords,
           _clearPanel: clearPanel, _selfTest };
```
を次に変更（`refreshGenres` を追加）：
```js
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           refreshGenres,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showQuickLog, showPlaceCard, suggestRecords,
           _clearPanel: clearPanel, _selfTest };
```

- [ ] **Step 3: 構文確認**

Run:
```bash
node --check js/records.js 2>&1 | head -3 || echo "(構文エラーが無ければ出力なし)"
```
Expected: 出力なし（構文OK）。※`App` 未定義エラーは出ない（`--check` は実行しない）。

- [ ] **Step 4: Commit**

```bash
git add js/records.js
git commit -m "feat(records): refreshGenres hook to rebuild filters + repaint after genre edit"
```

---

## Task 4: `js/genre-edit.js` 純粋ロジック＋テスト

**Files:**
- Create: `js/genre-edit.js`
- Test: Node ワンライナー

- [ ] **Step 1: `js/genre-edit.js` を新規作成（純粋ロジック部分のみ。DOMは Task 5 で追加）**

```js
window.App = window.App || {};
App.genreEdit = (function () {
  var HEX = /^#[0-9a-fA-F]{6}$/;

  // rows: [{key,label,color}] を検証。{ ok, error } を返す。
  function validate(rows) {
    if (!rows || rows.length < 1) return { ok: false, error: '種類は最低1つ必要です' };
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].label || !String(rows[i].label).trim()) return { ok: false, error: '名前が空の種類があります' };
      if (!HEX.test(rows[i].color)) return { ok: false, error: '色の形式が正しくありません' };
    }
    return { ok: true, error: '' };
  }

  // records のうち genre===key の件数（削除可否＝使用中判定に使う）。
  function usageCount(records, key) {
    var n = 0;
    (records || []).forEach(function (r) { if (r && r.genre === key) n++; });
    return n;
  }

  // existingKeys と衝突しない新規キー。
  function newKey(existingKeys) {
    var used = {};
    (existingKeys || []).forEach(function (k) { used[k] = true; });
    var k;
    do { k = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 90 + 10); } while (used[k]);
    return k;
  }

  // 保存用に {key,label,color} だけへ整形（label は trim）。
  function normalize(rows) {
    return (rows || []).map(function (r) { return { key: r.key, label: String(r.label).trim(), color: r.color }; });
  }

  function _selfTest() {
    var fails = 0;
    function eq(n, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    }
    eq('valid-ok', validate([{ key: 'a', label: 'A', color: '#123456' }]).ok, true);
    eq('valid-empty-list', validate([]).ok, false);
    eq('valid-blank-label', validate([{ key: 'a', label: '  ', color: '#123456' }]).ok, false);
    eq('valid-bad-color', validate([{ key: 'a', label: 'A', color: 'red' }]).ok, false);
    eq('usage', usageCount([{ genre: 'a' }, { genre: 'b' }, { genre: 'a' }], 'a'), 2);
    eq('usage-zero', usageCount([{ genre: 'b' }], 'a'), 0);
    var k = newKey(['x', 'y']);
    eq('newkey-type', typeof k, 'string');
    eq('newkey-nodup', (k !== 'x' && k !== 'y'), true);
    eq('normalize', normalize([{ key: 'a', label: ' A ', color: '#111111', extra: 9 }]), [{ key: 'a', label: 'A', color: '#111111' }]);
    console.log(fails === 0 ? '✅ genreEdit ALL PASS' : ('❌ genreEdit ' + fails + ' FAIL'));
    return fails;
  }

  return { validate: validate, usageCount: usageCount, newKey: newKey, normalize: normalize, _selfTest: _selfTest };
})();
```

- [ ] **Step 2: Node でテスト実行**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/genre-edit.js');process.exit(global.App.genreEdit._selfTest())"
```
Expected: 全 PASS、`✅ genreEdit ALL PASS`、終了コード0。

- [ ] **Step 3: Commit**

```bash
git add js/genre-edit.js
git commit -m "feat(genre-edit): pure validate/usageCount/newKey/normalize + tests"
```

---

## Task 5: `js/genre-edit.js` 編集UI（open/setSpaceId）

**Files:**
- Modify: `js/genre-edit.js`（DOM描画・保存を追加、公開に `open`/`setSpaceId` を足す）

DOM は関数内のみで触る（トップレベルは触らない＝Nodeロード可を維持）。`App.records.getAll`/`App.space.setGenres`/`App.genres.setList`/`App.records.refreshGenres` を実行時に使う。

- [ ] **Step 1: 純粋ロジックの直後（`_selfTest` の後、`return` の前）にUIコードを追加**

`js/genre-edit.js` の `function _selfTest() { ... }` の閉じ `}` と `return { ... }` の間に、以下を挿入：
```js
  var spaceId = null;
  function setSpaceId(id) { spaceId = id || null; }
  var PALETTE = ['#c2703f', '#a07850', '#6b8299', '#7a9471', '#9a7099', '#928b80', '#b76e64', '#8f9e6a'];
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function open() {
    var host = el('genre-editor');
    if (!host) return;
    var rows = App.genres.list.map(function (g) { return { key: g.key, label: g.label, color: g.color }; }); // 作業用コピー
    var records = (App.records && App.records.getAll) ? App.records.getAll() : [];

    function close() { host.hidden = true; host.innerHTML = ''; }
    function showErr(msg) { var e = host.querySelector('.ge-err'); if (e) { e.textContent = msg; e.hidden = false; } }
    function save() {
      var v = App.genreEdit.validate(rows);
      if (!v.ok) { showErr(v.error); return; }
      var list = App.genreEdit.normalize(rows);
      var saveBtn = host.querySelector('.ge-save');
      if (saveBtn) saveBtn.disabled = true;
      Promise.resolve(App.space.setGenres(spaceId, list)).then(function () {
        App.genres.setList(list);
        if (App.records && App.records.refreshGenres) App.records.refreshGenres();
        close();
      }).catch(function (e) {
        if (saveBtn) saveBtn.disabled = false;
        showErr('保存に失敗しました: ' + ((e && e.message) || ''));
      });
    }

    function render() {
      host.innerHTML =
        '<div class="ge-panel">' +
        '<div class="ge-head"><div class="ge-title">ジャンル編集</div>' +
        '<button class="ge-x" aria-label="閉じる"><i class="ph ph-x"></i></button></div>' +
        '<div class="ge-rows"></div>' +
        '<button class="ge-add" type="button"><i class="ph ph-plus"></i> 種類を追加</button>' +
        '<div class="ge-err" hidden></div>' +
        '<div class="ge-actions"><button class="ge-cancel" type="button">キャンセル</button>' +
        '<button class="ge-save" type="button">保存</button></div>' +
        '</div>';
      var rowsBox = host.querySelector('.ge-rows');
      rows.forEach(function (row, i) {
        var used = App.genreEdit.usageCount(records, row.key);
        var safeColor = /^#[0-9a-fA-F]{6}$/.test(row.color) ? row.color : '#928b80';
        var r = document.createElement('div');
        r.className = 'ge-row';
        r.innerHTML =
          '<input type="color" class="ge-color" value="' + safeColor + '">' +
          '<input type="text" class="ge-label" value="' + esc(row.label) + '" placeholder="名前" maxlength="12">' +
          '<button type="button" class="ge-up" ' + (i === 0 ? 'disabled' : '') + ' aria-label="上へ"><i class="ph ph-caret-up"></i></button>' +
          '<button type="button" class="ge-down" ' + (i === rows.length - 1 ? 'disabled' : '') + ' aria-label="下へ"><i class="ph ph-caret-down"></i></button>' +
          '<button type="button" class="ge-del" ' + (used > 0 ? 'disabled' : '') + ' aria-label="削除">' +
          (used > 0 ? ('<span class="ge-used">' + used + '件</span>') : '<i class="ph ph-trash"></i>') + '</button>';
        r.querySelector('.ge-color').oninput = function () { row.color = this.value; };
        r.querySelector('.ge-label').oninput = function () { row.label = this.value; };
        r.querySelector('.ge-up').onclick = function () { if (i > 0) { var t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; render(); } };
        r.querySelector('.ge-down').onclick = function () { if (i < rows.length - 1) { var t = rows[i + 1]; rows[i + 1] = rows[i]; rows[i] = t; render(); } };
        if (used === 0) { r.querySelector('.ge-del').onclick = function () { rows.splice(i, 1); render(); }; }
        rowsBox.appendChild(r);
      });
      host.querySelector('.ge-add').onclick = function () {
        var keys = rows.map(function (x) { return x.key; });
        rows.push({ key: App.genreEdit.newKey(keys), label: '', color: PALETTE[rows.length % PALETTE.length] });
        render();
      };
      host.querySelector('.ge-x').onclick = close;
      host.querySelector('.ge-cancel').onclick = close;
      host.querySelector('.ge-save').onclick = save;
    }

    render();
    host.hidden = false;
  }
```

- [ ] **Step 2: 公開に `open`/`setSpaceId` を追加**

`return { validate: validate, usageCount: usageCount, newKey: newKey, normalize: normalize, _selfTest: _selfTest };` を次に変更：
```js
  return { validate: validate, usageCount: usageCount, newKey: newKey, normalize: normalize,
    open: open, setSpaceId: setSpaceId, _selfTest: _selfTest };
```

- [ ] **Step 3: モジュールが読め、純粋テストが通ることを確認（DOMは触らない）**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/genre-edit.js');console.log('keys:',Object.keys(global.App.genreEdit).join(','));process.exit(global.App.genreEdit._selfTest())"
```
Expected: `keys: validate,usageCount,newKey,normalize,open,setSpaceId,_selfTest`、全 PASS、終了コード0。

- [ ] **Step 4: Commit**

```bash
git add js/genre-edit.js
git commit -m "feat(genre-edit): editor overlay (add/edit/reorder/delete-guard/save)"
```

---

## Task 6: `index.html` 導線＋`js/app.js` 配線

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

- [ ] **Step 1: 設定メニューに「ジャンル編集」ボタンを追加**

`index.html` の `#backup-bar` 内、`review-btn` の直後に追加。次を探す：
```html
          <button id="review-btn"><i class="ph ph-sparkle"></i><span>ふりかえり</span></button>
```
を次に変更：
```html
          <button id="review-btn"><i class="ph ph-sparkle"></i><span>ふりかえり</span></button>
          <button id="genre-btn"><i class="ph ph-tag"></i><span>ジャンル編集</span></button>
```

- [ ] **Step 2: オーバーレイを追加**

`index.html` の `<div id="review-page" class="review-overlay" hidden></div>` の直後に追加：
```html
    <div id="review-page" class="review-overlay" hidden></div>
    <div id="genre-editor" hidden></div>
```

- [ ] **Step 3: スクリプトを追加**

`<script src="js/review-ui.js?v=20260819v"></script>` の直後に追加（版は現行 `20260819v` のまま。Task 8 で一括バンプ）：
```html
  <script src="js/review-ui.js?v=20260819v"></script>
  <script src="js/genre-edit.js?v=20260819v"></script>
```

- [ ] **Step 4: `js/app.js` の `startApp` で genres を流し込み、spaceId を渡す**

`js/app.js` の次の行（`App.review.setAnniversary(...)` の並び）：
```js
  App.review.setAnniversary(sp.anniversary || null);
```
の直後に追加：
```js
  App.genres.setList(sp.genres || null);
  App.genreEdit.setSpaceId(sp.id);
```

- [ ] **Step 5: `js/app.js` の `wireUI` で `#genre-btn` を配線**

`review-btn` のハンドラ：
```js
  document.getElementById('review-btn').addEventListener('click', () => {
    document.getElementById('topbar').classList.remove('filters-open'); // メニューを閉じる
    App.review.showPicker();
  });
```
の直後に追加：
```js
  document.getElementById('genre-btn').addEventListener('click', () => {
    document.getElementById('topbar').classList.remove('filters-open'); // メニューを閉じる
    App.genreEdit.open();
  });
```

- [ ] **Step 6: 確認**

Run:
```bash
grep -nE "genre-btn|genre-editor|genre-edit.js" index.html
node --check js/app.js && echo "app.js OK"
```
Expected: ボタン/オーバーレイ/スクリプトの3行が出る。`app.js OK`。

- [ ] **Step 7: Commit**

```bash
git add index.html js/app.js
git commit -m "feat(genre-edit): menu entry, overlay, script, and app wiring"
```

---

## Task 7: `style.css` に編集画面スタイル

**Files:**
- Modify: `style.css`

- [ ] **Step 1: `style.css` の末尾に追記**

```css
/* ===== ジャンル編集 ===== */
#genre-editor { position: fixed; inset: 0; z-index: 62; overflow: auto;
  background: rgba(45, 38, 30, .35); display: flex; align-items: flex-start; justify-content: center; padding: 24px 12px; }
#genre-editor[hidden] { display: none; }
.ge-panel { width: 100%; max-width: 460px; background: var(--bg); border-radius: 16px;
  box-shadow: var(--shadow-lg); padding: 16px; }
.ge-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ge-title { font-size: 17px; font-weight: 800; font-family: var(--font-display); color: var(--text); }
.ge-x { background: var(--surface-2); color: var(--text-muted); border: none; border-radius: 50%;
  width: 32px; height: 32px; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.ge-rows { display: flex; flex-direction: column; gap: 8px; }
.ge-row { display: flex; align-items: center; gap: 8px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; padding: 8px; }
.ge-color { width: 34px; height: 34px; padding: 0; border: 1px solid var(--border); border-radius: 8px;
  background: none; cursor: pointer; flex: 0 0 auto; }
.ge-label { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 10px; font-size: 15px; color: var(--text); background: var(--bg); font-family: inherit; }
.ge-up, .ge-down, .ge-del { flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface); color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 14px; }
.ge-up:disabled, .ge-down:disabled, .ge-del:disabled { opacity: .4; cursor: default; }
.ge-del { color: var(--accent-strong); }
.ge-used { font-size: 10px; line-height: 1.1; color: var(--text-muted); }
.ge-add { margin-top: 10px; width: 100%; border: 1px dashed var(--border); background: var(--surface);
  color: var(--accent-strong); border-radius: 12px; padding: 10px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px; }
.ge-err { margin-top: 10px; color: #c0392b; font-size: 13px; }
.ge-actions { display: flex; gap: 10px; margin-top: 14px; }
.ge-cancel { flex: 1; border: 1px solid var(--border); background: none; color: var(--text);
  border-radius: var(--radius-pill); padding: 10px; font-weight: 700; cursor: pointer; }
.ge-save { flex: 1; border: none; background: var(--cta-grad); color: #fff;
  border-radius: var(--radius-pill); padding: 10px; font-weight: 700; cursor: pointer; box-shadow: var(--cta-shadow); }
.ge-save:disabled { opacity: .6; cursor: default; }
```

- [ ] **Step 2: ブラウザで確認（地図非依存＝プレビュー可）**

ローカルで配信し（例：リポ直下に簡易静的サーバを立てて `index.html` を開く、またはハーネス）、メニュー→「ジャンル編集」でオーバーレイが出ることを目視。行の色ピッカー・名前入力・↑↓・追加・保存/キャンセルの見た目、崩れが無いか、スマホ幅でも確認。※実データ保存には Firestore ログインが要るため、UIの見た目確認まで。

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "style(genre-edit): editor overlay and row UI"
```

---

## Task 8: 版上げ・最終確認・デプロイ

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 版を全置換**

`index.html` 内の `20260819v` をすべて `20260819w` に置換（`.app-ver`・全 `?v=`・`sw.js?v=`・新 `genre-edit.js?v=` を含む）。

Run:
```bash
grep -c "20260819v" index.html; grep -c "20260819w" index.html
```
Expected: 前者 `0`、後者 `1以上`（従来＋新規1本）。

- [ ] **Step 2: 全純粋テストを最終実行**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/genres.js');process.exit(global.App.genres._selfTest())"
node -e "global.window={};global.App=global.window.App={};require('./js/genre-edit.js');process.exit(global.App.genreEdit._selfTest())"
```
Expected: 両方とも全 PASS・終了コード0。

- [ ] **Step 3: Commit ＆ push（デプロイ）**

```bash
git add index.html
git commit -m "chore(genres): bump version to 20260819w for editable-genres release"
git push
```
push → GitHub Pages 反映（[[maprecord-deploy]]）。

- [ ] **Step 4: 実機/実Chromeでの最終確認（チェックリスト）**

- [ ] メニュー →「ジャンル編集」で画面が出る。
- [ ] 名前の変更・色の変更が、保存後に記録フォームのチップ／絞り込みチップ／地図ピン色／ふりかえりのジャンル内訳に反映される。
- [ ] 「＋種類を追加」で新ジャンルを足せる。新ジャンルで記録を作れる（フォームのチップに出る）。
- [ ] 使用中のジャンルは削除ボタンが無効＋「◯件」表示。未使用（新規追加直後）は削除できる。
- [ ] ↑↓で並べ替えでき、保存後に順序が反映される。
- [ ] 名前空・0個で保存すると赤字案内が出て閉じない。
- [ ] パートナー端末では開き直しで反映される。
- [ ] 左下 ver が `20260819w`。

- [ ] **Step 5: 返信末尾に本番 ver（`20260819w`）を記載**（[[maprecord-report-version]]）

---

## Self-Review（この計画の点検結果）

**1. Spec coverage:**
- 完全自由（追加/編集/削除/並べ替え）: Task 5（open/render の行UI）✓
- 使用中は削除不可: `usageCount`＋行UIの `disabled`＋「◯件」 Task 4/5 ✓
- 開き直し同期: Task 6（startApp で setList）✓、リアルタイム購読なし ✓
- データモデル `spaces/{id}.genres`・key不変・新規キー生成: Task 2（setGenres）/Task 4（newKey）/Task 5（既存keyは保持しコピー）✓
- `App.genres` 動的化（setList・その場置換）: Task 1 ✓
- 保存後の再描画フック: Task 3（refreshGenres）＋ Task 5（save が呼ぶ）✓
- 色は `<input type=color>`／並べ替え↑↓／アイコンなし: Task 5 ✓
- テスト（genres／genre-edit の _selfTest）: Task 1/4 ✓
- 版上げ・返信ver: Task 8 ✓

**2. Placeholder scan:** 各タスクに完全なコードを掲載。UIタスク（5・7）はプレビュー目視の手順を明記（本リポは純粋関数のみ _selfTest、UIは目視の方針に準拠）。TBD/TODO 無し。

**3. Type consistency:**
- 公開名: `App.genres.setList/list/color/label/DEFAULTS`、`App.space.setGenres`、`App.records.refreshGenres`、`App.genreEdit.open/setSpaceId/validate/usageCount/newKey/normalize` を全タスクで一貫使用。
- 行データ形状 `{key,label,color}` を Task4/5 で統一。`validate/normalize` の入出力一致。
- 既存API `App.records.getAll`、`buildGenreFilters`/`applyUiFilter`（records内・私有）、`updateDoc(spaces/{id},{...})` を実コードで確認済み。
