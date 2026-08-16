import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
// 方式C：写真は圧縮して Cloud Storage に保存し、Firestore の記録には URL だけ持つ。
App.photos = (function () {
  const FULL_EDGE = 1280;   // 詳細ヒーロー・ライトボックス用
  const THUMB_EDGE = 400;   // 一覧・ピン・検索候補用
  const QUALITY = 0.72;     // JPEG 画質

  // 元の(w,h)を長辺maxEdgeに収める寸法を返す（拡大はしない）
  function fitSize(w, h, maxEdge) {
    const longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return { w, h };
    const scale = maxEdge / longEdge;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  // Storage のオブジェクトパスを組み立てる（純粋）。variant は 'full' | 'thumb'
  function storagePathFor(spaceId, groupId, photoId, variant) {
    return `spaces/${spaceId}/photos/${groupId}/${photoId}-${variant}.jpg`;
  }

  // 表示用サムネURL。Storage写真は thumbUrl、既存Base64は url にフォールバック（純粋）
  function thumbOf(photo) {
    if (!photo) return null;
    return photo.thumbUrl || photo.url || null;
  }

  // File/Blob → 長辺 maxEdge に収めた圧縮JPEG Blob
  function compressToBlob(file, maxEdge) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('画像の変換に失敗'))),
          'image/jpeg', QUALITY,
        );
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('画像読み込み失敗')); };
      img.src = objUrl;
    });
  }

  // ランダムID（グループ内で衝突しない程度に十分）
  function rid() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  }

  // File → Storage に full/thumb を上げ、記録に保存する写真オブジェクトを返す
  // { url(=full), thumbUrl, path, thumbPath }
  async function toStored(file, groupId) {
    const spaceId = App.cloud._spaceId();
    if (!spaceId) throw new Error('スペース未選択のため写真を保存できません');
    const photoId = rid();
    const path = storagePathFor(spaceId, groupId, photoId, 'full');
    const thumbPath = storagePathFor(spaceId, groupId, photoId, 'thumb');

    const [fullBlob, thumbBlob] = await Promise.all([
      compressToBlob(file, FULL_EDGE),
      compressToBlob(file, THUMB_EDGE),
    ]);

    const fullRef = ref(fb.storage, path);
    const thumbRef = ref(fb.storage, thumbPath);
    await uploadBytes(fullRef, fullBlob, { contentType: 'image/jpeg' });
    await uploadBytes(thumbRef, thumbBlob, { contentType: 'image/jpeg' });
    const [url, thumbUrl] = await Promise.all([
      getDownloadURL(fullRef),
      getDownloadURL(thumbRef),
    ]);
    return { url, thumbUrl, path, thumbPath };
  }

  // 複数を直列アップロード。途中失敗したら、それまでに上げた分を消してから throw（孤児防止）
  // onProgress(done, total) を任意で呼ぶ
  async function toStoredMany(files, groupId, onProgress) {
    const out = [];
    try {
      for (let i = 0; i < files.length; i++) {
        out.push(await toStored(files[i], groupId));
        if (onProgress) onProgress(i + 1, files.length);
      }
      return out;
    } catch (err) {
      // 部分アップロードのロールバック（ベストエフォート）
      for (const p of out) { try { await deletePhotoFiles(p); } catch (_) { /* noop */ } }
      throw err;
    }
  }

  // 写真1件の実ファイル(full/thumb)を削除。path が無い写真(既存Base64)は何もしない。
  // 存在しない等のエラーは握りつぶす（冪等・ベストエフォート）
  async function deletePhotoFiles(photo) {
    if (!photo) return;
    for (const key of ['path', 'thumbPath']) {
      const p = photo[key];
      if (!p) continue;
      try { await deleteObject(ref(fb.storage, p)); } catch (e) { console.warn('storage delete skip', p, e && e.code); }
    }
  }

  function _selfTest() {
    const eq = (n, got, want) => console.log((JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    eq('landscape', fitSize(4000, 3000, 1280), { w: 1280, h: 960 });
    eq('portrait', fitSize(3000, 4000, 1280), { w: 960, h: 1280 });
    eq('small-nogrow', fitSize(800, 600, 1280), { w: 800, h: 600 });
    eq('square', fitSize(2000, 2000, 1280), { w: 1280, h: 1280 });
    eq('path-full', storagePathFor('sp1', 'grp1', 'p1', 'full'), 'spaces/sp1/photos/grp1/p1-full.jpg');
    eq('path-thumb', storagePathFor('sp1', 'grp1', 'p1', 'thumb'), 'spaces/sp1/photos/grp1/p1-thumb.jpg');
    eq('thumb-of-storage', thumbOf({ url: 'https://f/full', thumbUrl: 'https://f/thumb' }), 'https://f/thumb');
    eq('thumb-of-base64', thumbOf({ url: 'data:image/jpeg;base64,xxx' }), 'data:image/jpeg;base64,xxx');
    eq('thumb-of-null', thumbOf(null), null);
  }

  return { fitSize, storagePathFor, thumbOf, compressToBlob, toStored, toStoredMany, deletePhotoFiles, _selfTest };
})();
export const photos = App.photos;
