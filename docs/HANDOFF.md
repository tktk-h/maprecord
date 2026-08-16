# デート記録アプリ — 引き継ぎメモ

新しいチャット/担当者がすぐ続きをやれるようにまとめたもの。

## 2026-08-16 更新（このセッションの続き）

### デプロイ済み（本番反映・ver は index.html の `.app-ver` 参照、最新 20260816h）
- デザイン④「色のメリハリ」：深いテラコッタのヒーロートーンを CTA/選択状態/詳細に集中（`--accent-deep`/`--cta-grad`）。
- 地図タップで**絞り込みパネル**を閉じる（`onTap` は document キャプチャ方式で確実発火。詳細を閉じるのと同じ）。
- 絞り込みパネルを**検索バーの下**に開く（`#filter-panel { order: 6 }`。バー位置固定）。
- **Place ID を記録に保存**（店カード/クイック候補/再訪で付与、手動は null）。詳細「マップで開く」を `query_place_id` で正確化。
- 編集画面に「**Googleの場所と紐付け**」＝既存記録に placeId を後付け（重複作らず）。0件時は「紐付けなしでOK」表示。
- `exif-check.html`：使い捨ての計測ページ（写真のGPS/日時残存率を測る。本体と無関係、削除可）。

### 課金の整理（[[maprecord-billing]] にメモ済み）
- プラン=**Blaze**、当月$0.00、Firestore無料枠0%。請求先は単一Cloud課金アカウント（Firebase+Maps）。
- 予算アラート¥1,000/月 設定済み（通知のみ・自動停止しない）。APIキー制限は本人が設定済み。

### 進行中の設計（次チャットの本命）：写真アップロード大改修
- 大機能「複数写真を一括アップロード→自動グループ化→確認UI→保存」を**3フェーズに分割**して進める合意。
- **フェーズ1 の spec 完成・コミット済み**：`docs/superpowers/specs/2026-08-16-photos-cloud-storage-migration-design.md`
  = 写真を Firestore埋め込み(Base64) → **Cloud Storage(URL保存)** へ。枚数上限が消える。
- **次アクション**：本人が上記 spec をレビュー → OKなら writing-plans で実装計画 → 実装（featureブランチ・非破壊・着手前に復元用gitタグ）。
- 実測：未来写真(位置ON)はGPS残る(3/3)、過去写真はGPS0%・撮影日時100%。フェーズ2のグループ化は「日付＋GPS近接」主・時間は補助・手で結合/分割可。フェーズ3の Gemini は backend必須・団子グループだけ絞る。

---
（以下は 2026-08-12 時点のメモ）

## アプリ概要
- 二人でデートした場所を地図に記録して振り返る PWA。Firebase(Firestore) でクラウド同期、二人でスペース共有（招待コード）。Google Maps + Places 利用。
- 純バニラ JS。各モジュールは `window.App.*` の IIFE。ES module は `js/app.js` 系のみ。ビルド無し、テストランナー無し（純粋関数は `_selfTest()` を console 出力で検証）。
- ホスティング: GitHub Pages（`github.com/tktk-h/maprecord`）。**デプロイ = `git push`（main）→ 数十秒〜数分で反映**。
- 作業ディレクトリ: `C:\Users\0525t\OneDrive - 同志社大学\ポートフォリオ\デート記録`
- git ユーザー: tktk-h / ブランチは main 運用（specs/plans も main にコミットしてきた）。

## 主要ファイル
- `index.html` — 骨格＋アセット読み込み（`?v=` でキャッシュバスト）＋設定欄の `ver.` 表示
- `style.css` — 全スタイル。デザイントークンは冒頭 `:root`（`--accent:#b76e64` ほか、`--font-sans`/`--font-display`）
- `js/app.js` — 起動・UI 配線（ES module）
- `js/map.js` — Google Maps（Map ID `453a543cb81d00c3bbdfb47d` ＋ AdvancedMarker）、ピン、長押し/タップ検出
- `js/records.js` — 記録の CRUD、詳細/追加/編集/クイック記録、絞り込み、検索結果、ルート表示（最大・要注意ファイル）
- `js/memories.js` — 「1年前の今日」＋記念日カード（`pickMemories` は純粋関数）
- `js/places.js` — Places（`searchText`/`searchPlaces`/`nearbyPlaces`/`fetchPlace`）
- `js/calendar.js` — カレンダー
- 他: `genres.js` `filters.js` `sheet.js` `lightbox.js` `backup.js` `search.js` `space.js` `cloud.js` `auth.js` `gate.js` `photos.js` `firebaseInit.js`

## このセッションでやったこと

### 機能追加（フェーズ1・デプロイ済み）
1. **クイック記録** — 現在地 →「近くの店」を自動候補 → 写真/メモ無しで即保存 → 後から追記。`records.showQuickLog` / `places.nearbyPlaces`（`Place.searchNearby`）。
2. **1年前の今日・記念日** — 起動時に同月同日の過去記録／記念日カードをヘッダー下に表示。`js/memories.js`（`pickMemories` ＋ view）。記念日は Firestore `spaces/{id}.anniversary`、設定は絞り込み内「記念日」ボタン（`space.setAnniversary`）。閉じた日は当日 localStorage で再表示しない。
- 仕様/計画: `docs/superpowers/specs|plans/2026-08-12-phase1-quicklog-memories*`

