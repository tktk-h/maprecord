# クラウド保存（Firebase）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デート記録の写真・記録をFirebase（Auth/Firestore/Storage）に保存し、二人でGoogleログインして共有・リアルタイム同期できるようにする。

**Architecture:** 静的サイトのまま、FirebaseをブラウザのモジュールSDKで利用。認証ゲート→スペース選択→記録の購読で通常UIへ。写真は圧縮してStorageへ、記録メタデータはFirestoreへ。既存の表示ロジック（地図/カレンダー/ルート/検索/拡大）は写真の扱いを Blob→URL に変えて再利用。

**Tech Stack:** HTML / CSS / Vanilla JS / Firebase 10 (Auth, Firestore, Storage) via gstatic ESM CDN / Leaflet / GitHub Pages

---

## 改訂 (2026-08-02): 方式B（Firestoreのみ・カード不要）
Storage は Blaze（￥5,000前払い）が必要なため、当面 **写真は圧縮して data URL(Base64) として Firestore に保存**する方式Bで実装する。方式A（Storage）向けの手順は将来の移行時に使う。方式Bでのタスク差分：

- **Task 0**：④Storage作成・Blazeアップグレードは**不要**（Auth と Firestore のみ）。
- **Task 6（写真圧縮）**：`compress()` は圧縮した**data URL 文字列**を返す（長辺~1280 / JPEG ~0.72）。`toDataURL('image/jpeg', 0.72)` を使用。
- **Task 7（Storageアップロード）**：**スキップ**（方式A移行時に実施）。代わりに photos.js に `toStored(file)` を用意し `{ url: dataURL }` を返す。
- **Task 4 Step2 / Task 7 Step2 の Storage ルール**：**不要**。Firestore ルールのみ設定。
- **写真の型**：`photos: [{ url }]`（B）。将来Aで `{ path, url }` に拡張。表示は常に `photo.url` を使うので**表示側タスク(Task 10)は同じ**。
- **Task 9（追加/編集/削除）**：Storageアップロードの代わりに `App.photos.toStored(file)` で data URL を得て `photos` に入れる。削除時の Storage 削除は不要（Firestoreの記録削除だけ）。
- **1MB制限**：1記録の写真合計が Firestore ドキュメント上限(1MB)を超えないよう圧縮。超過時は保存エラーを表示。

## 前提と方針
- **Task 0（ユーザー作業）が完了しないと、以降の動作確認はできない。** Task 1以降のコードは書けるが、実ブラウザ検証は Firebase 設定後に行う。
- Firebase SDK は ESモジュール。`js/app.js` を `<script type="module">` にし、Firebaseを使う層（firebase/auth/space/cloud/photos）もモジュールにする。既存の非モジュール（genres, filters, map, calendar, lightbox, sheet, records, backup）はそのまま `window.App` に載せ、実行時に `window.App.cloud` などを参照する（モジュールは classic の後に実行されるため、参照は実行時に解決される）。
- 純粋ロジックは自己テスト（ブラウザのコンソールで `App.x._selfTest()` 実行→PASS表示）。Firebase連携は手動確認。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `js/firebaseInit.js`（新・module） | Firebase初期化。config・auth・db・storage を `window.App.fb` に公開 |
| `js/auth.js`（新・module） | Googleサインイン/アウト、認証状態監視、現在ユーザー |
| `js/space.js`（新・module） | スペースの検索/作成/参加、招待コード生成・照合 |
| `js/cloud.js`（新・module） | 記録のFirestore CRUD＋onSnapshot購読（旧db.jsの代替） |
| `js/photos.js`（新・module） | 画像の圧縮（canvas縮小）・Storageアップロード・削除 |
| `js/gate.js`（新・module） | 認証/スペースのゲートUI（ログイン画面・スペース作成/参加画面）制御 |
| `js/app.js`（変更・module化） | 全体の起動：認証→スペース→記録購読→既存UI初期化 |
| `js/records.js`（変更） | 追加/編集/詳細/検索/ルートの写真を url ベースに |
| `js/map.js`（変更） | 写真ピンを url ベースに |
| `js/calendar.js`（変更） | 日セル背景を url ベースに |
| `js/lightbox.js`（変更） | 拡大表示を url ベースに |
| `js/backup.js`（変更） | エクスポートを url ベースに整理 |
| `js/db.js`（削除） | IndexedDB層は使用停止（読み込みから外す） |
| `index.html`（変更） | ゲートUIのDOM追加、module読み込みへ変更、アップロード表示 |
| `style.css`（変更） | ログイン/スペース/アップロード表示のスタイル |

> 写真のデータ型（全体で統一）: 記録の `photos` は `{ path: string, url: string }[]`。`path` は Storage パス（削除用）、`url` は表示用ダウンロードURL。

---

## Task 0: Firebase プロジェクト設定（ユーザー作業・当方が手順提示）

**Files:** なし（Firebaseコンソール操作）

この Task は実装者がユーザーに次を依頼し、結果（config）を受け取る。完了まで以降の検証はできない。

