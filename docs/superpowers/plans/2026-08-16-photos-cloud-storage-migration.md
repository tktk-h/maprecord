# 写真を Cloud Storage へ移行（フェーズ1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写真の保存を Firestore埋め込み(Base64) から Cloud Storage(URL保存) へ切り替え、1記録あたりの写真枚数上限を実質撤廃する（既存Base64記録は非破壊で共存）。

**Architecture:** `js/photos.js` を「圧縮→2サイズ(full/thumb)生成→Storageへ`uploadBytes`→`getDownloadURL`」に差し替える。記録ドキュメントには軽いURL(`{url, thumbUrl, path, thumbPath}`)だけ保存。表示側は全経路 `photo.url`/`thumbUrl` を読むだけなので data: でも https: でも動く（後方互換）。記録削除・写真削除・写真差し替えの全経路でStorage実ファイルも連動削除して孤児を防ぐ。Storageセキュリティルールは deny-by-default＋スペースメンバー限定で、Firebase CLI 管理・`firebase deploy` で反映する。

**Tech Stack:** バニラJS(ESモジュール＋classicスクリプト混在), Firebase Web SDK v10.12.2 (firebase-storage 追加), Cloud Storage for Firebase, Firebase CLI (firebase-tools)。自動テストランナーは無し → 純粋関数は `_selfTest()`（devtoolsコンソールで実行）、Storage/認証依存部は本人スマホでの実機確認で検証する。

---

## テスト方針（このリポジトリ特有・重要）

このプロジェクトに Jest/Vitest 等のテストランナーは無い。既存の検証様式に合わせる：

- **純粋関数**（`fitSize`, `storagePathFor`, `thumbOf`）→ `App.photos._selfTest()` を拡張。ブラウザのdevtoolsコンソールで実行し、`PASS`/`FAIL` を目視。これが本計画の「ユニットテスト」。
- **Storage/認証依存**（アップロード・削除・ルール）→ 本人のスマホ実機確認。手順を各タスクに明記。
- 各コード変更後に `_selfTest()` を回す or 実機確認する、を1ステップとして必ず含める。

---

## File Structure

作成・変更するファイルと責務：

- **Create** `firebase.json` — Firebase CLI に Storageルールの所在を教える設定。
- **Create** `.firebaserc` — デフォルトプロジェクト(`map--record`)の指定。
- **Create** `storage.rules` — Storageセキュリティルール（deny-by-default＋スペースメンバー限定＋書込みバリデーション）。**リポジトリを正本**とし CLI で反映。
- **Modify** `js/firebaseInit.js` — `getStorage` を追加し `App.fb.storage` を公開。
- **Modify** `js/photos.js` — 保存方式を Storage へ差し替え（本体）。純粋ヘルパ＋Storage操作＋削除ヘルパ。`PHOTO_BUDGET`/`withinLimit`/`bytesOf`/`compressToDataURL` は削除。
- **Modify** `js/records.js` — 追加/編集/削除フローを Storage 対応（groupId, 上限ガード撤去, 孤児クリーンアップ, 差分削除, 進捗表示）＋表示のサムネ化。
- **Modify** `js/map.js` / `js/memories.js` / `js/search.js` — ピン・思い出カード・検索候補のサムネを `thumbOf()` 経由に。
- **Modify** `index.html` — `?v=` と `.app-ver` を上げる（キャッシュ対策）。

**表示のサムネ/フル使い分け（確定）：**
- **thumb**（`thumbOf(p)` = `p.thumbUrl || p.url`）：地図ピン `map.js:266`、思い出カード `memories.js:79`、検索候補 `search.js:59`、記録カードのサムネ `records.js:185`、詳細サムネ列 `records.js:568-569`、編集の既存サムネ `records.js:678`。
- **full**（`p.url`）：詳細ヒーロー `records.js:563`、ライトボックス `records.js:558`（`urls = photos.map(p=>p.url)`）。
- **対象外**：`records.js:498-499`/`529` の `p.photoUrls` は **Google Places API 由来の店舗写真**（`App.places.fetchPlace`）で、ユーザーのアップロード写真ではない → 触らない。

---

## データ形状（記録ドキュメント内 photos[]）

