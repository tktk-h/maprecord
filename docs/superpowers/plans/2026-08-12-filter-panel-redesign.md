# 絞り込みパネル再デザイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 絞り込みパネルの見た目を「温かみ・エモい」方向に作り込む（機能・状態管理は不変、マークアップ＋CSSの差し替えのみ）。

**Architecture:** 状態の真実は既存の隠しコントロール（`#mode-select` の native select、ジャンルの native checkbox）に残し、新UI（セグメント式ピル／色付きトグルチップ）はそれらを操作・反映する「ビュー」に徹する。既存の `readFilterState`/`isFiltering`/`focusDay`/`resetFilters` は一切変更しない。

**Tech Stack:** Vanilla JS（`App.records` IIFE）、CSS（`:has()` + `color-mix()`、カスタムプロパティ `--gc`）、Phosphor アイコン（`ph`）。

---

## ファイル構成

- `index.html`（変更）: `#filter-panel` のマークアップ（タイトル、`#mode-segment` の器、`ジャンル`ラベル、設定セクションの区切り、`filter-clear` の文言/アイコン）。`?v=` 更新。
- `js/records.js`（変更）: `buildGenreFilters()` のマークアップ差し替え、`buildModeSegment()`/`syncModeSegment()` 追加、`init()`・`applyUiFilter()` にフック。
- `style.css`（変更）: 絞り込みパネル一式のスタイルを新デザインに置換。

新しい純粋関数は無い（DOM操作中心）。検証は `node --check` ＋実機/ブラウザの回帰確認。

---

## Task 1: index.html — 絞り込みパネルのマークアップ差し替え

**Files:** Modify `index.html`

- [ ] **Step 1: `#filter-panel` の中身を差し替え**

`index.html` の現在の `<div id="filter-panel">` ブロック（`<div id="filter-panel">` から、対応する閉じ `</div>` まで）は次の内容:
```html
    <div id="filter-panel">
    <div id="filter-bar">
      <select id="mode-select">
        <option value="all">全部</option>
        <option value="day">特定の日</option>
        <option value="range">期間</option>
      </select>
      <input type="date" id="day-input" hidden>
      <span id="range-inputs" hidden>
        <input type="date" id="from-input"> 〜 <input type="date" id="to-input">
      </span>
      <span id="genre-filters"><!-- チェックボックスをJSで生成 --></span>
      <button id="filter-clear" title="絞り込みをリセット"><i class="ph ph-x"></i>クリア</button>
    </div>
    <div id="backup-bar">
      <button id="export-btn"><i class="ph ph-download-simple"></i><span>書き出し</span></button>
      <button id="show-invite-btn"><i class="ph ph-user-plus"></i><span>招待コード</span></button>
      <button id="anniv-btn"><i class="ph ph-heart"></i><span>記念日</span></button>
      <button id="logout-btn"><i class="ph ph-sign-out"></i><span>ログアウト</span></button>
    </div>
    </div>
```
これを次に置き換える:
```html
    <div id="filter-panel">
      <div class="filter-title"><i class="ph ph-sliders-horizontal"></i>絞り込み</div>
      <div id="filter-bar">
        <select id="mode-select">
          <option value="all">全部</option>
          <option value="day">特定の日</option>
          <option value="range">期間</option>
        </select>
        <div id="mode-segment"><!-- セグメントをJSで生成 --></div>
        <input type="date" id="day-input" hidden>
        <span id="range-inputs" hidden>
          <input type="date" id="from-input"> 〜 <input type="date" id="to-input">
        </span>
        <div class="gf-label">ジャンル</div>
        <span id="genre-filters"><!-- チップをJSで生成 --></span>
        <button id="filter-clear" title="絞り込みをリセット"><i class="ph ph-arrow-counter-clockwise"></i>リセット</button>
      </div>
      <div class="settings-section">
        <div class="settings-label">設定</div>
        <div id="backup-bar">
          <button id="export-btn"><i class="ph ph-download-simple"></i><span>書き出し</span></button>
          <button id="show-invite-btn"><i class="ph ph-user-plus"></i><span>招待コード</span></button>
          <button id="anniv-btn"><i class="ph ph-heart"></i><span>記念日</span></button>
          <button id="logout-btn"><i class="ph ph-sign-out"></i><span>ログアウト</span></button>
        </div>
      </div>
    </div>
```
変更点: タイトル行 `.filter-title` 追加、`#mode-segment` 追加（`#mode-select` は残す）、`.gf-label` 追加、`#filter-clear` を「リセット」＋別アイコンに、`#backup-bar` を `.settings-section`（区切り＋ラベル）で包む。IDは全て据え置き。

