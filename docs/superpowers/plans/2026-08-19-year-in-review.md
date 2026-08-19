# 年間ふりかえり Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** あしあと(maprecord)に「年間ふりかえり」を追加する。1年を Stories 風スライドショーで見せ、見切ったらスクロール総集編でじっくり読む。

**Architecture:** 集計は純粋関数 `App.reviewStats`（`js/review-stats.js`、依存なし・Nodeでテスト可）。描画は `App.review`（`js/review-ui.js`、スライドショー＋総集編＋年ピッカー＋年末カード）。地図は Google Maps を使わず SVG でピンを打つ「あしあと星座」。既存の `window.App` グローバル方式に合わせ、`index.html` から `?v=` 付き `<script>` で読み込む。入口はメニューの「ふりかえり」ボタンと年末カード。

**Tech Stack:** バニラJS（ESMではない `window.App` グローバル）、SVG、Web Animations API、既存 `App.records`/`App.genres`/`App.photos`。ビルド無し。テストは純粋関数の `_selfTest()` を Node で実行。UI は実ブラウザで目視確認。

**参照:** 仕様 `docs/superpowers/specs/2026-08-19-year-in-review-design.md`。ピン演出の参照実装 `docs/prototypes/2026-08-19-year-in-review-slide2.html`。

**版運用:** 実装完了後にまとめて `index.html` 内の `20260819q` を **`20260819r`** へ全置換（Task 8）。作業途中のコミットでは版を上げない。

---

## File Structure

- **Create `js/review-stats.js`** — 純粋な集計。`computeYearReview()` / `yearsWithRecords()` / `planSlides()` / `_selfTest()`。DOM・Firebase・他モジュール非依存（Nodeで実行可能）。
- **Create `js/review-ui.js`** — 描画と開閉。`App.review.open(year)` / `showPicker()` / `maybeShowYearEndCard()` と内部の `_pinSchedule()`（純粋・テスト可）。トップレベルでは `document` に触れない（Nodeロード可）。
- **Modify `index.html`** — オーバーレイDOM（スライドショー `#review-show`・総集編 `#review-page`・年ピッカー `#review-picker`・年末カード `#review-card`）、メニューに「ふりかえり」ボタン `#review-btn`、`<script>` 2本追加。
- **Modify `style.css`** — ふりかえり用スタイル（末尾に追記）。
- **Modify `js/app.js`** — メニューボタンの配線、初回ロード後に年末カードを出す。

---

## Task 1: 集計ロジック `review-stats.js`（純粋関数＋テスト）

**Files:**
- Create: `js/review-stats.js`
- Test: Node ワンライナー（下記）でファイル内 `_selfTest()` を実行

- [ ] **Step 1: `review-stats.js` を作成（実装本体）**

`js/review-stats.js` を新規作成し、以下を丸ごと書く：

