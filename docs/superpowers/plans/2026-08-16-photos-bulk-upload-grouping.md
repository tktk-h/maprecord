# 複数写真の一括アップロード＋自動グループ化（フェーズ2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数十枚の写真を一括選択し、EXIF（撮影日時・GPS）から「訪問ごと」に自動グループ化して確認・修正UIで整え、まとめて記録として保存できるようにする。

**Architecture:** 純粋なグループ化ロジックを `js/grouping.js`（テスト可能）に分離し、EXIF抽出・確認UI・一括保存のオーケストレーションを `js/bulk.js`（全画面オーバーレイ）に置く。写真アップロードはフェーズ1の `App.photos.toStoredMany` を再利用、店名は既存の `App.places.searchText` を手動で使う。新しいAPI課金は増やさない。

**Tech Stack:** バニラJS（classicスクリプト＋`App.*`名前空間）, `exifr`(CDN, EXIF抽出), Firebase(既存), Cloud Storage(フェーズ1)。自動テストランナーは無し → 純粋関数は `_selfTest()`（devtoolsコンソール）、EXIF/UI/アップロードは本人スマホで実機確認。

---

## テスト方針
- **純粋関数**（`js/grouping.js` の `haversineM`/`centroid`/`groupPhotos`）→ `App.grouping._selfTest()` をコンソールで実行し `PASS`/`FAIL` を目視。これが本計画のユニットテスト。
- **EXIF抽出・確認UI・一括保存** → 本人スマホで実機確認（各タスクに手順明記）。ブラウザ/認証/実写真が要るため。

## File Structure
- **Create** `js/grouping.js` — 純粋なグループ化（`App.grouping`）。距離/重心/`groupPhotos`＋`_selfTest`。責務：時刻＋GPS配列 → グループ分割。
- **Create** `js/bulk.js` — 一括フローのオーケストレーション＋確認UI（`App.bulk`）。責務：一括選択→EXIF抽出→下書き生成→レビューUI描画→一括保存。
- **Modify** `index.html` — exifr(CDN)＋`grouping.js`/`bulk.js` の読み込み、入口ボタン、`#bulk-overlay` 追加、`?v=` 更新。
- **Modify** `style.css` — 一括レビューUI（オーバーレイ・カード・ストリップ）のスタイル。
- **Modify** `js/records.js`（1行）— 入口ボタンの配線を既存の初期化に足す（または index.html 側で完結させる）。

**再利用する既存API：** `App.photos.toStoredMany(files, groupId, onProgress)` / `App.photos.thumbOf` / `App.cloud.add(record)` / `App.cloud._spaceId()` / `App.places.searchText(q, {bias:{center:{lat,lng},radius}})`→`[{placeId,name,lat,lng,genre}]` / `App.genres.list`・`App.genres.label(key)` / `App.records.getAll()`。

---

### Task 1: 安全網（タグ＋featureブランチ）

**Files:** なし（git操作）

- [ ] **Step 1: クリーン確認**

Run:
```bash
git status --porcelain
```
Expected: 出力なし。

- [ ] **Step 2: 復元タグ＋ブランチ**

Run:
```bash
git tag pre-bulk-upload && git switch -c feature/photos-bulk-upload
```
Expected: `Switched to a new branch 'feature/photos-bulk-upload'`

- [ ] **Step 3: 確認**

Run:
```bash
git branch --show-current
```
Expected: `feature/photos-bulk-upload`

---

### Task 2: グループ化の純粋関数（`js/grouping.js`）＋自己テスト

これがフェーズ2の核。時刻とGPSだけを入力に、決定的にグループを作る。UIやEXIFに依存しないのでテストできる。

**Files:**
- Create: `js/grouping.js`
- Test: `js/grouping.js` の `_selfTest`（devtoolsコンソール）

- [ ] **Step 1: 失敗する自己テストを含む形でファイルを作成**

`js/grouping.js` を新規作成。まず全体を書く（実装＋自己テスト）：