- [ ] **Step 1: プロジェクト作成**
  1. https://console.firebase.google.com/ →「プロジェクトを追加」→ 名前（例 `maprecord`）→ 作成（Googleアナリティクスはオフでよい）。

- [ ] **Step 2: Authentication（Googleログイン）有効化**
  - 左メニュー Authentication →「始める」→ Sign-in method → **Google** を有効化 → 保存。

- [ ] **Step 3: Firestore 作成**
  - Firestore Database →「データベースを作成」→ 本番モード → ロケーション（例 asia-northeast1）→ 作成。

- [ ] **Step 4: Storage 作成**
  - Storage →「始める」→ 本番モード → 同ロケーション → 作成。

- [ ] **Step 5: Webアプリ登録して config を取得**
  - プロジェクトの設定（⚙）→「マイアプリ」→ Web（`</>`）→ アプリ登録 → 表示される `firebaseConfig`（apiKey, authDomain, projectId, storageBucket, ...）を控える。**これは公開情報でよい**（保護はルールで行う）。

- [ ] **Step 6: 承認済みドメイン追加**
  - Authentication → Settings → 承認済みドメイン → `tktk-h.github.io` を追加（`localhost` は既定で入っていることが多い。なければ追加）。

- [ ] **Step 7: config を実装に渡す**
  - Step 5 の `firebaseConfig` を実装者へ共有 → Task 1 の `firebaseInit.js` に貼る。

---

## Task 1: Firebase 初期化とモジュール読み込み

**Files:**
- Create: `js/firebaseInit.js`
- Modify: `index.html`（scriptをmodule化）

- [ ] **Step 1: `js/firebaseInit.js` を作成（config は Task 0 の値に差し替え）**

```javascript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// ▼ Task 0 Step 5 で取得した firebaseConfig をここに貼る
const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

const app = initializeApp(firebaseConfig);
window.App = window.App || {};
window.App.fb = { app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
export const fb = window.App.fb;
```

- [ ] **Step 2: `index.html` の script 読み込みを調整**

既存の `<script src="js/db.js"></script>` を削除し、`js/app.js` の読み込みを module にする。最終的な読み込み順（`</body>` 直前）:
```html
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="js/genres.js"></script>
  <script src="js/filters.js"></script>
  <script src="js/map.js"></script>
  <script src="js/records.js"></script>
  <script src="js/lightbox.js"></script>
  <script src="js/sheet.js"></script>
  <script src="js/calendar.js"></script>
  <script src="js/backup.js"></script>
  <script type="module" src="js/app.js"></script>
```
（`firebaseInit.js` / `auth.js` / `space.js` / `cloud.js` / `photos.js` / `gate.js` は `app.js` から import するので、個別の script タグは不要。）

- [ ] **Step 3: ブラウザで確認（Firebase設定後）**

`http://localhost:8137/` を開き、コンソールで:
```javascript
App.fb && App.fb.auth && App.fb.db && App.fb.storage ? 'OK' : 'NG'
```
期待: `'OK'`。ネットワークタブで gstatic の firebase-*.js が 200。コンソールに致命的エラーなし。

- [ ] **Step 4: コミット**

```bash
git add js/firebaseInit.js index.html
git commit -m "feat: Firebase初期化とモジュール読み込み"
```

---

## Task 2: Google ログイン（認証層）

**Files:**
- Create: `js/auth.js`

- [ ] **Step 1: `js/auth.js` を作成**

```javascript
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.auth = (function () {
  let current = null; // Firebase User or null

  function onChange(cb) {
    onAuthStateChanged(fb.auth, (user) => { current = user; cb(user); });
  }
  async function signIn() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(fb.auth, provider);
  }
  async function logout() { await signOut(fb.auth); }
  function user() { return current; }

  return { onChange, signIn, logout, user };
})();
export const auth = App.auth;
```

- [ ] **Step 2: 手動確認（Firebase設定後・簡易）**

一時的に app.js で `App.auth.onChange(u => console.log('auth:', u && u.uid))` を仕込むか、コンソールで:
```javascript
await App.auth.signIn(); // Googleポップアップ → ログイン
App.auth.user().uid;     // uid が表示される
```
期待: Googleのポップアップでログインでき、uid が取得できる。

- [ ] **Step 3: コミット**

```bash
git add js/auth.js
git commit -m "feat: Googleログイン(認証層)"
```

---

## Task 3: 招待コードのロジック（純粋関数＋自己テスト）

**Files:**
- Create: `js/space.js`（まず純粋ロジック部分のみ。Firestore連携はTask 4で追加）

- [ ] **Step 1: `js/space.js` にコード生成/正規化を実装**

```javascript
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, query, where, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.space = (function () {
  // 招待コード：紛らわしい文字を除いた8桁（例 ABCD-2345）
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1 を除外
  function genInviteCode() {
    let s = '';
    for (let i = 0; i < 8; i += 1) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  // 入力の正規化：大文字化・英数字以外除去（ハイフンや空白を無視して比較できる）
  function normalizeCode(input) {
    return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  App.space._selfTest = function () {
    const eq = (n, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, got);
    const c = genInviteCode();
    eq('format', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c), true);
    eq('no-ambiguous', /[IO01]/.test(c.replace('-', '')), false);
    eq('normalize-hyphen', normalizeCode('abcd-2345'), 'ABCD2345');
    eq('normalize-space', normalizeCode(' ab cd 23 '), 'ABCD23');
    eq('match', normalizeCode('abcd-2345') === normalizeCode('ABCD2345'), true);
  };

  return { genInviteCode, normalizeCode };
})();
export const space = App.space;
```

