# バックアップ復元（インポート） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 書き出した控えJSONから記録を**非破壊で復元（不足分だけ追加）**できるようにする。

**Architecture:** `js/backup.js`（`App.backup`）を拡張。純粋関数 `parseBackup`/`diffMissing` を追加してテストし、`importFlow` がファイル選択→確認→`App.cloud.put`（元idのままupsert）で不足分だけ書き戻す。既存は削除・上書きしない＝冪等。

**Tech Stack:** バニラJS（非ESMの `window.App` グローバル）、`<input type=file>` + FileReader、Firestore（既存 `App.cloud.put`）。ビルド無し。純粋関数は `_selfTest()` を Node 実行。

**参照:** 仕様 `docs/superpowers/specs/2026-08-20-backup-import-restore-design.md`。

**版運用:** 実装完了後に `index.html` 内の現行版 `20260819x` を **`20260819y`** へ全置換（Task 4）。途中コミットでは版を上げない。

---

## File Structure

- **Modify `js/backup.js`** — `App.backup` に `parseBackup`/`diffMissing`（純粋）＋`_selfTest`＋`importFlow`/`handleText`/`doImport`（DOM・Firestore）を追加。既存 `exportJson` は維持。
- **Modify `index.html`** — 設定メニューに「読み込み」ボタン `#import-btn`＋隠し `<input type="file" id="import-file">`。版バンプ（Task 4）。
- **Modify `js/app.js`** — `wireUI` で `#import-btn` → `App.backup.importFlow()` を配線。

---

## Task 1: `backup.js` 純粋ロジック（parseBackup / diffMissing）＋テスト

**Files:**
- Modify: `js/backup.js`
- Test: Node ワンライナー

- [ ] **Step 1: `js/backup.js` を以下で全面置換**（既存 `exportJson` は保持し、純粋関数＋`_selfTest` を追加。`importFlow` は Task 2 で足すので今はまだ入れない）

```js
window.App = window.App || {};
// クラウド版：一次保存はFirestore。書き出しは「控え」用（写真は data URL を含む）。復元は「不足分だけ追加」。
App.backup = (function () {
  function exportJson() {
    const records = App.records.getAll();
    const blob = new Blob([JSON.stringify({ version: 2, records }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `date-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // JSONテキスト → { ok, records(有効のみ), skipped(除外数), error }
  // 必須：id(非空文字列) / date('YYYY-MM-DD') / 数値 lat / 数値 lng
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, records: [], skipped: 0, error: 'ファイルを読めませんでした（JSON形式ではありません）' }; }
    if (!data || !Array.isArray(data.records)) {
      return { ok: false, records: [], skipped: 0, error: 'バックアップ形式ではありません（records が見つかりません）' };
    }
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const valid = [];
    let skipped = 0;
    data.records.forEach((r) => {
      if (r && typeof r.id === 'string' && r.id
        && typeof r.date === 'string' && DATE.test(r.date)
        && typeof r.lat === 'number' && typeof r.lng === 'number') {
        valid.push(r);
      } else { skipped++; }
    });
    return { ok: true, records: valid, skipped, error: '' };
  }

  // fileRecords のうち existingRecords に id が無いものだけ → { toAdd, addCount, keepCount }
  function diffMissing(fileRecords, existingRecords) {
    const have = {};
    (existingRecords || []).forEach((r) => { if (r && r.id) have[r.id] = true; });
    const toAdd = (fileRecords || []).filter((r) => r && r.id && !have[r.id]);
    return { toAdd, addCount: toAdd.length, keepCount: (fileRecords ? fileRecords.length : 0) - toAdd.length };
  }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('parse-bad-json', parseBackup('{not json').ok, false);
    eq('parse-no-records', parseBackup('{"version":2}').ok, false);
    const good = JSON.stringify({ version: 2, records: [
      { id: 'a', date: '2026-01-02', lat: 35, lng: 139, name: 'A' },
      { id: 'b', date: '2026-03-04', lat: 35.1, lng: 139.1 },
      { id: '', date: '2026-01-01', lat: 1, lng: 1 },      // id空 → skip
      { id: 'c', date: '2026/01/01', lat: 1, lng: 1 },      // date形式NG → skip
      { id: 'd', date: '2026-01-01', lat: 'x', lng: 1 },    // lat非数 → skip
    ] });
    const p = parseBackup(good);
    eq('parse-ok', p.ok, true);
    eq('parse-valid-count', p.records.length, 2);
    eq('parse-skipped', p.skipped, 3);
    const d = diffMissing([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a' }]);
    eq('diff-add', d.addCount, 2);
    eq('diff-keep', d.keepCount, 1);
    eq('diff-toadd-ids', d.toAdd.map((x) => x.id), ['b', 'c']);
    eq('diff-empty-existing', diffMissing([{ id: 'a' }], []).addCount, 1);
    eq('diff-empty-file', diffMissing([], [{ id: 'a' }]).addCount, 0);
    console.log(fails === 0 ? '✅ backup ALL PASS' : ('❌ backup ' + fails + ' FAIL'));
    return fails;
  }

  return { exportJson, parseBackup, diffMissing, _selfTest };
})();
```

- [ ] **Step 2: Node でテスト実行**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/backup.js');process.exit(global.App.backup._selfTest())"
```
Expected: 全 PASS、`✅ backup ALL PASS`、終了コード0。

