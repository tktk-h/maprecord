import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, arrayRemove, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.space = (function () {
  const SPACES = 'spaces';
  const INVITES = 'invites';

  // 招待コード：紛らわしい文字を除いた8桁（例 ABCD-2345）
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1 を除外
  function genInviteCode() {
    let s = '';
    for (let i = 0; i < 8; i += 1) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  // 大文字化・英数字以外除去（ハイフンや空白を無視して比較）
  function normalizeCode(input) {
    return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // 自分が member のスペースを1件返す（なければ null）
  async function findMySpace(uid) {
    const q = query(collection(fb.db, SPACES), where('members', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // 新規スペース作成（作成者を member に）。招待コードは invites/{code} に登録
  async function createSpace(uid) {
    const id = 'space_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const inviteCode = genInviteCode();
    await setDoc(doc(fb.db, SPACES, id), {
      members: [uid], inviteCode, createdAt: Date.now(),
    });
    await setDoc(doc(fb.db, INVITES, normalizeCode(inviteCode)), { spaceId: id });
    return { id, members: [uid], inviteCode };
  }

  // 招待コードで参加する。members への追加はサーバ（joinSpace 関数）が行う。
  // クライアントから直接書くと、スペースIDを知っているだけでコード無しに入れてしまい、
  // 「相手を外す」が成立しない（外した相手が端末に残ったIDで戻れる）。
  // 返り値: { ok: true, space } / { ok: false, reason: 'code' | 'full' }
  async function joinSpace(codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) return { ok: false, reason: 'code' };
    const res = await fb.joinSpace({ code });
    const d = (res && res.data) || {};
    if (!d.ok) return { ok: false, reason: d.reason || 'code' };
    const fresh = await getDoc(doc(fb.db, SPACES, d.spaceId));
    return { ok: true, space: { id: d.spaceId, ...fresh.data() } };
  }

  // 相手をスペースから外す。招待コードも作り直すので、相手が持っている古いコードでは戻れない
  // （コードの照合はサーバが行い、クライアントは自分を members に足せない）。
  // 記録と写真はスペースに残る。また招待したくなったら、新しいコードを渡せば戻せる。
  // 返り値: 新しい招待コード
  async function removeMember(spaceId, uid) {
    const ref = doc(fb.db, SPACES, spaceId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('スペースが見つかりません');
    const data = snap.data() || {};
    const oldCode = normalizeCode(data.inviteCode || '');
    const newCode = genInviteCode();
    // 新しいコードを先に有効にしてから古いものを消す（どちらも効かない瞬間を作らない）
    await setDoc(doc(fb.db, INVITES, normalizeCode(newCode)), { spaceId });
    const patch = {
      members: arrayRemove(uid),
      inviteCode: newCode,
      ['lastSeen.' + uid]: deleteField(),
    };
    // 相手の端末の通知購読も消す。残すと外したあとも記念日通知が届き続ける。
    const push = data.push || {};
    Object.keys(push).forEach((id) => {
      if (push[id] && push[id].uid === uid) patch['push.' + id] = deleteField();
    });
    await updateDoc(ref, patch);
    if (oldCode && oldCode !== normalizeCode(newCode)) {
      // 消せなくても新しいコードは有効なので、致命的ではない
      try { await deleteDoc(doc(fb.db, INVITES, oldCode)); }
      catch (e) { console.warn('古い招待コードを消せませんでした', e); }
    }
    return newCode;
  }

  // アプリを開いたことを記録：スペースに「メンバーごとの最終アクセス日時と名前」を書く。
  // 失敗しても致命的ではないので呼び出し側で握りつぶす想定。
  async function touchLastSeen(spaceId, uid, name) {
    await updateDoc(doc(fb.db, SPACES, spaceId), {
      ['lastSeen.' + uid]: { at: Date.now(), name: name || '' },
    });
  }

  // スペースの記念日（YYYY-MM-DD、空文字で解除）を保存
  async function setAnniversary(spaceId, date) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { anniversary: date || '' });
  }

  // 通知の購読をスペースに保存する。lastSeen と同じく
  // spaces ドキュメントのマップに入れる（Firestore のルールが
  // このドキュメントの update しか許していないため。サブコレクションにするなら
  // ルールの追加が必要になる）。id は端末ごとに一意。
  async function setPushSub(spaceId, id, sub) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { ['push.' + id]: sub });
  }
  async function removePushSub(spaceId, id) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { ['push.' + id]: deleteField() });
  }

  // 旅行（日をまたぐまとまり）。ジャンルと同じくスペースに持たせる。
  // 記録の側には何も足さない＝日付が期間に入っていればその旅行、で決まる。
  async function setTrips(spaceId, trips) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { trips: trips || [] });
  }

  async function setGenres(spaceId, genres) {
    await updateDoc(doc(fb.db, SPACES, spaceId), { genres: genres || [] });
  }

  function _selfTest() {
    const eq = (n, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, got);
    const c = genInviteCode();
    eq('format', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c), true);
    eq('no-ambiguous', /[IO01]/.test(c.replace('-', '')), false);
    eq('normalize-hyphen', normalizeCode('abcd-2345'), 'ABCD2345');
    eq('normalize-space', normalizeCode(' ab cd 23 '), 'ABCD23');
    eq('match', normalizeCode('abcd-2345') === normalizeCode('ABCD2345'), true);
  }

  return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace, removeMember,
           touchLastSeen, setAnniversary, setGenres, setTrips, setPushSub, removePushSub, _selfTest };
})();
export const space = App.space;
