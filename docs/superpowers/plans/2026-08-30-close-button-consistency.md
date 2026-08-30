# 「閉じる」を揃える Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリ中の「閉じる」を `.x-btn`（右上の丸い×・見た目32px・当たり判定44px）ひとつに揃える。

**Architecture:** 共通クラス `.x-btn` を `style.css` に1つ作り、10箇所のマークアップをそこへ寄せる。位置は「全画面のものは画面の右上（`.x-fixed`）／カードはカードの右上（そのまま流し込み）」の2種類だけ。当たり判定は透明な `::after` で44pxに広げるので、見た目の丸は32pxのまま。**閉じたときの挙動は一切変えない。**

**Tech Stack:** 純バニラJS＋1枚の `style.css`。ビルド無し。CSSの契約は実ブラウザで `getComputedStyle` を測って検証し、マークアップの網羅は Node のスクリプトで検査する。

**仕様からの変更（1点）:** 仕様書は「まとめて追加の×は画面の右上（`.x-fixed`）」としていたが、**`.bulk-head` の右端に置く**。まとめて追加には見出し帯があり、そこの右端は視覚的に画面の右上そのもので、設定（`.set-head`）と同じ形になる。絶対配置にすると中身のスクロールに浮いてしまう。

---

## File Structure

| ファイル | 変更 |
|---|---|
| `style.css` | `.x-btn` / `.x-btn.x-fixed` / `.x-btn.on-dark` を新設。既存10個の指定を削除・縮小 |
| `index.html` | `#sheet-close` と設定の×に `x-btn` を付ける |
| `js/review-ui.js` | `.rv-x`×3、`.rv-card-x`、`.rv-close`×2、`.pv-close` |
| `js/genre-edit.js` / `js/trip-edit.js` | `.ge-x`（計3箇所） |
| `js/memories.js` | `.mem-x` |
| `js/lightbox.js` | `.lb-close` |
| `js/bulk.js` | `.bulk-x`（左→右、`✕` の文字→アイコン） |
| `scripts/close-buttons-check.mjs` | **新規**。閉じるボタンの取りこぼしを検査する |

**触らない:** `#search-clear`（検索を消す）、`#filter-clear-top`（絞り込みをリセット）。「消す」であって「閉じる」ではない。

**⚠️すべてのコミットで `git add` にファイルを明示する。`git add -A` は使わない**（検査用の一時ファイルを巻き込まないため）。

---

### Task 1: `.x-btn` を作り、CSSの契約を実ブラウザで測る

**Files:**
- Modify: `style.css`（`.mem-x` の指定・263行目付近の直前など、既存の閉じる系の近く。場所は問わないが1箇所にまとめる）
- Create（一時・**コミットしない**）: `x-btn-check.html`

- [ ] **Step 1: 検査ページを作る（まだ通らない）**

リポジトリ直下に `x-btn-check.html` を作る。**これは検査専用で、最後に消す。コミットしない。**

```html
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="style.css"><style>body{margin:0}</style></head>
<body>
<div id="host" style="position:fixed;inset:0">
  <button class="x-btn" id="a"><i class="ph ph-x"></i></button>
  <button class="x-btn x-fixed" id="b"><i class="ph ph-x"></i></button>
  <button class="x-btn on-dark" id="c"><i class="ph ph-x"></i></button>
</div>
<pre id="out" style="position:fixed;bottom:0;left:0;background:#fff;z-index:99999;font:13px monospace"></pre>
<script>
const lines = [];
const check = (name, got, want) => lines.push((String(got) === String(want) ? 'PASS ' : 'FAIL ') + name + '  got=' + got + ' want=' + want);
const cs = (id, pseudo) => getComputedStyle(document.getElementById(id), pseudo || null);
// 見た目は32pxの丸
check('見た目の幅', cs('a').width, '32px');
check('見た目の高さ', cs('a').height, '32px');
check('丸い', cs('a').borderTopLeftRadius, '50%');
// 当たり判定は44px（32 + 6 + 6）。透明な ::after で広げる。
const af = cs('a', '::after');
check('当たり判定の広げ幅', af.top, '-6px');
check('当たり判定は絶対配置', af.position, 'absolute');
check('当たり判定に中身がある', af.content !== 'none', true);
// 全画面のものだけ画面の右上へ
check('ふつうは流し込み', cs('a').position, 'relative');
check('x-fixed は絶対配置', cs('b').position, 'absolute');
check('x-fixed は右14px', cs('b').right, '14px');
// 暗い背景の上は白
check('on-dark は白文字', cs('c').color, 'rgb(255, 255, 255)');
document.getElementById('out').textContent = lines.join('\n') + '\n' +
  (lines.every(l => l.startsWith('PASS')) ? '✅ ALL PASS' : '❌ FAILED');
</script></body></html>
```

