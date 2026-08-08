# 店(POI)カード＋記録追加（Places API）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地図上の店(POI)をタップすると Places API で情報を取得し、下シートに Googleマップ風の店カード（写真・★評価・営業時間・電話・経路・Googleマップで開く・記録に追加）を表示する。

**Architecture:** Places 取得を新モジュール `js/places.js` に隔離（`fetchPlace(placeId)` が正規化オブジェクトを返す＝UIは Google 固有型に非依存。将来の検索もここに足す）。`js/map.js` は POI クリックを有効化し、placeId を `setPlaceClickHandler` 経由で通知（空きタップは従来の記録追加のまま）。`js/records.js` に `showPlaceCard(placeId)` を追加して店カードを描画、「記録に追加」で `showAddForm` に位置・店名・推定ジャンルを渡す。

**Tech Stack:** Vanilla JS（`window.App.*`）, Google Maps JavaScript API（`importLibrary('places')` の `Place` クラス, Advanced Markers 既存）, Firebase（既存）。

**テスト方針:** 自動テスト無し。JSは `node --check`（`google.*` は実行時グローバル＝パースのみでOK）。実挙動はログイン必須＋APIキーがドメイン制限のため**本番でユーザーが手動確認**。

**デプロイ順の注意:** POIカードは **Places API の有効化＋キー許可**が前提。**Task 1〜5 はコミットのみ（push しない）**。ユーザーが Places API を有効化した後、**Task 6 で push**。

**前提（ユーザーのコンソール作業。Task 6 実行前に必要）:**
1. 「APIとサービス」→「ライブラリ」→ **Places API (New)** を有効化。
2. 既存 APIキーの **「APIの制限」に Places API (New) を追加**（現在 Maps JavaScript API のみ）。

**参照（確認済みの既存仕様）:**
- `App.lightbox.open(urlList, startIndex)`（url文字列配列, `js/lightbox.js:55`）
- `records.js` の `esc()`（`&<>"`エスケープ）、`showAddForm(lat, lng, { name, genre })`、`clearPanel()`、`panel()`、`App.sheet.snapTo('half')`、既存クラス `.back-btn` / `.revisit-btn` / `.gmaps-btn` / `.meta`
- `records.init`（`js/records.js:516`）に `App.map.setClickHandler(showAddForm);` がある
- アイコンは **Phosphor regular** のみ読み込み（`ph-star-fill` 等の fill 版は使わない → `ph-star` を使う）

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/places.js` | **新規**。`fetchPlace(placeId)`（正規化オブジェクト返却）と `genreFromTypes` | 新規 |
| `js/map.js` | POIクリック有効化＋placeId分岐＋`setPlaceClickHandler` | 変更 |
| `js/records.js` | `showPlaceCard(placeId)` 追加、`init` で配線、export | 変更 |
| `index.html` | `js/places.js` の読み込み追加 | 変更 |
| `style.css` | 店カードの見た目 | 変更 |

---

## Task 1: js/map.js — POIクリック有効化＋placeId通知

**Files:** Modify `js/map.js`

- [ ] **Step 1: POI クリックを有効化**

`js/map.js` の Map 生成オプション内、次の行:
```js
      clickableIcons: false,      // GoogleのPOIクリックで情報ウィンドウを出さない
```
を、次に置き換える:
```js
      clickableIcons: true,       // 店(POI)をタップ可能に（placeIdで分岐）
```

- [ ] **Step 2: `onPlaceClick` 変数を追加**

`js/map.js` 冒頭の `let onMapClick = null;       // (lat, lng) => void` の直後に追加:
```js
  let onPlaceClick = null;     // (placeId) => void  ... 店(POI)タップ時
```

- [ ] **Step 3: クリックハンドラを placeId で分岐**

`init()` 内の次の行:
```js
    map.addListener('click', (e) => { if (onMapClick && e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng()); });
```
を、次に置き換える:
```js
    map.addListener('click', (e) => {
      if (e.placeId) {                 // 店・施設(POI)をタップ
        if (e.stop) e.stop();          // Google標準の情報ウィンドウを抑制
        if (onPlaceClick) onPlaceClick(e.placeId);
        return;
      }
      if (onMapClick && e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng()); // 空きタップ＝記録追加
    });
```

- [ ] **Step 4: `setPlaceClickHandler` を追加**

`function setClickHandler(fn) { onMapClick = fn; }` の直後に追加:
```js
  function setPlaceClickHandler(fn) { onPlaceClick = fn; }
```

- [ ] **Step 5: return に公開**

`js/map.js` 末尾の return を次のように変更（`setPlaceClickHandler` を追加）:
```js
  return { init, setClickHandler, setPlaceClickHandler, clearPins, renderPins, flyTo, fitTo, refresh,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
```