```js
window.App = window.App || {};
// 写真を「訪問ごと」にグループ化する純粋ロジック。UI/EXIF非依存＝テスト可能。
App.grouping = (function () {
  const DIST_M = 150;                 // これより離れたら別グループ（GPSあり）
  const GAP_MS = 2 * 60 * 60 * 1000;  // これ以上あいたら別グループ

  // 2点間の距離(m)。ハバースイン。
  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // 座標配列の重心（単純平均。市内スケールなら十分）。空なら null。
  function centroid(points) {
    if (!points.length) return null;
    let sLat = 0, sLng = 0;
    for (const p of points) { sLat += p.lat; sLng += p.lng; }
    return { lat: sLat / points.length, lng: sLng / points.length };
  }

  // ローカル時刻の 'YYYY-MM-DD'
  function dateOf(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // items: [{ time:Number(ms), gps:{lat,lng}|null }]（順不同でよい。元の位置は index で保持）
  // 返り値: グループ配列。各 { idx:[元index...], date, center:{lat,lng}|null, hasGps }
  //   ・GPSあり: 中心から150m超 or 直前から2時間超で切る
  //   ・GPSなし: 2時間超だけで切る（場所未設定）
  //   ・日付では切らない。各グループの date は最早写真の日。
  //   ・全グループを最早時刻の昇順で並べて返す（GPS有無を混ぜて時系列）。
  function groupPhotos(items) {
    const withIdx = items.map((it, i) => ({ i, time: it.time, gps: it.gps || null }));
    const gps = withIdx.filter((x) => x.gps).sort((a, b) => a.time - b.time);
    const nogps = withIdx.filter((x) => !x.gps).sort((a, b) => a.time - b.time);
    const groups = [];

    // GPSあり
    let cur = null;
    for (const x of gps) {
      if (cur) {
        const c = centroid(cur.pts);
        const far = haversineM(c.lat, c.lng, x.gps.lat, x.gps.lng) > DIST_M;
        const gap = (x.time - cur.lastTime) > GAP_MS;
        if (far || gap) cur = null;
      }
      if (!cur) { cur = { idx: [], pts: [], firstTime: x.time, lastTime: x.time }; groups.push(cur); }
      cur.idx.push(x.i); cur.pts.push(x.gps); cur.lastTime = x.time;
    }
    // GPSなし
    let curN = null;
    for (const x of nogps) {
      if (curN && (x.time - curN.lastTime) > GAP_MS) curN = null;
      if (!curN) { curN = { idx: [], pts: null, firstTime: x.time, lastTime: x.time, nogps: true }; groups.push(curN); }
      curN.idx.push(x.i); curN.lastTime = x.time;
    }

    return groups
      .sort((a, b) => a.firstTime - b.firstTime)
      .map((g) => ({
        idx: g.idx,
        date: dateOf(g.firstTime),
        center: g.nogps ? null : centroid(g.pts),
        hasGps: !g.nogps,
      }));
  }

  function _selfTest() {
    const eq = (n, got, want) => console.log((JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    const H = 60 * 60 * 1000;
    const base = Date.UTC(2026, 7, 16, 4, 0, 0); // 適当な基準(ms)
    const A = { lat: 35.0000, lng: 135.0000 };
    const near = { lat: 35.0010, lng: 135.0000 };  // 約111m（<150）
    const far = { lat: 35.0030, lng: 135.0000 };   // 約333m（>150）

    // 近い＆10分差 → 1グループ [0,1]
    eq('near-close', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base + 10 * 60000, gps: near },
    ]).map((g) => g.idx), [[0, 1]]);

    // 遠い＆同時刻 → 2グループ
    eq('far-split', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base, gps: far },
    ]).map((g) => g.idx), [[0], [1]]);

    // 近いが3時間差 → 時間で2グループ
    eq('gap-split', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base + 3 * H, gps: near },
    ]).map((g) => g.idx), [[0], [1]]);

    // GPSなし2枚30分差 → 1グループ・hasGps=false
    eq('nogps-one', App.grouping.groupPhotos([
      { time: base, gps: null }, { time: base + 30 * 60000, gps: null },
    ]).map((g) => ({ idx: g.idx, hasGps: g.hasGps, center: g.center })),
      [{ idx: [0, 1], hasGps: false, center: null }]);

    // 混在の時系列順: GPS(13時)→無GPS(14時)→GPS(15時) は idx 昇順 [[0],[1],[2]]
    eq('interleave', App.grouping.groupPhotos([
      { time: base, gps: far }, { time: base + 1 * H, gps: null }, { time: base + 2 * H, gps: A },
    ]).map((g) => g.idx), [[0], [1], [2]]);

    // 距離関数のサニティ（約111m）
    const d = App.grouping.haversineM(35, 135, 35.001, 135);
    console.log((d > 100 && d < 125 ? 'PASS' : 'FAIL') + ' haversine-111m', Math.round(d));
  }

  return { haversineM, centroid, dateOf, groupPhotos, _selfTest };
})();
```

- [ ] **Step 2: index.html に読み込みを追加（テスト実行のため先に）**

`index.html` の `<script src="js/records.js...">` の**前**に1行足す（バージョンは現行に合わせる。まだ番号は上げない）：
```html
  <script src="js/grouping.js?v=20260816j"></script>
```

- [ ] **Step 3: 自己テストが通ることを確認**

アプリをローカルで開けない場合でも、これは純粋関数なのでコンソールで確認できる。**本番URL**（すでに稼働中）を開き、devtoolsコンソールで一時的に `js/grouping.js` の内容を貼るか、次タスク以降でデプロイ後に実行。最短は「Task 9 のデプロイ後に本番で `App.grouping._selfTest()`」。ここでは**コードレビューで**、6つのeqが期待どおりの構造を返すこと（idx配列・date・hasGps・center）を確認する。