- [ ] **Step 2: 自己テストを実行**

`http://localhost:8137/` を開き、コンソールで:
```javascript
App.space._selfTest();
```
期待: 5行すべて `PASS`。

- [ ] **Step 3: コミット**

```bash
git add js/space.js
git commit -m "feat: 招待コードの生成・正規化と自己テスト"
```

---

## Task 4: スペースの作成・参加・検索（Firestore）

**Files:**
- Modify: `js/space.js`

- [ ] **Step 1: `js/space.js` に Firestore 連携を追加（return に公開を追加）**

`App.space` のIIFE内、`normalizeCode` の下に追加し、`return` を差し替え:
```javascript
  const SPACES = 'spaces';

  // 自分が member のスペースを1件返す（なければ null）
  async function findMySpace(uid) {
    const q = query(collection(fb.db, SPACES), where('members', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // 新規スペース作成（作成者を member に）
  async function createSpace(uid) {
    const id = 'space_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const inviteCode = genInviteCode();
    await setDoc(doc(fb.db, SPACES, id), {
      members: [uid], inviteCode, createdAt: Date.now(),
    });
    return { id, members: [uid], inviteCode };
  }

  // 招待コードで参加（コード一致のスペースに uid を追加）。成功でスペース、失敗で null
  async function joinSpace(uid, codeInput) {
    const code = normalizeCode(codeInput);
    const snap = await getDocs(collection(fb.db, SPACES));
    const match = snap.docs.find((d) => normalizeCode(d.data().inviteCode) === code);
    if (!match) return null;
    await updateDoc(doc(fb.db, SPACES, match.id), { members: arrayUnion(uid) });
    const fresh = await getDoc(doc(fb.db, SPACES, match.id));
    return { id: match.id, ...fresh.data() };
  }
```
`return { genInviteCode, normalizeCode };` を次に置き換え:
```javascript
  return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace };
```

- [ ] **Step 2: セキュリティルール（Firestore）をユーザーに設定してもらう**

Firebase コンソール → Firestore → ルール に貼って公開:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /spaces/{spaceId} {
      allow read: if request.auth != null
        && request.auth.uid in resource.data.members;
      allow create: if request.auth != null
        && request.auth.uid in request.resource.data.members;
      // 参加：members に自分を追加する更新のみ許可（コード照合はクライアントで実施）
      allow update: if request.auth != null
        && request.auth.uid in request.resource.data.members;
      match /records/{recordId} {
        allow read, write: if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/spaces/$(spaceId)).data.members;
      }
    }
  }
}
```
> 注: 参加時のコード照合はクライアントで行う簡易方式。二人だけの私的用途では十分だが、より厳密にするなら将来 Cloud Functions で照合する（スコープ外）。

- [ ] **Step 3: 手動確認（Firebase設定後）**

ログイン済みでコンソール:
```javascript
const uid = App.auth.user().uid;
const s = await App.space.createSpace(uid);   // 作成
s.inviteCode;                                  // コード表示
(await App.space.findMySpace(uid)).id === s.id; // true
```
期待: 作成でき、findMySpace が同じスペースを返す。別アカウントで `joinSpace(uid2, s.inviteCode)` すると members が2人になる。

- [ ] **Step 4: コミット**

```bash
git add js/space.js
git commit -m "feat: スペースの作成/参加/検索(Firestore)"
```

---

## Task 5: 認証・スペースのゲートUI

**Files:**
- Create: `js/gate.js`
- Modify: `index.html`（ゲートDOM追加）
- Modify: `style.css`（ゲートのスタイル）

- [ ] **Step 1: `index.html` にゲートDOMを追加（`<body>` 直後、`#topbar` の前）**

```html
  <div id="gate" hidden>
    <div class="gate-card">
      <h1 class="gate-title">デート記録</h1>
      <!-- 未ログイン -->
      <div id="gate-login" hidden>
        <p class="gate-lead">二人の思い出を地図に残そう</p>
        <button id="gate-google" class="gate-btn primary"><i class="ph ph-google-logo"></i>Googleでログイン</button>
      </div>
      <!-- ログイン済み・未所属 -->
      <div id="gate-space" hidden>
        <p class="gate-lead">スペースを作るか、招待コードで参加してください</p>
        <button id="gate-create" class="gate-btn primary">新しくスペースを作る</button>
        <div class="gate-or">または</div>
        <div class="gate-join">
          <input id="gate-code" type="text" placeholder="招待コード（例 ABCD-2345）">
          <button id="gate-join-btn" class="gate-btn">参加する</button>
        </div>
        <p id="gate-msg" class="gate-msg"></p>
      </div>
      <!-- 作成後：招待コード表示 -->
      <div id="gate-invite" hidden>
        <p class="gate-lead">スペースを作成しました。相手にこのコードを渡してください：</p>
        <div id="gate-invite-code" class="gate-code"></div>
        <button id="gate-start" class="gate-btn primary">はじめる</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: `js/gate.js` を作成**

```javascript
import { auth } from './auth.js';
import { space } from './space.js';