```js
// 新規（Storage）
{ url: "https://firebasestorage.../full.jpg?token=...",
  thumbUrl: "https://.../thumb.jpg?token=...",
  path: "spaces/{spaceId}/photos/{groupId}/{photoId}-full.jpg",
  thumbPath: "spaces/{spaceId}/photos/{groupId}/{photoId}-thumb.jpg" }
// 既存（Base64・触らない）
{ url: "data:image/jpeg;base64,..." }
```

`thumbUrl`/`path`/`thumbPath` を持たない既存写真は `thumbOf()` が `url`(dataURL)にフォールバック＝そのまま表示。削除ヘルパは `path` が無い写真をno-opにする＝Base64は消す実ファイルが無い。

---

### Task 1: 安全網（復元用タグ＋featureブランチ）

絶対要件#1（ロールバック安全）。着手前に main を即戻せる状態にする。

**Files:** なし（git操作のみ）

- [ ] **Step 1: 作業ツリーがクリーンか確認**

Run:
```bash
git status --porcelain
```
Expected: 出力なし（クリーン）。何かあれば先にコミット/退避。

- [ ] **Step 2: 復元用タグを打つ**

Run:
```bash
git tag pre-storage-migration
```
Expected: エラーなし。`git tag` で `pre-storage-migration` が見えること。

- [ ] **Step 3: featureブランチを作成して移動**

Run:
```bash
git switch -c feature/photos-cloud-storage
```
Expected: `Switched to a new branch 'feature/photos-cloud-storage'`

- [ ] **Step 4: ブランチ確認**

Run:
```bash
git branch --show-current
```
Expected: `feature/photos-cloud-storage`

---

### Task 2: Storageセキュリティルール（deny-by-default＋メンバー限定）

絶対要件#2（プライバシー）。**まだ deploy しない**（コードとルールを一緒に検証してから Task 10 で反映）。メンバー判定は既存Firestoreモデル `spaces/{id}.members`（uid配列, `js/space.js:34`）に合わせ、Storageルールから `firestore.get()` で相互参照する。

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `storage.rules`

- [ ] **Step 1: `firebase.json` を作成**

```json
{
  "storage": {
    "rules": "storage.rules"
  }
}
```

- [ ] **Step 2: `.firebaserc` を作成**

```json
{
  "projects": {
    "default": "map--record"
  }
}
```

- [ ] **Step 3: `storage.rules` を作成**

`spaces/{spaceId}/photos/**` は「ログイン済み かつ その spaceId のメンバー」だけ read/write。書込みは画像かつ<15MBに制限。それ以外は全拒否。

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

    // spaces/{id}.members（Firestore）にログインuidが含まれるか
    function isSpaceMember(spaceId) {
      return request.auth != null
        && request.auth.uid in
           firestore.get(/databases/(default)/documents/spaces/$(spaceId)).data.members;
    }

    // 書込みは画像のみ・15MB上限（圧縮後は数百KB想定、安全枠）
    function isValidImage() {
      return request.resource.size < 15 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }

    match /spaces/{spaceId}/photos/{allPaths=**} {
      allow read: if isSpaceMember(spaceId);
      allow write: if isSpaceMember(spaceId) && isValidImage();
    }

    // 既定は全拒否
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: コミット**

```bash
git add firebase.json .firebaserc storage.rules
git commit -m "chore(storage): add Firebase CLI config and deny-by-default Storage rules"
```

> **注意（トークンURLの性質）:** `getDownloadURL()` のトークン付きURLで `<img src>` 表示する場合、その読み取りにルールは評価されない（＝URLを知る者は見られる。spec本人了承済み）。ルールは主に **書込み・削除・SDK経由read** を保護する。高秘匿な写真は入れない前提。

---

### Task 3: firebaseInit に Storage を追加

**Files:**
- Modify: `js/firebaseInit.js`

- [ ] **Step 1: import と公開を追加**