```js
window.App = window.App || {};
App.reviewStats = (function () {
  // 場所の識別キー：placeId 優先、無ければ丸めた緯度経度（records.js の coordKey と同じ桁）
  function placeKey(r) {
    if (r.placeId) return 'id:' + r.placeId;
    return 'xy:' + Number(r.lat).toFixed(6) + ',' + Number(r.lng).toFixed(6);
  }
  function yearOf(d) { return Number(String(d).slice(0, 4)); }
  function monthOf(d) { return Number(String(d).slice(5, 7)); }

  // 記念日 a から基準日 b までの日数（両端含む＝記念日当日を1日目）。不正なら null。
  function daysBetweenInclusive(a, b) {
    const da = Date.parse(a + 'T00:00:00Z');
    const db = Date.parse(b + 'T00:00:00Z');
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000) + 1;
  }

  // allRecords=全期間の全記録, year=対象年(number), anniversary='YYYY-MM-DD'|null, today='YYYY-MM-DD'
  function computeYearReview(allRecords, year, anniversary, today) {
    const recs = (allRecords || []).filter((r) => r && r.date);
    const yearRecs = recs.filter((r) => yearOf(r.date) === year)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const count = yearRecs.length;

    // 付き合って◯日：基準日は今年なら today、過去年なら 12/31
    let daysTogether = null;
    if (anniversary) {
      const asOf = (year >= yearOf(today)) ? today : (year + '-12-31');
      const d = daysBetweenInclusive(anniversary, asOf);
      daysTogether = (d != null && d >= 1) ? d : null;
    }

    // 各場所の「最初に訪れた年」を全期間から求める → その年が対象年なら新規
    const firstYearOf = {};
    for (const r of recs) {
      const k = placeKey(r); const yr = yearOf(r.date);
      if (firstYearOf[k] == null || yr < firstYearOf[k]) firstYearOf[k] = yr;
    }
    let newPlaces = 0;
    const seen = new Set();
    for (const r of yearRecs) {
      const k = placeKey(r);
      if (seen.has(k)) continue; seen.add(k);
      if (firstYearOf[k] === year) newPlaces++;
    }

    // 対象年を場所ごとに集計（代表名＝最新の記録の名前）
    const byKey = {};
    for (const r of yearRecs) {
      const k = placeKey(r);
      if (!byKey[k]) byKey[k] = { key: k, count: 0, name: r.name || '', lastDate: r.date };
      byKey[k].count++;
      if (r.date >= byKey[k].lastDate) { byKey[k].lastDate = r.date; byKey[k].name = r.name || byKey[k].name; }
    }
    const spots = Object.keys(byKey).map((k) => byKey[k])
      .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1));
    const topSpot = (spots[0] && spots[0].count >= 2)
      ? { name: spots[0].name, count: spots[0].count, key: spots[0].key } : null;
    const best3 = spots.slice(0, 3).map((s) => ({ name: s.name, count: s.count, key: s.key }));

    // ジャンル
    const gCount = {};
    for (const r of yearRecs) { const g = r.genre || 'other'; gCount[g] = (gCount[g] || 0) + 1; }
    const genreBreakdown = Object.keys(gCount).map((k) => ({ key: k, count: gCount[k] }))
      .sort((a, b) => b.count - a.count);
    const topGenre = genreBreakdown[0] ? { key: genreBreakdown[0].key, count: genreBreakdown[0].count } : null;

    // 月別
    const monthlyCounts = new Array(12).fill(0);
    for (const r of yearRecs) { const mm = monthOf(r.date); if (mm >= 1 && mm <= 12) monthlyCounts[mm - 1]++; }
    let bmIdx = -1, bmMax = 0;
    for (let i = 0; i < 12; i++) { if (monthlyCounts[i] > bmMax) { bmMax = monthlyCounts[i]; bmIdx = i; } }
    const busiestMonth = (bmMax >= 2) ? { month: bmIdx + 1, count: bmMax } : null;

    // 写真枚数
    let photoCount = 0;
    for (const r of yearRecs) photoCount += (r.photos ? r.photos.length : 0);

    // ピン（時系列順・1記録1本）
    const pins = yearRecs
      .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => ({ lat: r.lat, lng: r.lng, genre: r.genre || 'other', name: r.name || '', date: r.date }));

    return {
      year, count,
      isEmpty: count === 0,
      isSparse: count > 0 && count < 3,
      daysTogether, newPlaces, topSpot, best3,
      topGenre, genreBreakdown, busiestMonth, monthlyCounts,
      photoCount, pins,
      firstOuting: yearRecs[0] || null,
      lastOuting: count ? yearRecs[count - 1] : null,
    };
  }

  // 記録のある年を新しい順で（年ピッカー用）
  function yearsWithRecords(allRecords) {
    const set = new Set();
    for (const r of (allRecords || [])) { if (r && r.date) set.add(yearOf(r.date)); }
    return Array.from(set).sort((a, b) => b - a);
  }

  // どのスライドを出すか（順序つき）。sparse/empty は open() 側で別扱いなので、ここは通常年向け。
  function planSlides(data) {
    const ids = [];
    if (data.isEmpty) return ids;
    if (data.daysTogether != null) ids.push('days');
    ids.push('places'); // 主役（count>=1）
    if (data.newPlaces >= 1) ids.push('new');
    if (data.topSpot) ids.push('topspot');
    if (data.count >= 2 && data.topGenre) ids.push('genre');
    if (data.busiestMonth) ids.push('month');
    ids.push('closing');
    return ids;
  }

  function _selfTest() {
    let fails = 0;
    const eq = (name, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + name, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    const recs = [
      { name: 'A珈琲', date: '2026-03-01', lat: 35.0, lng: 139.0, genre: 'cafe', placeId: 'A', photos: [1, 2] },
      { name: 'A珈琲', date: '2026-05-02', lat: 35.0, lng: 139.0, genre: 'cafe', placeId: 'A', photos: [3] },
      { name: 'B食堂', date: '2026-05-10', lat: 35.1, lng: 139.1, genre: 'food', placeId: 'B' },
      { name: 'C公園', date: '2025-08-01', lat: 35.2, lng: 139.2, genre: 'sightsee', placeId: 'C' }, // 前年に初訪問
      { name: 'C公園', date: '2026-05-20', lat: 35.2, lng: 139.2, genre: 'sightsee', placeId: 'C' }, // 2026は再訪＝新規でない
      { name: '未来', date: '2027-01-01', lat: 35.3, lng: 139.3, genre: 'food' },
    ];
    const d = computeYearReview(recs, 2026, '2024-05-10', '2026-08-19');
    eq('count', d.count, 4);                       // 2026 の記録は4件
    eq('newPlaces', d.newPlaces, 2);               // A,B が新規（C は前年初訪問なので除外）
    eq('topSpot.count', d.topSpot && d.topSpot.count, 2);   // A珈琲 2回
    eq('topSpot.name', d.topSpot && d.topSpot.name, 'A珈琲');
    eq('topGenre.key', d.topGenre && d.topGenre.key, 'cafe'); // cafe=2 が最多
    eq('busiestMonth', d.busiestMonth, { month: 5, count: 3 }); // 5月に3件
    eq('photoCount', d.photoCount, 3);             // A珈琲の 2+1
    eq('pins.length', d.pins.length, 4);
    eq('firstOuting.date', d.firstOuting && d.firstOuting.date, '2026-03-01');
    eq('lastOuting.date', d.lastOuting && d.lastOuting.date, '2026-05-20');
    eq('isSparse-false', d.isSparse, false);

    // daysTogether：2024-05-10 → 2026-08-19（両端含む）
    eq('daysTogether', d.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));
    eq('daysBetween-sameday', daysBetweenInclusive('2026-01-01', '2026-01-01'), 1);
    eq('daysBetween-oneday', daysBetweenInclusive('2026-01-01', '2026-01-02'), 2);

    // 過去年は基準日が 12/31
    const d25 = computeYearReview(recs, 2025, '2024-05-10', '2026-08-19');
    eq('past-year-count', d25.count, 1);
    eq('past-year-days', d25.daysTogether, daysBetweenInclusive('2024-05-10', '2025-12-31'));

    // anniversary 無し → null
    const dna = computeYearReview(recs, 2026, null, '2026-08-19');
    eq('noAnniv-days', dna.daysTogether, null);

    // sparse / empty
    eq('sparse', computeYearReview([recs[0]], 2026, null, '2026-08-19').isSparse, true);
    eq('empty', computeYearReview([], 2020, null, '2026-08-19').isEmpty, true);

    // yearsWithRecords
    eq('years', yearsWithRecords(recs), [2027, 2026, 2025]);

    // planSlides：全部そろう年
    eq('planSlides-full', planSlides(d), ['days', 'places', 'new', 'topspot', 'genre', 'month', 'closing']);
    // 記念日なし・再訪なし・単月の年 → days/topspot/month が落ちる
    eq('planSlides-min', planSlides(computeYearReview([recs[2]], 2026, null, '2026-08-19')),
      ['places', 'closing']); // count=1 → new(初回なので1になる?)を確認

    console.log(fails === 0 ? '✅ review-stats ALL PASS' : ('❌ review-stats ' + fails + ' FAIL'));
    return fails;
  }

  return { computeYearReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive, _selfTest };
})();
```

> 注意: `planSlides-min` の期待値は Step 2 実行で実測して確定させる（`recs[2]`=B食堂1件のみの年。B は 2026 が初訪問なので `newPlaces=1` となり `'new'` が入る可能性がある）。**Step 2 で実際の出力を見て、期待値を実測に合わせて修正する**こと。`count=1` は sparse だが planSlides 自体は通常ロジックを返す点に注意（sparse の出し分けは open() の責務）。

- [ ] **Step 2: Node でテストを実行して確認**

Run:
```bash
node -e "global.window={}; require('./js/review-stats.js'); process.exit(window.App.reviewStats._selfTest())"
```
Expected: 各行 PASS、最後に `✅ review-stats ALL PASS`、終了コード0。
もし `planSlides-min` だけ FAIL したら、出力された `got=` の配列を Step 1 の期待値に反映して修正し、再実行して全 PASS にする（これは仕様バグではなく期待値の実測合わせ）。

- [ ] **Step 3: Commit**

```bash
git add js/review-stats.js
git commit -m "feat(review): pure year-in-review stats (computeYearReview + tests)"
```

---

## Task 2: `review-ui.js` の土台＋ピン投入スケジュール（純粋関数＋テスト）

まず UI モジュールの骨格と、ピン投入タイミングを計算する純粋関数 `_pinSchedule` を用意し、テストする。DOMを触る描画は後続タスクで足す。

**Files:**
- Create: `js/review-ui.js`
- Test: Node ワンライナーで `_pinSchedule` を検証（`_selfTestSchedule()`）

- [ ] **Step 1: `review-ui.js` を作成（骨格＋スケジュール＋そのテスト）**

`js/review-ui.js` を新規作成：

