window.App = window.App || {};
App.map = (function () {
  const MAP_ID = '453a543cb81d00c3bbdfb47d'; // Google Maps の Map ID（ベクター）

  let map;
  let AdvancedMarkerElement;   // marker ライブラリのクラス（init で読み込む）
  let markers = [];            // renderPins で出したマーカー
  let routeLine = null;        // ルートの点線（numbered 表示時）
  let tempMarker = null;       // 追加フォーム中の目印
  let pickMarker = null;       // 位置修正のドラッグ用
  let onMapClick = null;       // (lat, lng) => void  ... 空きタップ（現在は未使用）
  let onPlaceClick = null;     // (placeId) => void  ... 店(POI)タップ時
  let onLongPress = null;      // (lat, lng) => void  ... 長押し（記録追加）

  const VIEW_KEY = 'date-recorder-view';

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
      if (e.placeId) {                 // 店・施設(POI)をタップ
        if (e.stop) e.stop();          // Google標準の情報ウィンドウを抑制
        if (onPlaceClick) onPlaceClick(e.placeId);
        return;
      }
      if (onMapClick && e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng()); // 空きタップ（現在は未使用）
    });
    // 長押し（スマホ）／右クリック（PC）＝その地点に記録を追加
    map.addListener('contextmenu', (e) => { if (onLongPress && e.latLng) onLongPress(e.latLng.lat(), e.latLng.lng()); });
    map.addListener('idle', saveView); // 表示位置・ズームを保存
  }

  function setClickHandler(fn) { onMapClick = fn; }
  function setPlaceClickHandler(fn) { onPlaceClick = fn; }
  function setLongPressHandler(fn) { onLongPress = fn; }

  function clearPins() {
    markers.forEach((m) => { m.map = null; });
    markers = [];
    if (routeLine) { routeLine.setMap(null); routeLine = null; }
  }

  function flyTo(lat, lng) { map.panTo({ lat, lng }); map.setZoom(16); }

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

  // AdvancedMarker を作る。centered=true の content は中心を座標に合わせる（既定は下端中央アンカー）
  function makeMarker(lat, lng, content, opts) {
    opts = opts || {};
    if (opts.centered) content.style.transform = 'translateY(50%)';
    return new AdvancedMarkerElement({
      map,
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
        + `<img class="pin-img" src="${photo.url}" style="border-color:${color}">`
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
  function renderPins(records, onClick, opts) {
    clearPins();
    const numbered = !!(opts && opts.numbered);
    const countAt = opts && opts.countAt;
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
      const m = makeMarker(r.lat, r.lng, content, { centered });
      m.addListener('click', () => onClick(r));
      markers.push(m);
    });
  }

  return { init, setClickHandler, setPlaceClickHandler, setLongPressHandler, clearPins, renderPins, flyTo, fitTo, refresh,
           showTempMarker, clearTempMarker,
           startPickLocation, getPickedLatLng, stopPickLocation,
           _getMap: () => map };
})();
