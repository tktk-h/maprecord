# 設計：ジャンル（ピンの種類・色）を編集可能にする

- 日付: 2026-08-20
- 目的: これまでハードコードだったジャンル（記録の種類＝ピンの色）を、ふたりで自由に追加・編集・削除・並べ替えできるようにする。世界観「自分たちの地図」に沿ってカスタムできる。

## 1. 現状（背景）

`js/genres.js` に6個ハードコード：`{ key, label, color }` の `App.genres.list` と、キー→色/名前の resolver `App.genres.color(key)` / `App.genres.label(key)`（未知キーはグレー `#868e96` / `その他` にフォールバック）。

参照箇所（すべて描画時に `App.genres` を読む）:
- 記録フォームのジャンルチップ（`js/records.js` 293/302/819）、一括の `<option>`（`js/bulk.js` 102）
- ジャンル絞り込みチップ（`js/records.js`：`buildGenreFilters`、全ジャンル判定 858）
- 地図ピン色（`js/map.js` 262）、カレンダー（`js/calendar.js` 60）、検索結果（`js/search.js`）、詳細/フロー表示（`js/records.js` 各所）
- ふりかえり（`js/review-ui.js`：ピン色・ジャンル内訳・トップジャンル）
- `js/places.js`：Google place types → 組込キー推定

これらは `App.genres.list`/`color`/`label` を**描画時に読む**ので、`App.genres` の中身を差し替えれば自動追従する（無変更でよい）。

space データの保存は記念日と同流儀：`js/space.js` の `setAnniversary(spaceId, date)` が `updateDoc(spaces/{id}, {anniversary})`。space ドキュメントは起動時 `findMySpace` で取得し `currentSpace` に保持、`startApp` で `App.memories.setAnniversary(sp.anniversary)` 等に流している。

## 2. スコープ（ブレスト確定事項）

- **完全自由**：最初の6個も含め、名前・色の編集／追加／削除／並べ替えが全部できる。
- **削除は使用中不可**：その種類の記録が1件でもあれば削除ボタンを無効化し「◯件で使用中」と表示（記録が勝手に別分類にならない安全側）。
- **同期は開き直し**：保存した端末は即反映、パートナーは次に開いたとき反映（記念日と同じ。リアルタイム購読はしない）。
- **色は自由選択**：`<input type="color">` で任意の色。
- **並べ替えは↑↓ボタン**（ドラッグ&ドロップはしない）。
- **アイコンなし**（色＋名前のみ）。

## 3. データモデル

- `spaces/{id}.genres` = `[{ key, label, color }, ...]`（表示順を配列順で保持）。
- **未設定（フィールド無し or 空配列）なら DEFAULTS（現6個）を使う**。
- **key は不変ID**。既存6個は `food/cafe/facility/sightsee/shopping/other` のまま。新規追加は衝突しない生成キー：`'g' + Date.now().toString(36) + 2桁乱数`（空白なしの連結。例 `gl2x9v47`）。`newKey(existingKeys)` は生成後 existingKeys と衝突したら乱数を振り直す。ラベル・色は変えても key は変えない＝既存記録の `genre` を壊さない。
- 未知キー（想定外）は既存フォールバック（`その他`/グレー）で表示。

## 4. コンポーネント構成（案A）

### `js/genres.js`（改修）
- `DEFAULTS`（現6個の配列）を定数化。
- `list`（現在有効な配列。初期値は DEFAULTS のクローン）。
- `color(key)` / `label(key)` は現状維持（未知キーのフォールバックも維持）。
- **`setList(arr)`**：`arr` が非空配列ならその内容で `list` を**その場で置換**（`list.length=0; arr.forEach(push)`＝参照を保持している消費者にも反映）。`arr` が falsy/空なら DEFAULTS で置換。
- `_selfTest()`：color/label のフォールバック、setList（空→DEFAULTS、配列→反映）を検証。

### `js/space.js`（改修）
- **`setGenres(spaceId, genres)`**：`updateDoc(spaces/{id}, { genres })`。

### `js/genre-edit.js`（新規・`App.genreEdit`）
- **純粋な検証ロジック**（テスト可能）:
  - `validate(rows)` → `{ ok, error }`。ルール：①名前が空（trim後）の行があれば不可 ②最低1個 ③色が `#rrggbb` 形式。
  - `usageCount(records, key)` → その key を使う記録数（削除可否判定に使用）。
  - `newKey(existingKeys)` → 衝突しない新規キー生成。
  - `normalize(rows)` → 保存用に `{key,label,color}` だけの配列へ整形（label は trim）。