- [ ] **Step 2: サーバを立てて、落ちることを確認する**

`node` で静的サーバを立てる（ファイルは scratchpad に置く。リポジトリには入れない）:

```bash
node -e "const h=require('http'),f=require('fs'),p=require('path');const T={'.html':'text/html','.css':'text/css','.js':'text/javascript'};h.createServer((q,s)=>{const x=p.join(process.cwd(),decodeURIComponent(q.url.split('?')[0]));f.readFile(x,(e,b)=>{if(e){s.writeHead(404);s.end('no');return;}s.writeHead(200,{'Content-Type':T[p.extname(x)]||'application/octet-stream'});s.end(b);});}).listen(8791,()=>console.log('8791'))"
```

ブラウザで `http://localhost:8791/x-btn-check.html` を開き、`#out` の中身を読む。
Expected: `.x-btn` がまだ無いので **FAIL が並ぶ**（幅が `auto` などになる）。

- [ ] **Step 3: `.x-btn` を実装する**

`style.css` に足す（既存の `.mem-x` の指定の直前など、閉じる系がまとまる場所）:

```css
/* 閉じるはアプリ中これ1つ。見た目は32pxの丸、指の当たり判定だけ44pxに広げる。
   丸そのものを44pxにすると、思い出カードのような小さいカードで×が主役になってしまう。 */
.x-btn { position: relative; width: 32px; height: 32px; flex: 0 0 auto;
  border: none; border-radius: 50%; background: var(--surface-2); color: var(--text-muted);
  font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
/* ⚠️この当たり判定はボタンの外へはみ出している。親に overflow:hidden を足すと
   黙って切り取られ、見た目は変わらないまま押しにくさだけ戻る。 */
.x-btn::after { content: ''; position: absolute; inset: -6px; } /* 32+6+6 = 44 */
.x-btn:active { transform: scale(.96); }
/* 全画面で出るものは画面の右上に置く（カードの中に流し込むものは何も付けない） */
.x-btn.x-fixed { position: absolute; top: calc(14px + var(--safe-top)); right: 14px; z-index: 3; }
/* 写真やポスターの上に載るもの */
.x-btn.on-dark { background: rgba(255,255,255,.14); color: #fff; backdrop-filter: blur(6px); }
```

- [ ] **Step 4: 通ることを確認する**

ブラウザを再読み込みして `#out` を読む。
Expected: `✅ ALL PASS`（10件）。

- [ ] **Step 5: コミット（検査ページは含めない）**

```bash
git add style.css
git commit -m "feat(ui): add the one close button the whole app will use"
```

---

### Task 2: 取りこぼしを見張る検査スクリプト

閉じるボタンは10箇所に散っている。手で寄せると必ずどれか忘れるので、機械で数える。

**Files:**
- Create: `scripts/close-buttons-check.mjs`

- [ ] **Step 1: スクリプトを書く**

```js
// 「閉じる」ボタンが全部そろって .x-btn を使っているか数える。
// 閉じるボタンには必ず aria-label="閉じる" が付いているので、それを目印にする。
// 使い方: node scripts/close-buttons-check.mjs
import fs from 'node:fs';

// 例外: ふりかえりに戻る帯の×は、帯の一部なので丸くしない（当たり判定だけ合わせてある）
const ALLOWED_WITHOUT = ['rb-x'];

const files = ['index.html', ...fs.readdirSync('js').map((f) => 'js/' + f)];
let total = 0;
let bad = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!line.includes('aria-label="閉じる"')) return;
    total += 1;
    if (line.includes('x-btn')) return;
    if (ALLOWED_WITHOUT.some((c) => line.includes(c))) return;
    bad += 1;
    console.log('FAIL ' + file + ':' + (i + 1) + '  x-btn が付いていない');
    console.log('     ' + line.trim().slice(0, 110));
  });
}
console.log('閉じるボタン ' + total + '件、そろっていないもの ' + bad + '件');
console.log(bad === 0 ? '✅ close-buttons ALL PASS' : '❌ FAILED');
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: 走らせて、落ちることを確認する**

```bash
node scripts/close-buttons-check.mjs
```

Expected: **FAIL が並ぶ**（この時点ではまだどこも `x-btn` を使っていない）。最後に
`❌ FAILED` が出て終了コードが 1 になること。何件出たかを報告する。

- [ ] **Step 3: コミット**

```bash
git add scripts/close-buttons-check.mjs
git commit -m "test(ui): count the close buttons that have not been lined up yet"
```

---

### Task 3: カードの右上グループを寄せる

カードやシートの中に流し込むもの。`.x-fixed` は付けない。

**Files:**
- Modify: `index.html`（123行目・138行目）
- Modify: `js/genre-edit.js`（104行目）、`js/trip-edit.js`（69行目・115行目）
- Modify: `js/memories.js`（90行目）、`js/review-ui.js`（723行目）
- Modify: `style.css`

- [ ] **Step 1: マークアップに `x-btn` を付ける**

`index.html` 123行目:
```html
      <button id="sheet-close" class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button>
