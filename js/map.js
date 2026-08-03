window.App = window.App || {};
App.map = (function () {
  let map, layer;
  let tempMarker = null; // 追加フォームを開いている間だけ出す目印
  let onMapClick = null; // (lat, lng) => void  ... Task 4 で設定

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
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
  }

  function init() {
    const v = loadView();
    map = L.map('map', { zoomControl: false }).setView([v.lat, v.lng], v.zoom);
    L.control.zoom({ position: 'bottomleft' }).addTo(map); // 浮かせたピルと重ならないよう左下へ
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd',
      keepBuffer: 6,            // 画面外タイルを多めに保持（パン/ズームでの空白を減らす）
      updateWhenZooming: false, // ズーム操作中は要求を出さず、落ち着いてからまとめて読み込む
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng); });
    map.on('moveend', saveView); // 表示中の位置・ズームを毎回保存
  }

  function setClickHandler(fn) { onMapClick = fn; }
  function clearPins() { layer.clearLayers(); }
  function flyTo(lat, lng) { map.setView([lat, lng], 16); }
  function refresh() { if (map) map.invalidateSize(); } // 非表示から戻ったとき再描画

  // 複数地点が全部見えるように地図を合わせる（検索結果など）
  function fitTo(records) {
    if (!records || !records.length) return;
    const bounds = L.latLngBounds(records.map((r) => [r.lat, r.lng]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  }

  // 追加しようとしている地点の目印（保存前の仮マーカー）
  function showTempMarker(lat, lng) {
    clearTempMarker();
    tempMarker = L.marker([lat, lng], {
      interactive: false,
      zIndexOffset: 1000,
      icon: L.divIcon({ className: '', html: '<div class="temp-pin"></div>',
        iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(map);
  }
  function clearTempMarker() {
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  }

  // 1件ぶんのマーカーを作る。number=順番バッジ／count>1=訪問回数バッジ
  function markerFor(r, number, count) {
    const color = App.genres.color(r.genre);
    const photo = (r.photos || [])[0];
    let badge = '';
    if (number != null) badge = `<span class="pin-order">${number}</span>`;
    else if (count > 1) badge = `<span class="visit-count">${count}</span>`;
    if (photo) {
      // 写真つき → その写真をサムネイルにしたピン（Instagramのマップ風）
      return L.marker([r.lat, r.lng], {
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: '',
          // 同じ形（インスタのマップ風）＋枠はジャンル色
          html: `<div class="photo-pin">`
            + `<img class="pin-img" src="${photo.url}" style="border-color:${color}">`
            + badge
            + `<span class="pin-tail" style="border-top-color:${color}"></span>`
            + `</div>`,
          iconSize: [62, 74],
          iconAnchor: [31, 74], // しっぽの先端が場所を指す
        }),
      });
    }
    // 写真なし → ジャンル色の丸ピン（divIconに統一し、ズーム時も写真ピンと同じ挙動に）
    const inner = (number != null) ? number : '';
    const dotBadge = (number == null && count > 1) ? `<span class="visit-count">${count}</span>` : '';
    const size = (number != null) ? 26 : 20;
    return L.marker([r.lat, r.lng], {
      bubblingMouseEvents: false,
      icon: L.divIcon({
        className: '',
        html: `<div class="dot-pin" style="background:${color}">${inner}${dotBadge}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
    });
  }

  // records: [{id, lat, lng, name, genre, photos, ...}], onClick: (record)=>void
  // opts.numbered=true で順番バッジ＋ルート線を描く（records は表示順に並んでいる前提）
  function renderPins(records, onClick, opts) {
    clearPins();
    const numbered = !!(opts && opts.numbered);
    const countAt = opts && opts.countAt;
    if (numbered && records.length > 1) {
      L.polyline(records.map((r) => [r.lat, r.lng]), {
        color: '#b76e64', weight: 3, opacity: 0.9, dashArray: '2 9', lineCap: 'round',
      }).addTo(layer);
    }
    records.forEach((r, i) => {
      const marker = markerFor(r, numbered ? i + 1 : null, countAt ? countAt(r) : 1);
      marker.bindTooltip(r.name || '(名称未設定)');
      marker.on('click', () => onClick(r));
      marker.addTo(layer);
    });
  }

  return { init, setClickHandler, clearPins, renderPins, flyTo, fitTo, refresh,
           showTempMarker, clearTempMarker,
           _getMap: () => map, _getLayer: () => layer };
})();
