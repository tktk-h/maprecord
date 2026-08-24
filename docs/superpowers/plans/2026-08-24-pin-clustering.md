# 地図ピンのクラスタリング(束ね表示) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ズームアウト時に近接する記録ピンをテラコッタ色のバッジへ束ね、タップでズームインして展開できるようにする。メニューからON/OFFを切り替えられる。

**Architecture:** Google公式の `@googlemaps/markerclusterer` をCDNで読み込み、既存の `App.map.renderPins()` に `opts.cluster` を追加する。クラスタラは `markers` 配列を預かって束ねるが、既存の場所検索は同じ配列の `.map` を直接操作するため、検索に入るときはクラスタラを停止し、抜けるときに復帰させる。ON/OFF状態は `localStorage` に持つ(端末ごと・既定ON)。

**Tech Stack:** バニラJS(IIFEモジュール)、Google Maps JavaScript API(`AdvancedMarkerElement`)、`@googlemaps/markerclusterer` 2.6.2(UMD/CDN)

**元仕様:** [docs/superpowers/specs/2026-08-24-pin-clustering-design.md](../specs/2026-08-24-pin-clustering-design.md)

---

## File Structure

| ファイル | 役割 | 変更内容 |
|---|---|---|
| `js/map.js` | 地図とマーカーの一切を持つ既存モジュール | クラスタラの起動/停止、バッジrenderer、ON/OFF設定の読み書き、検索との衝突回避。`_selfTest` を新設 |
| `js/records.js` | 記録の絞り込みと描画指示 | 通常表示の分岐でだけ `cluster` フラグを渡す |
| `js/app.js` | UIの配線 | メニューのトグルボタンを配線 |
| `index.html` | 画面とスクリプト読み込み | CDN追加、メニューにボタン追加、版上げ |
| `style.css` | 見た目 | `.cluster-pin`(バッジ)と `#backup-bar button.on`(ON状態) |

クラスタリングはマーカー管理そのものなので、新ファイルを作らず `js/map.js` に閉じ込める。`records.js` からは「束ねるかどうか」のフラグを渡すだけで、クラスタラの存在を知らせない。

**テストの流儀:** このプロジェクトは各モジュールに `_selfTest()`(PASS/FAILをconsoleに出す)を置く方式。`js/map.js` にはまだ無いので新設する。`js/map.js` は読み込み時に `google` を触らないため、node で `window` を差し替えれば純関数のテストが走る(確認済み)。

---

### Task 1: クラスタON/OFF設定の保存

**Files:**
- Modify: `js/map.js`(21行目付近の `VIEW_KEY` 定義、および `return {}` の公開部)

- [ ] **Step 1: 失敗するテストを書く**

`js/map.js` の `saveView()` 関数の直後(37行目の `}` の次)に `_selfTest` を追加する:

```js
  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('cluster-pref-default', parseClusterPref(null), true);
    eq('cluster-pref-on', parseClusterPref('on'), true);
    eq('cluster-pref-off', parseClusterPref('off'), false);
    eq('cluster-pref-broken', parseClusterPref('xxx'), true);
    eq('same-spot-near', sameSpot({ lat: 35, lng: 139 }, { lat: 35.0001, lng: 139.0001 }), true);
    eq('same-spot-far', sameSpot({ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }), false);
    eq('same-spot-null', sameSpot(null, { lat: 35, lng: 139 }), false);
    console.log(fails === 0 ? 'ALL PASS (map)' : (fails + ' FAILED (map)'));
    return fails;
  }
```

`js/map.js` 最終行の `return { init, ...` の `_sameSpot: sameSpot };` を `_sameSpot: sameSpot, _selfTest };` に変える。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/map.js'); process.exit(App.map._selfTest());"
```

Expected: `ReferenceError: parseClusterPref is not defined` で落ちる

- [ ] **Step 3: 最小の実装を書く**

`js/map.js` の `const VIEW_KEY = 'date-recorder-view';`(21行目)の直後に定数を足す:

```js
  const CLUSTER_KEY = 'date-recorder-cluster'; // ピンまとめ(クラスタ)のON/OFF
