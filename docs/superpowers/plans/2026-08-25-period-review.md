# 期間ふりかえり Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ふりかえりの対象を暦年から「期間」へ一般化し、「これまで」と、見出し文字を自分で決められる日付範囲（例「沖縄旅行」）をふりかえれるようにする。

**Architecture:** `{kind, start, end, label}` という period オブジェクトを唯一の起点にする。年のふりかえりも `kind:'year'` の period として扱い、`computeYearReview` は `computePeriodReview` に置き換える（後方互換シムは作らない）。純粋関数（集計・ラベル整形・ポスターの行組み）は `review-stats.js` / `review-poster.js` に閉じ込め、`_selfTest()` で Node から検証する。DOM を触る部分は `review-ui.js` に集める。

**Tech Stack:** 素のブラウザ JS。ビルド無し、テストランナー無し。各モジュールは `window.App.*` に載る IIFE（`review-ui.js` だけ意図的に var/function の ES5 調）。検証は各モジュールの `_selfTest()` を Node で走らせる。

---

## 前提知識（この作業を始める人へ）

**このリポジトリにはテストランナーが無い。** 純粋関数は各モジュール内の `_selfTest()` が `console.log` で PASS/FAIL を出し、失敗数を返す。Node で走らせるときは `global.window` と `global.App` の **両方** を用意する必要がある（モジュールが素の `App` を参照するため）。

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

**キャッシュバスト。** `index.html` はアセットを `?v=<VER>` 付きで読む。デプロイのたびにこの版を上げないと、スマホが古いファイルを掴んで「機能が出てこない」と言われる。`sw.js` は登録 URL の `v` からキャッシュ名を導出するので、`sw.js` 側の編集は不要。今回の版は `20260825a`。

**プレビュー用ブラウザ（mcp）では Google のベクター地図が描画できない。** 地図を含む画面の目視確認は実機か実 Chrome で行うこと。

**ポスターは生成した画像を実際に目で見て確かめる。** ピクセル値の測定だけでは見落とす（前回それでぼかしの不具合を見逃した）。

**設計の根拠:** `docs/superpowers/specs/2026-08-25-period-review-design.md`

---

## File Structure

| ファイル | 責任 | 変更 |
|---|---|---|
| `js/review-stats.js` | 数字とラベルを作る純粋関数だけ。DOM 依存なし | period 生成・整形・バケット・集計を追加/置換 |
| `js/review-poster.js` | 「データ → PNG Blob」だけ。UI・共有は持たない | 見出しの行組みとファイル名を追加、描画を period 対応に |
| `js/review-ui.js` | 画面（ピッカー・スライド・総集編・年末カード）と配線 | period 対応、ピッカーに「これまで」「期間を選ぶ」を追加 |
| `style.css` | 全スタイル。末尾に `rv-*` がまとまっている | 期間フォームと日付行のスタイルを追加 |
| `index.html` | 骨格とアセット読み込み | `?v=` と `ver.` 表示を `20260825a` に |

依存の向きは `stats ← poster ← ui`。`review-poster.js` は `App.reviewStats.formatDateLine` を呼ぶが、`index.html` の読み込み順が stats → poster → ui なので実行時には揃っている。

---

## Task 1: period の生成とラベル整形（review-stats.js）

**Files:**
- Modify: `js/review-stats.js`

- [ ] **Step 1: 失敗するテストを書く**

`js/review-stats.js` の `_selfTest()` の中、`// yearsWithRecords` の行の**直前**に次を挿入する。

```javascript
    // --- period の生成とラベル整形 ---
    eq('year-period', makeYearPeriod(2026),
      { kind: 'year', start: '2026-01-01', end: '2026-12-31', label: '2026' });

    // 同じ年の範囲は年を出さない
    eq('range-label-same-year', formatRangeLabel('2026-03-01', '2026-03-05'), '3/1〜3/5');
    // 年をまたぐ範囲は両側に年を出す
    eq('range-label-cross-year', formatRangeLabel('2025-12-30', '2026-01-03'), '2025/12/30〜2026/1/3');
    // ラベルを渡せばそれを使い、空白だけなら自動生成に落ちる
    eq('range-uses-given-label', makeRangePeriod('2026-03-01', '2026-03-05', '沖縄旅行').label, '沖縄旅行');
    eq('range-trims-label', makeRangePeriod('2026-03-01', '2026-03-05', '  沖縄旅行  ').label, '沖縄旅行');
    eq('range-blank-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', '   ').label, '3/1〜3/5');
    eq('range-null-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', null).label, '3/1〜3/5');
    eq('range-kind', makeRangePeriod('2026-03-01', '2026-03-05', 'x').kind, 'range');

    // 日付行：同じ年なら右側の年を省く
    eq('dateline-same-year',
      formatDateLine({ kind: 'range', start: '2026-03-01', end: '2026-03-05' }), '2026.3.1 〜 3.5');
    eq('dateline-cross-year',
      formatDateLine({ kind: 'range', start: '2025-12-30', end: '2026-01-03' }), '2025.12.30 〜 2026.1.3');
    // 年のふりかえりは見出しの年号が日付を語るので出さない
    eq('dateline-year-empty', formatDateLine(makeYearPeriod(2026)), '');

    // これまで：最古の記録日から。未来の記録があれば today ではなくそこまで伸ばす
    eq('all-period-start', makeAllPeriod(recs, '2026-08-19').start, '2025-08-01');
    eq('all-period-end-covers-future', makeAllPeriod(recs, '2026-08-19').end, '2027-01-01');
    eq('all-period-end-is-today-when-no-future',
      makeAllPeriod([recs[0]], '2026-08-19').end, '2026-08-19');
    eq('all-period-label', makeAllPeriod(recs, '2026-08-19').label, 'これまで');
    eq('all-period-no-records',
      makeAllPeriod([], '2026-08-19'),
      { kind: 'all', start: '2026-08-19', end: '2026-08-19', label: 'これまで' });
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `ReferenceError: makeYearPeriod is not defined` で落ちる。

- [ ] **Step 3: 実装する**

`js/review-stats.js` の `function monthOf(d) { ... }` の行の**直後**に次を挿入する。

```javascript
  function dayOf(d) { return Number(String(d).slice(8, 10)); }

  // 期間ラベルの自動生成。同じ年なら 3/1〜3/5、年をまたぐなら 2025/12/30〜2026/1/3。
  function formatRangeLabel(start, end) {
    var sy = yearOf(start), ey = yearOf(end);
    var s = monthOf(start) + '/' + dayOf(start);
    var e = monthOf(end) + '/' + dayOf(end);
    if (sy === ey) return s + '〜' + e;
    return sy + '/' + s + '〜' + ey + '/' + e;
  }

  // ポスターと総集編に添える控えめな日付行。同じ年なら右側の年を省く。
  // 年のふりかえりは見出しの年号がすでに日付を語っているので出さない。
  function formatDateLine(period) {
    if (!period || period.kind === 'year') return '';
    var sy = yearOf(period.start), ey = yearOf(period.end);
    var left = sy + '.' + monthOf(period.start) + '.' + dayOf(period.start);
    var right = (sy === ey ? '' : ey + '.') + monthOf(period.end) + '.' + dayOf(period.end);
    return left + ' 〜 ' + right;
  }

  function makeYearPeriod(y) {
    return { kind: 'year', start: y + '-01-01', end: y + '-12-31', label: String(y) };
  }

  // 全期間。終了日を today で止めず最新の記録日まで伸ばすのは、
  // 先の日付で入れた記録が「これまで」から黙って消えないようにするため。
  function makeAllPeriod(allRecords, today) {
    var dates = (allRecords || []).filter(function (r) { return r && r.date; })
      .map(function (r) { return String(r.date); }).sort();
    var first = dates.length ? dates[0] : today;
    var last = dates.length ? dates[dates.length - 1] : today;
    return { kind: 'all', start: first, end: (last > today ? last : today), label: 'これまで' };
  }

  // ラベルは任意。空や空白だけなら日付から自動生成する。
  function makeRangePeriod(start, end, label) {
    var t = (label == null ? '' : String(label)).trim();
    return { kind: 'range', start: start, end: end, label: t || formatRangeLabel(start, end) };
  }