Expected（デプロイ後に実行時）: 全行 `PASS`。

- [ ] **Step 4: コミット**

```bash
git add js/grouping.js index.html
git commit -m "feat(grouping): pure photo grouping by time+GPS with self-tests"
```

---

### Task 3: bulk.js 骨組み＋入口＋EXIF抽出→下書き生成（表示前まで）

一括選択 → 各写真のEXIF（時刻・GPS）を `exifr` で抽出 → `App.grouping.groupPhotos` で下書きグループを作り、**まずは `console.log` で結果を確認**できる所まで。

**Files:**
- Create: `js/bulk.js`
- Modify: `index.html`（exifr・bulk.js・入口ボタン・オーバーレイ）

- [ ] **Step 1: index.html に依存とプレースホルダを追加**

`</head>` 直前あたり、既存の gstatic Firebase より前でよいので exifr を追加：
```html
  <script src="https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js"></script>
```
`<script src="js/records.js...">` の**後**に：
```html
  <script src="js/bulk.js?v=20260816j"></script>
```
`<main id="layout">` 内、`</main>` の直前に全画面オーバーレイの器を追加：
```html
    <div id="bulk-overlay" hidden></div>
```
入口ボタン：地図画面の `#locate-btn`（現在地）の隣に、`<button id="bulk-btn" ...>` を追加（`#locate-btn` の直後）：
```html
    <button id="bulk-btn" title="写真からまとめて追加"><i class="ph ph-images"></i><span>まとめて</span></button>
```

- [ ] **Step 2: bulk.js を作成（骨組み＋EXIF＋下書き生成）**

`js/bulk.js`：
```js
window.App = window.App || {};
// 一括アップロード＋自動グループ化の入口・確認UI・保存。
App.bulk = (function () {
  let groups = [];          // 下書きグループ（下記 shape）
  let fileInput = null;

  // 隠しファイル入力を用意して一括選択を促す
  function open() {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true;
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        if (files.length) handleFiles(files);
      });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  // File → { time(ms), gps:{lat,lng}|null }
  async function readMeta(file) {
    let time = null, gps = null;
    if (window.exifr) {
      try { const g = await exifr.gps(file);
        if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') gps = { lat: g.latitude, lng: g.longitude }; } catch (_) {}
      try { const m = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
        const dt = m && (m.DateTimeOriginal || m.CreateDate || m.ModifyDate);
        if (dt) time = new Date(dt).getTime(); } catch (_) {}
    }
    if (time == null) time = file.lastModified || Date.now(); // フォールバック
    return { time, gps };
  }

  async function handleFiles(files) {
    showLoading(files.length);
    const metas = [];
    for (const f of files) metas.push(await readMeta(f));
    const raw = App.grouping.groupPhotos(metas.map((m) => ({ time: m.time, gps: m.gps })));
    // 元indexを実ファイルに戻して下書きグループを組む
    groups = raw.map((g) => ({
      photos: g.idx.map((i) => ({ file: files[i], time: metas[i].time, gps: metas[i].gps, url: URL.createObjectURL(files[i]) }))
                     .sort((a, b) => a.time - b.time),
      date: g.date,
      center: g.center,
      hasGps: g.hasGps,
      placeId: null,
      place: null,     // {lat,lng} 紐付けた店の座標
      name: '',        // 店名（紐付けで入る／未設定は空）
      genre: 'food',
    }));
    console.log('bulk groups', groups); // Task 4 でUI描画に差し替え
    renderReview();
  }

  function showLoading(n) {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = false;
    ov.innerHTML = `<div class="bulk-loading">写真を読み込み中…（${n}枚）</div>`;
  }

  function close() {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = true; ov.innerHTML = '';
    for (const g of groups) for (const p of g.photos) URL.revokeObjectURL(p.url);
    groups = [];
  }

  function renderReview() { /* Task 4 で実装 */ }

  function init() {
    const btn = document.getElementById('bulk-btn');
    if (btn) btn.onclick = open;
  }

  return { init, open, close, _groups: () => groups };
})();
```

- [ ] **Step 3: init を app 起動に配線**

`js/records.js` の `init`（`return { init, ... }` の中の init）は起動時に呼ばれている。`App.bulk.init()` を起動時に呼ぶ必要がある。`index.html` の module エントリではなく、classic 側で確実に呼ぶため、`js/bulk.js` の末尾（IIFE の後）に次を足す：
```js
document.addEventListener('DOMContentLoaded', () => { if (App.bulk) App.bulk.init(); });
```
（`DOMContentLoaded` 済みでも classic script は body 末尾で読まれるので、保険として即時にも呼ぶ）：
```js
if (document.readyState !== 'loading' && App.bulk) App.bulk.init();
```