- [ ] **Step 6: 構文チェック**

Run: `node --check js/map.js`
Expected: エラーなし。

- [ ] **Step 7: コミット（push しない）**

```bash
git add js/map.js
git commit -m "Enable POI clicks; notify placeId via setPlaceClickHandler"
```

---

## Task 2: js/places.js — Places 取得モジュール（新規）

**Files:** Create `js/places.js`

- [ ] **Step 1: `js/places.js` を新規作成**

```js
window.App = window.App || {};
// Places（店・施設）情報の取得。将来ここに検索(autocomplete/textSearch)も足す想定。
// UI は Google 固有型に依存しないよう、正規化したオブジェクトを返す。
App.places = (function () {
  // Google の place types 配列 → App.genres の key を推定
  function genreFromTypes(types) {
    const t = new Set(types || []);
    const has = (...ks) => ks.some((k) => t.has(k));
    if (has('cafe', 'coffee_shop')) return 'cafe';
    if (has('restaurant', 'food', 'meal_takeaway', 'meal_delivery', 'bakery', 'bar')) return 'food';
    if (has('tourist_attraction', 'park', 'museum', 'aquarium', 'zoo', 'art_gallery', 'landmark')) return 'sightsee';
    if (has('store', 'shopping_mall', 'clothing_store', 'department_store', 'supermarket', 'convenience_store')) return 'shopping';
    if (has('lodging', 'spa', 'gym', 'movie_theater', 'amusement_park', 'stadium')) return 'facility';
    return 'other';
  }

  // LatLng or LatLngLiteral → { lat, lng }
  function coord(loc) {
    if (!loc) return { lat: null, lng: null };
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    return { lat, lng };
  }

  // 今日の営業時間文字列（weekdayDescriptions は月曜始まり）
  function hoursToday(hours) {
    const desc = hours && hours.weekdayDescriptions;
    if (!Array.isArray(desc) || desc.length < 7) return null;
    const idx = (new Date().getDay() + 6) % 7; // 0=月曜
    return desc[idx] || null;
  }

  async function fetchPlace(placeId) {
    const { Place } = await google.maps.importLibrary('places');
    const place = new Place({ id: placeId });
    await place.fetchFields({ fields: [
      'displayName', 'formattedAddress', 'rating', 'userRatingCount',
      'regularOpeningHours', 'nationalPhoneNumber', 'websiteURI',
      'googleMapsURI', 'photos', 'location', 'types',
    ] });
    let openNow = null;
    try { const o = await place.isOpen(); if (typeof o === 'boolean') openNow = o; } catch (e) { /* 取得不可は null */ }
    const photoUrls = (place.photos || []).slice(0, 5)
      .map((ph) => { try { return ph.getURI({ maxWidth: 400, maxHeight: 400 }); } catch (e) { return null; } })
      .filter(Boolean);
    const { lat, lng } = coord(place.location);
    return {
      name: place.displayName || '(名称不明)',
      address: place.formattedAddress || '',
      rating: (typeof place.rating === 'number') ? place.rating : null,
      ratingCount: (typeof place.userRatingCount === 'number') ? place.userRatingCount : null,
      openNow,
      hoursToday: hoursToday(place.regularOpeningHours),
      phone: place.nationalPhoneNumber || null,
      website: place.websiteURI || null,
      googleMapsURI: place.googleMapsURI || null,
      photoUrls, lat, lng,
      genre: genreFromTypes(place.types),
    };
  }

  return { fetchPlace, genreFromTypes };
})();
```

- [ ] **Step 2: 構文チェック**

Run: `node --check js/places.js`
Expected: エラーなし。

- [ ] **Step 3: コミット（push しない）**

```bash
git add js/places.js
git commit -m "Add places module: fetchPlace via Places API (normalized), genre inference"
```

---

## Task 3: index.html — places.js を読み込む

**Files:** Modify `index.html`

- [ ] **Step 1: `js/places.js` を records.js の前に追加**

`index.html` の `  <script src="js/map.js"></script>` の**直後**（`  <script src="js/records.js"></script>` の直前）に追加:
```html
  <script src="js/places.js"></script>
```

- [ ] **Step 2: 確認**

Run: `grep -n "js/places.js" index.html`
Expected: 追加した行がヒットする（map.js と records.js の間）。

- [ ] **Step 3: コミット（push しない）**

```bash
git add index.html
git commit -m "Load places.js before records.js"
```

---

## Task 4: js/records.js — showPlaceCard 追加＋配線＋export

**Files:** Modify `js/records.js`

- [ ] **Step 1: `showPlaceCard` を追加**