`js/firebaseInit.js:1-3` の import 群に storage を追加：

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
```

`js/firebaseInit.js:17` の公開を差し替え：

```js
window.App.fb = { app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
```

- [ ] **Step 2: 読み込み確認（devtoolsコンソール）**

アプリを開き（後述の実機/ローカルどちらでも）、コンソールで：
```js
App.fb.storage
```
Expected: Storage オブジェクトが返る（`undefined` でない）。bucket は `map--record.firebasestorage.app`。

- [ ] **Step 3: コミット**

```bash
git add js/firebaseInit.js
git commit -m "feat(storage): expose Firebase Storage on App.fb.storage"
```

---

### Task 4: photos.js の純粋ヘルパ（storagePathFor, thumbOf）を追加＋自己テスト

差し替え本体の前に、テスト可能な純粋関数を先に用意する（TDDの単位）。この時点ではまだ既存の保存動作は壊さない（`toStored` は次タスクで差し替え）。

**Files:**
- Modify: `js/photos.js`
- Test: `js/photos.js` の `_selfTest`（devtoolsコンソール実行）

- [ ] **Step 1: 失敗する自己テストを先に書く**

`js/photos.js` の `_selfTest`（現 `js/photos.js:51-57`）に、まだ存在しない `storagePathFor`/`thumbOf` の期待を追加：

```js
  function _selfTest() {
    const eq = (n, got, want) => console.log((JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    eq('landscape', fitSize(4000, 3000, 1280), { w: 1280, h: 960 });
    eq('portrait', fitSize(3000, 4000, 1280), { w: 960, h: 1280 });
    eq('small-nogrow', fitSize(800, 600, 1280), { w: 800, h: 600 });
    eq('square', fitSize(2000, 2000, 1280), { w: 1280, h: 1280 });
    eq('path-full', storagePathFor('sp1', 'grp1', 'p1', 'full'), 'spaces/sp1/photos/grp1/p1-full.jpg');
    eq('path-thumb', storagePathFor('sp1', 'grp1', 'p1', 'thumb'), 'spaces/sp1/photos/grp1/p1-thumb.jpg');
    eq('thumb-of-storage', thumbOf({ url: 'https://f/full', thumbUrl: 'https://f/thumb' }), 'https://f/thumb');
    eq('thumb-of-base64', thumbOf({ url: 'data:image/jpeg;base64,xxx' }), 'data:image/jpeg;base64,xxx');
    eq('thumb-of-null', thumbOf(null), null);
  }
```

- [ ] **Step 2: テストが失敗することを確認**

アプリを開き、devtoolsコンソールで：
```js
App.photos._selfTest()
```
Expected: `path-full`/`path-thumb`/`thumb-of-*` の行が `FAIL`（`storagePathFor is not defined` 由来のエラー、または未定義）。`fitSize` 系は `PASS`。

- [ ] **Step 3: 純粋関数を実装**

`js/photos.js` の `fitSize`（現 `js/photos.js:8-13`）の直後に追加：

```js
  // Storage のオブジェクトパスを組み立てる（純粋）。variant は 'full' | 'thumb'
  function storagePathFor(spaceId, groupId, photoId, variant) {
    return `spaces/${spaceId}/photos/${groupId}/${photoId}-${variant}.jpg`;
  }

  // 表示用サムネURL。Storage写真は thumbUrl、既存Base64は url にフォールバック（純粋）
  function thumbOf(photo) {
    if (!photo) return null;
    return photo.thumbUrl || photo.url || null;
  }
```

- [ ] **Step 4: エクスポートに追加**

`js/photos.js` の `return { ... }`（現 `js/photos.js:59`）に `storagePathFor` と `thumbOf` を追加（他は次タスクで整理するのでこの時点では既存も残す）：

```js
  return { fitSize, storagePathFor, thumbOf, compressToDataURL, toStored, toStoredMany, bytesOf, withinLimit, _selfTest };
```

- [ ] **Step 5: テストが通ることを確認**

アプリを再読込（`index.html` の `?v=` はまだ上げない＝ローカルはハードリロード）し、コンソールで：
```js
App.photos._selfTest()
```
Expected: 全行 `PASS`。

- [ ] **Step 6: コミット**

```bash
git add js/photos.js
git commit -m "feat(photos): add pure helpers storagePathFor and thumbOf with self-tests"
```

---

### Task 5: photos.js を Storage 保存へ差し替え（本体）

`toStored` を「圧縮→full/thumb 2サイズ→`uploadBytes`→`getDownloadURL`」に。`toStoredMany` に **部分アップロード失敗時のロールバック** と **進捗コールバック**、`deletePhotoFiles`（削除連動用）を追加。`PHOTO_BUDGET`/`withinLimit`/`bytesOf`/`compressToDataURL` を削除。

**Files:**
- Modify: `js/photos.js`

- [ ] **Step 1: firebase-storage の import を先頭に追加**

`js/photos.js:1`（`window.App = window.App || {};` の**前**）に追加。photos.js はESモジュール(`export`済み)なので import 可：

```js
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { fb } from './firebaseInit.js';
```

- [ ] **Step 2: 定数を full/thumb 2サイズに**

`js/photos.js` の定数（現 `js/photos.js:4-5` の `MAX_EDGE`/`QUALITY`）を差し替え：

```js
  const FULL_EDGE = 1280;   // 詳細ヒーロー・ライトボックス用
  const THUMB_EDGE = 400;   // 一覧・ピン・検索候補用
  const QUALITY = 0.72;     // JPEG 画質
```

- [ ] **Step 3: `compressToDataURL` を `compressToBlob` に差し替え**

現 `js/photos.js:15-31` の `compressToDataURL` 全体を、Blobを返す版に置き換え（`toDataURL`→`toBlob`、maxEdge を引数化）：

```js
  // File/Blob → 長辺 maxEdge に収めた圧縮JPEG Blob
  function compressToBlob(file, maxEdge) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('画像の変換に失敗'))),
          'image/jpeg', QUALITY,
        );
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('画像読み込み失敗')); };
      img.src = objUrl;
    });
  }
