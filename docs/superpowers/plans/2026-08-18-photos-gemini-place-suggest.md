# Geminiで店名を自動提案（フェーズ3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **別チャットでの引き継ぎ用メモ:** この計画は単体で読めるように書いてある。前提＝フェーズ1(写真Cloud Storage)・フェーズ2(一括アップロード＋自動グループ化＋確認UI `js/bulk.js`)は**本番稼働済み**。関連spec: `docs/superpowers/specs/2026-08-18-photos-gemini-place-suggest-design.md`。アプリはGitHub Pages(`git push`で本番)＋Firebase(project `map--record`, Blazeプラン)。デプロイ毎に `index.html` の `?v=` を上げる。

**Goal:** 一括確認画面（`js/bulk.js`）を開いた時に、各グループの代表写真＋近くの店候補を Gemini に渡して店名を自動で下書きし、候補チップで選び直せるようにする。

**Architecture:** 初のバックエンド＝Firebase Cloud Function 1つ(`suggestPlace`、callable、Geminiキー保持、ログイン必須)。フロント(`bulk.js`)が `App.places.nearbyPlaces` で近くの候補を取り、代表写真のサムネ(base64)＋候補を関数に送る。関数は Gemini(Flash) に「どの候補？該当なしは-1」と聞いて placeId を返す。位置のあるグループは開いた時に自動、編集で増えたカードは手動ボタン。

