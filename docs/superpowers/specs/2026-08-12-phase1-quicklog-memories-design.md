# フェーズ1 設計：クイック記録 ＋ 1年前の今日・記念日

作成日: 2026-08-12
対象アプリ: デート記録（maprecord）

## 目的とゴール

二人で「使い倒す」ことを軸に、次の循環を最短で回す:

**記録が一瞬で残せる（クイック記録）→ また開く理由ができる（1年前の今日・記念日）→ 記録が増える**

フェーズ1はこの循環を完成させる最小セット。年間まとめ・統計・スライドショー・EXIF自動入力は後続フェーズ（データが溜まってから）に回す。

## スコープ

含む:
- 1-A クイック記録（現在地から一瞬で保存、後から追記）
- 1-B 過去の同月同日カード（1年前の今日…）＋ 記念日カード（今日で◯年！）
- 記録まわりに限定したデザインの洗練（追加フォームの余白・ボタン整え、カードのスタイル統一）

含まない（後続フェーズ）:
- 統計ダッシュボード、年間まとめ、スライドショー、写真EXIFからの自動入力
- 記念日以外の設定画面全般の作り込み

## 前提（現状のコード）

- 記録モデル: `{ id, date, name, genre, memo, tags, order, lat, lng, photos[] }`（`js/records.js`, `js/cloud.js`）
- 追加は `App.records.showAddForm(lat, lng, prefill)`。`name` は現状 `required`。
- 現在地ボタン（`js/app.js`）: geolocation → `flyTo` → `showAddForm`。
- 記録購読: `cloud.subscribe(cb)` の初回スナップショットで全件が届く（`js/app.js` の `startApp`）。
- スペース情報は Firestore の `spaces/{id}` ドキュメント（`js/space.js`）。`members`, `inviteCode`, `lastSeen.*` などを保持。
- 場所検索は `js/places.js`（`searchText` / `searchPlaces` / `fetchPlace`）。近傍検索（searchNearby）は未実装。
- `App.genres`: ジャンルの `list` / `label(key)` / `color(key)`。`App.places.genreFromTypes(types)` で Google types → ジャンルキー推定。

## 1-A クイック記録

### 体験
1. 現在地ボタン → 位置取得 → 近くの店を自動取得 → 「クイック保存カード」を下シートに表示。
2. 店名は自動取得した最有力候補を先頭に入れる。近くの候補チップをタップで差し替え可。手入力も可。
3. `保存` で写真・メモなしでも即保存（日付＝今日、ジャンルは店種から自動）。
4. 保存後は詳細シートを開く（既存 `showDetail`）。後から `編集` で写真・メモを追記。
5. `詳しく書く` で従来のフルフォーム（`showAddForm`）へ、店名・ジャンルを引き継いで展開。

長押し追加は従来どおり `showAddForm`（任意地点は自動店名を拾えないため据え置き）。

### 変更点
- `js/places.js`: `nearbyPlaces(lat, lng, opts)` を追加。
  - Google `Place.searchNearby`（`fields: ['id','displayName','location','types']`, `locationRestriction` に半径〜100mの円, `maxResultCount: 5`, `language:'ja'`, `region:'JP'`）。
  - 返り値は正規化: `[{ placeId, name, genre, lat, lng }]`（距離が近い順、`_normalizeTextResults` と同型）。
  - google 非依存の正規化関数を分離し、既存の `_selfTest*` と同じ形の自己テストを付ける。
- `js/records.js`: `showQuickLog(lat, lng)` を追加。
  - カード描画: 見出し「今ここを記録」、日付（今日・表示のみ）、店名（編集可・最有力候補で初期化）、近くの候補チップ、ジャンル（自動・変更可）、`保存` / `詳しく書く`。
  - 近傍取得に失敗／候補ゼロ: 店名は空のまま編集可（保存は可能）。候補行は非表示。
  - `保存`: `cloud.add({ date: 今日, name, genre, memo:'', tags:[], order, lat, lng, photos:[] })`。`order` は当日の件数（既存 `showAddForm` と同じ算出）。保存後 `showDetail` を開く。
  - `詳しく書く`: 現在の入力（店名・ジャンル）を prefill に `showAddForm(lat, lng, prefill)`。
  - `App.map.showTempMarker(lat, lng)` で目印、`App.sheet.snapTo('half')` でシートを開く（既存作法に合わせる）。
- `js/app.js`: 現在地ボタンのハンドラを `showAddForm` → `showQuickLog` に差し替え。
- `showAddForm` の `name` の `required` は維持（フルフォームでは必須のまま）。クイックは空許容なので `cloud.add` に直接渡す。

