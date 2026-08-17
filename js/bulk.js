window.App = window.App || {};
// 一括アップロード＋自動グループ化の入口・確認UI・保存。
App.bulk = (function () {
  let groups = [];          // 下書きグループ（下記 shape）
  let fileInput = null;

  // 隠しファイル入力を用意して一括選択を促す
  function open() {
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
    groups = raw.map((g) => ({
      photos: g.idx.map((i) => ({ file: files[i], time: metas[i].time, gps: metas[i].gps, url: URL.createObjectURL(files[i]) }))
                     .sort((a, b) => a.time - b.time),
      date: g.date,
      center: g.center,
      hasGps: g.hasGps,
      placeId: null,
      place: null,     // {lat,lng} 紐付けた店の座標
      name: '',        // 店名（紐付けで入る／未設定は空）
      genre: 'food',
    }));
    console.log('bulk groups', groups); // Task 4 でUI描画に差し替え
    renderReview();
  }

  function showLoading(n) {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = false;
    ov.innerHTML = `<div class="bulk-loading">写真を読み込み中…（${n}枚）</div>`;
  }

  function close() {
    const ov = document.getElementById('bulk-overlay');
    ov.hidden = true; ov.innerHTML = '';
    for (const g of groups) for (const p of g.photos) URL.revokeObjectURL(p.url);
    groups = [];
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
    const noGpsTag = g.hasGps ? '' : '<span class="bulk-tag">場所未設定</span>';
    const placeBtn = g.name
      ? `<button class="bulk-place set" data-i="${i}">📍 ${esc(g.name)} ・ 変更</button>`
      : `<button class="bulk-place" data-i="${i}">📍 店名を検索して紐付け${g.hasGps ? '' : '（GPSなし）'}</button>`;
    const strip = g.photos.map((p, j) =>
      `<div class="bulk-ph" data-i="${i}" data-j="${j}" style="background-image:url(${p.url})"></div>`).join('');
    const mergeBtn = i > 0 ? `<button class="bulk-act" data-act="merge" data-i="${i}">↑ 前と結合</button>` : '';
    return `
      <div class="bulk-card" data-i="${i}">
        <div class="bulk-top">
          <div class="bulk-cover" style="background-image:url(${cover})"><span>${g.photos.length}枚</span></div>
          <div class="bulk-meta">
            <div class="bulk-date">${g.date} <span class="bulk-count">${timeRange} ・ ${g.photos.length}枚</span>${noGpsTag}</div>
            ${placeBtn}
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
    ov.innerHTML = `
      <div class="bulk-head">
        <button id="bulk-cancel" class="bulk-x">✕</button>
        <div class="bulk-title">確認・修正</div>
      </div>
      <div class="bulk-lead">${countPhotos()}枚を ${groups.length}グループに整理しました。直してまとめて保存。</div>
      <div id="bulk-list">${groups.map(cardHtml).join('')}</div>
      <button id="bulk-save" class="bulk-save">すべて保存（${saveableCount()}件の記録をつくる）</button>`;
    document.getElementById('bulk-cancel').onclick = close;
    wireCards(); // Task 5-6 で実装（この時点では空でよい）
  }

  function countPhotos() { return groups.reduce((n, g) => n + g.photos.length, 0); }
  function groupLatLng(g) { return g.hasGps ? g.center : g.place; }        // 保存座標
  function saveableCount() { return groups.filter((g) => groupLatLng(g)).length; }
  function wireCards() {
    const list = document.getElementById('bulk-list');
    if (!list) return;
    list.querySelectorAll('.bulk-act').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i), act = btn.dataset.act;
        if (act === 'merge') mergeUp(i);
        else if (act === 'del') { groups.splice(i, 1); renderReview(); }
        else if (act === 'split') doSplit(i);
      };
    });
    list.querySelectorAll('.bulk-genre').forEach((sel) => {
      sel.onchange = () => { groups[Number(sel.dataset.i)].genre = sel.value; };
    });
    list.querySelectorAll('.bulk-datefld').forEach((inp) => {
      inp.onchange = () => { groups[Number(inp.dataset.i)].date = inp.value; };
    });
    list.querySelectorAll('.bulk-place').forEach((btn) => {
      btn.onclick = () => openPlaceSearch(Number(btn.dataset.i)); // Task 6
    });
    wireStrip(); // Task 6（分割の写真選択）
    const save = document.getElementById('bulk-save');
    if (save) save.onclick = doSave; // Task 7
  }

  // i番目を i-1 に統合。座標/場所は「結合先(前)」を優先し、無ければ自分のを引き継ぐ。
  function mergeUp(i) {
    if (i <= 0) return;
    const prev = groups[i - 1], g = groups[i];
    prev.photos = prev.photos.concat(g.photos).sort((a, b) => a.time - b.time);
    if (!prev.hasGps && g.hasGps) { prev.hasGps = true; prev.center = g.center; }
    if (!prev.placeId && g.placeId) { prev.placeId = g.placeId; prev.place = g.place; prev.name = g.name; }
    prev.date = App.grouping.dateOf(prev.photos[0].time); // 最早写真の日
    groups.splice(i, 1);
    renderReview();
  }

  function doSplit(i) { /* Task 6 */ }
  function openPlaceSearch(i) { /* Task 6 */ }
  function wireStrip() { /* Task 6 */ }
  function doSave() { /* Task 7 */ }

  function init() {
    const btn = document.getElementById('bulk-btn');
    if (btn) btn.onclick = open;
  }

  return { init, open, close, _groups: () => groups };
})();
document.addEventListener('DOMContentLoaded', () => { if (App.bulk) App.bulk.init(); });
if (document.readyState !== 'loading' && App.bulk) App.bulk.init();