```

- [ ] **Step 4: `toStored`/`toStoredMany` を Storage 版に差し替え＋削除ヘルパ追加**

現 `js/photos.js:33-49`（`toStored`〜`withinLimit`）を丸ごと以下に置き換え。`PHOTO_BUDGET`/`bytesOf`/`withinLimit` は削除される：

```js
  // ランダムID（グループ内で衝突しない程度に十分）
  function rid() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  }

  // File → Storage に full/thumb を上げ、記録に保存する写真オブジェクトを返す
  // { url(=full), thumbUrl, path, thumbPath }
  async function toStored(file, groupId) {
    const spaceId = App.cloud._spaceId();
    if (!spaceId) throw new Error('スペース未選択のため写真を保存できません');
    const photoId = rid();
    const path = storagePathFor(spaceId, groupId, photoId, 'full');
    const thumbPath = storagePathFor(spaceId, groupId, photoId, 'thumb');

    const [fullBlob, thumbBlob] = await Promise.all([
      compressToBlob(file, FULL_EDGE),
      compressToBlob(file, THUMB_EDGE),
    ]);

    const fullRef = ref(fb.storage, path);
    const thumbRef = ref(fb.storage, thumbPath);
    await uploadBytes(fullRef, fullBlob, { contentType: 'image/jpeg' });
    await uploadBytes(thumbRef, thumbBlob, { contentType: 'image/jpeg' });
    const [url, thumbUrl] = await Promise.all([
      getDownloadURL(fullRef),
      getDownloadURL(thumbRef),
    ]);
    return { url, thumbUrl, path, thumbPath };
  }

  // 複数を直列アップロード。途中失敗したら、それまでに上げた分を消してから throw（孤児防止）
  // onProgress(done, total) を任意で呼ぶ
  async function toStoredMany(files, groupId, onProgress) {
    const out = [];
    try {
      for (let i = 0; i < files.length; i++) {
        out.push(await toStored(files[i], groupId));
        if (onProgress) onProgress(i + 1, files.length);
      }
      return out;
    } catch (err) {
      // 部分アップロードのロールバック（ベストエフォート）
      for (const p of out) { try { await deletePhotoFiles(p); } catch (_) { /* noop */ } }
      throw err;
    }
  }

  // 写真1件の実ファイル(full/thumb)を削除。path が無い写真(既存Base64)は何もしない。
  // 存在しない等のエラーは握りつぶす（冪等・ベストエフォート）
  async function deletePhotoFiles(photo) {
    if (!photo) return;
    for (const key of ['path', 'thumbPath']) {
      const p = photo[key];
      if (!p) continue;
      try { await deleteObject(ref(fb.storage, p)); } catch (e) { console.warn('storage delete skip', p, e && e.code); }
    }
  }
```

- [ ] **Step 5: エクスポートを整理**

`js/photos.js` の `return { ... }`（Task 4 で編集した行）を、削除済み関数を除いた最終形に：

```js
  return { fitSize, storagePathFor, thumbOf, compressToBlob, toStored, toStoredMany, deletePhotoFiles, _selfTest };