window.App = window.App || {};
App.gate = (function () {
  let onReady = null;      // (space) => void  スペース確定時に呼ぶ
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { $(id).hidden = !on; };

  function showGate(which) {
    show('gate', true);
    show('gate-login', which === 'login');
    show('gate-space', which === 'space');
    show('gate-invite', which === 'invite');
  }
  function hideGate() { show('gate', false); }

  async function afterLogin(user) {
    const mine = await space.findMySpace(user.uid);
    if (mine) { hideGate(); if (onReady) onReady(mine); return; }
    showGate('space');
  }

  function init(readyCb) {
    onReady = readyCb;
    $('gate-google').onclick = () => auth.signIn().catch((e) => alert('ログイン失敗: ' + e.message));
    $('gate-create').onclick = async () => {
      const s = await space.createSpace(auth.user().uid);
      $('gate-invite-code').textContent = s.inviteCode;
      showGate('invite');
      $('gate-start').onclick = () => { hideGate(); if (onReady) onReady(s); };
    };
    $('gate-join-btn').onclick = async () => {
      const s = await space.joinSpace(auth.user().uid, $('gate-code').value);
      if (!s) { $('gate-msg').textContent = 'コードが違います'; return; }
      hideGate(); if (onReady) onReady(s);
    };
    auth.onChange((user) => {
      if (!user) { showGate('login'); return; }
      afterLogin(user);
    });
  }

  return { init, showGate, hideGate };
})();
export const gate = App.gate;
```

- [ ] **Step 3: `style.css` にゲートのスタイルを追加（末尾に）**

```css
#gate { position: fixed; inset: 0; z-index: 3000; background: var(--bg);
  display: flex; align-items: center; justify-content: center; padding: 24px; }
#gate[hidden] { display: none; }
.gate-card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow-md);
  padding: 28px 24px; width: 100%; max-width: 380px; text-align: center; }
.gate-title { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
.gate-lead { color: var(--text-muted); font-size: 14px; margin: 0 0 18px; line-height: 1.6; }
.gate-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 12px 16px; border-radius: var(--radius-sm); font-size: 15px; font-weight: 600;
  background: var(--surface-2); color: var(--text); margin-top: 8px; }