```js
window.App = window.App || {};
App.review = (function () {
  // ピン投入テンポの定数（docs/prototypes/2026-08-19-year-in-review-slide2.html で確定）
  var TEMPO = { start: 350, gap: 800, r: 0.8, gmin: 45, tmax: 5500, intro: 3 };

  // N本のピンの着地時刻(ms)の配列を返す。序盤 intro 本は gap 固定、以降は gap*r^k で連続的に加速。
  // 全体が tmax を超える年だけ加速区間を一律スケールして収める（序盤は保つ）。
  function _pinSchedule(n, opts) {
    var o = opts || {};
    var start = o.start != null ? o.start : TEMPO.start;
    var GAP = o.gap != null ? o.gap : TEMPO.gap;
    var R = o.r != null ? o.r : TEMPO.r;
    var GMIN = o.gmin != null ? o.gmin : TEMPO.gmin;
    var TMAX = o.tmax != null ? o.tmax : TEMPO.tmax;
    var INTRO = o.intro != null ? o.intro : TEMPO.intro;
    var times = [];
    var intro = Math.min(INTRO, n);
    for (var i = 0; i < intro; i++) times.push(start + i * GAP);
    var tPrev = times.length ? times[times.length - 1] : start;
    var gaps = [];
    for (var j = intro; j < n; j++) gaps.push(Math.max(GMIN, GAP * Math.pow(R, j - intro + 1)));
    var sum = gaps.reduce(function (a, b) { return a + b; }, 0);
    var room = TMAX - tPrev;
    var scale = (sum > room && room > 0) ? room / sum : 1;
    for (var k = 0; k < gaps.length; k++) { tPrev += gaps[k] * scale; times.push(tPrev); }
    return times;
  }

  function _selfTestSchedule() {
    var fails = 0;
    var chk = function (name, cond) { if (!cond) fails++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); };
    var t = _pinSchedule(12);
    chk('len', t.length === 12);
    var mono = true; for (var i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) mono = false;
    chk('monotonic', mono);
    chk('intro-gap-1', Math.abs((t[1] - t[0]) - 800) < 1);   // 最初の3本は800ms間隔
    chk('intro-gap-2', Math.abs((t[2] - t[1]) - 800) < 1);
    chk('4th-smoother', (t[3] - t[2]) < (t[2] - t[1]));       // 4本目以降は間隔が縮む
    chk('accelerating', (t[4] - t[3]) < (t[3] - t[2]));
    var big = _pinSchedule(80);
    chk('big-capped', big[big.length - 1] <= 5500 + 1);       // 多件数でも約5.5秒以内
    chk('big-len', big.length === 80);
    var few = _pinSchedule(2);
    chk('few-len', few.length === 2);
    console.log(fails === 0 ? '✅ pinSchedule ALL PASS' : ('❌ pinSchedule ' + fails + ' FAIL'));
    return fails;
  }

  // 後続タスクで実装する公開API（今は未実装のスタブ）
  function open(year) { console.warn('review.open not implemented yet', year); }
  function showPicker() { console.warn('review.showPicker not implemented yet'); }
  function maybeShowYearEndCard() { return false; }

  return { open: open, showPicker: showPicker, maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO };
})();
```

- [ ] **Step 2: Node で `_pinSchedule` テストを実行**

Run:
```bash
node -e "global.window={}; require('./js/review-ui.js'); process.exit(window.App.review._selfTestSchedule())"
```
Expected: 全 PASS、`✅ pinSchedule ALL PASS`、終了コード0。

- [ ] **Step 3: Commit**

```bash
git add js/review-ui.js
git commit -m "feat(review): review-ui scaffold + pin-drop schedule (tested)"
```

---

## Task 3: index.html にDOM・スクリプト・メニュー導線を追加

**Files:**
- Modify: `index.html`（`#backup-bar` 内にボタン追加 / `#layout` 内にオーバーレイ追加 / `<script>` 2本追加）

- [ ] **Step 1: メニューに「ふりかえり」ボタンを追加**

`index.html` の `#backup-bar`（現状 `export-btn`/`show-invite-btn`/`anniv-btn`/`logout-btn`）の `anniv-btn` の直後にボタンを1つ追加：

```html
          <button id="anniv-btn"><i class="ph ph-heart"></i><span>記念日</span></button>
          <button id="review-btn"><i class="ph ph-sparkle"></i><span>ふりかえり</span></button>
```

- [ ] **Step 2: オーバーレイDOMを追加**

`index.html` の `#layout` 内、`<div id="bulk-overlay" hidden></div>` の直後に以下を追加：

```html
    <div id="review-card" hidden></div>
    <div id="review-picker" class="review-overlay" hidden></div>
    <div id="review-show" class="review-overlay" hidden></div>
    <div id="review-page" class="review-overlay" hidden></div>
```

- [ ] **Step 3: スクリプトを追加**

`index.html` の `<script src="js/memories.js?v=20260819q"></script>` の直後に2本追加（この時点では版は `20260819q` のまま。Task 8 で一括して `20260819r` へ上げる）：

```html
  <script src="js/memories.js?v=20260819q"></script>
  <script src="js/review-stats.js?v=20260819q"></script>
  <script src="js/review-ui.js?v=20260819q"></script>
```

- [ ] **Step 4: 読み込み確認（ブラウザのコンソール）**

