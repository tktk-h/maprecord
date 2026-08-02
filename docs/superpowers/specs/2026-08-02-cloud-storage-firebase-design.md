# クラウド保存（Firebase）設計書

作成日: 2026-08-02

## 目的
デート記録の写真・記録を**クラウド（Firebase）に永続保存**し、長期・大量でも消えないようにする。
二人（恋人と共有）が、それぞれの端末からGoogleログインで同じ記録を見て・追加・編集でき、片方の変更がもう一方にも反映される。

## 全体構成
- サイトは引き続き**静的サイト（GitHub Pages）**。サーバーは追加しない。Firebase をブラウザ側SDK（CDNのESモジュール）で利用する。
- **Firebase Auth**（Googleログイン）＝本人確認。
- **Cloud Firestore**＝記録の文字情報（メタデータ）。
- **Firebase Storage**＝写真本体（圧縮後）。
- 地図・カレンダー・ルート・検索などの表示ロジックは、Firestore から読み込んだ記録配列を使って**現状と同じように**動く（UI/操作は原則変えない）。

## データモデル

### Firestore
- `spaces/{spaceId}` … カップル用スペース
  - `members`: [uid, ...]（参加者のGoogle UID）
  - `inviteCode`: string（招待コード。参加時に照合）
  - `createdAt`: timestamp
- `spaces/{spaceId}/records/{recordId}` … 1件の記録
  - `date`: 'YYYY-MM-DD'
  - `name`: string
  - `genre`: string（キー：food/cafe/... 既存の genres と同じ）
  - `memo`: string
  - `tags`: string[]
  - `lat`, `lng`: number
  - `order`: number（その日のルート順）
  - `photos`: [{ path: string, url: string }]（Storage のパスと表示URL）
  - `createdAt`, `updatedAt`: timestamp

### Firebase Storage
- `spaces/{spaceId}/{recordId}/{photoId}.jpg` … 圧縮済み写真

## 認証・共有の仕組み（スペース＋招待コード）
1. Googleログイン。
2. ログイン後、そのユーザーが所属する `spaces` を検索。
   - **未所属**なら「スペースを作る」か「招待コードで参加する」を選ぶ画面を出す。
     - 作成：新しい `spaces/{id}` を作り、`members=[自分のuid]`、`inviteCode` を自動生成。
     - 参加：入力コードに一致する `spaces` を探し、`members` に自分の uid を追加。
   - **所属済み**なら、そのスペースの記録を読み込んで通常画面へ。
3. 作成者には**招待コード**を表示（相手に渡す）。設定画面からいつでも再表示できる。
4. 以降、`spaces/{spaceId}/records` を**リアルタイム購読**し、双方の追加・編集を自動反映。

### セキュリティルール（要点）
- `spaces/{spaceId}`：`request.auth.uid in resource.data.members` の場合のみ read/write。
  - 参加（members への自分の uid 追加）は、正しい `inviteCode` を知っている認証済みユーザーに許可。
- `spaces/{spaceId}/records/**`：スペースの member のみ read/write。
- Storage `spaces/{spaceId}/**`：スペースの member のみ read/write。
- ルール本文は実装時に確定し、ユーザーが Firebase コンソールに貼る（内容は当方が用意）。

## 写真の扱い（圧縮）
- アップロード前に**リサイズ＆圧縮**：長辺 1600px 程度に縮小、JPEG 画質 ~0.8。canvas で変換。
  - 目安：1枚 4MB → 約0.3MB。無料枠 5GB で約1〜1.5万枚。
- 圧縮後の Blob を Storage にアップロード → `path` と `getDownloadURL()` の `url` を記録に保存。
- 表示は `url` をそのまま `img.src` に使う（object URL 生成は不要になる）。
- 編集で写真を削除したら、対応する Storage オブジェクトも削除する。

## アプリ側の変更点
- **データ層の置き換え**：現行 `js/db.js`（IndexedDB）を Firebase 版に置き換える。
  - 公開関数は近い形を保つが、写真の型が **Blob配列 → {path,url}配列** に変わる。
  - 影響箇所：`records.js`（追加/編集/詳細/検索候補/ルート）、`map.js`（写真ピン）、`calendar.js`（日セル背景）、`lightbox.js`（拡大表示）、`backup.js`。
    - これらの `URL.createObjectURL(blob)` を、保存済み `url` を使う形に変更。
- **認証ゲート**：未ログイン時はログイン画面、未所属時はスペース作成/参加画面を表示。ログイン済み＋所属で通常UI。
- **リアルタイム同期**：Firestore の onSnapshot で記録一覧を購読し、変化時に再描画（既存の `render()` を呼ぶ）。
- **写真アップロードのUI**：保存時に「アップロード中…」の簡易表示（複数枚・時間がかかるため）。
- **モジュール方式**：Firebase SDK は ESモジュール（`import`）。読み込みを `<script type="module">` 化する。既存スクリプトは順次それに合わせて調整（グローバル `App` 名前空間は維持可）。

## オフラインの範囲（v1）
- Firestore のオフライン永続化で、**閲覧はキャッシュで可能**な範囲。
- **追加・保存はネット接続が必要**（写真アップロードのため）。完全オフラインは対象外（将来の拡張候補）。

## バックアップ
- クラウドが一次保存になるため、JSON エクスポートは「保険」として残す（写真は URL 参照で軽量化。中身は実装時に整理）。

## 既存データの移行
- **なし（ゼロから開始）**。現行の IndexedDB 版データは移行しない。

## 一度だけの初期設定（ユーザー作業。当方が手順を全案内）
1. 無料 Firebase プロジェクト作成（既存 Google アカウント）。
2. Authentication で **Google** プロバイダを有効化。
3. **Cloud Firestore** と **Storage** を作成（本番モード）。
4. Web アプリ登録で得られる**設定オブジェクト（公開情報）**をアプリに貼る。
5. 当方提供の**セキュリティルール**を Firestore / Storage に貼る。
6. Authentication の承認済みドメインに `tktk-h.github.io`（と必要なら localhost）を追加。

## コスト
- 当面は無料枠内の見込み（圧縮前提）。超過時は従量課金（保存 ~$0.026/GB/月 目安）。月数百円規模になり得ることを許容。

## スコープ外（今回はやらない）
- 完全オフラインでの追加・保存
- 三人以上の共有、複数スペースの切替
- 写真の動画対応
- 既存 IndexedDB データの移行

## テスト方針
- 静的サイト＋外部SaaSのため自動テストは限定的。
- 純粋ロジック（写真圧縮の縮小計算、招待コード照合、記録の整形）は関数として切り出し、ブラウザ内の簡易チェックで検証。
- 認証・同期・アップロードは、実ブラウザでの手動確認（ログイン→スペース作成→追加→別端末で反映→編集→削除→写真圧縮サイズ確認）。

## 段階的な実装方針
1. Firebase 接続と Google ログイン（ゲート表示まで）
2. スペース作成／招待コード参加
3. 記録の読み書き（Firestore）＋リアルタイム同期。写真は一旦なしで通す
4. 写真の圧縮アップロード（Storage）＋表示の URL 対応
5. 編集・削除（写真の Storage 削除含む）
6. 既存UI（地図/カレンダー/ルート/検索/ライトボックス）の URL 対応の総仕上げ
7. バックアップ調整・エラー表示・仕上げ
