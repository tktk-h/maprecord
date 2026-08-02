window.App = window.App || {};
document.addEventListener('DOMContentLoaded', () => {
  App.map.init();
  App.records.init();
  App.sheet.init();

  // ── ビュー切替（地図 / カレンダー）──
  const mapBtn = document.getElementById('view-map');
  const calBtn = document.getElementById('view-calendar');
  function showMap() {
    document.getElementById('calendar-view').hidden = true;
    document.getElementById('map').hidden = false;
    document.getElementById('panel').hidden = false;
    mapBtn.classList.add('active');
    calBtn.classList.remove('active');
    document.getElementById('locate-btn').hidden = false;
    App.map.refresh(); // 非表示だった地図を正しく再描画
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

  // ── 絞り込みの開閉（スマホ用）──
  const filterToggle = document.getElementById('filter-toggle');
  filterToggle.addEventListener('click', () => {
    document.getElementById('topbar').classList.toggle('filters-open');
  });

  // ── 現在地ボタン ──
  const locateBtn = document.getElementById('locate-btn');
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { alert('この端末では現在地を取得できません'); return; }
    const label = locateBtn.textContent;
    locateBtn.disabled = true;
    locateBtn.textContent = '📍 取得中…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        locateBtn.textContent = label;
        const { latitude, longitude } = pos.coords;
        App.map.flyTo(latitude, longitude);
        App.records.showAddForm(latitude, longitude); // 現在地で追加フォームを開く
      },
      () => {
        locateBtn.disabled = false;
        locateBtn.textContent = label;
        alert('現在地を取得できませんでした。位置情報の許可を確認してください。');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  App.calendar.setDayClickHandler((dateStr) => {
    App.records.focusDay(dateStr); // その日で絞り込み
    showMap();                     // 地図に戻す
  });

  const search = document.getElementById('search-box');
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (!q) { App.records.clearSearch(); return; } // 空Enterで検索・絞り込み解除
    if (q.startsWith('#')) {                        // ハッシュタグ検索：該当ピンだけ表示
      const count = App.records.searchTag(q);
      if (count === 0) alert('そのハッシュタグの記録は見つかりませんでした');
      return;
    }
    // 場所名検索：1件ならその地点へ／複数なら候補ピン＋リスト
    const n = App.records.searchByName(q);
    if (n === 0) alert('その名前の記録は見つかりませんでした');
  });

  // ×ボタンや削除で空になったら、まっさらな状態に戻す
  search.addEventListener('input', () => {
    if (search.value.trim() === '') App.records.clearSearch();
  });

  document.getElementById('export-btn').addEventListener('click', () => App.backup.exportJson());
  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const merge = confirm('OK＝今のデータに追加読み込み / キャンセル＝全消去して置き換え');
    try {
      await App.backup.importJson(file, merge);
      await App.records.reload();
      alert('読み込み完了');
    } catch (err) {
      alert('読み込み失敗: ' + err.message);
    }
    e.target.value = '';
  });
});
