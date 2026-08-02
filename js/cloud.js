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
  function subscribe(cb) {
    if (unsub) unsub();
    unsub = onSnapshot(col(), (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => { console.error('subscribe error', err); });
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

  return { setSpace, subscribe, add, put, remove, _spaceId: () => spaceId };
})();
export const cloud = App.cloud;