- [ ] **Step 4: 実機/本番で下書き生成を確認**（Task 9 デプロイ後に実施）

本番で「まとめて」ボタン → 写真を数枚選ぶ → devtools コンソールに `bulk groups [...]` が出て、グループ数・各 photos・date・hasGps・center が妥当なこと。

- [ ] **Step 5: コミット**

```bash
git add js/bulk.js index.html
git commit -m "feat(bulk): entry button, EXIF read and draft grouping (no UI yet)"
```

---

### Task 4: レビューUIの描画（カード一覧）

`renderReview()` を実装。下書きグループを**時系列カード**で全画面表示。この時点では表示のみ（操作は Task 5-6）。

**Files:**
- Modify: `js/bulk.js`（`renderReview` と補助関数）

- [ ] **Step 1: `renderReview` と描画補助を実装**

`js/bulk.js` の `function renderReview() { /* Task 4 で実装 */ }` を次に置き換え、補助関数を IIFE 内に追加：
```js
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 'HH:MM'
  function hhmm(ms) { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
  function genreOptions(sel) {
    return App.genres.list.map((g) => `<option value="${g.key}" ${g.key === sel ? 'selected' : ''}>${g.label}</option>`).join('');
  }

  function cardHtml(g, i) {
    const first = g.photos[0], last = g.photos[g.photos.length - 1];
    const cover = g.photos[0].url;
    const timeRange = g.photos.length > 1 ? `${hhmm(first.time)}〜${hhmm(last.time)}` : hhmm(first.time);
    const noGpsTag = g.hasGps ? '' : '<span class="bulk-tag">場所未設定</span>';
    const placeBtn = g.name
      ? `<button class="bulk-place set" data-i="${i}">📍 ${esc(g.name)} ・ 変更</button>`
      : `<button class="bulk-place" data-i="${i}">📍 店名を検索して紐付け${g.hasGps ? '' : '（GPSなし）'}</button>`;
    const strip = g.photos.map((p, j) =>
      `<div class="bulk-ph" data-i="${i}" data-j="${j}" style="background-image:url(${p.url})"></div>`).join('');
    const mergeBtn = i > 0 ? `<button class="bulk-act" data-act="merge" data-i="${i}">↑ 前と結合</button>` : '';
    return `
      <div class="bulk-card" data-i="${i}">
        <div class="bulk-top">
          <div class="bulk-cover" style="background-image:url(${cover})"><span>${g.photos.length}枚</span></div>
          <div class="bulk-meta">
            <div class="bulk-date">${g.date} <span class="bulk-count">${timeRange} ・ ${g.photos.length}枚</span>${noGpsTag}</div>
            ${placeBtn}
            <div class="bulk-fields">
              <select class="bulk-genre" data-i="${i}">${genreOptions(g.genre)}</select>
              <input class="bulk-datefld" type="date" value="${g.date}" data-i="${i}">
            </div>
          </div>
        </div>
        <div class="bulk-strip">${strip}</div>
        <div class="bulk-splithint">▸ 写真をタップ →「ここで分割」でその位置から下を別グループに</div>
        <div class="bulk-acts">
          ${mergeBtn}
          <button class="bulk-act" data-act="split" data-i="${i}" disabled>✂️ ここで分割</button>
          <button class="bulk-act warn" data-act="del" data-i="${i}">🗑 削除</button>
        </div>
      </div>`;
  }

  function renderReview() {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = false;
    ov.innerHTML = `
      <div class="bulk-head">
        <button id="bulk-cancel" class="bulk-x">✕</button>
        <div class="bulk-title">確認・修正</div>
      </div>
      <div class="bulk-lead">${countPhotos()}枚を ${groups.length}グループに整理しました。直してまとめて保存。</div>
      <div id="bulk-list">${groups.map(cardHtml).join('')}</div>
      <button id="bulk-save" class="bulk-save">すべて保存（${saveableCount()}件の記録をつくる）</button>`;
    document.getElementById('bulk-cancel').onclick = close;
    wireCards(); // Task 5-6 で実装（この時点では空でよい）
  }

  function countPhotos() { return groups.reduce((n, g) => n + g.photos.length, 0); }
  function groupLatLng(g) { return g.hasGps ? g.center : g.place; }        // 保存座標
  function saveableCount() { return groups.filter((g) => groupLatLng(g)).length; }
  function wireCards() { /* Task 5-6 */ }
```

- [ ] **Step 2: 実機/本番で見た目確認**（Task 9 後）

「まとめて」→ 写真選択 → 全画面にカードが時系列で並ぶ。代表写真・枚数・時間帯・場所ボタン・ジャンル/日付・写真ストリップ・各ボタンが出る（まだ押しても動かなくてよい）。無GPSグループに「場所未設定」タグ。

