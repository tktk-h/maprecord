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
let leaving = false;       // 自分でログアウト中か（そのときの権限エラーは「外された」ではない）

// 設定画面の開閉。body の印は検索バーの歯車を光らせるため。
function openSettings() {
  document.getElementById('topbar').classList.remove('filters-open'); // 絞り込みとは同時に開かない
  refreshPhotoMigrateBtn(); // 開くたびに残り枚数を数え直す
  paintNotifyBtn();         // 通知のオンオフも見直す（端末の設定で外されていることがある）
  App.overlay.open(document.getElementById('settings-panel'));
  document.body.classList.add('settings-open');
}
function closeSettings() {
  const p = document.getElementById('settings-panel');
  if (!p || p.hidden) return;
  // 印を外すのは閉じ終わってから。先に外すと、まだ滑っている画面の上に
  // 地図の浮きボタン（z-index:500）が顔を出す。
  App.overlay.close(p, () => document.body.classList.remove('settings-open'));
}

function wireUI() {
  const mapBtn = document.getElementById('view-map');
  const calBtn = document.getElementById('view-calendar');

  // タブの下地を、選ばれているボタンの位置と幅に合わせる。
  // 幅を測るのは、文字数の違いに加えて「選ばれると太字になる」ぶんも変わるため。
  // first=true のときはアニメーションさせない（起動時に左から滑ってきてしまう）。
  function moveThumb(first) {
    const wrap = document.getElementById('view-toggle');
    const thumb = document.getElementById('vt-thumb');
    const on = wrap.querySelector('button.active');
    if (!thumb || !on) return;
    if (first) thumb.classList.add('no-anim');
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + on.offsetLeft + 'px)';
    // 次のフレームで戻す。同じフレームで外すと、この配置ごと滑ってしまう
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.remove('no-anim')));
  }
  moveThumb(true);
  // 文字の幅は、フォントを読み終わった時点と画面幅が変わった時点で変わる
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveThumb(true));
  window.addEventListener('resize', () => moveThumb(true));
  // カレンダーは地図の上を右から覆う。地図は動かさない（生きている地図を transform で動かすと
  // タイルの描き直しでカクつく）。出し入れの作法は App.overlay と同じなのでそちらに任せる
  // （向きが横なのは CSS 側の話で、モジュールは向きを知らない）。
  const calView = () => document.getElementById('calendar-view');

  function showMap() {
    App.overlay.close(calView());
    document.getElementById('map').hidden = false;
    // パネル（下シート）は選択したときだけ出す。ここでは表示状態を触らない。
    mapBtn.classList.add('active');
    calBtn.classList.remove('active');
    moveThumb(); // 太字が移ったあとに測る（幅が変わるので、先に測ると合わない）
    document.getElementById('locate-btn').hidden = false;
    document.getElementById('bulk-btn').hidden = false;
    App.map.refresh();
  }
  function showCalendar() {
    App.calendar.render(App.records.getAll());
    // 地図は隠さない。スライド中に下に見えている必要がある（カレンダーは不透明なので覆えば見えない）
    document.getElementById('panel').hidden = true;
    App.overlay.open(calView());
    calBtn.classList.add('active');
    mapBtn.classList.remove('active');
    moveThumb(); // 太字が移ったあとに測る（幅が変わるので、先に測ると合わない）
    // この2つは z-index:500 でカレンダー(40)より上に出てしまうので、覆う前に消す
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
  App.calendar.setTripClickHandler((tripId) => {
    App.records.focusTrip(tripId);
    showMap();
  });

  // バックアップ（書き出しのみ。クラウド版は読み込み復元なし）
  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());
  document.getElementById('import-btn').addEventListener('click', () => App.backup.importFlow());

  // シートの×ボタン：閉じる（選択解除）
  document.getElementById('sheet-close').addEventListener('click', () => App.records._clearPanel());

  // 設定：ログアウト・招待コード再表示
  document.getElementById('logout-btn').addEventListener('click', () => {
    leaving = true; // ログアウトすると記録が読めなくなる。それを「外された」と誤検知しないための印
    auth.logout();
  });

  // 相手をスペースから外す。招待コードも作り直すので、相手の持っている古いコードでは戻れない。
  document.getElementById('kick-btn').addEventListener('click', async () => {
    const me = auth.user();
    if (!me || !currentSpace) return;
    const others = (currentSpace.members || []).filter((u) => u !== me.uid);
    if (!others.length) { alert('いま相手はいません。参加しているのはあなただけです。'); return; }
    const uid = others[0];
    const seen = (currentSpace.lastSeen && currentSpace.lastSeen[uid]) || {};
    const name = seen.name || '相手';
    const ok = confirm([
      name + " をこのスペースから外します。",
      "",
      "・相手は記録も写真も見られなくなります",
      "・招待コードを作り直すので、いまのコードでは戻れません",
      "・また招待したくなったら、新しいコードを渡せば戻せます",
      "",
      "外しますか？",
    ].join(String.fromCharCode(10)));
    if (!ok) return;
    try {
      const code = await space.removeMember(currentSpace.id, uid);
      currentSpace.members = (currentSpace.members || []).filter((u) => u !== uid);
      if (currentSpace.lastSeen) delete currentSpace.lastSeen[uid];
      currentSpace.inviteCode = code;
      alert("外しました。" + String.fromCharCode(10) + "新しい招待コード：" + code);
    } catch (e) {
      alert('外せませんでした: ' + e.message);
    }
  });
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

  document.getElementById('trip-btn').addEventListener('click', () => {
    closeSettings();
    App.tripEdit.open();
  });
  // 旅行を足す/直すと、カレンダーの帯と地図の見え方が変わる。
  // カレンダーはタブを開くたびに描き直すが、開いたまま保存されたときはその場で描き直す。
  App.tripEdit.setOnSaved(() => {
    App.records.render();
    const cal = document.getElementById('calendar-view');
    if (cal && !cal.hidden) App.calendar.render(App.records.getAll());
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

  // 記念日の通知
  document.getElementById('notify-btn').addEventListener('click', toggleNotify);
}

// 通知の状態を行に出す。端末側の事情（未対応・未インストール・拒否）もここで見せる。
const NOTIFY_LABEL = {
  on: 'オン', off: 'オフ', denied: 'ブロック中',
  'needs-install': 'ホーム画面から', unsupported: '使えません',
};
async function paintNotifyBtn() {
  const btn = document.getElementById('notify-btn');
  if (!btn || !App.notify) return;
  const st = await App.notify.state();
  btn.classList.toggle('on', st === 'on');
  btn.querySelector('.set-state').textContent = NOTIFY_LABEL[st] || 'オフ';
}

let notifyBusy = false;
async function toggleNotify() {
  if (notifyBusy) return;
  const btn = document.getElementById('notify-btn');
  const label = btn.querySelector('.set-state');
  const st = await App.notify.state();
  if (st === 'unsupported') {
    alert('このブラウザでは通知を使えません。');
    return;
  }
  if (st === 'needs-install') {
    alert(`iPhone で通知を受け取るには、ホーム画面に追加した「あしあと」から開いてください。
Safari の共有ボタン →「ホーム画面に追加」で入れられます。`);
    return;
  }
  if (st === 'denied') {
    alert(`通知が端末側で断られています。
iPhone の「設定 → 通知 → あしあと」から許可してから、もう一度押してください。`);
    return;
  }
  notifyBusy = true;
  btn.disabled = true;
  label.textContent = st === 'on' ? '外しています…' : '準備中…';
  try {
    const res = st === 'on' ? await App.notify.disable() : await App.notify.enable();
    if (res === 'denied') {
      alert('通知を許可しないと受け取れません。');
    } else if (res === 'on') {
      alert('通知をオンにしました。記念日の朝9時にお知らせします。');
    }
  } catch (e) {
    console.error('notify toggle failed', e);
    alert('通知の設定を変えられませんでした: ' + (e && e.message ? e.message : e));
  } finally {
    notifyBusy = false;
    btn.disabled = false;
    paintNotifyBtn();
  }
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
  App.trips.setList(sp.trips || []);
  App.genreEdit.setSpaceId(sp.id);
  App.tripEdit.setSpaceId(sp.id);

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
  // 購読が入れ替わっていたら保存し直す。スペースの控えも渡して、uid の無い古い購読を直す。
  if (App.notify) App.notify.refresh(currentSpace && currentSpace.push);
}

document.addEventListener('DOMContentLoaded', () => {
  // 相手に外されると記録が読めなくなる。黙って「読み込み中」のままにせず、事情を出して締める。
  cloud.setOnDenied(() => {
    if (leaving) return; // 自分でログアウトしただけ
    leaving = true;
    try { localStorage.removeItem('ashiato-space'); } catch (_) { /* 印だけなので無視 */ }
    alert('このスペースから外されました。');
    auth.logout().finally(() => location.reload());
  });

  gate.init((sp) => { startApp(sp).catch((e) => console.error('startApp failed', e)); });
});
