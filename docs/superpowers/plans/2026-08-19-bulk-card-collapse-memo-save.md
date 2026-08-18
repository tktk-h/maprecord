# 一括カードの折りたたみ＋メモ欄＋個別保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括追加「まとめて」画面のカードを折りたたみ可能にし、メモ欄と個別保存ボタンを追加して、AIが裏で店名を推測している間もユーザーが編集・保存を進められるようにする。

**Architecture:** 変更は `js/bulk.js`（カードのデータ・生成`cardHtml`・配線`wireCards`・保存`doSave`）と `style.css` に閉じる。グループに `collapsed`/`memo` を持たせ、`cardHtml` を畳み/開きで分岐。保存処理を `saveGroup()` に抽出して「すべて保存」と「個別保存」で共用。AI更新は開いているカードだけ差分適用してメモ編集を邪魔しない。

**Tech Stack:** バニラJS（classicスクリプト＋`App.*`）、既存の `App.records`/`App.cloud`/`App.photos`。自動テストランナー無し→`node --check`（構文）＋本人の実機確認。

**関連spec:** `docs/superpowers/specs/2026-08-19-bulk-card-collapse-memo-save-design.md`

---

## テスト方針
自動テストは無い。各コード変更後に `node --check js/bulk.js`（構文）を実行し、最後にデプロイして本人が実機確認する。純粋な描画分岐なので、実機での目視が中心。

## File Structure
- **Modify** `js/bulk.js` — データ2フィールド追加、`cardHtml` 分岐、`wireCards` 配線追加、`saveGroup`/`saveOne` 追加、`doSave` のDRY化、AI差分更新。
- **Modify** `style.css` — 折りたたみヘッダー・畳み時ボタン列・個別保存ボタン・メモ欄のスタイル。
- **Modify** `index.html` — `?v=` と `.app-ver` を上げる。

**注意（クラス名衝突）:** `renderReview` のオーバーレイ見出しが既に `.bulk-head` を使用中。カードの折りたたみヘッダーには **`.bulk-cardhead`** を使う（`.bulk-head` は使わない）。

**再利用する既存関数:** `isSaveable(g)` / `missingMsg(g)` / `updateCardStatus(i)` / `locStatus(g)` / `genreOptions(g.genre)` / `aiAreaHtml(g,i)` / `refreshCard(i)` / `refreshSaveButton()` / `groupLatLng(g)` / `renderReview()` / `esc(s)` / `hhmm(t)` / `App.records.getAll()` / `App.photos.toStoredMany()` / `App.cloud.add()`。

---

### Task 1: 安全網（タグ＋ブランチ）

**Files:** なし（git操作）

- [ ] **Step 1: クリーン確認**

Run:
```bash
git status --porcelain
```
Expected: 出力なし（未コミットが無い）。あれば先にコミット。

- [ ] **Step 2: 復元タグ＋ブランチ**

```bash
git tag pre-card-collapse && git switch -c feature/bulk-card-collapse
```
Expected: `Switched to a new branch 'feature/bulk-card-collapse'`

- [ ] **Step 3: 確認**

```bash
git branch --show-current
```
Expected: `feature/bulk-card-collapse`

---

### Task 2: グループに `collapsed`/`memo` を追加（生成2箇所）

**Files:**
- Modify: `js/bulk.js`（`handleFiles` の `added` map、`doSplit` の `newG`）

- [ ] **Step 1: `handleFiles` の `added` にフィールド追加**

現在（`aiPickId: null,` の直後に `}));` がある）:
```js
      candidates: [],  // 近くの店候補（AI提案で入る）
      aiState: 'idle', // 'idle' | 'loading' | 'done'
      aiPickId: null,  // Geminiが選んだ placeId（チップの✨用）
    }));
```
を次に置き換え:
```js
      candidates: [],  // 近くの店候補（AI提案で入る）
      aiState: 'idle', // 'idle' | 'loading' | 'done'
      aiPickId: null,  // Geminiが選んだ placeId（チップの✨用）
      collapsed: true, // 既定は畳んだ状態
      memo: '',        // メモ・感想
    }));
```