```

同じファイル末尾の `return { computeYearReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive, _selfTest };` を次に差し替える。

```javascript
  return { computeYearReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive,
    formatRangeLabel, formatDateLine, makeYearPeriod, makeAllPeriod, makeRangePeriod, _selfTest };
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `✅ review-stats ALL PASS`、終了コード 0。

- [ ] **Step 5: コミットする**

```bash
git add js/review-stats.js && git commit -F - <<'EOF'
feat(review): add period constructors and label formatting

Introduces {kind, start, end, label} periods for year, all-time, and
user-picked ranges, plus the short range label and the small date line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: 月刻み／年刻みのバケット（review-stats.js）

暦月は年専用の概念なので、期間の長さで刻みを切り替える。

**Files:**
- Modify: `js/review-stats.js`

- [ ] **Step 1: 失敗するテストを書く**

`_selfTest()` の中、Task 1 で入れた `// --- period の生成とラベル整形 ---` ブロックの**直後**に挿入する。

```javascript
    // --- バケット（月刻み／年刻み）---
    // 年のふりかえりは1月〜12月の12個。うるう年の366日も月刻みのまま。
    var bYear = bucketize(makeYearPeriod(2026), dayRecs);
    eq('bucket-year-unit', bYear.unit, 'month');
    eq('bucket-year-len', bYear.items.length, 12);
    eq('bucket-year-labels', [bYear.items[0].label, bYear.items[11].label], ['1月', '12月']);
    eq('bucket-year-feb-is-days', bYear.items[1].count, 1);   // 2月は3件だが同じ日なので1日
    eq('bucket-year-jul-is-days', bYear.items[6].count, 2);
    eq('bucket-leap-year-still-month', bucketize(makeYearPeriod(2024), []).unit, 'month');

    // 短い期間はまたぐ月だけ並ぶ
    var bTrip = bucketize(makeRangePeriod('2026-07-01', '2026-07-11', ''), dayRecs);
    eq('bucket-trip-len', bTrip.items.length, 1);
    eq('bucket-trip-count', bTrip.items[0].count, 2);

    // 月をまたぐ短い期間
    var bTwo = bucketize(makeRangePeriod('2026-02-01', '2026-07-31', ''), dayRecs);
    eq('bucket-two-len', bTwo.items.length, 6);               // 2月〜7月
    eq('bucket-two-labels', [bTwo.items[0].label, bTwo.items[5].label], ['2月', '7月']);

    // 年をまたぐ月刻み（366日以内）
    var bCross = bucketize(makeRangePeriod('2025-12-01', '2026-02-28', ''), []);
    eq('bucket-cross-unit', bCross.unit, 'month');
    eq('bucket-cross-len', bCross.items.length, 3);
    eq('bucket-cross-labels', bCross.items.map(function (b) { return b.label; }), ['12月', '1月', '2月']);

    // 366日を超えると年刻み
    var bLong = bucketize(makeRangePeriod('2025-01-01', '2026-12-31', ''), recs);
    eq('bucket-long-unit', bLong.unit, 'year');
    eq('bucket-long-len', bLong.items.length, 2);
    eq('bucket-long-labels', bLong.items.map(function (b) { return b.label; }), ['2025年', '2026年']);
    eq('bucket-long-2025', bLong.items[0].count, 1);
    eq('bucket-long-2026', bLong.items[1].count, 4);

    // pickBusiest：最大が2以上のときだけ。棒が1本しかない期間は情報を持たないので出さない。
    eq('busiest-by-days', pickBusiest(bYear), { label: '7月', count: 2 });
    eq('busiest-null-when-single-bucket', pickBusiest(bTrip), null);
    eq('busiest-null-when-max-is-one', pickBusiest(bucketize(makeYearPeriod(2026), [recs[2]])), null);
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `ReferenceError: bucketize is not defined` で落ちる。

- [ ] **Step 3: 実装する**

`js/review-stats.js` の `function computeYearReview(...)` の行の**直前**に挿入する。

```javascript
  // 期間の刻みを決めてバケットの並びを作る。
  // 366日以内は月刻み（またぐ月だけ並べる）、超えたら年刻み。
  // count は「おでかけ日数」＝同じ日に何か所まわっても1日。
  function bucketize(period, recs) {
    var span = daysBetweenInclusive(period.start, period.end);
    var unit = (span != null && span <= 366) ? 'month' : 'year';
    var items = [];
    if (unit === 'month') {
      var y = yearOf(period.start), m = monthOf(period.start);
      var ey = yearOf(period.end), em = monthOf(period.end);
      while (y < ey || (y === ey && m <= em)) {
        items.push({ key: y + '-' + (m < 10 ? '0' + m : String(m)), label: m + '月', count: 0 });
        m++; if (m > 12) { m = 1; y++; }
      }
    } else {
      for (var yy = yearOf(period.start); yy <= yearOf(period.end); yy++) {
        items.push({ key: String(yy), label: yy + '年', count: 0 });
      }
    }
    var idx = {};
    items.forEach(function (b, i) { idx[b.key] = i; });
    var seen = {}; // バケットごとに数えた日付。重複を弾いて「日数」にする
    (recs || []).forEach(function (r) {
      var k = (unit === 'month') ? String(r.date).slice(0, 7) : String(r.date).slice(0, 4);
      if (idx[k] == null) return;
      if (!seen[k]) seen[k] = {};
      if (seen[k][r.date]) return;
      seen[k][r.date] = 1;
      items[idx[k]].count++;
    });
    return { unit: unit, items: items };
  }

  // いちばん濃かったバケット。棒が1本しかない期間は比較にならないので出さない。
  function pickBusiest(buckets) {
    if (!buckets || buckets.items.length < 2) return null;
    var best = null;
    buckets.items.forEach(function (b) { if (!best || b.count > best.count) best = b; });
    if (!best || best.count < 2) return null;
    return { label: best.label, count: best.count };
  }
```

末尾の `return { ... }` に `bucketize` と `pickBusiest` を足す。

```javascript
  return { computeYearReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive,
    formatRangeLabel, formatDateLine, makeYearPeriod, makeAllPeriod, makeRangePeriod,
    bucketize, pickBusiest, _selfTest };
```

**注意:** `bucketize` のテストは `_selfTest` 内の `dayRecs` と `recs` を参照する。`dayRecs` は既存テストの後半で定義されているので、Task 1 で入れたブロックが `// yearsWithRecords` の直前＝`dayRecs` 定義より後にあることを確認すること。

- [ ] **Step 4: テストが通ることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `✅ review-stats ALL PASS`、終了コード 0。

- [ ] **Step 5: コミットする**