```

`index.html` 138行目（`set-x` を捨てて `x-btn` にする。`id` はJSが使っているので残す）:
```html
          <button id="settings-close" class="x-btn" type="button" aria-label="閉じる"><i class="ph ph-x"></i></button>
```

`js/genre-edit.js` 104行目・`js/trip-edit.js` 69行目・115行目（**3箇所とも同じ形**）:
```js
        '<button class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button></div>' +
```
**⚠️JS側は `querySelector('.ge-x')` でこのボタンを掴んでいる。** `js/genre-edit.js` と
`js/trip-edit.js` の `.ge-x` を使っている行を**すべて** `.x-btn` に直すこと
（`grep -n "ge-x" js/genre-edit.js js/trip-edit.js` で数える。マークアップ3箇所＋取得3箇所の計6箇所）。

`js/memories.js` 90行目:
```js
      + '<button type="button" class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button>'
```
**⚠️`.mem-x` を取得している行も `.x-btn` に直す**（`grep -n "mem-x" js/memories.js`）。

`js/review-ui.js` 723行目:
```js
      '<button class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button></div>';
```
**⚠️`.rv-card-x` を取得している行も直す**（`grep -n "rv-card-x" js/review-ui.js`）。

- [ ] **Step 2: 古いCSSを消す／縮める**

`style.css` から次の3つのルールを**丸ごと削除**する（`.x-btn` と同じ内容になったため）:
- `.set-x { ... }`（460行目付近）
- `.ge-x { ... }`（1140行目付近）
- `.mem-x { ... }`（263行目付近）

`#sheet-close`（286行目付近）は**位置だけ残す**。見た目は `.x-btn` が持つ:
```css
/* シートの右上。見た目は .x-btn。ここは画面ではなくシートの角に付ける */
#sheet-close { position: absolute; top: 10px; right: 12px; z-index: 6; }
```

`.rv-card-x` の指定（1125行目付近の `.rv-card-x { position: static; ... }`）を**削除**する。
1つ上の `.rv-x, .rv-card-x { ... }` の共有ルールからは **`.rv-card-x` だけを外す**（`.rv-x` は Task 4 で扱う）:
```css
.rv-x { position: absolute; top: calc(14px + var(--safe-top)); right: 14px; z-index: 3; background: var(--surface-2);
```

- [ ] **Step 3: 検査を走らせる**

```bash
node scripts/close-buttons-check.mjs
```
Expected: 前より FAIL が減っている（`rv-x` と `lb-close` の残りだけになる）。まだ `❌ FAILED`。
何件残っているかを報告する。

- [ ] **Step 4: 構文を確認する**

```bash
node --check js/genre-edit.js && node --check js/trip-edit.js && node --check js/memories.js && node --check js/review-ui.js
```
Expected: 何も出力せず終了。

- [ ] **Step 5: コミット**

```bash
git add index.html style.css js/genre-edit.js js/trip-edit.js js/memories.js js/review-ui.js
git commit -m "refactor(ui): line up the closes that sit inside a card"
```

---

### Task 4: 画面の右上グループを寄せる

**Files:**
- Modify: `js/review-ui.js`（305行目・542行目・692行目）、`js/lightbox.js`（13行目）
- Modify: `style.css`

- [ ] **Step 1: マークアップを直す**

`js/review-ui.js` 305行目・542行目・692行目（**3箇所とも同じ形**）:
```js
      '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
```
**⚠️`.rv-x` を取得している行もすべて `.x-btn` に直す**（`grep -n "rv-x" js/review-ui.js` で数える）。
取得は `host.querySelector('.rv-x')` の形なので `host.querySelector('.x-btn')` にする。
`#review-show` `#review-page` にはそれぞれ×が1つしか無いので、これで正しく取れる。
**確かめ方**: 直したあと `grep -c "querySelector('.x-btn')" js/review-ui.js` の数と、
`grep -c 'class="x-btn' js/review-ui.js` の数が釣り合うこと（×1つにつき取得1つ）。

