# オフライン対応：Service Worker（アプリシェル・v1）

日付: 2026-08-19
対象: `sw.js`（新規・リポジトリ直下）/ `index.html`（SW登録）

## 背景・課題

現状Service Workerが無く、毎回ネットから全アセットを取得する。そのため:
- **出先で電波が弱い/無いとアプリが開けない・遅い**（記録アプリなのに出先で使いづらい）。
- スマホの古いキャッシュで「反映されない」問題があり、手動の `?v=` 運用で凌いでいる。

## ゴール（v1＝アプリシェルのみ）

電波が弱い/無くても**アプリシェル（HTML/CSS/JS/アイコン/フォント）が高速に開く**。記録の中身は従来どおりFirebaseから取得（要通信）。写真もキャッシュしない。あわせて「反映されない」問題を減らす。

- 非対象（YAGNI）: Firestoreオフライン永続化（記録のオフライン閲覧）、写真キャッシュ、Workbox等の導入、precache manifest。

## デプロイ前提

GitHub Pages プロジェクトページ `https://tktk-h.github.io/maprecord/`（ベース `/maprecord/`、カスタムドメイン無し）。全アセット参照は相対。`sw.js?v=…` をリポ直下から登録するとスコープ `/maprecord/` 全体を制御できる。

## 方針（採用：自作の軽量 sw.js＋ランタイムキャッシュ）

Workbox（ビルド工程/依存増）・precache方式（版ごとに全アセット列挙＝事故の温床）は不採用。バニラ構成に合う自作SWで、ランタイムに戦略別キャッシュ。

## 仕様

### 登録（`index.html`）
- `<head>` か末尾に登録スクリプトを追加:
  ```html
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js?v=20260819p', { updateViaCache: 'none' })
          .catch(() => {}); // 失敗しても通常動作を妨げない
      });
    }
  </script>
  ```
- `sw.js?v=<VER>` の `<VER>` は既存の一括版上げ（index.html内の `20260819x` を全置換）に**そのまま乗る**＝バンプ箇所は増えない。

### `sw.js`（新規・リポジトリ直下）
- **キャッシュ名を登録URLの `?v=` から導出**: `const VER = new URLSearchParams(self.location.search).get('v') || 'dev';` → `const CACHE = 'ashiato-' + VER;`。版が変われば登録URLが変わり、新SWが起動して古いキャッシュを破棄する。
- `install`: `self.skipWaiting()`。
- `activate`: `CACHE` 以外の自作キャッシュ（`ashiato-*`）を削除 → `self.clients.claim()`。＝**自動・静かに更新**。
- `fetch`（GETのみ対象。それ以外は素通し）:
  1. **ナビゲーション/HTML**（`req.mode === 'navigate'` または `Accept: text/html`）→ **network-first**: 成功したらレスポンス複製を `CACHE` に保存して返す／失敗（オフライン）は `CACHE` のHTMLを返す。
  2. **静的アセット**（下記 `isStatic(url)` が真）→ **cache-first**: ヒットすれば即返す／無ければ fetch → `ok || opaque` のみ `CACHE` に保存 → 返す。
  3. それ以外 → **何もしない（素通し＝network）**。Firebase/Maps/Places/Gemini/データはキャッシュしない。
- **`isStatic(url)`**（同一オリジン or 固定CDN or Firebase SDK本体の静的のみ・地図タイル/APIは除外）:
  - 同一オリジンで、パスが次のいずれか: `.css` / `/js/` を含む（`.js`）/ 画像（`.png .jpg .jpeg .svg .webp`）/ `.webmanifest`。
  - もしくはホストが**許可リスト**に一致: `unpkg.com`（Phosphor）/ `fonts.googleapis.com`・`fonts.gstatic.com`（Googleフォント）/ `cdn.jsdelivr.net`（exifr）。
  - **Firebase SDK 本体**: `www.gstatic.com` かつパスに `/firebasejs/` を含む（版付き静的モジュール。app.js が `import` するのでオフラインのシェル初期化に必須）。データ系（`firestore.googleapis.com` / `firebasestorage.googleapis.com` / `identitytoolkit.googleapis.com` 等の別ホスト）は含めない＝素通し。
  - **除外**: `maps.googleapis.com` / `maps.gstatic.com` / 地図タイル / `places.googleapis.com` / Cloud Functions（`*.cloudfunctions.net`）/ Firebaseデータ系。許可リストが完全一致ホスト＋パス条件なので自動的に素通しになる（実URL19件で分類テスト済み）。

### 更新挙動（自動・静か）
- 版を上げてpush → 登録URL `sw.js?v=新` に変化 → ブラウザが新SWを取得・install（skipWaiting）→ activate（古キャッシュ削除・clients.claim）。
- HTMLは network-first なので、**オンラインなら次回起動で最新HTML＝左下ver即更新**。SW/キャッシュ更新は裏で追従。プロンプトは出さない。

## 影響・リスクと対策
- **地図タイル/データを絶対にキャッシュしない**: 許可リストは完全一致ホストのみ。`maps.*` は入れない。
- **opaque/正常応答のみ保存**: エラー応答はキャッシュしない（`response.ok || response.type === 'opaque'`）。
- **退避手段（kill switch）**: 問題時は `sw.js` を「全キャッシュ削除＋`registration.unregister()`」する中身に差し替えて版を上げれば無効化できる。
- 版上げ運用は**従来通り**（`?v=` 全置換＋push）。SW用の追加手作業なし。

## 確認方法
- ローカル（`http://localhost`）: SWはlocalhostでも動く。DevTools > Application > Service Workers で登録・activate、Network を Offline にしてリロード→シェルが出る（Firebase/Mapsはオフラインなので当然エラー、シェルUIは表示）。
- 本番（実機）: 反映後、機内モード等でアプリを開いてシェルが出るか。版上げ→左下verが更新されるか（オンライン時）。
- 構文チェック（`node --check sw.js`）。

## バージョン
- 変更後は `index.html` の `?v=`（SW登録の `?v=` 含む全置換）と `.app-ver` を次版へ（[[maprecord-report-version]] / [[maprecord-cache-busting]]）。