### 設計の洗練（記録まわり限定）
- 追加フォーム／クイックカードのラベル余白・入力の間隔を整え、主ボタン（保存）を視覚的な主役にする。
- クイックカード・思い出カード・既存シートのカード見た目（角丸・影・パディング）を既存トークンで統一。

## 1-B 過去の同月同日 ＋ 記念日

### 体験
- アプリを開き記録が読み込まれたら、ヘッダー下に「思い出カード」をスライド表示。
  - 記念日当日（`anniversary` の月日一致）: 「今日で◯年！」カードを優先表示。
  - それ以外: 今日と同じ月日の過去の記録（1年前・2年前…新しい順）を表示。
- カードのタップ = その日を開く（`focusDay(date)`）。過去カードで複数年ある場合は「1年前／2年前」を切替、`ほかN件` を表示。
- `×` で閉じる。閉じたら当日は再表示しない（localStorage に日付キーで記憶）。
- 該当する記録も記念日もなければ、カードは出さない。

### データ
- `spaces/{id}.anniversary`: `'YYYY-MM-DD'`（任意・未設定可）。
- 記録側の追加フィールドは無し。過去同月同日は既存 `date` から算出。

### 変更点
- `js/memories.js`（新規モジュール, `App.memories`）:
  - `pickMemories(records, today, anniversary)` → 表示内容を決める純粋関数（google/DOM 非依存・自己テスト付き）。
    - 記念日一致なら `{ type:'anniversary', years, date }`。
    - 過去同月同日があれば `{ type:'onThisDay', items:[{ date, record, yearsAgo }], count }`（新しい順）。
    - どちらも無ければ `null`。
  - `show()` → `App.records.getAll()` と `anniversary` を使い `pickMemories` を呼び、カードを描画。dismissed（localStorage: `memoryDismissed:YYYY-MM-DD`）ならスキップ。
  - カード DOM は `index.html` の専用コンテナに描画。タップ → `focusDay`、切替、`×` → dismiss。
- `js/app.js`:
  - `startApp` の記録初回ロード後（`cloud.subscribe` の初回コールバック内、`hideMapLoading` と同じ場所）で一度だけ `App.memories.show()` を呼ぶ（`started` 同様のワンショットフラグ）。
  - `anniversary` は `startApp(sp)` が受け取る `sp` から読む（`findMySpace` / `joinSpace` の返り値はスペースドキュメント全体なので `sp.anniversary` を参照。未設定なら `null` 扱い）。記念日設定を変更したら `sp.anniversary` も更新して次回判定に反映。
- `js/space.js`:
  - `setAnniversary(spaceId, date)` を追加（`updateDoc(spaces/{id}, { anniversary: date })`）。
  - 取得は既存の `findMySpace` の返り値に `anniversary` が含まれる（追加不要）。
- 設定UI（記念日）:
  - `index.html` の `#backup-bar` に「記念日」ボタンを追加。押すと現在値を初期表示した簡易入力（`prompt` もしくは小さなインラインフォーム）で `YYYY-MM-DD` を受け取り `space.setAnniversary` で保存。
  - 保存後は次回起動時のカード判定に反映。
- `index.html`: 思い出カードのコンテナ追加、`js/memories.js` を読み込み、全アセットの `?v=` を更新（キャッシュ対策）。
- `style.css`: 思い出カード／記念日カードのスタイル（ヘッダー下フローティング、既存トークン使用、スマホの2段ヘッダーと重ならない位置）。

### 記念日の粒度
- 基本は「毎年◯周年」（月日一致）。`◯ヶ月記念`（毎月同日）を出すかは実装計画で判断（YAGNI 寄りに、まず周年のみで開始）。

## テスト方針

- 純粋関数を優先的にユニット化（既存の `_selfTest` 方式に合わせ、console ベースの自己テスト）:
  - `places.nearbyPlaces` の正規化。
  - `memories.pickMemories`（記念日一致 / 過去同月同日あり / 複数年 / 該当なし / うるう年 2/29 の扱い）。
- 手動確認（実機・本番反映後）:
  - 現在地 → クイックカード → 保存 → 詳細 → 編集で写真追記。
  - 候補取得失敗時に空店名で保存できる。
  - 過去に今日と同月同日の記録を用意し、起動時カード表示 → タップでその日へ → `×` で当日非表示。
  - 記念日を設定し、当日に「◯年！」カードが出る。

## 影響範囲と非目標

- 既存の追加フロー（長押し）・詳細・編集・検索・カレンダーの挙動は変えない。
- クラウドのスキーマはフィールド追加のみ（`spaces.anniversary`）で後方互換。
- 無関係な画面のデザインは変更しない。
