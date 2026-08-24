# ふりかえりの画像保存・共有（年間ポスター） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「今年のあしあと」を1枚の縦長ポスター画像として書き出し、共有シートに渡すか端末に保存できるようにする。あわせて、その前提として「おでかけ」の数え方を記録本数から日数に直す。

**Architecture:** 先に `js/review-stats.js` の集計を直し（誤った数字を画像にして配らないため）、次に `js/review-poster.js` を新設して「データ → PNG Blob」を担わせる。`js/review-ui.js` はボタンの配線と共有/保存だけを持ち、描画ロジックは持たない。

**Tech Stack:** バニラJS（IIFE + `window.App`）、Canvas 2D、Web Share API（`navigator.share` with files）

**元仕様:** [docs/superpowers/specs/2026-08-24-year-poster-share-design.md](../specs/2026-08-24-year-poster-share-design.md)

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/review-stats.js` | 年間集計（純粋関数） | `outingDays` 新設、`monthlyCounts` を日数に、`planSlides` に新スライド |
| `js/review-poster.js` | **新規**。データ → PNG Blob のみ。UI・共有は持たない | 新規作成 |
| `js/review-ui.js` | 描画と配線 | 表示文言の修正、新スライド、保存ボタンと共有処理 |
| `index.html` | 画面とスクリプト | `review-poster.js` の読み込み、版上げ |
| `style.css` | 見た目 | ヘッダーの数字2つ、保存ボタン |

**テストの流儀:** 各モジュールの `_selfTest()` が PASS/FAIL を console に出し、失敗数を返す。node で `window` を差し替えれば純粋関数だけ実行できる（`js/map.js` で実績あり）。canvas 描画と共有は実機確認。

---

### Task 1: `outingDays` と 日数ベースの `monthlyCounts`

**Files:**
- Modify: `js/review-stats.js`

- [ ] **Step 1: 失敗するテストを書く**

`js/review-stats.js` の `_selfTest()` 内、`eq('empty', ...)` の行の**直後**に追加する。既存のテストデータは5月の3件が3日に分かれており、記録本数でも日数でも3になるため**この変更を検出できない**。両者が食い違う専用データを使う:

```js
    // --- おでかけ日数（記録本数と食い違うデータで検証する）---
    // 2月：3件だが全部同じ日 → 1日。7月：2件が別の日 → 2日。
    // 記録本数なら2月(3)が最多、日数なら7月(2)が最多になる。
    const dayRecs = [
      { date: '2026-02-03', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-02-03', lat: 35.1, lng: 139.1, genre: 'cafe' },
      { date: '2026-02-03', lat: 35.2, lng: 139.2, genre: 'food' },
      { date: '2026-07-01', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-07-11', lat: 35.0, lng: 139.0, genre: 'food' },
    ];
    const dd = computeYearReview(dayRecs, 2026, null, '2026-12-31');
    eq('outingDays', dd.outingDays, 3);              // 2/3, 7/1, 7/11
    eq('count-stays-records', dd.count, 5);          // 記録本数は5のまま
    eq('monthly-feb-is-days', dd.monthlyCounts[1], 1);  // 2月は3件だが1日
    eq('monthly-jul-is-days', dd.monthlyCounts[6], 2);  // 7月は2日
    eq('busiestMonth-by-days', dd.busiestMonth, { month: 7, count: 2 }); // 本数基準なら2月になる
    eq('outingDays-empty', computeYearReview([], 2020, null, '2026-12-31').outingDays, 0);
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-stats.js'); process.exit(App.reviewStats._selfTest());"
```

Expected: `FAIL outingDays got=undefined want=3` と `FAIL busiestMonth-by-days got={\"month\":2,\"count\":3} want={\"month\":7,\"count\":2}` が出て、終了コードが 0 以外

- [ ] **Step 3: 実装する**

`js/review-stats.js` の `const count = yearRecs.length;` の**直後**に追加:

```js
    // おでかけ＝記録がある「日」の数（同じ日に何か所まわっても1日）
    const outingDays = new Set(yearRecs.map((r) => r.date)).size;
```

次に `monthlyCounts` の計算（`const monthlyCounts = new Array(12).fill(0);` から始まる2行）を、日数を数える形に置き換える:

```js
    // 月ごとの「おでかけ日数」。同じ日に複数件あっても1日として数える。
    const monthDays = [];
    for (let i = 0; i < 12; i++) monthDays.push(new Set());
    for (const r of yearRecs) { const mm = monthOf(r.date); if (mm >= 1 && mm <= 12) monthDays[mm - 1].add(r.date); }
    const monthlyCounts = monthDays.map((s) => s.size);
```

`busiestMonth` の計算行はそのままでよい（`monthlyCounts` を見ているので自動的に日数基準になる）。

最後に返却オブジェクトの `year, count,` を次に変える:

```js
      year, count, outingDays,
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-stats.js'); process.exit(App.reviewStats._selfTest());"
```

Expected: すべて `PASS`、終了コード0。既存の `eq('busiestMonth', d.busiestMonth, { month: 5, count: 3 })` も通ること（元データの5月は3日に分かれているため日数でも3）

- [ ] **Step 5: コミット**

```bash
git add js/review-stats.js && git commit -m "fix(review): count outings by day, not by record"
```

---

### Task 2: 「ふたりで過ごした日」スライドを追加

**Files:**
- Modify: `js/review-stats.js`（`planSlides` と そのテスト）

- [ ] **Step 1: 失敗するテストを書く**

`js/review-stats.js` の `_selfTest()` にある `eq('planSlides-full', ...)` の行を、新スライドを含む形に書き換える:

```js
    eq('planSlides-full', planSlides(d), ['days', 'outings', 'places', 'new', 'topspot', 'genre', 'month', 'closing']);
```

その直後に追加:

```js
    // 記念日が無くても「ふたりで過ごした日」は出す（付き合って日数とは別物）
    eq('planSlides-outings-without-anniv',
      planSlides(computeYearReview(dayRecs, 2026, null, '2026-12-31')).indexOf('outings') >= 0, true);
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-stats.js'); process.exit(App.reviewStats._selfTest());"
```

Expected: `FAIL planSlides-full`（`outings` が入っていない）

- [ ] **Step 3: 実装する**

`js/review-stats.js` の `planSlides` 内、`if (data.daysTogether != null) ids.push('days');` の**直後**に追加:

```js
    ids.push('outings'); // ふたりで過ごした日数（記念日の有無に関わらず出す）
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-stats.js'); process.exit(App.reviewStats._selfTest());"
```

Expected: すべて `PASS`、終了コード0

- [ ] **Step 5: コミット**

```bash
git add js/review-stats.js && git commit -m "feat(review): add outing-days slide to the slideshow plan"
```

---

### Task 3: 表示文言の修正と新スライドの描画

**Files:**
- Modify: `js/review-ui.js`
- Modify: `style.css`

- [ ] **Step 1: 新スライドの中身を追加**

`js/review-ui.js` の `slideHTML` 内、`if (id === 'days')` のブロック（3行）の**直後**に追加:

```js
    if (id === 'outings') return '<div class="rv-cap">ふたりで過ごした日</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.outingDays + '">0</span><span class="rv-u">日</span></div>' +
      '<div class="rv-cap">' + data.count + 'か所をめぐった</div>';
```

- [ ] **Step 2: 「今年訪れた場所」の単位を か所 に直す**

同じく `slideHTML` 内の `if (id === 'places')` のブロックで、単位の `回` を `か所` に変える。該当行を次に置き換える:

```js
    if (id === 'places') return '<div class="rv-cap">今年訪れた場所</div>' +
      '<div class="rv-big"><span class="rv-count rv-places-num">0</span><span class="rv-u">か所</span></div>' +
      '<div class="rv-map-wrap"><div class="rv-map"></div></div>';
```

- [ ] **Step 3: 「いちばん濃かった月」の単位を 日 に直す**

同じく `slideHTML` 内、`if (id === 'month')` のブロックの最終行 `'<div class="rv-cap">この月だけで ' + data.busiestMonth.count + '回</div>';` を次に変える:

```js
      '<div class="rv-cap">この月だけで ' + data.busiestMonth.count + '日</div>';
```

- [ ] **Step 4: 総集編ヘッダーに2つの数字を出す**

`js/review-ui.js` の `showPage` 内、`daysLine + '<div class="rv-hero-count">おでかけ ' + data.count + '回</div></div>' +` を次に置き換える:

```js
      daysLine + '<div class="rv-hero-count">おでかけ ' + data.outingDays + '日</div>' +
      '<div class="rv-hero-sub2">訪れた場所 ' + data.count + 'か所</div></div>' +
```

- [ ] **Step 5: 思い出カードの文言を直す**

`js/review-ui.js` の `'<div class="rv-card-sub">タップで再生 ・ ' + data.count + '回のおでかけ</div></button>' +` を次に置き換える:

```js
      '<div class="rv-card-sub">タップで再生 ・ ' + data.outingDays + '日のおでかけ</div></button>' +
```

- [ ] **Step 6: ヘッダー2行目のスタイルを追加**

`style.css` の `.rv-hero-count` のルールを探し、その**直後**に追加:

```css
/* ヘッダーの2つめの数字（訪れた場所） */
.rv-hero-sub2 { margin-top: 4px; font-size: 14px; color: var(--text-muted); }
```

- [ ] **Step 7: 構文チェック**

```bash
node --check js/review-ui.js && echo OK
```

Expected: `OK`

- [ ] **Step 8: 「◯回」の書き残しが無いか確認**

```bash
grep -n "回のおでかけ\|おでかけ ' + data.count\|data.count + '回" js/review-ui.js || echo "残りなし"
```

Expected: `残りなし`

- [ ] **Step 9: コミット**

```bash
git add js/review-ui.js style.css && git commit -m "feat(review): show outing days and visit count separately"
```

---

### Task 4: `js/review-poster.js` の純粋関数

**Files:**
- Create: `js/review-poster.js`

- [ ] **Step 1: ファイルを作り、失敗するテストを書く**

`js/review-poster.js` を新規作成し、次の内容だけを書く（実装はまだ空）:

```js
window.App = window.App || {};
// 年間ふりかえりを1枚のポスター画像（PNG）にする。UI・共有処理は持たない。
App.reviewPoster = (function () {
  const COLS = 3, ROWS = 5, TILES = COLS * ROWS;

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    // 上下左右に同じ写真が並んでいないか
    const noAdjacentDup = (arr, cols) => {
      for (let i = 0; i < arr.length; i++) {
        if (i % cols !== 0 && arr[i] === arr[i - 1]) return false;   // 左
        if (i >= cols && arr[i] === arr[i - cols]) return false;      // 上
      }
      return true;
    };
    const seq = (n) => Array.from({ length: n }, (_, i) => 'p' + i);

    // pickPosterPhotos：多い年は1年に散らして間引く
    const p30 = pickPosterPhotos(seq(30), TILES, COLS);
    eq('pick30-length', p30.length, 15);
    eq('pick30-first', p30[0], 'p0');
    eq('pick30-last', p30[14], 'p29');
    eq('pick15-identity', pickPosterPhotos(seq(15), TILES, COLS), seq(15));

    // 足りない年は繰り返して埋める。隣に同じ写真を置かない。
    [5, 4, 3, 2].forEach((n) => {
      const got = pickPosterPhotos(seq(n), TILES, COLS);
      eq('pick' + n + '-length', got.length, 15);
      eq('pick' + n + '-no-adjacent-dup', noAdjacentDup(got, COLS), true);
    });
    // 1枚しかない年は全面同じになる（許容）
    eq('pick1-all-same', pickPosterPhotos(['p0'], TILES, COLS).join(','), new Array(15).fill('p0').join(','));
    eq('pick0-empty', pickPosterPhotos([], TILES, COLS), []);

    // statLines
    const full = { outingDays: 28, count: 42, photoCount: 128, daysTogether: 830 };
    eq('stat-2-lines', statLines(full).length, 2);
    eq('stat-line1', statLines(full)[0], 'おでかけ 28日 ・ 訪れた場所 42か所 ・ 写真 128枚');
    eq('stat-line2', statLines(full)[1], '付き合って 830日目');
    const noAnniv = { outingDays: 28, count: 42, photoCount: 128, daysTogether: null };
    eq('stat-1-line-without-anniv', statLines(noAnniv).length, 1);
    eq('stat-no-newplaces', statLines(full).join('').indexOf('はじめて'), -1);

    // tileRects：隙間なく敷き詰める
    const rects = tileRects(1080, 1920, COLS, ROWS);
    eq('tiles-count', rects.length, 15);
    eq('tiles-cover-canvas', rects.reduce((s, r) => s + r.w * r.h, 0), 1080 * 1920);
    eq('tiles-first-origin', { x: rects[0].x, y: rects[0].y }, { x: 0, y: 0 });
    eq('tiles-last-corner', rects[14].x + rects[14].w, 1080);
    eq('tiles-last-bottom', rects[14].y + rects[14].h, 1920);

    console.log(fails === 0 ? 'ALL PASS (poster)' : (fails + ' FAILED (poster)'));
    return fails;
  }

  return { _selfTest };
})();
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-poster.js'); process.exit(App.reviewPoster._selfTest());"
```

Expected: `ReferenceError: pickPosterPhotos is not defined` で落ちる

- [ ] **Step 3: 純粋関数を実装する**

`js/review-poster.js` の `const COLS = 3, ROWS = 5, TILES = COLS * ROWS;` の**直後**に追加する:

```js
  // 写真をタイル枚数ぶん選ぶ。urls は日付昇順で渡すこと。
  // 多いときは1年に散るよう等間隔で間引き、少ないときは繰り返して埋める。
  function pickPosterPhotos(urls, n, cols) {
    const src = urls || [];
    if (src.length === 0) return [];
    if (src.length >= n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(src[Math.round(i * (src.length - 1) / (n - 1))]);
      return out;
    }
    // 行ごとにずらして、上下でも同じ写真が隣り合わないようにする。
    // 縦の差は (cols + off) % len。これが0だと真上と同じ写真になるので、
    // 0にならない off を選ぶ（len>=2 なら 1 か 2 のどちらかが必ず成立する）。
    const len = src.length;
    const off = (len < 2 || (cols + 1) % len !== 0) ? 1 : 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      out.push(src[(i + row * off) % len]);
    }
    return out;
  }

  // ポスターに載せる数字の行。1行目に数字、2行目に記念日（無ければ1行だけ）。
  function statLines(data) {
    const lines = ['おでかけ ' + data.outingDays + '日 ・ 訪れた場所 ' + data.count + 'か所 ・ 写真 ' + data.photoCount + '枚'];
    if (data.daysTogether != null) lines.push('付き合って ' + data.daysTogether + '日目');
    return lines;
  }

  // 隙間なく敷き詰める矩形。端が1px空かないよう、境界を丸めてから幅を出す。
  function tileRects(w, h, cols, rows) {
    const out = [];
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round(h * r / rows), y1 = Math.round(h * (r + 1) / rows);
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(w * c / cols), x1 = Math.round(w * (c + 1) / cols);
        out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    return out;
  }
```

そして返却を次に変える:

```js
  return { pickPosterPhotos, statLines, tileRects, _selfTest };
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-poster.js'); process.exit(App.reviewPoster._selfTest());"
```

Expected: すべて `PASS`、最後に `ALL PASS (poster)`、終了コード0

- [ ] **Step 5: コミット**

```bash
git add js/review-poster.js && git commit -m "feat(poster): pure helpers for photo picking, stat lines, tiling"
```

---

### Task 5: canvas でポスターを描く

**Files:**
- Modify: `js/review-poster.js`

- [ ] **Step 1: 描画コードを追加**

`js/review-poster.js` の `tileRects` 関数の**直後**に追加する:

```js
  const W = 1080, H = 1920;
  const SHRINK = 8;                 // 1/8に縮小してから戻すことでぼかす
  const CREAM = '#faf6ef';

  // 画像を1枚読む。失敗しても reject せず null を返す（1枚の失敗で全体を止めない）。
  // crossOrigin を付けないと canvas が汚染され、書き出しのときだけ SecurityError になる。
  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // 枠いっぱいに写真を敷く（はみ出す分は切る＝object-fit:cover 相当）
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // 写真が無い年の背景。暖色のグラデーションで成立させる。
  function drawWarmField(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4a3527');
    g.addColorStop(1, '#2c1e16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    [[0.18, 0.12, '#b8825e'], [0.84, 0.26, '#8aa286'], [0.22, 0.78, '#c08a80'], [0.88, 0.9, '#9c92b8']]
      .forEach(([px, py, color]) => {
        const r = ctx.createRadialGradient(w * px, h * py, 0, w * px, h * py, w * 0.6);
        r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
      });
  }

  // 字間を空けて中央に描く。ctx.letterSpacing は対応がまちまちなので1文字ずつ置く。
  function drawSpaced(ctx, text, cx, y, spacing) {
    const chars = String(text).split('');
    let total = 0;
    chars.forEach((c) => { total += ctx.measureText(c).width + spacing; });
    total -= spacing;
    let x = cx - total / 2;
    chars.forEach((c) => {
      ctx.fillText(c, x + ctx.measureText(c).width / 2, y);
      x += ctx.measureText(c).width + spacing;
    });
  }

  // アプリと同じ書体で描くため、canvas に使う前にフォントを読み込ませる。
  // 待たないと日本語が既定ゴシックになり、別物の見た目になる。
  async function ensureFonts() {
    try {
      await Promise.all([
        document.fonts.load('300 152px "Zen Kaku Gothic New"'),
        document.fonts.load('400 30px "Zen Kaku Gothic New"'),
      ]);
      await document.fonts.ready;
    } catch (e) { /* 読めなくても既定書体で続行する */ }
  }

  // data=computeYearReview の戻り値, photoUrls=その年の写真URL（日付昇順）
  async function build(data, photoUrls) {
    await ensureFonts();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // --- 背景：小さく描いて拡大＝ぼかし ---
    const picked = pickPosterPhotos(photoUrls || [], TILES, COLS);
    const imgs = await Promise.all(picked.map(loadImage));
    const usable = imgs.filter(Boolean).length;

    const sw = Math.round(W / SHRINK), sh = Math.round(H / SHRINK);
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d');

    if (usable === 0) {
      drawWarmField(sctx, sw, sh);
    } else {
      const rects = tileRects(sw, sh, COLS, ROWS);
      rects.forEach((r, i) => {
        const img = imgs[i];
        if (img) { drawCover(sctx, img, r.x, r.y, r.w, r.h); }
        else { sctx.fillStyle = '#8d5a3c'; sctx.fillRect(r.x, r.y, r.w, r.h); } // 読めなかった枠
      });
    }

    // 一気に8倍すると角が立つので、2段階で戻して滑らかにする
    const mid = document.createElement('canvas');
    mid.width = Math.round(W / 2); mid.height = Math.round(H / 2);
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingEnabled = true; mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(small, 0, 0, mid.width, mid.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, W, H);

    // --- 暗幕 ---
    ctx.fillStyle = 'rgba(38, 26, 19, 0.55)';
    ctx.fillRect(0, 0, W, H);

    // --- 文字 ---
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '400 20px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    drawSpacedLeft(ctx, 'あしあと', 60, 66, 5);

    ctx.textAlign = 'center';
    ctx.font = '300 152px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(data.year), W / 2, H * 0.31);

    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    drawSpaced(ctx, '年のあしあと', W / 2, H * 0.31 + 118, 9);

    const lines = statLines(data);
    const lineH = 58;
    const blockBottom = H - 120;                    // 下端からの位置は行数に関わらず固定
    const firstY = blockBottom - (lines.length - 1) * lineH;
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(W / 2 - 26, firstY - 62, 52, 1);   // 区切り線
    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    lines.forEach((t, i) => { ctx.fillText(t, W / 2, firstY + i * lineH); });

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('toBlob failed'));
      }, 'image/png');
    });
  }

  // 左揃えで字間を空ける（左上のロゴ用）
  function drawSpacedLeft(ctx, text, x, y, spacing) {
    let cx = x;
    String(text).split('').forEach((c) => {
      ctx.fillText(c, cx, y);
      cx += ctx.measureText(c).width + spacing;
    });
  }
```

返却を次に変える:

```js
  return { build, pickPosterPhotos, statLines, tileRects, _selfTest };
```

- [ ] **Step 2: 純粋関数のテストが壊れていないか確認**

```bash
node -e "globalThis.window=globalThis; require('./js/review-poster.js'); process.exit(App.reviewPoster._selfTest());"
```

Expected: `ALL PASS (poster)`、終了コード0

- [ ] **Step 3: 構文チェック**

```bash
node --check js/review-poster.js && echo OK
```

Expected: `OK`

- [ ] **Step 4: `crossOrigin` の設定漏れが無いか確認**

```bash
grep -n "crossOrigin" js/review-poster.js
```

Expected: `img.crossOrigin = 'anonymous';` が1件見つかる。**無ければ書き出しが SecurityError で失敗する**（描画は成功するので実行するまで気づけない）

- [ ] **Step 5: コミット**

```bash
git add js/review-poster.js && git commit -m "feat(poster): render the year poster to a PNG blob"
```

---

### Task 6: 保存ボタンと共有処理

**Files:**
- Modify: `js/review-ui.js`
- Modify: `style.css`

- [ ] **Step 1: 共有・保存の関数を追加**

`js/review-ui.js` の `function showPage(data) {` の**直前**に追加する:

```js
  // その年の写真URLを日付昇順で集める。並べ替えを忘れると「1年に散らす」が効かない。
  function yearPhotoUrls(year) {
    var urls = [];
    App.records.getAll()
      .filter(function (r) { return String(r.date).slice(0, 4) === String(year); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (r) {
        (r.photos || []).forEach(function (p) {
          var u = App.photos.thumbOf(p);
          if (u) urls.push(u);
        });
      });
    return urls;
  }

  // 画像を共有シートに渡す。使えなければダウンロードに落とす。
  async function sharePoster(blob, year) {
    var name = 'ashiato-' + year + '.png';
    var file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: year + '年のあしあと' });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 本人が閉じただけ。何もしない
        // それ以外は保存に落とす
      }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ボタンから呼ぶ。生成中は押せなくする。
  async function savePoster(btn, data) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      var blob = await App.reviewPoster.build(data, yearPhotoUrls(data.year));
      await sharePoster(blob, data.year);
    } catch (e) {
      console.error('poster failed', e);
      alert('画像を作れませんでした');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }
```

- [ ] **Step 2: 総集編の末尾にボタンを置く**

`js/review-ui.js` の `showPage` 内、`host.innerHTML = ...` の末尾2行が現在こうなっている:

```js
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      '</div>';
```

これを次に置き換える（ページを閉じる `'</div>'` の直前に1行足す）:

```js
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      '<div class="rv-section rv-save-wrap"><button class="rv-save">画像で保存・共有</button></div>' +
      '</div>';
```

続けて、その少し下にある `host.querySelector('.rv-realmap').onclick = function () { goToRealMap(data.year); };` の**直後**に配線を足す:

```js
    var saveBtn = host.querySelector('.rv-save');
    if (saveBtn) saveBtn.onclick = function () { savePoster(saveBtn, data); };
```

- [ ] **Step 3: ボタンのスタイルを追加**

`style.css` の末尾に追加:

```css
/* ふりかえりの画像保存ボタン */
.rv-save-wrap { text-align: center; }
.rv-save { padding: 13px 26px; border-radius: var(--radius-pill); border: 1px solid var(--accent);
  background: var(--surface); color: var(--accent-strong); font-size: 15px; font-weight: 600; }
.rv-save:hover { background: var(--accent-soft); }
.rv-save:disabled { opacity: .6; }
```

- [ ] **Step 4: 構文チェック**

```bash
node --check js/review-ui.js && echo OK
```

Expected: `OK`

- [ ] **Step 5: ボタンが1つだけか確認**

```bash
grep -c "rv-save\b" js/review-ui.js
```

Expected: `2`（HTML内の1つと `querySelector` の1つ）

- [ ] **Step 6: コミット**

```bash
git add js/review-ui.js style.css && git commit -m "feat(review): add poster save/share button to the summary page"
```

---

### Task 7: スクリプト読み込みと版上げ

**Files:**
- Modify: `index.html`

- [ ] **Step 1: `review-poster.js` を読み込む**

`index.html` の `<script src="js/review-ui.js?v=20260824d"></script>` の**直前**に追加する（`review-poster.js` は `review-ui.js` から呼ばれるので先に読ませる）:

```html
  <script src="js/review-poster.js?v=20260824d"></script>
```

- [ ] **Step 2: 版を上げる**

```bash
sed -i 's/20260824d/20260824e/g' index.html
```

- [ ] **Step 3: 置換結果を確認**

```bash
grep -c "20260824e" index.html; grep -c "20260824d" index.html
```

Expected: 1行目が `24`（従来23 ＋ 新しい script 1行）、2行目が `0`（`grep -c` は0件のとき終了コード1を返すが正常）

- [ ] **Step 4: 読み込み順を確認**

```bash
grep -n "review-poster.js\|review-ui.js\|review-stats.js" index.html
```

Expected: `review-stats.js` → `review-poster.js` → `review-ui.js` の順に並んでいる

- [ ] **Step 5: コミット**

```bash
git add index.html && git commit -m "chore: load review-poster.js and bump version to 20260824e"
```

---

### Task 8: 実機での確認

自動テストで拾えない範囲を、ブラウザで実際に触って確認する。

- [ ] **Step 1: ローカルで開く**

```bash
npx --yes serve . -l 8000
```

`http://localhost:8000` を開いてログインし、メニューの「ふりかえり」から年を選ぶ。
（この環境では `python` コマンドが Microsoft Store のスタブに当たって失敗するため使わない。）

- [ ] **Step 2: 自己テストをブラウザでも走らせる**

DevTools のコンソールで実行:

```js
App.reviewStats._selfTest(); App.reviewPoster._selfTest();
```

Expected: どちらも失敗0で、`ALL PASS (poster)` が出る

- [ ] **Step 3: 数え方の修正を確認**

同じ日に2か所以上記録している年で総集編を開く。

Expected: 「おでかけ ◯日」が「訪れた場所 ◯か所」**より小さい**。両方が同じ値なら Task 1 が効いていない

- [ ] **Step 4: 月別グラフを確認**

Expected: 1日に3件ある月の棒が、3ではなく1日ぶんの高さになっている

- [ ] **Step 5: 新スライドを確認**

スライドショーを再生する。

Expected: 「付き合って◯日目」の次に「ふたりで過ごした日 ◯日」が出る。記念日未設定のスペースでも後者は出る

- [ ] **Step 6: ポスターを作る**

総集編の末尾の「画像で保存・共有」を押す。

Expected: ボタンが「作成中…」になり、PCでは PNG がダウンロードされる。画像は 1080×1920

- [ ] **Step 7: 画像の中身を確認**

ダウンロードした画像を開く。

Expected:
- 背景が写真で、**ぼけている**（くっきりなら縮小拡大が効いていない）
- 日本語が**アプリと同じ丸みのある書体**（角ゴシックならフォント待ちが効いていない）
- 「おでかけ ◯日 ・ 訪れた場所 ◯か所 ・ 写真 ◯枚」と「付き合って ◯日目」が出ている
- 「はじめての場所」が**入っていない**

- [ ] **Step 8: 写真が無い年を確認**

写真が1枚も無い年（または記録の無い年の1つ前など、写真ゼロの年）で保存する。

Expected: 例外にならず、暖色のグラデーション背景で数字だけのポスターができる

- [ ] **Step 9: 記念日未設定を確認**

記念日を未設定にして保存する。

Expected: 「付き合って」行が出ず、数字が1行だけになる。区切り線から下の位置は変わらない

- [ ] **Step 10: CORS の確認（重要）**

写真がある年で保存し、コンソールを見る。

Expected: `SecurityError` が出ない。出る場合は `img.crossOrigin = 'anonymous'` が抜けている

- [ ] **Step 11: スマホで共有を確認**

本番へ反映してから、iPhone で総集編を開き「画像で保存・共有」を押す。

```bash
git push
```

Expected: 共有シートが開き、LINE などに画像を送れる。シートを閉じたときに二重でダウンロードが始まらない

---

## 完了条件

- `node -e "globalThis.window=globalThis; require('./js/review-stats.js'); process.exit(App.reviewStats._selfTest());"` が終了コード0
- `node -e "globalThis.window=globalThis; require('./js/review-poster.js'); process.exit(App.reviewPoster._selfTest());"` が終了コード0
- Task 8 の Step 3〜11 がすべて期待どおり