`js/lightbox.js` 13行目:
```js
      '<button class="x-btn x-fixed on-dark" aria-label="閉じる"><i class="ph ph-x"></i></button>'
```
**⚠️`.lb-close` を取得している行も直す**（`grep -n "lb-close" js/lightbox.js`）。

- [ ] **Step 2: 古いCSSを消す**

`style.css` から `.rv-x { ... }`（980行目付近・Task 3 で `.rv-card-x` を外した残り）を**丸ごと削除**する。

`.lb-close, .lb-prev, .lb-next { ... }`（391行目付近）から **`.lb-close` を外す**:
```css
.lb-prev, .lb-next { position: absolute; color: #fff; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.10); border-radius: var(--radius-pill); backdrop-filter: blur(6px); }
```
`.lb-close { top: ...; right: 16px; width: 44px; height: 44px; font-size: 22px; }`（393行目）は**丸ごと削除**。
位置は `.x-fixed`（上 `14px+safe-top` / 右 `14px`）に、見た目は `.on-dark` に変わる。
**これは意図した変化**: 44pxの大きな白丸が32pxになり、位置が2px動く。当たり判定は44pxのまま。

- [ ] **Step 3: 検査を走らせる**

```bash
node scripts/close-buttons-check.mjs
```
Expected: `✅ close-buttons ALL PASS`（終了コード0）。

- [ ] **Step 4: 構文を確認する**

```bash
node --check js/review-ui.js && node --check js/lightbox.js
```
Expected: 何も出力せず終了。

- [ ] **Step 5: コミット**

```bash
git add style.css js/review-ui.js js/lightbox.js
git commit -m "refactor(ui): line up the closes that sit at the top of the screen"
```

---

### Task 5: 文字ボタンを×にする

「閉じる」という文字の横長ボタンが2つある。これを右上の×に替える。

**Files:**
- Modify: `js/review-ui.js`（608行目・630行目・444行目）
- Modify: `style.css`

- [ ] **Step 1: 期間ピッカーの「閉じる」を×にする（2箇所）**

`js/review-ui.js` 608行目は記録が0件のときの画面、630行目は通常のピッカー。**どちらも**
`'<button class="rv-btn rv-close">閉じる</button>'` を含んでいる。両方から**その部分を消し**、
代わりに同じ `host.innerHTML` の**先頭**（`'<div class="rv-picker">'` の直前）に×を足す。

608行目まわりは、こう変える:
```js
      host.innerHTML = '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
        '<div class="rv-picker"><div class="rv-picker-head">ふりかえり</div>' +
        '<p class="rv-empty">まだ記録がありません。おでかけを記録するとここに出ます。</p>' +
        '</div>';
```
630行目まわり（通常のピッカー）も同じく、先頭に×を足し、末尾の
`'<button class="rv-btn rv-close">閉じる</button>'` を消す。

**⚠️`host.querySelector('.rv-close').onclick = hideAll;` が2箇所にある。**
どちらも `host.querySelector('.x-btn').onclick = hideAll;` に直す。

- [ ] **Step 2: ポスタープレビューの「閉じる」を×にする**

`js/review-ui.js` 444行目の `'<button class="pv-close">閉じる</button>' +` を**消し**、
`'<div class="pv-wrap">'`（440行目）の**直前**に足す:
```js
      '<button class="x-btn x-fixed on-dark" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
```
**⚠️`host.querySelector('.pv-close').onclick = ...`（447行目付近）を
`host.querySelector('.x-btn').onclick = ...` に直す。** 中の処理は変えない。

これで下のボタンは「共有・保存」だけになる。

- [ ] **Step 3: 古いCSSを消す**

`style.css` から `.rv-close { ... }`（1073行目付近）と `.pv-close { ... }`（1068行目付近）を
**丸ごと削除**する。

- [ ] **Step 4: 検査と構文**

```bash
node scripts/close-buttons-check.mjs && node --check js/review-ui.js
```
Expected: `✅ close-buttons ALL PASS`、構文エラーなし。
**さらに `grep -n "rv-close\|pv-close" js/review-ui.js style.css` が何も返さないこと**を確かめる。

- [ ] **Step 5: コミット**

```bash
git add style.css js/review-ui.js
git commit -m "refactor(ui): turn the two 閉じる text buttons into the same ×"
```

---

### Task 6: まとめて追加の×を右上へ、戻る帯の当たり判定