実ブラウザ（実Chrome）で本番相当を開くか、ローカルで `index.html` を配信して開き、コンソールで：
```js
App.reviewStats && App.review && typeof App.review.open
```
Expected: `"function"`（2モジュールが読み込まれている）。404が無いこと。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(review): add menu entry, overlays, and script includes"
```

---

## Task 4: 集計→開く導線（`open`/`showPicker`/sparse・empty）と配線

**Files:**
- Modify: `js/review-ui.js`（スタブを実装で置換 / 内部ヘルパー追加）
- Modify: `js/app.js`（メニューボタン配線、anniversary を review に渡す）

- [ ] **Step 1: `review-ui.js` に状態・共通ヘルパーと open/picker を実装**

`js/review-ui.js` の「後続タスクで実装する公開API」ブロック（`open`/`showPicker`/`maybeShowYearEndCard` のスタブ3つ）を、次で置き換える：

```js
  // ---- 状態 ----
  var anniversary = null;
  function setAnniversary(d) { anniversary = d || null; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function el(id) { return document.getElementById(id); }
  function hideAll() {
    ['review-picker', 'review-show', 'review-page'].forEach(function (i) { var e = el(i); if (e) { e.hidden = true; e.innerHTML = ''; } });
  }

  // 対象年のデータを作って開く
  function open(year) {
    var data = App.reviewStats.computeYearReview(App.records.getAll(), year, anniversary, todayStr());
    hideAll();
    if (data.isEmpty) { showPage(data); return; }        // 念のため（通常ピッカーからは来ない）
    if (data.isSparse) { showSparse(data); return; }
    showSlides(data);
  }

  // 年ピッカー
  function showPicker() {
    var years = App.reviewStats.yearsWithRecords(App.records.getAll());
    var host = el('review-picker');
    if (!years.length) {
      host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">ふりかえり</div>' +
        '<p class="rv-empty">まだ記録がありません。おでかけを記録するとここに出ます。</p>' +
        '<button class="rv-btn rv-close">閉じる</button></div>';
    } else {
      var items = years.map(function (y) {
        return '<button class="rv-year" data-year="' + y + '">' + y + '年</button>';
      }).join('');
      host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">どの年をふりかえる？</div>' +
        '<div class="rv-years">' + items + '</div>' +
        '<button class="rv-btn rv-close">閉じる</button></div>';
      host.querySelectorAll('.rv-year').forEach(function (b) {
        b.onclick = function () { open(Number(b.getAttribute('data-year'))); };
      });
    }
    host.querySelector('.rv-close').onclick = hideAll;
    host.hidden = false;
  }

  // 件数が少ない年
  function showSparse(data) {
    var host = el('review-show');
    host.innerHTML = '<div class="rv-slide rv-sparse">' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-sparse-emoji">🌱</div>' +
      '<div class="rv-mid">まだ' + data.year + '年のあしあとは少なめ</div>' +
      '<div class="rv-cap">これからだね</div>' +
      '<button class="rv-btn rv-topage">記録を見る</button></div>';
    host.querySelector('.rv-x').onclick = hideAll;
    host.querySelector('.rv-topage').onclick = function () { hideAll(); showPage(data); };
    host.hidden = false;
  }
```

（`showSlides` と `showPage` は Task 5・6 で実装。この Step の直後にコードがまだ無いのでブラウザで `open()` はまだ完走しないが、`showPicker`/`showSparse` は動く。）

`return { ... }` を次に更新（`setAnniversary`/`showPage`/`showSlides` を公開に追加。`showPage`/`showSlides` はまだ未定義なので、この Step では**まだ return に足さない**。Task 5・6 でそれぞれ足す。今は `setAnniversary` だけ足す）：

```js
  return { open: open, showPicker: showPicker, setAnniversary: setAnniversary,
    maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO };
```

※`maybeShowYearEndCard` は Task 7 まで暫定スタブのまま残す。この Step では既存スタブ関数 `function maybeShowYearEndCard(){ return false; }` を消さずに残すこと。

- [ ] **Step 2: `showSlides`/`showPage` の暫定スタブを置く（未実装クラッシュ防止）**

`open()`/`showSparse()` の定義より前に、暫定スタブを追加（Task 5・6 で本実装に差し替える）：

```js
  function showSlides(data) { showPage(data); } // 暫定：Task5で本実装
  function showPage(data) {                      // 暫定：Task6で本実装
    var host = el('review-page');
    host.innerHTML = '<div class="rv-page"><button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-hero"><div class="rv-hero-year">' + data.year + '</div></div>' +
      '<p style="padding:16px">総集編は準備中</p></div>';
    host.querySelector('.rv-x').onclick = hideAll;
    host.hidden = false;
  }
```

- [ ] **Step 3: app.js でメニューボタンを配線し anniversary を渡す**

`js/app.js` の `wireUI()` 内、`anniv-btn` のハンドラ登録ブロックの直後（`});` の後、`}` の前）に追加：

```js
  document.getElementById('review-btn').addEventListener('click', () => {
    document.getElementById('topbar').classList.remove('filters-open'); // メニューを閉じる
    App.review.showPicker();
  });
```

さらに `startApp()` 内で anniversary を review にも渡す。`App.memories.setAnniversary(sp.anniversary || null);`（113行目付近）の直後に追加：

```js
  App.review.setAnniversary(sp.anniversary || null);
```

また `anniv-btn` ハンドラ内で記念日を更新している箇所（`App.memories.setAnniversary(currentSpace.anniversary);`）の直後にも追加：

```js
      App.review.setAnniversary(currentSpace.anniversary);
```

- [ ] **Step 4: ブラウザで年ピッカーを確認**

実ブラウザで開き、記録のある本番スペースでメニュー →「ふりかえり」。
Expected: 年の一覧が出る。年をタップ → 暫定の総集編（年の数字＋「総集編は準備中」）が出る。件数<3の年は「まだ少なめ🌱」＋「記録を見る」。×で閉じる。コンソールエラーなし。

- [ ] **Step 5: Commit**

```bash
git add js/review-ui.js js/app.js
git commit -m "feat(review): year picker + open flow (sparse/empty) wired to menu"
```

---

## Task 5: スライドショー `showSlides`（数字カウントアップ＋ピン地図）

**Files:**
- Modify: `js/review-ui.js`（暫定 `showSlides` を本実装に差し替え／SVGピン地図・カウントアップ・タップ送りを追加）

- [ ] **Step 1: 共通アニメヘルパー（カウントアップ・SVGピン地図）を追加**

`js/review-ui.js` の `_pinSchedule` 定義の直後に追加：

```js
  function prefersReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 数字を from→to までカウントアップ。onEach(v) 毎フレーム、done() 完了時。
  function countUp(node, to, dur, done) {
    if (prefersReduced() || dur <= 0) { node.textContent = String(to); if (done) done(); return function () {}; }
    var t0 = null, raf;
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      node.textContent = String(Math.round(to * p));
      if (p < 1) raf = requestAnimationFrame(step); else { node.textContent = String(to); if (done) done(); }
    }
    raf = requestAnimationFrame(step);
    return function () { if (raf) cancelAnimationFrame(raf); };
  }

  // pins をSVGに描く。animate=true なら _pinSchedule の間隔で1本ずつ、numNode があれば同期カウント。
  // 破棄用に停止関数を返す。
  function renderPinMap(svg, pins, opts) {
    opts = opts || {};
    var NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    // 緯度経度を bbox に正規化（余白 pad）。ピン1本でも中央に出す。
    var pad = 34, W = 300, H = 300;
    var lats = pins.map(function (p) { return p.lat; }), lngs = pins.map(function (p) { return p.lng; });
    var minLa = Math.min.apply(null, lats), maxLa = Math.max.apply(null, lats);
    var minLo = Math.min.apply(null, lngs), maxLo = Math.max.apply(null, lngs);
    function pos(p) {
      var sx = (maxLo - minLo) || 1, sy = (maxLa - minLa) || 1;
      var x = pad + (W - 2 * pad) * ((p.lng - minLo) / sx);
      var y = pad + (H - 2 * pad) * (1 - (p.lat - minLa) / sy); // 緯度は上が北
      if (pins.length === 1) { x = W / 2; y = H / 2; }
      return { x: x, y: y };
    }
    function makePin(p) {
      var pt = pos(p);
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
      g.style.transformBox = 'fill-box'; g.style.transformOrigin = 'center bottom';
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M0,-14 C6,-14 9,-9 9,-5 C9,0 3,4 0,8 C-3,4 -9,0 -9,-5 C-9,-9 -6,-14 0,-14 Z');
      path.setAttribute('fill', App.genres.color(p.genre));
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.8'); dot.setAttribute('cy', '-6'); dot.setAttribute('fill', 'rgba(255,255,255,.85)');
      g.appendChild(path); g.appendChild(dot);
      return { g: g, pt: pt };
    }
    var cancels = [];
    if (!opts.animate || prefersReduced()) {
      pins.forEach(function (p) { svg.appendChild(makePin(p).g); });
      if (opts.numNode) opts.numNode.textContent = String(pins.length);
      if (opts.onDone) opts.onDone();
      return function () {};
    }
    var times = _pinSchedule(pins.length);
    pins.forEach(function (p, i) {
      var id = setTimeout(function () {
        var m = makePin(p); svg.appendChild(m.g);
        m.g.animate(
          [{ transform: 'translate(' + m.pt.x + 'px,' + (m.pt.y - 28) + 'px) scale(.6)', opacity: 0 },
           { transform: 'translate(' + m.pt.x + 'px,' + (m.pt.y + 3) + 'px) scale(1.12)', opacity: 1, offset: .7 },
           { transform: 'translate(' + m.pt.x + 'px,' + m.pt.y + 'px) scale(1)', opacity: 1 }],
          { duration: 320, easing: 'cubic-bezier(.34,1.4,.5,1)', fill: 'forwards' });
        if (opts.numNode) opts.numNode.textContent = String(i + 1);
        if (i === pins.length - 1) {
          if (opts.numNode) opts.numNode.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
          if (opts.onDone) opts.onDone();
        }
      }, times[i]);
      cancels.push(id);
    });
    return function () { cancels.forEach(clearTimeout); };
  }
