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

  function renderReview() { /* Task 4 で実装 */ }

  function init() {
    const btn = document.getElementById('bulk-btn');
    if (btn) btn.onclick = open;
  }

  return { init, open, close, _groups: () => groups };
})();
document.addEventListener('DOMContentLoaded', () => { if (App.bulk) App.bulk.init(); });
if (document.readyState !== 'loading' && App.bulk) App.bulk.init();
