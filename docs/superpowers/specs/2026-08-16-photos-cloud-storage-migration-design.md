# 写真を Cloud Storage へ移行（フェーズ1）— 設計

作成日: 2026-08-16 / 対象: デート記録アプリ / 種別: 基盤変更（写真の保存方式）

## 位置づけ（大きな機能の第1フェーズ）
「複数写真を一括アップロード → 自動グループ化 → 確認UI → 保存」という大機能の**土台**。
全体は3フェーズに分割し、各フェーズを独立に spec→計画→実装→実機確認する。

- **フェーズ1（本spec）**：写真の保存を Firestore埋め込み(Base64) から **Cloud Storage(URL保存)** へ。
- フェーズ2（別spec）：一括アップロード＋自動グループ化（日付＋GPS近接）＋確認/修正UI。
- フェーズ3（別spec）：Gemini でグループの候補を絞る（backend＝Cloud Functions 経由）。

## 背景・ゴール
現在は写真を圧縮Base64にして Firestore の記録ドキュメントに埋め込む方式（`js/photos.js`）。
Firestore の 1ドキュメント1MB上限のため **1訪問あたり写真は合計〜0.9MB＝実質3〜5枚**が上限
（`PHOTO_BUDGET`）。本人は「1訪問に数十枚（少なくとも5枚超）」入れたい。
→ 写真を Cloud Storage に置き、Firestore には **URLだけ**保存する方式に変える。
これで **1記録の写真枚数上限が実質消える**（Firestoreには軽いURLしか置かない）。

無料枠も Firestore 1GB → Storage 5GB に広がる。二人利用は既に Blaze プラン（[[maprecord-billing]]）。

## 絶対要件（最優先）
1. **非破壊 / ロールバック安全**：既存記録の Base64 写真には**一切触らない・消さない**。
   新規写真だけ Storage。両方式が共存し、表示は `photo.url` を読むだけ（data: でも https: でも動く）。
   → コードを戻せば完全に元通り（既存データが無傷）。着手前に**復元用gitタグ**＋**featureブランチ**。
   古いBase64をStorageへ移す「一括バックフィル」は本フェーズでは**やらない**（やるなら別作業＋事前バックアップ）。
2. **プライバシー**：Storageセキュリティルールは**全拒否ベース＋そのスペースのメンバーのみ**。
   実装後、**別アカウント/未ログインで読めないことをテスト**してから本番。
3. **写真の見せ方＝トークン付きダウンロードURL方式（本人選択）**。`getDownloadURL()` のURLを
   Firestoreに保存し `<img src>` に使う。「URLを知る者は見られる（ルール迂回）」性質は承知の上
   （高秘匿な写真は入れない前提）。※将来もっと固くしたければ SDK認証取得方式へ変えられる。

## 設計詳細

### 保存（`js/photos.js` の差し替え）
- `toStored(file)` を「圧縮 → **2サイズ生成** → Storageへ `uploadBytes` → `getDownloadURL`」に変更。
  - **サムネ ~400px（一覧・ピン・検索候補用）** と **フル ~1280px（詳細ヒーロー・ライトボックス用）**。
  - 返す形：`{ url, thumbUrl, path, thumbPath }`（`url`=フルURL を維持＝後方互換）。
- Storage パス例：`spaces/{spaceId}/photos/{recordId or tempId}/{photoId}-full.jpg` と `-thumb.jpg`。
- `PHOTO_BUDGET` / `withinLimit` は**不要になり削除**（Firestoreにはtiny URLのみ）。
- HEIC：canvas経由でJPEG化されるので基本OK。**実機で要確認**（下記）。

### 表示（読む側）
- 一覧サムネ・地図ピン・検索候補・詳細のサムネ列 → **`thumbUrl`**（無ければ `url` にフォールバック）。
- 詳細ヒーロー・ライトボックス → **`url`（フル）**。
- 既存のBase64記録は `thumbUrl` を持たないので `url`(=dataURL) にフォールバック＝そのまま表示。

### 削除の連動（新規に必要）
- 記録削除（`cloud.remove`）・写真削除・写真差し替えの**全経路で、Storageの実ファイル（full/thumb）も削除**。
  孤児ファイル防止。`path`/`thumbPath` を保持しているので削除可能。

### セキュリティルール（`storage.rules`）
- 全拒否をデフォルトに、`spaces/{spaceId}/photos/**` は「ログイン済み かつ その spaceId のメンバー」だけ read/write 可。
- スペースメンバー判定は既存のFirestoreルールのモデルに合わせる（**既存ルールの所在＝コンソール/CLIを要確認**）。

## データ形状（記録ドキュメント内 photos[]）
```
// 新規（Storage）
{ url: "https://firebasestorage.../full.jpg?token=...",
  thumbUrl: "https://.../thumb.jpg?token=...",
  path: "spaces/xxx/photos/rec1/p1-full.jpg",
  thumbPath: "spaces/xxx/photos/rec1/p1-thumb.jpg" }
// 既存（Base64・触らない）
{ url: "data:image/jpeg;base64,..." }
```

## 検証
- コードのユニット的検証は限定的（アップロードはライブStorage＋認証が必要）。純粋関数（`fitSize`等）は `_selfTest`。
- **実機確認（本人がスマホ）**が中心：追加/編集/クイック記録での写真アップ→表示→削除連動→枚数増（例10枚）→別アカウントで読めない。
- ロールバック確認：featureブランチで作業し、mainは着手前タグで即戻せる状態を維持。

## リスク・注意点
- **削除連動の漏れ＝孤児ファイルが5GBを侵食**（後から特定困難）。全削除経路を洗う。
- **HEIC / 大量アップの実機負荷**：十数枚を圧縮＋サムネ生成＋アップロードは重い。進捗表示＋失敗リトライ。
- **キャッシュはベストエフォート**（モバイルSafariは容量小）。帯域は予算アラート¥1,000が保険。
- **オフライン閲覧の後退**：キャッシュ済み以外はオフライン不可 → 本人「問題なし」で了承済み。
- デプロイ時 `index.html` の `?v=`/`.app-ver` を上げる（[[maprecord-cache-busting]]）。

## 次フェーズに持ち越す決定（記録）
- **データ構造**：visit-record（訪問1回=1ドキュメント）を維持。「同一スポット判定」は現状「完全一致座標」
  → フェーズ2で **placeId優先＋無ければ丸めた座標** に改善（[[maprecord-search-feature]]、先日 placeId 保存を実装済み）。
- **グループ化**：日付＋GPS近接で束ね、店名解決はグループごとに1回。時間の空きは補助。手で結合/分割できるUI必須。
- **GPS前提**：未来写真は位置ONでGPSが残る（実測3/3）。過去写真はGPS 0%・日時100%（実測）。
- **Gemini（フェーズ3）**：backend必須。団子グループだけ「代表写真1枚＋候補」でカテゴリ/店名を絞る。
  1グループ1回＝無料枠(1分15回)にまず当たらない。金額は実質タダ、真のコストは保守/プライバシー。
  placeId は Places から取得（Geminiは選ぶだけ）。