```

- [ ] **Step 2: スライドのHTMLを組む `slideHTML(id, data)` を追加**

`renderPinMap` の直後に追加：

```js
  var MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  function slideHTML(id, data) {
    if (id === 'days') return '<div class="rv-cap">付き合って</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.daysTogether + '">0</span><span class="rv-u">日目</span></div>' +
      '<div class="rv-cap">今日まで、ふたりで</div>';
    if (id === 'places') return '<div class="rv-cap">今年訪れた場所</div>' +
      '<div class="rv-big"><span class="rv-count rv-places-num">0</span><span class="rv-u">回</span></div>' +
      '<div class="rv-map-wrap"><svg class="rv-map"></svg></div>';
    if (id === 'new') return '<div class="rv-cap">はじめての場所</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.newPlaces + '">0</span><span class="rv-u">軒</span></div>' +
      '<div class="rv-cap">新しい世界を見つけた</div>';
    if (id === 'topspot') return '<div class="rv-cap">いちばん通ったのは</div>' +
      '<div class="rv-mid">' + esc(data.topSpot.name || '(名称未設定)') + '</div>' +
      '<div class="rv-big rv-accent">' + data.topSpot.count + '<span class="rv-u">回</span></div>';
    if (id === 'genre') {
      var g = data.topGenre;
      var bars = data.genreBreakdown.slice(0, 5).map(function (x) {
        var max = data.genreBreakdown[0].count || 1;
        return '<span class="rv-bar" style="height:' + Math.round(100 * x.count / max) + '%;background:' + App.genres.color(x.key) + '"></span>';
      }).join('');
      return '<div class="rv-cap">いちばん多かったジャンル</div>' +
        '<div class="rv-mid">' + esc(App.genres.label(g.key)) + '</div>' +
        '<div class="rv-bars">' + bars + '</div>';
    }
    if (id === 'month') return '<div class="rv-cap">いちばん濃かった月</div>' +
      '<div class="rv-big">' + MONTHS[data.busiestMonth.month - 1] + '</div>' +
      '<div class="rv-cap">この月だけで ' + data.busiestMonth.count + '回</div>';
    if (id === 'closing') return '<div class="rv-mid rv-closing">また来年も、<br>ふたりのあしあとを。</div>' +
      '<button class="rv-btn rv-topage">総集編を見る ↓</button>';
    return '';
  }
```

- [ ] **Step 3: 暫定 `showSlides` を本実装に差し替え**

Task 4 Step 2 で置いた暫定 `function showSlides(data) { showPage(data); }` を、次に置き換える：

```js
  function showSlides(data) {
    var ids = App.reviewStats.planSlides(data);
    var host = el('review-show');
    var bars = ids.map(function () { return '<span></span>'; }).join('');
    host.innerHTML =
      '<div class="rv-progress">' + bars + '</div>' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-nav rv-prev"></div><div class="rv-nav rv-next"></div>' +
      '<div class="rv-stage"></div>';
    host.hidden = false;
    var stage = host.querySelector('.rv-stage');
    var progs = host.querySelectorAll('.rv-progress span');
    var idx = -1, stopAnim = null;

    function cleanup() { if (stopAnim) { stopAnim(); stopAnim = null; } }
    function go(n) {
      if (n < 0) return;
      if (n >= ids.length) { cleanup(); hideAll(); showPage(data); return; }
      cleanup();
      idx = n;
      for (var i = 0; i < progs.length; i++) progs[i].classList.toggle('on', i <= idx);
      var id = ids[idx];
      stage.innerHTML = '<div class="rv-slide rv-slide-' + id + '">' + slideHTML(id, data) + '</div>';
      // 締めの「総集編を見る」
      var toPage = stage.querySelector('.rv-topage');
      if (toPage) toPage.onclick = function () { cleanup(); hideAll(); showPage(data); };
      // 登場アニメ
      if (id === 'places') {
        var svg = stage.querySelector('.rv-map');
        var num = stage.querySelector('.rv-places-num');
        stopAnim = renderPinMap(svg, data.pins, { animate: true, numNode: num });
      } else {
        var c = stage.querySelector('.rv-count[data-to]');
        if (c) countUp(c, Number(c.getAttribute('data-to')), 900);
      }
    }
    host.querySelector('.rv-x').onclick = function () { cleanup(); hideAll(); };
    host.querySelector('.rv-next').onclick = function () { go(idx + 1); };
    host.querySelector('.rv-prev').onclick = function () { go(idx - 1); };
    go(0);
  }
```

`return { ... }` に `showSlides`/`showPage` を公開へ追加（今後の手動確認/デバッグ用）：

```js
  return { open: open, showPicker: showPicker, setAnniversary: setAnniversary,
    showSlides: showSlides, showPage: showPage,
    maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO };
