# 設計：地図を Google Maps へ載せ替え（フェーズ1）

- 日付: 2026-08-08
- 対象: デート記録（maprecord / GitHub Pages）
- 関連: [[maprecord-deploy]] / [[maprecord-firebase-wip]]、既存の地図UX改善（tile背景/keepBuffer）や写真ピンの実装

## 目的

現状の地図（Leaflet + CARTO Voyager）は、漢字ラベルが中国語寄りの字形で描画され「日本らしくない」。Google Maps に載せ替えることで、**日本語ラベルが自然**になり、将来の**場所検索復活（Places）やPOI活用**の土台にもなる。

本スペックは **フェーズ1＝地図エンジンの載せ替えのみ**。今ある機能はすべて現状どおり動くこと（パリティ）を最優先とする。場所検索・航空写真・POIタップ・独自スタイリングはフェーズ2以降（本スペック対象外）。

## 方針（アーキテクチャ）

地図処理は `js/map.js` にほぼ集約され、他モジュールは `App.map.*` の公開関数経由で呼ぶだけ。したがって **`map.js` を Google Maps 版に書き換え、公開インターフェースを完全維持**する。これにより `records.js` / `app.js`（初期化の await 化を除く）/ `calendar.js` / `sheet.js` などは原則無改修。

**維持する公開インターフェース（呼び出し側が依存している）**:
- `init()`（※フェーズ1で **async 化**）
- `setClickHandler(fn)` … `fn(lat, lng)`
- `renderPins(records, onClick, opts)` … `opts.numbered` / `opts.countAt`
- `clearPins()`
- `flyTo(lat, lng)`
- `fitTo(records)`
- `refresh()`（ビュー復帰時の再描画）
- `showTempMarker(lat, lng)` / `clearTempMarker()`
- `startPickLocation(lat, lng)` / `getPickedLatLng()` / `stopPickLocation()`
- `_getMap()` / `_getLayer()`（デバッグ用。`_getLayer` は廃止可、`_getMap` は Google の map を返す）

## ピンの実装（Advanced Markers）

今の見た目（写真サムネのピン／ジャンル色の丸ピン／訪問回数・順番バッジ／ルートの点線）を保つため、**`AdvancedMarkerElement`（HTML要素をそのままマーカーにできる）** を使う。これには **Map ID** が必須（Google Cloud で無料作成、ベクター）。

- 既存 `markerFor()` が組み立てている HTML（`.photo-pin` / `.dot-pin` + バッジ + しっぽ）は **DOM 要素として生成し、`AdvancedMarkerElement.content` に渡す**。→ `style.css` のピン系クラスはそのまま流用。
- クリック：`marker.addListener('click', () => onClick(r))`。
- ホバー時の名前表示：content 要素の `title` 属性（ブラウザ標準ツールチップ）で代替（Leaflet の bindTooltip 相当）。
- 追加の仮マーカー（`showTempMarker`）：`.temp-pin` を content にした AdvancedMarker。
- 位置修正（`startPickLocation`）：`gmpDraggable: true` の AdvancedMarker。`dragend` で現在地を保持し `getPickedLatLng()` が返す。
- ルート（`opts.numbered`）：`google.maps.Polyline`（破線）＋番号バッジ付きの丸ピン。番号モードのピンは従来どおりまとめず個別表示。

## 地図の生成・挙動

- ローダー：index.html に Google Maps JS の **inline bootstrap loader** を置く（`key` + `v=weekly`）。`map.js` の `init()` 内で `await google.maps.importLibrary('maps')` と `('marker')` を読み込む。
- Map 生成：`new Map(el, { mapId, center, zoom, disableDefaultUI: true, zoomControl: true, zoomControlOptions: { position: LEFT_BOTTOM }, clickableIcons: false, gestureHandling: 'greedy' })`。
  - `clickableIcons: false`：GoogleのPOIクリックで情報ウィンドウが出るのを抑止（現状の挙動に合わせる）。
  - `disableDefaultUI: true` + 個別に zoom のみ有効化（現状の最小コントロールに合わせる。ズームは左下）。
  - `gestureHandling: 'greedy'`：スマホで1本指ドラッグでも地図が動く（現状同等の操作感）。