- [ ] **Step 3: Commit**

```bash
git add js/backup.js
git commit -m "feat(backup): parseBackup + diffMissing pure logic for import (tested)"
```

---

## Task 2: `backup.js` 復元フロー（importFlow）

**Files:**
- Modify: `js/backup.js`

`<input type=file>` からテキストを読み、`parseBackup`→`diffMissing`→確認→`App.cloud.put` で不足分だけ書き戻す。DOM/Firestore は関数内のみ（トップレベルは触らない＝Nodeロード維持）。`App.cloud.put(record)` は内部で `const {id, ...rest}=record` して `setDoc(doc(col,id), {...rest, updatedAt}, {merge:true})` する＝**元idのまま**復元される。

- [ ] **Step 1: `_selfTest` の後・`return` の前に復元フローを追加**

`js/backup.js` の `function _selfTest() { ... }` の閉じ `}` と `return { ... }` の間に以下を挿入：
```js
  let running = false;
  function importFlow() {
    if (running) return;
    const input = document.getElementById('import-file');
    if (!input) return;
    input.value = ''; // 同じファイルを連続で選べるように
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handleText(String(reader.result || ''));
      reader.onerror = () => alert('ファイルの読み込みに失敗しました');
      reader.readAsText(file);
    };
    input.click();
  }

  function handleText(text) {
    const p = parseBackup(text);
    if (!p.ok) { alert(p.error); return; }
    const existing = (App.records && App.records.getAll) ? App.records.getAll() : [];
    const d = diffMissing(p.records, existing);
    if (d.addCount === 0) { alert('追加する新しい記録はありませんでした（すべて既存です）'); return; }
    let msg = 'このファイル: ' + p.records.length + '件\n新しく追加: ' + d.addCount + '件\n既存はそのまま: ' + d.keepCount + '件';
    if (p.skipped) msg += '\n読めなかった: ' + p.skipped + '件';
    msg += '\n\n追加しますか？';
    if (!window.confirm(msg)) return;
    doImport(d.toAdd);
  }

  function doImport(toAdd) {
    running = true;
    let ok = 0, ng = 0, done = 0;
    const finish = () => {
      running = false;
      alert(ok + '件を追加しました' + (ng ? '（' + ng + '件は失敗）' : ''));
    };
    toAdd.forEach((r) => {
      Promise.resolve(App.cloud.put(r))
        .then(() => { ok++; })
        .catch(() => { ng++; })
        .then(() => { done++; if (done === toAdd.length) finish(); });
    });
  }
```

- [ ] **Step 2: `return` に `importFlow` を公開**

`return { exportJson, parseBackup, diffMissing, _selfTest };` を次に変更：
```js
  return { exportJson, importFlow, parseBackup, diffMissing, _selfTest };
```

- [ ] **Step 3: モジュールが読め、純粋テストが通ることを確認（DOMは触らない）**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/backup.js');console.log('keys:',Object.keys(global.App.backup).join(','));process.exit(global.App.backup._selfTest())"
```
Expected: `keys: exportJson,importFlow,parseBackup,diffMissing,_selfTest`、全 PASS、終了コード0。（トップレベルで `document`/`FileReader` に触れていない証明。）

- [ ] **Step 4: Commit**

```bash
git add js/backup.js
git commit -m "feat(backup): importFlow — file pick, confirm, add-missing via cloud.put"
```

---

## Task 3: `index.html` 導線＋`js/app.js` 配線

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

- [ ] **Step 1: 設定メニューに「読み込み」ボタンと隠しファイル入力を追加**

`index.html` の設定メニューの書き出しボタンを探す：
```html
          <button id="export-btn"><i class="ph ph-download-simple"></i><span>書き出し</span></button>