`js/records.js` の `function clearPanel() {` の**直前**に、以下の関数を挿入する:
```js
  // 店(POI)カード：Places の情報を Googleマップ風に下シートへ。「記録に追加」で追加フォームへ。
  async function showPlaceCard(placeId) {
    searchResults = null;
    activeTag = null;
    App.map.clearTempMarker();
    panel().innerHTML = `
      <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      <p class="hint">読み込み中…</p>`;
    if (App.sheet) App.sheet.snapTo('half');
    document.getElementById('pc-back').onclick = clearPanel;

    let p;
    try {
      p = await App.places.fetchPlace(placeId);
    } catch (err) {
      panel().innerHTML = `
        <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
        <p class="hint">店の情報を取得できませんでした。</p>`;
      document.getElementById('pc-back').onclick = clearPanel;
      return;
    }

    const photos = p.photoUrls.length
      ? `<div class="pc-photos">${p.photoUrls.map((u, i) => `<img class="pc-photo" src="${u}" data-i="${i}" alt="">`).join('')}</div>`
      : '';
    const rating = (p.rating != null)
      ? `<div class="pc-rating"><i class="ph ph-star"></i>${p.rating}${p.ratingCount != null ? `<span class="pc-count">（${p.ratingCount}）</span>` : ''}</div>`
      : '';
    let openHtml = '';
    if (p.openNow === true) openHtml = '<span class="pc-open">営業中</span>';
    else if (p.openNow === false) openHtml = '<span class="pc-closed">営業時間外</span>';
    const hours = p.hoursToday ? `<span class="pc-hours">${esc(p.hoursToday)}</span>` : '';
    const mapsUrl = p.googleMapsURI || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
    const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    const actions = [
      p.phone ? `<a class="pc-act" href="tel:${p.phone.replace(/[^0-9+]/g, '')}"><i class="ph ph-phone"></i>電話</a>` : '',
      `<a class="pc-act" href="${dirUrl}" target="_blank" rel="noopener"><i class="ph ph-arrow-bend-up-right"></i>経路</a>`,
      `<a class="pc-act" href="${mapsUrl}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i>マップ</a>`,
    ].filter(Boolean).join('');

    panel().innerHTML = `
      <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      ${photos}
      <h2>${esc(p.name)}</h2>
      <p class="meta">${App.genres.label(p.genre)}</p>
      <div class="pc-sub">${rating}${openHtml}${hours}</div>
      <div class="pc-actions">${actions}</div>
      <button type="button" id="pc-add" class="revisit-btn"><i class="ph ph-plus"></i>この店を記録に追加</button>
      ${p.website ? `<a class="gmaps-btn" href="${p.website}" target="_blank" rel="noopener"><i class="ph ph-globe"></i>公式サイト</a>` : ''}
      <p class="memo">${esc(p.address) || ''}</p>`;

    document.getElementById('pc-back').onclick = clearPanel;
    panel().querySelectorAll('.pc-photo').forEach((img) => {
      img.onclick = () => App.lightbox.open(p.photoUrls, Number(img.dataset.i));
    });
    document.getElementById('pc-add').onclick = () => {
      App.map.flyTo(p.lat, p.lng);
      showAddForm(p.lat, p.lng, { name: p.name, genre: p.genre });
    };
  }
```

- [ ] **Step 2: `init` で配線**

`js/records.js` の `init()` 内、`App.map.setClickHandler(showAddForm);` の**直後**に追加:
```js
    App.map.setPlaceClickHandler(showPlaceCard);
```

- [ ] **Step 3: return に `showPlaceCard` を公開**

`js/records.js` 末尾の return を次のように変更（`showPlaceCard` を追加）:
```js
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showPlaceCard, _clearPanel: clearPanel };
```

- [ ] **Step 4: 構文チェック**

Run: `node --check js/records.js`
Expected: エラーなし。

- [ ] **Step 5: 参照の確認**

Run:
```bash
grep -nE "showPlaceCard|setPlaceClickHandler" js/records.js js/map.js
```
Expected: `showPlaceCard` は records.js に定義・init配線・export・return の各所、`setPlaceClickHandler` は map.js（定義・return）と records.js（init配線）でヒットする。

- [ ] **Step 6: コミット（push しない）**

```bash
git add js/records.js
git commit -m "Add place card view (showPlaceCard) and wire POI clicks"
```

---

## Task 5: style.css — 店カードの見た目

**Files:** Modify `style.css`

- [ ] **Step 1: `.gmaps-btn` 群の定義の直後にカードのスタイルを追加**

`style.css` の `.gmaps-btn:active { transform: scale(.98); }` の**直後**に追加:
```css
/* 店(POI)カード */
.pc-photos { display: flex; gap: 6px; overflow-x: auto; margin: 4px 0 10px;
  -webkit-overflow-scrolling: touch; }
.pc-photo { height: 110px; width: auto; border-radius: var(--radius-sm);
  object-fit: cover; flex: 0 0 auto; cursor: pointer; }
