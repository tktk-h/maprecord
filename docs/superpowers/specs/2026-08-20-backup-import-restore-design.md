# 設計：バックアップの復元（インポート）

- 日付: 2026-08-20
- 目的: 書き出した控えJSONから記録を**復元（インポート）**できるようにする。今は書き出し（export）だけで復元手段が無く、二人の思い出データが失われたら戻せない。安全（非破壊）な復元を提供する。

## 1. 現状（背景）

- `js/backup.js`（`App.backup`）は `exportJson()` のみ：`App.records.getAll()` を `{ version: 2, records }` の JSON にして `date-records-YYYY-MM-DD.json` としてダウンロード。**写真は data URL 埋込**（クラウド版のFirestore埋込方式）。復元は無い（app.js にも「読み込み復元なし」と明記）。
- 記録は Firestore の `spaces/{id}/records` サブコレクションに1記録1ドキュメントで保存。`js/cloud.js`（`App.cloud`）:
  - `subscribe(cb)` … `onSnapshot` で記録配列を供給（idを含む）。
  - `add(record)` … `addDoc`（**新id**を採番）。
  - `put(record)` … `const {id, ...rest}=record; setDoc(doc(col,id), {...rest, updatedAt}, {merge:true})`（**id指定のupsert**）。
  - `remove(id)` … `deleteDoc`。
- 記録オブジェクトは `id`（Firestore doc id）・`date`（'YYYY-MM-DD'）・`name`・`genre`・`lat`・`lng`・`memo`・`tags`・`photos`・`order` 等を持つ。`App.records.getAll()` はこれらを id 込みで返す（export もこれ）。

## 2. スコープ（ブレスト確定事項）

- **不足分だけ追加（非破壊マージ）**：ファイル内の記録のうち、**現在存在しない id のものだけ**を追加。既存（同id）は削除も上書きもしない。→ データを壊さない・二重登録しない・**冪等**（何回やっても同じ）。
- 「全削除して復元」「同idを上書き」は**やらない**。
- 復元前に**件数の確認ダイアログ**を出す。
- 写真（data URL 埋込）はそのまま書き戻す。
- **許容する既知の限界**：古いバックアップで、現データが別idで作り直されている場合、内容が二重になりうる（id基準のため）。v1ではこれを許容（復元の主目的＝消失時の復旧では現データが空/欠損なので問題にならない）。

## 3. コンポーネント構成（案B：backup.js を拡張）

`js/backup.js`（`App.backup`）を拡張。export と import は同じ「バックアップ」関心事なので1ファイルにまとめる（現15行＝拡張後も小さく収まる）。純粋ロジックは分離してテスト可能に。

### 純粋関数（テスト可能・DOM非依存）
- `parseBackup(text)` → `{ ok, records, skipped, error }`
  - `JSON.parse` 失敗・`records` が配列でない → `{ ok:false, error:'...' }`。
  - 各要素を検証：**`id`(非空文字列) と `date`('YYYY-MM-DD'形式) と 数値 `lat`/`lng`** を必須とする。満たさない要素は除外し `skipped` にカウント。
  - `{ ok:true, records:<有効な記録[]>, skipped:<除外数>, error:'' }`。
  - `version` は現状 `2`。将来のため厳密一致はしない（`records` 形が合えば受け入れる）。
- `diffMissing(fileRecords, existingRecords)` → `{ toAdd, addCount, keepCount }`
  - `existingRecords` の id 集合を作り、`fileRecords` のうち **id が集合に無いもの**を `toAdd` に。`addCount=toAdd.length`、`keepCount=fileRecords.length - addCount`。

### フロー（DOM・Firestore書き込み）
- `importFlow()`：
  1. 隠し `<input type="file" id="import-file" accept=".json,application/json">` をクリックさせる（既存の要素、無ければ生成）。
  2. ファイル選択 → `FileReader`/`file.text()` でテキスト取得 → `parseBackup(text)`。
  3. `ok:false` → `alert(error)` して終了。
  4. `diffMissing(records, App.records.getAll())` → `confirm('このファイル: ' + records.length + '件\n新しく追加: ' + addCount + '件\n既存はそのまま: ' + keepCount + '件' + (skipped? '\n読めなかった: '+skipped+'件':'') + '\n\n追加しますか？')`。
  5. OK → `toAdd` を1件ずつ **`App.cloud.put(record)`**（元idのまま・await 逐次 or Promise.all）。失敗した件は数える。
  6. 完了 → `alert(succeeded + '件を追加しました' + (failed? '（' + failed + '件失敗）':''))`。`onSnapshot` により地図/一覧は自動更新。
  - 二重起動防止（実行中フラグ）と、input の value リセット（同じファイルを連続選択できるように）。

## 4. index.html / app.js

- **index.html**：設定メニュー（`#backup-bar`）の `export-btn` の隣に「読み込み」ボタン `#import-btn`（アイコン `ph-upload-simple` 等）。どこかに隠し `<input type="file" id="import-file" hidden>`。
- **app.js**：`wireUI()` で `export-btn` の配線の近くに `#import-btn` → `App.backup.importFlow()`。

## 5. データフロー

1. 「読み込み」→ file input → テキスト → `parseBackup`。
2. `diffMissing` で追加対象を算出 → 件数を confirm。
3. OK → `cloud.put` で不足分だけ id 保持で書き戻し。
4. `onSnapshot` が新記録を供給 → `App.records.setRecords` → 地図/一覧自動更新。

## 6. エラー処理・エッジ

- 不正JSON/`records`無し → alert して中断（書き込みしない）。
- 一部の記録が壊れている → その記録だけ skip（件数を confirm に表示）、残りは復元。
- 追加0件（全て既存・または有効記録0）→ confirm を出さず `alert('追加する新しい記録はありませんでした（すべて既存です）')` で終了。
- 書き込み一部失敗（通信）→ 成功/失敗件数を alert。既に書けた分は残る（部分成功でも非破壊なので安全）。
- 大きな写真埋込：元々 Firestore に入っていたデータなのでドキュメントサイズ的に往復可能（新たな肥大はしない）。

## 7. テスト

- `js/backup.js._selfTest()`：
  - `parseBackup`：正常（有効records）、不正JSON、`records`非配列、必須欠け（id/date/lat/lng）を skip、version違いでも受け入れ。
  - `diffMissing`：既存idを除外し toAdd/addCount/keepCount が正しい、空入力。
- Node 実行（`global.window`＋`global.App`）。DOM/Firestore を触る `importFlow` は実ブラウザ/実機で確認（実際の書き戻しは Firebase ログインが要るため、解析/確認までプレビュー可）。

## 8. リリース

- 版上げ：`index.html` の現行版（`20260819x`）を次の英字へ全置換（`.app-ver`・全 `?v=`・`sw.js?v=`）。`backup.js` は既存 `<script>` なので新規追加なし。
- push → GitHub Pages（[[maprecord-deploy]]）。返信末尾に本番 ver。