- クリックで追加：`map.addListener('click', (e) => onMapClick(e.latLng.lat(), e.latLng.lng()))`。
- 表示位置の保存（`saveView`）：`map.addListener('idle', saveView)`。`getCenter().lat()/lng()`、`getZoom()` を localStorage（キー `date-recorder-view` は現状踏襲）。
- `flyTo(lat,lng)`：`map.panTo({lat,lng}); map.setZoom(16)`。
- `fitTo(records)`：`LatLngBounds` に各点を extend → `map.fitBounds(bounds, 60)`（padding 60px 相当）。1点のときは寄りすぎ防止で最大ズームを制限（`idle` 後に必要なら `setZoom(Math.min(getZoom(), 16))`）。
- `refresh()`：Google Maps はコンテナ表示切替後に `google.maps.event.trigger(map, 'resize')` 相当が不要（自動追従）だが、非表示→表示直後に中心がズレる場合は保存中心へ `setCenter` し直す。フェーズ1では「表示に戻したら保存済み中心へ setCenter/ setZoom」で担保。

## 非同期初期化の扱い

- `init()` を `async` にし、`importLibrary` 完了後に Map を生成。
- `js/app.js` の `startApp(sp)` を `async` にして **`await App.map.init()` の後に** `App.records.init()` / `App.sheet.init()` / `wireUI()` / `cloud.subscribe(...)` を実行する。これで最初の `renderPins` 時に map が確実に存在する。
- スプラッシュ（起動待機画面）は既存のまま。地図ロードが少し伸びてもスプラッシュが隠す。

## 事前準備（ユーザーのコンソール作業＝実装の前提）

1. Google Cloud で **課金を有効化**（カード登録）。
2. **Maps JavaScript API** を有効化。
3. **APIキー**を作成し、
   - **アプリケーションの制限＝ウェブサイト（HTTPリファラー）**：`https://tktk-h.github.io/*`（必要なら `http://localhost:*` も）
   - **API の制限**：Maps JavaScript API のみ
4. **Map ID** を作成（地図タイプ=JavaScript、ベクター、Advanced Markers 有効）。
5. **予算アラート**＋（任意で）**クオータ上限**を設定。
6. 生成した **APIキー** と **Map ID** を実装者に渡す（両方とも公開前提の値。キーはリファラー制限済みで安全）。

## セキュリティ / 安全策

- キーはクライアントに載るが **リファラー制限＋API制限＋クオータ上限**で保護。
- 二人利用は各SKUの無料枠（月1万回）に対して極小 → 実質 \$0。課金は無料枠超過（≒月1万回超）から。

## 触るファイル

| ファイル | 変更 |
|---|---|
| `index.html` | Leaflet の CSS/JS を撤去、Google Maps bootstrap loader を追加 |
| `js/map.js` | Google Maps 版へ全面書き換え（Advanced Markers、init を async 化、同一インターフェース維持） |
| `js/app.js` | `startApp` を async 化し `await App.map.init()` |
| `style.css` | Leaflet 固有の記述整理。ピン系クラスは流用（必要なら Advanced Marker 用に微調整） |
| `js/records.js` ほか | 原則無改修（`App.map.*` 経由のため） |

## 非目標（フェーズ1でやらない）

- 場所検索（Places Autocomplete）復活 … フェーズ2
- 航空写真切替・周辺POIタップで追加・経路案内 … フェーズ3
- 地図の独自カラースタイリング（Map ID クラウドスタイル）… 後日
- ローカル開発環境の整備（本アプリは本番でのみ通し確認）

## テスト / 受け入れ基準（本番・手動）

このアプリはログイン必須かつキーはドメイン制限のため、**ローカル実地テスト不可**。**本番（https://tktk-h.github.io/maprecord/）でユーザーが確認**する。

- 地図が Google Maps で表示され、**地名が自然な日本語**になっている
- 写真ピン／丸ピン／訪問回数バッジが従来どおり表示される
- 地図タップ → 追加フォーム（仮マーカーが出る）→ 保存で記録が地図に出る
- 記録タップ → 詳細 → 編集 →「位置を修正」でドラッグ → 更新で移動が保存される
- カレンダーで日付選択 → その日のルート（番号ピン＋点線）が出る／地図へ飛ぶ
- 検索（保存済み記録の名前/タグ）で該当地点へ移動・複数候補リスト表示が従来どおり
- 表示位置・ズームが再訪時に復元される
- 二人の端末で同期・表示が問題ない
- ズームコントロールが左下、POIの誤タップで情報ウィンドウが出ない

## リスク / 留意

- **Advanced Markers は Map ID 必須**。Map ID 未設定だとマーカーが出ない → 事前準備4が必須。
- キー未設定/制限ミスだと地図が出ない or 課金リスク → 事前準備3・5を丁寧に。
- 大量マーカー時の性能：現状の記録数規模では問題なし。将来増えたらフェーズ2以降でクラスタ等検討（今回は入れない）。
- 元に戻す場合は `map.js` と `index.html` のローダー行を戻すだけで Leaflet に復帰可能。