- **描画/操作**（DOM）:
  - `open()`：全画面オーバーレイ `#genre-editor` を、現在の `App.genres.list` のクローンから行UIで描画。
  - 行：色 `<input type="color">`／名前 `<input type="text">`／↑↓ボタン／削除ボタン（`usageCount(App.records.getAll(), key) > 0` なら `disabled` ＋「◯件で使用中」）。新規行は削除可（使用0件）。
  - 「＋ 種類を追加」：`newKey` で行追加（初期色は既定パレットから、名前は空でプレースホルダ）。
  - 「保存」：`validate` → NGなら赤字メッセージ表示して中断／OKなら `normalize` → `space.setGenres(currentSpaceId, list)` 保存 → `App.genres.setList(list)` → **再描画フック**（§6）→ 閉じる。
  - 「キャンセル」/×：破棄して閉じる。
  - `currentSpaceId` は `App.genreEdit.setSpaceId(id)`（app.js が startApp で渡す）で保持。

### `index.html`（改修）
- 設定メニュー（`#backup-bar`）に「**ジャンル編集**」ボタン `#genre-btn`。
- オーバーレイ `<div id="genre-editor" hidden></div>`。
- `?v=` 付き `<script src="js/genre-edit.js?v=VER">`（`genres.js` の後、`app.js` の前）。

### `js/app.js`（改修）
- `startApp(sp)`：`App.genres.setList(sp.genres || null)`（無ければ DEFAULTS）＋ `App.genreEdit.setSpaceId(sp.id)`。
- `wireUI()`：`#genre-btn` → メニューを閉じて `App.genreEdit.open()`。

### `style.css`（改修）
- `#genre-editor`（テーマ変数使用）＋行UIのスタイル（既存 `rv-*`/フォーム系に倣う）。

## 5. データフロー

1. 起動：`findMySpace` → `sp.genres` → `App.genres.setList` → 全消費者が新ジャンルで描画。
2. 編集：メニュー→ジャンル編集→ `App.genreEdit.open()` が `App.genres.list` を複製して行UI表示。
3. 保存：検証→ `space.setGenres`（Firestore）→ `App.genres.setList`（即時ローカル反映）→ 再描画→閉じる。
4. パートナー：次回起動時に 1 の流れで反映。

## 6. 保存後の再描画フック

`App.genres.setList` 後、開いているビューへ即反映するため、`js/genre-edit.js` から次を呼ぶ:
- ジャンル絞り込みチップの再生成（`js/records.js` の `buildGenreFilters` 相当）。→ records に公開関数が無ければ `App.records` に `refreshGenres()`（フィルタUI再構築＋現在の絞り込み適用）を追加して呼ぶ。
- 地図/一覧の再描画（現在のフィルタ適用 = `App.records.applyUiFilter()` で足りる想定。ピン色は `renderPins` が `App.genres.color` を読むので次の描画で更新）。

実装計画で `records.js` の該当関数名を確認し、最小の公開フック（`refreshGenres`）を足す。

## 7. エラー処理・エッジ

- 名前空・0個・不正色 → 保存不可（赤字案内、閉じない）。
- 削除は使用中不可（ボタン無効＋件数表示）。新規追加直後（未保存・使用0）は削除可。
- 保存失敗（通信）→ alert で通知し画面は保持（記念日と同様）。
- key は編集不可（UIに出さない）。ラベル重複は許容（keyで区別）。

## 8. テスト

- `js/genres.js._selfTest()`：`color`/`label` フォールバック、`setList`（空→DEFAULTS／配列→反映／その場置換で参照維持）。
- `js/genre-edit.js._selfTest()`：`validate`（空名・0個・不正色・正常）、`usageCount`、`newKey`（既存と衝突しない）、`normalize`（trim・余分キー除去）。
- Node 実行（既存流儀。`global.window`＋`global.App` を設定）。
- 編集UIは実ブラウザ/プレビューで目視（**地図非依存なのでプレビュー用ブラウザでも確認可**）。

## 9. リリース

- 版上げ：`index.html` の現行版（`20260819v`）を次の英字へ全置換（`.app-ver`・全 `?v=`・`sw.js?v=`・新 `genre-edit.js?v=`）。
- `js/` 配下なので SW の cache-first 対象（追加設定不要）。
- push → GitHub Pages（[[maprecord-deploy]]）。返信末尾に本番 ver。
