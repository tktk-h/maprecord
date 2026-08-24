window.App = window.App || {};
App.map = (function () {
  const MAP_ID = '453a543cb81d00c3bbdfb47d'; // Google Maps の Map ID（ベクター）

  let map;
  let AdvancedMarkerElement;   // marker ライブラリのクラス（init で読み込む）
  let markers = [];            // renderPins で出したマーカー
  let searchMarkers = [];      // 場所検索の結果ピン（記録ピン markers とは別レイヤー）
  let clusterer = null;        // MarkerClusterer（クラスタON時のみ）
  let clusterWanted = false;   // 直近の renderPins がクラスタ指定だったか（検索からの復帰判定に使う）
  let routeLine = null;        // ルートの点線（numbered 表示時）
  let tempMarker = null;       // 追加フォーム中の目印
  let pickMarker = null;       // 位置修正のドラッグ用
  let onMapClick = null;       // (lat, lng) => void  ... 空きタップ（現在は未使用）
  let onPlaceClick = null;     // (placeId) => void  ... 店(POI)タップ時
  let onLongPress = null;      // (lat, lng) => void  ... 長押し（記録追加）
  let onUserPan = null;         // ユーザーが地図をドラッグしたとき
  let onTap = null;             // 地図を短くタップしたとき（Google click に頼らず pointer で検出）
  let pickRecordSelect = null;  // 位置ピック中に記録ピンをタップしたとき (record)=>void。非nullかつピック中は詳細を出さず選択に回す
  let overlayProjection = null; // 画面ピクセル→緯度経度の変換用（長押し判定）
  let suppressClickUntil = 0;   // 長押し直後のクリックを無視する時刻

  const VIEW_KEY = 'date-recorder-view';
  const CLUSTER_KEY = 'date-recorder-cluster'; // ピンまとめ(クラスタ)のON/OFF

  function loadView() {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY));
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.zoom === 'number') {
        return v;
      }
    } catch (e) { /* 壊れた値は無視 */ }
    return { lat: 35.681236, lng: 139.767125, zoom: 13 }; // 初回は東京駅あたり
  }

  function saveView() {
    const c = map.getCenter();
    if (!c) return;
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat(), lng: c.lng(), zoom: map.getZoom() }));
  }

  // 保存値 → 真偽。'off' のときだけOFF（未設定・壊れた値は既定ON）
  function parseClusterPref(raw) { return raw !== 'off'; }
  function clusterEnabled() {
    try { return parseClusterPref(localStorage.getItem(CLUSTER_KEY)); } catch (e) { return true; }
  }
  function setClusterEnabled(on) {
    try { localStorage.setItem(CLUSTER_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  // クラスタを使うか。opts.cluster 指定かつCDN読込済みのときだけ true（未読込なら通常描画）
  function wantsCluster(opts) { return !!(opts && opts.cluster) && !!window.markerClusterer; }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('cluster-pref-default', parseClusterPref(null), true);
    eq('cluster-pref-on', parseClusterPref('on'), true);
    eq('cluster-pref-off', parseClusterPref('off'), false);
    eq('cluster-pref-broken', parseClusterPref('xxx'), true);
    eq('same-spot-near', sameSpot({ lat: 35, lng: 139 }, { lat: 35.0001, lng: 139.0001 }), true);
    eq('same-spot-far', sameSpot({ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }), false);
    eq('same-spot-null', sameSpot(null, { lat: 35, lng: 139 }), false);
    const savedMC = window.markerClusterer;
    window.markerClusterer = undefined;                     // CDN未読込を再現
    eq('wants-cluster-no-cdn', wantsCluster({ cluster: true }), false);
    window.markerClusterer = {};                            // CDN読込済みを再現
    eq('wants-cluster-on', wantsCluster({ cluster: true }), true);
    eq('wants-cluster-off', wantsCluster({ cluster: false }), false);
    eq('wants-cluster-no-opts', wantsCluster(null), false);
    window.markerClusterer = savedMC;
    console.log(fails === 0 ? 'ALL PASS (map)' : (fails + ' FAILED (map)'));
    return fails;
  }

  // html文字列 → 最初の要素ノード
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  async function init() {
    const v = loadView();
    const { Map } = await google.maps.importLibrary('maps');
    ({ AdvancedMarkerElement } = await google.maps.importLibrary('marker'));
    map = new Map(document.getElementById('map'), {
      center: { lat: v.lat, lng: v.lng },
      zoom: v.zoom,
      mapId: MAP_ID,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
      clickableIcons: true,       // 店(POI)をタップ可能に（placeIdで分岐）
      gestureHandling: 'greedy',  // スマホ1本指でも地図が動く
    });
    map.addListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return; // 長押し直後のクリックは無視
      if (e.placeId) {                 // 店・施設(POI)をタップ
        if (e.stop) e.stop();          // Google標準の情報ウィンドウを抑制
        if (onPlaceClick) onPlaceClick(e.placeId);
        return;
      }
      if (onMapClick && e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng()); // 空きタップ（現在は未使用）
    });
    // 右クリック（PC）＝その地点に記録を追加。スマホの長押しは setupLongPress で独自検知。
    map.addListener('contextmenu', (e) => { if (onLongPress && e.latLng) onLongPress(e.latLng.lat(), e.latLng.lng()); });
    map.addListener('idle', saveView); // 表示位置・ズームを保存
    map.addListener('dragend', () => { if (onUserPan) onUserPan(); }); // ユーザー操作のみ（flyTo/fitTo では発火しない）
    setupLongPress();
  }

  // 長押し検出（Google標準の contextmenu がスマホで出ない端末向けの独自実装）
  function setupLongPress() {
    // 座標変換用のオーバーレイ（画面ピクセル→緯度経度）
    const overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {};
    overlay.onRemove = function () {};
    overlay.draw = function () { overlayProjection = this.getProjection(); };
    overlay.setMap(map);

    const div = document.getElementById('map');
    const LONG_MS = 500;   // この時間押し続けたら長押し
    const MOVE_TOL = 12;   // これ以上動いたらパン扱いでキャンセル
    let timer = null;
    let startX = 0;
    let startY = 0;
    let downTime = 0;    // 押した時刻（タップ判定用）
    let longFired = false; // 長押しが発火したか
    let moved = false;   // 閾値以上動いたか（パン）
    let active = false;  // 地図で始まったポインタ操作の最中か
    let tapFired = false; // この操作で onTap 済みか（二重発火防止）
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

    // pointerdown は #map に届く（＝長押しが動く実績あり）。ここで操作開始を記録する。
    div.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return; // 右クリック等は無視
      startX = ev.clientX; startY = ev.clientY;
      downTime = performance.now(); longFired = false; moved = false;
      active = true; tapFired = false;
      cancel();
      timer = setTimeout(() => {
        timer = null; longFired = true;
        if (!onLongPress || !overlayProjection) return;
        const rect = div.getBoundingClientRect();
        const pt = new google.maps.Point(startX - rect.left, startY - rect.top);
        const ll = overlayProjection.fromContainerPixelToLatLng(pt);
        if (!ll) return;
        suppressClickUntil = Date.now() + 700; // 直後のクリック（POIカード等）を抑制
        onLongPress(ll.lat(), ll.lng());
      }, LONG_MS);
    });

    // move / up は document のキャプチャフェーズで拾う。Google Maps のジェスチャー層は
    // pointerup を #map まで伝える前に消費するため、要素バブルでは onTap が発火しない。
    // キャプチャは Google の stopPropagation より先に走るので確実に受け取れる。
    document.addEventListener('pointermove', (ev) => {
      if (!active) return;
      if (Math.abs(ev.clientX - startX) > MOVE_TOL || Math.abs(ev.clientY - startY) > MOVE_TOL) {
        moved = true; cancel();
      }
    }, { capture: true });
    document.addEventListener('pointerup', () => {
      if (!active) return;
      active = false;
      // 短くその場を離した＝タップ。長押し・パンでなければ onTap を発火（Google click に依存しない）
      const wasTap = !longFired && !moved && (performance.now() - downTime) < LONG_MS;
      cancel();
      if (wasTap && !tapFired && onTap) { tapFired = true; onTap(); }
    }, { capture: true });
    document.addEventListener('pointercancel', () => { active = false; cancel(); }, { capture: true });
  }

  function setClickHandler(fn) { onMapClick = fn; }
  function setPlaceClickHandler(fn) { onPlaceClick = fn; }
  function getPlaceClickHandler() { return onPlaceClick; } // 一時差し替え→復元用
  function setRecordPickHandler(fn) { pickRecordSelect = fn; } // 位置ピック中の記録ピンタップ挙動
  function setLongPressHandler(fn) { onLongPress = fn; }
  function setUserPanHandler(fn) { onUserPan = fn; }
  function setTapHandler(fn) { onTap = fn; }

  function clearPins() {
    stopClusterer();   // 先に破棄しないと idle リスナーが残ってマーカーが復活する
    clusterWanted = false;
    markers.forEach((m) => { m.map = null; });
    markers = [];
    if (routeLine) { routeLine.setMap(null); routeLine = null; }
  }

  const SAME_SPOT_TOL = 0.0003; // ≈30m：記録と検索結果が同じ場所か判定する許容誤差
  function markerLatLng(m) {
    const p = m.position; if (!p) return null;
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
    return { lat, lng };
  }
  function sameSpot(a, b) {
    return !!(a && b && Math.abs(a.lat - b.lat) < SAME_SPOT_TOL && Math.abs(a.lng - b.lng) < SAME_SPOT_TOL);
  }

  // keepPinsHidden=true のときは記録ピンの表示を戻さない（直後に呼び出し側が決める）
  function clearPlaceResults(keepPinsHidden) {
    searchMarkers.forEach((m) => { m.map = null; });
    searchMarkers = [];
    if (keepPinsHidden) return;
    if (clusterWanted) { // クラスタ表示へ復帰（すでに動いているなら触らない）
      if (!clusterer) {
        markers.forEach((m) => { m.map = null; });
        // 束ねられなければ素のまま出す（renderPins と同じ後始末）
        if (!startClusterer()) markers.forEach((m) => { m.map = map; });
      }
      return;
    }
    markers.forEach((m) => { if (m.map !== map) m.map = map; }); // 隠していた記録ピンを戻す
  }

  // 記録ピンを即座に全部隠す（検索の通信待ち中に一瞬表示されるのを防ぐ）
  // クラスタON中はバッジがクラスタラ所有の別マーカーなので、先に束ねを止めないと消えない
  function hideRecordPins() { stopClusterer(); markers.forEach((m) => { m.map = null; }); }

  // places=[{placeId,name,lat,lng,genre}] を検索ピンとして表示。タップで onSelect(placeId)
  // opts.hideRecords=true：検索結果に一致しない記録ピンを隠す（一致する記録ピンは残し、赤ピンは出さない）
  function renderPlaceResults(places, onSelect, opts) {
    opts = opts || {};
    clearPlaceResults(!!opts.hideRecords);
    places = places || [];
    if (opts.hideRecords) {
      stopClusterer(); // 束ねたままだと idle 再描画に表示状態を上書きされる
      markers.forEach((m) => {
        const c = markerLatLng(m);
        m.map = places.some((p) => sameSpot(p, c)) ? map : null;
      });
    }
    places.forEach((p) => {
      if (opts.hideRecords && markers.some((m) => sameSpot(p, markerLatLng(m)))) return; // 記録ピンがある場所は赤ピンを出さない
      const content = el('<div class="search-result"><div class="search-pin"></div><span class="search-label"></span></div>');
      content.querySelector('.search-label').textContent = p.name || ''; // 店名（注入防止で textContent）
      if (p.name) content.title = p.name;
      const m = makeMarker(p.lat, p.lng, content, { zIndex: 1100, centered: true });
      m.addListener('click', () => { if (onSelect) onSelect(p.placeId); });
      searchMarkers.push(m);
    });
  }

  function flyTo(lat, lng) { map.panTo({ lat, lng }); map.setZoom(16); }

  function getBounds() { return (map && map.getBounds) ? map.getBounds() : null; }

  // 非表示→表示の復帰時に再描画を促す（位置は変えない）
  function refresh() {
    if (!map) return;
    const c = map.getCenter();
    if (c) map.setCenter(c);
  }

  // 複数地点が全部見えるように地図を合わせる（検索結果など）
  function fitTo(records) {
    if (!records || !records.length || !map) return;
    const bounds = new google.maps.LatLngBounds();
    records.forEach((r) => bounds.extend({ lat: r.lat, lng: r.lng }));
    map.fitBounds(bounds, 60); // padding 60px
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 16) map.setZoom(16); // 1点のとき寄りすぎ防止
    });
  }

  // クラスタ（束ねたピン）のバッジ。件数を白文字で出す。
  // gmpClickable が必須：AdvancedMarkerElement のクラスタをライブラリは 'gmp-click' で
  // 待ち受けるため、これが無いとバッジをタップしても何も起きない。
  // 座標が LatLng で来るため makeMarker（lat,lng を取る）は使わず直接組む。
  const clusterRenderer = {
    render(cluster) {
      const c = el('<div class="cluster-pin"></div>');
      c.textContent = String(cluster.count); // 件数（注入防止で textContent）
      c.title = cluster.count + '件'; // 読み上げ・ホバー用（バッジの数字だけでは伝わらない）
      c.style.transform = 'translateY(50%)'; // 円の中心を座標に合わせる
      return new AdvancedMarkerElement({
        position: cluster.position,
        content: c,
        zIndex: 900,
        gmpClickable: true,
      });
    },
  };

  // クラスタをタップ：その範囲に寄せる。同じ地点だけの束は範囲がゼロで最大ズームまで
  // 飛んでしまうので、個別ピンが出る16で止める（fitTo と同じ考え方）。
  function onClusterClick(_event, cluster) {
    if (!cluster || !cluster.bounds) return;
    map.fitBounds(cluster.bounds, 60);
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 16) map.setZoom(16);
    });
  }

  // markers をクラスタラに預けて束ねる。起動できたら true。CDN未読込などで無理なら false。
  function startClusterer() {
    if (!window.markerClusterer || clusterer || !map) return false;
    clusterer = new markerClusterer.MarkerClusterer({
      map, markers, renderer: clusterRenderer, onClusterClick,
      // 既定16だと「ズーム16でもまだ束ねる」。flyTo/fitTo が16まで寄せるので、
      // 16では必ず個別ピンが見えるよう15で束ねを終わりにする。
      algorithmOptions: { maxZoom: 15 },
    });
    return true;
  }
  // 束ねを止めて素の個別ピン制御に戻す。setMap(null) で管理下のマーカーは全て map=null になる。
  function stopClusterer() {
    if (!clusterer) return;
    clusterer.setMap(null);
    clusterer = null;
  }

  // AdvancedMarker を作る。centered=true の content は中心を座標に合わせる（既定は下端中央アンカー）
  // noMap=true は地図に出さない（クラスタに預ける前に一瞬表示されるのを防ぐ）
  function makeMarker(lat, lng, content, opts) {
    opts = opts || {};
    if (opts.centered) content.style.transform = 'translateY(50%)';
    return new AdvancedMarkerElement({
      map: opts.noMap ? null : map,
      position: { lat, lng },
      content,
      zIndex: opts.zIndex,
      gmpDraggable: !!opts.draggable,
    });
  }

  // 追加しようとしている地点の目印（保存前の仮マーカー）
  function showTempMarker(lat, lng) {
    clearTempMarker();
    tempMarker = makeMarker(lat, lng, el('<div class="temp-pin"></div>'), { zIndex: 1000, centered: true });
  }
  function clearTempMarker() {
    if (tempMarker) { tempMarker.map = null; tempMarker = null; }
  }

  // 位置修正：対象地点へ寄せ、ドラッグ可能なマーカーを1つ出す
  function startPickLocation(lat, lng) {
    stopPickLocation();
    map.panTo({ lat, lng });
    if (map.getZoom() < 16) map.setZoom(16);
    pickMarker = makeMarker(lat, lng, el('<div class="temp-pin picking"></div>'),
      { zIndex: 1200, centered: true, draggable: true });
  }
  // 現在のドラッグ位置 { lat, lng }（未開始なら null）
  function getPickedLatLng() {
    if (!pickMarker) return null;
    const p = pickMarker.position;
    if (!p) return null;
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
    return { lat, lng };
  }
  function stopPickLocation() {
    if (pickMarker) { pickMarker.map = null; pickMarker = null; }
  }

  // 1件ぶんの content 要素を作る。number=順番バッジ／count>1=訪問回数バッジ。
  // 戻り値 { content, centered }（写真ピンは下端＝しっぽが座標なので centered=false）
  function markerContent(r, number, count) {
    const color = App.genres.color(r.genre);
    const photo = (r.photos || [])[0];
    let badge = '';
    if (number != null) badge = `<span class="pin-order">${number}</span>`;
    else if (count > 1) badge = `<span class="visit-count">${count}</span>`;
    if (photo) {
      const c = el(`<div class="photo-pin">`
        + `<img class="pin-img" src="${App.photos.thumbOf(photo)}" style="border-color:${color}">`
        + badge
        + `<span class="pin-tail" style="border-top-color:${color}"></span>`
        + `</div>`);
      return { content: c, centered: false };
    }
    const inner = (number != null) ? number : '';
    const dotBadge = (number == null && count > 1) ? `<span class="visit-count">${count}</span>` : '';
    const c = el(`<div class="dot-pin" style="background:${color}">${inner}${dotBadge}</div>`);
    return { content: c, centered: true };
  }

  // records: [{id, lat, lng, name, genre, photos, ...}], onClick: (record)=>void
  // opts.numbered=true で順番バッジ＋ルート点線を描く（records は表示順に並んでいる前提）
  // opts.cluster=true で近接ピンを束ねる（通常のマップ表示のみ。ルート・検索結果では使わない）
  function renderPins(records, onClick, opts) {
    clearPins();
    const numbered = !!(opts && opts.numbered);
    const countAt = opts && opts.countAt;
    clusterWanted = wantsCluster(opts);
    if (numbered && records.length > 1) {
      routeLine = new google.maps.Polyline({
        path: records.map((r) => ({ lat: r.lat, lng: r.lng })),
        strokeOpacity: 0, // 破線にするため実線は透明にして icons で点を打つ
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: '#b76e64', strokeWeight: 3, scale: 2 },
          offset: '0', repeat: '12px',
        }],
        map,
      });
    }
    records.forEach((r, i) => {
      const { content, centered } = markerContent(r, numbered ? i + 1 : null, countAt ? countAt(r) : 1);
      content.title = r.name || '(名称未設定)'; // ホバーで名前（Leaflet の tooltip 代替）
      const m = makeMarker(r.lat, r.lng, content, { centered, noMap: clusterWanted });
      m.addListener('click', () => {
        if (pickMarker && pickRecordSelect) { pickRecordSelect(r); return; } // 位置ピック中は選択に回す
        onClick(r);
      });
      markers.push(m);
    });
    // 束ねられなかったら、伏せてあるマーカーを素のまま出す（真っ白な地図にしない）
    if (clusterWanted && !startClusterer()) markers.forEach((m) => { m.map = map; });
  }

  return { init, setClickHandler, setPlaceClickHandler, getPlaceClickHandler, setRecordPickHandler, setLongPressHandler, setUserPanHandler, setTapHandler, clearPins, renderPins, flyTo, fitTo, refresh, getBounds,
           clusterEnabled, setClusterEnabled,
           renderPlaceResults, clearPlaceResults, hideRecordPins,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map, _sameSpot: sameSpot, _selfTest };
})();
