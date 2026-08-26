import { gate } from './gate.js';
import { cloud } from './cloud.js';
import { auth } from './auth.js';
import { space } from './space.js';
import { photos } from './photos.js'; // 読み込みで window.App.photos を用意

let started = false;
let currentSpace = null;
let recordsLoaded = false; // 初回の記録スナップショットが届いたか（ジャンル編集の使用件数判定に必要）
let mapDone = false;       // 地図の準備ができたか
let painted = false;       // 最初の描画（ピン＋思い出カード）を済ませたか

// 設定画面の開閉。body の印は検索バーの歯車を光らせるため。
function openSettings() {
  document.getElementById('topbar').classList.remove('filters-open'); // 絞り込みとは同時に開かない
  refreshPhotoMigrateBtn(); // 開くたびに残り枚数を数え直す
  document.getElementById('settings-panel').hidden = false;
  document.body.classList.add('settings-open');
}
function closeSettings() {
  const p = document.getElementById('settings-panel');
  if (!p || p.hidden) return;
  p.hidden = true;
  document.body.classList.remove('settings-open');
}

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

  // 設定の開閉。ジャンル編集やふりかえりと同じ、独立したオーバーレイ。
  const settingsPanel = document.getElementById('settings-panel');
  document.getElementById('settings-toggle').addEventListener('click', () => {
    if (settingsPanel.hidden) openSettings(); else closeSettings();
  });
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  // シートの外（背景）を押したら閉じる
  settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) closeSettings(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

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
  document.getElementById('import-btn').addEventListener('click', () => App.backup.importFlow());

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
    closeSettings(); // 別の画面を出すので設定はしまう
    App.review.showPicker();
  });
  document.getElementById('genre-btn').addEventListener('click', () => {
    if (!recordsLoaded) { alert('記録を読み込み中です。少し待ってからもう一度お試しください。'); return; }
    closeSettings();
    App.genreEdit.open();
  });
  // ピンをまとめる（クラスタ）ON/OFF。端末ごとの設定で、既定はON。
  const clusterBtn = document.getElementById('cluster-btn');
  function paintClusterBtn() {
    const on = App.map.clusterEnabled();
    clusterBtn.classList.toggle('on', on);
    clusterBtn.querySelector('.set-state').textContent = on ? 'オン' : 'オフ';
  }
  clusterBtn.addEventListener('click', () => {
    App.map.setClusterEnabled(!App.map.clusterEnabled());
    paintClusterBtn();
    App.records.render(); // 束ね方が変わるので描き直す
    closeSettings();      // 変わった地図をその場で見せる
  });
  paintClusterBtn();

  // 写真を軽くする（昔の埋め込み写真を Storage へ移す）
  document.getElementById('photo-migrate-btn').addEventListener('click', runPhotoMigrate);
}

// 残っている埋め込み写真の枚数を見て、あるときだけボタンを出す。
function refreshPhotoMigrateBtn() {
  const btn = document.getElementById('photo-migrate-btn');
  if (!btn || migrating) return;
  const { photos } = App.photoMigrate.pending(App.records.getAll());
  btn.hidden = photos === 0;
  if (photos) btn.querySelector('span').textContent = '写真を軽くする（' + photos + '枚）';
}

let migrating = false;
async function runPhotoMigrate() {
  if (migrating) return;
  const btn = document.getElementById('photo-migrate-btn');
  const label = btn.querySelector('span');
  const { photos, records } = App.photoMigrate.pending(App.records.getAll());
  if (!photos) { refreshPhotoMigrateBtn(); return; }
  const ok = confirm(`昔の形式で保存された写真 ${photos}枚（${records}件の記録）を、今の保存先へ移します。
写真はそのまま残り、アプリを開くときの読み込みが軽くなります。
途中で閉じないでください。`);
  if (!ok) return;
  migrating = true;
  btn.disabled = true;
  label.textContent = '移しています… 0/' + photos;
  try {
    const res = await App.photoMigrate.run((done, total) => {
      label.textContent = '移しています… ' + done + '/' + total;
    });
    alert(res.failed
      ? (res.moved + '枚を移しました。' + res.failed + '枚は失敗したので、もう一度試してみてください。')
      : (res.moved + '枚を移しました。次に開くときから軽くなります。'));
  } catch (e) {
    console.error('photo migrate aborted', e);
    alert('移せませんでした: ' + (e && e.message ? e.message : e));
  } finally {
    migrating = false;
    btn.disabled = false;
    label.textContent = '写真を軽くする';
    refreshPhotoMigrateBtn(); // 購読の反映を待たずこの場で数え直す
  }
}

function showMapLoading() { const el = document.getElementById('map-loading'); if (el) el.hidden = false; }
function hideMapLoading() { const el = document.getElementById('map-loading'); if (el) el.hidden = true; }

// 地図と記録の両方が揃ってから一度だけ。どちらが先に終わってもここに合流する。
function firstPaint() {
  if (painted || !mapDone || !recordsLoaded) return;
  painted = true;
  hideMapLoading();
  App.records.render(); // 地図より先に届いていた記録をここで描く
  refreshPhotoMigrateBtn();
  // 年末は「ふりかえりカード」を優先。出なければ通常の思い出カード。
  if (!App.review.maybeShowYearEndCard()) App.memories.show();
}

async function startApp(sp) {
  cloud.setSpace(sp.id);
  currentSpace = sp;
  showMapLoading(); // 記録の初回読み込みが終わるまで「読み込み中」を出す
  // アプリを開いた記録（最終アクセス）を残す。失敗しても本体には影響させない。
  const u = auth.user();
  if (u) space.touchLastSeen(sp.id, u.uid, u.displayName || u.email || '').catch(() => {});

  // スペースの設定はUIを組む前に入れる。
  // （絞り込みのジャンルチップは App.genres.list を見て作るので、先に差し替えておかないと既定の6つで作られる）
  App.memories.setAnniversary(sp.anniversary || null);
  App.review.setAnniversary(sp.anniversary || null);
  App.genres.setList(sp.genres || null);
  App.genreEdit.setSpaceId(sp.id);

  // 地図の読み込みと記録の購読は互いに独立している。
  // 地図を待ってから購読するとその分だけ初回同期の開始が遅れるので、同時に進める。
  const mapReady = started ? Promise.resolve() : App.map.init();

  cloud.subscribe((records) => {
    App.records.setRecords(records); // 地図がまだなら all に貯めるだけ（render は地図待ち）
    recordsLoaded = true;
    firstPaint();
    if (started) refreshPhotoMigrateBtn();
  });

  await mapReady; // Google Maps ライブラリの読み込み完了
  if (!started) {
    App.records.init();
    App.sheet.init();
    App.search.init();
    wireUI();
    started = true;
  }
  mapDone = true;
  firstPaint();
}

document.addEventListener('DOMContentLoaded', () => {
  gate.init((sp) => { startApp(sp).catch((e) => console.error('startApp failed', e)); });
});