.pc-sub { display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin: 2px 0 12px; font-size: 13px; }
.pc-rating { display: inline-flex; align-items: center; gap: 4px; color: var(--text); font-weight: 600; }
.pc-rating .ph { color: #e8a33d; }
.pc-count { color: var(--text-muted); font-weight: 400; }
.pc-open { color: #2e7d5b; font-weight: 600; }
.pc-closed { color: #b5675f; font-weight: 600; }
.pc-hours { color: var(--text-muted); }
.pc-actions { display: flex; gap: 8px; margin: 0 0 12px; }
.pc-act { flex: 1; display: inline-flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 10px 6px; border-radius: var(--radius-sm); background: var(--surface-2);
  color: var(--accent-strong); font-size: 12px; font-weight: 600; text-decoration: none; }
.pc-act .ph { font-size: 18px; }
.pc-act:active { transform: scale(.97); }
```

- [ ] **Step 2: 確認**

Run: `grep -n "pc-photos\|pc-act\|pc-rating" style.css`
Expected: 追加したクラスがヒットする。

- [ ] **Step 3: コミット（push しない）**

```bash
git add style.css
git commit -m "Style the POI place card"
```

---

## Task 6: Places API 有効化 → デプロイ → 本番確認

**前提:** ユーザーが Places API (New) を有効化し、APIキーの「APIの制限」に Places API (New) を追加していること。未完なら BLOCKED として待つ。

**Files:** なし（デプロイのみ）

- [ ] **Step 1: プッシュ（本番反映）**

```bash
git push origin main
```

- [ ] **Step 2: 本番で手動確認（約1分後・要ログイン・できればスマホ）**

https://tktk-h.github.io/maprecord/ で:
- 地図上の**店・施設(POIラベル)をタップ** → 下シートに**店カード**（写真横スクロール・店名・種類・★評価・営業状態・電話/経路/マップ・住所）
- カードの **「この店を記録に追加」** → その位置で追加フォームが開き、**店名が自動入力・ジャンルが妥当に推定** → 保存で記録が地図に出る
- カードの **電話 / 経路 / マップ / 公式サイト** が正しく開く（電話は tel、他は新規タブ）
- 写真をタップ → ライトボックスで拡大
- **空きの場所をタップ** → 従来どおり記録追加フォーム（店カードは出ない）
- 既存機能（記録ピン→詳細、検索、カレンダー、位置修正）に影響なし

- [ ] **Step 3: エラー時の切り分け**

店カードが「取得できませんでした」になる／コンソールにエラーが出る場合:
- `ApiTargetBlockedMapError` や Places 関連の権限エラー → APIキーの「APIの制限」に **Places API (New)** が入っているか
- Places API 自体が無効 → 「APIとサービス」→「ライブラリ」で **Places API (New)** を有効化
- 反映に数分かかることがある

---

## Self-Review（計画者による確認結果）

- **スペック網羅:**
  - POIタップ＝カード / 空きタップ＝追加 の分岐 → Task 1（placeId分岐＋`setPlaceClickHandler`）✓
  - Places 取得（正規化・ジャンル推定・写真/評価/営業/電話/サイト/マップ/座標） → Task 2 ✓
  - 店カードUI（写真横スクロール・店名・評価・営業状態・アクション・住所） → Task 4 + Task 5 ✓
  - Googleマップで開くボタン（明記事項） → Task 4 の actions 内「マップ」（`googleMapsURI`優先、無ければ name 検索）✓
  - 記録に追加（位置＋店名＋推定ジャンル） → Task 4 の `pc-add` → `showAddForm` ✓
  - 写真/レビューは表示のみ・保存しない → 記録追加は写真を引き継がない（`showAddForm` は写真空）✓
  - 将来検索の再利用性 → `js/places.js` に集約、`showPlaceCard(placeId)` は placeId 起点で再利用可 ✓
  - 前提（Places API有効化＋キー許可） → 冒頭「前提」＋ Task 6 ✓
  - デプロイ順（Places有効化まで push しない） → 明記 ✓
- **プレースホルダ:** なし（全ステップに実コード/コマンド/期待結果）。
- **型/名称整合:** `App.map.setPlaceClickHandler`（Task1定義/Task4利用）、`App.places.fetchPlace`（Task2定義/Task4利用）、`showPlaceCard`（Task4定義/init配線/export）一致。`showAddForm(lat,lng,{name,genre})`・`App.lightbox.open(urls,i)`・`esc()`・`App.genres.label()` は既存シグネチャに一致。アイコンは regular に存在するもの（`ph-star`/`ph-phone`/`ph-arrow-bend-up-right`/`ph-map-trifold`/`ph-globe`/`ph-plus`/`ph-arrow-left`）を使用。