.gate-btn.primary { background: var(--accent); color: #fff; }
.gate-btn.primary:hover { background: var(--accent-strong); }
.gate-or { color: var(--text-muted); font-size: 12px; margin: 16px 0 8px; }
.gate-join { display: flex; gap: 8px; }
.gate-join input { flex: 1; }
.gate-msg { color: var(--accent-strong); font-size: 13px; min-height: 18px; margin: 10px 0 0; }
.gate-code { font-size: 24px; font-weight: 700; letter-spacing: .12em; color: var(--accent-strong);
  background: var(--accent-soft); border-radius: var(--radius-sm); padding: 14px; margin: 8px 0 16px; }
```

- [ ] **Step 4: 手動確認は Task 8（app.js統合）で通して行う。ここでは構文のみ**

`node --check js/gate.js js/space.js js/auth.js js/firebaseInit.js`（ESモジュールでも構文チェック可）
期待: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add js/gate.js index.html style.css
git commit -m "feat: 認証/スペースのゲートUI"
```

---

## Task 6: 写真の圧縮ロジック（純粋関数＋自己テスト）

**Files:**
- Create: `js/photos.js`（まず寸法計算の純粋関数と圧縮。アップロードはTask 7）

- [ ] **Step 1: `js/photos.js` に縮小寸法計算と圧縮を実装**

```javascript
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.photos = (function () {
  const MAX_EDGE = 1600;
  const QUALITY = 0.8;

  // 元の(w,h)を長辺MAX_EDGEに収める寸法を返す（拡大はしない）
  function fitSize(w, h, maxEdge) {
    const longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return { w, h };
    const scale = maxEdge / longEdge;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  // File/Blob → 圧縮JPEG Blob
  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, MAX_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('compress失敗'))), 'image/jpeg', QUALITY);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込み失敗')); };
      img.src = url;
    });
  }

  App.photos._selfTest = function () {
    const eq = (n, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    eq('landscape', fitSize(4000, 3000, 1600), { w: 1600, h: 1200 });
    eq('portrait', fitSize(3000, 4000, 1600), { w: 1200, h: 1600 });
    eq('small-nogrow', fitSize(800, 600, 1600), { w: 800, h: 600 });
    eq('square', fitSize(2000, 2000, 1600), { w: 1600, h: 1600 });
  };

  return { fitSize, compress };
})();
export const photos = App.photos;
```

- [ ] **Step 2: 自己テストを実行**

コンソールで:
```javascript
App.photos._selfTest();
```
期待: 4行すべて `PASS`。

- [ ] **Step 3: コミット**

```bash
git add js/photos.js
git commit -m "feat: 写真の縮小寸法計算・圧縮と自己テスト"
```

---

## Task 7: 写真アップロード / 削除（Storage）

**Files:**
- Modify: `js/photos.js`
- Storage ルール（ユーザー設定）

- [ ] **Step 1: `js/photos.js` にアップロード/削除を追加（return に公開追加）**

`compress` の下に追加:
```javascript
  // 圧縮 → Storage へ。{ path, url } を返す
  async function upload(spaceId, recordId, file) {
    const blob = await compress(file);
    const photoId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const path = `spaces/${spaceId}/${recordId}/${photoId}.jpg`;
    const r = ref(fb.storage, path);
    await uploadBytes(r, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(r);
    return { path, url };
  }
  async function uploadMany(spaceId, recordId, files) {
    const out = [];
    for (const f of files) out.push(await upload(spaceId, recordId, f)); // 直列で確実に
    return out;
  }
  async function removeByPath(path) {
    try { await deleteObject(ref(fb.storage, path)); } catch (e) { /* 既に無い場合は無視 */ }
  }
```
`return { fitSize, compress };` を次に置き換え:
```javascript
  return { fitSize, compress, upload, uploadMany, removeByPath };
```

- [ ] **Step 2: Storage ルールをユーザーに設定してもらう**

Firebase コンソール → Storage → Rules:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /spaces/{spaceId}/{allPaths=**} {
      allow read, write: if request.auth != null
        && request.auth.uid in
          firestore.get(/databases/(default)/documents/spaces/$(spaceId)).data.members;
    }
  }
}
```

- [ ] **Step 3: 手動確認（Firebase設定後）**

ログイン＋スペースありの状態でコンソール:
```javascript
const sid = (await App.space.findMySpace(App.auth.user().uid)).id;
const resp = await fetch('/S__65019910.jpg'); const file = await resp.blob();
const p = await App.photos.upload(sid, 'testrec', file);
p.url.startsWith('https://'); // true。ブラウザで p.url を開くと縮小画像が表示される
await App.photos.removeByPath(p.path); // 後始末
```
期待: アップロードで `{path,url}` が返り、url が開ける。Storage コンソールにファイルができ、削除で消える。

- [ ] **Step 4: コミット**

```bash
git add js/photos.js
git commit -m "feat: 写真の圧縮アップロード/削除(Storage)"
```

---

## Task 8: 記録のデータ層（Firestore CRUD＋購読）と app.js 統合

**Files:**
- Create: `js/cloud.js`
- Modify: `js/app.js`（module化・統合）
- Modify: `js/records.js`（`App.db` 参照を `App.cloud` に）

- [ ] **Step 1: `js/cloud.js` を作成**

```javascript
import {
  collection, doc, addDoc, setDoc, deleteDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.cloud = (function () {
  let spaceId = null;
  let unsub = null;

  function col() { return collection(fb.db, 'spaces', spaceId, 'records'); }

  function setSpace(id) { spaceId = id; }

  // 記録一覧をリアルタイム購読。変化のたび cb(records[]) を呼ぶ
  function subscribe(cb) {
    if (unsub) unsub();
    unsub = onSnapshot(col(), (snap) => {
      const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      cb(records);
    });
  }

  async function add(record) {
    const ref = await addDoc(col(), { ...record, createdAt: Date.now(), updatedAt: Date.now() });
    return ref.id;
  }
  async function put(record) {
    const { id, ...rest } = record;
    await setDoc(doc(col(), id), { ...rest, updatedAt: Date.now() }, { merge: true });
  }
  async function remove(id) { await deleteDoc(doc(col(), id)); }

  return { setSpace, subscribe, add, put, remove, _spaceId: () => spaceId };
})();
export const cloud = App.cloud;
```

- [ ] **Step 2: `js/records.js` のデータ源を差し替え**

`records.js` 内の記録取得は、これまで `reload()` が `App.db.getAll()` を呼んでいた。購読方式に変えるため、`reload` を「外部から渡された records を受け取る」形にする。次の2箇所を変更:

`reload` を置き換え:
```javascript
  // 旧: async reload(){ all = await App.db.getAll(); render(); }
  function setRecords(records) { all = records; render(); }
  async function reload() { render(); } // 互換用（購読が最新を供給）
```
`return { ... }` に `setRecords` を追加（既存の公開はそのまま）:
```javascript
  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, _clearPanel: clearPanel };
```
> 注: `App.db.add/put/remove` を呼んでいた箇所（showAddForm/showEditForm/削除/moveSpot）は Task 9 で `App.cloud` と写真アップロードに合わせて変更する。まずこの Task では読み取り（購読→setRecords）を通す。

- [ ] **Step 3: `js/app.js` を module 化して全体を統合**

`js/app.js` を次で置き換え（既存の地図クリック検索/ビュー切替/現在地などの初期化は残しつつ、認証ゲート後に初期化する形に）:
```javascript
import { gate } from './gate.js';
import { cloud } from './cloud.js';

