# 設計：店(POI)タップ → Googleマップ風の店カード → 記録に追加（フェーズ2/POI）

- 日付: 2026-08-08
- 対象: デート記録（maprecord / GitHub Pages）
- 前提: [2026-08-08 Google Maps 載せ替え（フェーズ1）](2026-08-08-google-maps-migration-phase1-design.md) 完了・稼働中
- 関連: [[maprecord-firebase-wip]]

## 目的

Google Maps 化で使えるようになった **Places API** を活用し、地図上の店・施設(POI)をタップすると、Googleマップの店カードのような情報（写真・★評価・営業時間・電話など）を下シートに表示する。さらに **「この店を記録に追加」** で、その場所を記録として素早く登録できるようにする。前に諦めた「名前で探して追加」の目的を、別ルート（地図上のPOIから）で叶える。

## スコープ

- 地図の POI クリックを有効化し、**POIタップ＝店カード表示 / 空きタップ＝従来の記録追加** に出し分ける。
- Places API で placeId から詳細を取得（新モジュール `js/places.js`）。
- 下シートに **Googleマップ風の店カード** を表示（`records.js`）。
- カードの **「記録に追加」** で、その位置・店名（＋推定ジャンル）を引き継いで追加フォームを開く。

## 非スコープ（YAGNI）

- Googleマップ“純正”の店カードそのものの埋め込み（不可）。あくまで Places のデータで自作カードを作る。
- レビュー全文の網羅表示（今回は評価の★と件数まで。レビュー抜粋・複数写真は「表示」はするが最小限）。
- Google の写真・レビュー文を **記録に保存すること**（著作権・Firestore容量の観点で保存しない。記録の写真は従来どおり自分で撮ったもの）。
- 名前入力のオートコンプリート検索（別途フェーズ2の「検索復活」。本スペックは対象外）。
- 経路の独自実装（「経路」はGoogleマップの経路URLを開くだけ）。

## 事前準備（ユーザーのコンソール作業＝実装の前提）

1. **Places API（New）を有効化**（「APIとサービス」→「ライブラリ」→ Places API (New) → 有効にする）。
2. 既存 APIキーの **「APIの制限」に Places API (New) を追加**（現在は Maps JavaScript API のみ）。
3. （任意）予算/クオータはフェーズ1で設定済みならそのまま。Places も無料枠が大きく二人利用は $0 想定。

## 地図の操作（`js/map.js`）

- Map生成オプションを `clickableIcons: true` に変更（POIをクリック可能に）。
- 地図クリックハンドラを次のように分岐：
  - `e.placeId` があれば（＝POI）→ `e.stop()` でGoogle標準ポップアップを抑制し、**placeClickハンドラ**に `e.placeId` を渡す。
  - なければ（＝空き）→ 従来の `onMapClick(lat, lng)`（記録追加）。
- 新公開関数 `setPlaceClickHandler(fn)` を追加（`fn(placeId)`）。`init` の click リスナー内で分岐して呼ぶ。
- 既存の `setClickHandler`（空きタップ＝追加）はそのまま維持。

## Places 取得（新モジュール `js/places.js`）

- `App.places = (function(){ ... })()` の形（既存モジュール流儀）。
- `async function fetchPlace(placeId)`：
  - `const { Place } = await google.maps.importLibrary('places')`
  - `const place = new Place({ id: placeId })`
  - `await place.fetchFields({ fields: [...] })` で必要フィールドを取得。
  - 取得フィールド（Places API New の Place クラス）：`displayName`, `formattedAddress`, `rating`, `userRatingCount`, `regularOpeningHours`, `nationalPhoneNumber`, `websiteURI`, `googleMapsURI`, `photos`, `location`, `types`。
  - **正規化した素直なオブジェクトを返す**（UIはGoogle固有型に依存しない）:
    ```
    {
      name, address, rating, ratingCount,
      openNow (bool|null), hoursToday (string|null),
      phone (string|null), website (url|null), googleMapsURI (url|null),
      photoUrls (string[] 最大5), lat, lng,
      genre  // Google types → App.genres.key への推定（下記マッピング）
    }
    ```
  - 写真URL：`place.photos[i].getURI({ maxWidth: 400, maxHeight: 400 })` を最大5枚。
  - 営業状態：`regularOpeningHours` から「今日の時間帯」文字列と、可能なら現在営業中かの真偽。取得できない場合は null（UIは非表示）。
- **ジャンル推定** `genreFromTypes(types)`：Google の place types 配列 → `App.genres` の key。
  - `restaurant`/`food`/`meal_*`/`bakery` → `food`
  - `cafe`/`coffee_shop` → `cafe`
  - `tourist_attraction`/`park`/`museum`/`aquarium`/`zoo`/`landmark` → `sightsee`
  - `store`/`shopping_mall`/`clothing_store`/`shop` → `shopping`
  - `lodging`/`spa`/`gym`/`movie_theater`/`amusement_park` → `facility`
  - それ以外 → `other`
- エラー/未取得：例外時は上位（records）で「情報を取得できませんでした」を表示（アラートにしない）。

## 下シートの店カード（`records.js` に `showPlaceCard`）

- 新関数 `async function showPlaceCard(placeId)`：
  1. `searchResults = null` 等、他モードを解除。ローディング表示（「読み込み中…」）。
  2. `const p = await App.places.fetchPlace(placeId)` を取得（失敗時はエラー文をシートに表示して return）。
  3. カードHTMLを `panel().innerHTML` に描画し、シートを `half` に開く。
