# 旅行のふりかえり Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ふりかえりの期間ピッカーに「旅行から選ぶ」を足し、登録済みの旅行を選ぶとその旅行の総集編が開くようにする。

**Architecture:** 旅行は「名前＋日付の範囲」、ふりかえりの期間も「名前＋日付の範囲」。同じ形なので変換関数を1つ足すだけで、旅行は `kind:'range'` として既存の期間ふりかえりの道をそのまま通る。スライドショー・統計・ポスター・地図への着地は一切触らない。

**Tech Stack:** 純バニラJS（`window.App.*` の IIFE）。ビルド無し。純粋関数は `_selfTest()` を Node で実行して検証。DOM を含む部分は本人がスマホの本番URLで確認。

**設計からの変更（1点）:** 仕様書は「`review-stats.js` はロジックを変えない」としていたが、**`makeTripPeriod(trip)` を足す**。`makeYearPeriod` / `makeAllPeriod` / `makeRangePeriod` が並ぶ場所が変換の自然な置き場所で、ここに置けば Node でテストできる。`review-ui.js` に書くと DOM 込みになりテストできない。実体は `makeRangePeriod` を呼ぶだけの3行。

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/review-stats.js` | 期間の組み立て（純粋関数） | `makeTripPeriod` を追加＋自己テスト3件 |
| `js/review-ui.js` | 期間ピッカーの描画と配線 | `countInRange` を追加、`showPicker()` に旅行の折りたたみを追加 |
| `style.css` | 見た目 | `.rv-trip-*` を追加、`.rv-trip-open` を既存ボタン指定に相乗り |
| `index.html` | 版文字列 | `20260827s` から `20260827t` に全置換 |

**触らない:** `js/filters.js` `js/trips.js` `js/calendar.js` `js/review-poster.js`

---

### Task 1: 旅行を「ふりかえりの期間」に変える関数

**Files:**
- Modify: `js/review-stats.js`（`makeRangePeriod` の直後・56行目付近／`_selfTest` の range テスト群・244行目付近）

- [ ] **Step 1: 失敗するテストを書く**

`js/review-stats.js` の `_selfTest()` 内、`eq('range-kind', ...)` の行の直後に足す:

```js
    // 旅行はそのまま期間になる。名前が必ずあるので autoLabel は false ＝ 日付行が出る。
    var trip1 = { id: 'trip1', label: '京都旅行', start: '2026-03-01', end: '2026-03-05' };
    eq('trip-period', makeTripPeriod(trip1),
      { kind: 'range', start: '2026-03-01', end: '2026-03-05', label: '京都旅行', autoLabel: false });
    eq('trip-period-keeps-name', makeTripPeriod(trip1).label, '京都旅行');
    eq('trip-period-shows-dateline', formatDateLine(makeTripPeriod(trip1)), '2026.3.1 〜 3.5');
```

- [ ] **Step 2: 落ちることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');App.reviewStats._selfTest()"
```

Expected: `ReferenceError: makeTripPeriod is not defined` で異常終了する。

- [ ] **Step 3: 最小の実装を書く**

`makeRangePeriod` の直後に足す:

```js
  // 旅行（名前＋日付の範囲）は、そのままふりかえりの期間になる。
  // 名前は必ずあるので autoLabel は false になり、見出しの下に日付行が出る。
  function makeTripPeriod(trip) {
    return makeRangePeriod(trip.start, trip.end, trip.label);
  }
```

同ファイル末尾（402行目付近）の return に `makeTripPeriod` を足す。**既存の行を読んで名前を1つ足すだけにする**（他の名前を消さない）:

```js
  return { computePeriodReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive,
    makeYearPeriod, makeAllPeriod, makeRangePeriod, makeTripPeriod, formatRangeLabel, formatDateLine,
    bucketize, pickBusiest, _selfTest };
```

