import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// 公開してよい設定（保護はセキュリティルールで行う）
const firebaseConfig = {
  apiKey: 'AIzaSyCnI8pycQ5mHr4wcBC0ry7jt9fF5CtFJe8',
  authDomain: 'map--record.firebaseapp.com',
  projectId: 'map--record',
  storageBucket: 'map--record.firebasestorage.app',
  messagingSenderId: '493552237567',
  appId: '1:493552237567:web:1e07fefb997bcd6952c5ca',
};

const app = initializeApp(firebaseConfig);
window.App = window.App || {};
window.App.fb = { app, auth: getAuth(app), db: getFirestore(app) };
export const fb = window.App.fb;
