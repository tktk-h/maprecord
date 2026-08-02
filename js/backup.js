window.App = window.App || {};
App.backup = (function () {
  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  async function exportJson() {
    const records = await App.db.getAll();
    const out = [];
    for (const r of records) {
      const photos = [];
      for (const b of (r.photos || [])) photos.push(await blobToDataURL(b));
      out.push({ ...r, photos });
    }
    const blob = new Blob([JSON.stringify({ version: 1, records: out }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `date-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // merge=false なら既存を全消去して置き換え
  async function importJson(file, merge) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.records)) throw new Error('不正なファイル形式');
    if (!merge) await App.db.clear();
    for (const r of data.records) {
      const photos = [];
      for (const d of (r.photos || [])) photos.push(await dataURLToBlob(d));
      const rec = { date: r.date, name: r.name, genre: r.genre,
        lat: r.lat, lng: r.lng, memo: r.memo,
        tags: r.tags || [], order: r.order, photos };
      await App.db.add(rec); // idは再採番（重複回避）
    }
  }

  return { exportJson, importJson };
})();
