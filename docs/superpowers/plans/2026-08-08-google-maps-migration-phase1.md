# Google Maps 載せ替え（フェーズ1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地図エンジンを Leaflet から Google Maps（Advanced Markers）へ載せ替え、既存機能を完全に維持したまま日本語ラベルを自然にする。

**Architecture:** 地図処理は `js/map.js` に集約されている。`map.js` を Google Maps 版へ全面書き換えし、公開インターフェース（`init/setClickHandler/renderPins/clearPins/flyTo/fitTo/refresh/showTempMarker/clearTempMarker/startPickLocation/getPickedLatLng/stopPickLocation`）を完全維持する。`init()` を async 化するため `js/app.js` の `startApp` を async にして `await App.map.init()` する。`index.html` の Leaflet を Google Maps ローダーへ差し替える。ピンは `AdvancedMarkerElement` に既存のピンHTMLをそのまま content として渡し、`style.css` のピン系クラスを流用する。

**Tech Stack:** Vanilla JS（`window.App.*` グローバルモジュール）, Google Maps JavaScript API（`importLibrary('maps')` / `importLibrary('marker')`, Advanced Markers, Polyline）, Firebase（既存）。

**テスト方針（重要）:** 自動テストランナーは無い。JSは `node --check`（google.* は実行時グローバルなのでパースのみ通ればOK）で構文検証する。地図の実挙動はログイン必須＋APIキーがドメイン制限のため**ローカル実地テスト不可**＝**本番（GitHub Pages）でユーザーが手動確認**する。

**デプロイ順の重要注意:** Google のAPIキー/Map ID は**ユーザー提供の値**で、揃うまでは地図が表示できない。**Task 1〜3 はコミットのみ（push しない）**。**プレースホルダのままpushすると本番の地図が壊れる**ため、実キー/Map ID を差し込む **Task 4 で初めて push** する。

**前提（ユーザーのコンソール作業。Task 4 実行前に必要）:**
1. 課金有効化（カード登録）
2. Maps JavaScript API を有効化
3. APIキー作成 → リファラー制限 `https://tktk-h.github.io/*` ＋ API制限 = Maps JavaScript API のみ
4. Map ID 作成（ベクター、Advanced Markers 有効）
5. 予算アラート＋クオータ上限を設定
6. **APIキー** と **Map ID** を実装者に渡す

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `index.html` | Leaflet 撤去、Google Maps ローダー追加 | 変更 |
| `js/map.js` | Google Maps 版へ全面書き換え（Advanced Markers、async init、同一IF） | 全面書き換え |
| `js/app.js` | `startApp` を async 化し `await App.map.init()` | 変更 |
| `js/records.js` ほか | `App.map.*` 経由のため無改修 | なし |
| `style.css` | ピン系クラスは流用。Leaflet固有ルールは無し（コメント文言のみ後日整理可） | 実質なし |

備考（調査済み）: `L.` の使用は `map.js` のみ。`_getLayer` の外部利用なし。`style.css` に `.leaflet-*` ルールは無し（284行目のコメントに "Leaflet" とあるだけ）。よって CSS 変更は不要。

---

## Task 1: index.html — Leaflet 撤去 & Google Maps ローダー追加

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Leaflet の CSS 読み込みを削除**

`index.html` の次の行（13行目付近）を**削除**する:
```html
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
```

- [ ] **Step 2: Google Maps inline ローダーを `<head>` に追加**

`index.html` の `<link rel="stylesheet" href="style.css">` 行の**直後**（`</head>` の直前）に、以下を追加する。`<<GMAPS_API_KEY>>` は Task 4 で実キーに置換する（今はこの文字列のまま）:
```html
  <script>
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
      key: "<<GMAPS_API_KEY>>",
      v: "weekly",
    });
  </script>
```

- [ ] **Step 3: Leaflet の JS 読み込みを削除**

