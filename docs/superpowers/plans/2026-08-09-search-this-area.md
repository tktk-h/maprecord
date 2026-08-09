# 「このエリアを再検索」ボタン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 場所検索のピンが出ている状態で地図をドラッグすると上部中央に「このエリアを再検索」ボタンを出し、タップで直前の検索語を現在の表示範囲で再検索する。

**Architecture:** `App.map` に `dragend`（ユーザー操作のみ）フックを追加。`App.search` が直前の検索語 `lastPlaceQuery` を保持し、パン時にボタン表示、タップで `runPlaceSearch(lastPlaceQuery)` を再実行。純粋な配線のみでモックハーネス検証。

**Tech Stack:** バニラ JS（`window.App.*` IIFE）、Google Maps JS API（`dragend`）、モックハーネス、`node --check`。

参照 spec: `docs/superpowers/specs/2026-08-09-search-this-area-design.md`

---

## テスト前提（共通）

- 構文: `node --check js/<file>.js`（`python` は壊れているので node）。
- 統合: 一時ハーネス（Task 4、最後に削除）をローカル HTTP で開き `window.__run()` を実行し `PASS` を確認。google 依存はモック。
- 実 `dragend` の発火はデプロイ後に実機確認。

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/map.js` | `setUserPanHandler`（dragend 配線） | Modify |
| `index.html` | `#research-btn` 要素 | Modify |
| `style.css` | `#research-btn` スタイル | Modify |
| `js/search.js` | `lastPlaceQuery` ＋ ボタン制御・配線 | Modify |

---

## Task 1: map.js — ユーザーのパン検知

**Files:** Modify `js/map.js`

- [ ] **Step 1: 実装を追加**

`js/map.js` の IIFE 内、他の `onXxx` ハンドラ変数（`onMapClick` など）の近くに追加:
```js
  let onUserPan = null;         // ユーザーが地図をドラッグしたとき
```

`init()` 内の `map.addListener('idle', saveView);` の直後に追加:
```js
    map.addListener('dragend', () => { if (onUserPan) onUserPan(); }); // ユーザー操作のみ（flyTo/fitTo では発火しない）
```

`setClickHandler` などの近くに setter を追加:
```js
  function setUserPanHandler(fn) { onUserPan = fn; }
```

export（`return { init, setClickHandler, ... , renderPlaceResults, clearPlaceResults, ... };`）に `setUserPanHandler` を追加（`setLongPressHandler,` の直後が分かりやすい）:
```js
  return { init, setClickHandler, setPlaceClickHandler, setLongPressHandler, setUserPanHandler, clearPins, renderPins, flyTo, fitTo, refresh, getBounds,
           renderPlaceResults, clearPlaceResults,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
```

- [ ] **Step 2: 構文確認**

Run: `node --check js/map.js`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add js/map.js
git commit -m "feat(map): setUserPanHandler (dragend) for search-this-area"
```

---

## Task 2: index.html + style.css — ボタン要素とスタイル

**Files:** Modify `index.html`, `style.css`

- [ ] **Step 1: index.html にボタンを追加**

`#locate-btn`（`<button id="locate-btn" ...>...</button>`、`#map` の近く）の直後に追加:
```html
    <button id="research-btn" hidden><i class="ph ph-arrows-clockwise"></i>このエリアを再検索</button>
```

- [ ] **Step 2: style.css にスタイルを追加**

`/* ===== 場所検索の候補ドロップダウン ===== */` ブロックの直後（`.search-pin` の後）に追加:
```css
/* 「このエリアを再検索」ボタン（上部中央のフローティングピル） */
#research-btn { position: absolute; top: 70px; left: 50%; transform: translateX(-50%); z-index: 55;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px; border-radius: var(--radius-pill);
  background: var(--surface); color: var(--accent-strong); font-size: 14px; font-weight: 600;
  box-shadow: var(--shadow-md); }
#research-btn .ph { font-size: 17px; }
#research-btn:active { transform: translateX(-50%) scale(.97); }
#research-btn[hidden] { display: none; }
```

- [ ] **Step 3: 確認**

`index.html` をブラウザで開いて崩れがないこと（要素は hidden なので通常は非表示）。

- [ ] **Step 4: コミット**

```bash
git add index.html style.css
git commit -m "feat(search): add 'search this area' button markup + style"
```

---

## Task 3: search.js — 状態保持とボタン制御

**Files:** Modify `js/search.js`

- [ ] **Step 1: 状態とヘルパーを追加**

`let box, wrap, dropdown;` の行を次に変更（`researchBtn` を追加）:
```js
  let box, wrap, dropdown, researchBtn;
```

