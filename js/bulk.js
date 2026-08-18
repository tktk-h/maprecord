window.App = window.App || {};
// 一括アップロード＋自動グループ化の入口・確認UI・保存。
App.bulk = (function () {
  let groups = [];          // いま表示中の下書きグループ
  let pending = [];         // 退避中の未保存カード（別バッチ作業中は隠すが消さない）
  let fileInput = null;

  // 「まとめて追加」画面を開く。退避していた未保存カードを表示に戻す（写真選択はしない）
  function open() {
    if (pending.length) { groups = groups.concat(pending); pending = []; }
    renderReview();
  }
  // 実際のファイル選択（「＋写真を追加」から呼ぶ）
  function pickFiles() {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true;
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        if (files.length) handleFiles(files);
      });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  // File → { time(ms), gps:{lat,lng}|null }
  async function readMeta(file) {
    let time = null, gps = null;
    if (window.exifr) {
      try { const g = await exifr.gps(file);
        if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') gps = { lat: g.latitude, lng: g.longitude }; } catch (_) {}
      try { const m = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
        const dt = m && (m.DateTimeOriginal || m.CreateDate || m.ModifyDate);
        if (dt) time = new Date(dt).getTime(); } catch (_) {}
    }
    if (time == null) time = file.lastModified || Date.now(); // フォールバック
    return { time, gps };
  }

  async function handleFiles(files) {
    showLoading(files.length);
    const metas = [];
    for (const f of files) metas.push(await readMeta(f));
    const raw = App.grouping.groupPhotos(metas.map((m) => ({ time: m.time, gps: m.gps })));
    // 元indexを実ファイルに戻して下書きグループを組む
    const added = raw.map((g) => ({
      photos: g.idx.map((i) => ({ file: files[i], time: metas[i].time, gps: metas[i].gps, url: URL.createObjectURL(files[i]) }))
                     .sort((a, b) => a.time - b.time),
      date: g.date,
      center: g.center,
      hasGps: g.hasGps,
      placeId: null,
      place: null,     // {lat,lng} 紐付けた店の座標
      manualLoc: null, // {lat,lng} 地図で手動に置いたピン（最優先）
      name: '',        // 店名（紐付け／手入力で入る）
      genre: 'food',
      candidates: [],  // 近くの店候補（AI提案で入る）
      aiState: 'idle', // 'idle' | 'loading' | 'done'
      aiPickId: null,  // Geminiが選んだ placeId（チップの✨用）
    }));
    pending = pending.concat(groups); // 表示中の未保存カードは退避（消さない）
    groups = added;                    // 今回追加したぶんだけを表示
    renderReview();
    autoSuggestAll();                  // 位置ありグループを順にAI提案（awaitしない）
  }

  function showLoading(n) {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = false;
    ov.innerHTML = `<div class="bulk-loading">写真を読み込み中…（${n}枚）</div>`;
  }

  function close() {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = true; ov.innerHTML = '';
    for (const g of groups.concat(pending)) for (const p of g.photos) URL.revokeObjectURL(p.url);
    groups = []; pending = [];
  }

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 'HH:MM'
  function hhmm(ms) { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
  function genreOptions(sel) {
    return App.genres.list.map((g) => `<option value="${g.key}" ${g.key === sel ? 'selected' : ''}>${g.label}</option>`).join('');
  }

  function cardHtml(g, i) {
    const first = g.photos[0], last = g.photos[g.photos.length - 1];
    const cover = g.photos[0].url;
    const timeRange = g.photos.length > 1 ? `${hhmm(first.time)}〜${hhmm(last.time)}` : hhmm(first.time);
    const strip = g.photos.map((p, j) =>
      `<div class="bulk-ph" data-i="${i}" data-j="${j}" style="background-image:url(${p.url})"></div>`).join('');
    const mergeBtn = i > 0 ? `<button class="bulk-act" data-act="merge" data-i="${i}">↑ 前と結合</button>` : '';
    return `
      <div class="bulk-card${isSaveable(g) ? '' : ' incomplete'}" data-i="${i}">
        <div class="bulk-top">
          <div class="bulk-cover" style="background-image:url(${cover})"><span>${g.photos.length}枚</span></div>
          <div class="bulk-meta">
            <div class="bulk-date">${g.date} <span class="bulk-count">${timeRange} ・ ${g.photos.length}枚</span></div>
            <div class="bulk-badge">${esc(missingMsg(g))}</div>
            <input class="bulk-name" type="text" placeholder="場所の名前（必須）" value="${esc(g.name || '')}" data-i="${i}">
            ${aiAreaHtml(g, i)}
            <div class="bulk-locrow">
              <button class="bulk-locbtn" data-act="search" data-i="${i}">🔍 店名で検索</button>
              <button class="bulk-locbtn" data-act="pin" data-i="${i}">🗺 地図でピン</button>
              <span class="bulk-locstat">${locStatus(g)}</span>
            </div>
            <div class="bulk-fields">
              <select class="bulk-genre" data-i="${i}">${genreOptions(g.genre)}</select>
              <input class="bulk-datefld" type="date" value="${g.date}" data-i="${i}">
            </div>
          </div>
        </div>
        <div class="bulk-strip">${strip}</div>
        <div class="bulk-splithint">▸ 写真をタップ →「ここで分割」でその位置から下を別グループに</div>
        <div class="bulk-acts">
          ${mergeBtn}
          <button class="bulk-act" data-act="split" data-i="${i}" disabled>✂️ ここで分割</button>
          <button class="bulk-act warn" data-act="del" data-i="${i}">🗑 削除</button>
        </div>
      </div>`;
  }

  function renderReview() {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = false;
    const lead = groups.length
      ? `${countPhotos()}枚を ${groups.length}グループに整理しました。直してまとめて保存。`
      : '「＋写真を追加」で写真を選ぶと、日付と場所で自動グループ分けします。';
    ov.innerHTML = `
      <div class="bulk-head">
        <button id="bulk-cancel" class="bulk-x">✕</button>
        <div class="bulk-title">まとめて追加</div>
      </div>
      <button id="bulk-add" class="bulk-addbtn">＋ 写真を追加</button>
      <div class="bulk-lead">${lead}</div>
      <div id="bulk-list">${groups.map(cardHtml).join('')}</div>
      ${groups.length ? saveButtonHtml() : ''}`;
    document.getElementById('bulk-cancel').onclick = hide;
    document.getElementById('bulk-add').onclick = pickFiles;
    wireCards();
  }

  // ×：閉じるだけ。表示中の未保存カードは退避して保持（再オープンで戻る）
  function hide() {
    pending = pending.concat(groups); groups = [];
    document.getElementById('bulk-overlay').hidden = true;
  }

  // 保存ボタン。場所を選んだグループが0なら無効化して促す。
  function saveButtonHtml() {
    const n = saveableCount();
    return n
      ? `<button id="bulk-save" class="bulk-save">すべて保存（${n}件の記録をつくる）</button>`
      : `<button id="bulk-save" class="bulk-save" disabled>各グループに名前と場所を入れてください</button>`;
  }
  // 名前入力などで保存可能数が変わったら、フォーカスを保ったままボタンだけ差し替える
  function refreshSaveButton() {
    const old = document.getElementById('bulk-save');
    if (!old) return;
    const tmp = document.createElement('div'); tmp.innerHTML = saveButtonHtml();
    const fresh = tmp.firstElementChild;
    old.replaceWith(fresh);
    fresh.onclick = doSave;
  }
  function countPhotos() { return groups.reduce((n, g) => n + g.photos.length, 0); }
  // 保存座標：手動ピン優先 → GPS中心 → 検索店。無ければ null。
  function groupLatLng(g) { return g.manualLoc || (g.hasGps ? g.center : g.place) || null; }
  // 保存できるのは「名前あり かつ 位置あり」のグループだけ（名無しピンを作らない）
  function isSaveable(g) { return !!(g.name && g.name.trim()) && !!groupLatLng(g); }

  // 保存に足りない項目のメッセージ（揃っていれば空文字）
  function missingMsg(g) {
    const noName = !(g.name && g.name.trim());
    const noLoc = !groupLatLng(g);
    if (noName && noLoc) return '⚠️ 店名と場所が未入力';
    if (noName) return '⚠️ 店名を入力してください';
    if (noLoc) return '⚠️ 場所を設定してください';
    return '';
  }

  // カードi の「未入力」表示（枠色＋バッジ）を再描画せずに更新（入力フォーカスを保つ）
  function updateCardStatus(i) {
    const el = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!el) return;
    el.classList.toggle('incomplete', !isSaveable(groups[i]));
    const badge = el.querySelector('.bulk-badge');
    if (badge) badge.textContent = missingMsg(groups[i]);
  }
  function saveableCount() { return groups.filter(isSaveable).length; }
  // 位置の由来を1行で
  function locStatus(g) {
    if (g.manualLoc) return '📍 地図ピン';
    if (g.placeId) return '📍 検索した店';
    if (g.hasGps) return '📍 写真のGPS';
    return '⚠️ 位置なし';
  }

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
      const cands = await App.places.nearbyPlaces(loc.lat, loc.lng, { radius: 250, max: 20 });
      g.candidates = cands || [];
      if (g.candidates.length) {
        const thumb = await App.photos.compressToBlob(g.photos[0].file, 400);
        const imageBase64 = await blobToBase64(thumb);
        const r = await App.fb.suggestPlace({
          imageBase64,
          candidates: g.candidates.map((c) => ({ placeId: c.placeId, name: c.name, genre: c.genre })),
        });
        const pid = r && r.data && r.data.placeId;
        // Geminiが写真から自信を持って選べた店だけ、最初から反映（✨）。
        // 迷った時（-1）は入れない＝無関係な近所の店を勝手に入れない。
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
  function wireCards() {
    const list = document.getElementById('bulk-list');
    if (!list) return;
    list.querySelectorAll('.bulk-act').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), act = btn.dataset.act;
        if (act === 'merge') mergeUp(i);
        else if (act === 'del') { for (const p of groups[i].photos) URL.revokeObjectURL(p.url); groups.splice(i, 1); renderReview(); }
        else if (act === 'split') doSplit(i);
      };
    });
    list.querySelectorAll('.bulk-genre').forEach((sel) => {
      sel.onchange = () => { groups[Number(sel.dataset.i)].genre = sel.value; };
    });
    list.querySelectorAll('.bulk-datefld').forEach((inp) => {
      inp.onchange = () => { groups[Number(inp.dataset.i)].date = inp.value; };
    });
    list.querySelectorAll('.bulk-name').forEach((inp) => {
      inp.oninput = () => { const i = Number(inp.dataset.i); groups[i].name = inp.value; updateCardStatus(i); refreshSaveButton(); };
    });
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
    wireStrip(); // 分割の写真選択
    const save = document.getElementById('bulk-save');
    if (save) save.onclick = doSave; // Task 7
  }

  // i番目を i-1 に統合。座標/場所は「結合先(前)」を優先し、無ければ自分のを引き継ぐ。
  function mergeUp(i) {
    if (i <= 0) return;
    const prev = groups[i - 1], g = groups[i];
    prev.photos = prev.photos.concat(g.photos).sort((a, b) => a.time - b.time);
    if (!prev.hasGps && g.hasGps) { prev.hasGps = true; prev.center = g.center; }
    if (!prev.manualLoc && g.manualLoc) prev.manualLoc = g.manualLoc;
    if (!prev.placeId && g.placeId) { prev.placeId = g.placeId; prev.place = g.place; prev.name = g.name; }
    prev.date = App.grouping.dateOf(prev.photos[0].time); // 最早写真の日
    groups.splice(i, 1);
    renderReview();
  }

  let splitSel = { i: -1, j: -1 }; // 選択中の分割起点

  function wireStrip() {
    splitSel = { i: -1, j: -1 };
    document.querySelectorAll('.bulk-ph').forEach((el) => {
      el.onclick = () => {
        const i = Number(el.dataset.i), j = Number(el.dataset.j);
        if (j === 0) return; // 先頭では分割不要
        document.querySelectorAll(`.bulk-ph[data-i="${i}"]`).forEach((x) => x.classList.remove('sel'));
        el.classList.add('sel');
        splitSel = { i, j };
        const btn = document.querySelector(`.bulk-act[data-act="split"][data-i="${i}"]`);
        if (btn) btn.disabled = false;
      };
    });
  }

  // 選択した写真(j)から後ろを新グループに切り出す
  function doSplit(i) {
    if (splitSel.i !== i || splitSel.j <= 0) return;
    const g = groups[i];
    const tail = g.photos.splice(splitSel.j); // j以降
    const newG = {
      photos: tail, date: App.grouping.dateOf(tail[0].time),
      center: null, hasGps: false, placeId: null, place: null, manualLoc: null, name: '', genre: g.genre,
      candidates: [], aiState: 'idle', aiPickId: null,
    };
    // 新グループのGPS再計算（tailにGPSがあれば）
    const pts = tail.filter((p) => p.gps).map((p) => p.gps);
    if (pts.length) { newG.hasGps = true; newG.center = App.grouping.centroid(pts); }
    // 元グループのGPS/日付も再計算
    const headPts = g.photos.filter((p) => p.gps).map((p) => p.gps);
    g.hasGps = headPts.length > 0; g.center = headPts.length ? App.grouping.centroid(headPts) : null;
    g.date = App.grouping.dateOf(g.photos[0].time);
    groups.splice(i + 1, 0, newG); // 時系列的に直後へ
    renderReview();
  }

  function openPlaceSearch(i) {
    const g = groups[i];
    const card = document.querySelector(`.bulk-card[data-i="${i}"]`);
    if (!card) return;
    let box = card.querySelector('.bulk-placebox');
    if (box) { box.remove(); return; } // トグル
    box = document.createElement('div');
    box.className = 'bulk-placebox';
    box.innerHTML = `
      <input type="text" class="bulk-pq" placeholder="店名で検索" value="${esc(g.name || '')}">
      <button type="button" class="bulk-psearch">検索</button>
      <div class="bulk-presults"></div>`;
    card.querySelector('.bulk-meta').appendChild(box);
    const q = box.querySelector('.bulk-pq'), results = box.querySelector('.bulk-presults');
    async function run() {
      const text = q.value.trim(); if (!text) return;
      results.innerHTML = '<span class="bulk-hint">検索中…</span>';
      try {
        const opts = g.center ? { bias: { center: g.center, radius: 3000 } } : {};
        const places = await App.places.searchText(text, opts);
        if (!places.length) { results.innerHTML = '<span class="bulk-hint">該当なし</span>'; return; }
        results.innerHTML = places.slice(0, 6).map((p, k) => `<button type="button" class="bulk-pick" data-k="${k}">${esc(p.name)}</button>`).join('');
        results.querySelectorAll('.bulk-pick').forEach((b) => {
          b.onclick = () => {
            const p = places[Number(b.dataset.k)];
            g.placeId = p.placeId; g.place = { lat: p.lat, lng: p.lng }; g.name = p.name;
            g.manualLoc = null; // 検索で選んだらその店の位置を優先
            if (p.genre) g.genre = p.genre;
            renderReview();
          };
        });
      } catch (_) { results.innerHTML = '<span class="bulk-hint">検索できませんでした</span>'; }
    }
    box.querySelector('.bulk-psearch').onclick = run;
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    q.focus();
  }
  // 地図の現在の中心（ピン初期位置のフォールバック）
  function mapCenter() {
    try { const c = App.map._getMap().getCenter(); return { lat: c.lat(), lng: c.lng() }; }
    catch (_) { return { lat: 35.0116, lng: 135.7681 }; } // 京都あたり
  }

  // グループiの位置を「地図にピンを置いて」決める。オーバーレイを一旦隠して地図を出す。
  function pickLocationFor(i) {
    const start = groupLatLng(groups[i]) || mapCenter();
    document.getElementById('bulk-overlay').hidden = true; // 地図を見せる
    App.map.startPickLocation(start.lat, start.lng);
    showPickBar(i);
  }
  function showPickBar(i) {
    let bar = document.getElementById('bulk-pickbar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'bulk-pickbar'; document.body.appendChild(bar); }
    bar.innerHTML = `
      <div class="bulk-picksearch">
        <input type="text" id="bulk-pick-q" placeholder="店名で検索してピンを移動" value="${esc(groups[i].name || '')}">
        <button id="bulk-pick-search">検索</button>
      </div>
      <div id="bulk-pick-results" class="bulk-presults"></div>
      <div class="bulk-pickmsg">ピンをドラッグ、または検索した店をタップして位置を決めます</div>
      <div class="bulk-pickacts">
        <button id="bulk-pick-ok" class="bulk-pickok">この位置に決定</button>
        <button id="bulk-pick-cancel" class="bulk-pickcancel">キャンセル</button>
      </div>`;
    bar.hidden = false;
    const q = document.getElementById('bulk-pick-q');
    const results = document.getElementById('bulk-pick-results');
    async function run() {
      const text = q.value.trim(); if (!text) return;
      results.innerHTML = '<span class="bulk-hint">検索中…</span>';
      try {
        const cur = App.map.getPickedLatLng() || groupLatLng(groups[i]) || mapCenter();
        const places = await App.places.searchText(text, { bias: { center: cur, radius: 3000 } });
        if (!places.length) { results.innerHTML = '<span class="bulk-hint">該当なし</span>'; return; }
        results.innerHTML = places.slice(0, 6).map((p, k) => `<button type="button" class="bulk-pick" data-k="${k}">${esc(p.name)}</button>`).join('');
        results.querySelectorAll('.bulk-pick').forEach((b) => {
          b.onclick = () => {
            const p = places[Number(b.dataset.k)];
            groups[i].name = p.name; groups[i].placeId = p.placeId; groups[i].place = { lat: p.lat, lng: p.lng };
            if (p.genre) groups[i].genre = p.genre;
            App.map.startPickLocation(p.lat, p.lng); // ピンをその店へ移動（さらにドラッグで微調整可）
            results.innerHTML = '';
            const msg = bar.querySelector('.bulk-pickmsg');
            if (msg) msg.textContent = `「${p.name}」に移動しました。微調整はドラッグで。`;
          };
        });
      } catch (_) { results.innerHTML = '<span class="bulk-hint">検索できませんでした</span>'; }
    }
    document.getElementById('bulk-pick-search').onclick = run;
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    document.getElementById('bulk-pick-ok').onclick = () => finishPick(i, true);
    document.getElementById('bulk-pick-cancel').onclick = () => finishPick(i, false);
  }
  function finishPick(i, ok) {
    if (ok) { const p = App.map.getPickedLatLng(); if (p) groups[i].manualLoc = p; }
    App.map.stopPickLocation();
    const bar = document.getElementById('bulk-pickbar'); if (bar) bar.hidden = true;
    document.getElementById('bulk-overlay').hidden = false;
    renderReview();
  }

  async function doSave() {
    const saveBtn = document.getElementById('bulk-save');
    const targets = groups.filter(isSaveable);
    const skipped = groups.filter((g) => !isSaveable(g));
    if (!targets.length) { alert('保存できるグループがありません（各グループに店名を紐付けてください）'); return; }
    saveBtn.disabled = true;
    const failed = [];
    let done = 0;
    const all = App.records.getAll();
    for (const g of targets) {
      const loc = groupLatLng(g);
      saveBtn.textContent = `保存中… ${done + 1}/${targets.length}`;
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
        console.error('bulk save failed', err);
        failed.push(g);
      }
    }
    // 保存できたグループを除き、失敗＋位置なしを残す
    groups = failed.concat(skipped);
    if (!groups.length && pending.length) { groups = pending; pending = []; } // このバッチ完了→退避中の前カードを表示
    renderReview();
    if (!groups.length) alert(`${done}件を保存しました。`);
    else alert(`${done}件を保存しました。残り${groups.length}件（場所未選択 or 失敗）を確認してください。`);
  }

  function init() {
    const btn = document.getElementById('bulk-btn');
    if (btn) btn.onclick = open;
  }

  return { init, open, close, _groups: () => groups };
})();
document.addEventListener('DOMContentLoaded', () => { if (App.bulk) App.bulk.init(); });
if (document.readyState !== 'loading' && App.bulk) App.bulk.init();
