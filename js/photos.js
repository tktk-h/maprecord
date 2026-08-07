window.App = window.App || {};
// 方式B：写真は圧縮して data URL(Base64) にし、Firestore の記録に保存する。
App.photos = (function () {
  const MAX_EDGE = 1280;   // 長辺の上限
  const QUALITY = 0.72;    // JPEG 画質

  // 元の(w,h)を長辺maxEdgeに収める寸法を返す（拡大はしない）
  function fitSize(w, h, maxEdge) {
    const longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return { w, h };
    const scale = maxEdge / longEdge;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  // File/Blob → 圧縮JPEGの data URL 文字列
  function compressToDataURL(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, MAX_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('画像読み込み失敗')); };
      img.src = objUrl;
    });
  }

  // File → 記録に保存する写真オブジェクト { url }（url は data URL）
  async function toStored(file) {
    return { url: await compressToDataURL(file) };
  }
  async function toStoredMany(files) {
    const out = [];
    for (const f of files) out.push(await toStored(f)); // 直列で確実に
    return out;
  }

  // 方式B：写真は data URL で記録に埋め込むため Firestore の1記録=1MB上限に注意。
  // 他フィールドの余白を残し、写真の合計は約0.9MBまでを安全枠とする。
  const PHOTO_BUDGET = 900000; // bytes（data URL は ASCII なので概ね「文字数=バイト数」）
  function bytesOf(photos) {
    return (photos || []).reduce((sum, p) => sum + ((p && p.url) ? p.url.length : 0), 0);
  }
  function withinLimit(photos) { return bytesOf(photos) <= PHOTO_BUDGET; }

  function _selfTest() {
    const eq = (n, got, want) => console.log((JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    eq('landscape', fitSize(4000, 3000, 1280), { w: 1280, h: 960 });
    eq('portrait', fitSize(3000, 4000, 1280), { w: 960, h: 1280 });
    eq('small-nogrow', fitSize(800, 600, 1280), { w: 800, h: 600 });
    eq('square', fitSize(2000, 2000, 1280), { w: 1280, h: 1280 });
  }

  return { fitSize, compressToDataURL, toStored, toStoredMany, bytesOf, withinLimit, _selfTest };
})();
export const photos = App.photos;