```

- [ ] **Step 6: 自己テストが依然 PASS することを確認**

アプリを再読込し、コンソールで：
```js
App.photos._selfTest()
```
Expected: 全行 `PASS`（純粋関数は不変）。`App.photos.withinLimit` は `undefined`（削除済み）。

- [ ] **Step 7: コミット**

```bash
git add js/photos.js
git commit -m "feat(photos): store photos to Cloud Storage (full+thumb) with rollback and delete helper"
```

---

### Task 6: 追加フロー（新規記録）を Storage 対応

`records.js` の通常追加フォーム。上限ガードを撤去し、`toStoredMany` に groupId(tempId)と進捗を渡し、`cloud.add` 失敗時は上げた写真を掃除する。

**Files:**
- Modify: `js/records.js`（現 `js/records.js:352-376` の `rec-form` onsubmit）

- [ ] **Step 1: onsubmit を差し替え**

現 `js/records.js:352-376` を以下に置き換え（`withinLimit` ガード削除、groupId=tempId、進捗表示、失敗時クリーンアップ）：

```js
    document.getElementById('rec-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const files = Array.from(f.photos.files);
      const order = all.filter((r) => r.date === f.date.value).length; // その日の末尾に追加
      const submitBtn = f.querySelector('button[type=submit]');
      submitBtn.disabled = true; submitBtn.textContent = '保存中…';
      let photos = [];
      try {
        const groupId = 'new-' + Date.now(); // recordId 未確定なので一時ID（パスは表示用途のみ）
        photos = await App.photos.toStoredMany(files, groupId, (done, total) => {
          if (total > 1) submitBtn.textContent = `アップロード中 ${done}/${total}`;
        });
        await App.cloud.add({
          date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order, lat, lng, photos,
          ...(placeId ? { placeId } : {}),
        });
        clearPanel(); // 保存後は購読が自動反映
      } catch (err) {
        // DB保存前に上げた写真が孤児化しないよう掃除（ベストエフォート）
        for (const p of photos) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        alert('保存に失敗しました: ' + err.message);
        submitBtn.disabled = false; submitBtn.textContent = '保存';
      }
    };
```

- [ ] **Step 2: 実機確認（写真1枚追加）**

本人スマホ or ローカルで、通常フォームから写真1枚付きの記録を追加 → 保存成功 → 一覧/ピン/詳細に表示されること。devtools Network で `firebasestorage.googleapis.com` への `uploadBytes` が2本(full/thumb)走ること。

> ※ Storage への実書込みは Task 10 のルール deploy 後でないと権限で弾かれる。**この Step は Task 10 の後にまとめて実施**してよい（順序は実行時に調整）。コード自体のコミットは先行する。

- [ ] **Step 3: コミット**

```bash
git add js/records.js
git commit -m "feat(records): upload new-record photos to Storage with progress and orphan cleanup"
```

---

### Task 7: 編集フロー（既存記録）を Storage 対応＋外した写真の実削除

`records.js` の編集フォーム。上限ガード撤去、groupId=record.id、`cloud.put` 成功後に **×で外したStorage写真の実ファイルを差分削除**、`put` 失敗時は新規アップ分を掃除。

**Files:**
- Modify: `js/records.js`（現 `js/records.js:744-774` の `edit-form` onsubmit）

- [ ] **Step 1: onsubmit を差し替え**

現 `js/records.js:744-774` を以下に置き換え。`keep` は `record.photos` のコピーから splice で作られる（`js/records.js:641`）ためオブジェクト同一性が保たれ、`record.photos.filter(p => !keep.includes(p))` で「外した写真」を特定できる：

```js
    document.getElementById('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '更新中…';
      let uploaded = [];
      try {
        const newFiles = Array.from(f.photos.files);
        uploaded = newFiles.length
          ? await App.photos.toStoredMany(newFiles, record.id, (done, total) => {
              if (total > 1) btn.textContent = `アップロード中 ${done}/${total}`;
            })
          : [];
        const picked = App.map.getPickedLatLng(); // 「位置を修正」していれば新座標
        const photos = keep.concat(uploaded); // 残した既存写真＋追加分
        const updated = {
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: picked ? picked.lat : record.lat,
          lng: picked ? picked.lng : record.lng,
          photos,
          ...(linkedPlaceId ? { placeId: linkedPlaceId } : {}), // 既存の場所IDを維持／紐付けで後付け
        };
        App.map.stopPickLocation();
        await App.cloud.put(updated);
        // 保存成功後：×で外したStorage写真の実ファイルを掃除（Base64はpath無し=no-op）
        const removed = (record.photos || []).filter((p) => !keep.includes(p));
        for (const p of removed) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        showDetail(updated);
      } catch (err) {
        // 保存できなかったら新規アップ分が孤児化しないよう掃除
        for (const p of uploaded) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        alert('更新に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '更新';
      }
    };
```

- [ ] **Step 2: 実機確認（差し替え・削除連動）**（Task 10 後に実施）

編集で「写真を1枚×で外して更新」→ 保存成功 → その写真がFirestore/表示から消える → Firebase Console の Storage で該当 `full/thumb` ファイルも消えていること。「写真を1枚追加して更新」→ 追加が表示されること。

- [ ] **Step 3: コミット**

```bash
git add js/records.js
git commit -m "feat(records): delete removed Storage photos on edit and clean up on failure"
```

---

### Task 8: 記録削除フローで Storage 実ファイルも削除

`records.js` の削除ボタン。doc削除に加え、記録が持つ写真の実ファイルを掃除する。孤児防止（絶対要件・spec「削除の連動」）。

**Files:**
- Modify: `js/records.js`（現 `js/records.js:633-637` の `del-btn` onclick）

- [ ] **Step 1: onclick を差し替え**

現 `js/records.js:633-637` を以下に置き換え。doc を先に消して（＝購読が即UIから除去）、その後ベストエフォートで実ファイルを掃除：

```js
    document.getElementById('del-btn').onclick = async () => {
      if (!confirm(`「${record.name}」を削除しますか？`)) return;
      await App.cloud.remove(record.id);
      // 記録が持つ写真の実ファイルも掃除（Base64はpath無し=no-op、失敗は握りつぶす）
      for (const p of (record.photos || [])) {
        try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ }
      }
      clearPanel(); // 購読が自動反映
    };