function startApp(space) {
  cloud.setSpace(space.id);
  App.map.init();
  App.records.init();
  App.sheet.init();
  cloud.subscribe((records) => App.records.setRecords(records)); // リアルタイム反映

  // 既存のUI配線（ビュー切替・現在地・検索・絞り込み・バックアップ）
  App.wireUI(); // ← 既存の配線を関数化して呼ぶ（Step 4）
}

document.addEventListener('DOMContentLoaded', () => {
  gate.init((space) => startApp(space));
});
```

- [ ] **Step 4: 既存のUI配線を `App.wireUI()` に切り出す**

これまで `app.js` の DOMContentLoaded 内に直書きしていた「ビュー切替・絞り込み開閉・現在地・検索・バックアップ」の配線を、`js/records.js` の末尾（または新規 `js/ui.js`）に `App.wireUI = function(){ ... }` として移し、`startApp` から呼ぶ。移動対象は現行 app.js の該当ブロックそのまま（`mapBtn`, `calBtn`, `filterToggle`, `locateBtn`, `search`, `export/import` の配線）。
> 実装者へ: 現行 `app.js` の DOMContentLoaded 内の配線コードを丸ごと `App.wireUI` に包み、DOM参照はそのまま使う。`App.records.init()` / `App.map.init()` / `App.sheet.init()` は `startApp` 側で呼ぶのでここには含めない。

- [ ] **Step 5: 手動確認（Firebase設定後）**

`http://localhost:8137/` を開く:
1. ログイン画面 → Googleログイン。
2. 未所属なら「スペースを作る」→ 招待コード表示 →「はじめる」→ 通常画面（地図）が出る。
3. コンソールで手動追加して即反映を確認:
```javascript
const sid = App.cloud._spaceId();
await App.cloud.add({date:'2026-08-02', name:'手動テスト', genre:'cafe', lat:34.70,lng:135.50, memo:'', tags:[], order:0, photos:[]});
```
期待: 地図にピンが自動で出る（購読で反映）。別端末で同じスペースに参加していれば、そちらにも出る。

- [ ] **Step 6: コミット**

```bash
git add js/cloud.js js/app.js js/records.js
git commit -m "feat: 記録データ層(Firestore)＋購読とapp統合"
```

---

## Task 9: 追加・編集・削除を Firestore＋写真アップロードに接続

**Files:**
- Modify: `js/records.js`

- [ ] **Step 1: 追加フォーム送信を差し替え**

`showAddForm` の submit ハンドラ内、写真は File のまま集め、圧縮アップロードして `{path,url}[]` を保存する。該当ブロックを次に:
```javascript
    document.getElementById('rec-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const files = Array.from(f.photos.files);
      const order = all.filter((r) => r.date === f.date.value).length;
      const submitBtn = f.querySelector('button[type=submit]');
      submitBtn.disabled = true; submitBtn.textContent = '保存中…';
      try {
        // 先に記録を作成（recordId を得て写真をそのIDの下に置く）
        const id = await App.cloud.add({
          date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order,
          lat, lng, photos: [],
        });
        if (files.length) {
          const uploaded = await App.photos.uploadMany(App.cloud._spaceId(), id, files);
          await App.cloud.put({ id, date: f.date.value, name: f.name.value, genre: f.genre.value,
            memo: f.memo.value, tags: parseTags(f.tags.value), order, lat, lng, photos: uploaded });
        }
        clearPanel();
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
        submitBtn.disabled = false; submitBtn.textContent = '保存';
      }
    };
```
> 購読が最新を供給するため、保存後の `reload()` は不要（onSnapshot が反映）。

- [ ] **Step 2: 編集フォーム送信を差し替え（既存写真は{path,url}、追加はFile）**

`showEditForm` を写真の型に合わせて更新。既存写真の表示は `blob` ではなく `url` を使い、削除は `keep`（{path,url}[]）から外す。submit で新規Fileをアップロードし、外した既存写真は Storage からも削除:
```javascript
  function showEditForm(record) {
    const keep = (record.photos || []).slice(); // {path,url}[]
    panel().innerHTML = `
      <h2>記録を編集</h2>
      <form id="edit-form">
        <label>日付<input type="date" name="date" value="${record.date}" required></label>
        <label>場所名<input type="text" name="name" value="${(record.name||'').replace(/"/g,'&quot;')}" required></label>
        <label>ジャンル<select name="genre">${genreOptions(record.genre)}</select></label>
        <label>メモ・感想<textarea name="memo" rows="4">${record.memo || ''}</textarea></label>
        <label>ハッシュタグ<input type="text" name="tags" value="${tagsToInput(record.tags)}" placeholder="#カフェ #記念日"></label>
        <label>今の写真（×で削除）</label>
        <div id="existing-photos" class="photos"></div>
        <label>写真を追加<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="form-actions">
          <button type="submit">更新</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;
    const removed = [];
    const box = document.getElementById('existing-photos');
    function renderExisting() {
      if (!keep.length) { box.innerHTML = '<span class="hint">写真なし</span>'; return; }
      box.innerHTML = keep.map((p, i) =>
        `<div class="photo-edit"><img class="thumb" src="${p.url}" alt="">
          <button type="button" class="photo-del" data-i="${i}"><i class="ph ph-x"></i></button></div>`).join('');
      box.querySelectorAll('.photo-del').forEach((btn) => {
        btn.onclick = () => { removed.push(keep.splice(Number(btn.dataset.i), 1)[0]); renderExisting(); };
      });
    }
    renderExisting();
    document.getElementById('cancel-btn').onclick = () => showDetail(record);
    document.getElementById('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '更新中…';
      try {
        const newFiles = Array.from(f.photos.files);
        const uploaded = newFiles.length
          ? await App.photos.uploadMany(App.cloud._spaceId(), record.id, newFiles) : [];
        await App.cloud.put({
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: record.lat, lng: record.lng, photos: keep.concat(uploaded),
        });
        for (const p of removed) await App.photos.removeByPath(p.path); // 外した写真をStorageから削除
        showDetail({ ...record, name: f.name.value, date: f.date.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), photos: keep.concat(uploaded) });
      } catch (err) {
        alert('更新に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '更新';
      }
    };
  }