`index.html` 本文（93行目付近）の次の行を**削除**する:
```html
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

- [ ] **Step 4: 確認**

Run:
```bash
grep -n "leaflet" index.html || echo "no leaflet (good)"
grep -n "importLibrary" index.html
```
Expected: 1つ目は "no leaflet (good)"。2つ目はローダーの行がヒットする。

- [ ] **Step 5: コミット（push しない）**

```bash
git add index.html
git commit -m "Swap Leaflet includes for Google Maps loader (placeholder key)"
```

---

## Task 2: js/map.js — Google Maps 版へ全面書き換え

**Files:**
- Modify: `js/map.js`（ファイル全体を下記で置き換え）

- [ ] **Step 1: `js/map.js` の全内容を以下で置き換える**

`<<GMAPS_MAP_ID>>` は Task 4 で実 Map ID に置換する（今はこの文字列のまま）。

```js
window.App = window.App || {};
App.map = (function () {
  const MAP_ID = '<<GMAPS_MAP_ID>>'; // ★Task 4 でユーザー提供の Map ID に置換

  let map;
  let AdvancedMarkerElement;   // marker ライブラリのクラス（init で読み込む）
  let markers = [];            // renderPins で出したマーカー
  let routeLine = null;        // ルートの点線（numbered 表示時）
  let tempMarker = null;       // 追加フォーム中の目印
  let pickMarker = null;       // 位置修正のドラッグ用
  let onMapClick = null;       // (lat, lng) => void

  const VIEW_KEY = 'date-recorder-view';

  function loadView() {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY));
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.zoom === 'number') {
        return v;
      }
    } catch (e) { /* 壊れた値は無視 */ }
    return { lat: 35.681236, lng: 139.767125, zoom: 13 }; // 初回は東京駅あたり
  }

  function saveView() {
    const c = map.getCenter();
    if (!c) return;
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat(), lng: c.lng(), zoom: map.getZoom() }));
  }

  // html文字列 → 最初の要素ノード
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  async function init() {
    const v = loadView();
    const { Map } = await google.maps.importLibrary('maps');
    ({ AdvancedMarkerElement } = await google.maps.importLibrary('marker'));
    map = new Map(document.getElementById('map'), {
      center: { lat: v.lat, lng: v.lng },
      zoom: v.zoom,
      mapId: MAP_ID,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
      clickableIcons: false,      // GoogleのPOIクリックで情報ウィンドウを出さない
      gestureHandling: 'greedy',  // スマホ1本指でも地図が動く
    });
    map.addListener('click', (e) => { if (onMapClick && e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng()); });
    map.addListener('idle', saveView); // 表示位置・ズームを保存
  }

  function setClickHandler(fn) { onMapClick = fn; }

  function clearPins() {
    markers.forEach((m) => { m.map = null; });
    markers = [];
    if (routeLine) { routeLine.setMap(null); routeLine = null; }
  }

  function flyTo(lat, lng) { map.panTo({ lat, lng }); map.setZoom(16); }

  // 非表示→表示の復帰時に再描画を促す（位置は変えない）
  function refresh() {
    if (!map) return;
    const c = map.getCenter();
    if (c) map.setCenter(c);
  }

  // 複数地点が全部見えるように地図を合わせる（検索結果など）
  function fitTo(records) {
    if (!records || !records.length || !map) return;
    const bounds = new google.maps.LatLngBounds();
    records.forEach((r) => bounds.extend({ lat: r.lat, lng: r.lng }));
    map.fitBounds(bounds, 60); // padding 60px
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 16) map.setZoom(16); // 1点のとき寄りすぎ防止
    });
  }

  // AdvancedMarker を作る。centered=true の content は中心を座標に合わせる（既定は下端中央アンカー）
  function makeMarker(lat, lng, content, opts) {
    opts = opts || {};
    if (opts.centered) content.style.transform = 'translateY(50%)';
    return new AdvancedMarkerElement({
      map,
      position: { lat, lng },
      content,
      zIndex: opts.zIndex,
      gmpDraggable: !!opts.draggable,
    });
  }

  // 追加しようとしている地点の目印（保存前の仮マーカー）
  function showTempMarker(lat, lng) {
    clearTempMarker();
    tempMarker = makeMarker(lat, lng, el('<div class="temp-pin"></div>'), { zIndex: 1000, centered: true });
  }
  function clearTempMarker() {
    if (tempMarker) { tempMarker.map = null; tempMarker = null; }
  }

  // 位置修正：対象地点へ寄せ、ドラッグ可能なマーカーを1つ出す
  function startPickLocation(lat, lng) {
    stopPickLocation();
    map.panTo({ lat, lng });
    if (map.getZoom() < 16) map.setZoom(16);
    pickMarker = makeMarker(lat, lng, el('<div class="temp-pin picking"></div>'),
      { zIndex: 1200, centered: true, draggable: true });
  }
  // 現在のドラッグ位置 { lat, lng }（未開始なら null）
  function getPickedLatLng() {
    if (!pickMarker) return null;
    const p = pickMarker.position;
    if (!p) return null;
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
    return { lat, lng };
  }
  function stopPickLocation() {
    if (pickMarker) { pickMarker.map = null; pickMarker = null; }
  }

  // 1件ぶんの content 要素を作る。number=順番バッジ／count>1=訪問回数バッジ。
  // 戻り値 { content, centered }（写真ピンは下端＝しっぽが座標なので centered=false）
  function markerContent(r, number, count) {
    const color = App.genres.color(r.genre);
    const photo = (r.photos || [])[0];
    let badge = '';
    if (number != null) badge = `<span class="pin-order">${number}</span>`;
    else if (count > 1) badge = `<span class="visit-count">${count}</span>`;
    if (photo) {
      const c = el(`<div class="photo-pin">`
        + `<img class="pin-img" src="${photo.url}" style="border-color:${color}">`
        + badge
        + `<span class="pin-tail" style="border-top-color:${color}"></span>`
        + `</div>`);
      return { content: c, centered: false };
    }
    const inner = (number != null) ? number : '';
    const dotBadge = (number == null && count > 1) ? `<span class="visit-count">${count}</span>` : '';
    const c = el(`<div class="dot-pin" style="background:${color}">${inner}${dotBadge}</div>`);
    return { content: c, centered: true };
  }

  // records: [{id, lat, lng, name, genre, photos, ...}], onClick: (record)=>void
  // opts.numbered=true で順番バッジ＋ルート点線を描く（records は表示順に並んでいる前提）
  function renderPins(records, onClick, opts) {
    clearPins();
    const numbered = !!(opts && opts.numbered);
    const countAt = opts && opts.countAt;
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
      const m = makeMarker(r.lat, r.lng, content, { centered });
      m.addListener('click', () => onClick(r));
      markers.push(m);
    });
  }

  return { init, setClickHandler, clearPins, renderPins, flyTo, fitTo, refresh,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
})();
```

- [ ] **Step 2: 構文チェック**

Run: `node --check js/map.js`
Expected: エラーなし（何も出力されず終了）。

- [ ] **Step 3: 公開関数がすべて存在するか確認**

Run:
```bash
grep -nE "init|setClickHandler|renderPins|clearPins|flyTo|fitTo|refresh|showTempMarker|clearTempMarker|startPickLocation|getPickedLatLng|stopPickLocation" js/map.js | grep "return {"
```
Expected: return 行に上記の関数名が並んでいる（`init, setClickHandler, clearPins, renderPins, flyTo, fitTo, refresh, showTempMarker, clearTempMarker, startPickLocation, getPickedLatLng, stopPickLocation`）。

- [ ] **Step 4: コミット（push しない）**

```bash
git add js/map.js
git commit -m "Rewrite map.js on Google Maps (Advanced Markers), same public interface"
```

---

## Task 3: js/app.js — startApp を async 化して init を待つ

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: `startApp` を async にして `await App.map.init()`**

`js/app.js` の `startApp` 関数を探す。現在は次の形:
```js
function startApp(sp) {
  cloud.setSpace(sp.id);
  // アプリを開いた記録（最終アクセス）を残す。失敗しても本体には影響させない。
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});
  if (!started) {
    App.map.init();
    App.records.init();
    App.sheet.init();
    wireUI();
    started = true;
  }
  cloud.subscribe((records) => App.records.setRecords(records)); // リアルタイム反映
}
```
これを次の形に置き換える（`function` → `async function`、`App.map.init()` → `await App.map.init()`）:
```js
async function startApp(sp) {
  cloud.setSpace(sp.id);
  // アプリを開いた記録（最終アクセス）を残す。失敗しても本体には影響させない。
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});
  if (!started) {
    await App.map.init(); // Google Maps ライブラリの読み込み完了を待つ
    App.records.init();
    App.sheet.init();
    wireUI();
    started = true;
  }
  cloud.subscribe((records) => App.records.setRecords(records)); // リアルタイム反映
}
```

- [ ] **Step 2: DOMContentLoaded で startApp の失敗を握りつぶす**

`js/app.js` 末尾の次の箇所を:
```js
document.addEventListener('DOMContentLoaded', () => {
  gate.init((sp) => startApp(sp));
});
```
次に置き換える（async startApp が reject しても未処理にならないように）:
```js
document.addEventListener('DOMContentLoaded', () => {
  gate.init((sp) => { startApp(sp).catch((e) => console.error('startApp failed', e)); });
});
```

- [ ] **Step 3: 構文チェック**

Run: `node --input-type=module --check < js/app.js`
Expected: エラーなし。

- [ ] **Step 4: コミット（push しない）**

```bash
git add js/app.js
git commit -m "Await async map init in startApp (Google Maps loads asynchronously)"
```

---

## Task 4: 実キー/Map ID 差し込み → デプロイ → 本番確認

**前提:** ユーザーから **APIキー** と **Map ID** を受け取っていること。受け取っていなければここで待つ（BLOCKED として報告）。

**Files:**
- Modify: `index.html`（`<<GMAPS_API_KEY>>` を実キーへ）
- Modify: `js/map.js`（`<<GMAPS_MAP_ID>>` を実 Map ID へ）

- [ ] **Step 1: API キーを差し込む**

`index.html` の `key: "<<GMAPS_API_KEY>>"` を、ユーザー提供の実キーに置換する（例: `key: "AIzaSy...実際の値..."`）。

- [ ] **Step 2: Map ID を差し込む**

`js/map.js` の `const MAP_ID = '<<GMAPS_MAP_ID>>';` を、ユーザー提供の実 Map ID に置換する（例: `const MAP_ID = '実際のMapID';`）。

- [ ] **Step 3: プレースホルダが残っていないか確認**

Run:
```bash
grep -rn "<<GMAPS" index.html js/map.js || echo "no placeholders (good)"
```
Expected: "no placeholders (good)"。

- [ ] **Step 4: 構文チェック**

Run: `node --check js/map.js`
Expected: エラーなし。

- [ ] **Step 5: コミット & プッシュ（ここで初めて本番反映）**

```bash
git add index.html js/map.js
git commit -m "Wire real Google Maps API key and Map ID; deploy phase 1"
git push origin main
```

- [ ] **Step 6: 本番で手動確認（約1分後・要ログイン・できればスマホ）**

https://tktk-h.github.io/maprecord/ で以下を確認:
- 地図が Google Maps で表示され、**地名が自然な日本語**
- 写真ピン／丸ピン／訪問回数バッジが従来どおり
- 地図タップ → 追加フォーム（仮マーカーが出る）→ 保存で記録が地図に出る
- 記録タップ → 詳細 → 編集 →「位置を修正」でドラッグ → 更新で移動が保存される
- カレンダーで日付選択 → その日のルート（番号ピン＋点線）が出る／地図へ飛ぶ
- 検索（保存済み記録の名前/タグ）で移動・複数候補リストが従来どおり
- 表示位置・ズームが再訪時に復元される
- ズームコントロールが左下、POI 誤タップで情報ウィンドウが出ない
- 二人の端末で同期・表示が問題ない

- [ ] **Step 7: 問題があれば記録**

コンソールエラー（キー制限/Map ID 不正など）が出た場合は内容を控え、設定（リファラー制限・API制限・Map ID の有効化）を見直す。地図が出ない主因は「キー制限ミス」「Map ID 未設定/無効」「対象APIが無効」のいずれか。

---

## Self-Review（計画者による確認結果）

- **スペック網羅:**
  - 公開IF維持 → Task 2 で全関数を同名・同引数で実装、return に列挙。✓
  - Advanced Markers + Map ID → Task 2（MAP_ID 定数、`importLibrary('marker')`、makeMarker）。✓
  - 写真ピン/丸ピン/バッジ/ルート点線/tempMarker/pick(drag)/flyTo/fitTo/saveView/クリック追加 → Task 2 で網羅。✓
  - async init → Task 2（init async）+ Task 3（await + DOMContentLoaded catch）。✓
  - Leaflet 撤去・ローダー追加 → Task 1。✓
  - 事前準備（キー/Map ID/制限/上限） → 冒頭「前提」＋ Task 4 前提。✓
  - CSS はピン系流用・Leaflet固有ルール無し（調査済み） → 変更タスク不要。✓
  - デプロイ順（placeholder中は push しない、Task 4 で push） → 明記。✓
- **プレースホルダ:** `<<GMAPS_API_KEY>>` / `<<GMAPS_MAP_ID>>` は**ユーザー提供の外部値**で、置換場所・置換タイミング（Task 4）を明示済み。実装手順自体の曖昧さは無し。
- **型/名称整合:** `App.map.*` の公開名は既存呼び出し（records.js/app.js）と一致。`markerContent`→`makeMarker`→`renderPins` の受け渡し（`{content, centered}`）が一貫。`getPickedLatLng` は `{lat,lng}` を返す（記録更新側の期待と一致）。`clearPins` は markers と routeLine を両方消す。
