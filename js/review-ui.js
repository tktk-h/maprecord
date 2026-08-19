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

  // 後続タスクで実装する公開API（今は未実装のスタブ）
  function open(year) { console.warn('review.open not implemented yet', year); }
  function showPicker() { console.warn('review.showPicker not implemented yet'); }
  function maybeShowYearEndCard() { return false; }

  return { open: open, showPicker: showPicker, maybeShowYearEndCard: maybeShowYearEndCard,
    _pinSchedule: _pinSchedule, _selfTestSchedule: _selfTestSchedule, _TEMPO: TEMPO };
})();
