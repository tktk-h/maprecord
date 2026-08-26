/* あしあと Service Worker — アプリシェルのオフライン対応（v1）
   キャッシュ名は登録URL sw.js?v=<VER> の v から導出。版が変われば新SW→古キャッシュ自動破棄。
   戦略: HTML=network-first / 版付き静的+固定CDN=cache-first / Maps・Firebase・データ=素通し。 */
const VER = new URLSearchParams(self.location.search).get('v') || 'dev';
const CACHE = 'ashiato-' + VER;
// 写真は版に連動させない。1枚の写真はURL（トークン付き）ごとに不変なので、
// アプリを更新するたびに全部取り直すのはもったいない。
const PHOTOS = 'ashiato-photos';

// cache-first を許す固定CDN（静的・版付きURL）。地図タイル/APIは含めない。
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

// 同一オリジンの静的（css/js/画像/manifest）/固定CDN/Firebase SDK本体のみ true。地図タイル・API・データは false＝素通し。
function isStatic(url) {
  if (CDN_HOSTS.includes(url.hostname)) return true;
  // Firebase SDK 本体（版付き静的モジュール）。app.js が import するのでシェル初期化に必須。
  // データ系(firestore/firebasestorage/identitytoolkit 等の別ホスト)は対象外＝素通しのまま。
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return true;
  if (url.origin !== self.location.origin) return false; // 他オリジン(Maps/データ等)は対象外
  const p = url.pathname;
  return /\.(css|js|png|jpg|jpeg|svg|webp)$/i.test(p) || p.includes('/js/') || p.endsWith('.webmanifest');
}

// Storage の写真本体（alt=media）だけ。getDownloadURL のメタデータ取得は含めない。
function isPhoto(url) {
  return url.hostname === 'firebasestorage.googleapis.com' && url.searchParams.get('alt') === 'media';
}

function cacheable(res) {
  return res && (res.ok || res.type === 'opaque'); // 正常 or opaque(no-cors)のみ保存
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('ashiato-') && k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const shell = (await cache.match('index.html')) || (await cache.match('./'));
    if (shell) return shell;
    throw e;
  }
}

// 写真専用の cache-first。一度見た写真は次回以降すぐ出る。
async function photoFirst(req) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 非GETは素通し
  const url = new URL(req.url);
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) { e.respondWith(networkFirst(req)); return; }
  if (isPhoto(url)) { e.respondWith(photoFirst(req)); return; }
  if (isStatic(url)) { e.respondWith(cacheFirst(req)); return; }
  // それ以外（Firebase/Maps/Places/Gemini/データ通信）は respondWith せず素通し＝network
});