```

- [ ] **Step 3: 削除で写真も消す**

`showDetail` の削除ハンドラを、記録削除＋写真Storage削除に:
```javascript
    document.getElementById('del-btn').onclick = async () => {
      if (!confirm(`「${record.name}」を削除しますか？`)) return;
      for (const p of (record.photos || [])) await App.photos.removeByPath(p.path);
      await App.cloud.remove(record.id);
      clearPanel();
    };
```

- [ ] **Step 4: moveSpot（順番入れ替え）を cloud.put に**

`moveSpot` 内の `App.db.put(arr[k])` を `App.cloud.put(arr[k])` に変更し、末尾の `await reload()` は削除（購読が反映）:
```javascript
  async function moveSpot(list, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const arr = list.slice();
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    for (let k = 0; k < arr.length; k += 1) {
      if (arr[k].order !== k) { arr[k].order = k; await App.cloud.put(arr[k]); }
    }
  }
```

- [ ] **Step 5: 手動確認（Firebase設定後）**

1. 地図クリック → 写真を選んで保存 → 「保存中…」の後、ピンが立つ。
2. ピン → 詳細（写真表示）→ 編集で写真を1枚×→更新 → 反映。Storage から該当ファイルが消えている。
3. 削除 → ピン消滅、Storage の写真も消える。
4. 別端末（同スペース）で 1〜3 が反映される。

- [ ] **Step 6: コミット**

```bash
git add js/records.js
git commit -m "feat: 追加/編集/削除をFirestore＋写真アップロードに接続"
```

---

## Task 10: 表示側（詳細・ピン・カレンダー・拡大）の URL 対応

**Files:**
- Modify: `js/records.js`（詳細・検索候補の写真）
- Modify: `js/map.js`
- Modify: `js/calendar.js`
- Modify: `js/lightbox.js`

- [ ] **Step 1: `records.js` の詳細の写真表示を url に**

`showDetail` のサムネイル生成を差し替え:
```javascript
    const photosHtml = (record.photos || []).map((p, i) =>
      `<img class="thumb" src="${p.url}" alt="" data-i="${i}">`).join('');
```
サムネイルのクリックは lightbox に URL 配列を渡す:
```javascript
    panel().querySelectorAll('.photos .thumb[data-i]').forEach((img) => {
      img.onclick = () => App.lightbox.open((record.photos || []).map((p) => p.url), Number(img.dataset.i));
    });
```
検索候補 `showSearchResults` のサムネイルも `g.photo`（Task変更）ではなく url を使う。`searchByName` の `firstPhotoAt` は `{path,url}` を返すよう調整し、`showSearchResults` は `g.photo.url` を使用:
```javascript
  function firstPhotoAt(lat, lng) {
    const v = visitsAt(lat, lng).find((x) => (x.photos || []).length);
    return v ? v.photos[0] : null; // {path,url} or null
  }
```
`showSearchResults` のサムネイル:
```javascript
      const thumb = g.photo
        ? `<span class="result-thumb" style="background-image:url(${g.photo.url})"></span>`
        : `<span class="result-thumb" style="background:${App.genres.color(r.genre)}"></span>`;
```

- [ ] **Step 2: `map.js` の写真ピンを url に**

`markerFor` の写真分岐を、`URL.createObjectURL` ではなく url を使うよう変更:
```javascript
    const photo = (r.photos || [])[0]; // {path,url} or undefined
    ...
    if (photo) {
      return L.marker([r.lat, r.lng], {
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: '',
          html: `<div class="photo-pin">`
            + `<img class="pin-img" src="${photo.url}" style="border-color:${color}">`
            + badge
            + `<span class="pin-tail" style="border-top-color:${color}"></span>`
            + `</div>`,
          iconSize: [62, 74], iconAnchor: [31, 74],
        }),
      });
    }
```

- [ ] **Step 3: `calendar.js` の日セル背景を url に**

`cellHtml` の写真選択を差し替え:
```javascript
    const photo = recs.map((r) => (r.photos || [])[0]).find(Boolean); // {path,url} or undefined
    if (photo) {
      return `<button type="button" class="cal-cell has-photo" data-date="${dateStr}" `
        + `style="background-image:url(${photo.url})">`
        + `<span class="cal-num on-photo">${dayNum}</span>${badge}</button>`;
    }