- [ ] **Step 3: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): render time-ordered review cards"
```

---

### Task 5: 操作 — 結合・削除・日付・ジャンル

**Files:**
- Modify: `js/bulk.js`（`wireCards` と操作関数）

- [ ] **Step 1: `wireCards` を実装（結合/削除/日付/ジャンル）**

`js/bulk.js` の `function wireCards() { /* Task 5-6 */ }` を置き換え：
```js
  function wireCards() {
    const list = document.getElementById('bulk-list');
    if (!list) return;
    list.querySelectorAll('.bulk-act').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), act = btn.dataset.act;
        if (act === 'merge') mergeUp(i);
        else if (act === 'del') { groups.splice(i, 1); renderReview(); }
        else if (act === 'split') doSplit(i);
      };
    });
    list.querySelectorAll('.bulk-genre').forEach((sel) => {
      sel.onchange = () => { groups[Number(sel.dataset.i)].genre = sel.value; };
    });
    list.querySelectorAll('.bulk-datefld').forEach((inp) => {
      inp.onchange = () => { groups[Number(inp.dataset.i)].date = inp.value; };
    });
    list.querySelectorAll('.bulk-place').forEach((btn) => {
      btn.onclick = () => openPlaceSearch(Number(btn.dataset.i)); // Task 6
    });
    wireStrip(); // Task 6（分割の写真選択）
    const save = document.getElementById('bulk-save');
    if (save) save.onclick = doSave; // Task 7
  }

  // i番目を i-1 に統合。座標/場所は「結合先(前)」を優先し、無ければ自分のを引き継ぐ。
  function mergeUp(i) {
    if (i <= 0) return;
    const prev = groups[i - 1], g = groups[i];
    prev.photos = prev.photos.concat(g.photos).sort((a, b) => a.time - b.time);
    if (!prev.hasGps && g.hasGps) { prev.hasGps = true; prev.center = g.center; }
    if (!prev.placeId && g.placeId) { prev.placeId = g.placeId; prev.place = g.place; prev.name = g.name; }
    prev.date = App.grouping.dateOf(prev.photos[0].time); // 最早写真の日
    groups.splice(i, 1);
    renderReview();
  }

  function doSplit(i) { /* Task 6 */ }
  function openPlaceSearch(i) { /* Task 6 */ }
  function wireStrip() { /* Task 6 */ }
  function doSave() { /* Task 7 */ }
```

- [ ] **Step 2: 実機確認**（Task 9 後）：「↑前と結合」で2グループが1つに（写真が時刻順で合流、日付は最早に）。「🗑削除」でカードが消え、保存件数が減る。ジャンル・日付の変更が保持される（保存時に反映）。

- [ ] **Step 3: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): merge-up, delete, genre and date editing"
```

---

### Task 6: 操作 — 分割（写真タップ）＆ 場所の手動紐付け

**Files:**
- Modify: `js/bulk.js`

- [ ] **Step 1: 分割の写真選択（wireStrip）と doSplit を実装**

`wireStrip`/`doSplit` を置き換え。写真タップでその写真を「分割起点」に選び、同カードの分割ボタンを有効化：
```js
  let splitSel = { i: -1, j: -1 }; // 選択中の分割起点

  function wireStrip() {
    splitSel = { i: -1, j: -1 };
    document.querySelectorAll('.bulk-ph').forEach((el) => {
      el.onclick = () => {
        const i = Number(el.dataset.i), j = Number(el.dataset.j);
        if (j === 0) return; // 先頭では分割不要
        document.querySelectorAll(`.bulk-ph[data-i="${i}"]`).forEach((x) => x.classList.remove('sel'));
        el.classList.add('sel');
        splitSel = { i, j };
        const btn = document.querySelector(`.bulk-act[data-act="split"][data-i="${i}"]`);
        if (btn) btn.disabled = false;
      };
    });
  }

  // 選択した写真(j)から後ろを新グループに切り出す
  function doSplit(i) {
    if (splitSel.i !== i || splitSel.j <= 0) return;
    const g = groups[i];
    const tail = g.photos.splice(splitSel.j); // j以降
    const newG = {
      photos: tail, date: App.grouping.dateOf(tail[0].time),
      center: null, hasGps: false, placeId: null, place: null, name: '', genre: g.genre,
    };
    // 新グループのGPS再計算（tailにGPSがあれば）
    const pts = tail.filter((p) => p.gps).map((p) => p.gps);
    if (pts.length) { newG.hasGps = true; newG.center = App.grouping.centroid(pts); }
    // 元グループのGPS/日付も再計算
    const headPts = g.photos.filter((p) => p.gps).map((p) => p.gps);
    g.hasGps = headPts.length > 0; g.center = headPts.length ? App.grouping.centroid(headPts) : null;
    g.date = App.grouping.dateOf(g.photos[0].time);
    groups.splice(i + 1, 0, newG); // 時系列的に直後へ
    renderReview();
  }
```

