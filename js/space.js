import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, arrayUnion,
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

  // 招待コードで参加：invites/{code} から spaceId を引き、members に自分を追加
  // 成功でスペース、コード不正で null
  async function joinSpace(uid, codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) return null;
    const inviteSnap = await getDoc(doc(fb.db, INVITES, code));
    if (!inviteSnap.exists()) return null;
    const spaceId = inviteSnap.data().spaceId;
    await updateDoc(doc(fb.db, SPACES, spaceId), { members: arrayUnion(uid) });
    const fresh = await getDoc(doc(fb.db, SPACES, spaceId));
    return { id: spaceId, ...fresh.data() };
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

  function _selfTest() {
    const eq = (n, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, got);
    const c = genInviteCode();
    eq('format', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c), true);
    eq('no-ambiguous', /[IO01]/.test(c.replace('-', '')), false);
    eq('normalize-hyphen', normalizeCode('abcd-2345'), 'ABCD2345');
    eq('normalize-space', normalizeCode(' ab cd 23 '), 'ABCD23');
    eq('match', normalizeCode('abcd-2345') === normalizeCode('ABCD2345'), true);
  }

  return { genInviteCode, normalizeCode, findMySpace, createSpace, joinSpace,
           touchLastSeen, setAnniversary, _selfTest };
})();
export const space = App.space;
