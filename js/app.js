import { gate } from './gate.js';
import { cloud } from './cloud.js';
import { auth } from './auth.js';
import { space } from './space.js';
import { photos } from './photos.js'; // 読み込みで window.App.photos を用意

let started = false;
let currentSpace = null;
let memoriesShown = false;
let recordsLoaded = false; // 初回の記録スナップショットが届いたか（ジャンル編集の使用件数判定に必要）

function wireUI() {
  const mapBtn = document.getElementById('view-map');
  const calBtn = document.getElementById('view-calendar');
  function showMap() {
    document.getElementById('calendar-view').hidden = true;
    document.getElementById('map').hidden = false;
    // パネル（下シート）は選択したときだけ出す。ここでは表示状態を触らない。
    mapBtn.classList.add('active');
    calBtn.classList.remove('active');
    document.getElementById('locate-btn').hidden = false;
    document.getElementById('bulk-btn').hidden = false;
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
    document.getElementById('bulk-btn').hidden = true;
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
        App.records.showQuickLog(latitude, longitude);
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

  // バックアップ（書き出しのみ。クラウド版は読み込み復元なし）
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());

  // シートの×ボタン：閉じる（選択解除）
  document.getElementById('sheet-close').addEventListener('click', () => App.records._clearPanel());

  // 設定：ログアウト・招待コード再表示
  document.getElementById('logout-btn').addEventListener('click', () => auth.logout());
  document.getElementById('show-invite-btn').addEventListener('click', async () => {
    const s = await space.findMySpace(auth.user().uid);
    alert('招待コード：' + (s ? s.inviteCode : '不明'));
  });
  document.getElementById('anniv-btn').addEventListener('click', async () => {
    const cur = (currentSpace && currentSpace.anniversary) || '';
    const input = prompt('記念日を入力（YYYY-MM-DD）。空にすると解除します。', cur);
    if (input == null) return;
    const v = input.trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { alert('YYYY-MM-DD の形式で入力してください'); return; }
    try {
      await space.setAnniversary(currentSpace.id, v);
      currentSpace.anniversary = v || null;
      App.memories.setAnniversary(currentSpace.anniversary);
      App.review.setAnniversary(currentSpace.anniversary);
      alert(v ? '記念日を保存しました' : '記念日を解除しました');
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    }
  });

  document.getElementById('review-btn').addEventListener('click', () => {
    document.getElementById('topbar').classList.remove('filters-open'); // メニューを閉じる
    App.review.showPicker();
  });
  document.getElementById('genre-btn').addEventListener('click', () => {
    document.getElementById('topbar').classList.remove('filters-open'); // メニューを閉じる
    if (!recordsLoaded) { alert('記録を読み込み中です。少し待ってからもう一度お試しください。'); return; }
    App.genreEdit.open();
  });
}

function showMapLoading() { const el = document.getElementById('map-loading'); if (el) el.hidden = false; }
function hideMapLoading() { const el = document.getElementById('map-loading'); if (el) el.hidden = true; }

async function startApp(sp) {
  cloud.setSpace(sp.id);
  currentSpace = sp;
  showMapLoading(); // 記録の初回読み込みが終わるまで「読み込み中」を出す
  // アプリを開いた記録（最終アクセス）を残す。失敗しても本体には影響させない。
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});
  if (!started) {
    await App.map.init(); // Google Maps ライブラリの読み込み完了を待つ
    App.records.init();
    App.sheet.init();
    App.search.init();
    wireUI();
    started = true;
  }
  App.memories.setAnniversary(sp.anniversary || null);
  App.review.setAnniversary(sp.anniversary || null);
  App.genres.setList(sp.genres || null);
  App.genreEdit.setSpaceId(sp.id);
  cloud.subscribe((records) => {
    App.records.setRecords(records);
    recordsLoaded = true;
    hideMapLoading();
    if (!memoriesShown) {
      memoriesShown = true;
      // 年末は「ふりかえりカード」を優先。出なければ通常の思い出カード。
      if (!App.review.maybeShowYearEndCard()) App.memories.show();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  gate.init((sp) => { startApp(sp).catch((e) => console.error('startApp failed', e)); });
});