- [ ] **Step 2: 場所の手動紐付け（既存 places.searchText を流用）**

`openPlaceSearch` を置き換え。カード内にインライン検索を出し、選んだ店の座標・placeId・名前・ジャンルをそのグループに入れる：
```js
  function openPlaceSearch(i) {
    const g = groups[i];
    const card = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!card) return;
    let box = card.querySelector('.bulk-placebox');
    if (box) { box.remove(); return; } // トグル
    box = document.createElement('div');
    box.className = 'bulk-placebox';
    box.innerHTML = `
      <input type="text" class="bulk-pq" placeholder="店名で検索" value="${esc(g.name || '')}">
      <button type="button" class="bulk-psearch">検索</button>
      <div class="bulk-presults"></div>`;
    card.querySelector('.bulk-meta').appendChild(box);
    const q = box.querySelector('.bulk-pq'), results = box.querySelector('.bulk-presults');
    async function run() {
      const text = q.value.trim(); if (!text) return;
      results.innerHTML = '<span class="bulk-hint">検索中…</span>';
      try {
        const opts = g.center ? { bias: { center: g.center, radius: 3000 } } : {};
        const places = await App.places.searchText(text, opts);
        if (!places.length) { results.innerHTML = '<span class="bulk-hint">該当なし</span>'; return; }
        results.innerHTML = places.slice(0, 6).map((p, k) => `<button type="button" class="bulk-pick" data-k="${k}">${esc(p.name)}</button>`).join('');
        results.querySelectorAll('.bulk-pick').forEach((b) => {
          b.onclick = () => {
            const p = places[Number(b.dataset.k)];
            g.placeId = p.placeId; g.place = { lat: p.lat, lng: p.lng }; g.name = p.name;
            if (p.genre) g.genre = p.genre;
            renderReview();
          };
        });
      } catch (_) { results.innerHTML = '<span class="bulk-hint">検索できませんでした</span>'; }
    }
    box.querySelector('.bulk-psearch').onclick = run;
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    q.focus();
  }
```

- [ ] **Step 3: 実機確認**（Task 9 後）：写真タップ→選択強調→「✂️ここで分割」でその位置以降が新カードに（直後に挿入）。GPS/日付が再計算される。「📍店名を検索」→検索→候補タップでカードに店名が入り、無GPSグループでも座標が付いて保存対象になる。

- [ ] **Step 4: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): split at photo and manual place linking"
```

---

### Task 7: 一括保存

**Files:**
- Modify: `js/bulk.js`

- [ ] **Step 1: `doSave` を実装**

位置のあるグループごとに `toStoredMany` でアップロード＋`cloud.add`。位置なしはスキップして残す。進捗表示、失敗グループは残す：
```js
  async function doSave() {
    const saveBtn = document.getElementById('bulk-save');
    const targets = groups.filter((g) => groupLatLng(g));
    const skipped = groups.filter((g) => !groupLatLng(g));
    if (!targets.length) { alert('保存できるグループがありません（場所を設定してください）'); return; }
    saveBtn.disabled = true;
    const failed = [];
    let done = 0;
    const all = App.records.getAll();
    for (const g of targets) {
      const loc = groupLatLng(g);
      saveBtn.textContent = `保存中… ${done + 1}/${targets.length}`;
      try {
        const files = g.photos.map((p) => p.file);
        const groupId = 'bulk-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6);
        const photos = await App.photos.toStoredMany(files, groupId, (n, t) => {
          saveBtn.textContent = `保存中… グループ${done + 1}/${targets.length}（写真${n}/${t}）`;
        });
        const order = all.filter((r) => r.date === g.date).length + done; // その日の末尾へ
        await App.cloud.add({
          date: g.date, name: g.name || '', genre: g.genre, memo: '', tags: [], order,
          lat: loc.lat, lng: loc.lng, photos,
          ...(g.placeId ? { placeId: g.placeId } : {}),
        });
        done++;
      } catch (err) {
        console.error('bulk save failed', err);
        failed.push(g);
      }
    }
    // 保存できたグループを除き、失敗＋位置なしを残す
    groups = failed.concat(skipped);
    if (!groups.length) {
      close();
      alert(`${done}件を保存しました。`);
    } else {
      renderReview();
      alert(`${done}件を保存しました。残り${groups.length}件（場所未設定 or 失敗）を確認してください。`);
    }
  }