```bash
git add js/review-stats.js && git commit -F - <<'EOF'
feat(review): bucket outings by month or year depending on span

Periods up to 366 days get month buckets covering only the months they
touch; longer ones switch to year buckets. A single-bucket period has no
"busiest" to report.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: computeYearReview を computePeriodReview に置き換える

ここで戻り値の形が変わる（`monthlyCounts`/`busiestMonth` → `buckets`/`busiest`、`year` → `period`）。呼び出し側は Task 6・7 で直すので、このタスクの終わりでは UI は一時的に壊れている。

**Files:**
- Modify: `js/review-stats.js`

- [ ] **Step 1: `_selfTest()` を丸ごと書き替える**

`js/review-stats.js` の `function _selfTest() {` から、その閉じ括弧（`return fails;` の次の `}`）までを、次で置き換える。

```javascript
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
    // 2月：3件だが全部同じ日 → 1日。7月：2件が別の日 → 2日。
    // 記録本数なら2月(3)が最多、日数なら7月(2)が最多になる。
    const dayRecs = [
      { date: '2026-02-03', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-02-03', lat: 35.1, lng: 139.1, genre: 'cafe' },
      { date: '2026-02-03', lat: 35.2, lng: 139.2, genre: 'food' },
      { date: '2026-07-01', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-07-11', lat: 35.0, lng: 139.0, genre: 'food' },
    ];

    // --- period の生成とラベル整形 ---
    eq('year-period', makeYearPeriod(2026),
      { kind: 'year', start: '2026-01-01', end: '2026-12-31', label: '2026' });

    eq('range-label-same-year', formatRangeLabel('2026-03-01', '2026-03-05'), '3/1〜3/5');
    eq('range-label-cross-year', formatRangeLabel('2025-12-30', '2026-01-03'), '2025/12/30〜2026/1/3');
    eq('range-uses-given-label', makeRangePeriod('2026-03-01', '2026-03-05', '沖縄旅行').label, '沖縄旅行');
    eq('range-trims-label', makeRangePeriod('2026-03-01', '2026-03-05', '  沖縄旅行  ').label, '沖縄旅行');
    eq('range-blank-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', '   ').label, '3/1〜3/5');
    eq('range-null-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', null).label, '3/1〜3/5');
    eq('range-kind', makeRangePeriod('2026-03-01', '2026-03-05', 'x').kind, 'range');

    eq('dateline-same-year',
      formatDateLine({ kind: 'range', start: '2026-03-01', end: '2026-03-05' }), '2026.3.1 〜 3.5');
    eq('dateline-cross-year',
      formatDateLine({ kind: 'range', start: '2025-12-30', end: '2026-01-03' }), '2025.12.30 〜 2026.1.3');
    eq('dateline-year-empty', formatDateLine(makeYearPeriod(2026)), '');

    eq('all-period-start', makeAllPeriod(recs, '2026-08-19').start, '2025-08-01');
    eq('all-period-end-covers-future', makeAllPeriod(recs, '2026-08-19').end, '2027-01-01');
    eq('all-period-end-is-today-when-no-future',
      makeAllPeriod([recs[0]], '2026-08-19').end, '2026-08-19');
    eq('all-period-label', makeAllPeriod(recs, '2026-08-19').label, 'これまで');
    eq('all-period-no-records',
      makeAllPeriod([], '2026-08-19'),
      { kind: 'all', start: '2026-08-19', end: '2026-08-19', label: 'これまで' });

    // --- バケット（月刻み／年刻み）---
    const bYear = bucketize(makeYearPeriod(2026), dayRecs);
    eq('bucket-year-unit', bYear.unit, 'month');
    eq('bucket-year-len', bYear.items.length, 12);
    eq('bucket-year-labels', [bYear.items[0].label, bYear.items[11].label], ['1月', '12月']);
    eq('bucket-year-feb-is-days', bYear.items[1].count, 1);
    eq('bucket-year-jul-is-days', bYear.items[6].count, 2);
    eq('bucket-leap-year-still-month', bucketize(makeYearPeriod(2024), []).unit, 'month');

    const bTrip = bucketize(makeRangePeriod('2026-07-01', '2026-07-11', ''), dayRecs);
    eq('bucket-trip-len', bTrip.items.length, 1);
    eq('bucket-trip-count', bTrip.items[0].count, 2);

    const bTwo = bucketize(makeRangePeriod('2026-02-01', '2026-07-31', ''), dayRecs);
    eq('bucket-two-len', bTwo.items.length, 6);
    eq('bucket-two-labels', [bTwo.items[0].label, bTwo.items[5].label], ['2月', '7月']);

    const bCross = bucketize(makeRangePeriod('2025-12-01', '2026-02-28', ''), []);
    eq('bucket-cross-unit', bCross.unit, 'month');
    eq('bucket-cross-len', bCross.items.length, 3);
    eq('bucket-cross-labels', bCross.items.map((b) => b.label), ['12月', '1月', '2月']);

    const bLong = bucketize(makeRangePeriod('2025-01-01', '2026-12-31', ''), recs);
    eq('bucket-long-unit', bLong.unit, 'year');
    eq('bucket-long-len', bLong.items.length, 2);
    eq('bucket-long-labels', bLong.items.map((b) => b.label), ['2025年', '2026年']);
    eq('bucket-long-2025', bLong.items[0].count, 1);
    eq('bucket-long-2026', bLong.items[1].count, 4);

    eq('busiest-by-days', pickBusiest(bYear), { label: '7月', count: 2 });
    eq('busiest-null-when-single-bucket', pickBusiest(bTrip), null);
    eq('busiest-null-when-max-is-one', pickBusiest(bucketize(makeYearPeriod(2026), [recs[2]])), null);

    // --- 年の期間：既存の期待値がそのまま通ること（リグレッション確認）---
    const d = computePeriodReview(recs, makeYearPeriod(2026), '2024-05-10', '2026-08-19');
    eq('count', d.count, 4);
    eq('newPlaces', d.newPlaces, 2);                          // A,B が新規（C は前年初訪問）
    eq('topSpot.count', d.topSpot && d.topSpot.count, 2);
    eq('topSpot.name', d.topSpot && d.topSpot.name, 'A珈琲');
    eq('topGenre.key', d.topGenre && d.topGenre.key, 'cafe');
    eq('busiest', d.busiest, { label: '5月', count: 3 });
    eq('photoCount', d.photoCount, 3);
    eq('pins.length', d.pins.length, 4);
    eq('firstOuting.date', d.firstOuting && d.firstOuting.date, '2026-03-01');
    eq('lastOuting.date', d.lastOuting && d.lastOuting.date, '2026-05-20');
    eq('isSparse-false', d.isSparse, false);
    eq('period-passed-through', d.period.kind, 'year');
    eq('buckets-12', d.buckets.items.length, 12);

    // daysTogether：2024-05-10 → 2026-08-19（両端含む）
    eq('daysTogether', d.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));
    eq('daysBetween-sameday', daysBetweenInclusive('2026-01-01', '2026-01-01'), 1);
    eq('daysBetween-oneday', daysBetweenInclusive('2026-01-01', '2026-01-02'), 2);

    // 過去年は基準日が 12/31
    const d25 = computePeriodReview(recs, makeYearPeriod(2025), '2024-05-10', '2026-08-19');
    eq('past-year-count', d25.count, 1);
    eq('past-year-days', d25.daysTogether, daysBetweenInclusive('2024-05-10', '2025-12-31'));

    eq('noAnniv-days',
      computePeriodReview(recs, makeYearPeriod(2026), null, '2026-08-19').daysTogether, null);
    // 未来の期間は「付き合って◯日目」が無意味なので出さない
    eq('future-year-days',
      computePeriodReview(recs, makeYearPeriod(2027), '2024-05-10', '2026-08-19').daysTogether, null);
    // 期間全体が記念日より前なら出さない
    eq('before-anniversary-days',
      computePeriodReview(recs, makeYearPeriod(2026), '2027-01-01', '2026-08-19').daysTogether, null);

    eq('sparse', computePeriodReview([recs[0]], makeYearPeriod(2026), null, '2026-08-19').isSparse, true);
    eq('empty', computePeriodReview([], makeYearPeriod(2020), null, '2026-08-19').isEmpty, true);

    // おでかけ日数と記録本数は別物
    const dd = computePeriodReview(dayRecs, makeYearPeriod(2026), null, '2026-12-31');
    eq('outingDays', dd.outingDays, 3);
    eq('count-stays-records', dd.count, 5);
    eq('outingDays-empty',
      computePeriodReview([], makeYearPeriod(2020), null, '2026-12-31').outingDays, 0);

    // --- 期間（range）---
    // 5月の3件だけを切り出す。年では再訪だった C公園 も、5月に初めて来ているので新規になる。
    const may = computePeriodReview(recs, makeRangePeriod('2026-05-01', '2026-05-31', '五月'),
      '2024-05-10', '2026-08-19');
    eq('range-count', may.count, 3);
    eq('range-label-kept', may.period.label, '五月');
    eq('range-newPlaces', may.newPlaces, 1);                  // B のみ（A は3月、C は前年が初訪問）
    eq('range-single-bucket-no-busiest', may.busiest, null);
    // 終わった期間なので基準日は today ではなく期間の終了日
    eq('range-days-uses-period-end', may.daysTogether, daysBetweenInclusive('2024-05-10', '2026-05-31'));
    // まだ続いている期間は today で止める
    const ongoing = computePeriodReview(recs, makeRangePeriod('2026-01-01', '2026-12-31', '今'),
      '2024-05-10', '2026-08-19');
    eq('range-days-clamped-to-today', ongoing.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));

    // 終わった旅行は、その期間の終了日が「付き合って◯日目」の基準になる
    const trip = computePeriodReview(recs, makeRangePeriod('2026-03-01', '2026-03-05', '旅行'),
      '2024-05-10', '2026-08-19');
    eq('trip-count', trip.count, 1);
    eq('trip-days-uses-period-end', trip.daysTogether, daysBetweenInclusive('2024-05-10', '2026-03-05'));
    eq('trip-newPlaces', trip.newPlaces, 1);                  // A珈琲はこの日が初訪問

    // --- これまで ---
    const all = computePeriodReview(recs, makeAllPeriod(recs, '2026-08-19'), null, '2026-08-19');
    eq('all-count', all.count, 6);                            // 未来の記録も含む
    eq('all-unit-is-year', all.buckets.unit, 'year');
    eq('all-buckets', all.buckets.items.map((b) => b.label), ['2025年', '2026年', '2027年']);
    eq('all-newPlaces-is-every-place', all.newPlaces, 4);      // A,B,C,未来 すべてが初訪問

    // yearsWithRecords
    eq('years', yearsWithRecords(recs), [2027, 2026, 2025]);

    // planSlides：全部そろう年
    eq('planSlides-full', planSlides(d), ['days', 'outings', 'places', 'new', 'topspot', 'genre', 'busiest', 'closing']);
    // 記念日が無くても「ふたりで過ごした日」は出す（付き合って日数とは別物）
    eq('planSlides-outings-without-anniv',
      planSlides(computePeriodReview(dayRecs, makeYearPeriod(2026), null, '2026-12-31')).indexOf('outings') >= 0, true);
    // 記念日なし・再訪なし・単月 → days/topspot/busiest が落ちる
    eq('planSlides-min',
      planSlides(computePeriodReview([recs[2]], makeYearPeriod(2026), null, '2026-08-19')),
      ['outings', 'places', 'new', 'closing']);
    // 記録1件の旅行でもスライドは出る（しきい値の扱いは open() 側）
    eq('planSlides-one-record-trip', planSlides(trip).length > 0, true);

    console.log(fails === 0 ? '✅ review-stats ALL PASS' : ('❌ review-stats ' + fails + ' FAIL'));
    return fails;
  }
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `ReferenceError: computePeriodReview is not defined` で落ちる。