- [ ] **Step 2: 変更確認**

`#mode-select`・`#day-input`・`#from-input`・`#to-input`・`#genre-filters`・`#filter-clear`・`#export-btn`・`#show-invite-btn`・`#anniv-btn`・`#logout-btn` が全て残っていること、`#mode-segment`・`.filter-title`・`.gf-label`・`.settings-section`・`.settings-label` が新規に存在することを目視確認（`git diff`）。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "refactor(filter): restructure filter panel markup for redesign"
```

---

## Task 2: js/records.js — ジャンルチップ＋モードセグメントの生成/同期

**Files:** Modify `js/records.js`

- [ ] **Step 1: `buildGenreFilters()` のマークアップを差し替え**

現在の `buildGenreFilters` は:
```javascript
  function buildGenreFilters() {
    const box = document.getElementById('genre-filters');
    box.innerHTML = App.genres.list.map((g) =>
      `<label class="gf"><input type="checkbox" value="${g.key}" checked>
        <span style="color:${g.color}">●</span>${g.label}</label>`
    ).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', applyUiFilter));
  }
```
次に置き換える（native checkbox は残す＝状態の真実。`●` を廃止し、ジャンル色は `--gc` で渡す）:
```javascript
  function buildGenreFilters() {
    const box = document.getElementById('genre-filters');
    box.innerHTML = App.genres.list.map((g) =>
      `<label class="gf" style="--gc:${g.color}">
        <input type="checkbox" value="${g.key}" checked>
        <span class="gf-dot"></span>${g.label}
      </label>`
    ).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', applyUiFilter));
  }
```

- [ ] **Step 2: `buildModeSegment()` と `syncModeSegment()` を追加**

`buildGenreFilters` 関数の直後に、次の2関数を追加:
```javascript
  // モード切替のセグメントUI。真実は隠した #mode-select。押下で select を変えて change を発火。
  function buildModeSegment() {
    const sel = document.getElementById('mode-select');
    const seg = document.getElementById('mode-segment');
    if (!sel || !seg) return;
    seg.innerHTML = Array.from(sel.options).map((o) =>
      `<button type="button" class="seg-btn" data-val="${o.value}">${o.textContent}</button>`).join('');
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => {
        sel.value = b.dataset.val;
        sel.dispatchEvent(new Event('change')); // 既存の applyUiFilter が走る
      };
    });
    syncModeSegment();
  }
  // #mode-select の現在値に合わせてセグメントの active 表示を更新
  function syncModeSegment() {
    const sel = document.getElementById('mode-select');
    const seg = document.getElementById('mode-segment');
    if (!sel || !seg) return;
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.val === sel.value);
    });
  }
```

- [ ] **Step 3: `applyUiFilter()` の末尾でセグメントを同期**

現在の `applyUiFilter`:
```javascript
  function applyUiFilter() {
    // mode に応じて日付入力の表示切替
    const mode = document.getElementById('mode-select').value;
    document.getElementById('day-input').hidden = mode !== 'day';
    document.getElementById('range-inputs').hidden = mode !== 'range';
    const clr = document.getElementById('filter-clear-top');
    if (clr) clr.hidden = !isFiltering(); // 絞り込み中だけ×を出す
    setFilterState(readFilterState());
  }
```
最後の `setFilterState(readFilterState());` の直後に `syncModeSegment();` を追加:
```javascript
  function applyUiFilter() {
    // mode に応じて日付入力の表示切替
    const mode = document.getElementById('mode-select').value;
    document.getElementById('day-input').hidden = mode !== 'day';
    document.getElementById('range-inputs').hidden = mode !== 'range';
    const clr = document.getElementById('filter-clear-top');
    if (clr) clr.hidden = !isFiltering(); // 絞り込み中だけ×を出す
    setFilterState(readFilterState());
    syncModeSegment(); // focusDay/resetFilters 経由でもセグメント表示を合わせる
  }
```

- [ ] **Step 4: `init()` で `buildModeSegment()` を呼ぶ**

現在の `init` にある `buildGenreFilters();` の直後に `buildModeSegment();` を追加:
```javascript
    buildGenreFilters();
    buildModeSegment();
