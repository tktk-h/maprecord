import { auth } from './auth.js';
import { space } from './space.js';

window.App = window.App || {};
App.gate = (function () {
  let onReady = null;      // (space) => void  スペース確定時に呼ぶ
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { $(id).hidden = !on; };

  function showGate(which) {
    show('gate', true);
    show('gate-login', which === 'login');
    show('gate-space', which === 'space');
    show('gate-invite', which === 'invite');
  }
  function hideGate() { show('gate', false); }

  async function afterLogin(user) {
    try {
      const mine = await space.findMySpace(user.uid);
      if (mine) { hideGate(); if (onReady) onReady(mine); return; }
      showGate('space');
    } catch (e) {
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
        const s = await space.joinSpace(auth.user().uid, $('gate-code').value);
        if (!s) { $('gate-msg').textContent = 'コードが違います'; return; }
        hideGate(); if (onReady) onReady(s);
      } catch (e) { $('gate-msg').textContent = '参加に失敗しました: ' + e.message; }
    };
    auth.onChange((user) => {
      if (!user) { showGate('login'); return; }
      afterLogin(user);
    });
  }

  return { init, showGate, hideGate };
})();
export const gate = App.gate;