```

`saveView()` の直後(`_selfTest` の手前)に3つの関数を足す:

```js
  // 保存値 → 真偽。'off' のときだけOFF（未設定・壊れた値は既定ON）
  function parseClusterPref(raw) { return raw !== 'off'; }
  function clusterEnabled() {
    try { return parseClusterPref(localStorage.getItem(CLUSTER_KEY)); } catch (e) { return true; }
  }
  function setClusterEnabled(on) {
    try { localStorage.setItem(CLUSTER_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても動作は続ける */ }
  }
```

最終行の公開部に `clusterEnabled, setClusterEnabled,` を足す。`return { init, setClickHandler, ...` の `getBounds,` の直後に差し込む:

```js
  return { init, setClickHandler, setPlaceClickHandler, getPlaceClickHandler, setRecordPickHandler, setLongPressHandler, setUserPanHandler, setTapHandler, clearPins, renderPins, flyTo, fitTo, refresh, getBounds,
           clusterEnabled, setClusterEnabled,
           renderPlaceResults, clearPlaceResults, hideRecordPins,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map, _sameSpot: sameSpot, _selfTest };
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
node -e "globalThis.window=globalThis; require('./js/map.js'); process.exit(App.map._selfTest());"
```

Expected: 7行すべて `PASS`、最後に `ALL PASS (map)`、終了コード0

- [ ] **Step 5: コミット**

```bash
git add js/map.js && git commit -m "feat(map): cluster on/off preference with self-test"
```

---

### Task 2: クラスタバッジの見た目

**Files:**
- Modify: `style.css`(529行目付近、`.visit-count` の定義の直後)

- [ ] **Step 1: CSSを追加**

`style.css` の `.visit-count { ... }` ブロック(526-529行)の直後、`/* ===== 一日の流れ（ルートシート） ===== */` の手前に追加する:

```css
/* クラスタ（近くのピンを束ねたバッジ）。件数を白文字で出す */
.cluster-pin { width: 34px; height: 34px; border-radius: 50%; background: var(--accent); color: #fff;
  font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  border: 2px solid #fff; box-shadow: var(--shadow-md); cursor: pointer; }
.cluster-pin:hover { transform: scale(1.06); transition: transform .1s; }
```

- [ ] **Step 2: 構文が壊れていないか確認**

```bash
node -e "const c=require('fs').readFileSync('style.css','utf8'); const o=(c.match(/{/g)||[]).length, x=(c.match(/}/g)||[]).length; console.log('braces', o, x); process.exit(o===x?0:1);"
```

Expected: `braces` の2つの数が一致し、終了コード0

- [ ] **Step 3: コミット**

```bash
git add style.css && git commit -m "feat(map): cluster badge style"
```

---

### Task 3: クラスタラの起動・停止と renderPins 連携

**Files:**
- Modify: `js/map.js`(状態変数、`makeMarker`、`clearPins`、`renderPins`)

- [ ] **Step 1: 状態変数を追加**

`js/map.js` 冒頭の `let searchMarkers = [];`(8行目)の直後に2つ足す:

```js
  let clusterer = null;        // MarkerClusterer（クラスタON時のみ）
  let clusterWanted = false;   // 直近の renderPins がクラスタ指定だったか（検索からの復帰判定に使う）
```

- [ ] **Step 2: バッジrendererと起動/停止関数を追加**

`makeMarker()` 関数(217-227行)の直前に追加する:

```js
  // クラスタ（束ねたピン）のバッジ。件数を白文字で出す。
  // gmpClickable が必須：AdvancedMarkerElement のクラスタをライブラリは 'gmp-click' で
  // 待ち受けるため、これが無いとバッジをタップしても何も起きない。
  const clusterRenderer = {
    render(cluster) {
      const c = el('<div class="cluster-pin"></div>');
      c.textContent = String(cluster.count); // 件数（注入防止で textContent）
      c.style.transform = 'translateY(50%)'; // 円の中心を座標に合わせる
      return new AdvancedMarkerElement({
        position: cluster.position,
        content: c,
        zIndex: 900,
        gmpClickable: true,
      });
    },
  };

  // markers をクラスタラに預けて束ねる。CDN未読込なら何もしない（＝通常描画のまま）
  function startClusterer() {
    if (!window.markerClusterer || clusterer || !map) return;
    clusterer = new markerClusterer.MarkerClusterer({ map, markers, renderer: clusterRenderer });
  }
  // 束ねを止めて素の個別ピン制御に戻す。setMap(null) で管理下のマーカーは全て map=null になる。
  function stopClusterer() {
    if (!clusterer) return;
    clusterer.setMap(null);
    clusterer = null;
  }
```

- [ ] **Step 3: makeMarker がマーカーを地図に出さない選択肢を持てるようにする**

`js/map.js` の `makeMarker()`(217-227行)を次のように書き換える:

```js
  // AdvancedMarker を作る。centered=true の content は中心を座標に合わせる（既定は下端中央アンカー）
  // noMap=true は地図に出さない（クラスタに預ける前に一瞬表示されるのを防ぐ）
  function makeMarker(lat, lng, content, opts) {
    opts = opts || {};
    if (opts.centered) content.style.transform = 'translateY(50%)';
    return new AdvancedMarkerElement({
      map: opts.noMap ? null : map,
      position: { lat, lng },
      content,
      zIndex: opts.zIndex,
      gmpDraggable: !!opts.draggable,
    });
  }
```

- [ ] **Step 4: clearPins でクラスタラも破棄する**

`js/map.js` の `clearPins()`(145-149行)を書き換える:

```js
  function clearPins() {
    stopClusterer();   // 先に破棄しないと idle リスナーが残ってマーカーが復活する
    clusterWanted = false;
    markers.forEach((m) => { m.map = null; });
    markers = [];
    if (routeLine) { routeLine.setMap(null); routeLine = null; }
  }
```

- [ ] **Step 5: renderPins に cluster オプションを足す**

`js/map.js` の `renderPins()`(283-308行)を書き換える。変更点は3か所 — `clusterWanted` の決定、`makeMarker` への `noMap`、末尾の `startClusterer()`:

```js
  // records: [{id, lat, lng, name, genre, photos, ...}], onClick: (record)=>void
  // opts.numbered=true で順番バッジ＋ルート点線を描く（records は表示順に並んでいる前提）
  // opts.cluster=true で近接ピンを束ねる（通常のマップ表示のみ。ルート・検索結果では使わない）
  function renderPins(records, onClick, opts) {
    clearPins();
    const numbered = !!(opts && opts.numbered);
    const countAt = opts && opts.countAt;
    clusterWanted = !!(opts && opts.cluster) && !!window.markerClusterer; // CDN未読込なら通常描画
    if (numbered && records.length > 1) {
      routeLine = new google.maps.Polyline({
        path: records.map((r) => ({ lat: r.lat, lng: r.lng })),
        strokeOpacity: 0, // 破線にするため実線は透明にして icons で点を打つ
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: '#b76e64', strokeWeight: 3, scale: 2 },
          offset: '0', repeat: '12px',
        }],
        map,
      });
    }
    records.forEach((r, i) => {
      const { content, centered } = markerContent(r, numbered ? i + 1 : null, countAt ? countAt(r) : 1);
      content.title = r.name || '(名称未設定)'; // ホバーで名前（Leaflet の tooltip 代替）
      const m = makeMarker(r.lat, r.lng, content, { centered, noMap: clusterWanted });
      m.addListener('click', () => {
        if (pickMarker && pickRecordSelect) { pickRecordSelect(r); return; } // 位置ピック中は選択に回す
        onClick(r);
      });
      markers.push(m);
    });
    if (clusterWanted) startClusterer();
  }
