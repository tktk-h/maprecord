import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { fb } from './firebaseInit.js';

window.App = window.App || {};
App.auth = (function () {
  let current = null; // Firebase User or null

  function onChange(cb) {
    onAuthStateChanged(fb.auth, (user) => { current = user; cb(user); });
  }
  async function signIn() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(fb.auth, provider);
  }
  async function logout() { await signOut(fb.auth); }
  function user() { return current; }

  return { onChange, signIn, logout, user };
})();
export const auth = App.auth;