- [ ] **Step 2: `doSplit` の `newG` にフィールド追加**

現在:
```js
      center: null, hasGps: false, placeId: null, place: null, manualLoc: null, name: '', genre: g.genre,
      candidates: [], aiState: 'idle', aiPickId: null,
    };
```
を次に置き換え:
```js
      center: null, hasGps: false, placeId: null, place: null, manualLoc: null, name: '', genre: g.genre,
      candidates: [], aiState: 'idle', aiPickId: null, collapsed: true, memo: '',
    };
```

- [ ] **Step 3: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): add collapsed/memo fields to groups"
```

---

### Task 3: `cardHtml` を畳み/開きで分岐＋メモ欄・個別保存ボタン

**Files:**
- Modify: `js/bulk.js`（`cardHtml` 関数と、その直前に小ヘルパ追加）

- [ ] **Step 1: 個別保存ボタンのヘルパを追加**

`function cardHtml(g, i) {` の直前に次を追加:
```js
  // 個別保存ボタン。isSaveable でない間は押せない。wide=開いた状態用の全幅。
  function saveCardBtnHtml(g, i, label, wide) {
    const ok = isSaveable(g);
    return `<button class="bulk-savecard${wide ? ' wide' : ''}${ok ? '' : ' off'}" data-i="${i}"${ok ? '' : ' disabled'}>💾 ${esc(label)}</button>`;
  }
```

- [ ] **Step 2: `cardHtml` を畳み/開き分岐に書き換え**

現在の `cardHtml` 全体（`function cardHtml(g, i) {` から対応する閉じ `}` まで）を次に置き換え:
```js
  function cardHtml(g, i) {
    const first = g.photos[0], last = g.photos[g.photos.length - 1];
    const cover = g.photos[0].url;
    const timeRange = g.photos.length > 1 ? `${hhmm(first.time)}〜${hhmm(last.time)}` : hhmm(first.time);
    const mergeBtn = i > 0 ? `<button class="bulk-act" data-act="merge" data-i="${i}">↑ 前と結合</button>` : '';

    // --- 畳んだ状態 ---
    if (g.collapsed) {
      const nameLine = g.aiState === 'loading'
        ? `<div class="bulk-ai-loading"><span class="bulk-spin"></span>AI判定中…</div>`
        : `<div class="bulk-headname${(g.name && g.name.trim()) ? '' : ' empty'}">${esc((g.name && g.name.trim()) ? g.name : '（店名未入力）')}</div>`;
      return `
      <div class="bulk-card collapsed${isSaveable(g) ? '' : ' incomplete'}" data-i="${i}">
        <div class="bulk-cardhead" data-i="${i}">
          <div class="bulk-cover sm" style="background-image:url(${cover})"></div>
          <div class="bulk-headinfo">
            ${nameLine}
            <div class="bulk-date">${g.date} <span class="bulk-count">${timeRange} ・ ${g.photos.length}枚</span></div>
            <div class="bulk-badge">${esc(missingMsg(g))}</div>
          </div>
          <span class="bulk-chev">▾</span>
        </div>
        <div class="bulk-collapsed-acts">
          ${mergeBtn}
          <button class="bulk-act warn" data-act="del" data-i="${i}">🗑 削除</button>
          ${saveCardBtnHtml(g, i, '保存')}
        </div>
      </div>`;
    }

    // --- 開いた状態 ---
    const strip = g.photos.map((p, j) =>
      `<div class="bulk-ph" data-i="${i}" data-j="${j}" style="background-image:url(${p.url})"></div>`).join('');
    return `
      <div class="bulk-card${isSaveable(g) ? '' : ' incomplete'}" data-i="${i}">
        <div class="bulk-top">
          <div class="bulk-cover" data-act="collapse" data-i="${i}" style="background-image:url(${cover})"><span>${g.photos.length}枚</span></div>
          <div class="bulk-meta">
            <div class="bulk-date">${g.date} <span class="bulk-count">${timeRange} ・ ${g.photos.length}枚</span></div>
            <div class="bulk-badge">${esc(missingMsg(g))}</div>
            <input class="bulk-name" type="text" placeholder="場所の名前（必須）" value="${esc(g.name || '')}" data-i="${i}">
            <div class="bulk-aiwrap" data-i="${i}">${aiAreaHtml(g, i)}</div>
            <div class="bulk-locrow">
              <button class="bulk-locbtn" data-act="search" data-i="${i}">🔍 店名で検索</button>
              <button class="bulk-locbtn" data-act="pin" data-i="${i}">🗺 地図でピン</button>
              <span class="bulk-locstat">${locStatus(g)}</span>
            </div>
            <div class="bulk-fields">
              <select class="bulk-genre" data-i="${i}">${genreOptions(g.genre)}</select>
              <input class="bulk-datefld" type="date" value="${g.date}" data-i="${i}">
            </div>
            <label class="bulk-memolabel">メモ・感想<textarea class="bulk-memo" rows="3" placeholder="今日はどんな一日だった？" data-i="${i}">${esc(g.memo || '')}</textarea></label>
          </div>
        </div>
        <div class="bulk-strip">${strip}</div>
        <div class="bulk-splithint">▸ 写真をタップ →「ここで分割」でその位置から下を別グループに</div>
        <div class="bulk-acts">
          ${mergeBtn}
          <button class="bulk-act" data-act="split" data-i="${i}" disabled>✂️ ここで分割</button>
          <button class="bulk-act warn" data-act="del" data-i="${i}">🗑 削除</button>
        </div>
        ${saveCardBtnHtml(g, i, 'この1件を保存', true)}
      </div>`;
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
git commit -m "feat(bulk): collapsed/expanded card variants with memo and per-card save"
```

---

### Task 4: 保存処理をDRY化（`saveGroup` 抽出）＋ `saveOne` 追加

**Files:**
- Modify: `js/bulk.js`（`doSave` の直前に `saveGroup`/`saveOne` を追加、`doSave` 内を差し替え）

- [ ] **Step 1: `saveGroup` と `saveOne` を追加**

`async function doSave() {` の直前に次を追加:
```js
  // 1グループを保存（写真アップロード→cloud.add）。order は呼び出し側が決める。
  async function saveGroup(g, order, onProgress) {
    const loc = groupLatLng(g);
    const files = g.photos.map((p) => p.file);
    const groupId = 'bulk-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6);
    const photos = await App.photos.toStoredMany(files, groupId, onProgress);
    await App.cloud.add({
      date: g.date, name: g.name || '', genre: g.genre, memo: g.memo || '', tags: [], order,
      lat: loc.lat, lng: loc.lng, photos,
      ...(g.placeId ? { placeId: g.placeId } : {}),
    });
  }

  // カードiだけを保存。成功したらそのカードを一覧から除く。
  async function saveOne(i) {
    const g = groups[i];
    if (!isSaveable(g)) return;
    const btn = document.querySelector(`.bulk-savecard[data-i="${i}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const all = App.records.getAll();
      const order = all.filter((r) => r.date === g.date).length;
      await saveGroup(g, order);
      for (const p of g.photos) URL.revokeObjectURL(p.url); // プレビューURL解放
      groups.splice(i, 1);
      if (!groups.length && pending.length) { groups = pending; pending = []; } // 退避中の前カードを表示
      renderReview();
    } catch (err) {
      console.error('save one failed', err);
      alert('保存に失敗しました。もう一度お試しください。');
      refreshCard(i); // ボタン表示を元に戻す
    }
  }
```

- [ ] **Step 2: `doSave` 内の保存ロジックを `saveGroup` 呼び出しに差し替え**

`doSave` 内の現在のブロック:
```js
      try {
        const files = g.photos.map((p) => p.file);
        const groupId = 'bulk-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6);
        const photos = await App.photos.toStoredMany(files, groupId, (n, t) => {
          saveBtn.textContent = `保存中… グループ${done + 1}/${targets.length}（写真${n}/${t}）`;
        });
        const order = all.filter((r) => r.date === g.date).length + done; // その日の末尾へ
        await App.cloud.add({
          date: g.date, name: g.name || '', genre: g.genre, memo: '', tags: [], order,
          lat: loc.lat, lng: loc.lng, photos,
          ...(g.placeId ? { placeId: g.placeId } : {}),
        });
        for (const p of g.photos) URL.revokeObjectURL(p.url); // 保存済みのプレビューURL解放
        done++;
      } catch (err) {
```
を次に置き換え:
```js
      try {
        const order = all.filter((r) => r.date === g.date).length + done; // その日の末尾へ
        await saveGroup(g, order, (n, t) => {
          saveBtn.textContent = `保存中… グループ${done + 1}/${targets.length}（写真${n}/${t}）`;
        });
        for (const p of g.photos) URL.revokeObjectURL(p.url); // 保存済みのプレビューURL解放
        done++;
      } catch (err) {
```
> 注意：`doSave` 冒頭の `const loc = groupLatLng(g);` は不要になるが、残っていても無害。残す。

- [ ] **Step 3: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add js/bulk.js
git commit -m "refactor(bulk): extract saveGroup; add saveOne (per-card save with memo)"
```

---

### Task 5: `wireCards` に開閉・メモ・個別保存の配線を追加

**Files:**
- Modify: `js/bulk.js`（`wireCards` 内、`wireStrip();` の行の直前に追加）

- [ ] **Step 1: 配線を追加**

`wireCards` 内の現在の行:
```js
    wireStrip(); // 分割の写真選択
    const save = document.getElementById('bulk-save');
    if (save) save.onclick = doSave; // Task 7
```
を次に置き換え:
```js
    list.querySelectorAll('.bulk-cardhead').forEach((h) => {
      h.onclick = () => { const i = Number(h.dataset.i); groups[i].collapsed = false; refreshCard(i); };
    });
    list.querySelectorAll('.bulk-cover[data-act="collapse"]').forEach((c) => {
      c.onclick = () => { const i = Number(c.dataset.i); groups[i].collapsed = true; refreshCard(i); };
    });
    list.querySelectorAll('.bulk-memo').forEach((t) => {
      t.oninput = () => { groups[Number(t.dataset.i)].memo = t.value; };
    });
    list.querySelectorAll('.bulk-savecard').forEach((b) => {
      b.onclick = () => saveOne(Number(b.dataset.i));
    });
    wireStrip(); // 分割の写真選択
    const save = document.getElementById('bulk-save');
    if (save) save.onclick = doSave; // Task 7
  }
```
> 注意：上の置き換えは末尾の `}`（`wireCards` の閉じ括弧）まで含める。元の `wireCards` はこの3行のあとに `}` で閉じているので、閉じ括弧を二重にしないこと。

- [ ] **Step 2: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): wire collapse toggle, memo input, and per-card save"
```

---

### Task 6: AI更新を開いているカードだけ差分適用（メモ編集を邪魔しない）

**Files:**
- Modify: `js/bulk.js`（`refreshCard` の直後に `applyAiUpdate` を追加、`aiSuggest` 内の2箇所を差し替え）

- [ ] **Step 1: `applyAiUpdate` を追加**

`refreshCard(i)` 関数（`function refreshCard(i) { ... }`）の閉じ `}` の直後に次を追加:
```js
  // AIの状態更新をカードiに反映。畳んでいるカードは全描画、開いているカードは
  // 差分更新（名前値・AIエリア・場所状態・ジャンル・枠/バッジのみ）でメモ編集を壊さない。
  function applyAiUpdate(i) {
    const g = groups[i];
    if (g.collapsed) { refreshCard(i); return; }
    const el = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!el) { refreshCard(i); return; }
    const nameInp = el.querySelector('.bulk-name');
    if (nameInp && nameInp.value !== (g.name || '')) nameInp.value = g.name || '';
    const aiwrap = el.querySelector('.bulk-aiwrap');
    if (aiwrap) aiwrap.innerHTML = aiAreaHtml(g, i);
    const locstat = el.querySelector('.bulk-locstat');
    if (locstat) locstat.innerHTML = locStatus(g);
    const genreSel = el.querySelector('.bulk-genre');
    if (genreSel) genreSel.value = g.genre;
    updateCardStatus(i); // 枠/バッジ＋個別保存ボタンのdisabledはwireCards再配線で反映
    wireCards();         // 差し替えたAIエリアのボタン/チップを再配線
    refreshSaveButton();
  }
```
> 注意：個別保存ボタンの有効/無効（`.off`/`disabled`）は `aiAreaHtml` の外なので差分更新では切り替わらない。名前が空→AIで埋まった時にボタンを有効化するため、`updateCardStatus(i)` の末尾でボタンも更新する（次ステップ）。

- [ ] **Step 2: `updateCardStatus` に個別保存ボタンの更新を追加**

現在の `updateCardStatus`:
```js
  function updateCardStatus(i) {
    const el = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!el) return;
    el.classList.toggle('incomplete', !isSaveable(groups[i]));
    const badge = el.querySelector('.bulk-badge');
    if (badge) badge.textContent = missingMsg(groups[i]);
  }
```
を次に置き換え:
```js
  function updateCardStatus(i) {
    const el = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!el) return;
    const ok = isSaveable(groups[i]);
    el.classList.toggle('incomplete', !ok);
    const badge = el.querySelector('.bulk-badge');
    if (badge) badge.textContent = missingMsg(groups[i]);
    const saveBtn = el.querySelector('.bulk-savecard');
    if (saveBtn) { saveBtn.disabled = !ok; saveBtn.classList.toggle('off', !ok); }
  }
```

- [ ] **Step 3: `aiSuggest` の `refreshCard(i)` を `applyAiUpdate(i)` に差し替え（2箇所）**

`aiSuggest` 内の先頭付近:
```js
    g.aiState = 'loading'; refreshCard(i);
```
を次に置き換え:
```js
    g.aiState = 'loading'; applyAiUpdate(i);
```

`aiSuggest` 末尾付近:
```js
    g.aiDebug = dbg;
    g.aiState = 'done'; refreshCard(i);
```
を次に置き換え:
```js
    g.aiDebug = dbg;
    g.aiState = 'done'; applyAiUpdate(i);
```

- [ ] **Step 4: 構文チェック**

```bash
node --check js/bulk.js
```
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add js/bulk.js
git commit -m "feat(bulk): differential AI update on expanded cards (keep memo editing intact)"
```

---

### Task 7: スタイル（折りたたみ・個別保存・メモ）

**Files:**
- Modify: `style.css`

- [ ] **Step 1: CSSを追記**

`style.css` の末尾に追加:
```css
/* --- 一括：折りたたみカード＋メモ＋個別保存 --- */
.bulk-cardhead { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.bulk-cover.sm { width: 52px; height: 52px; border-radius: 10px; flex: 0 0 auto;
  background-size: cover; background-position: center; }
.bulk-headinfo { flex: 1; min-width: 0; }
.bulk-headname { font-size: 15px; font-weight: 700; color: inherit;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bulk-headname.empty { color: #9a8f7c; font-weight: 400; }
.bulk-chev { color: #b3a891; flex: 0 0 auto; font-size: 15px; }
.bulk-collapsed-acts { display: flex; gap: 7px; margin-top: 9px; }
.bulk-collapsed-acts .bulk-act,
.bulk-collapsed-acts .bulk-savecard { flex: 1; }

.bulk-savecard { border: 1px solid #9ec9a0; background: #e7f2e6; color: #3f7a44;
  font-weight: 700; border-radius: 10px; padding: 8px 10px; font-size: 13px; cursor: pointer; }
.bulk-savecard.wide { width: 100%; margin-top: 8px; padding: 11px; font-size: 14px; }
.bulk-savecard.off { border-color: #d9cdbb; background: #efe9de; color: #b3a891; cursor: default; }

.bulk-memolabel { display: block; margin-top: 10px; font-size: 12.5px; color: #7a715c; font-weight: 600; }
.bulk-memo { width: 100%; margin-top: 5px; box-sizing: border-box; resize: vertical;
  border: 1px solid rgba(127,127,127,.3); border-radius: 9px; padding: 8px 10px;
  font-size: 13px; font-family: inherit; }
```

- [ ] **Step 2: コミット**

```bash
git add style.css
git commit -m "style(bulk): collapsed card, memo field, per-card save button"
```

---

### Task 8: バージョン更新＋実機確認

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 現行verを確認**

```bash
grep -n "app-ver" index.html
```
Expected: 現在の値（例 `ver. 20260818p`）を確認。

- [ ] **Step 2: verを一括更新**

`index.html` 内の現行 `?v=` 値（`grep -o "?v=[0-9a-z]*" index.html | head -1` で確認）と `.app-ver` を、新しい値（例 現行が `20260818p` なら `20260819a`）へ置換。

```bash
sed -i 's/20260818p/20260819a/g' index.html
grep -n "app-ver" index.html
```
Expected: `.app-ver` が新値に。`grep -c "20260818p" index.html` が 0。

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "chore: bump asset version for bulk card collapse"
```

- [ ] **Step 4: 本人の実機確認（デプロイ後）**

main へマージ→push で本番反映（Task 9）。本番URLで確認:
- 「まとめて」→写真を選ぶ → **全カードが畳まれて**表示される。
- 畳みカードに **写真・店名（未入力なら「（店名未入力）」）・日付/枚数・（未入力ならオレンジ枠＋バッジ）・↑前と結合/🗑削除/💾保存** が出る。分割ボタンは出ない。
- **写真＋名前の帯をタップで開く**。開くと今までの全項目＋**メモ欄**＋末尾に**💾この1件を保存**。
- 開いた状態で**カバー写真タップで畳む**。入力欄やボタンをタップしても開閉しない。
- メモを書ける。**AIが裏で名前を埋めてもメモは消えない**（開いたまま編集していても壊れない）。
- 名前＋場所が揃うと💾保存が有効化。**押すとその1件だけ保存され、カードが消える**。保存した記録の**メモが入っている**ことを確認。
- 「すべて保存」も従来通り動く。

---

### Task 9: ブランチの仕上げ

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

- [ ] **Step 1:** `node --check js/bulk.js` が通ることを再確認。
- [ ] **Step 2:** finishing-a-development-branch に従い main へマージ→push（GitHub Pages 反映）。
- [ ] **Step 3:** 問題があれば `git switch main` → `pre-card-collapse` タグへ戻して即ロールバック。

---

## Self-Review（spec との突き合わせ）

**Spec coverage:**
- データ `collapsed`(既定true)/`memo` → Task 2 ✓
- 畳み状態の表示（写真・名前・日付・バッジ・AI判定中・前と結合/削除/保存、分割は非表示）→ Task 3 畳み分岐 ✓
- 開き状態＝既存＋メモ＋個別保存＋カバータップで畳む → Task 3 開き分岐 ✓
- 開閉操作（帯タップで開く／カバー写真タップで畳む・入力/ボタンは対象外）→ Task 5 配線 ✓
- メモを `memo` として保存 → Task 3（textarea）＋ Task 4（`saveGroup` が `memo: g.memo`）✓
- 個別保存＝`saveGroup` 共用・成功でカード除去・未入力は無効・畳み/開き両方に表示 → Task 3/4/5 ✓
- 既存「すべて保存」存置 → `doSave` は温存、`saveButtonHtml` 不変 ✓
- AI処理中の編集両立（`collapsed===false` は差分更新、メモ保持）→ Task 6 `applyAiUpdate` ✓
- スタイル → Task 7 ✓
- キャッシュ対策（ver更新）→ Task 8 ✓

**Placeholder scan:** 具体コードで充填済み。TBD等なし。

**Type consistency:** 追加関数 `saveCardBtnHtml`/`saveGroup`/`saveOne`/`applyAiUpdate` は定義タスクと参照タスクで名称一致。`saveGroup(g, order, onProgress)` は `doSave`（order=…+done）と `saveOne`（order=当日件数）双方の呼び出しと引数一致。グループ新フィールド `collapsed`/`memo` は生成2箇所（Task 2）で追加し `cardHtml`/`wireCards`/`saveGroup` から参照、整合。クラス名は `.bulk-cardhead`（オーバーレイの `.bulk-head` と非衝突）を使用。
