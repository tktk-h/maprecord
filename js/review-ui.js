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
  // 答えが出る前に候補をパラパラ回す（スロット）。だんだん遅くして最後に答えで止まる。
  // countUp と同じ作法：止める関数を返し、動きを減らす設定なら即座に答えを出す。
  // pool = 回す候補の文字列、final = 最後に必ず出るもの、done = 止まったあとにやること。
  var SPIN_STEPS = 14, SPIN_FIRST = 45, SPIN_LAST = 210; // 合計 約1.4秒
  function _spinGaps(n, first, last) {
    var gaps = [];
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 1 : i / (n - 1);
      gaps.push(Math.round(first + (last - first) * t * t)); // 後半ほど間が伸びる
    }
    return gaps;
  }
  function spinTo(node, pool, final, done) {
    if (!node) { if (done) done(); return function () {}; }
    // 候補が乏しければ回しても回っているように見えない。答えだけ出す。
    var list = (pool || []).filter(function (s) { return s && s !== final; });
    if (prefersReduced() || list.length < 2) {
      node.textContent = final;
      if (done) done();
      return function () {};
    }
    var gaps = _spinGaps(SPIN_STEPS, SPIN_FIRST, SPIN_LAST);
    var timers = [], at = 0, prev = null;
    node.classList.add('rv-spinning');
    gaps.forEach(function (g, i) {
      at += g;
      timers.push(setTimeout(function () {
        if (i === gaps.length - 1) {
          node.textContent = final;
          node.classList.remove('rv-spinning');
          node.classList.add('rv-landed');
          if (done) done();
          return;
        }
        // 同じ候補が2回続くと止まって見えるので、直前とは違うものを選ぶ
        var pick = list[Math.floor(Math.random() * list.length)];
        if (pick === prev && list.length > 1) pick = list[(list.indexOf(pick) + 1) % list.length];
        prev = pick;
        node.textContent = pick;
      }, at));
    });
    return function () {
      timers.forEach(clearTimeout);
      node.classList.remove('rv-spinning');
      node.textContent = final; // 途中で止めたら答えを残す（候補が出たままにしない）
    };
  }

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

  function slideHTML(id, data) {
    var kind = data.period.kind;
    if (id === 'days') return '<div class="rv-cap">付き合って</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.daysTogether + '">0</span><span class="rv-u">日目</span></div>' +
      '<div class="rv-cap">ふたりで歩いてきた</div>';
    if (id === 'outings') return '<div class="rv-cap">ふたりで過ごした日</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.outingDays + '">0</span><span class="rv-u">日</span></div>' +
      '<div class="rv-cap">' + data.count + 'か所をめぐった</div>';
    if (id === 'places') return '<div class="rv-cap">' + (kind === 'year' ? '今年訪れた場所' : '訪れた場所') + '</div>' +
      '<div class="rv-big"><span class="rv-count rv-places-num">0</span><span class="rv-u">か所</span></div>' +
      '<div class="rv-map-wrap"><div class="rv-map"></div></div>';
    if (id === 'new') return '<div class="rv-cap">はじめての場所</div>' +
      '<div class="rv-big"><span class="rv-count" data-to="' + data.newPlaces + '">0</span><span class="rv-u">軒</span></div>' +
      '<div class="rv-cap">新しい世界を見つけた</div>';
    // 以下3枚は答えが出るまで候補を回す（showSlides 側で spinTo が動く）。
    // 中身は空にしておき、回し終わってから埋める。
    if (id === 'topspot') return '<div class="rv-cap">いちばん通ったのは</div>' +
      '<div class="rv-mid rv-spin"></div>' +
      '<div class="rv-big rv-accent rv-after"><span class="rv-count" data-to="' + data.topSpot.count + '">0</span><span class="rv-u">回</span></div>';
    if (id === 'genre') {
      var bars = data.genreBreakdown.slice(0, 5).map(function (x) {
        var max = data.genreBreakdown[0].count || 1;
        return '<span class="rv-bar" style="--h:' + Math.round(100 * x.count / max) + '%;background:' + App.genres.color(x.key) + '"></span>';
      }).join('');
      return '<div class="rv-cap">いちばん多かったジャンル</div>' +
        '<div class="rv-mid rv-spin"></div>' +
        '<div class="rv-bars rv-after">' + bars + '</div>';
    }
    if (id === 'busiest') {
      var unit = data.buckets.unit === 'month' ? '月' : '年';
      return '<div class="rv-cap">いちばん濃かった' + unit + '</div>' +
        '<div class="rv-big rv-spin"></div>' +
        '<div class="rv-cap rv-after">この' + unit + 'だけで <span class="rv-count" data-to="' + data.busiest.count + '">0</span>日</div>';
    }
    if (id === 'closing') return '<div class="rv-mid rv-closing">' +
      (kind === 'year' ? 'また来年も、<br>ふたりのあしあとを。' : 'これからも、<br>ふたりのあしあとを。') + '</div>' +
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
  // 期間に入る記録の数。0件の期間を開くと空の総集編になるので、その判断にも使う。
  function countInRange(records, from, to) {
    return (records || []).filter(function (r) {
      return r && r.date && String(r.date) >= from && String(r.date) <= to;
    }).length;
  }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 属性値に URL を入れるとき用。esc に加えて引用符も潰す（URL は写真の保存先＝外部由来）。
  function attrUrl(u) { return esc(u).replace(/"/g, '&quot;'); }
  function el(id) { return document.getElementById(id); }
  // プレビューに出している画像の後始末。閉じ忘れると blob がメモリに残る。
  var previewUrl = null;
  function clearPreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  function hideAll() {
    var ids = ['review-picker', 'review-show', 'review-page', 'poster-preview'];
    var closing = 0;
    // 中身を捨てるのも、写真の後始末も、印を外すのも「閉じ終わってから」。
    // 先にやると、滑って降りていく最中の画面が空になり、
    // 抑えていた地図の浮きボタン（z-index:500）がその上に顔を出す。
    // ⚠️閉じている間に、次のふりかえり画面がもう開いていることがある
    // （スライド→まとめ は hideAll(); showPage(); と続けて呼ぶ）。
    // 予約した後始末を無条件に走らせると、開いたばかりの総集編から印を剥がしてしまい、
    // 抑えていた地図のボタン（現在地・まとめて）がその上に出てくる。
    // だから「いま出ているか」は予約した時点ではなく、発火した時点で見る。
    function anyOpen() {
      return ids.some(function (i) { var e = el(i); return e && !e.hidden; });
    }
    function finished() {
      closing -= 1;
      if (closing > 0) return;
      var poster = el('poster-preview');
      if (!poster || poster.hidden) clearPreview(); // 新しいポスターが出ていれば、その写真は捨てない
      if (!anyOpen()) document.body.classList.remove('reviewing');
    }
    ids.forEach(function (i) {
      var e = el(i);
      if (!e) return;
      if (e.hidden) { e.innerHTML = ''; return; } // 出ていないものは待つ必要がない
      closing += 1;
      App.overlay.close(e, function () { e.innerHTML = ''; finished(); });
    });
    if (!closing) {
      clearPreview();
      if (!anyOpen()) document.body.classList.remove('reviewing');
    }
  }

  // 回すもの（候補・答え）はスライドごとに違うので、ここで1か所にまとめる。
  function spinPlan(id, data) {
    if (id === 'topspot') {
      return { pool: data.spotNames || [], final: data.topSpot.name || '(名称未設定)' };
    }
    if (id === 'genre') {
      return {
        pool: (data.genreBreakdown || []).map(function (x) { return App.genres.label(x.key); }),
        final: App.genres.label(data.topGenre.key),
      };
    }
    if (id === 'busiest') {
      return {
        pool: ((data.buckets && data.buckets.items) || []).map(function (b) { return b.label; }),
        final: data.busiest.label,
      };
    }
    return null;
  }

  // 候補を回し、止まってから下の数字や棒を出す。止める関数を返す（cleanup 用）。
  function runSpin(stage, id, data) {
    var plan = spinPlan(id, data);
    var node = stage.querySelector('.rv-spin');
    if (!plan || !node) return function () {};
    var after = stage.querySelector('.rv-after');
    var stopCount = null;
    var stopSpin = spinTo(node, plan.pool, plan.final, function () {
      if (after) after.classList.add('on'); // 答えが出てから、数字や棒が続く
      var c = stage.querySelector('.rv-count[data-to]');
      if (c) stopCount = countUp(c, Number(c.getAttribute('data-to')), 700);
    });
    return function () {
      stopSpin();
      if (stopCount) stopCount();
      if (after) after.classList.add('on'); // 途中で止めても中身は見せる
      var c2 = stage.querySelector('.rv-count[data-to]');
      if (c2) c2.textContent = c2.getAttribute('data-to');
    };
  }

  function showSlides(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var ids = App.reviewStats.planSlides(data);
    var host = el('review-show');
    var bars = ids.map(function () { return '<span></span>'; }).join('');
    host.innerHTML =
      '<div class="rv-progress">' + bars + '</div>' +
      '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-nav rv-prev"></div><div class="rv-nav rv-next"></div>' +
      '<div class="rv-stage"></div>';
    App.overlay.open(host);
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
      } else if (stage.querySelector('.rv-spin')) {
        stopAnim = runSpin(stage, id, data);
      } else {
        var c = stage.querySelector('.rv-count[data-to]');
        if (c) stopAnim = countUp(c, Number(c.getAttribute('data-to')), 900);
      }
    }
    host.querySelector('.x-btn').onclick = function () { cleanup(); hideAll(); };
    host.querySelector('.rv-next').onclick = function () { go(idx + 1); };
    host.querySelector('.rv-prev').onclick = function () { go(idx - 1); };
    go(0);
  }
  // 地図から総集編へ戻るための控え。goToRealMap で覚え、戻るボタンで使う。
  var lastData = null;

  function hideBackToReview() {
    var b = el('review-back'); if (b) b.hidden = true;
  }

  // goToRealMap がかけた絞り込み。× で戻すために控えておく。
  var appliedFilter = null;

  // ×＝この期間はもう見終わった、という意思表示。自分でかけた絞り込みもここで戻す。
  // 戻すのは自分がかけたぶんだけ。そのあと本人が絞り込みを変えていたら触らない。
  function dismissBackToReview() {
    hideBackToReview();
    if (appliedFilter && App.records && App.records.undoFilter) App.records.undoFilter(appliedFilter);
    appliedFilter = null;
  }

  // 「ふりかえりに戻る」を地図の上に出す。押すと同じ期間の総集編をもう一度開く。
  function showBackToReview() {
    var host = el('review-back');
    if (!host || !lastData) return;
    host.querySelector('.rb-open').onclick = function () {
      hideBackToReview();
      showPage(lastData);
    };
    host.querySelector('.rb-x').onclick = dismissBackToReview;
    host.hidden = false;
  }

  function goToRealMap(period) {
    // メインマップにその期間のフィルタをかけて着地（既存フィルタUIを利用）
    hideAll();
    var ms = el('mode-select');
    if (period.kind === 'all') {
      if (ms) ms.value = 'all';
      appliedFilter = null; // 「これまで」は絞り込まないので戻すものがない
    } else {
      if (ms) ms.value = 'range';
      var f = el('from-input'), t = el('to-input');
      if (f) f.value = period.start;
      if (t) t.value = period.end;
      appliedFilter = { mode: 'range', from: period.start, to: period.end };
    }
    if (App.records && App.records.applyUiFilter) App.records.applyUiFilter();
    var mapBtn = el('view-map'); if (mapBtn) mapBtn.click(); // 地図ビューへ
    // 絞り込むだけでは地図が動かず、直前に開いていた場所のままになる。
    // 地図ビューを出した後にその期間のピンへ合わせる（表示直後はレイアウトが
    // 固まっていないので1拍おく）。
    var pins = lastData && lastData.pins;
    if (pins && pins.length && App.map && App.map.fitTo) {
      setTimeout(function () { App.map.fitTo(pins); }, 0);
    }
    showBackToReview();
  }

  // その期間の写真URLを日付昇順で集める。並べ替えを忘れると「期間内に散らす」が効かない。
  // thumbOf はサムネ(400px)を返す。タイルは45×48しか使わないので、これで十分かつ軽い。
  function periodPhotoUrls(period) {
    var urls = [];
    App.records.getAll()
      .filter(function (r) { return r && r.date && String(r.date) >= period.start && String(r.date) <= period.end; })
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
  async function sharePoster(blob, period) {
    var name = App.reviewPoster.posterFileName(period.label);
    var file = new File([blob], name, { type: 'image/png' });
    var title = period.label + (period.kind === 'year' ? '年のあしあと' : 'のあしあと');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title });
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

  // 作った画像はまず見せる。共有するかどうかは見てから決めてもらう。
  function showPosterPreview(blob, period) {
    var host = el('poster-preview');
    if (!host) { sharePoster(blob, period); return; } // 置き場所が無ければ従来どおり
    clearPreview();
    previewUrl = URL.createObjectURL(blob);
    host.innerHTML =
      '<button class="x-btn x-fixed on-dark" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="pv-wrap">' +
      '<img class="pv-img" alt="" src="' + previewUrl + '">' +
      '<div class="pv-actions">' +
      '<button class="rv-btn pv-share">共有・保存</button>' +
      '</div></div>';
    host.querySelector('.pv-share').onclick = function () { sharePoster(blob, period); };
    host.querySelector('.x-btn').onclick = function () {
      // 写真の後始末も中身を捨てるのも閉じ終わってから。先にやると、
      // 滑って降りていく最中のプレビューから写真が消える。
      App.overlay.close(host, function () { host.innerHTML = ''; clearPreview(); });
    };
    host.scrollTop = 0;
    App.overlay.open(host);
  }

  // ボタンから呼ぶ。生成中は押せなくする。
  async function savePoster(btn, data) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      var urls = periodPhotoUrls(data.period);
      var blob = await App.reviewPoster.build(data, urls);
      // 写真があるのに1枚も背景に使えなかったときは黙って劣化させず、理由ごと伝える。
      // （端末でしか起きない読み込み失敗を、次に当て推量なしで追えるようにする）
      var d = App.reviewPoster.lastDiag && App.reviewPoster.lastDiag();
      if (urls.length && d && d.viaFetch === 0 && d.viaImg === 0) {
        // 写真の保存先(Storage)に CORS 設定が無いと、ブラウザは写真を canvas に
        // 描かせてくれない。設定すれば直るので、原因の見当がつく言い方にしておく。
        alert('写真を背景に使えませんでした。\n写真の保存先の設定（CORS）が必要です。\n[' + urls.length + '枚 / ' + (d.why || '原因不明') + ']');
      }
      showPosterPreview(blob, data.period);
    } catch (e) {
      console.error('poster failed', e);
      alert('画像を作れませんでした');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  function showPage(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    lastData = data; // 地図へ出たあと、ここへ戻れるように覚えておく
    var host = el('review-page');
    var period = data.period;
    var unit = data.buckets.unit === 'month' ? '月' : '年';
    var tiles = [
      { n: data.newPlaces, l: 'はじめての場所', u: '軒' },
      { n: data.topGenre ? App.genres.label(data.topGenre.key) : '—', l: 'いちばんのジャンル', u: '' },
      { n: data.photoCount, l: '写真', u: '枚' },
      { n: data.busiest ? data.busiest.label : '—', l: 'いちばん濃かった' + unit, u: '' },
    ].map(function (x) {
      return '<div class="rv-tile"><div class="rv-tile-n">' + esc(String(x.n)) + '<span class="rv-tile-u">' + x.u + '</span></div><div class="rv-tile-l">' + x.l + '</div></div>';
    }).join('');

    // 棒が1本しかない期間はグラフにならないので節ごと出さない
    var bucketSection = '';
    if (data.buckets.items.length >= 2) {
      var maxB = Math.max.apply(null, data.buckets.items.map(function (b) { return b.count; }).concat([1]));
      var bars = data.buckets.items.map(function (b) {
        return '<div class="rv-mb"><span style="height:' + Math.round(100 * b.count / maxB) + '%"></span><small>' + esc(b.label.replace(/[月年]$/, '')) + '</small></div>';
      }).join('');
      bucketSection = '<div class="rv-section"><div class="rv-h">' + unit + '別のおでかけ</div><div class="rv-months">' + bars + '</div></div>';
    }

    var genreRows = data.genreBreakdown.map(function (g) {
      var max = data.genreBreakdown[0].count || 1;
      return '<div class="rv-grow"><span class="rv-glabel">' + esc(App.genres.label(g.key)) + '</span>' +
        '<span class="rv-gbar" style="width:' + Math.round(100 * g.count / max) + '%;background:' + App.genres.color(g.key) + '"></span>' +
        '<span class="rv-gcount">' + g.count + '</span></div>';
    }).join('');

    var photos = [];
    App.records.getAll().forEach(function (r) {
      if (r && r.date && String(r.date) >= period.start && String(r.date) <= period.end && r.photos) {
        r.photos.forEach(function (p) { if (photos.length < 9) photos.push(App.photos.thumbOf(p)); });
      }
    });
    // ⚠️ ここは背景画像（no-cors）のまま。crossorigin を付けた <img> にすると
    // Storage バケットに CORS 設定が無いあいだは1枚も表示できなくなる（実機で確認済み）。
    var photoGrid = photos.length
      ? '<div class="rv-photos">' + photos.map(function (u) {
        return '<div class="rv-photo" style="background-image:url(' + attrUrl(u) + ')"></div>';
      }).join('') + '</div>'
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
    // ラベルはユーザーが打った文字なので必ず esc を通す
    var title = esc(period.label) + (period.kind === 'year' ? '年のあしあと' : 'のあしあと');
    var dateLine = App.reviewStats.formatDateLine(period);
    host.innerHTML =
      '<div class="rv-page">' +
      '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-hero"><div class="rv-hero-sub">' + title + '</div>' +
      (dateLine ? '<div class="rv-hero-dates">' + dateLine + '</div>' : '') +
      daysLine + '<div class="rv-hero-count">おでかけ ' + data.outingDays + '日</div>' +
      '<div class="rv-hero-sub2">訪れた場所 ' + data.count + 'か所</div></div>' +
      '<div class="rv-tiles">' + tiles + '</div>' +
      '<div class="rv-section"><div class="rv-h">あしあと地図</div><div class="rv-map-wrap rv-map-page"><div class="rv-map"></div></div>' +
      '<button class="rv-btn rv-realmap">本物の地図で' + (period.kind === 'year' ? 'この年' : 'この期間') + 'を見る</button></div>' +
      bucketSection +
      '<div class="rv-section"><div class="rv-h">ジャンル</div>' + genreRows + '</div>' +
      (photoGrid ? '<div class="rv-section"><div class="rv-h">写真</div>' + photoGrid + '</div>' : '') +
      (best ? '<div class="rv-section"><div class="rv-h">よく行ったところ</div>' + best + '</div>' : '') +
      '<div class="rv-section"><div class="rv-h">最初と最後</div>' + outing('最初のおでかけ', data.firstOuting) + outing('最後のおでかけ', data.lastOuting) + '</div>' +
      (data.isEmpty ? '' : '<div class="rv-section rv-save-wrap"><button class="rv-save">画像で保存・共有</button></div>') +
      '</div>';

    host.querySelector('.x-btn').onclick = hideAll;
    var mapEl = host.querySelector('.rv-map');
    if (data.pins.length) renderMap(mapEl, data.pins, { animate: false });
    host.querySelector('.rv-realmap').onclick = function () { goToRealMap(period); };
    var saveBtn = host.querySelector('.rv-save');
    if (saveBtn) saveBtn.onclick = function () { savePoster(saveBtn, data); };
    host.querySelectorAll('.rv-outing').forEach(function (b) {
      b.onclick = function () { hideAll(); App.records.focusDay(b.getAttribute('data-date')); };
    });
    host.scrollTop = 0;
    App.overlay.open(host);
  }

  // 対象期間のデータを作って開く
  function open(period) {
    var data = App.reviewStats.computePeriodReview(App.records.getAll(), period, anniversary, todayStr());
    hideAll();
    if (data.isEmpty) { showPage(data); return; }
    // 「まだ少なめ」の遠慮は年だけ。期間を自分で選んだなら見たいということなので出す。
    if (period.kind === 'year' && data.isSparse) { showSparse(data); return; }
    showSlides(data);
  }

  // 期間選択のカレンダーは App.rangeCal（絞り込みと共通）。
  // 選んだ値は隠し入力に入れるので、検証と makeRangePeriod 側は今までどおり読める。
  function wireRangeCalendar(form, allRecords) {
    var fromEl = form.querySelector('.rv-f-from');
    var toEl = form.querySelector('.rv-f-to');
    App.rangeCal.mount(form.querySelector('.rv-cal-host'), {
      records: allRecords,
      onChange: function (from, to) {
        fromEl.value = from || '';
        toEl.value = to || '';
      },
    });
  }

  // 期間ピッカー
  function showPicker() {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var all = App.records.getAll();
    var years = App.reviewStats.yearsWithRecords(all);
    // 開始の早い順に保存されているので、逆にして「最近の旅行が上」にする。
    // clone を使うのは、並べ替えで App.trips.list そのものを壊さないため。
    var trips = (App.trips && App.trips.clone)
      ? App.trips.clone(App.trips.list).reverse() : [];
    var host = el('review-picker');
    if (!years.length) {
      host.innerHTML =
        '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
        '<div class="rv-picker"><div class="rv-picker-head">ふりかえり</div>' +
        '<p class="rv-empty">まだ記録がありません。おでかけを記録するとここに出ます。</p>' +
        '</div>';
      host.querySelector('.x-btn').onclick = hideAll;
      App.overlay.open(host);
      return;
    }
    var items = years.map(function (y) {
      return '<button class="rv-year" data-year="' + y + '">' + y + '年</button>';
    }).join('');
    host.innerHTML =
      '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-picker"><div class="rv-picker-head">どの期間をふりかえる？</div>' +
      '<div class="rv-years">' + items + '<button class="rv-year rv-all">これまで</button></div>' +
      (trips.length
        ? '<button class="rv-trip-open">旅行から選ぶ</button>' +
          '<div class="rv-trip-list" hidden><p class="rv-trip-msg" hidden></p></div>'
        : '') +
      '<button class="rv-range-open">期間を選ぶ</button>' +
      '<div class="rv-range-form" hidden>' +
      '<div class="rv-cal-host"></div>' +
      '<input type="hidden" class="rv-f-from"><input type="hidden" class="rv-f-to">' +
      '<label class="rv-f-l">見出しの文字（任意）' +
      '<input type="text" class="rv-f-label" maxlength="10" placeholder="沖縄旅行"></label>' +
      '<p class="rv-f-msg" hidden></p>' +
      '<button class="rv-btn rv-f-go">見る</button></div>' +
      '</div>';

    host.querySelectorAll('.rv-year[data-year]').forEach(function (b) {
      b.onclick = function () { open(App.reviewStats.makeYearPeriod(Number(b.getAttribute('data-year')))); };
    });
    host.querySelector('.rv-all').onclick = function () {
      open(App.reviewStats.makeAllPeriod(all, todayStr()));
    };

    var form = host.querySelector('.rv-range-form');
    var msg = host.querySelector('.rv-f-msg');
    wireRangeCalendar(form, all);
    host.querySelector('.rv-range-open').onclick = function () { form.hidden = !form.hidden; };
    host.querySelector('.rv-f-go').onclick = function () {
      function warn(t) { msg.textContent = t; msg.hidden = false; }
      var from = host.querySelector('.rv-f-from').value;
      var to = host.querySelector('.rv-f-to').value;
      if (!from || !to) { warn('期間を選んでね'); return; }
      if (from > to) { warn('開始日と終了日が逆だよ'); return; }
      var p = App.reviewStats.makeRangePeriod(from, to, host.querySelector('.rv-f-label').value);
      // 0件の期間を開くと空の総集編になってしまうので、ここで止めて理由を出す
      if (!countInRange(all, p.start, p.end)) { warn('この期間の記録はまだないみたい'); return; }
      msg.hidden = true;
      open(p);
    };
    if (trips.length) {
      var listHost = host.querySelector('.rv-trip-list');
      var tmsg = host.querySelector('.rv-trip-msg');
      var warnTrip = function (t) { tmsg.textContent = t; tmsg.hidden = false; };
      host.querySelector('.rv-trip-open').onclick = function () {
        listHost.hidden = !listHost.hidden;
        tmsg.hidden = true; // 前に出した「記録がない」を畳んだ先まで持ち越さない
      };
      trips.forEach(function (t) {
        var n = countInRange(all, t.start, t.end);
        var period = App.reviewStats.makeTripPeriod(t);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rv-trip';
        // 日付を出すのは、同じ名前の旅行（「京都」を2年続けて等）を見分けるため。
        // 旅行名はふたりが打った文字なので必ず esc する（日付は組み立てた文字なので不要）。
        b.innerHTML = '<span class="rv-trip-name">' + esc(t.label) + '</span>' +
          '<span class="rv-trip-sub">' + App.reviewStats.formatDateLine(period) +
          ' ・ ' + n + '件</span>';
        b.onclick = function () {
          // 0件の旅行を開くと空の総集編になるので、ここで止めて理由を出す
          if (!n) { warnTrip('「' + t.label + '」の記録はまだないみたい'); return; }
          tmsg.hidden = true;
          open(period);
        };
        listHost.appendChild(b);
      });
    }
    host.querySelector('.x-btn').onclick = hideAll;
    App.overlay.open(host);
  }

  // 件数が少ない年
  function showSparse(data) {
    document.body.classList.add('reviewing'); // 地図画面用ボタンを隠す
    var host = el('review-show');
    host.innerHTML = '<div class="rv-slide rv-sparse">' +
      '<button class="x-btn x-fixed" aria-label="閉じる"><i class="ph ph-x"></i></button>' +
      '<div class="rv-sparse-emoji">🌱</div>' +
      '<div class="rv-mid">まだ' + esc(data.period.label) + '年のあしあとは少なめ</div>' +
      '<div class="rv-cap">これからだね</div>' +
      '<button class="rv-btn rv-topage">記録を見る</button></div>';
    host.querySelector('.x-btn').onclick = hideAll;
    host.querySelector('.rv-topage').onclick = function () { hideAll(); showPage(data); };
    App.overlay.open(host);
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
    var data = App.reviewStats.computePeriodReview(
      App.records.getAll(), App.reviewStats.makeYearPeriod(targetYear), null, todayStr());
    if (data.count < 3) { host.hidden = true; return false; }
    host.innerHTML =
      '<div class="rv-card-inner">' +
      '<div class="rv-card-icon"><i class="ph ph-sparkle"></i></div>' +
      '<button class="rv-card-open"><div class="rv-card-label">ふりかえり</div>' +
      '<div class="rv-card-title">' + targetYear + '年のふりかえりができました</div>' +
      '<div class="rv-card-sub">タップで再生 ・ ' + data.outingDays + '日のおでかけ</div></button>' +
      '<button class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button></div>';
    host.querySelector('.rv-card-open').onclick = function () {
      host.hidden = true; open(App.reviewStats.makeYearPeriod(targetYear));
    };
    host.querySelector('.x-btn').onclick = function () {
      try { localStorage.setItem(key, '1'); } catch (e) {}
      host.hidden = true;
    };
    host.hidden = false;
    return true;
  }

  return { open: open, showPicker: showPicker, setAnniversary: setAnniversary,
    showSlides: showSlides, showPage: showPage,
    maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO,
    // 見た目の確認・検査用（review-preview.html から使う）。本編からは呼ばない。
    _slideHTML: slideHTML, _spinGaps: _spinGaps, _spinTo: spinTo, _spinPlan: spinPlan,
    _SPIN: { steps: SPIN_STEPS, first: SPIN_FIRST, last: SPIN_LAST } };
})();
