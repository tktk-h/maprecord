import { gate } from './gate.js';
import { cloud } from './cloud.js';
import { auth } from './auth.js';
import { space } from './space.js';
import { photos } from './photos.js'; // 読み込みで window.App.photos を用意

let started = false;

function wireUI() {
  const mapBtn = document.getElementById('view-map');
  const calBtn = document.getElementById('view-calendar');
  function showMap() {
    document.getElementById('calendar-view').hidden = true;
    document.getElementById('map').hidden = false;
    document.getElementById('panel').hidden = false;
    mapBtn.classList.add('active');
    calBtn.classList.remove('active');
    document.getElementById('locate-btn').hidden = false;
    App.map.refresh();
  }
  function showCalendar() {
    App.calendar.render(App.records.getAll());
    document.getElementById('map').hidden = true;
    document.getElementById('panel').hidden = true;
    document.getElementById('calendar-view').hidden = false;
    calBtn.classList.add('active');
    mapBtn.classList.remove('active');
    document.getElementById('locate-btn').hidden = true;
  }
  mapBtn.addEventListener('click', showMap);
  calBtn.addEventListener('click', showCalendar);

  // 絞り込みの開閉（スマホ用）
  document.getElementById('filter-toggle').addEventListener('click', () => {
    document.getElementById('topbar').classList.toggle('filters-open');
  });

  // 現在地ボタン
  const locateBtn = document.getElementById('locate-btn');
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { alert('この端末では現在地を取得できません'); return; }
    locateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        const { latitude, longitude } = pos.coords;
        App.map.flyTo(latitude, longitude);
        App.records.showAddForm(latitude, longitude);
      },
      () => {
        locateBtn.disabled = false;
        alert('現在地を取得できませんでした。位置情報の許可を確認してください。');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  // カレンダーで日付タップ → その日で絞り込み＆地図へ
  App.calendar.setDayClickHandler((dateStr) => {
    App.records.focusDay(dateStr);
    showMap();
  });

  // 検索
  const search = document.getElementById('search-box');
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (!q) { App.records.clearSearch(); return; }
    if (q.startsWith('#')) {
      const count = App.records.searchTag(q);
      if (count === 0) alert('そのハッシュタグの記録は見つかりませんでした');
      return;
    }
    const n = App.records.searchByName(q);
    if (n === 0) alert('その名前の記録は見つかりませんでした');
  });
  search.addEventListener('input', () => {
    if (search.value.trim() === '') App.records.clearSearch();
  });

  // バックアップ（書き出しのみ。クラウド版は読み込み復元なし）
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());

  // 設定：ログアウト・招待コード再表示
  document.getElementById('logout-btn').addEventListener('click', () => auth.logout());
  document.getElementById('show-invite-btn').addEventListener('click', async () => {
    const s = await space.findMySpace(auth.user().uid);
    alert('招待コード：' + (s ? s.inviteCode : '不明'));
  });
}

async function startApp(sp) {
  cloud.setSpace(sp.id);
  // アプリを開いた記録（最終アクセス）を残す。失敗しても本体には影響させない。
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});
  if (!started) {
    await App.map.init(); // Google Maps ライブラリの読み込み完了を待つ
    App.records.init();
    App.sheet.init();
    wireUI();
    started = true;
  }
  cloud.subscribe((records) => App.records.setRecords(records)); // リアルタイム反映
}

document.addEventListener('DOMContentLoaded', () => {
  gate.init((sp) => { startApp(sp).catch((e) => console.error('startApp failed', e)); });
});