```

- [ ] **Step 2: 実機確認**（Task 9 後）：複数グループを保存 → 各グループが1記録として地図/一覧に出る（購読で自動反映）。位置なしグループは残る。Storageに写真が上がる。1グループの保存を途中で失敗させる（回線断）と、そのグループが残り孤児が出ない（フェーズ1ロールバック）。

- [ ] **Step 3: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): batch save groups as records, skip locationless, keep failures"
```

---

### Task 8: スタイル（style.css）

**Files:**
- Modify: `style.css`

- [ ] **Step 1: 一括UIのCSSを追記**

`style.css` の末尾に追加（既存の温かみのある配色に合わせる。既存変数があればそれに寄せてよいが、無ければ下記の実値で可）：
```css
/* --- 一括アップロード（bulk） --- */
#bulk-btn { /* #locate-btn と同系の見た目に。既存の locate-btn 定義を参考に最小限で */
  position: absolute; z-index: 20; }
#bulk-overlay { position: fixed; inset: 0; z-index: 1000; overflow-y: auto;
  background: #f4ece4; color: #3a2e28; padding: 16px; }
@media (prefers-color-scheme: dark) { #bulk-overlay { background: #241d19; color: #efe7df; } }
.bulk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.bulk-x { border: none; background: transparent; font-size: 20px; cursor: pointer; color: inherit; }
.bulk-title { font-weight: 700; font-size: 18px; }
.bulk-lead { font-size: 13px; opacity: .75; margin-bottom: 14px; }
.bulk-loading { padding: 40px 0; text-align: center; opacity: .8; }
.bulk-card { background: rgba(127,127,127,.10); border: 1px solid rgba(127,127,127,.25);
  border-radius: 16px; padding: 12px; margin-bottom: 12px; max-width: 560px; margin-inline: auto; }
.bulk-top { display: flex; gap: 12px; }
.bulk-cover { width: 84px; height: 84px; border-radius: 12px; flex: none;
  background-size: cover; background-position: center; position: relative; }
.bulk-cover span { position: absolute; right: 5px; bottom: 4px; background: rgba(0,0,0,.55);
  color: #fff; font-size: 11px; padding: 1px 7px; border-radius: 9px; }
.bulk-meta { flex: 1; min-width: 0; }
.bulk-date { font-weight: 700; font-size: 15px; }
.bulk-count { font-weight: 500; font-size: 12px; opacity: .7; margin-left: 6px; }
.bulk-tag { font-size: 11px; background: #8f88ad; color: #fff; padding: 2px 8px; border-radius: 9px; margin-left: 6px; }
.bulk-place { margin-top: 8px; border: 1.5px dashed #b5675f; color: #b5675f; background: transparent;
  border-radius: 10px; padding: 7px 11px; font-size: 13px; font-weight: 600; cursor: pointer; max-width: 100%; }
.bulk-place.set { border-style: solid; background: rgba(181,103,95,.15); }
.bulk-fields { display: flex; gap: 8px; margin-top: 9px; flex-wrap: wrap; }
.bulk-genre, .bulk-datefld { border: 1px solid rgba(127,127,127,.3); border-radius: 9px; padding: 5px 8px;
  font-size: 12.5px; background: transparent; color: inherit; }
.bulk-strip { display: flex; gap: 6px; margin-top: 12px; overflow-x: auto; }
.bulk-ph { width: 46px; height: 46px; border-radius: 8px; flex: none; background-size: cover;
  background-position: center; cursor: pointer; }
.bulk-ph.sel { outline: 2.5px solid #b5675f; outline-offset: 1px; }
.bulk-splithint { font-size: 11.5px; color: #b5675f; margin-top: 7px; }
.bulk-acts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;
  border-top: 1px solid rgba(127,127,127,.2); padding-top: 11px; }
.bulk-act { border: 1px solid rgba(127,127,127,.3); background: transparent; border-radius: 10px;
  padding: 7px 11px; font-size: 12.5px; color: inherit; cursor: pointer; }
.bulk-act[disabled] { opacity: .4; cursor: default; }
.bulk-act.warn { color: #b04a3f; border-color: rgba(176,74,63,.4); }
.bulk-placebox { margin-top: 10px; }
.bulk-pq { width: 100%; border: 1px solid rgba(127,127,127,.3); border-radius: 9px; padding: 8px; font-size: 14px;
  background: transparent; color: inherit; }
.bulk-psearch { margin-top: 6px; border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit;
  border-radius: 9px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.bulk-presults { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.bulk-pick { border: 1px solid rgba(181,103,95,.5); color: #b5675f; background: transparent;
  border-radius: 9px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
.bulk-hint { font-size: 12px; opacity: .7; }
.bulk-save { display: block; width: 100%; max-width: 560px; margin: 6px auto 30px; background: #b5675f;
  color: #fff; border: none; border-radius: 14px; padding: 15px; font-size: 16px; font-weight: 700; cursor: pointer; }
.bulk-save[disabled] { opacity: .6; }
```