`let seq = 0;` の近くに追加:
```js
  let lastPlaceQuery = null;   // 「このエリアを再検索」で使う直前の検索語
```

`function close() { ... }` の直後にヘルパーを追加:
```js
  function showResearch() { if (researchBtn) researchBtn.hidden = false; }
  function hideResearch() { if (researchBtn) researchBtn.hidden = true; }
```

- [ ] **Step 2: `runPlaceSearch` を更新**

現在の `runPlaceSearch` を次に置き換える:
```js
  // Enter：テキスト検索を実行し、結果をマップにピン表示（0件は記録名検索へ）
  async function runPlaceSearch(q) {
    const mySeq = ++seq;                 // 連続 Enter のレース対策（古い応答を無効化）
    hideResearch();
    App.records.clearSearch();           // 記録検索リスト・シート・場所ピンを一旦リセット
    let results = [];
    try {
      results = await App.places.searchText(q, { bias: App.map.getBounds() });
    } catch (e) { console.error('place text search failed', e); results = []; }
    if (mySeq !== seq) return;           // 途中で新しい検索が始まっていたら破棄
    if (!results.length) {
      lastPlaceQuery = null;
      const n = App.records.searchByName(q);
      if (n === 0) alert('該当する場所・記録が見つかりませんでした');
      return;
    }
    lastPlaceQuery = q;                   // このエリアを再検索用に保持
    App.map.renderPlaceResults(results, (id) => App.records.showPlaceCard(id, { fly: true }));
    App.map.fitTo(results);
  }
```

- [ ] **Step 3: `onInput` の empty 分岐でボタンを消す**

現在:
```js
    if (c.kind === 'empty') { seq++; close(); App.records.clearSearch(); return; } // 保留中の非同期を無効化
```
を:
```js
    if (c.kind === 'empty') { seq++; close(); App.records.clearSearch(); lastPlaceQuery = null; hideResearch(); return; }
```

- [ ] **Step 4: `onKeydown` の empty 分岐でボタンを消す**

現在:
```js
    if (c.kind === 'empty') { seq++; App.records.clearSearch(); close(); return; }
```
を:
```js
    if (c.kind === 'empty') { seq++; App.records.clearSearch(); close(); lastPlaceQuery = null; hideResearch(); return; }
```

- [ ] **Step 5: `activateRow` の rec 分岐でボタンを消す**

現在の rec 分岐:
```js
    if (kind === 'rec') {
      App.map.clearPlaceResults();           // 記録を選んだら場所ピンは消す
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
```
を:
```js
    if (kind === 'rec') {
      App.map.clearPlaceResults();           // 記録を選んだら場所ピンは消す
      lastPlaceQuery = null; hideResearch();
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
```

- [ ] **Step 6: `init` で配線**

現在の `init` の本文（`document.addEventListener('pointerdown', onDocPointer);` の後）に追加。まず参照取得を先頭付近に追加:
```js
    researchBtn = document.getElementById('research-btn');
```
（`dropdown = document.getElementById('search-suggest');` の直後に置く。`if (!box || !wrap || !dropdown) return;` はそのまま。）

`document.addEventListener('pointerdown', onDocPointer);` の後に追加:
```js
    if (researchBtn) researchBtn.addEventListener('click', () => {
      hideResearch();
      if (lastPlaceQuery) runPlaceSearch(lastPlaceQuery);
    });
    if (App.map.setUserPanHandler) App.map.setUserPanHandler(() => { if (lastPlaceQuery) showResearch(); });
```

- [ ] **Step 7: export に `runPlaceSearch` があることを確認（既存）＋ 構文確認**

`return { init, classifyQuery, debounce, render, updateSuggestions, runPlaceSearch, _selfTest };` は既存のまま。

Run: `node --check js/search.js`
Expected: exit 0

- [ ] **Step 8: コミット**

```bash
git add js/search.js
git commit -m "feat(search): show 'search this area' on pan, re-run last query"
```

---

## Task 4: 統合ハーネスとテスト

**Files:** Create（一時・最後に削除）: `_area-test.html`

- [ ] **Step 1: ハーネスを作成**