```
（`readFilterState`/`isFiltering`/`focusDay`/`resetFilters` は変更しない。）

- [ ] **Step 5: 構文チェック**

Run: `node --check js/records.js`
Expected: エラーなし（`google`/`window` は未実行なので構文のみ通ればOK）。

- [ ] **Step 6: Commit**

```bash
git add js/records.js
git commit -m "feat(filter): genre toggle chips + mode segment control"
```

---

## Task 3: style.css — 絞り込みパネルのスタイル一式を置換

**Files:** Modify `style.css`

- [ ] **Step 1: 既存の絞り込みCSSブロックを置換**

`style.css` の次のブロック（`/* ===== 絞り込みパネル（押したときだけ白背景で表示） ===== */` から `#backup-bar button:hover, #import-label:hover { ... }` まで）を丸ごと置き換える。現在の内容:
```css
/* ===== 絞り込みパネル（押したときだけ白背景で表示） ===== */
#filter-panel { display: none; flex-basis: 100%; }
#topbar.filters-open #filter-panel { display: flex; flex-direction: column; gap: 12px;
  background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow-md);
  padding: 16px; margin-top: 2px; max-width: 520px; }
#filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
/* font-size:16px 未満だと iOS Safari が入力時に自動ズームするため16pxに */
#filter-bar select, #filter-bar input[type=date] { width: auto; padding: 7px 10px; font-size: 16px; }
.gf { display: inline-flex; align-items: center; gap: 5px; background: rgba(51,48,43,.06); color: var(--text);
  padding: 6px 11px; border-radius: var(--radius-pill); cursor: pointer; font-size: 13px; }
.gf input { width: auto; vertical-align: middle; accent-color: var(--accent); }
#filter-clear { display: inline-flex; align-items: center; gap: 5px; color: var(--text);
  background: rgba(51,48,43,.06); border-radius: var(--radius-pill); padding: 6px 12px; font-size: 13px; }
#filter-clear:hover { background: rgba(51,48,43,.12); }

/* バックアップ */
#backup-bar { display: flex; gap: 8px; }
#backup-bar button, #import-label { display: inline-flex; align-items: center; gap: 6px;
  background: rgba(51,48,43,.06); color: var(--text); border-radius: var(--radius-pill);
  padding: 7px 13px; cursor: pointer; font-size: 13px; }
#backup-bar button:hover, #import-label:hover { background: rgba(51,48,43,.12); }
```
置き換え後:
```css
/* ===== 絞り込みパネル（温かみ・エモい・作り込み） ===== */
#filter-panel { display: none; flex-basis: 100%; }
#topbar.filters-open #filter-panel { display: flex; flex-direction: column; gap: 14px;
  background: var(--surface); border-radius: var(--radius);
  box-shadow: 0 12px 34px rgba(45,38,30,.14), 0 2px 8px rgba(45,38,30,.06);
  padding: 18px; margin-top: 2px; max-width: 360px; }
.filter-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: var(--text); }
.filter-title .ph { color: var(--accent-strong); font-size: 17px; }

#filter-bar { display: flex; flex-direction: column; align-items: stretch; gap: 14px; font-size: 13px; }

/* モード：セグメント式ピル（地図/カレンダー切替と同じ手触り） */
#mode-select { display: none; }
#mode-segment { display: flex; gap: 4px; background: var(--surface-2); padding: 4px; border-radius: var(--radius-pill); }
#mode-segment .seg-btn { flex: 1; padding: 8px 0; border-radius: var(--radius-pill);
  font-size: 13px; color: var(--text-muted); transition: background .15s, color .15s; }
#mode-segment .seg-btn.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }

/* 日付入力（温かい枠）。font-size:16px 未満だと iOS Safari が入力時に自動ズームする */
#filter-bar input[type=date] { width: 100%; padding: 11px 13px; font-size: 16px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
#range-inputs { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
#range-inputs input[type=date] { flex: 1; }

/* ジャンル：色付きトグルチップ（真実は隠した checkbox） */
.gf-label { font-size: 11px; color: var(--text-muted); letter-spacing: .04em; margin-bottom: -6px; }
#genre-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.gf { position: relative; display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: var(--radius-pill); cursor: pointer; font-size: 13px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-muted);
  transition: background .12s, border-color .12s, color .12s; }
.gf input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; pointer-events: none; }
.gf-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--gc); opacity: .4; }
.gf:active { transform: scale(.97); }
.gf:has(input:checked) { background: color-mix(in srgb, var(--gc) 15%, transparent);
  border-color: color-mix(in srgb, var(--gc) 34%, transparent);
  color: color-mix(in srgb, var(--gc), #000 34%); font-weight: 600; }
.gf:has(input:checked) .gf-dot { opacity: 1; }
.gf:focus-within { box-shadow: var(--ring); }

/* リセット（控えめ・右寄せ） */
#filter-clear { align-self: flex-end; display: inline-flex; align-items: center; gap: 5px;
  color: var(--text-muted); background: none; padding: 2px 4px; font-size: 12px; }
#filter-clear:hover { color: var(--accent-strong); }

/* 設定セクション（絞り込みと視覚的に分離） */
.settings-section { border-top: 1px solid var(--border); padding-top: 14px; }
.settings-label { font-size: 11px; color: var(--text-muted); letter-spacing: .04em; margin-bottom: 8px; }
#backup-bar { display: flex; flex-direction: column; gap: 2px; }
#backup-bar button { display: flex; align-items: center; gap: 11px; width: 100%;
  background: none; color: var(--text); border-radius: var(--radius-sm);
  padding: 9px 8px; font-size: 14px; text-align: left; }
#backup-bar button .ph { font-size: 18px; color: var(--text-muted); }
#backup-bar button:hover { background: var(--surface-2); }
#anniv-btn .ph { color: var(--accent); }
#logout-btn { color: #a86a62; }
#logout-btn .ph { color: #a86a62; }
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "style(filter): warm, tactile filter panel (chips, segment, settings)"
```