```

- [ ] **Step 6: 既存テストが壊れていないか確認**

```bash
node -e "globalThis.window=globalThis; require('./js/map.js'); process.exit(App.map._selfTest());"
```

Expected: `ALL PASS (map)`、終了コード0

- [ ] **Step 7: コミット**

```bash
git add js/map.js && git commit -m "feat(map): cluster markers via markerclusterer with custom badge renderer"
```

---

### Task 4: 場所検索との衝突を解消

場所検索は `markers` 配列の `.map` を直接操作するが、クラスタラは `idle` ごとに自前の可視状態を再適用してしまう。検索に入るときは束ねを止め、抜けるときに戻す。

**Files:**
- Modify: `js/map.js`(`clearPlaceResults`、`hideRecordPins`、`renderPlaceResults`)

- [ ] **Step 1: clearPlaceResults にクラスタ復帰を入れる**

`js/map.js` の `clearPlaceResults()`(162-166行)と `hideRecordPins()`(169行)を書き換える:

```js
  // keepPinsHidden=true のときは記録ピンの表示を戻さない（直後に呼び出し側が決める）
  function clearPlaceResults(keepPinsHidden) {
    searchMarkers.forEach((m) => { m.map = null; });
    searchMarkers = [];
    if (keepPinsHidden) return;
    if (clusterWanted) { // クラスタ表示へ復帰（すでに動いているなら触らない）
      if (!clusterer) { markers.forEach((m) => { m.map = null; }); startClusterer(); }
      return;
    }
    markers.forEach((m) => { if (m.map !== map) m.map = map; }); // 隠していた記録ピンを戻す
  }

  // 記録ピンを即座に全部隠す（検索の通信待ち中に一瞬表示されるのを防ぐ）
  // クラスタON中はバッジがクラスタラ所有の別マーカーなので、先に束ねを止めないと消えない
  function hideRecordPins() { stopClusterer(); markers.forEach((m) => { m.map = null; }); }