- カード構成（Googleマップ風・上から）:
  - **戻る**ボタン（既存 back-btn 流用）
  - **写真の横スクロール**（`photoUrls` を並べる。タップで既存 `App.lightbox.open` に渡す。写真なしなら省略）
  - **店名**（esc）＋ 種類ラベル（`App.genres.label(genre)`）
  - **評価**：`★ {rating}（{ratingCount}）`（rating が無ければ非表示）
  - **営業状態**：`openNow` が true/false なら「営業中/営業時間外」バッジ＋ `hoursToday`（あれば）
  - **アクション行**（横並びボタン）:
    - 電話（`phone` があれば `tel:` リンク。無ければ非表示）
    - 経路（`https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` を新規タブ）
    - Googleマップで開く（`googleMapsURI` があればそれ、無ければ `search?api=1&query={name}`）
    - **この店を記録に追加**（強調ボタン）
  - **住所**（esc、あれば）
- 「この店を記録に追加」→ `App.map.flyTo(p.lat, p.lng)` 後 `showAddForm(p.lat, p.lng, { name: p.name, genre: p.genre })`。
- ユーザー入力ではないが、Google由来テキスト（店名・住所）は既存 `esc()` で表示エスケープする。

## 配線（`js/app.js`）

- 既存 `startApp` の初期化後（`wireUI` 内など、`App.map` 初期化済みの箇所）で:
  - `App.map.setPlaceClickHandler((placeId) => App.records.showPlaceCard(placeId));`
- `index.html`：`js/places.js` を `js/records.js` より前に読み込む `<script>` を追加。Google Maps ローダーは既存のものを使う（Placesは `importLibrary('places')` で追加ロード）。

## スタイル（`style.css`）

- `.place-card` 系のクラスを追加：写真の横スクロール（`overflow-x:auto`）、評価の★、営業中バッジ（緑）、アクションボタン行（等幅の小ボタン）。既存のトーン（accent色・radius）に合わせる。

## 触るファイル

| ファイル | 変更 |
|---|---|
| `js/places.js` | **新規**。`fetchPlace(placeId)` と `genreFromTypes` を公開 |
| `js/map.js` | `clickableIcons: true`、click ハンドラで placeId 分岐、`setPlaceClickHandler` 追加 |
| `js/records.js` | `showPlaceCard(placeId)` 追加、「記録に追加」連携 |
| `js/app.js` | `setPlaceClickHandler` の配線 |
| `index.html` | `js/places.js` の読み込み追加 |
| `style.css` | 店カードの見た目 |

## テスト / 受け入れ基準（本番・手動）

自動テスト無し。JSは `node --check`。実挙動は本番（要ログイン・APIキーはドメイン制限）で確認。

- 地図上の店（ラベル/アイコン）をタップ → 下シートに**店カード**（写真・店名・★評価・営業状態・アクション・住所）が出る
- 空きの場所をタップ → 従来どおり**記録追加フォーム**が出る（店カードは出ない）
- カードの「電話」でtel、「経路」「Googleマップで開く」が正しく開く
- 「この店を記録に追加」→ その位置で追加フォームが開き、店名が自動入力・ジャンルが妥当に推定されている → 保存で記録が地図に出る
- 情報取得に失敗した場合、アラートではなくシート内にメッセージが出る
- 既存機能（記録ピンのタップ→詳細、検索、カレンダー、位置修正など）に影響がない
- Places API 未有効/キー未許可の場合の挙動（カードが出ない/エラー）を切り分けられる

## 将来の検索機能を見据えた設計メモ（フェーズ2「名前で検索して追加」）

本スペックには検索は含めないが、**あとで最小追加で足せる形**にしておく：

- **`js/places.js` を「Placesの単一入口」にする**。将来ここに `autocomplete(query)` / `textSearch(query)` を足すだけで検索が組める。UI は Google 固有型に依存せず、`fetchPlace` と同じ正規化オブジェクト（`{name, address, rating, ..., lat, lng, genre}`）に揃える。
- **`showPlaceCard(placeId)` を再利用可能に保つ**。検索結果を選んだら placeId が得られるので、そのまま同じ店カード → 「記録に追加」に流せる（検索専用の詳細UIを作らずに済む）。
- 検索の入口UI（ボタン/入力欄）は将来の別スペックで決める（前回 Nominatim で作った `#place-search-btn` の配置知見も流用可）。
- コスト：Autocomplete はセッション課金だが二人利用は無料枠内の想定。

## Googleマップで開くボタン（明記）

店カードのアクション行に **「Googleマップで開く」ボタンを必ず含める**（`googleMapsURI` があればそれ、無ければ `https://www.google.com/maps/search/?api=1&query={name}`。新規タブ `target="_blank" rel="noopener"`）。記録詳細側の既存「Googleマップで開く」（登録名で検索）とは別に、店カードにも用意する。

## リスク / 留意

- **Places API の有効化・キー許可が前提**。未設定だと店カードが取得できない（コンソールエラー）。
- POIクリック有効化により、**店の上をタップすると記録追加ではなく店カード**になる。店の位置に記録を追加したい場合は「記録に追加」ボタン経由（むしろ自然）。店以外（空き地・道路上）タップは従来どおり追加。
- Places 呼び出しは placeId タップ時のみ（ユーザー操作起点）。二人利用で無料枠内。
- Google の写真/レビューは表示のみ・保存しない（著作権・容量）。