- [ ] **Step 2: `#bulk-btn` の位置を既存ボタンと衝突しないよう調整**

`style.css` 内の既存 `#locate-btn` の定義を確認し、`#bulk-btn` をその近く（例：`#locate-btn` の上や隣）に配置する `top`/`right`/`bottom` を、実機で重ならないよう調整（実機確認しながら数値決め）。

Run（既存ボタン位置の把握）:
```bash
grep -n "#locate-btn\|#research-btn" style.css
```
Expected: 既存の絶対配置が見つかる。それを参考に `#bulk-btn` の座標を決める。

- [ ] **Step 3: 実機で見た目確認**（Task 9 後）：カード・ストリップ・ボタンが読みやすく、ダークでも破綻しない。入口ボタンが他ボタンと重ならない。

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "style(bulk): review overlay and card styles"
```

---

### Task 9: デプロイ（バージョン更新）＋自己テスト＆総合実機確認

**Files:**
- Modify: `index.html`

- [ ] **Step 1: バージョンを一括更新**

`index.html` 内の全 `?v=20260816j` と `.app-ver` を新値（例 `20260816k`。実施日に合わせる）へ置換。新規追加した `grouping.js`/`bulk.js` の `?v=` も忘れず同値に。

- [ ] **Step 2: コミット＆本番反映**

```bash
git add index.html
git commit -m "chore: bump asset version for bulk-upload feature"
```
main へ統合して push（[[maprecord-deploy]]／[[maprecord-cache-busting]]）は Task 10 の仕上げで実施。

- [ ] **Step 3: グループ化の自己テスト（本番 or ローカルのコンソール）**

デプロイ後アプリを開き、devtoolsコンソールで：
```js
App.grouping._selfTest()
```
Expected: `near-close`/`far-split`/`gap-split`/`nogps-one`/`interleave`/`haversine-111m` すべて `PASS`。

- [ ] **Step 4: 総合実機確認（本人スマホ）**

- 数十枚（GPSあり/なし混在、HEIC含む）を「まとめて」→ 妥当な下書きグループ。
- 結合・分割・場所紐付け・日付/ジャンル編集がすべて効く。
- 位置未設定グループは保存でスキップされ画面に残る。
- 「すべて保存」で各グループが1記録になり地図/一覧に出る。Storageに写真が上がる。
- 途中失敗（回線断）でも孤児が残らない（フェーズ1ロールバック）。
- 既存の1枚ずつ追加フローも従来どおり動く（非破壊）。

---

### Task 10: ブランチの仕上げ

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

- [ ] **Step 1:** Task 9 の自己テスト＆実機確認がすべて緑であることを再確認。
- [ ] **Step 2:** finishing-a-development-branch に従い main へマージ→push（GitHub Pages 反映）。デプロイ後、本番URLで最終確認（数十枚→保存）。
- [ ] **Step 3:** 問題があれば `git switch main` → `pre-bulk-upload` タグへ戻して即ロールバック（既存記録・写真は無傷）。

---

## Self-Review（spec との突き合わせ）

**Spec coverage:**
- 入口＋一括選択 → Task 3 ✓
- EXIF抽出（DateTimeOriginal→fallback lastModified、GPS）→ Task 3 `readMeta` ✓
- グループ化（150m/2h・日付で切らない・最早写真の日・無GPSは時間だけ）→ Task 2 `groupPhotos`＋selfTest ✓
- 時系列カードUI（無GPSも間に）→ Task 2 の並び＋Task 4 描画 ✓
- 結合/分割/場所手動/日付/ジャンル/代表写真=先頭/カード削除 → Task 5・6 ✓
- 保存（1グループ=1記録・座標=中心or店・位置なしスキップ・進捗・失敗ロールバック）→ Task 7 ✓
- フェーズ1アップロード再利用・新規API課金なし → Task 3/7（toStoredMany）・Task 6（既存 searchText のみ）✓
- 非破壊（既存フロー温存）→ 別入口・別モジュール、records.js は入口配線のみ ✓
- キャッシュバスティング → Task 9 ✓

**Placeholder scan:** 各 `/* Task N */` プレースホルダは後続タスクで実コードに置換済み（Task 4→renderReview、5→wireCards/mergeUp、6→doSplit/openPlaceSearch/wireStrip、7→doSave）。最終状態に未実装プレースホルダは残らない。

**Type consistency:** 下書きグループの形 `{ photos:[{file,time,gps,url}], date, center, hasGps, placeId, place, name, genre }` を Task 3〜7 で統一。`App.grouping.groupPhotos` は `{idx,date,center,hasGps}` を返し Task 3 で実ファイルに写像。`groupLatLng(g)=hasGps?center:place`、`saveableCount`、`toStoredMany(files,groupId,onProgress)`、`cloud.add(record)` は全タスク整合。