**Tech Stack:** バニラJS(classicスクリプト＋`App.*`), Firebase(Auth/Firestore/Storage/**Functions 新規**), Cloud Functions v2 (Node 20, `firebase-functions`), Gemini API 無料ティア(`@google/generative-ai`), Firebase CLI。自動テストランナー無し→純粋関数は限定的、本体は本人の実機確認。

---

## テスト方針
- バックエンドの本体（Gemini呼び出し）と統合は**認証＋ライブGemini**が要るので**実機確認が中心**。純粋関数（`blobToBase64`, `aiAreaHtml` の分岐）はコードレビュー＋devtools目視。
- 各コード変更後に `node --check`（構文）＋本番デプロイ後の実機確認をステップに含める。

## File Structure
- **Create** `functions/package.json` — Cloud Functions の依存（firebase-functions, @google/generative-ai）。
- **Create** `functions/index.js` — `suggestPlace` callable 関数（Geminiだけ叩く）。
- **Create** `functions/.gitignore` — `node_modules/` を無視。
- **Modify** `firebase.json` — `functions` セクション追加。
- **Modify** `js/firebaseInit.js` — Functions SDK 追加＋`App.fb.suggestPlace`(callable) 公開。
- **Modify** `js/bulk.js` — AI提案の配線（候補取得・サムネ生成・関数呼び出し・反映・候補チップUI・自動/手動トリガー）。
- **Modify** `style.css` — 候補チップ・AI判定中・スピナーのスタイル。
- **Modify** `index.html` — `?v=` と `.app-ver` を上げる。

**再利用する既存API:** `App.places.nearbyPlaces(lat,lng,{radius,max})`→`[{placeId,name,lat,lng,genre}]` / `App.photos.compressToBlob(file, edge)`→`Blob`(フェーズ1) / `App.fb`(firebaseInit) / `bulk.js` の `groups`/`cardHtml`/`renderReview`/`wireCards`/`groupLatLng`/`refreshSaveButton`/`esc`。

---

### Task 1: 安全網（タグ＋ブランチ）

**Files:** なし（git操作）

- [ ] **Step 1: クリーン確認**

Run:
```bash
git status --porcelain
```
Expected: 出力なし。

- [ ] **Step 2: 復元タグ＋ブランチ**

```bash
git tag pre-gemini-suggest && git switch -c feature/gemini-place-suggest
```
Expected: `Switched to a new branch 'feature/gemini-place-suggest'`

- [ ] **Step 3: 確認**

```bash
git branch --show-current
```
Expected: `feature/gemini-place-suggest`

---

### Task 2: Cloud Function `suggestPlace` を作る（デプロイは Task 3）

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.js`
- Create: `functions/.gitignore`
- Modify: `firebase.json`

- [ ] **Step 1: `functions/package.json` を作成**

```json
{
  "name": "functions",
  "description": "Cloud Functions for maprecord",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-functions": "^5.0.0",
    "@google/generative-ai": "^0.21.0"
  },
  "private": true
}
```

- [ ] **Step 2: `functions/.gitignore` を作成**

```
node_modules/
```

- [ ] **Step 3: `functions/index.js` を作成**

Gemini の鍵はソースに書かず**シークレット `GEMINI_KEY`**（Task 3 で設定）から読む。ログイン必須。画像＋候補リストを渡し、番号(0〜)で返答させ、placeId に変換して返す。

```js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

exports.suggestPlace = onCall(
  { secrets: [GEMINI_KEY], region: 'us-central1', timeoutSeconds: 20 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'login required');
    const data = req.data || {};
    const imageBase64 = data.imageBase64;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!imageBase64 || !candidates.length) return { placeId: null };

    const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const list = candidates.map((c, i) => `${i}: ${c.name}`).join('\n');
    const prompt =
      'この写真は、あるお店/施設で撮られたものです。看板・ロゴ・料理・内装などから判断して、'
      + '次の候補のうち写真に最も合うものの「番号」だけを返してください。'
      + 'どれも当てはまらなければ -1。番号以外の文字は書かないでください。\n候補:\n' + list;

    let text = '';
    try {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        prompt,
      ]);
      text = (result.response.text() || '').trim();
    } catch (e) {
      console.error('gemini error', e && e.message);
      return { placeId: null }; // 失敗は「該当なし」に落とす（保存は止めない）
    }
    const m = text.match(/-?\d+/);
    const idx = m ? parseInt(m[0], 10) : -1;
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) {
      return { placeId: candidates[idx].placeId };
    }
    return { placeId: null };
  }
);
```

- [ ] **Step 4: `firebase.json` に functions を追加**

現在:
```json
{
  "storage": {
    "rules": "storage.rules"
  }
}
```
を次に置き換え:
```json
{
  "storage": {
    "rules": "storage.rules"
  },
  "functions": {
    "source": "functions"
  }
}
```

- [ ] **Step 5: 構文チェック**

Run:
```bash
node --check functions/index.js
```
Expected: エラーなし（`@google/generative-ai` は require するだけで実行しないので、node_modules 未インストールでも `--check` は通る）。

- [ ] **Step 6: コミット**

```bash
git add functions/package.json functions/index.js functions/.gitignore firebase.json
git commit -m "feat(functions): add suggestPlace callable (Gemini place-name pick)"
```

---

### Task 3: Geminiキー設定 ＆ 関数デプロイ（本人のCLI操作）

**Files:** なし（CLI・Google AI Studio）。この Task は **本人（人間）が実施**。エージェントは `firebase login` 等の対話・鍵取得を行わない。

- [ ] **Step 1: Gemini APIキーを取得（無料ティア）**

本人が https://aistudio.google.com/apikey を開き、**プロジェクト `map--record` で APIキーを作成**（無料ティア）。キー文字列を控える（他人に渡さない）。

- [ ] **Step 2: 依存をインストール**

リポジトリ直下で:
```bash
cd functions && npm install && cd ..
```
Expected: `node_modules/` ができる（`.gitignore` 済みでコミットされない）。

- [ ] **Step 3: キーをシークレットに登録**

```bash
firebase functions:secrets:set GEMINI_KEY
```
プロンプトに Step 1 のキーを貼る。Expected: `Created a new secret version ...`。

- [ ] **Step 4: 関数をデプロイ**

```bash
firebase deploy --only functions
```
Expected: `functions[suggestPlace(us-central1)]` が作成され `Deploy complete!`。初回は Cloud Functions/Cloud Build 等のAPI有効化を求められたら許可（Blaze前提）。

- [ ] **Step 5: デプロイ確認**

Firebaseコンソール → Functions に `suggestPlace` が出ていること。

---

### Task 4: クライアントに Functions SDK ＋ callable を公開

**Files:**
- Modify: `js/firebaseInit.js`

- [ ] **Step 1: import と公開を追加**

`js/firebaseInit.js` の import 群に functions を追加（`getStorage` の行の後）:
```js
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
```
`window.App.fb = {...}` の行を次に差し替え（`functions` と `suggestPlace` callable を追加。region は関数と同じ `us-central1` 既定なので指定不要）:
```js
const functions = getFunctions(app);
window.App.fb = {
  app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app),
  functions, suggestPlace: httpsCallable(functions, 'suggestPlace'),
};
```

- [ ] **Step 2: コミット**

```bash
git add js/firebaseInit.js
git commit -m "feat(fb): expose Functions SDK and suggestPlace callable"
```

---

### Task 5: bulk.js に AI提案のロジックを追加（UIはTask 6）

**Files:**
- Modify: `js/bulk.js`

- [ ] **Step 1: グループに AI 用フィールドを足す（生成2箇所）**

`js/bulk.js` の `handleFiles` 内、`added` を作る map（現在 `genre: 'food',` の直後の `}));`）で、`genre: 'food',` の後に3行足す。該当ブロック:
```js
      name: '',        // 店名（紐付け／手入力で入る）
      genre: 'food',
    }));
```
を次に置き換え:
```js
      name: '',        // 店名（紐付け／手入力で入る）
      genre: 'food',
      candidates: [],  // 近くの店候補（AI提案で入る）
      aiState: 'idle', // 'idle' | 'loading' | 'done'
      aiPickId: null,  // Geminiが選んだ placeId（チップの✨用）
    }));
```

同様に `doSplit` の `newG`（分割で作る新カード）。現在:
```js
      center: null, hasGps: false, placeId: null, place: null, manualLoc: null, name: '', genre: g.genre,
    };
```
を次に置き換え:
```js
      center: null, hasGps: false, placeId: null, place: null, manualLoc: null, name: '', genre: g.genre,
      candidates: [], aiState: 'idle', aiPickId: null,
    };
```

- [ ] **Step 2: AI提案のヘルパ群を追加**

`js/bulk.js` の `locStatus` 関数の直後（`function locStatus(g) {...}` の閉じ `}` の後）に、次を丸ごと追加:
```js
  // Blob → base64本体（data:...;base64, の後ろだけ）
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // カードi の DOM だけを差し替える（全再描画せず、入力フォーカスを保つ）
  function refreshCard(i) {
    const el = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(groups[i], i);
    el.replaceWith(tmp.firstElementChild);
    wireCards();
    refreshSaveButton();
  }

  // グループiにAI提案。loc=保存座標（近くの候補を取る中心）。失敗は静かに「該当なし」。
  async function aiSuggest(i, loc) {
    const g = groups[i];
    g.aiState = 'loading'; refreshCard(i);
    try {
      const cands = await App.places.nearbyPlaces(loc.lat, loc.lng, { radius: 200, max: 8 });
      g.candidates = cands || [];
      if (g.candidates.length) {
        const thumb = await App.photos.compressToBlob(g.photos[0].file, 400);
        const imageBase64 = await blobToBase64(thumb);
        const r = await App.fb.suggestPlace({
          imageBase64,
          candidates: g.candidates.map((c) => ({ placeId: c.placeId, name: c.name, genre: c.genre })),
        });
        const pid = r && r.data && r.data.placeId;
        if (pid) {
          g.aiPickId = pid;
          const c = g.candidates.find((x) => x.placeId === pid);
          // 既に名前が入っていたら上書きしない（ユーザー入力/検索を尊重）
          if (c && !(g.name && g.name.trim())) {
            g.name = c.name; g.placeId = c.placeId; g.place = { lat: c.lat, lng: c.lng };
            if (c.genre) g.genre = c.genre;
          }
        }
      }
    } catch (e) { console.warn('ai suggest failed', e && e.message); }
    g.aiState = 'done'; refreshCard(i);
  }

  // 手動ボタン：そのグループに位置があればAI提案。無ければ促す。
  async function runAiFor(i) {
    const loc = groupLatLng(groups[i]);
    if (!loc) { alert('先に位置（GPS/検索/地図ピン）を決めてください'); return; }
    await aiSuggest(i, loc);
  }

  // 開いた直後：位置があり・未提案・名前空 のグループを順にAI提案（バースト回避）
  async function autoSuggestAll() {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const loc = groupLatLng(g);
      if (loc && g.aiState === 'idle' && !(g.name && g.name.trim())) {
        await aiSuggest(i, loc); // 直列
      }
    }
  }

  // カードのAIエリア（名前欄の下）：判定中／候補チップ／手動ボタン
  function aiAreaHtml(g, i) {
    if (g.aiState === 'loading') {
      return `<div class="bulk-ai-loading"><span class="bulk-spin"></span>AI判定中…</div>`;
    }
    const cands = (g.candidates || []).slice(0, 6);
    const chips = cands.length
      ? `<div class="bulk-cands">${cands.map((c) => {
          const pick = c.placeId === g.aiPickId ? ' pick' : '';
          const sel = c.placeId === g.placeId ? ' sel' : '';
          return `<button class="bulk-cand${pick}${sel}" data-i="${i}" data-pid="${esc(c.placeId)}">`
            + `${c.placeId === g.aiPickId ? '✨ ' : ''}${esc(c.name)}</button>`;
        }).join('')}</div>`
      : '';
    return `<button class="bulk-locbtn ai" data-act="ai" data-i="${i}">✨ AIで店名を提案</button>${chips}`;
  }
```

- [ ] **Step 3: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): AI suggestion helpers (nearby+Gemini call, chips, auto/manual)"
```

---

### Task 6: bulk.js のカードUIと配線にAIを組み込む

**Files:**
- Modify: `js/bulk.js`

- [ ] **Step 1: cardHtml に AIエリアを差し込む**

`cardHtml` の名前入力の直後（`<input class="bulk-name" ...>` の行の次）に AIエリアを入れる。現在:
```js
            <input class="bulk-name" type="text" placeholder="場所の名前（必須）" value="${esc(g.name || '')}" data-i="${i}">
            <div class="bulk-locrow">
```
を次に置き換え:
```js
            <input class="bulk-name" type="text" placeholder="場所の名前（必須）" value="${esc(g.name || '')}" data-i="${i}">
            ${aiAreaHtml(g, i)}
            <div class="bulk-locrow">
```

- [ ] **Step 2: wireCards に AIボタンと候補チップの配線を足す**

`wireCards` 内の `.bulk-locbtn` の onclick を、`ai` も扱うように差し替える。現在:
```js
    list.querySelectorAll('.bulk-locbtn').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i);
        if (btn.dataset.act === 'search') openPlaceSearch(i);
        else pickLocationFor(i);
      };
    });
```
を次に置き換え:
```js
    list.querySelectorAll('.bulk-locbtn').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), act = btn.dataset.act;
        if (act === 'search') openPlaceSearch(i);
        else if (act === 'pin') pickLocationFor(i);
        else if (act === 'ai') runAiFor(i);
      };
    });
    list.querySelectorAll('.bulk-cand').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), pid = btn.dataset.pid;
        const g = groups[i];
        const c = (g.candidates || []).find((x) => x.placeId === pid);
        if (c) {
          g.name = c.name; g.placeId = c.placeId; g.place = { lat: c.lat, lng: c.lng };
          if (c.genre) g.genre = c.genre;
          refreshCard(i);
        }
      };
    });
```
> 注意：既存の `.bulk-locbtn` は `data-act="search"`/`"pin"` のみで、AIボタンは Task 5 の `aiAreaHtml` が `data-act="ai"` を付けて追加する。`else pickLocationFor` を `else if (act==='pin')` に厳密化した点に注意（挙動同じ）。

- [ ] **Step 3: 開いた時に autoSuggestAll を発火**

`handleFiles` の末尾、`renderReview();` の直後に1行足す。現在:
```js
    pending = pending.concat(groups); // 表示中の未保存カードは退避（消さない）
    groups = added;                    // 今回追加したぶんだけを表示
    renderReview();
  }
```
を次に置き換え:
```js
    pending = pending.concat(groups); // 表示中の未保存カードは退避（消さない）
    groups = added;                    // 今回追加したぶんだけを表示
    renderReview();
    autoSuggestAll();                  // 位置ありグループを順にAI提案（awaitしない）
  }
```

- [ ] **Step 4: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): wire AI area into cards, candidate chips, auto-run on open"
```

---

### Task 7: スタイル（候補チップ・AI判定中・スピナー）

**Files:**
- Modify: `style.css`

- [ ] **Step 1: CSSを追記**

`style.css` の末尾に追加（既存の bulk 系トーンに合わせる。AIアクセントは紫系）:
```css
/* --- 一括AI提案（bulk / Gemini） --- */
.bulk-ai-loading { display: flex; align-items: center; gap: 8px; margin-top: 9px;
  color: #7a63a8; font-size: 13px; font-weight: 600; }
.bulk-spin { width: 14px; height: 14px; border: 2px solid #d8cce8; border-top-color: #7a63a8;
  border-radius: 50%; display: inline-block; animation: bulk-sp 1s linear infinite; }
@keyframes bulk-sp { to { transform: rotate(360deg); } }
.bulk-locbtn.ai { border-color: #a48fc9; color: #5b4785; background: #efe9f6; margin-top: 8px; }
.bulk-cands { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 8px; }
.bulk-cand { border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit;
  border-radius: 999px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
.bulk-cand.pick { border: 1.5px solid #a48fc9; background: #efe9f6; color: #5b4785; font-weight: 700; }
.bulk-cand.sel { outline: 2px solid var(--accent-strong); outline-offset: 1px; }
```

- [ ] **Step 2: コミット**

```bash
git add style.css
git commit -m "style(bulk): candidate chips and AI loading indicator"
```

---

### Task 8: デプロイ（バージョン更新）＋実機確認

**Files:**
- Modify: `index.html`

- [ ] **Step 1: バージョンを一括更新**

`index.html` 内の全 `?v=20260816w`（※現行値。異なれば現行値に合わせる）と `.app-ver` の値を新しい値（例 `20260818a`）へ置換。`grep -n "20260816w\|app-ver" index.html` で現行値を確認してから置換。

- [ ] **Step 2: コミット**

```bash
git add index.html
git commit -m "chore: bump asset version for Gemini place-suggest"
```

- [ ] **Step 3: 本人の実機確認**（Task 3 のデプロイ完了後）

main へマージ→push で本番反映（Task 9 の仕上げ）。本番URLで：
- 「まとめて」→写真（GPSあり複数）を選ぶ → 確認画面で各カードに「**AI判定中…**」→ 少し待つと**店名が先埋め**＋**候補チップ**（✨=推し）が出る。
- 候補チップを**タップで別の店に切替**できる。
- **自信なし/該当なし**のグループは**名前が空**のまま（候補チップは出るので手で選べる）。
- 分割で増えたカードは**自動では出ず**「✨AIで店名を提案」ボタンだけ。押すと判定。
- 位置なしグループでAIボタン→「先に位置を…」と促される。
- 通信断など失敗しても**保存はできる**（AIは飛ぶだけ）。
- **未ログインでは関数を叩けない**（callableはauth必須）＝プライバシー。

- [ ] **Step 4: グループ化等の既存自己テストが無事か（回帰）**

devtoolsコンソールで `App.grouping._selfTest()` が全PASS（フェーズ2の回帰確認）。

---

### Task 9: ブランチの仕上げ

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

- [ ] **Step 1:** Task 3 のデプロイ＆Task 8 の実機確認がすべて緑であることを再確認。
- [ ] **Step 2:** finishing-a-development-branch に従い main へマージ→push（GitHub Pages 反映）。関数は Task 3 で既にデプロイ済み。
- [ ] **Step 3:** 問題があれば `git switch main` → `pre-gemini-suggest` タグへ戻して即ロールバック（フロントは戻る）。関数を止めたい場合は Firebaseコンソールで `suggestPlace` を削除 or 無効化。

---

## Self-Review（spec との突き合わせ）

**Spec coverage:**
- 構成・データフロー（nearby→関数→Gemini→placeId）→ Task 2(関数)・Task 5(`aiSuggest`) ✓
- 確認画面で全グループ自動提案 → Task 6 Step 3 `autoSuggestAll` ✓
- 編集で増えたカードは手動 → 自動条件は `aiState==='idle' && 名前空`＋分割カードは初期表示に含まれず自動ループ後に増える／手動ボタン `runAiFor` ✓
- 候補チップ（✨=推し・タップ切替）→ Task 5 `aiAreaHtml`・Task 6 チップ配線 ✓
- 自信なし→null→空欄 → 関数が -1/該当なしで `{placeId:null}`、フロントは名前据え置き ✓
- バックエンド（callable・鍵秘密・ログイン必須・Geminiだけ）→ Task 2 ✓
- サムネ生成（`compressToBlob(file,400)`→base64）→ Task 5 `aiSuggest`/`blobToBase64` ✓
- エラー/レート制限（直列・静かに該当なし・保存ブロックしない・手動リトライ）→ Task 5 `aiSuggest` try/catch＋`autoSuggestAll` 直列＋`runAiFor` ✓
- プライバシー（サムネ＋候補名のみ・無料ティア・未ログイン不可）→ Task 2 auth＋Task 8 確認 ✓
- 課金（Functions無料枠＋Blaze・新規請求ゼロ・Gemini無料）→ Task 3（Blaze前提・無料キー）✓

**Placeholder scan:** 具体コードで埋め済み。TBD等なし。

**Type consistency:** グループに `candidates/aiState/aiPickId` を追加（Task 5 の生成2箇所）。`App.fb.suggestPlace({imageBase64,candidates})`→`{data:{placeId}}` は Task 4 定義と Task 5 呼び出しで一致。`aiAreaHtml`/`refreshCard`/`aiSuggest`/`runAiFor`/`autoSuggestAll`/`blobToBase64` は Task 5 で定義し Task 6 の cardHtml/wireCards/handleFiles から参照、整合。関数の返り値キー `placeId` は Task 2(関数)・Task 5(フロント) で一致。