- [ ] **Step 3: 実装する**

`js/review-stats.js` の `computeYearReview` を丸ごと（先行するコメント行 `// allRecords=全期間の全記録, ...` を含む）次で置き換える。

```javascript
  // allRecords=全期間の全記録, period={kind,start,end,label}, anniversary='YYYY-MM-DD'|null, today='YYYY-MM-DD'
  function computePeriodReview(allRecords, period, anniversary, today) {
    const recs = (allRecords || []).filter((r) => r && r.date);
    const inRecs = recs.filter((r) => String(r.date) >= period.start && String(r.date) <= period.end)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const count = inRecs.length;

    // おでかけ＝記録がある「日」の数（同じ日に何か所まわっても1日）
    const outingDays = new Set(inRecs.map((r) => r.date)).size;

    // 付き合って◯日：基準日は期間の終了日。現在進行中なら今日で止める。
    // 期間まるごとが未来なら出さない（まだ来ていない日を数えても意味がない）。
    let daysTogether = null;
    if (anniversary && period.start <= today) {
      const asOf = (period.end < today) ? period.end : today;
      const d = daysBetweenInclusive(anniversary, asOf);
      daysTogether = (d != null && d >= 1) ? d : null;
    }

    // 各場所の初訪問日を全期間から求める → 期間の開始日以降なら「はじめて」。
    // 年ではなく日付で見るので、年内の短い期間でも正しく判定できる。
    const firstDateOf = {};
    for (const r of recs) {
      const k = placeKey(r); const dt = String(r.date);
      if (firstDateOf[k] == null || dt < firstDateOf[k]) firstDateOf[k] = dt;
    }
    let newPlaces = 0;
    const seen = new Set();
    for (const r of inRecs) {
      const k = placeKey(r);
      if (seen.has(k)) continue; seen.add(k);
      if (firstDateOf[k] >= period.start) newPlaces++;
    }

    // 期間内を場所ごとに集計（代表名＝最新の記録の名前）
    const byKey = {};
    for (const r of inRecs) {
      const k = placeKey(r);
      if (!byKey[k]) byKey[k] = { key: k, count: 0, name: r.name || '', lastDate: r.date };
      byKey[k].count++;
      if (r.date >= byKey[k].lastDate) { byKey[k].lastDate = r.date; byKey[k].name = r.name || byKey[k].name; }
    }
    const spots = Object.keys(byKey).map((k) => byKey[k])
      .sort((a, b) => b.count - a.count || (a.lastDate === b.lastDate ? 0 : (a.lastDate < b.lastDate ? 1 : -1)));
    const topSpot = (spots[0] && spots[0].count >= 2)
      ? { name: spots[0].name, count: spots[0].count, key: spots[0].key } : null;
    const best3 = spots.slice(0, 3).map((s) => ({ name: s.name, count: s.count, key: s.key }));

    // ジャンル
    const gCount = {};
    for (const r of inRecs) { const g = r.genre || 'other'; gCount[g] = (gCount[g] || 0) + 1; }
    const genreBreakdown = Object.keys(gCount).map((k) => ({ key: k, count: gCount[k] }))
      .sort((a, b) => b.count - a.count);
    const topGenre = genreBreakdown[0] ? { key: genreBreakdown[0].key, count: genreBreakdown[0].count } : null;

    const buckets = bucketize(period, inRecs);
    const busiest = pickBusiest(buckets);

    // 写真枚数
    let photoCount = 0;
    for (const r of inRecs) photoCount += (r.photos ? r.photos.length : 0);

    // ピン（時系列順・1記録1本）
    const pins = inRecs
      .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => ({ lat: r.lat, lng: r.lng, genre: r.genre || 'other', name: r.name || '', date: r.date }));

    return {
      period, count, outingDays,
      isEmpty: count === 0,
      isSparse: count > 0 && count < 3,
      daysTogether, newPlaces, topSpot, best3,
      topGenre, genreBreakdown, buckets, busiest,
      photoCount, pins,
      firstOuting: inRecs[0] || null,
      lastOuting: count ? inRecs[count - 1] : null,
    };
  }
```

同じファイルの `planSlides` の中の行を差し替える。

```javascript
    if (data.busiestMonth) ids.push('month');
```
を
```javascript
    if (data.busiest) ids.push('busiest');
```
に。

末尾の `return { ... }` から `computeYearReview` を外し、`computePeriodReview` にする。

```javascript
  return { computePeriodReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive,
    formatRangeLabel, formatDateLine, makeYearPeriod, makeAllPeriod, makeRangePeriod,
    bucketize, pickBusiest, _selfTest };
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())"
```

Expected: `✅ review-stats ALL PASS`、終了コード 0。

- [ ] **Step 5: 呼び出し側が壊れていることを確認する（意図どおり）**

```bash
grep -rn "computeYearReview\|busiestMonth\|monthlyCounts\|data\.year" js/
```

Expected: `js/review-ui.js` と `js/review-poster.js` に残っている。Task 5・6 で直す。

- [ ] **Step 6: コミットする**