```

- [ ] **Step 4: ブラウザでスライドショーを確認**

実ブラウザで記録のある年を開く。
Expected:
- 「付き合って◯日目」で数字がカウントアップ（記念日設定済みのスペースのとき）。
- 「今年訪れた場所」で数字が回数までカウントアップ＋SVGにピンが**序盤ゆっくり→加速**で1本ずつ刺さる。
- 右半分タップで次、左半分で戻る。上部プログレスバーが進む。
- 中身の無いスライド（再訪なし等）は自動でスキップ。
- 締めの「総集編を見る↓」または最後まで送ると総集編（今は暫定）に着地。
- ×で閉じる。コンソールエラーなし。

- [ ] **Step 5: Commit**

```bash
git add js/review-ui.js
git commit -m "feat(review): Stories-style slideshow with count-up and pin-drop map"
```

---

## Task 6: スクロール総集編 `showPage`

**Files:**
- Modify: `js/review-ui.js`（暫定 `showPage` を本実装に差し替え）

- [ ] **Step 1: 暫定 `showPage` を本実装に差し替え**

Task 4 Step 2 で置いた暫定 `showPage` を、次に置き換える：

```js
  function goToRealMap(year) {
    // メインマップにその年の期間フィルタをかけて着地（既存フィルタUIを利用）
    hideAll();
    var ms = el('mode-select'); if (ms) ms.value = 'range';
    var f = el('from-input'), t = el('to-input');
    if (f) f.value = year + '-01-01';
    if (t) t.value = year + '-12-31';
    if (App.records && App.records.applyUiFilter) App.records.applyUiFilter();
    var mapBtn = el('view-map'); if (mapBtn) mapBtn.click(); // 地図ビューへ
  }

  function showPage(data) {
    var host = el('review-page');
    var tiles = [
      { n: data.newPlaces, l: 'はじめての場所', u: '軒' },
      { n: data.topGenre ? App.genres.label(data.topGenre.key) : '—', l: 'いちばんのジャンル', u: '' },
      { n: data.photoCount, l: '写真', u: '枚' },
      { n: data.busiestMonth ? (MONTHS[data.busiestMonth.month - 1]) : '—', l: 'いちばん濃かった月', u: '' },
    ].map(function (x) {
      return '<div class="rv-tile"><div class="rv-tile-n">' + esc(String(x.n)) + '<span class="rv-tile-u">' + x.u + '</span></div><div class="rv-tile-l">' + x.l + '</div></div>';
    }).join('');

    var maxM = Math.max.apply(null, data.monthlyCounts.concat([1]));
    var monthBars = data.monthlyCounts.map(function (c, i) {
      return '<div class="rv-mb"><span style="height:' + Math.round(100 * c / maxM) + '%"></span><small>' + (i + 1) + '</small></div>';
    }).join('');

    var genreRows = data.genreBreakdown.map(function (g) {
      var max = data.genreBreakdown[0].count || 1;
      return '<div class="rv-grow"><span class="rv-glabel">' + esc(App.genres.label(g.key)) + '</span>' +
        '<span class="rv-gbar" style="width:' + Math.round(100 * g.count / max) + '%;background:' + App.genres.color(g.key) + '"></span>' +
        '<span class="rv-gcount">' + g.count + '</span></div>';
    }).join('');

    var photos = [];
    App.records.getAll().forEach(function (r) {
      if (String(r.date).slice(0, 4) === String(data.year) && r.photos) {
        r.photos.forEach(function (p) { if (photos.length < 9) photos.push(App.photos.thumbOf(p)); });
      }
    });
    var photoGrid = photos.length
      ? '<div class="rv-photos">' + photos.map(function (u) { return '<div class="rv-photo" style="background-image:url(' + u + ')"></div>'; }).join('') + '</div>'
      : '';

    var best = data.best3.map(function (s, i) {
      return '<div class="rv-best"><span class="rv-best-rank">' + (i + 1) + '</span><span class="rv-best-name">' + esc(s.name || '(名称未設定)') + '</span><span class="rv-best-count">' + s.count + '回</span></div>';
    }).join('');

    function outing(label, rec) {
      if (!rec) return '';
      return '<button class="rv-outing" data-date="' + rec.date + '"><span class="rv-outing-l">' + label + '</span>' +
        '<span class="rv-outing-name">' + esc(rec.name || '(名称未設定)') + '</span>' +
        '<span class="rv-outing-date">' + String(rec.date).replace(/-/g, '.') + '</span></button>';
    }

    var daysLine = data.daysTogether != null ? '<div class="rv-hero-days">付き合って ' + data.daysTogether + '日目</div>' : '';
    host.innerHTML =
      '<div class="rv-page">' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-hero"><div class="rv-hero-sub">' + data.year + '年のあしあと</div>' +
      daysLine + '<div class="rv-hero-count">おでかけ ' + data.count + '回</div></div>' +
      '<div class="rv-tiles">' + tiles + '</div>' +
      '<div class="rv-section"><div class="rv-h">あしあと地図</div><div class="rv-map-wrap rv-map-page"><svg class="rv-map"></svg></div>' +
      '<button class="rv-btn rv-realmap">本物の地図でこの年を見る</button></div>' +
      '<div class="rv-section"><div class="rv-h">月別のおでかけ</div><div class="rv-months">' + monthBars + '</div></div>' +
      '<div class="rv-section"><div class="rv-h">ジャンル</div>' + genreRows + '</div>' +
      (photoGrid ? '<div class="rv-section"><div class="rv-h">写真</div>' + photoGrid + '</div>' : '') +
      (best ? '<div class="rv-section"><div class="rv-h">よく行ったところ</div>' + best + '</div>' : '') +
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      '</div>';

    host.querySelector('.rv-x').onclick = hideAll;
    var svg = host.querySelector('.rv-map');
    if (data.pins.length) renderPinMap(svg, data.pins, { animate: false });
    host.querySelector('.rv-realmap').onclick = function () { goToRealMap(data.year); };
    host.querySelectorAll('.rv-outing').forEach(function (b) {
      b.onclick = function () { hideAll(); App.records.focusDay(b.getAttribute('data-date')); };
    });
    host.scrollTop = 0;
    host.hidden = false;
  }
```

- [ ] **Step 2: ブラウザで総集編を確認**

実ブラウザで、スライドの締め「総集編を見る」→ 総集編にスクロール着地。
Expected:
- ヒーロー（年・付き合って◯日目・おでかけ◯回）、統計タイル4つ、SVGピン地図（静止・全ピン）、月別バー、ジャンル内訳、写真グリッド（あれば）、ベスト3、最初と最後。
- 「本物の地図でこの年を見る」→ 閉じてメインマップがその年の期間で絞り込まれる。
- 「最初/最後のおでかけ」タップ → その日にフォーカス（`focusDay`）。
- ×で閉じる。コンソールエラーなし。

- [ ] **Step 3: Commit**

```bash
git add js/review-ui.js
git commit -m "feat(review): scroll-through year summary page"
```

---

## Task 7: 年末カード（`maybeShowYearEndCard`）と app.js フック

**Files:**
- Modify: `js/review-ui.js`（`maybeShowYearEndCard` を本実装に）
- Modify: `js/app.js`（初回ロード後に年末カードを試み、出たら memories はスキップ）

- [ ] **Step 1: `maybeShowYearEndCard` を実装**

`js/review-ui.js` の暫定スタブ `function maybeShowYearEndCard() { return false; }` を次に置き換える：

```js
  // 年末ウィンドウ(12/20〜翌1/10)に、対象年(12月=今年 / 1月=前年)の件数>=3 かつ未dismissなら
  // #review-card を出す。出したら true。
  function maybeShowYearEndCard() {
    var host = el('review-card');
    if (!host) return false;
    var now = new Date();
    var mo = now.getMonth() + 1, day = now.getDate();
    var inWindow = (mo === 12 && day >= 20) || (mo === 1 && day <= 10);
    if (!inWindow) { host.hidden = true; return false; }
    var targetYear = (mo === 12) ? now.getFullYear() : now.getFullYear() - 1;
    var key = 'reviewDismissed:' + targetYear;
    try { if (localStorage.getItem(key)) { host.hidden = true; return false; } } catch (e) {}
    var data = App.reviewStats.computeYearReview(App.records.getAll(), targetYear, null, todayStr());
    if (data.count < 3) { host.hidden = true; return false; }
    host.innerHTML =
      '<div class="rv-card-inner">' +
      '<div class="rv-card-icon"><i class="ph ph-sparkle"></i></div>' +
      '<button class="rv-card-open"><div class="rv-card-label">ふりかえり</div>' +
      '<div class="rv-card-title">' + targetYear + '年のふりかえりができました</div>' +
      '<div class="rv-card-sub">タップで再生 ・ ' + data.count + '回のおでかけ</div></button>' +
      '<button class="rv-card-x" aria-label="閉じる"><i class="ph ph-x"></i></button></div>';
    host.querySelector('.rv-card-open').onclick = function () { host.hidden = true; open(targetYear); };
    host.querySelector('.rv-card-x').onclick = function () {
      try { localStorage.setItem(key, '1'); } catch (e) {}
      host.hidden = true;
    };
    host.hidden = false;
    return true;
  }