- [ ] **Step 4: 通ることを確認する**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');App.reviewStats._selfTest()"
```

Expected: `PASS trip-period` / `PASS trip-period-keeps-name` / `PASS trip-period-shows-dateline` が出て、最後に `✅ review-stats ALL PASS`。

- [ ] **Step 5: コミット**

```bash
git add js/review-stats.js
git commit -m "feat(review): turn a trip into a period the review already understands"
```

---

### Task 2: 期間に入る記録を数える関数

`showPicker` はいま `.some()` で「記録があるか」だけを見ている。旅行の一覧には**件数を出したい**ので、数える関数にまとめて両方から使う。

**Files:**
- Modify: `js/review-ui.js`（`todayStr()` の直後・273行目付近／`showPicker` 内の `.some()`・636行目付近）

- [ ] **Step 1: 関数を足す**

`function todayStr() { ... }` の直後に足す:

```js
  // 期間に入る記録の数。0件の期間を開くと空の総集編になるので、その判断にも使う。
  function countInRange(records, from, to) {
    return (records || []).filter(function (r) {
      return r && r.date && String(r.date) >= from && String(r.date) <= to;
    }).length;
  }
```

- [ ] **Step 2: 既存の some を置き換える**

`showPicker` 内の `.rv-f-go` の onclick にあるこの4行:

```js
      var has = all.some(function (r) {
        return r && r.date && String(r.date) >= p.start && String(r.date) <= p.end;
      });
      if (!has) { warn('この期間の記録はまだないみたい'); return; }
```

を、こう置き換える:

```js
      if (!countInRange(all, p.start, p.end)) { warn('この期間の記録はまだないみたい'); return; }
```

- [ ] **Step 3: 構文を確認する**

```bash
node --check js/review-ui.js
```

Expected: 何も出力せず終了（＝構文OK）。

- [ ] **Step 4: コミット**

```bash
git add js/review-ui.js
git commit -m "refactor(review): count the records in a period instead of just asking if any"
```

---

### Task 3: ピッカーに「旅行から選ぶ」を出す

**Files:**
- Modify: `js/review-ui.js`（`showPicker()`・589〜648行目）

- [ ] **Step 1: 旅行を読む行を足す**

`showPicker()` の中、`var years = App.reviewStats.yearsWithRecords(all);` の直後に足す:

```js
    // 開始の早い順に保存されているので、逆にして「最近の旅行が上」にする。
    // clone を使うのは、並べ替えで App.trips.list そのものを壊さないため。
    var trips = (App.trips && App.trips.clone)
      ? App.trips.clone(App.trips.list).reverse() : [];
```

**⚠️引数を省略しない。** `clone(arr)` の中身は `(arr || []).map(...)` なので、
`App.trips.clone()` と書くと**黙って空配列が返り、「旅行から選ぶ」が永久に出ない**。
`trip-edit.js:35` も `App.trips.clone(App.trips.list)` と書いている。

- [ ] **Step 2: innerHTML に旅行の折りたたみを差し込む**

`host.innerHTML = ...` の中、`'<button class="rv-range-open">期間を選ぶ</button>' +` の**手前**に足す:

```js
      (trips.length
        ? '<button class="rv-trip-open">旅行から選ぶ</button>' +
          '<div class="rv-trip-list" hidden><p class="rv-trip-msg" hidden></p></div>'
        : '') +
```

**旅行が0件なら何も出さない**（押しても空の一覧しか出ないため）。

- [ ] **Step 3: 配線する**

`host.querySelector('.rv-close').onclick = hideAll;` の**手前**に足す:

```js
    if (trips.length) {
      var listHost = host.querySelector('.rv-trip-list');
      var tmsg = host.querySelector('.rv-trip-msg');
      var warnTrip = function (t) { tmsg.textContent = t; tmsg.hidden = false; };
      host.querySelector('.rv-trip-open').onclick = function () {
        listHost.hidden = !listHost.hidden;
      };
      trips.forEach(function (t) {
        var n = countInRange(all, t.start, t.end);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rv-trip';
        // 旅行名はふたりが打った文字なので必ず esc する
        b.innerHTML = '<span class="rv-trip-name">' + esc(t.label) + '</span>' +
          '<span class="rv-trip-sub">' + esc(App.trips.lengthLabel(t)) + ' ・ ' + n + '件</span>';
        b.onclick = function () {
          // 0件の旅行を開くと空の総集編になるので、ここで止めて理由を出す
          if (!n) { warnTrip('「' + t.label + '」の記録はまだないみたい'); return; }
          tmsg.hidden = true;
          open(App.reviewStats.makeTripPeriod(t));
        };
        listHost.appendChild(b);
      });
    }