**Files:**
- Modify: `js/bulk.js`（201行目）、`style.css`

- [ ] **Step 1: まとめて追加の×を直す**

`js/bulk.js` 201行目。いまは**見出しの左**にあり、アイコンではなく `✕` の文字。
見出しの**右**へ移し、他と同じアイコンにする。`.bulk-head` の中で、`<div class="bulk-title">` の**後ろ**に置く:

```js
      <div class="bulk-head">
        <div class="bulk-title">まとめて追加</div>
        <button id="bulk-cancel" class="x-btn" type="button" aria-label="閉じる"><i class="ph ph-x"></i></button>
      </div>
```
`id="bulk-cancel"` はJSが使っているので**必ず残す**。

- [ ] **Step 2: 見出しを両端に開く**

`style.css` の `.bulk-head`（794行目付近）に `justify-content: space-between;` を足す
（設定の `.set-head` と同じ形にする）:
```css
.bulk-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
```
`.bulk-x { ... }`（795行目付近）は**丸ごと削除**する。

- [ ] **Step 3: 戻る帯の×の当たり判定を44pxにする**

`style.css` の `#review-back .rb-x`（869行目付近）は
`padding: 11px 14px 11px 6px;` で高さが足りない。縦を44pxにする:
```css
#review-back .rb-x { background: none; border: 0; padding: 14px 15px 14px 7px;
```
**丸にはしない。** 帯の一部なので形は変えず、指が届く大きさだけ合わせる。

- [ ] **Step 4: 検査と構文**

```bash
node scripts/close-buttons-check.mjs && node --check js/bulk.js
```
Expected: `✅ close-buttons ALL PASS`、構文エラーなし。
`grep -n "bulk-x" js/bulk.js style.css` が何も返さないことも確かめる。

- [ ] **Step 5: コミット**

```bash
git add style.css js/bulk.js
git commit -m "refactor(ui): move bulk import's × to the right, like everything else"
```

---

### Task 7: 検査を通して、版を上げて出す

**Files:**
- Modify: `index.html`
- Delete: `x-btn-check.html`（一時ファイル）

- [ ] **Step 1: CSSの契約をもう一度ブラウザで測る**

Task 1 のサーバを立て直し、`http://localhost:8791/x-btn-check.html` を開いて `#out` を読む。
Expected: `✅ ALL PASS`（10件）。

- [ ] **Step 2: 全部の検査を走らせる**

```bash
node scripts/close-buttons-check.mjs
```
Expected: `✅ close-buttons ALL PASS`

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-stats.js');App.reviewStats._selfTest()"
```
Expected: `✅ review-stats ALL PASS`

```bash
node -e "global.window={};global.App=global.window.App={};require('./js/review-poster.js');App.reviewPoster._selfTest()"
```
Expected: `ALL PASS (poster)`

- [ ] **Step 3: 一時ファイルを消す**

```bash
rm x-btn-check.html
```
`git status --short` に `x-btn-check.html` が出ないことを確かめる。

- [ ] **Step 4: 版を上げる**

```bash
sed -i s/20260827v/20260827w/g index.html
```
```bash
grep -c 20260827v index.html
```
Expected: `0`

- [ ] **Step 5: コミットして出す**

```bash
git add index.html
git commit -m "chore: ship the one close button as 20260827w"
```
その後 `git push origin main`。

- [ ] **Step 6: 本人に伝える**

返信の末尾に **本番ver `20260827w`** と書く。

---

## 実機で確かめてもらうこと

**エージェント側からは見た目を確認できない**（Googleログインとライブ Maps が要るため）。
測れるのはCSSの計算値とマークアップの網羅までで、**カードの中で×が浮いていないか等は目で見るしかない**。

- [ ] 下シート（記録をタップ）の×が右上にあり、押しやすい
- [ ] 設定 → ×／ジャンル編集 → ×／旅行 → ×（今日直した「潜る」問題が再発していないことも）
- [ ] ふりかえり → **期間ピッカーの下に「閉じる」が無く、右上に×がある**
- [ ] ふりかえりのスライド → 右上の×
- [ ] ポスタープレビュー → 下は「共有・保存」だけ、右上に×
- [ ] 写真をタップ（ライトボックス）→ **×が少し小さくなっている**。押しにくくないか
- [ ] まとめて追加 → **×が右上に移っている**（前は左上）
- [ ] 思い出カード（1年前の今日）の×が、カードに対して大きすぎないか
- [ ] ふりかえりに戻る帯の×が押しやすくなったか。押すと絞り込みも戻る動きは前のまま