```bash
git add js/review-stats.js && git commit -F - <<'EOF'
feat(review): replace computeYearReview with computePeriodReview

Aggregates over an arbitrary period instead of a calendar year. "First
visit" is now decided by date rather than by year, so a short trip inside
one year reports its new places correctly, and the anniversary count is
measured to the period's end.

Callers in review-ui.js and review-poster.js are updated next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: ポスター見出しの行組みとファイル名（review-poster.js）

見出しの文字数が可変になったので、描く前に幅を測って詰める。canvas 無しで検証できるよう、測る手段を外から渡す純粋関数にする。

**Files:**
- Modify: `js/review-poster.js`

- [ ] **Step 1: 失敗するテストを書く**

`js/review-poster.js` の `_selfTest()` の中、`console.log(fails === 0 ? 'ALL PASS (poster)' ...` の行の**直前**に挿入する。

```javascript
    // --- 見出しの行組み ---
    // 全角=1.0em / 半角=0.5em として幅を見積もる簡易 measure（実測の代わり）
    const measure = (text, size) => {
      let w = 0;
      for (const ch of String(text)) w += (/[\x20-\x7e]/.test(ch) ? 0.5 : 1) * size;
      return w;
    };
    // 年号は今までどおり基準サイズのまま1行
    eq('head-year-lines', planHeadline('2026', measure).lines, ['2026']);
    eq('head-year-size', planHeadline('2026', measure).size, 240);
    // 4文字の日本語は少し縮んで1行
    eq('head-imamade-lines', planHeadline('これまで', measure).lines, ['これまで']);
    eq('head-imamade-size', planHeadline('これまで', measure).size, 230);
    eq('head-trip-lines', planHeadline('沖縄旅行', measure).lines, ['沖縄旅行']);
    // 短い日付ラベルは割らない
    eq('head-short-range-lines', planHeadline('3/1〜3/5', measure).lines, ['3/1〜3/5']);
    // 年をまたぐ長い日付ラベルは 〜 の前で2行に割り、2行目は 〜 から始める
    const cross = planHeadline('2025/12/30〜2026/1/3', measure);
    eq('head-cross-2-lines', cross.lines.length, 2);
    eq('head-cross-line1', cross.lines[0], '2025/12/30');
    eq('head-cross-line2', cross.lines[1], '〜2026/1/3');
    eq('head-cross-size', cross.size, 184);
    // 〜 を含まない長いラベルは折り返さず、縮めて1行に収める
    const long10 = planHeadline('あいうえおかきくけこ', measure);
    eq('head-long-1-line', long10.lines.length, 1);
    eq('head-long-size', long10.size, 92);
    // 下限を割らない（入力は10文字までだが関数としては守る）
    eq('head-min-size', planHeadline(new Array(21).join('あ'), measure).size, 72);
    // 先頭が 〜 のときは空行を作らない
    eq('head-leading-tilde-1-line', planHeadline('〜あいうえおかきくけこ', measure).lines.length, 1);

    // --- 共有ファイル名 ---
    eq('file-year', posterFileName('2026'), 'ashiato-2026.png');
    eq('file-label', posterFileName('沖縄旅行'), 'ashiato-沖縄旅行.png');
    eq('file-strips-path-chars', posterFileName('a/b:c*d?e"f<g>h|i'), 'ashiato-a_b_c_d_e_f_g_h_i.png');
    eq('file-strips-backslash', posterFileName('a\\b'), 'ashiato-a_b.png');
    // 空白とハイフンは消さない（制御文字の範囲を書き損じると、ここが落ちる）
    eq('file-keeps-inner-space', posterFileName('沖縄 旅行'), 'ashiato-沖縄 旅行.png');
    eq('file-keeps-hyphen', posterFileName('3-1'), 'ashiato-3-1.png');
    eq('file-blank-falls-back', posterFileName('   '), 'ashiato-period.png');
    eq('file-null-falls-back', posterFileName(null), 'ashiato-period.png');
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-poster.js');process.exit(global.App.reviewPoster._selfTest())"
```

Expected: `ReferenceError: planHeadline is not defined` で落ちる。

- [ ] **Step 3: 実装する**

`js/review-poster.js` の `const LOAD_TIMEOUT = 8000;` の行の**直前**に挿入する。

```javascript
  const HEAD_MAX_W = 920;    // W - 左右の余白160
  const HEAD_BASE = 240;     // 年号の大きさ。これを上限にする
  const HEAD_MIN = 72;
  const HEAD_WRAP_AT = 120;  // ここまで縮むなら、割れるラベルは2行にしたほうが読める
  const HEAD_WRAP_MAX = 200; // 2行にしたときの上限（1行より大きくは見せない）

  // 見出しの行組みとフォントサイズを決める。measure(text, size) は幅(px)を返す関数。
  // canvas 無しでも試せるよう、測る手段を外から渡す。
  function planHeadline(label, measure) {
    const text = String(label == null ? '' : label);
    const fit = (t) => {
      const w = measure(t, HEAD_BASE);
      if (!(w > 0)) return HEAD_BASE;
      return Math.min(HEAD_BASE, Math.floor(HEAD_BASE * HEAD_MAX_W / w));
    };
    const one = fit(text);
    const at = text.indexOf('〜');
    // 先頭が 〜 のときに割ると空行ができるので、at<=0 は1行のまま
    if (one >= HEAD_WRAP_AT || at <= 0) {
      return { lines: [text], size: Math.max(HEAD_MIN, one) };
    }
    const a = text.slice(0, at);
    const b = text.slice(at); // 2行目は 〜 から始める
    const size = Math.min(HEAD_WRAP_MAX, Math.min(fit(a), fit(b)));
    return { lines: [a, b], size: Math.max(HEAD_MIN, size) };
  }

  // 共有・保存のファイル名。ラベルはユーザーが打った文字なので、
  // ファイル名に使えない字を落としてから使う。
  function posterFileName(label) {
    const safe = String(label == null ? '' : label)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
    return 'ashiato-' + (safe || 'period') + '.png';
  }
```

同じファイル末尾の `return { build, pickPosterPhotos, statLines, tileRects, _selfTest };` を次に差し替える。

```javascript
  return { build, pickPosterPhotos, statLines, tileRects, planHeadline, posterFileName, _selfTest };
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-poster.js');process.exit(global.App.reviewPoster._selfTest())"
```

Expected: `ALL PASS (poster)`、終了コード 0。

- [ ] **Step 5: コミットする**

```bash
git add js/review-poster.js && git commit -F - <<'EOF'
feat(poster): size and wrap the headline for variable-length labels

Measures the label before drawing: shrinks from 240px down to 72px, and
splits a long date label at the tilde onto two lines. Also derives a safe
share filename from the user-typed label.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: ポスターの描画を period 対応にする

**Files:**
- Modify: `js/review-poster.js`

- [ ] **Step 1: フォント読み込みのヒントを広げる**

Google Fonts の日本語は多数のサブセットに分割配信されるので、`document.fonts.load()` に「この字が要る」と渡さないと一部の字だけ既定書体に化ける。ラベルはユーザーが打つ任意の文字なので、実際に描く文字列を渡す必要がある。

`js/review-poster.js` の `const GLYPHS = ...` の行を次に差し替える。

```javascript
  const GLYPHS = 'あしあと年のおでかけ日訪れた場所か写真枚付き合って目・これまで〜./0123456789';
```

続く `ensureFonts` を次に差し替える。

```javascript
  // アプリと同じ書体で描くため、canvas に使う前にフォントを読み込ませる。
  // 待たないと日本語が既定ゴシックになり、別物の見た目になる。
  // extra には実際に描く文字（期間ラベルと日付行）を渡すこと。任意の字が来るため。
  async function ensureFonts(extra) {
    const glyphs = GLYPHS + (extra || '');
    try {
      await Promise.all([
        document.fonts.load('300 240px "Zen Kaku Gothic New"', glyphs),
        document.fonts.load('400 30px "Zen Kaku Gothic New"', glyphs),
      ]);
      await document.fonts.ready;
    } catch (e) { /* 読めなくても既定書体で続行する */ }
  }
```

- [ ] **Step 2: build の入口を period 対応にする**

`js/review-poster.js` の

```javascript
  // data=computeYearReview の戻り値, photoUrls=その年の写真URL（日付昇順）
  async function build(data, photoUrls) {
    await ensureFonts();
```

を次に差し替える。

```javascript
  // data=computePeriodReview の戻り値, photoUrls=その期間の写真URL（日付昇順）
  async function build(data, photoUrls) {
    const period = data.period;
    const dateLine = App.reviewStats.formatDateLine(period);
    await ensureFonts(period.label + dateLine);
```

- [ ] **Step 3: 見出しの描画を差し替える**

同じファイルの

```javascript
    ctx.textAlign = 'center';
    ctx.font = '300 240px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(data.year), W / 2, H * 0.31);

    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    drawSpaced(ctx, '年のあしあと', W / 2, H * 0.31 + 165, 9);
```

を次に差し替える。

```javascript
    ctx.textAlign = 'center';
    const head = planHeadline(period.label, (t, size) => {
      ctx.font = '300 ' + size + 'px "Zen Kaku Gothic New", sans-serif';
      return ctx.measureText(t).width;
    });
    ctx.font = '300 ' + head.size + 'px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#fff';
    // 行が増えても見出しの中心が動かないよう、上下に振り分ける
    // （`lineH` は build 内の統計行がすでに使っているので別名にする。同名だと重複宣言でモジュールごと落ちる）
    const headLineH = Math.round(head.size * 1.15);
    const top = H * 0.31 - (head.lines.length - 1) * headLineH / 2;
    head.lines.forEach((t, i) => { ctx.fillText(t, W / 2, top + i * headLineH); });

    // 副題は最終行の下に置く。1行のときは従来と同じ位置になる。
    const subY = top + (head.lines.length - 1) * headLineH + Math.round(head.size * 0.5) + 45;
    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    drawSpaced(ctx, period.kind === 'year' ? '年のあしあと' : 'のあしあと', W / 2, subY, 9);

    if (dateLine) {
      ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText(dateLine, W / 2, subY + 58);
    }
```

- [ ] **Step 4: 純粋関数のテストが壊れていないことを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-poster.js');process.exit(global.App.reviewPoster._selfTest())"
```

Expected: `ALL PASS (poster)`、終了コード 0。（`build` は canvas が要るのでここでは走らない。見た目は Task 8 で実機確認する。）

- [ ] **Step 5: 年号の描画位置が変わっていないことを机上で確認する**

1行・240px のとき `top = H*0.31`、`subY = H*0.31 + 0 + 120 + 45 = H*0.31 + 165`。差し替え前の `H * 0.31 + 165` と一致すること。一致しなければ計算を直す。

- [ ] **Step 6: コミットする**

```bash
git add js/review-poster.js && git commit -F - <<'EOF'
feat(poster): draw the period label and a small date line

The headline now comes from period.label at a fitted size, the subtitle
drops "年" for non-year periods, and a faint date range sits below it.
Font loading is hinted with the actual label text, since Google Fonts
serves Japanese in subsets and an unhinted glyph silently falls back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: review-ui.js を period 対応にする

このタスクで UI が再び動くようになる。

**Files:**
- Modify: `js/review-ui.js`

- [ ] **Step 1: スライドの文言を period 対応にする**

`js/review-ui.js` の `var MONTHS = [...]` の行を**削除**する（バケットが自前でラベルを持つようになったため）。

`slideHTML` を丸ごと次で置き換える。

```javascript
  function slideHTML(id, data) {
    var kind = data.period.kind;
    if (id === 'days') return '<div class="rv-cap">付き合って</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.daysTogether + '">0</span><span class="rv-u">日目</span></div>' +
      '<div class="rv-cap">ふたりで歩いてきた</div>';
    if (id === 'outings') return '<div class="rv-cap">ふたりで過ごした日</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.outingDays + '">0</span><span class="rv-u">日</span></div>' +
      '<div class="rv-cap">' + data.count + 'か所をめぐった</div>';
    if (id === 'places') return '<div class="rv-cap">' + (kind === 'year' ? '今年訪れた場所' : '訪れた場所') + '</div>' +
      '<div class="rv-big"><span class="rv-count rv-places-num">0</span><span class="rv-u">か所</span></div>' +
      '<div class="rv-map-wrap"><div class="rv-map"></div></div>';
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
    if (id === 'busiest') {
      var unit = data.buckets.unit === 'month' ? '月' : '年';
      return '<div class="rv-cap">いちばん濃かった' + unit + '</div>' +
        '<div class="rv-big">' + data.busiest.label + '</div>' +
        '<div class="rv-cap">この' + unit + 'だけで ' + data.busiest.count + '日</div>';
    }
    if (id === 'closing') return '<div class="rv-mid rv-closing">' +
      (kind === 'year' ? 'また来年も、<br>ふたりのあしあとを。' : 'これからも、<br>ふたりのあしあとを。') + '</div>' +
      '<button class="rv-btn rv-topage">総集編を見る ↓</button>';
    return '';
  }
```

- [ ] **Step 2: 地図への着地・写真収集・共有を period 対応にする**

`goToRealMap` を次で置き換える。

```javascript
  function goToRealMap(period) {
    // メインマップにその期間のフィルタをかけて着地（既存フィルタUIを利用）
    hideAll();
    var ms = el('mode-select');
    if (period.kind === 'all') {
      if (ms) ms.value = 'all';
    } else {
      if (ms) ms.value = 'range';
      var f = el('from-input'), t = el('to-input');
      if (f) f.value = period.start;
      if (t) t.value = period.end;
    }
    if (App.records && App.records.applyUiFilter) App.records.applyUiFilter();
    var mapBtn = el('view-map'); if (mapBtn) mapBtn.click(); // 地図ビューへ
  }
```

`yearPhotoUrls` を次で置き換える。

```javascript
  // その期間の写真URLを日付昇順で集める。並べ替えを忘れると「期間内に散らす」が効かない。
  // thumbOf はサムネ(400px)を返す。タイルは45×48しか使わないので、これで十分かつ軽い。
  function periodPhotoUrls(period) {
    var urls = [];
    App.records.getAll()
      .filter(function (r) { return r && r.date && String(r.date) >= period.start && String(r.date) <= period.end; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (r) {
        (r.photos || []).forEach(function (p) {
          var u = App.photos.thumbOf(p);
          if (u) urls.push(u);
        });
      });
    return urls;
  }
```

`sharePoster` と `savePoster` を次で置き換える。

```javascript
  // 画像を共有シートに渡す。使えなければダウンロードに落とす。
  async function sharePoster(blob, period) {
    var name = App.reviewPoster.posterFileName(period.label);
    var file = new File([blob], name, { type: 'image/png' });
    var title = period.label + (period.kind === 'year' ? '年のあしあと' : 'のあしあと');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 本人が閉じただけ。何もしない
        // それ以外は保存に落とす
      }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // 保存が始まる前に取り消すと落ちることがあるので、少し置いてから返す
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ボタンから呼ぶ。生成中は押せなくする。
  async function savePoster(btn, data) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      var blob = await App.reviewPoster.build(data, periodPhotoUrls(data.period));
      await sharePoster(blob, data.period);
    } catch (e) {
      console.error('poster failed', e);
      alert('画像を作れませんでした');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }
```

- [ ] **Step 3: 総集編ページを period 対応にする**

`showPage` を丸ごと次で置き換える。

```javascript
  function showPage(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var host = el('review-page');
    var period = data.period;
    var unit = data.buckets.unit === 'month' ? '月' : '年';
    var tiles = [
      { n: data.newPlaces, l: 'はじめての場所', u: '軒' },
      { n: data.topGenre ? App.genres.label(data.topGenre.key) : '—', l: 'いちばんのジャンル', u: '' },
      { n: data.photoCount, l: '写真', u: '枚' },
      { n: data.busiest ? data.busiest.label : '—', l: 'いちばん濃かった' + unit, u: '' },
    ].map(function (x) {
      return '<div class="rv-tile"><div class="rv-tile-n">' + esc(String(x.n)) + '<span class="rv-tile-u">' + x.u + '</span></div><div class="rv-tile-l">' + x.l + '</div></div>';
    }).join('');

    // 棒が1本しかない期間はグラフにならないので節ごと出さない
    var bucketSection = '';
    if (data.buckets.items.length >= 2) {
      var maxB = Math.max.apply(null, data.buckets.items.map(function (b) { return b.count; }).concat([1]));
      var bars = data.buckets.items.map(function (b) {
        return '<div class="rv-mb"><span style="height:' + Math.round(100 * b.count / maxB) + '%"></span><small>' + esc(b.label.replace(/[月年]$/, '')) + '</small></div>';
      }).join('');
      bucketSection = '<div class="rv-section"><div class="rv-h">' + unit + '別のおでかけ</div><div class="rv-months">' + bars + '</div></div>';
    }

    var genreRows = data.genreBreakdown.map(function (g) {
      var max = data.genreBreakdown[0].count || 1;
      return '<div class="rv-grow"><span class="rv-glabel">' + esc(App.genres.label(g.key)) + '</span>' +
        '<span class="rv-gbar" style="width:' + Math.round(100 * g.count / max) + '%;background:' + App.genres.color(g.key) + '"></span>' +
        '<span class="rv-gcount">' + g.count + '</span></div>';
    }).join('');

    var photos = [];
    App.records.getAll().forEach(function (r) {
      if (r && r.date && String(r.date) >= period.start && String(r.date) <= period.end && r.photos) {
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
    // ラベルはユーザーが打った文字なので必ず esc を通す
    var title = esc(period.label) + (period.kind === 'year' ? '年のあしあと' : 'のあしあと');
    var dateLine = App.reviewStats.formatDateLine(period);
    host.innerHTML =
      '<div class="rv-page">' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-hero"><div class="rv-hero-sub">' + title + '</div>' +
      (dateLine ? '<div class="rv-hero-dates">' + dateLine + '</div>' : '') +
      daysLine + '<div class="rv-hero-count">おでかけ ' + data.outingDays + '日</div>' +
      '<div class="rv-hero-sub2">訪れた場所 ' + data.count + 'か所</div></div>' +
      '<div class="rv-tiles">' + tiles + '</div>' +
      '<div class="rv-section"><div class="rv-h">あしあと地図</div><div class="rv-map-wrap rv-map-page"><div class="rv-map"></div></div>' +
      '<button class="rv-btn rv-realmap">本物の地図で' + (period.kind === 'year' ? 'この年' : 'この期間') + 'を見る</button></div>' +
      bucketSection +
      '<div class="rv-section"><div class="rv-h">ジャンル</div>' + genreRows + '</div>' +
      (photoGrid ? '<div class="rv-section"><div class="rv-h">写真</div>' + photoGrid + '</div>' : '') +
      (best ? '<div class="rv-section"><div class="rv-h">よく行ったところ</div>' + best + '</div>' : '') +
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      (data.isEmpty ? '' : '<div class="rv-section rv-save-wrap"><button class="rv-save">画像で保存・共有</button></div>') +
      '</div>';

    host.querySelector('.rv-x').onclick = hideAll;
    var mapEl = host.querySelector('.rv-map');
    if (data.pins.length) renderMap(mapEl, data.pins, { animate: false });
    host.querySelector('.rv-realmap').onclick = function () { goToRealMap(period); };
    var saveBtn = host.querySelector('.rv-save');
    if (saveBtn) saveBtn.onclick = function () { savePoster(saveBtn, data); };
    host.querySelectorAll('.rv-outing').forEach(function (b) {
      b.onclick = function () { hideAll(); App.records.focusDay(b.getAttribute('data-date')); };
    });
    host.scrollTop = 0;
    host.hidden = false;
  }
```

- [ ] **Step 4: open / showSparse / 年末カードを period 対応にする**

`open` を次で置き換える。

```javascript
  // 対象期間のデータを作って開く
  function open(period) {
    var data = App.reviewStats.computePeriodReview(App.records.getAll(), period, anniversary, todayStr());
    hideAll();
    if (data.isEmpty) { showPage(data); return; }
    // 「まだ少なめ」の遠慮は年だけ。期間を自分で選んだなら見たいということなので出す。
    if (period.kind === 'year' && data.isSparse) { showSparse(data); return; }
    showSlides(data);
  }
```

`showSparse` の中の `data.year` を使っている行

```javascript
      '<div class="rv-mid">まだ' + data.year + '年のあしあとは少なめ</div>' +
```

を次に差し替える。

```javascript
      '<div class="rv-mid">まだ' + esc(data.period.label) + '年のあしあとは少なめ</div>' +
```

`maybeShowYearEndCard` の中の

```javascript
    var data = App.reviewStats.computeYearReview(App.records.getAll(), targetYear, null, todayStr());
```

を次に差し替える。

```javascript
    var data = App.reviewStats.computePeriodReview(
      App.records.getAll(), App.reviewStats.makeYearPeriod(targetYear), null, todayStr());
```

同じ関数内の

```javascript
    host.querySelector('.rv-card-open').onclick = function () { host.hidden = true; open(targetYear); };
```

を次に差し替える。

```javascript
    host.querySelector('.rv-card-open').onclick = function () {
      host.hidden = true; open(App.reviewStats.makeYearPeriod(targetYear));
    };
```

- [ ] **Step 5: 年前提の呼び出しが残っていないことを確認する**

```bash
grep -n "computeYearReview\|busiestMonth\|monthlyCounts\|data\.year\|MONTHS\|yearPhotoUrls\|open(year)\|open(Number" js/review-ui.js js/review-poster.js
```

Expected: `showPicker` 内の `open(Number(...))` だけが残る（Task 7 で直す）。それ以外はヒットしないこと。

- [ ] **Step 6: ピン投入テンポのテストが壊れていないことを確認する**

```bash
node -e "global.window={matchMedia:null};global.App=global.window.App={};require('./js/review-ui.js');process.exit(global.App.review._selfTestSchedule())"
```

Expected: `✅ pinSchedule ALL PASS`、終了コード 0。

- [ ] **Step 7: コミットする**

```bash
git add js/review-ui.js && git commit -F - <<'EOF'
feat(review): drive the slides and summary page from the period

Titles come from period.label (escaped — it is user input), the bar chart
follows the bucket unit and disappears when there is only one bar, and the
map/photo/share paths all filter by the period's date range.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 7: ピッカーに「これまで」と「期間を選ぶ」を足す

**Files:**
- Modify: `js/review-ui.js`
- Modify: `style.css`

- [ ] **Step 1: ピッカーを書き替える**

`js/review-ui.js` の `showPicker` を丸ごと次で置き換える。

```javascript
  // 期間ピッカー
  function showPicker() {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var all = App.records.getAll();
    var years = App.reviewStats.yearsWithRecords(all);
    var host = el('review-picker');
    if (!years.length) {
      host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">ふりかえり</div>' +
        '<p class="rv-empty">まだ記録がありません。おでかけを記録するとここに出ます。</p>' +
        '<button class="rv-btn rv-close">閉じる</button></div>';
      host.querySelector('.rv-close').onclick = hideAll;
      host.hidden = false;
      return;
    }
    var items = years.map(function (y) {
      return '<button class="rv-year" data-year="' + y + '">' + y + '年</button>';
    }).join('');
    host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">どの期間をふりかえる？</div>' +
      '<div class="rv-years">' + items + '<button class="rv-year rv-all">これまで</button></div>' +
      '<button class="rv-range-open">期間を選ぶ</button>' +
      '<div class="rv-range-form" hidden>' +
      '<label class="rv-f-l">いつから<input type="date" class="rv-f-from"></label>' +
      '<label class="rv-f-l">いつまで<input type="date" class="rv-f-to"></label>' +
      '<label class="rv-f-l">見出しの文字（任意）' +
      '<input type="text" class="rv-f-label" maxlength="10" placeholder="沖縄旅行"></label>' +
      '<p class="rv-f-msg" hidden></p>' +
      '<button class="rv-btn rv-f-go">見る</button></div>' +
      '<button class="rv-btn rv-close">閉じる</button></div>';

    host.querySelectorAll('.rv-year[data-year]').forEach(function (b) {
      b.onclick = function () { open(App.reviewStats.makeYearPeriod(Number(b.getAttribute('data-year')))); };
    });
    host.querySelector('.rv-all').onclick = function () {
      open(App.reviewStats.makeAllPeriod(all, todayStr()));
    };

    var form = host.querySelector('.rv-range-form');
    var msg = host.querySelector('.rv-f-msg');
    host.querySelector('.rv-range-open').onclick = function () { form.hidden = !form.hidden; };
    host.querySelector('.rv-f-go').onclick = function () {
      function warn(t) { msg.textContent = t; msg.hidden = false; }
      var from = host.querySelector('.rv-f-from').value;
      var to = host.querySelector('.rv-f-to').value;
      if (!from || !to) { warn('期間を選んでね'); return; }
      if (from > to) { warn('開始日と終了日が逆だよ'); return; }
      var p = App.reviewStats.makeRangePeriod(from, to, host.querySelector('.rv-f-label').value);
      // 0件の期間を開くと空の総集編になってしまうので、ここで止めて理由を出す
      var has = all.some(function (r) {
        return r && r.date && String(r.date) >= p.start && String(r.date) <= p.end;
      });
      if (!has) { warn('この期間の記録はまだないみたい'); return; }
      msg.hidden = true;
      open(p);
    };
    host.querySelector('.rv-close').onclick = hideAll;
    host.hidden = false;
  }
```

- [ ] **Step 2: スタイルを足す**

`style.css` の `.rv-empty { color: var(--text-muted); }` の行の**直後**に挿入する。

```css
.rv-all { border-style: dashed; }
.rv-range-open { display: block; width: 100%; margin-top: 14px; background: none;
  border: 1px dashed var(--border); border-radius: 14px; padding: 12px;
  font-size: 15px; font-weight: 700; color: var(--text); cursor: pointer; }
.rv-range-form { margin-top: 12px; padding: 14px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 14px; }
.rv-f-l { display: block; margin-bottom: 12px; font-size: 13px; color: var(--text-muted); }
.rv-f-l input { display: block; width: 100%; margin-top: 5px; box-sizing: border-box;
  padding: 10px; font: inherit; font-size: 15px; color: var(--text);
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px; }
.rv-f-msg { margin: 0 0 10px; font-size: 13px; color: var(--accent); }
.rv-f-go { width: 100%; }
.rv-hero-dates { margin-top: 4px; font-size: 13px; color: var(--text-muted); }
```

- [ ] **Step 3: ピン投入テンポのテストが壊れていないことを確認する**

```bash
node -e "global.window={matchMedia:null};global.App=global.window.App={};require('./js/review-ui.js');process.exit(global.App.review._selfTestSchedule())"
```

Expected: `✅ pinSchedule ALL PASS`、終了コード 0。

- [ ] **Step 4: 年前提の呼び出しが残っていないことを確認する**

```bash
grep -rn "computeYearReview\|busiestMonth\|monthlyCounts\|yearPhotoUrls" js/
```

Expected: 何もヒットしないこと。

- [ ] **Step 5: コミットする**

```bash
git add js/review-ui.js style.css && git commit -F - <<'EOF'
feat(review): pick "これまで" or a custom date range from the picker

Adds an all-time button and an inline range form with an optional headline
label, validated before opening so an empty period never becomes a blank
summary page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 8: 版を上げて実機で確認する

**Files:**
- Modify: `index.html`

- [ ] **Step 1: `?v=` と表示用の版を上げる**

`index.html` の `20260824f` をすべて `20260825a` に置き換える。`.app-ver` の表示（`ver. 20260824f`）も含めること。

```bash
sed -i 's/20260824f/20260825a/g' index.html && grep -c "20260824f" index.html; grep -c "20260825a" index.html
```

Expected: 1つめの `grep -c` が `0`（古い版がどこにも残っていない）、2つめが `24`（`?v=` 23か所＋`ver.` 表示1か所）。

- [ ] **Step 2: すべての自己テストを走らせる**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');process.exit(global.App.reviewStats._selfTest())" && node -e "global.window={};global.App=global.window.App={};require('./js/review-poster.js');process.exit(global.App.reviewPoster._selfTest())" && node -e "global.window={matchMedia:null};global.App=global.window.App={};require('./js/review-ui.js');process.exit(global.App.review._selfTestSchedule())"
```

Expected: 3つとも ALL PASS、終了コード 0。

- [ ] **Step 3: コミットして本番へ出す**

```bash
git add index.html && git commit -F - <<'EOF'
chore: bump version to 20260825a for period review

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push
```

- [ ] **Step 4: 実機（スマホか実 Chrome）で確認する**

プレビュー用ブラウザは Google のベクター地図を描画できないので、地図が出る画面はここでは確かめられない。実機で次を順に見ること。

1. メニュー →「ふりかえり」→ 見出しが「どの期間をふりかえる？」になっている
2. 年ボタン → 今までどおりスライドショー → 総集編。月別グラフが12本、見出しが「2026年のあしあと」で日付行は出ない
3. 「これまで」→ 総集編の見出しが「これまでのあしあと」＋日付行。グラフが年別になっている
4. 「期間を選ぶ」→ 日付だけ入れて「見る」→ 見出しが `3/1〜3/5` などの自動生成になっている
5. もう一度「期間を選ぶ」→ 見出しの文字に `沖縄旅行` を入れて「見る」→ スライドと総集編の見出しが「沖縄旅行のあしあと」になっている
6. 記録が1件だけの短い期間 →「まだ少なめ」画面ではなくスライドショーが出る
7. 同月内の期間 → 総集編に「◯月別のおでかけ」の節が出ない（棒1本のグラフを出さない）
8. 検証：終了日より前の開始日 →「開始日と終了日が逆だよ」／日付を空にして「見る」→「期間を選んでね」／記録の無い期間 →「この期間の記録はまだないみたい」
9. 総集編の「本物の地図でこの期間を見る」→ 地図に戻り、絞り込みが期間になっている（「これまで」なら「全部」）

- [ ] **Step 5: ポスター画像を実際に目で見て確認する**

ピクセル値の測定だけでは見落とす。生成した PNG を開いて次を確かめる。

1. 年 → 巨大な年号＋「年のあしあと」。**今までと同じ見た目**で、日付行は無い
2. 「これまで」→「これまで」＋「のあしあと」＋薄い日付行（`2024.5.10 〜 2026.8.25`）
3. ラベル付きの期間 →「沖縄旅行」＋「のあしあと」＋日付行
4. ラベル無しで年をまたぐ期間 → 見出しが2行になり、2行目が `〜` から始まっている
5. 日本語が既定ゴシックに化けていない（フォントのヒントが効いている）
6. 背景に単色の四角が出ていない（写真の読み込み失敗の穴埋めが効いている）
7. 共有シートのファイル名が `ashiato-沖縄旅行.png` などになっている

- [ ] **Step 6: 見つかった問題を直してコミットする**

問題が無ければこのステップは飛ばす。

---

## 完了の条件

- `review-stats` / `review-poster` / `review-ui` の3つの自己テストが ALL PASS
- `grep -rn "computeYearReview\|busiestMonth\|monthlyCounts" js/` が空
- 実機で Task 8 Step 4 の9項目と Step 5 の7項目を目視確認済み
- 本番の `ver.` が `20260825a` になっている