---

## Task 4: キャッシュバスト＋回帰確認＋本番反映

**Files:** Modify `index.html`

- [ ] **Step 1: `?v=` を一括更新**

`index.html` 内の全アセット（`style.css` と `js/*.js`）の `?v=20260812c` を `?v=20260812d` に置換。
```bash
grep -n "20260812c" index.html
```
で対象を確認し、全て `20260812d` に。置換後:
```bash
grep -n "20260812c" index.html
```
Expected: no matches。

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "chore: cache-bust assets (?v=20260812d)"
```

- [ ] **Step 3: 回帰確認（実機/ブラウザ、本人）**

機能が壊れていないことを確認（ロジック未変更なので回帰チェックが主）:
1. 絞り込みを開く → タイトル・セグメント・チップ・設定が新デザインで出る。
2. セグメントで「特定の日」→ 日付入力が出る／「期間」→ 範囲入力／「全部」→ 消える。選択が絞り込み結果に反映。
3. ジャンルチップをタップ → 色が付く/消える、地図のピンが増減する。
4. カレンダーで日付タップ → 地図に移動し、絞り込みのセグメントが「特定の日」に光る。
5. 「リセット」→ 全部＋全ジャンルに戻り、セグメント/チップ表示も戻る。
6. 絞り込み中だけ出る×（ヘッダーの `#filter-clear-top`）が従来どおり出る/消える。
7. 設定の各ボタン（書き出し／招待コード／記念日／ログアウト）が従来どおり動く。
8. iOS Safari でチップの色付き（`:has()`+`color-mix()`）が出る。出ない端末でもドット色でジャンルが判別できる。

- [ ] **Step 4: 本番反映**

```bash
git push
```
（GitHub Pages に反映。実機で Step 3 を再確認。）

---

## セルフレビュー結果

- **仕様カバレッジ:** パネル全体（Task 1,3）/ モードのセグメント化（Task 1,2,3）/ ジャンル色付きチップ（Task 2,3）/ 日付入力の枠（Task 3）/ 設定分離（Task 1,3）/ キャッシュバスト（Task 4）— すべて対応タスクあり。
- **後方互換:** `#mode-select`（隠し select）とジャンル checkbox を残し、`readFilterState`/`isFiltering`/`focusDay`/`resetFilters` は無改変。セグメントは `change` を発火して既存フローに乗る。`applyUiFilter` 末尾の `syncModeSegment()` で `focusDay`/`resetFilters` からの変更も表示同期。
- **型/名前の一貫性:** `buildModeSegment`/`syncModeSegment`（records.js内で定義・相互参照・`init`/`applyUiFilter`から呼ぶ）、`.seg-btn`/`#mode-segment`/`.gf`/`.gf-dot`/`--gc`/`.gf-label`/`.settings-section`/`.settings-label` は index.html・records.js・style.css で表記一致。
- **プレースホルダ:** なし。
- **フォールバック:** `:has()`/`color-mix()` 非対応時もドット（`--gc`）でジャンル判別可、チップは成立。
