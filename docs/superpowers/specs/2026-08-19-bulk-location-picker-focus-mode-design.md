# 一括写真追加：位置ピッカーの集中モード化

日付: 2026-08-19
対象: `js/bulk.js` / `js/map.js` / `style.css`

## 背景・課題

一括写真追加（「まとめて」）の確認カードで「🗺 地図でピン」を押すと、**メイン地図をそのまま流用**して位置を選ばせている。そのため、この場面では使わないUIが全部見えて紛らわしい:

- 上部バー（場所/タグ検索・絞り込み・地図/カレンダー切替・リセット×）
- 地図上の「現在地」「まとめて」ボタン、「このエリアを再検索」、思い出カード
- 店POIをタップすると通常の店カード（「この店に記録を追加」ボタン）が出る＝この文脈では絶対に使わない

## ゴール

「地図で位置を選ぶ」を**専用の集中モード**にする。関係ないUIを隠し、地図タップの挙動をこの場面用に切り替える。抜けたら確実に通常へ戻す。

## 方針（採用：body クラス方式）

`<body>` に `picking` クラスを付けている間だけ、CSSで不要UIを隠す。地図側のタップ挙動はJSで切替。復元は `picking` クラスを外すだけ＝復元漏れが起きにくい。

代替案として「JSで要素を1つずつ hide/show」「別地図インスタンスを用意」も検討したが、前者は復元漏れが起きやすく、後者は地図二重持ちで過剰。

## 仕様

### 集中モードで隠すもの（`body.picking` のCSS）
- `#topbar`（検索・絞り込み・切替・リセット×をまとめて）
- `#locate-btn`（現在地）、`#bulk-btn`（まとめて）、`#research-btn`（このエリアを再検索）
- `#memory-card`（思い出カード）
- `#panel`（通常の詳細/店カードのシート）＝ピック中に店カードや詳細を出さない

### 残すもの
- 地図本体・ズームコントロール
- 保存済みの記録ピン（**タップで選択可能に**）
- Googleの店POI（**タップで選択可能に**・前回実装済み）
- 下部のピックバー `#bulk-pickbar`（見出し＋店名検索＋案内＋決定/キャンセル）

### 地図タップの挙動（ピック中のみ）
1. **Googleの店POIタップ** → `App.places.fetchPlace(placeId)` でその店を取得し、対象グループに `name / placeId / place{lat,lng} / genre` をセット＋ピンをその店へ移動。（実装済み `selectPoiForPick`）
2. **既存の記録ピンをタップ** → その記録の `name / lat,lng / genre / placeId` をグループに引き継ぎ＋ピンをそこへ移動。（新規 `selectRecordForPick`）
3. 空き地図タップ・ピンのドラッグ・店名検索は従来どおり。
4. ピックを抜けると、POIタップ＝通常の店カード表示、記録ピンタップ＝詳細表示に**復元**。

### 下部ピックバー
- 先頭に見出し「**写真の場所を選ぶ**」を追加。
- 案内文を「記録ピン／地図上の店をタップ、ドラッグ、検索で位置を決めます」に更新。
- 決定/キャンセルは従来どおり（決定＝`getPickedLatLng()` を `manualLoc` に確定）。

## 実装単位

### `js/map.js`
- 記録ピンのクリックを「ピック中は選択コールバックへ」ルーティング。
  - モジュール変数 `pickRecordSelect = null` を追加。
  - `renderPins` のピンクリックを `() => { if (pickMarker && pickRecordSelect) { pickRecordSelect(r); return; } onClick(r); }` に変更。
  - 公開関数 `setRecordPickHandler(fn)`（＝`pickRecordSelect = fn`）を追加・export。
- `pickMarker` の有無が「ピック中か」の判定に使える（既存）。

### `js/bulk.js`
- `pickLocationFor(i)`: `document.body.classList.add('picking')`、`App.map.setRecordPickHandler((r) => selectRecordForPick(i, r))` を追加（POIハンドラ差し替えは実装済み）。
- `selectRecordForPick(i, r)`（新規）: グループへ `name/place/genre/placeId` をセット、`App.map.startPickLocation(r.lat, r.lng)`、ピックバーのメッセージ更新。
- `finishPick(i, ok)`: `document.body.classList.remove('picking')`、`App.map.setRecordPickHandler(null)` を追加（POIハンドラ復元は実装済み）。
- `showPickBar`: 見出し「写真の場所を選ぶ」を追加、案内文を更新。

### `style.css`
- `body.picking #topbar`, `body.picking #locate-btn`, `body.picking #bulk-btn`, `body.picking #research-btn`, `body.picking #memory-card`, `body.picking #panel { display: none !important; }`（ズームは残す）。

## 非対象（YAGNI）
- 長押しで記録追加（`onLongPress`）の抑止は今回対象外（ピック中に長押しする導線は薄い）。必要なら別途。
- ピック専用の地図スタイル変更やアニメーションは行わない。

## 確認方法
- 実機（本番反映後）: 「まとめて」→写真選択→「地図でピン」で、上部バー等が消え、記録ピン/店POIタップで店名＋位置が入り、決定で反映。抜けると通常UI・通常タップ挙動に戻る。
- ローカルでは Google Maps＋ログイン＋実POIが要るため完全再現は不可（構文チェック＋差分レビューで担保）。

## バージョン
- 変更後は `index.html` の `?v=` と `.app-ver` を次版へ（[[maprecord-report-version]] / [[maprecord-cache-busting]]）。