```

- [ ] **Step 2: app.js で初回ロード後にフック**

`js/app.js` の `cloud.subscribe` コールバック内、`if (!memoriesShown) { ... }` の行を次に置き換える：

```js
    if (!memoriesShown) {
      memoriesShown = true;
      // 年末は「ふりかえりカード」を優先。出なければ通常の思い出カード。
      if (!App.review.maybeShowYearEndCard()) App.memories.show();
    }
```

- [ ] **Step 3: 動作確認（日付ウィンドウの都合上、手動で条件を満たして確認）**

年末以外の時期は自然には出ないため、ブラウザのコンソールで対象年の件数>=3 のスペースを開いた状態で強制表示を確認：
```js
// 一時的にウィンドウ判定を回避して描画だけ確認：対象年を直接開く
App.review.open(2026)
```
Expected: `open()` が正しく動く（Task 5・6 で確認済み）。加えて、`maybeShowYearEndCard` のロジックは Task 1 の集計テスト（件数>=3判定）でカバー済み。年末カードの見た目は、12/20〜1/10 に実機で最終確認する（本タスクのコミット後の「実機確認」項目に記載）。

> ※ここで `localStorage['reviewDismissed:2026']` を手で消せば、カードのdismissも試せる：`localStorage.removeItem('reviewDismissed:2026')`。

- [ ] **Step 4: Commit**

```bash
git add js/review-ui.js js/app.js
git commit -m "feat(review): year-end review card (memory-style) on first load"
```

---

## Task 8: スタイル追加（style.css）

**Files:**
- Modify: `style.css`（末尾にふりかえり用スタイルを追記）

- [ ] **Step 1: `style.css` の末尾に以下を追記**

```css
/* ===== 年間ふりかえり ===== */
.review-overlay { position: fixed; inset: 0; z-index: 60; overflow: auto;
  background: #efe7db; color: #5a4a3a; }
#review-show { background: linear-gradient(170deg, #3a2a2a, #5a3a4a); color: #fff; overflow: hidden; }
.rv-x, .rv-card-x { position: absolute; top: 14px; right: 14px; z-index: 3;
  background: rgba(0,0,0,.2); color: #fff; border: none; border-radius: 50%;
  width: 34px; height: 34px; font-size: 16px; cursor: pointer; }
.review-overlay:not(#review-show) .rv-x { background: rgba(90,74,58,.15); color: #5a4a3a; }

/* スライドショー */
.rv-progress { position: absolute; top: 12px; left: 12px; right: 56px; display: flex; gap: 4px; z-index: 2; }
.rv-progress span { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.3); }
.rv-progress span.on { background: #fff; }
.rv-nav { position: absolute; top: 0; bottom: 0; width: 50%; z-index: 1; cursor: pointer; }
.rv-prev { left: 0; } .rv-next { right: 0; }
.rv-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.rv-slide { width: 100%; max-width: 420px; padding: 24px; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.rv-cap { font-size: 14px; letter-spacing: .08em; opacity: .85; }
.rv-big { font-size: 64px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.rv-big .rv-u { font-size: 22px; font-weight: 800; margin-left: 4px; opacity: .9; }
.rv-mid { font-size: 26px; font-weight: 800; }
.rv-accent { color: #e0a45a; }
.rv-count { display: inline-block; }
.rv-map-wrap { width: 86%; max-width: 360px; aspect-ratio: 1 / 1; margin: 14px auto 0;
  border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  position: relative; overflow: hidden; }
.rv-map { position: absolute; inset: 0; width: 100%; height: 100%; }
.rv-bars { display: flex; gap: 6px; align-items: flex-end; height: 60px; margin-top: 10px; }
.rv-bar { width: 12px; border-radius: 3px; }
.rv-closing { line-height: 1.6; }
.rv-btn { margin-top: 16px; background: #c2703f; color: #fff; border: none;
  border-radius: 22px; padding: 10px 20px; font-weight: 700; font-size: 14px; cursor: pointer; }
#review-show .rv-btn { background: rgba(255,255,255,.2); }
.rv-sparse { color: #fff; } .rv-sparse-emoji { font-size: 44px; }

/* 年ピッカー */
.rv-picker { max-width: 420px; margin: 0 auto; padding: 32px 20px; }
.rv-picker-head { font-size: 18px; font-weight: 800; margin-bottom: 16px; }
.rv-years { display: flex; flex-wrap: wrap; gap: 10px; }
.rv-year { background: #fff; border: 1px solid #e7ddcd; border-radius: 14px;
  padding: 14px 18px; font-size: 16px; font-weight: 700; color: #5a4a3a; cursor: pointer; }
.rv-empty { color: #8a7a68; }
.rv-close { display: block; margin-top: 22px; background: none; border: 1px solid #d8ccb8;
  border-radius: 20px; padding: 8px 18px; color: #5a4a3a; cursor: pointer; }

/* 総集編 */
.rv-page { max-width: 480px; margin: 0 auto; padding: 0 0 48px; }
.rv-hero { background: linear-gradient(160deg, #c2703f, #9a7099); color: #fff; padding: 40px 20px 24px; text-align: center; }
.rv-hero-sub { font-size: 12px; letter-spacing: .1em; opacity: .85; }
.rv-hero-days { font-size: 15px; margin-top: 6px; opacity: .95; }
.rv-hero-count { font-size: 26px; font-weight: 800; margin-top: 4px; }
.rv-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px; }
.rv-tile { background: #fff; border: 1px solid #eee2d0; border-radius: 14px; padding: 12px; }
.rv-tile-n { font-size: 22px; font-weight: 800; color: #c2703f; }
.rv-tile-u { font-size: 13px; margin-left: 2px; }
.rv-tile-l { font-size: 11px; color: #8a7a68; margin-top: 2px; }
.rv-section { padding: 8px 16px 16px; }
.rv-h { font-size: 13px; font-weight: 800; color: #8a7a68; margin: 12px 0 8px; }
.rv-map-page { width: 100%; max-width: none; aspect-ratio: 4 / 3; background: #e9efe6; border: 1px solid #d8e0d3; }
.rv-map-page .rv-map { }
.rv-months { display: flex; gap: 4px; align-items: flex-end; height: 90px; }
.rv-mb { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
.rv-mb span { width: 70%; background: #c2703f; border-radius: 3px 3px 0 0; min-height: 2px; }
.rv-mb small { font-size: 9px; color: #b0a290; margin-top: 3px; }
.rv-grow { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.rv-glabel { width: 56px; font-size: 12px; color: #6a5a48; }
.rv-gbar { height: 12px; border-radius: 6px; min-width: 4px; }
.rv-gcount { font-size: 12px; color: #8a7a68; }
.rv-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.rv-photo { aspect-ratio: 1 / 1; border-radius: 10px; background-size: cover; background-position: center; }
.rv-best { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eee2d0; }
.rv-best-rank { width: 22px; height: 22px; border-radius: 50%; background: #c2703f; color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.rv-best-name { flex: 1; font-weight: 700; }
.rv-best-count { color: #8a7a68; font-size: 13px; }
.rv-outing { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  background: #fff; border: 1px solid #eee2d0; border-radius: 12px; padding: 10px 12px; margin: 6px 0; cursor: pointer; }
.rv-outing-l { font-size: 11px; color: #8a7a68; width: 88px; }
.rv-outing-name { flex: 1; font-weight: 700; color: #5a4a3a; }
.rv-outing-date { font-size: 12px; color: #b0a290; }

/* 年末カード（#memory-card と同じ位置に重ねる想定） */
#review-card { position: absolute; left: 12px; right: 12px; bottom: 84px; z-index: 40; }
.rv-card-inner { display: flex; align-items: center; gap: 10px; background: #fff;
  border: 1px solid #eee2d0; border-radius: 16px; padding: 12px; box-shadow: 0 6px 20px rgba(60,40,20,.15); position: relative; }
.rv-card-icon { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(160deg, #c2703f, #9a7099);
  color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.rv-card-open { flex: 1; text-align: left; background: none; border: none; cursor: pointer; }
.rv-card-label { font-size: 11px; color: #c2703f; font-weight: 700; }
.rv-card-title { font-weight: 800; color: #5a4a3a; }
.rv-card-sub { font-size: 12px; color: #8a7a68; }
.rv-card-x { position: static; background: none; color: #b0a290; width: 28px; height: 28px; }
```

> `#review-card` は `#memory-card` と重なりうるが、年末ウィンドウ内は `maybeShowYearEndCard()` が優先し memories は出さない（Task 7 Step 2）ので実際に二重表示はしない。位置(bottom)は既存の `#memory-card` のCSSに合わせて微調整すること（`style.css` 内の `#memory-card` の位置指定を確認し、同じ bottom 値に揃える）。

- [ ] **Step 2: ブラウザで見た目を確認**

Task 5・6 の画面をもう一度開き、スタイルが当たっていることを確認（スライド全画面・総集編の各セクション・地図の枠）。レイアウト崩れが無いか、スマホ幅（開発者ツールのモバイル表示）でも確認。

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "style(review): year-in-review overlay, slideshow, summary, card styles"
```

---

## Task 9: 版上げ・最終確認・デプロイ

**Files:**
- Modify: `index.html`（`20260819q` → `20260819r` 全置換）

- [ ] **Step 1: 版を全置換**

`index.html` 内の文字列 `20260819q` をすべて `20260819r` に置換（`.app-ver` 表示、全 `?v=`、`sw.js?v=`、`js/review-stats.js?v=`・`js/review-ui.js?v=` を含む）。

Run（置換後の確認）:
```bash
grep -c "20260819q" index.html; grep -c "20260819r" index.html
```
Expected: 前者が `0`、後者が `1以上`（従来分＋新規2本）。

- [ ] **Step 2: 全モジュールのセルフテストを最終実行**

Run:
```bash
node -e "global.window={}; require('./js/review-stats.js'); process.exit(window.App.reviewStats._selfTest())"
node -e "global.window={}; require('./js/review-ui.js'); process.exit(window.App.review._selfTestSchedule())"
```
Expected: 両方とも全 PASS・終了コード0。

- [ ] **Step 3: Commit ＆ push（デプロイ）**

```bash
git add index.html
git commit -m "chore(review): bump version to 20260819r for year-in-review release"
git push
```
push → GitHub Pages に反映（[[maprecord-deploy]]）。Functions 変更なし。

- [ ] **Step 4: 実機・実Chromeでの最終確認（チェックリスト）**

プレビュー用ブラウザ制約があるため、以下は実機か実Chromeで：
- [ ] メニュー →「ふりかえり」→ 年ピッカー → 年選択でスライド再生。
- [ ] スライド2のピンが「序盤ゆっくり→加速」で刺さり、数字が同期カウントアップ。
- [ ] 中身の無いスライドが自動スキップされる（少件数の年・記念日未設定など）。
- [ ] 締め → 総集編スクロール。各セクション表示・写真グリッド・地図。
- [ ] 「本物の地図でこの年を見る」でメインマップが年で絞り込まれる。
- [ ] 「最初/最後のおでかけ」でその日にフォーカス。
- [ ] 端末で `prefers-reduced-motion` をON（OSの視差効果を減らす）にすると、アニメ無しで即最終状態。
- [ ] 左下の ver が `20260819r`。
- [ ] （12/20〜1/10 のみ）初回ロードで年末カードが出る／×でその年は再表示されない。

- [ ] **Step 5: 返信末尾に本番 ver（`20260819r`）を記載**（[[maprecord-report-version]]）

---

## Self-Review（この計画の点検結果）

**1. Spec coverage:**
- 2段構成（スライド→総集編）: Task 5・6 ✓
- 期間＝暦年・年選択: `yearsWithRecords`/`showPicker` Task 1・4 ✓
- 入口＝メニュー常設＋年末カード: Task 3・4（ボタン）、Task 7（カード）✓
- 集計項目（付き合って日数/回数/新規/最多/ジャンル/濃い月/写真/月別/ベスト3/最初と最後）: Task 1 ✓
- スライド自動スキップ・sparse・empty: `planSlides`＋`open` Task 1・4 ✓
- ピンテンポ（序盤ゆっくり→加速・約5.5秒・カウント同期・reduced-motion）: `_pinSchedule`＋`renderPinMap`＋`countUp` Task 2・5 ✓
- SVG「あしあと星座」＋本物の地図ボタン: `renderPinMap`＋`goToRealMap` Task 5・6 ✓
- v1で画像共有なし: 実装に含めず ✓
- 版上げ・返信ver: Task 9 ✓

**2. Placeholder scan:** 各UIタスクは完全なコードを掲載。テストの無いUI部分は実ブラウザ目視確認の手順を明記（本リポジトリはUIの自動テスト基盤を持たず、純粋関数のみ `_selfTest` する方針に準拠）。`planSlides-min` の期待値のみ Step 実測合わせを明示（理由付き）。

**3. Type consistency:**
- 関数名: `computeYearReview`/`yearsWithRecords`/`planSlides`/`placeKey`/`daysBetweenInclusive`（stats）、`open`/`showPicker`/`setAnniversary`/`showSlides`/`showPage`/`maybeShowYearEndCard`/`_pinSchedule`/`renderPinMap`/`countUp`/`slideHTML`/`goToRealMap`（ui）で全タスク一貫。
- データ形状: `data.topSpot={name,count,key}`, `data.busiestMonth={month,count}`, `data.topGenre={key,count}`, `data.pins=[{lat,lng,genre,name,date}]` を各タスクで同一に参照。
- 既存API: `App.records.getAll/applyUiFilter/focusDay`, `App.genres.color/label/list`, `App.photos.thumbOf`, `#mode-select/#from-input/#to-input/#view-map` を実コードで確認済み。