プロジェクト直下に `_area-test.html`:
```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"></head>
<body>
  <div id="search-wrap"><input id="search-box" type="search"><div id="search-suggest" hidden></div></div>
  <button id="research-btn" hidden>このエリアを再検索</button>
  <script>window.App = window.App || {};</script>
  <script>App.genres = { color: () => '#999', label: () => 'x' };</script>
  <script src="js/places.js"></script>
  <script src="js/search.js"></script>
  <script>
    let panCb = null;
    let boundsSeq = 0;
    const calls = { searchText: 0, biases: [], renderPlace: 0 };
    App.map = {
      setUserPanHandler: (cb) => { panCb = cb; },
      getBounds: () => ({ b: ++boundsSeq }),
      flyTo: () => {}, clearPlaceResults: () => {},
      renderPlaceResults: () => { calls.renderPlace++; }, fitTo: () => {},
    };
    let nameHits = 0;
    App.records = {
      getAll: () => [], suggestRecords: () => [], showDetail: () => {},
      showPlaceCard: () => {}, clearSearch: () => {}, searchTag: () => 0,
      searchByName: () => nameHits,
    };
    let textResult = [{ placeId: 'p1', name: 'マック', lat: 1, lng: 1, genre: 'food' }];
    App.places.searchText = (q, opts) => { calls.searchText++; calls.biases.push(opts && opts.bias); return Promise.resolve(textResult); };

    App.search.init();
    const btn = document.getElementById('research-btn');
    const microflush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    const eq = (n, g, w) => window.__logs.push((JSON.stringify(g) === JSON.stringify(w) ? 'PASS' : 'FAIL') + ' ' + n + ' ' + JSON.stringify(g));

    window.__run = async () => {
      window.__logs = [];
      // 成功検索 → pan → ボタン表示
      await App.search.runPlaceSearch('マック');
      eq('btn-hidden-initially', btn.hidden, true);
      panCb();
      eq('btn-shown-after-pan', btn.hidden, false);
      // ボタンクリック → 新しい bias で再検索
      const before = calls.searchText;
      btn.click();
      await microflush();
      eq('research-reran', calls.searchText, before + 1);
      eq('research-new-bias', calls.biases[1].b !== calls.biases[0].b, true); // 毎回新しい bias
      eq('btn-hidden-after-research', btn.hidden, true); // 再検索成功後は次のpanまで隠れる
      // 0件検索 → pan してもボタンは出ない
      textResult = []; nameHits = 0;
      await App.search.runPlaceSearch('無い');
      panCb();
      eq('no-btn-when-empty', btn.hidden, true);
      // 記録選択でボタン非表示（まず成功検索でlastPlaceQueryを立ててpan表示→rec選択）
      textResult = [{ placeId: 'p2', name: 'x', lat: 2, lng: 2, genre: 'food' }];
      await App.search.runPlaceSearch('カフェ');
      panCb();
      eq('btn-shown-again', btn.hidden, false);
      App.search.render([{ rep: { id: 9, name: 'r', lat: 3, lng: 3, genre: 'food' }, count: 1, photo: null }], [], {});
      document.querySelector('.ss-row[data-kind=rec]').click();
      eq('btn-hidden-after-rec', btn.hidden, true);
      panCb();
      eq('no-btn-after-rec-pan', btn.hidden, true);
      return window.__logs.join('\n');
    };
  </script>
</body></html>
```

- [ ] **Step 2: 実行して全 PASS を確認**

ローカルサーバを起動し `_area-test.html` を開き、コンソールで:
```js
window.__run().then(r => r)
```
Expected: `btn-hidden-initially`/`btn-shown-after-pan`/`research-reran`/`research-new-bias`/`btn-hidden-after-research`/`no-btn-when-empty`/`btn-shown-again`/`btn-hidden-after-rec`/`no-btn-after-rec-pan` が `PASS`。

- [ ] **Step 3: ハーネス削除**

```bash
rm -f _area-test.html
```

---

## Task 5: 実機確認とデプロイ

- [ ] **Step 1: 構文最終チェック**

Run: `node --check js/map.js && node --check js/search.js`
Expected: exit 0

- [ ] **Step 2: デプロイ**

機能ブランチなら `main` へマージ後 `git push`（=GitHub Pages）。

- [ ] **Step 3: 実機確認（デプロイ後 1〜2分、ハード更新）**

- 場所検索（Enter）でピン表示 → 地図をドラッグ → 上部中央に「このエリアを再検索」が出る。
- タップ → その範囲で再検索されピンが更新、ボタンは消える。
- 検索欄を空にする／記録候補を選ぶ → ボタンが出ない。

---

## Self-Review メモ（作成者チェック済み）

- spec 各要件に対応：dragend フック(Task1)、ボタン要素/スタイル(Task2)、lastPlaceQuery＋表示制御＋配線(Task3)、テスト(Task4)、デプロイ(Task5)。
- プレースホルダ無し。
- 型/名称整合: `setUserPanHandler(fn)`、`showResearch/hideResearch`、`lastPlaceQuery`、`runPlaceSearch(q)`、`#research-btn` は定義と使用箇所で一致。