```
を次に変更（読み込みボタンと隠しinputを直後に追加）：
```html
          <button id="export-btn"><i class="ph ph-download-simple"></i><span>書き出し</span></button>
          <button id="import-btn"><i class="ph ph-upload-simple"></i><span>読み込み</span></button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
```

- [ ] **Step 2: `js/app.js` で `#import-btn` を配線**

`js/app.js` の書き出しの配線：
```js
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());
```
を次に変更（直後に読み込みの配線を追加）：
```js
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());
  document.getElementById('import-btn').addEventListener('click', () => App.backup.importFlow());
```

- [ ] **Step 3: 確認**

Run:
```bash
grep -nE "import-btn|import-file" index.html
node --check js/app.js && echo "app.js OK"
```
Expected: ボタン・入力の2〜3行が出る。`app.js OK`。

- [ ] **Step 4: Commit**

```bash
git add index.html js/app.js
git commit -m "feat(backup): menu 読み込み button, file input, and app wiring"
```

---

## Task 4: 版上げ・最終確認・デプロイ

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 版を全置換**

`index.html` 内の `20260819x` をすべて `20260819y` に置換（`.app-ver`・全 `?v=`・`sw.js?v=` を含む）。

Run:
```bash
grep -c "20260819x" index.html; grep -c "20260819y" index.html
```
Expected: 前者 `0`、後者 `1以上`（従来分。scriptの新規追加はなし＝backup.jsは既存タグ）。

- [ ] **Step 2: 純粋テストを最終実行**

Run:
```bash
node -e "global.window={};global.App=global.window.App={};require('./js/backup.js');process.exit(global.App.backup._selfTest())"
node --check js/app.js && echo "app.js OK"
```
Expected: backup 全 PASS・終了コード0、`app.js OK`。

- [ ] **Step 3: Commit ＆ push（デプロイ）**

```bash
git add index.html
git commit -m "chore(backup): bump version to 20260819y for import/restore release"
git push
```
push → GitHub Pages 反映（[[maprecord-deploy]]）。

- [ ] **Step 4: 実機/実Chromeでの最終確認（チェックリスト）**

- [ ] メニュー →「書き出し」でJSONを保存。
- [ ] メニュー →「読み込み」→ そのJSONを選ぶ → 「追加する新規: 0件（すべて既存）」の案内が出る（＝冪等・非破壊。既存を触らない）。
- [ ] 一部の記録を削除 → 「読み込み」で同じJSONを選ぶ → 「新しく追加: N件」の確認 → OK → 削除した記録が復元される（地図・一覧に戻る）。
- [ ] 壊れた/別形式のJSONを選ぶ → 形式エラーの案内が出て何も起きない。
- [ ] 左下 ver が `20260819y`。

- [ ] **Step 5: 返信末尾に本番 ver（`20260819y`）を記載**（[[maprecord-report-version]]）

---

## Self-Review（この計画の点検結果）

**1. Spec coverage:**
- 不足分だけ追加（非破壊・冪等）: `diffMissing`＋`doImport(cloud.put)` Task 1/2 ✓
- parseBackup（形式検証・必須欠けskip・count）: Task 1 ✓
- 確認ダイアログ（件数・skip表示）: `handleText` Task 2 ✓
- 追加0件は確認なしで終了: `handleText`（`addCount===0` 分岐）Task 2 ✓
- 元id保持で書き戻し（cloud.put）: Task 2 ✓（cloud.put は id 指定 upsert）
- 写真そのまま: put が record 全体を書くので data URL も往復 ✓
- 入口＝メニュー「読み込み」＋隠しfile input: Task 3 ✓
- テスト（parseBackup/diffMissing の _selfTest）: Task 1 ✓
- 版上げ・返信ver: Task 4 ✓

**2. Placeholder scan:** 各タスクに完全なコードを掲載。UI（Task 2 の DOM/Firestore 部分）は実際の書き込みに Firebase ログインが要るため実機確認手順を明記（本リポは純粋関数のみ _selfTest、UIは目視/実機の方針に準拠）。TBD/TODO 無し。

**3. Type consistency:**
- 公開名: `App.backup.exportJson/importFlow/parseBackup/diffMissing/_selfTest`、`App.cloud.put`、`App.records.getAll` を全タスクで一貫使用。
- 形状 `parseBackup→{ok,records,skipped,error}`、`diffMissing→{toAdd,addCount,keepCount}` を Task1/2 で統一。
- 既存API `App.cloud.put(record)`（id指定upsert、js/cloud.js:26-28 で確認）、`export-btn` 配線（js/app.js）を実コードで確認済み。
