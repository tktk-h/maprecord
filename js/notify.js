window.App = window.App || {};
// 記念日の通知（Web Push）。この端末を購読させて、購読情報をスペースに預けるところまでが担当。
// 実際に送るのは functions/index.js の dailyAnniversary（毎朝9時・日本時間）。
//
// ⚠️ iPhone は「ホーム画面に追加したアプリ」から開いているときしか購読できない（iOS 16.4〜）。
// Safari のタブでは subscribe が失敗するので、その場合は先に案内を出す。
App.notify = (function () {
  const ENDPOINT_KEY = 'ashiato-push-endpoint'; // 端末に控える。購読が入れ替わったか見るのに使う

  function supported() {
    return typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && typeof window !== 'undefined'
      && 'PushManager' in window
      && 'Notification' in window;
  }

  // iOS/iPadOS か（純粋・判定だけ）
  function isIOS(ua, maxTouchPoints) {
    const s = String(ua || '');
    if (/iPhone|iPad|iPod/.test(s)) return true;
    return /Macintosh/.test(s) && (maxTouchPoints || 0) > 1; // iPad の「デスクトップ表示」
  }

  // ホーム画面から開いているか（純粋・判定だけ）
  function isStandalone(nav, mql) {
    if (nav && nav.standalone === true) return true;   // iOS
    return !!(mql && mql.matches);                      // display-mode: standalone
  }

  function iosNeedsInstall() {
    if (!isIOS(navigator.userAgent, navigator.maxTouchPoints)) return false;
    return !isStandalone(navigator, window.matchMedia('(display-mode: standalone)'));
  }

  // 'unsupported' | 'needs-install' | 'denied' | 'on' | 'off'
  async function state() {
    if (!supported()) return 'unsupported';
    if (iosNeedsInstall()) return 'needs-install';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'off';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  }

  // base64url の VAPID 公開鍵 → applicationServerKey 用の Uint8Array（純粋）
  function urlBase64ToUint8Array(base64) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
      .replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  // PushSubscription → 保存する形（純粋）。Firestore に入れるので素の値だけにする。
  function toStored(sub) {
    const json = sub.toJSON();
    return {
      endpoint: json.endpoint,
      p256dh: json.keys && json.keys.p256dh,
      auth: json.keys && json.keys.auth,
      at: Date.now(),
    };
  }

  // endpoint から端末ごとの id を作る。Firestore のマップのキーにするので英数字だけにする。
  async function subId(endpoint) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(buf)).slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function save(sub) {
    const spaceId = App.cloud._spaceId();
    if (!spaceId) throw new Error('スペースが未選択です');
    const id = await subId(sub.endpoint);
    await App.space.setPushSub(spaceId, id, toStored(sub));
    try { localStorage.setItem(ENDPOINT_KEY, sub.endpoint); } catch (_) { /* 控えなので無視 */ }
  }

  // 通知をオンにする。成功なら 'on'、それ以外は理由を返す。
  async function enable() {
    const st = await state();
    if (st === 'unsupported') return 'unsupported';
    if (st === 'needs-install') return 'needs-install';
    if (st === 'on') return 'on';

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await App.fb.pushKey();
      const key = res && res.data && res.data.key;
      if (!key) throw new Error('通知の設定（鍵）が取得できませんでした');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // iOS は必須。push を受けたら必ず通知を出す約束
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await save(sub);
    return 'on';
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      const id = await subId(sub.endpoint);
      try { await App.space.removePushSub(App.cloud._spaceId(), id); } catch (e) { console.warn('push remove skip', e); }
      await sub.unsubscribe();
    }
    try { localStorage.removeItem(ENDPOINT_KEY); } catch (_) { /* noop */ }
    return 'off';
  }

  // ブラウザが購読を勝手に入れ替えることがある。起動時に控えと見比べて、
  // 変わっていたときだけ保存し直す（毎回書かない）。
  async function refresh() {
    if (!supported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) return;
      let known = null;
      try { known = localStorage.getItem(ENDPOINT_KEY); } catch (_) { /* noop */ }
      if (known !== sub.endpoint) await save(sub);
    } catch (e) {
      console.warn('push refresh skip', e);
    }
  }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails += 1;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('ios-iphone', isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 0), true);
    eq('ios-ipad-desktop', isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
    eq('ios-mac', isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
    eq('ios-android', isIOS('Mozilla/5.0 (Linux; Android 14)', 5), false);
    eq('standalone-ios', isStandalone({ standalone: true }, { matches: false }), true);
    eq('standalone-media', isStandalone({}, { matches: true }), true);
    eq('standalone-tab', isStandalone({ standalone: false }, { matches: false }), false);
    // 鍵の変換：長さ65バイト（P-256 の非圧縮点）になること
    const key = 'BEl' + 'A'.repeat(84) + '=';
    eq('vapid-len', urlBase64ToUint8Array(key.replace(/=+$/, '')).length, 65);
    eq('stored-shape', toStored({ toJSON: () => ({ endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }) }).endpoint, 'https://e');
    console.log(fails === 0 ? '✅ notify ALL PASS' : ('❌ notify ' + fails + ' FAIL'));
    return fails;
  }

  return { supported, state, enable, disable, refresh,
           _isIOS: isIOS, _isStandalone: isStandalone, _urlBase64ToUint8Array: urlBase64ToUint8Array,
           _toStored: toStored, _selfTest };
})();