```

- [ ] **Step 2: 実機確認（削除連動）**（Task 10 後に実施）

写真付き記録を削除 → 一覧/地図から消える → Console の Storage で該当ファイル(full/thumb)も消えていること。

- [ ] **Step 3: コミット**

```bash
git add js/records.js
git commit -m "feat(records): delete Storage files when a record is deleted"
```

---

### Task 9: 表示側をサムネ(thumbOf)経由に切り替え

一覧・ピン・検索候補・詳細サムネ列は軽い `thumbUrl` を使う（無ければ `url` フォールバック）。ヒーローとライトボックスは `url`(フル)のまま。既存Base64は自動でフォールバックされ表示不変。

**Files:**
- Modify: `js/records.js`（`js/records.js:185`, `568-569`, `678`）
- Modify: `js/map.js`（`js/map.js:266`）
- Modify: `js/memories.js`（`js/memories.js:79`）
- Modify: `js/search.js`（`js/search.js:59`）

> **触らない:** `js/records.js:498-499`/`529` の `p.photoUrls` は Google Places API 由来の店舗写真（`App.places.fetchPlace`）で、ユーザーのアップロード写真ではない。ライトボックス`529`もフル画質が要るので変更しない。

- [ ] **Step 1: records.js の記録カードサムネ（検索グループ）**

`js/records.js:185`：
```js
        ? `<span class="result-thumb" style="background-image:url(${App.photos.thumbOf(g.photo)})"></span>`
```
（元は `${g.photo.url}`）

- [ ] **Step 2: records.js 詳細サムネ列（dt-strip）**

`js/records.js:568-569`：
```js
      ? `<div class="dt-strip">${photos.map((p, i) =>
          `<span class="dt-thumb" data-i="${i}" style="background-image:url(${App.photos.thumbOf(p)})"></span>`).join('')}</div>`
```
（元は `${p.url}`）。**ヒーロー `js/records.js:562-563` の `photos[0].url` と、ライトボックス `js/records.js:558` の `photos.map((p) => p.url)` は変更しない**（フル画質）。

- [ ] **Step 3: records.js 編集の既存サムネ**

`js/records.js:678`：
```js
          <img class="thumb" src="${App.photos.thumbOf(p)}" alt="">
