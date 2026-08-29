import { auth } from './auth.js';
import { space } from './space.js';

window.App = window.App || {};
App.gate = (function () {
  let onReady = null;      // (space) => void  スペース確定時に呼ぶ
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { $(id).hidden = !on; };

  // 起動スプラッシュを消す（次の画面＝ログイン/スペース/本体 が決まったタイミングで呼ぶ）
  function hideSplash() {
    const el = $('splash');
    if (!el || el.hidden) return;
    el.style.opacity = '0';
    setTimeout(() => { el.hidden = true; }, 350); // フェードしてから非表示
  }

  function showGate(which) {
    hideSplash();
    show('gate', true);
    show('gate-login', which === 'login');
    show('gate-space', which === 'space');
    show('gate-invite', which === 'invite');
    show('gate-offline', which === 'offline');
  }
  function hideGate() { hideSplash(); show('gate', false); }

  // オフライン かつ 過去にスペースを開けている＝作成画面ではなく「オフライン案内」を出す判定
  function offlineWithSpace() {
    try { return !navigator.onLine && !!localStorage.getItem('ashiato-space'); }
    catch (_) { return false; }
  }

  async function afterLogin(user) {
    try {
      const mine = await space.findMySpace(user.uid);
      if (mine) {
        try { localStorage.setItem('ashiato-space', mine.id); } catch (_) { /* 印だけなので無視 */ }
        hideGate(); if (onReady) onReady(mine); return;
      }
      // スペースが取れない：オフライン＋既存スペースありなら作成画面を出さずオフライン案内
      if (offlineWithSpace()) { showGate('offline'); return; }
      showGate('space');
    } catch (e) {
      if (offlineWithSpace()) { showGate('offline'); return; }
      showGate('space');
      $('gate-msg').textContent = '読み込みに失敗しました: ' + e.message;
    }
  }

  function init(readyCb) {
    onReady = readyCb;
    $('gate-google').onclick = () =>
      auth.signIn().catch((e) => alert('ログイン失敗: ' + e.message));
    $('gate-create').onclick = async () => {
      try {
        const s = await space.createSpace(auth.user().uid);
        $('gate-invite-code').textContent = s.inviteCode;
        showGate('invite');
        $('gate-start').onclick = () => { hideGate(); if (onReady) onReady(s); };
      } catch (e) { $('gate-msg').textContent = '作成に失敗しました: ' + e.message; }
    };
    $('gate-join-btn').onclick = async () => {
      $('gate-msg').textContent = '';
      try {
        const r = await space.joinSpace($('gate-code').value);
        if (!r.ok) {
          $('gate-msg').textContent = r.reason === 'full'
            ? 'このスペースはもう二人います'
            : 'コードが違います';
          return;
        }
        hideGate(); if (onReady) onReady(r.space);
      } catch (e) { $('gate-msg').textContent = '参加に失敗しました: ' + e.message; }
    };
    $('gate-retry').onclick = () => location.reload(); // 再接続して読み直す
    auth.onChange((user) => {
      if (!user) { showGate('login'); return; }
      afterLogin(user);
    });
  }

  return { init, showGate, hideGate };
})();
export const gate = App.gate;