```

- [ ] **Step 4: 構文を確認する**

```bash
node --check js/review-ui.js
```

Expected: 何も出力せず終了。

- [ ] **Step 5: コミット**

```bash
git add js/review-ui.js
git commit -m "feat(review): let the picker offer the trips we have taken"
```

---

### Task 4: 見た目

**Files:**
- Modify: `style.css`（`.rv-year, .rv-range-open` の指定・1007行目付近／`.rv-range-form` の後・1013行目付近）

- [ ] **Step 1: 「旅行から選ぶ」を既存ボタンと同じ見た目にする**

1007行目付近のセレクタに `.rv-trip-open` を足す（**宣言の中身は変えない**）:

```css
.rv-year, .rv-range-open, .rv-trip-open { background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
```

1012行目付近も同じく:

```css
.rv-range-open, .rv-trip-open { display: block; width: 100%; margin-top: 14px; }
```

- [ ] **Step 2: 一覧のスタイルを足す**

`.rv-range-form { ... }` の指定の直後に足す:

```css
/* 旅行の一覧。1行に名前と「3泊4日・N件」を積む */
.rv-trip-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.rv-trip { display: flex; flex-direction: column; gap: 2px; text-align: left;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 12px 14px; font: inherit; color: inherit; cursor: pointer; }
.rv-trip-name { font-family: var(--font-display); font-size: 15px; }
.rv-trip-sub { font-size: 12px; color: var(--text-muted); }
.rv-trip-msg { margin: 0 0 4px; font-size: 13px; color: var(--accent); }
```

- [ ] **Step 3: コミット**

```bash
git add style.css
git commit -m "style(review): dress the trip list like the rest of the picker"
```

---

### Task 5: 版を上げて出す

**Files:**
- Modify: `index.html`（`?v=` 全箇所と `.app-ver`）

- [ ] **Step 1: 版を全置換する**

```bash
sed -i s/20260827s/20260827t/g index.html
```

- [ ] **Step 2: 置き換わったことを確認する**

```bash
grep -c 20260827s index.html
```

Expected: `0`（古い版が1つも残っていない）。

- [ ] **Step 3: 純粋関数のテストをもう一度通す**

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');App.reviewStats._selfTest()"
```

Expected: `✅ review-stats ALL PASS`

- [ ] **Step 4: コミットして出す**

```bash
git add index.html
git commit -m "chore: ship the trip review as 20260827t"
```

その後 `git push origin main`。

- [ ] **Step 5: 本人に伝える**

返信の末尾に **本番ver `20260827t`** と書く。設定欄の `ver.` がこれと一致したら反映済み。

---

## 実機で確かめてもらうこと

**エージェント側からは確認できない**（Google ログインとライブ Maps が要るため）。本人がスマホの本番URLで見る。
**本番の旅行は0件なので、まず1件登録するところから。**

- [ ] 設定から旅行を1件作る（例「京都旅行」を**記録のある日付**で）
- [ ] ふりかえりを開く → 年ボタンの下に **「旅行から選ぶ」** が出る
- [ ] 押すと一覧が開き、**旅行名と「3泊4日 ・ N件」** が出る
- [ ] 旅行を押すと総集編が開き、見出しが **「京都旅行のあしあと」**、その下に日付行が出る
- [ ] **長い旅行名（20文字）でヒーロー見出しが崩れないか。** 手入力の見出しは10文字までなので、この経路だけ長い文字列が来る
- [ ] 記録が0件の旅行を作って押すと「記録はまだないみたい」が出て、空の総集編にならない
- [ ] 旅行を全部消すと「旅行から選ぶ」が消える
