import {
  collection, doc, addDoc, setDoc, deleteDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.cloud = (function () {
  let spaceId = null;
  let unsub = null;

  function col() { return collection(fb.db, 'spaces', spaceId, 'records'); }
  function setSpace(id) { spaceId = id; }

  // 記録一覧をリアルタイム購読。変化のたび cb(records[]) を呼ぶ
  // 記録が読めなくなったときの通知先（スペースから外されたときに使う）
  let onDenied = null;
  function setOnDenied(cb) { onDenied = cb; }

  function subscribe(cb) {
    if (unsub) unsub();
    unsub = onSnapshot(col(), (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('subscribe error', err);
      // スペースから外されると読めなくなる。放っておくと「読み込み中」のまま固まるので上へ伝える。
      if (err && err.code === 'permission-denied' && onDenied) onDenied();
    });
  }

  async function add(record) {
    const ref = await addDoc(col(), { ...record, createdAt: Date.now(), updatedAt: Date.now() });
    return ref.id;
  }
  async function put(record) {
    const { id, ...rest } = record;
    await setDoc(doc(col(), id), { ...rest, updatedAt: Date.now() }, { merge: true });
  }
  async function remove(id) { await deleteDoc(doc(col(), id)); }

  return { setSpace, subscribe, setOnDenied, add, put, remove, _spaceId: () => spaceId };
})();
export const cloud = App.cloud;
