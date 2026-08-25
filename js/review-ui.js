window.App = window.App || {};
App.review = (function () {
  // ピン投入テンポの定数（docs/prototypes/2026-08-19-year-in-review-slide2.html で確定）
  var TEMPO = { start: 350, gap: 800, r: 0.8, gmin: 45, tmax: 5500, intro: 3 };

  // N本のピンの着地時刻(ms)の配列を返す。序盤 intro 本は gap 固定、以降は gap*r^k で連続的に加速。
  // 全体が tmax を超える年だけ加速区間を一律スケールして収める（序盤は保つ）。
  function _pinSchedule(n, opts) {
    var o = opts || {};
    var start = o.start != null ? o.start : TEMPO.start;
    var GAP = o.gap != null ? o.gap : TEMPO.gap;
    var R = o.r != null ? o.r : TEMPO.r;
    var GMIN = o.gmin != null ? o.gmin : TEMPO.gmin;
    var TMAX = o.tmax != null ? o.tmax : TEMPO.tmax;
    var INTRO = o.intro != null ? o.intro : TEMPO.intro;
    var times = [];
    var intro = Math.min(INTRO, n);
    for (var i = 0; i < intro; i++) times.push(start + i * GAP);
    var tPrev = times.length ? times[times.length - 1] : start;
    var gaps = [];
    for (var j = intro; j < n; j++) gaps.push(Math.max(GMIN, GAP * Math.pow(R, j - intro + 1)));
    var sum = gaps.reduce(function (a, b) { return a + b; }, 0);
    var room = TMAX - tPrev;
    var scale = (sum > room && room > 0) ? room / sum : 1;
    for (var k = 0; k < gaps.length; k++) { tPrev += gaps[k] * scale; times.push(tPrev); }
    return times;
  }

  function prefersReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 数字を from→to までカウントアップ。onEach(v) 毎フレーム、done() 完了時。
  function countUp(node, to, dur, done) {
    if (prefersReduced() || dur <= 0) { node.textContent = String(to); if (done) done(); return function () {}; }
    var t0 = null, raf;
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      node.textContent = String(Math.round(to * p));
      if (p < 1) raf = requestAnimationFrame(step); else { node.textContent = String(to); if (done) done(); }
    }
    raf = requestAnimationFrame(step);
    return function () { if (raf) cancelAnimationFrame(raf); };
  }

  // 静かな地図スタイル（POI/路線/余計なラベルを消し、暖色にミュート＝ピンが映える）。ラスター地図に適用。
  var MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#efe9df' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#a89b8a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f3efe7' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0e0cf' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e8dfce' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cdd8d5' }] },
    { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ];

  // 通常マーカー用の雫ピン（data URI）。tip を anchor に合わせて座標に立てる。
  function pinIcon(color) {
    // viewBox に上下の余白を確保（頭の丸が切れないように）。tip=(12,31) を anchor に。
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">' +
      '<path d="M12 31 C6 21 3 17 3 12 A9 9 0 1 1 21 12 C21 17 18 21 12 31 Z" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>' +
      '<circle cx="12" cy="12" r="3.5" fill="#fff"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(24, 32),
      anchor: new google.maps.Point(12, 31),
    };
  }

  // container(div) に本物の地図(ラスター・静かなスタイル)を敷き、ピンを落とす。地図が使えない時は SVG にフォールバック。
  // animate=true なら _pinSchedule の間隔で1本ずつ、numNode があれば同期カウント。破棄用に停止関数を返す。
  function renderMap(container, pins, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!pins || !pins.length) {
      if (opts.numNode) opts.numNode.textContent = '0';
      if (opts.onDone) opts.onDone();
      return function () {};
    }
    // オフライン等で Google Maps が無ければ SVG 星座にフォールバック
    if (typeof google === 'undefined' || !google.maps || !google.maps.importLibrary) {
      return renderSvgMap(container, pins, opts);
    }
    var animate = opts.animate && !prefersReduced();
    var cancelled = false, timers = [], mapObj = null;

    function drop(p, withAnim) {
      new google.maps.Marker({
        map: mapObj,
        position: { lat: p.lat, lng: p.lng },
        icon: pinIcon(App.genres.color(p.genre)),
        animation: withAnim ? google.maps.Animation.DROP : null,
        optimized: false,
      });
    }

    google.maps.importLibrary('maps').then(function (lib) {
      if (cancelled) return;
      var GMap = lib.Map;
      var mapDiv = document.createElement('div');
      mapDiv.style.position = 'absolute'; mapDiv.style.inset = '0';
      container.appendChild(mapDiv);
      mapObj = new GMap(mapDiv, {
        styles: MAP_STYLE, // ラスター地図（mapId無し）＝JSONスタイルが効く
        disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false,
        clickableIcons: false, disableDoubleClickZoom: true, zoomControl: false,
      });
      var bounds = new google.maps.LatLngBounds();
      pins.forEach(function (p) { bounds.extend({ lat: p.lat, lng: p.lng }); });
      if (pins.length === 1) { mapObj.setCenter({ lat: pins[0].lat, lng: pins[0].lng }); mapObj.setZoom(15); }
      else { mapObj.fitBounds(bounds, 44); }
      google.maps.event.addListenerOnce(mapObj, 'idle', function () {
        if (cancelled) return;
        if (!animate) {
          pins.forEach(function (p) { drop(p, false); });
          if (opts.numNode) opts.numNode.textContent = String(pins.length);
          if (opts.onDone) opts.onDone();
          return;
        }
        var times = _pinSchedule(pins.length);
        pins.forEach(function (p, i) {
          var id = setTimeout(function () {
            if (cancelled) return;
            drop(p, true);
            if (opts.numNode) opts.numNode.textContent = String(i + 1);
            if (i === pins.length - 1) {
              if (opts.numNode && opts.numNode.animate) opts.numNode.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
              if (opts.onDone) opts.onDone();
            }
          }, times[i]);
          timers.push(id);
        });
      });
    }).catch(function () {
      if (!cancelled) renderSvgMap(container, pins, opts);
    });

    return function () { cancelled = true; timers.forEach(clearTimeout); };
  }

  // SVG「あしあと星座」フォールバック（オフライン/地図読み込み失敗時）。container に svg を作って描く。
  function renderSvgMap(container, pins, opts) {
    opts = opts || {};
    var NS = 'http://www.w3.org/2000/svg';
    container.innerHTML = '';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.style.position = 'absolute'; svg.style.inset = '0'; svg.style.width = '100%'; svg.style.height = '100%';
    container.appendChild(svg);
    var pad = 34, W = 300, H = 300;
    var lats = pins.map(function (p) { return p.lat; }), lngs = pins.map(function (p) { return p.lng; });
    var minLa = Math.min.apply(null, lats), maxLa = Math.max.apply(null, lats);
    var minLo = Math.min.apply(null, lngs), maxLo = Math.max.apply(null, lngs);
    function pos(p) {
      var sx = (maxLo - minLo) || 1, sy = (maxLa - minLa) || 1;
      var x = pad + (W - 2 * pad) * ((p.lng - minLo) / sx);
      var y = pad + (H - 2 * pad) * (1 - (p.lat - minLa) / sy);
      if (pins.length === 1) { x = W / 2; y = H / 2; }
      return { x: x, y: y };
    }
    function makePin(p) {
      var pt = pos(p);
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
      g.style.transformBox = 'fill-box'; g.style.transformOrigin = 'center bottom';
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M0,-14 C6,-14 9,-9 9,-5 C9,0 3,4 0,8 C-3,4 -9,0 -9,-5 C-9,-9 -6,-14 0,-14 Z');
      path.setAttribute('fill', App.genres.color(p.genre));
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.8'); dot.setAttribute('cy', '-6'); dot.setAttribute('fill', 'rgba(255,255,255,.85)');
      g.appendChild(path); g.appendChild(dot);
      return { g: g, pt: pt };
    }
    var cancels = [];
    if (!opts.animate || prefersReduced()) {
      pins.forEach(function (p) { svg.appendChild(makePin(p).g); });
      if (opts.numNode) opts.numNode.textContent = String(pins.length);
      if (opts.onDone) opts.onDone();
      return function () {};
    }
    var times = _pinSchedule(pins.length);
    pins.forEach(function (p, i) {
      var id = setTimeout(function () {
        var m = makePin(p); svg.appendChild(m.g);
        m.g.animate(
          [{ transform: 'translate(' + m.pt.x + 'px,' + (m.pt.y - 28) + 'px) scale(.6)', opacity: 0 },
           { transform: 'translate(' + m.pt.x + 'px,' + (m.pt.y + 3) + 'px) scale(1.12)', opacity: 1, offset: .7 },
           { transform: 'translate(' + m.pt.x + 'px,' + m.pt.y + 'px) scale(1)', opacity: 1 }],
          { duration: 320, easing: 'cubic-bezier(.34,1.4,.5,1)', fill: 'forwards' });
        if (opts.numNode) opts.numNode.textContent = String(i + 1);
        if (i === pins.length - 1) {
          if (opts.numNode) opts.numNode.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
          if (opts.onDone) opts.onDone();
        }
      }, times[i]);
      cancels.push(id);
    });
    return function () { cancels.forEach(clearTimeout); };
  }

  var MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  function slideHTML(id, data) {
    if (id === 'days') return '<div class="rv-cap">付き合って</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.daysTogether + '">0</span><span class="rv-u">日目</span></div>' +
      '<div class="rv-cap">ふたりで歩いてきた</div>';
    if (id === 'outings') return '<div class="rv-cap">ふたりで過ごした日</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.outingDays + '">0</span><span class="rv-u">日</span></div>' +
      '<div class="rv-cap">' + data.count + 'か所をめぐった</div>';
    if (id === 'places') return '<div class="rv-cap">今年訪れた場所</div>' +
      '<div class="rv-big"><span class="rv-count rv-places-num">0</span><span class="rv-u">か所</span></div>' +
      '<div class="rv-map-wrap"><div class="rv-map"></div></div>';
    if (id === 'new') return '<div class="rv-cap">はじめての場所</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.newPlaces + '">0</span><span class="rv-u">軒</span></div>' +
      '<div class="rv-cap">新しい世界を見つけた</div>';
    if (id === 'topspot') return '<div class="rv-cap">いちばん通ったのは</div>' +
      '<div class="rv-mid">' + esc(data.topSpot.name || '(名称未設定)') + '</div>' +
      '<div class="rv-big rv-accent">' + data.topSpot.count + '<span class="rv-u">回</span></div>';
    if (id === 'genre') {
      var g = data.topGenre;
      var bars = data.genreBreakdown.slice(0, 5).map(function (x) {
        var max = data.genreBreakdown[0].count || 1;
        return '<span class="rv-bar" style="height:' + Math.round(100 * x.count / max) + '%;background:' + App.genres.color(x.key) + '"></span>';
      }).join('');
      return '<div class="rv-cap">いちばん多かったジャンル</div>' +
        '<div class="rv-mid">' + esc(App.genres.label(g.key)) + '</div>' +
        '<div class="rv-bars">' + bars + '</div>';
    }
    if (id === 'month') return '<div class="rv-cap">いちばん濃かった月</div>' +
      '<div class="rv-big">' + MONTHS[data.busiestMonth.month - 1] + '</div>' +
      '<div class="rv-cap">この月だけで ' + data.busiestMonth.count + '日</div>';
    if (id === 'closing') return '<div class="rv-mid rv-closing">また来年も、<br>ふたりのあしあとを。</div>' +
      '<button class="rv-btn rv-topage">総集編を見る ↓</button>';
    return '';
  }

  function _selfTestSchedule() {
    var fails = 0;
    var chk = function (name, cond) { if (!cond) fails++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); };
    var t = _pinSchedule(12);
    chk('len', t.length === 12);
    var mono = true; for (var i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) mono = false;
    chk('monotonic', mono);
    chk('intro-gap-1', Math.abs((t[1] - t[0]) - 800) < 1);   // 最初の3本は800ms間隔
    chk('intro-gap-2', Math.abs((t[2] - t[1]) - 800) < 1);
    chk('4th-smoother', (t[3] - t[2]) < (t[2] - t[1]));       // 4本目以降は間隔が縮む
    chk('accelerating', (t[4] - t[3]) < (t[3] - t[2]));
    var big = _pinSchedule(80);
    chk('big-capped', big[big.length - 1] <= 5500 + 1);       // 多件数でも約5.5秒以内
    chk('big-len', big.length === 80);
    var few = _pinSchedule(2);
    chk('few-len', few.length === 2);
    console.log(fails === 0 ? '✅ pinSchedule ALL PASS' : ('❌ pinSchedule ' + fails + ' FAIL'));
    return fails;
  }

  // ---- 状態 ----
  var anniversary = null;
  function setAnniversary(d) { anniversary = d || null; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function el(id) { return document.getElementById(id); }
  function hideAll() {
    ['review-picker', 'review-show', 'review-page'].forEach(function (i) { var e = el(i); if (e) { e.hidden = true; e.innerHTML = ''; } });
    document.body.classList.remove('reviewing'); // 現在地/写真追加ボタンの抑制を解除
  }

  function showSlides(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var ids = App.reviewStats.planSlides(data);
    var host = el('review-show');
    var bars = ids.map(function () { return '<span></span>'; }).join('');
    host.innerHTML =
      '<div class="rv-progress">' + bars + '</div>' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-nav rv-prev"></div><div class="rv-nav rv-next"></div>' +
      '<div class="rv-stage"></div>';
    host.hidden = false;
    var stage = host.querySelector('.rv-stage');
    var progs = host.querySelectorAll('.rv-progress span');
    var idx = -1, stopAnim = null;

    function cleanup() { if (stopAnim) { stopAnim(); stopAnim = null; } }
    function go(n) {
      if (n < 0) return;
      if (n >= ids.length) { cleanup(); hideAll(); showPage(data); return; }
      cleanup();
      idx = n;
      for (var i = 0; i < progs.length; i++) progs[i].classList.toggle('on', i <= idx);
      var id = ids[idx];
      stage.innerHTML = '<div class="rv-slide rv-slide-' + id + '">' + slideHTML(id, data) + '</div>';
      var toPage = stage.querySelector('.rv-topage');
      if (toPage) toPage.onclick = function () { cleanup(); hideAll(); showPage(data); };
      if (id === 'places') {
        var mapEl = stage.querySelector('.rv-map');
        var num = stage.querySelector('.rv-places-num');
        stopAnim = renderMap(mapEl, data.pins, { animate: true, numNode: num });
      } else {
        var c = stage.querySelector('.rv-count[data-to]');
        if (c) stopAnim = countUp(c, Number(c.getAttribute('data-to')), 900);
      }
    }
    host.querySelector('.rv-x').onclick = function () { cleanup(); hideAll(); };
    host.querySelector('.rv-next').onclick = function () { go(idx + 1); };
    host.querySelector('.rv-prev').onclick = function () { go(idx - 1); };
    go(0);
  }
  function goToRealMap(year) {
    // メインマップにその年の期間フィルタをかけて着地（既存フィルタUIを利用）
    hideAll();
    var ms = el('mode-select'); if (ms) ms.value = 'range';
    var f = el('from-input'), t = el('to-input');
    if (f) f.value = year + '-01-01';
    if (t) t.value = year + '-12-31';
    if (App.records && App.records.applyUiFilter) App.records.applyUiFilter();
    var mapBtn = el('view-map'); if (mapBtn) mapBtn.click(); // 地図ビューへ
  }

  // その年の写真URLを日付昇順で集める。並べ替えを忘れると「1年に散らす」が効かない。
  // thumbOf はサムネ(400px)を返す。タイルは45×48しか使わないので、これで十分かつ軽い。
  function yearPhotoUrls(year) {
    var urls = [];
    App.records.getAll()
      .filter(function (r) { return String(r.date).slice(0, 4) === String(year); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (r) {
        (r.photos || []).forEach(function (p) {
          var u = App.photos.thumbOf(p);
          if (u) urls.push(u);
        });
      });
    return urls;
  }

  // 画像を共有シートに渡す。使えなければダウンロードに落とす。
  async function sharePoster(blob, year) {
    var name = 'ashiato-' + year + '.png';
    var file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: year + '年のあしあと' });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 本人が閉じただけ。何もしない
        // それ以外は保存に落とす
      }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // 保存が始まる前に取り消すと落ちることがあるので、少し置いてから返す
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ボタンから呼ぶ。生成中は押せなくする。
  async function savePoster(btn, data) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      var blob = await App.reviewPoster.build(data, yearPhotoUrls(data.year));
      await sharePoster(blob, data.year);
    } catch (e) {
      console.error('poster failed', e);
      alert('画像を作れませんでした');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  function showPage(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var host = el('review-page');
    var tiles = [
      { n: data.newPlaces, l: 'はじめての場所', u: '軒' },
      { n: data.topGenre ? App.genres.label(data.topGenre.key) : '—', l: 'いちばんのジャンル', u: '' },
      { n: data.photoCount, l: '写真', u: '枚' },
      { n: data.busiestMonth ? (MONTHS[data.busiestMonth.month - 1]) : '—', l: 'いちばん濃かった月', u: '' },
    ].map(function (x) {
      return '<div class="rv-tile"><div class="rv-tile-n">' + esc(String(x.n)) + '<span class="rv-tile-u">' + x.u + '</span></div><div class="rv-tile-l">' + x.l + '</div></div>';
    }).join('');

    var maxM = Math.max.apply(null, data.monthlyCounts.concat([1]));
    var monthBars = data.monthlyCounts.map(function (c, i) {
      return '<div class="rv-mb"><span style="height:' + Math.round(100 * c / maxM) + '%"></span><small>' + (i + 1) + '</small></div>';
    }).join('');

    var genreRows = data.genreBreakdown.map(function (g) {
      var max = data.genreBreakdown[0].count || 1;
      return '<div class="rv-grow"><span class="rv-glabel">' + esc(App.genres.label(g.key)) + '</span>' +
        '<span class="rv-gbar" style="width:' + Math.round(100 * g.count / max) + '%;background:' + App.genres.color(g.key) + '"></span>' +
        '<span class="rv-gcount">' + g.count + '</span></div>';
    }).join('');

    var photos = [];
    App.records.getAll().forEach(function (r) {
      if (String(r.date).slice(0, 4) === String(data.year) && r.photos) {
        r.photos.forEach(function (p) { if (photos.length < 9) photos.push(App.photos.thumbOf(p)); });
      }
    });
    var photoGrid = photos.length
      ? '<div class="rv-photos">' + photos.map(function (u) { return '<div class="rv-photo" style="background-image:url(' + u + ')"></div>'; }).join('') + '</div>'
      : '';

    var best = data.best3.map(function (s, i) {
      return '<div class="rv-best"><span class="rv-best-rank">' + (i + 1) + '</span><span class="rv-best-name">' + esc(s.name || '(名称未設定)') + '</span><span class="rv-best-count">' + s.count + '回</span></div>';
    }).join('');

    function outing(label, rec) {
      if (!rec) return '';
      return '<button class="rv-outing" data-date="' + rec.date + '"><span class="rv-outing-l">' + label + '</span>' +
        '<span class="rv-outing-name">' + esc(rec.name || '(名称未設定)') + '</span>' +
        '<span class="rv-outing-date">' + String(rec.date).replace(/-/g, '.') + '</span></button>';
    }

    var daysLine = data.daysTogether != null ? '<div class="rv-hero-days">付き合って ' + data.daysTogether + '日目</div>' : '';
    host.innerHTML =
      '<div class="rv-page">' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-hero"><div class="rv-hero-sub">' + data.year + '年のあしあと</div>' +
      daysLine + '<div class="rv-hero-count">おでかけ ' + data.outingDays + '日</div>' +
      '<div class="rv-hero-sub2">訪れた場所 ' + data.count + 'か所</div></div>' +
      '<div class="rv-tiles">' + tiles + '</div>' +
      '<div class="rv-section"><div class="rv-h">あしあと地図</div><div class="rv-map-wrap rv-map-page"><div class="rv-map"></div></div>' +
      '<button class="rv-btn rv-realmap">本物の地図でこの年を見る</button></div>' +
      '<div class="rv-section"><div class="rv-h">月別のおでかけ</div><div class="rv-months">' + monthBars + '</div></div>' +
      '<div class="rv-section"><div class="rv-h">ジャンル</div>' + genreRows + '</div>' +
      (photoGrid ? '<div class="rv-section"><div class="rv-h">写真</div>' + photoGrid + '</div>' : '') +
      (best ? '<div class="rv-section"><div class="rv-h">よく行ったところ</div>' + best + '</div>' : '') +
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      (data.isEmpty ? '' : '<div class="rv-section rv-save-wrap"><button class="rv-save">画像で保存・共有</button></div>') +
      '</div>';

    host.querySelector('.rv-x').onclick = hideAll;
    var mapEl = host.querySelector('.rv-map');
    if (data.pins.length) renderMap(mapEl, data.pins, { animate: false });
    host.querySelector('.rv-realmap').onclick = function () { goToRealMap(data.year); };
    var saveBtn = host.querySelector('.rv-save');
    if (saveBtn) saveBtn.onclick = function () { savePoster(saveBtn, data); };
    host.querySelectorAll('.rv-outing').forEach(function (b) {
      b.onclick = function () { hideAll(); App.records.focusDay(b.getAttribute('data-date')); };
    });
    host.scrollTop = 0;
    host.hidden = false;
  }

  // 対象年のデータを作って開く
  function open(year) {
    var data = App.reviewStats.computeYearReview(App.records.getAll(), year, anniversary, todayStr());
    hideAll();
    if (data.isEmpty) { showPage(data); return; }
    if (data.isSparse) { showSparse(data); return; }
    showSlides(data);
  }

  // 年ピッカー
  function showPicker() {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var years = App.reviewStats.yearsWithRecords(App.records.getAll());
    var host = el('review-picker');
    if (!years.length) {
      host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">ふりかえり</div>' +
        '<p class="rv-empty">まだ記録がありません。おでかけを記録するとここに出ます。</p>' +
        '<button class="rv-btn rv-close">閉じる</button></div>';
    } else {
      var items = years.map(function (y) {
        return '<button class="rv-year" data-year="' + y + '">' + y + '年</button>';
      }).join('');
      host.innerHTML = '<div class="rv-picker"><div class="rv-picker-head">どの年をふりかえる？</div>' +
        '<div class="rv-years">' + items + '</div>' +
        '<button class="rv-btn rv-close">閉じる</button></div>';
      host.querySelectorAll('.rv-year').forEach(function (b) {
        b.onclick = function () { open(Number(b.getAttribute('data-year'))); };
      });
    }
    host.querySelector('.rv-close').onclick = hideAll;
    host.hidden = false;
  }

  // 件数が少ない年
  function showSparse(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var host = el('review-show');
    host.innerHTML = '<div class="rv-slide rv-sparse">' +
      '<button class="rv-x" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-sparse-emoji">🌱</div>' +
      '<div class="rv-mid">まだ' + data.year + '年のあしあとは少なめ</div>' +
      '<div class="rv-cap">これからだね</div>' +
      '<button class="rv-btn rv-topage">記録を見る</button></div>';
    host.querySelector('.rv-x').onclick = hideAll;
    host.querySelector('.rv-topage').onclick = function () { hideAll(); showPage(data); };
    host.hidden = false;
  }

  // 年末ウィンドウ(12/20〜翌1/10)に、対象年(12月=今年 / 1月=前年)の件数>=3 かつ未dismissなら
  // #review-card を出す。出したら true。
  function maybeShowYearEndCard() {
    var host = el('review-card');
    if (!host) return false;
    var now = new Date();
    var mo = now.getMonth() + 1, day = now.getDate();
    var inWindow = (mo === 12 && day >= 20) || (mo === 1 && day <= 10);
    if (!inWindow) { host.hidden = true; return false; }
    var targetYear = (mo === 12) ? now.getFullYear() : now.getFullYear() - 1;
    var key = 'reviewDismissed:' + targetYear;
    try { if (localStorage.getItem(key)) { host.hidden = true; return false; } } catch (e) {}
    var data = App.reviewStats.computeYearReview(App.records.getAll(), targetYear, null, todayStr());
    if (data.count < 3) { host.hidden = true; return false; }
    host.innerHTML =
      '<div class="rv-card-inner">' +
      '<div class="rv-card-icon"><i class="ph ph-sparkle"></i></div>' +
      '<button class="rv-card-open"><div class="rv-card-label">ふりかえり</div>' +
      '<div class="rv-card-title">' + targetYear + '年のふりかえりができました</div>' +
      '<div class="rv-card-sub">タップで再生 ・ ' + data.outingDays + '日のおでかけ</div></button>' +
      '<button class="rv-card-x" aria-label="閉じる"><i class="ph ph-x"></i></button></div>';
    host.querySelector('.rv-card-open').onclick = function () { host.hidden = true; open(targetYear); };
    host.querySelector('.rv-card-x').onclick = function () {
      try { localStorage.setItem(key, '1'); } catch (e) {}
      host.hidden = true;
    };
    host.hidden = false;
    return true;
  }

  return { open: open, showPicker: showPicker, setAnniversary: setAnniversary,
    showSlides: showSlides, showPage: showPage,
    maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO };
})();