```

- [ ] **Step 2: renderPlaceResults で束ねを止める**

`js/map.js` の `renderPlaceResults()`(173-192行)の冒頭部分を書き換える。変更点は `clearPlaceResults` への引数と `stopClusterer()` の追加のみ:

```js
  function renderPlaceResults(places, onSelect, opts) {
    opts = opts || {};
    clearPlaceResults(!!opts.hideRecords);
    places = places || [];
    if (opts.hideRecords) {
      stopClusterer(); // 束ねたままだと idle 再描画に表示状態を上書きされる
      markers.forEach((m) => {
        const c = markerLatLng(m);
        m.map = places.some((p) => sameSpot(p, c)) ? map : null;
      });
    }
```

この関数の残り(`places.forEach(...)` 以降)は変更しない。

- [ ] **Step 3: 既存テストが壊れていないか確認**

```bash
node -e "globalThis.window=globalThis; require('./js/map.js'); process.exit(App.map._selfTest());"
```

Expected: `ALL PASS (map)`、終了コード0

- [ ] **Step 4: 外部からの呼び出しが引数なしのままか確認**

```bash
grep -rn "clearPlaceResults" js/ | grep -v "js/map.js"
```

Expected: `js/records.js` 2件と `js/search.js` 1件がすべて `App.map.clearPlaceResults();`(引数なし)であること。引数なし = `keepPinsHidden` が undefined = 従来どおり全復帰。

- [ ] **Step 5: コミット**

```bash
git add js/map.js && git commit -m "fix(map): suspend clusterer during place search to avoid idle re-render conflict"
```

---

### Task 5: 通常表示のみクラスタを有効にする

**Files:**
- Modify: `js/records.js:78-81`

- [ ] **Step 1: render() の renderPins 呼び出しに cluster を足す**

`js/records.js` の78-81行を書き換える:

```js
    App.map.renderPins(visible, showDetail, {
      numbered: dayMode,
      countAt: (r) => counts[coordKey(r)] || 1,
      cluster: !dayMode && App.map.clusterEnabled(), // 通常表示のみ束ねる（ルート表示は順番が要るので除外）
    });
```

66行目の検索結果モードの `renderPins` は変更しない(クラスタ対象外のため)。

- [ ] **Step 2: 構文チェック**

```bash
node --check js/records.js && echo OK
```

Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add js/records.js && git commit -m "feat(records): enable clustering on the normal map view only"
```

---

### Task 6: メニューのON/OFFトグル

**Files:**
- Modify: `index.html:108`(ジャンル編集ボタンの直後)
- Modify: `style.css`(414行目付近、`#backup-bar button:hover` の直後)
- Modify: `js/app.js`(`wireUI()` 内、`genre-btn` の配線の直後)

- [ ] **Step 1: ボタンを追加**

`index.html` の `<button id="genre-btn">...</button>`(108行目)の直後に足す:

```html
          <button id="cluster-btn"><i class="ph ph-circles-three"></i><span>ピンをまとめる</span></button>
```

- [ ] **Step 2: ON状態のスタイルを追加**

`style.css` の `#backup-bar button:hover { background: var(--surface-2); }`(414行目)の直後に足す:

```css
#backup-bar button.on { background: var(--accent-soft); color: var(--accent-strong); }
#backup-bar button.on .ph { color: var(--accent-strong); }
```

- [ ] **Step 3: 配線する**

`js/app.js` の `wireUI()` 内、`genre-btn` の `addEventListener`(103-107行)の直後、関数を閉じる `}` の手前に足す:

```js
  // ピンをまとめる（クラスタ）ON/OFF。端末ごとの設定で、既定はON。
  const clusterBtn = document.getElementById('cluster-btn');
  function paintClusterBtn() { clusterBtn.classList.toggle('on', App.map.clusterEnabled()); }
  clusterBtn.addEventListener('click', () => {
    App.map.setClusterEnabled(!App.map.clusterEnabled());
    paintClusterBtn();
    App.records.render(); // 束ね方が変わるので描き直す
  });
  paintClusterBtn();
```

- [ ] **Step 4: 構文チェック**

```bash
node --check js/app.js && echo OK
```

Expected: `OK`

- [ ] **Step 5: ボタンidの重複がないか確認**

```bash
grep -c 'id="cluster-btn"' index.html
```

Expected: `1`

- [ ] **Step 6: コミット**

```bash
git add index.html style.css js/app.js && git commit -m "feat(map): menu toggle for pin clustering"
```

---

### Task 7: CDN追加と版上げ

**Files:**
- Modify: `index.html:24`(exifr の直後)、および全体の `?v=` と `app-ver`

- [ ] **Step 1: CDNを追加**

`index.html` の `<script src="https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js"></script>`(24行目)の直後に足す:

```html
  <script src="https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer@2.6.2/dist/index.min.js"></script>
```

- [ ] **Step 2: 版を上げる**

キャッシュ対策のため `?v=` と表示版を一括で上げる:

```bash
sed -i 's/20260819y/20260824a/g' index.html
```

- [ ] **Step 3: 置換結果を確認**

```bash
grep -c "20260824a" index.html && grep -c "20260819y" index.html
```

Expected: 1行目が `23`(置換前と同数)、2行目は該当なしで `0` が出て終了コード1になる(この `grep -c` の1は正常)

- [ ] **Step 4: コミット**

```bash
git add index.html && git commit -m "chore(deps): add markerclusterer CDN and bump version to 20260824a"
```

---

### Task 8: 実機での動作確認

自動テストで拾えない領域を、ブラウザで実際に触って確認する。デプロイは push で本番反映される([[maprecord-deploy]] の方式)。

- [ ] **Step 1: ローカルで開く**

```bash
npx --yes serve . -l 8000
```

ブラウザで `http://localhost:8000` を開き、ログインして地図を表示する。

(この環境では `python` コマンドがMicrosoft Storeのスタブに当たって失敗するため、Pythonの簡易サーバーは使わない。)

- [ ] **Step 2: 自己テストをブラウザでも走らせる**

DevToolsのコンソールで実行:

```js
App.map._selfTest()
```

Expected: `ALL PASS (map)` と表示され、戻り値 `0`

- [ ] **Step 3: クラスタ表示を確認**

記録が複数ある地域までズームアウトする。

Expected: 近接ピンがテラコッタ色の丸バッジ(件数入り)にまとまる。ズーム16以上では必ず個別ピンに戻る(ライブラリの `maxZoom = 16` 既定)。

- [ ] **Step 4: バッジのタップを確認(`gmpClickable` の検証)**

クラスタバッジをタップする。

Expected: そのクラスタの範囲にズーム・パンして中身のピンが展開される。**何も起きない場合は Task 3 の `gmpClickable: true` が抜けている。**

- [ ] **Step 5: 場所検索との衝突を確認**

クラスタON状態で、上部の検索欄に店名を入れてEnterを押す。

Expected: クラスタバッジが消え、赤い検索ピンが出る。バッジが残っていたら Task 4 の `hideRecordPins` の `stopClusterer()` が効いていない。

- [ ] **Step 6: 検索中のドラッグを確認(idle 再描画の検証)**

検索結果が出ている状態で地図をドラッグする。

Expected: 記録ピンが勝手に復活しない。復活する場合は Task 4 の `renderPlaceResults` 内の `stopClusterer()` が抜けている。

- [ ] **Step 7: 検索を抜けてクラスタ復帰を確認**

検索欄の×をクリックして検索を解除する。

Expected: 赤ピンが消え、クラスタバッジ表示に戻る。

- [ ] **Step 8: ルート表示が対象外か確認**

絞り込みで「特定の日」を選び、記録が2件以上ある日を選ぶ。

Expected: 番号付きピンと点線ルートが出て、クラスタ化されない。

- [ ] **Step 9: ON/OFFトグルを確認**

メニューを開いて「ピンをまとめる」をタップする。

Expected: ボタンの背景がテラコッタ淡色(ON)と無色(OFF)で切り替わり、地図が即座に束ねあり/なしに変わる。ページを再読み込みしても設定が残る。

- [ ] **Step 10: CDN失敗時のフォールバックを確認**

DevToolsのコンソールで実行:

```js
delete window.markerClusterer; App.records.render();
```

Expected: 例外が出ず、全ピンが個別表示される(CDNが落ちても地図は使える)。確認後はページを再読み込みして元に戻す。

- [ ] **Step 11: 本番へ反映**

```bash
git push
```

GitHub Pages に反映されたら、スマホの本番URLで Step 3〜5 を再確認する。

---

## 完了条件

- `node -e "globalThis.window=globalThis; require('./js/map.js'); process.exit(App.map._selfTest());"` が終了コード0
- Task 8 の Step 3〜10 がすべて期待どおり
- 本番URLでクラスタ表示・タップ展開・検索の出入りが動作する
