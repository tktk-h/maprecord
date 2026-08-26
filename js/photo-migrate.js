window.App = window.App || {};
// 昔の方式（写真を base64 のまま記録に埋め込む）で保存した写真を、
// 今の方式（Cloud Storage に置いて記録には URL だけ持つ）へ移す一度きりの片づけ。
//
// 起動時は記録一式をまるごと受け取るので、埋め込み写真があるとその全バイトが
// 毎回ダウンロードされる（実測で写真12枚＝約4MB）。移せば数KBになる。
//
// 進め方は「1記録ずつ・上げてから書き換える」。書き換えに失敗したら、その記録で
// 上げたぶんは消してから次へ進む（Storage に持ち主のいないファイルを残さない）。
// 元の base64 は書き換えが成功した瞬間に置き換わるので、途中で止めても写真は失われない。
App.photoMigrate = (function () {
  // 昔の方式の写真か（url が data: で始まる）。純粋
  function isLegacy(photo) {
    return !!(photo && typeof photo.url === 'string' && photo.url.indexOf('data:') === 0);
  }
  // 記録の中の昔方式の写真の枚数。純粋
  function legacyCountOf(record) {
    return ((record && record.photos) || []).filter(isLegacy).length;
  }
  // 残っている枚数と記録数。純粋
  function pending(records) {
    let photos = 0;
    let recs = 0;
    (records || []).forEach((r) => {
      const n = legacyCountOf(r);
      if (n) { photos += n; recs += 1; }
    });
    return { photos, records: recs };
  }

  // data: URL → Blob
  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // onProgress(done, total) を任意で呼ぶ。戻り値 { total, moved, failed }
  async function run(onProgress) {
    const targets = App.records.getAll().filter((r) => legacyCountOf(r) > 0);
    const total = pending(targets).photos;
    let done = 0;
    let moved = 0;
    let failed = 0;

    for (const rec of targets) {
      const nextPhotos = [];
      const uploaded = [];
      try {
        for (const p of (rec.photos || [])) {
          if (!isLegacy(p)) { nextPhotos.push(p); continue; }
          const blob = await dataUrlToBlob(p.url);
          const stored = await App.photos.toStored(blob, rec.id);
          uploaded.push(stored);
          nextPhotos.push(stored);
          done += 1;
          if (onProgress) onProgress(done, total);
        }
        // ここで初めて記録が書き換わる＝base64 が消える
        await App.cloud.put({ id: rec.id, photos: nextPhotos });
        moved += uploaded.length;
      } catch (e) {
        console.error('photo migrate failed', rec.id, e);
        failed += uploaded.length || legacyCountOf(rec);
        // 記録に結びつかなかったファイルは置いていかない
        for (const u of uploaded) {
          try { await App.photos.deletePhotoFiles(u); } catch (_) { /* ベストエフォート */ }
        }
      }
    }
    return { total, moved, failed };
  }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails += 1;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('legacy-data-url', isLegacy({ url: 'data:image/jpeg;base64,xx' }), true);
    eq('legacy-storage', isLegacy({ url: 'https://f/a.jpg', thumbUrl: 'https://f/t.jpg' }), false);
    eq('legacy-null', isLegacy(null), false);
    eq('legacy-no-url', isLegacy({}), false);
    const recs = [
      { id: 'a', photos: [{ url: 'data:1' }, { url: 'https://x' }] },
      { id: 'b', photos: [{ url: 'https://y' }] },
      { id: 'c' },
      { id: 'd', photos: [{ url: 'data:2' }, { url: 'data:3' }] },
    ];
    eq('count-mixed', legacyCountOf(recs[0]), 1);
    eq('count-none', legacyCountOf(recs[1]), 0);
    eq('count-no-photos', legacyCountOf(recs[2]), 0);
    eq('pending', pending(recs), { photos: 3, records: 2 });
    eq('pending-empty', pending([]), { photos: 0, records: 0 });
    console.log(fails === 0 ? '✅ photoMigrate ALL PASS' : ('❌ photoMigrate ' + fails + ' FAIL'));
    return fails;
  }

  return { isLegacy, legacyCountOf, pending, run, _selfTest };
})();