```
（元は `${p.url}`）

- [ ] **Step 4: map.js ピン画像**

`js/map.js:266`：
```js
        + `<img class="pin-img" src="${App.photos.thumbOf(photo)}" style="border-color:${color}">`
```
（元は `${photo.url}`）

- [ ] **Step 5: memories.js 思い出アイコン**

`js/memories.js:79`：
```js
      ? `<div class="mem-icon" style="background-image:url(${App.photos.thumbOf(photo)})"></div>`
```
（元は `${photo.url}`）

- [ ] **Step 6: search.js 検索候補サムネ**

`js/search.js:59`：
```js
        ? `<span class="ss-thumb" style="background-image:url(${App.photos.thumbOf(g.photo)})"></span>`
```
（元は `${g.photo.url}`）

- [ ] **Step 7: 既存Base64記録が壊れないこと（回帰確認）**

Storageへ切り替える前でも実施可能な回帰チェック。アプリを再読込し、**既存のBase64写真付き記録**が一覧・ピン・詳細・検索候補・思い出カードで従来どおり表示されること（`thumbOf` が `url`(dataURL)にフォールバック）。ライトボックスも開けること。

- [ ] **Step 8: コミット**

```bash
git add js/records.js js/map.js js/memories.js js/search.js
git commit -m "feat(display): use thumbnail URLs for list/pins/search, keep full for hero and lightbox"
```

---

### Task 10: Storageルールを deploy し、権限を検証

コードが揃った段階でルールを本番反映し、書込み・非メンバー拒否を確認する。**firebase login は対話・認証操作のため人間（本人）が実施**（エージェントは行わない）。

**Files:** なし（CLI操作）

- [ ] **Step 1: firebase-tools を用意（未導入なら）**

本人が実施。導入確認：
```bash
firebase --version
```
未導入なら:
```bash
npm install -g firebase-tools
```

- [ ] **Step 2: ログイン（本人・対話）**

```bash
firebase login
```
Expected: ブラウザ認証が完了し `Success! Logged in as ...`。

- [ ] **Step 3: Storageルールを deploy**

リポジトリ直下で:
```bash
firebase deploy --only storage
```
Expected: `storage.rules` がアップロードされ `Deploy complete!`。プロジェクトは `.firebaserc` の `map--record`。

- [ ] **Step 4: 正常系の書込み確認（メンバー）**

本人アカウントでアプリにログインし、Task 6 Step 2 / Task 7 Step 2 / Task 8 Step 2 の実機確認を実施（写真の追加→表示→編集差し替え→削除連動）。10枚追加も試す（Task 11）。

- [ ] **Step 5: 非メンバー/未ログインで読めないことを確認（絶対要件#2）**

以下いずれかで検証：
- **Console の Rules Playground**（Storage > Rules > シミュレータ）で、`spaces/{他人のspaceId}/photos/x-full.jpg` への read を「未認証」「別uid」で実行 → **Denied** になること。
- 実機で、スペース未参加の別Googleアカウントでログインし、他スペースのパスに対する SDK read/write が拒否されること。

> ※ トークン付きダウンロードURLを直接開くと表示できる点は仕様（本人了承済み）。本検証は **SDK経由の read/write と非メンバーのアクセス** を対象とする。

- [ ] **Step 6:（deploy はコミット不要／設定は Task 2 で既にコミット済み）**

deploy 自体は成果物を生まない。ルール内容の変更が発生した場合のみ `storage.rules` を再コミット。

---

### Task 11: 実機総合確認（枚数増・HEIC・負荷）

spec「検証」の中心。本人スマホで実施。

**Files:** なし（手動確認）

- [ ] **Step 1: 枚数増（上限撤廃の確認）**

1記録に写真 **10枚** を追加して保存 → 全枚数が保存され、詳細のサムネ列＋ライトボックスで全て見えること。以前の「合計サイズが大きすぎて保存できません」アラートが**出ない**こと（`withinLimit` 撤去の確認）。

- [ ] **Step 2: クイック記録経路**

クイック記録（写真なし保存）→ その記録を編集で写真追加 → 表示・削除連動が効くこと。

- [ ] **Step 3: HEIC（iPhone写真）**

iPhoneのHEIC写真を追加 → JPEG化されて表示できること。表示崩れ・失敗があればログを確認（`compressToBlob` の `img.onerror`）。

- [ ] **Step 4: 負荷・進捗**

十数枚アップロード時に、保存ボタンが「アップロード中 n/N」で進捗表示されること。途中で回線を切る等で失敗させ、**孤児が残らない**（Console Storage に中途半端なファイルが残らない）こと＝`toStoredMany` ロールバックの確認。

- [ ] **Step 5: 既存Base64記録の非破壊確認（絶対要件#1）**

移行前から存在するBase64写真付き記録が、今も従来どおり表示・編集・ライトボックスできること。その記録を編集保存しても data:URL が保持される（Storageに移されない）こと。

---

### Task 12: デプロイ（キャッシュバスティング）

[[maprecord-cache-busting]]：スマホの古キャッシュで「出てこない」を防ぐため `?v=` と `.app-ver` を上げる。

**Files:**
- Modify: `index.html`

- [ ] **Step 1: バージョン文字列を決める**

現行は `20260816h`（`index.html:17,101,120-131`）。次の値へ（例 `20260817a`。実施日に合わせる）。

- [ ] **Step 2: `?v=` を一括更新**

`index.html` 内の全 `?v=20260816h` を新バージョンへ置換（`style.css` と各 `js/*.js`、`index.html:17` および `:120-131`）。

- [ ] **Step 3: `.app-ver` 表示を更新**

`index.html:101`：
```html
        <div class="app-ver">ver. 20260817a</div>
```
（`?v=` と同じ値に）

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "chore: bump asset version for cache busting"
```

---

### Task 13: ブランチの仕上げ（マージ判断）

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

- [ ] **Step 1: 全実機確認が緑であることを再確認**（Task 10 Step 5 の非メンバー拒否、Task 11 全項目）。
- [ ] **Step 2:** finishing-a-development-branch スキルに従い、main へのマージ/PR/クリーンアップを選択。push で GitHub Pages に本番反映（[[maprecord-deploy]]）。デプロイ後、本番URLをスマホで開き Task 11 Step 1（10枚）を最終確認。
- [ ] **Step 3:** 問題があれば `git switch main` の上、`pre-storage-migration` タグへ戻して即ロールバック可能（絶対要件#1）。既存Base64データは無傷。

---

## Self-Review（spec との突き合わせ）

**Spec coverage:**
- 保存の差し替え（full/thumb, `{url,thumbUrl,path,thumbPath}`）→ Task 5 ✓
- `PHOTO_BUDGET`/`withinLimit` 削除 → Task 5 Step 4-5、ガード撤去 Task 6/7 ✓
- 表示のthumb/fullフォールバック → Task 9 ✓
- 削除連動（記録削除・写真削除・差し替えの全経路）→ Task 8（記録削除）/ Task 7（編集の差分削除＝写真削除・差し替え）✓
- storage.rules（deny-by-default＋メンバー限定）→ Task 2、deploy＋非メンバー検証 → Task 10 ✓
- 既存ルール所在＝CLI管理化 → Task 2（firebase.json/.firebaserc 新規）✓（本人選択：Firebase CLI）
- トークンURL方式・秘匿前提 → Task 2 注記／Task 10 Step 5 ✓
- HEIC実機確認 → Task 11 Step 3 ✓
- 非破壊・ロールバック（タグ＋ブランチ）→ Task 1 / Task 13 Step 3 / Task 11 Step 5 ✓
- 孤児防止（中断・失敗時）→ Task 5（toStoredMany ロールバック）/ Task 6・7 失敗時クリーンアップ / Task 11 Step 4 ✓
- 進捗表示 → Task 6/7 の onProgress ✓
- キャッシュバスティング → Task 12 ✓

**未カバー/持ち越し（spec明記の通り本フェーズ対象外）:** 一括アップロード＋自動グループ化(フェーズ2)、Gemini(フェーズ3)、既存Base64の一括バックフィル（やらない）。

**Type consistency:** 写真オブジェクトのキーは全タスクで `{url, thumbUrl, path, thumbPath}` に統一。`thumbOf(photo)`・`deletePhotoFiles(photo)`・`storagePathFor(spaceId, groupId, photoId, variant)`・`toStored(file, groupId)`・`toStoredMany(files, groupId, onProgress)` はTask 4/5で定義し、Task 6-9の呼び出しと一致。