### デザイン刷新（世界観＝「温かみ・エモい思い出」。テラコッタ系を深める。1画面ずつショーケース化して展開）
1. **絞り込みパネル** — モード＝セグメント式ピル、ジャンル＝各色で染まるトグルチップ（`:has()`＋`color-mix()`、状態の真実は隠し `<select>`/checkbox）、設定を区切って分離。仕様/計画: `.../2026-08-12-filter-panel-redesign*`
2. **フォント** — 見出し・日付＝Zen Maru Gothic、本文＝Zen Kaku Gothic New（Google Fonts）。`--font-sans`/`--font-display` トークンで全体適用。
3. **記録の詳細（思い出ページ）** — 写真ヒーロー＋編集的レイアウト。複数訪問は「訪れた日」チップ切替。写真なしはジャンル色グラデ。`showDetail` 刷新＋`.dt-*` CSS。
4. **カレンダー** — アルバム風。空の日は薄い数字だけ、月見出しは丸ゴシック大＋「N つの思い出」、曜日を日/土で色分け、写真セルに下スクリム。
5. **フォーム統一（追加/編集/クイック記録）** — ジャンル＝色チップ（`genrePicker`/`wireGenrePicker`、真実は隠し select）、温かい入力、写真＝破線タイル（`fileDrop`）、ボタン統一。
6. **スプラッシュ/ログイン** — 温かいグラデ背景、グラデのロゴ（地図ピン、ハート無し）、タグライン「ふたりの思い出を、地図に。」、白い Google ログインボタン。
7. **地図ヘッダー統合** — 絞り込みを検索バー右端アイコンに内蔵（独立「絞り込み」ピル廃止）、一発リセットは地図左上の丸「×」（`#filter-clear-top`）で維持、ピルの影を軽く温かく統一。

### 細かい修正
- 現在地ボタンの重なり → 絞り込み/シートを開いている間は非表示（`#topbar.filters-open ~ ...` と `#layout:has(#panel:not([hidden])) #locate-btn`）。
- iOS 日付入力のはみ出し → スマホ幅で `-webkit-appearance:none` ＋ `min-width:0`。
- 絞り込みの日付欄の出し分けバグ → `#range-inputs[hidden]{display:none}`（`display:flex` が `hidden` を打ち消していた）。
- 詳細を地図タップで閉じる → Google の click が空タップで安定発火しないため、**pointer ベースのタップ検出**（`map.setTapHandler`、長押し検出と同じ仕組み）に変更。POI タップで閉じた直後は店カードを抑制（`records` の `suppressPlaceUntil`）。
- **アプリ内バージョン表示**（設定欄 `ver. YYYYMMDD_x`）— 更新反映の確認用。

## 現状
- 最新デプロイ **ver. 20260812q**（設定欄の `ver.` 表示がこれと一致すれば反映済み）。
- フェーズ1機能＋上記デザイン刷新、すべて本番反映済み。main と origin/main は同期。

## 運用ルール／ハマりどころ（重要）
- **デプロイのたびに `index.html` の全 `?v=` と `.app-ver` の番号を上げる**（例 `20260812q` → `20260812r`）。番号を本人に伝え、設定欄の表示と一致で反映確認。
  - 一括置換例: `sed -i 's/20260812q/20260812r/g' index.html`
- **GitHub Pages の CDN が index.html を数分キャッシュ**するので反映にラグが出る（Service Worker は無い）。「更新されない」はたいていこれ。
- **地図の素の Google が派手（cheapness 診断の①・最も効く）**が、Map ID ＋ AdvancedMarker のためスタイルは **Google Cloud Console 側**で行う必要あり（JSON をコードに注入不可）。本人は「今はこのまま」で保留。
- `:has()` / `color-mix()` を多用（本人の最近の iPhone で表示 OK 確認済み）。非対応環境ではドット色でフォールバック。
- **UI の実挙動はエージェントから確認できない**（Google ログイン＋ライブ Maps＋位置情報が必要）。純粋関数だけ `node -e "global.window={};global.App=global.window.App={};require('./js/memories.js');global.App.memories._selfTest();"` 等で検証。実機確認は本人がスマホ（本番 URL）で行う。
- 開発フロー: brainstorming → writing-plans →（subagent-driven / executing-plans）→ finishing。specs/plans は `docs/superpowers/`。デザイン系の小変更はインライン実装で回してきた。

## 残タスク／次の候補
- デザイン: **④ 色のメリハリ**（淡すぎる配色に数カ所だけ深い色/強アクセント）、**⑤ 写真をさらに主役に**、**思い出カード（1年前の今日）を詳細ページの質感に**、地図ヘッダーの微調整。
- **② 地図スタイル**（Google Cloud Console 作業、要本人）＝見た目に一番効く。保留中。
- **フェーズ2: 写真 EXIF 自動入力** — 一度着手したが本人が「今はいい」で保留。iOS Safari は写真ライブラリの GPS を消しがち＝位置はベストエフォート、日付は比較的残る、が前提。
- **フェーズ3: 統計・年間まとめ・スライドショー** — 未着手（データが溜まってから映える）。

## 補足（本人の使い方・好み）
- 日本語でやり取り。ポートフォリオ配下の個人アプリだが「二人で実際に使い倒す」のが軸。
- 確認は本番デプロイ後のスマホで行う（＝先に push が必要な場面が多い）。
- 世界観は「洗練ミニマル/高級プレミアム/ポップ可愛い」ではなく **温かみ・エモい思い出**。

（永続メモリ `MEMORY.md` とその配下にも同等の要点あり。新チャットでは自動で読み込まれる。）