```

- [ ] **Step 4: `lightbox.js` を URL 配列で受けるように**

`open(photos, startIndex)` の `photos` を Blob配列から **URL文字列配列**に変更。`urls` は変換不要でそのまま使い、`close` での `revokeObjectURL` は不要に:
```javascript
  function open(urlList, startIndex) {
    close();
    urls = (urlList || []).slice();
    if (!urls.length) return;
    idx = Math.min(Math.max(startIndex || 0, 0), urls.length - 1);
    ensureOverlay().hidden = false;
    document.addEventListener('keydown', keyHandler);
    show();
  }
  function close() {
    if (overlay) overlay.hidden = true;
    document.removeEventListener('keydown', keyHandler);
    urls = [];
  }
```
> 呼び出し側（詳細）は Step 1 で url 配列を渡すよう変更済み。

- [ ] **Step 5: 手動確認（Firebase設定後）**

1. 写真つき記録：地図ピンがその写真、詳細サムネイル、カレンダー日セル背景、拡大表示（スワイプ）すべて表示される。
2. リロードしても表示される（url はクラウド由来）。

- [ ] **Step 6: コミット**

```bash
git add js/records.js js/map.js js/calendar.js js/lightbox.js
git commit -m "feat: 表示側を写真URLベースに対応"
```

---

## Task 11: バックアップ整理・ログアウト・仕上げ

**Files:**
- Modify: `js/backup.js`
- Modify: `js/records.js` または `index.html`（ログアウト・招待コード再表示）

- [ ] **Step 1: `backup.js` のエクスポートを url ベースに**

写真は Blob ではなく `{path,url}` を持つため、エクスポートは記録メタデータ（写真は url を含む）をそのまま JSON 化する簡易版に:
```javascript
window.App = window.App || {};
App.backup = (function () {
  async function exportJson() {
    const records = App.records.getAll();
    const blob = new Blob([JSON.stringify({ version: 2, records }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `date-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  // v2 は「メタデータの控え」。写真本体はクラウド(Storage)にあるため url 参照。
  function importJson() { alert('クラウド版では読み込み復元は行いません（控え用の書き出しのみ）。'); }
  return { exportJson, importJson };
})();
```
> インポート復元はクラウドが一次保存のため対象外（スコープ外）。読み込みボタンは表示のままでも良いが、押下時に上記の案内を出す。

- [ ] **Step 2: 設定（ログアウト・招待コード再表示）を追加**

`#backup-bar` の隣（絞り込みパネル内）に設定ボタンを追加（`index.html`）:
```html
      <button id="logout-btn"><i class="ph ph-sign-out"></i><span>ログアウト</span></button>
      <button id="show-invite-btn"><i class="ph ph-user-plus"></i><span>招待コード</span></button>
```
`App.wireUI()` 内で配線:
```javascript
  document.getElementById('logout-btn').addEventListener('click', () => App.auth.logout());
  document.getElementById('show-invite-btn').addEventListener('click', async () => {
    const s = await App.space.findMySpace(App.auth.user().uid);
    alert('招待コード：' + (s ? s.inviteCode : '不明'));
  });
```
> ログアウトすると `auth.onChange` が発火し、ゲート（ログイン画面）に戻る。

- [ ] **Step 3: 手動確認（Firebase設定後）**

1. 書き出し → JSON がダウンロードされ、records が入っている（写真は url）。
2. 「招待コード」→ コードが表示される。
3. 「ログアウト」→ ログイン画面に戻る。再ログインで記録が復帰。

- [ ] **Step 4: コミット**

```bash
git add js/backup.js index.html
git commit -m "feat: バックアップ整理・ログアウト・招待コード再表示"
```

---

## Task 12: 公開反映と最終確認

**Files:** なし（デプロイ）

- [ ] **Step 1: main に push**

```bash
git push origin main
```

- [ ] **Step 2: 本番（GitHub Pages）で二人分の通し確認**

`https://tktk-h.github.io/maprecord/` を2端末で開く:
1. 端末A：ログイン → スペース作成 → 招待コードを取得。
2. 端末B：ログイン → 招待コードで参加。
3. Aで記録追加（写真つき）→ Bの地図に反映。
4. Bで編集 → Aに反映。削除も同様。
5. 写真の圧縮サイズ（Storageコンソールで数百KB程度）を確認。
6. 別日ログインしても記録が残っている（永続）ことを確認。

---

## 完了条件（Definition of Done）
- Googleログインし、スペース作成/招待コード参加で二人が同じ記録を共有できる。
- 記録の追加/編集/削除がクラウドに保存され、もう一方の端末にリアルタイム反映される。
- 写真は圧縮されて Storage に保存され、地図/詳細/カレンダー/拡大で URL 表示される。編集/削除で Storage からも消える。
- リロード・別日・別端末でもデータが消えない（永続）。
- 本番（GitHub Pages）で二人分の通し確認が通る。
