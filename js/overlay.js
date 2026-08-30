window.App = window.App || {};
// 全画面の画面を出し入れするときの共通の作法。
//
// display:none は途中の状態を持てないので、hidden を先に付けるとアニメーションが走らない。
// 出すときは hidden を外してからクラスを付け、しまうときはクラスを外して動き終わってから hidden を付ける。
// この順番を各所で書き写すと必ずどれかズレるので、ここ1箇所にまとめている。
App.overlay = (function () {
  var pending = {}; // 「しまう」予約。要素に付けた印で引く
  var seq = 0;

  function key(el) {
    if (!el.dataset.ovKey) { seq += 1; el.dataset.ovKey = 'ov' + seq; }
    return el.dataset.ovKey;
  }

  // しまう予約を取り消す。出ていく途中で開き直したとき、前の予約が後から発火して
  // 開いたばかりの画面を消してしまうのを防ぐ。
  function cancel(el) {
    var k = key(el);
    if (pending[k]) { clearTimeout(pending[k]); delete pending[k]; }
  }

  // 動きにかかる時間(ms)。CSS に書いた値をそのまま読む。
  // 動くのが中のカードのこともあるので、あればそちらを見る。
  // 「動きを減らす」設定や、そもそも動かない画面幅では 0 が返る＝待たずに閉じてよい。
  function durationMs(el) {
    var target = el.querySelector('.ov-card') || el;
    var css = window.getComputedStyle(target);
    var d = parseFloat(css.transitionDuration) || 0;
    var delay = parseFloat(css.transitionDelay) || 0;
    return Math.round((d + Math.max(0, delay)) * 1000);
  }

  function open(el) {
    if (!el) return;
    cancel(el);
    el.hidden = false;
    // 動いている間はスクロールを止める。カードを画面の外まで下げているので、
    // そのぶんスクロール領域が伸びて、開いた瞬間に中身が跳ねる（実測で 809→1522 に増えた）。
    el.classList.add('ov-anim');
    // ⚠️ページが見えていないと requestAnimationFrame は永久に来ない。
    // そのまま待つと ov-open が付かず、透明な幕が画面を覆ったまま操作できなくなる。
    // 見えていないなら動かす意味もないので、その場で開いた状態にする。
    if (document.hidden) {
      el.classList.add('ov-open');
      el.classList.remove('ov-anim');
      return;
    }
    // 同じフレームでクラスを付けると「最初からそこにあった」と見なされ、動かずに現れる
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('ov-open');
        var ms = durationMs(el);
        pending[key(el)] = setTimeout(function () {
          cancel(el);
          el.classList.remove('ov-anim');
        }, ms + 20);
      });
    });
  }

  // done は閉じ終わってから呼ばれる。中身を捨てる処理はここに渡すこと
  // （先に捨てると、スライドしている最中の画面が空っぽになる）。
  function close(el, done) {
    if (!el) { if (done) done(); return; }
    cancel(el);
    if (el.hidden) { el.classList.remove('ov-open', 'ov-anim'); if (done) done(); return; }
    el.classList.remove('ov-open');
    el.classList.add('ov-anim'); // 降りていく間もスクロールを止める（open 側と同じ理由）
    var finish = function () {
      cancel(el);
      el.classList.remove('ov-anim');
      el.hidden = true;
      if (done) done();
    };
    var ms = durationMs(el);
    if (!ms) { finish(); return; } // 動かないなら待つ意味がない
    pending[key(el)] = setTimeout(finish, ms + 20); // 20ms は取りこぼし防止の余白
  }

  function isOpen(el) { return !!el && !el.hidden; }

  function _selfTest() {
    var fails = 0;
    function eq(name, got, want) {
      var ok = String(got) === String(want);
      if (!ok) fails += 1;
      console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got=' + got + ' want=' + want));
    }
    // 待ち時間の決め方だけを、CSS の読み取りを差し替えて確かめる
    var realGCS = window.getComputedStyle;
    function withDuration(dur, delay, hasCard) {
      window.getComputedStyle = function () { return { transitionDuration: dur, transitionDelay: delay }; };
      var fake = { querySelector: function () { return hasCard ? {} : null; } };
      var ms = durationMs(fake);
      window.getComputedStyle = realGCS;
      return ms;
    }
    eq('0.32秒なら320ms待つ', withDuration('0.32s', '0s', false), 320);
    eq('動きを減らす設定なら待たない', withDuration('0s', '0s', false), 0);
    eq('遅延も足す', withDuration('0.32s', '0.1s', false), 420);
    eq('カードがある画面でも読める', withDuration('0.32s', '0s', true), 320);
    eq('複数指定は最初の値を見る', withDuration('0.32s, 0.32s', '0s, 0s', false), 320);
    eq('読めない値は0として扱う', withDuration('', '', false), 0);
    console.log(fails === 0 ? '✅ overlay ALL PASS' : '❌ overlay ' + fails + ' FAILED');
    return fails;
  }

  return { open: open, close: close, isOpen: isOpen, _durationMs: durationMs, _selfTest: _selfTest };
})();
