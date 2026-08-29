window.App = window.App || {};
// 旅行（日をまたぐまとまり）。記録の側には何も持たせず、
// 「その記録の日付が旅行の期間に入っていれば、その旅行の記録」とだけ決める。
// こうすると、旅行中に足した記録も、帰ってから足した記録も、日付さえ合えば勝手に入る。
// ここは判定だけの純粋ロジック（DOM も Firestore も触らない＝テストできる）。
App.trips = (function () {
  var DAY = 86400000;
  var DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  var MAX_DAYS = 366; // 打ち間違い（2026→2036 など）で日付を延々と数えないための歯止め

  var list = []; // [{ id, label, start, end }] 開始の早い順

  function clone(arr) {
    return (arr || []).map(function (t) {
      return { id: t.id, label: t.label, start: t.start, end: t.end };
    });
  }

  // 'YYYY-MM-DD' は桁が揃っているので、比較は辞書順でよい（Date を作る必要がない）
  function inTrip(dateStr, trip) {
    if (!dateStr || !trip) return false;
    return dateStr >= trip.start && dateStr <= trip.end;
  }

  // その日が属する旅行。無ければ null。重なりは validate で禁じているので最初の1件でよい。
  function tripOf(dateStr, trips) {
    var arr = trips || list;
    for (var i = 0; i < arr.length; i += 1) if (inTrip(dateStr, arr[i])) return arr[i];
    return null;
  }

  function byId(id, trips) {
    var arr = trips || list;
    for (var i = 0; i < arr.length; i += 1) if (arr[i].id === id) return arr[i];
    return null;
  }

  // 日付の計算は UTC で行う。夏時間や端末の時差でずれないようにするため。
  function toUTC(dateStr) {
    var p = String(dateStr).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }

  // 旅行の何日目か（1始まり）。期間外は 0。
  function dayIndex(trip, dateStr) {
    if (!inTrip(dateStr, trip)) return 0;
    return Math.round((toUTC(dateStr) - toUTC(trip.start)) / DAY) + 1;
  }

  function dayCount(trip) {
    if (!trip) return 0;
    return Math.round((toUTC(trip.end) - toUTC(trip.start)) / DAY) + 1;
  }

  // 期間中の日付を順に。帯を描くときに使う。
  function daysOf(trip) {
    var out = [];
    if (!trip) return out;
    var end = toUTC(trip.end);
    for (var t = toUTC(trip.start); t <= end && out.length < MAX_DAYS; t += DAY) out.push(fromUTC(t));
    return out;
  }

  // 「3泊4日」の言い方。日帰りだけ別扱い。
  function lengthLabel(trip) {
    var n = dayCount(trip);
    if (n <= 1) return '日帰り';
    return (n - 1) + '泊' + n + '日';
  }

  function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }

  // 保存してよい形か。重なりを禁じるのは、ある日が2つの旅行に属すると
  // 帯も「何日目」も意味が壊れるため。
  function validate(rows) {
    var arr = rows || [];
    for (var i = 0; i < arr.length; i += 1) {
      var r = arr[i];
      if (!r.label || !String(r.label).trim()) return { ok: false, error: '名前が空の旅行があります' };
      if (!DATE.test(r.start) || !DATE.test(r.end)) return { ok: false, error: '期間が選ばれていない旅行があります' };
      if (r.start > r.end) return { ok: false, error: '「' + r.label + '」の期間が逆さまです' };
      if (dayCount(r) > MAX_DAYS) return { ok: false, error: '「' + r.label + '」の期間が長すぎます' };
      for (var j = i + 1; j < arr.length; j += 1) {
        if (overlaps(r, arr[j])) {
          return { ok: false, error: '「' + r.label + '」と「' + arr[j].label + '」の期間が重なっています' };
        }
      }
    }
    return { ok: true, error: '' };
  }

  function newId(existing) {
    var used = {};
    (existing || []).forEach(function (t) { used[t.id] = true; });
    for (var i = 1; i < 10000; i += 1) {
      var id = 'trip' + i;
      if (!used[id]) return id;
    }
    return 'trip' + Date.now();
  }

  // 保存する形に整える（前後の空白を落とし、開始の早い順に並べる）
  function normalize(rows) {
    return (rows || [])
      .map(function (t) {
        return { id: t.id, label: String(t.label).trim(), start: t.start, end: t.end };
      })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  }

  function setList(arr) {
    list.length = 0;
    normalize(arr).forEach(function (t) { list.push(t); });
  }

  function _selfTest() {
    var fails = 0;
    function eq(n, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails += 1;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    }
    var okinawa = { id: 't1', label: '沖縄旅行', start: '2026-08-10', end: '2026-08-13' };
    var kyoto = { id: 't2', label: '京都', start: '2026-09-01', end: '2026-09-01' };

    eq('in-first', inTrip('2026-08-10', okinawa), true);
    eq('in-last', inTrip('2026-08-13', okinawa), true);
    eq('out-before', inTrip('2026-08-09', okinawa), false);
    eq('out-after', inTrip('2026-08-14', okinawa), false);

    eq('trip-of', tripOf('2026-08-12', [okinawa, kyoto]).id, 't1');
    eq('trip-of-none', tripOf('2026-08-20', [okinawa, kyoto]), null);

    eq('day-index-1', dayIndex(okinawa, '2026-08-10'), 1);
    eq('day-index-4', dayIndex(okinawa, '2026-08-13'), 4);
    eq('day-index-out', dayIndex(okinawa, '2026-08-14'), 0);
    eq('day-count', dayCount(okinawa), 4);
    eq('days-of', daysOf(okinawa), ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']);
    eq('length-label', lengthLabel(okinawa), '3泊4日');
    eq('length-label-day', lengthLabel(kyoto), '日帰り');
    // 月をまたぐ・うるう年をまたぐ計算
    eq('across-month', dayCount({ start: '2026-07-30', end: '2026-08-02' }), 4);
    eq('leap', dayCount({ start: '2028-02-27', end: '2028-03-01' }), 4);

    eq('valid', validate([okinawa, kyoto]).ok, true);
    eq('invalid-empty-label', validate([{ label: ' ', start: '2026-01-01', end: '2026-01-02' }]).ok, false);
    eq('invalid-no-date', validate([{ label: 'x', start: '', end: '' }]).ok, false);
    eq('invalid-reversed', validate([{ label: 'x', start: '2026-01-05', end: '2026-01-01' }]).ok, false);
    eq('invalid-overlap', validate([okinawa, { label: 'y', start: '2026-08-13', end: '2026-08-15' }]).ok, false);
    eq('valid-touching', validate([okinawa, { label: 'y', start: '2026-08-14', end: '2026-08-15' }]).ok, true);

    eq('new-id', newId([{ id: 'trip1' }, { id: 'trip3' }]), 'trip2');
    eq('normalize-order', normalize([kyoto, okinawa]).map(function (t) { return t.id; }), ['t1', 't2']);
    eq('normalize-trim', normalize([{ id: 'a', label: '  沖縄  ', start: '2026-01-01', end: '2026-01-02' }])[0].label, '沖縄');

    console.log(fails === 0 ? '✅ trips ALL PASS' : ('❌ trips ' + fails + ' FAIL'));
    return fails;
  }

  return {
    list: list,
    inTrip: inTrip, tripOf: tripOf, byId: byId,
    dayIndex: dayIndex, dayCount: dayCount, daysOf: daysOf, lengthLabel: lengthLabel,
    overlaps: overlaps, validate: validate, newId: newId, normalize: normalize,
    setList: setList, clone: clone, _selfTest: _selfTest,
  };
})();
