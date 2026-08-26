window.App = window.App || {};
// 期間の選び方をアプリの中で1つに揃えるための共有カレンダー。
// 宿の予約サイトのように、1枚のカレンダーを2回タップして開始日と終了日を決める。
// ふりかえりの期間ピッカーと、地図の絞り込み（期間）が同じものを使う。
// 見た目は .rv-cal 系のCSSをそのまま共有する。
App.rangeCal = (function () {
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + two(m + 1) + '-' + two(d); }

  // host に描いて、選び終わるたび onChange(from, to) を呼ぶ。
  // opts: { getRecords()|records, from, to, onChange(from,to) }
  function mount(host, opts) {
    opts = opts || {};
    const sel = { from: opts.from || null, to: opts.to || null };
    let days = {};   // 記録のある日（下に点を打つ手がかり）
    let latest = ''; // いちばん新しい記録の日
    const view = { y: 0, m: 0 };
    let userMoved = false; // 本人が前/次の月へ動かしたか（勝手に戻さないため）

    host.innerHTML =
      '<div class="rv-cal">' +
      '<div class="rv-cal-head">' +
      '<button type="button" class="rv-cal-nav rv-cal-prev" aria-label="前の月"><i class="ph ph-caret-left"></i></button>' +
      '<span class="rv-cal-title"></span>' +
      '<button type="button" class="rv-cal-nav rv-cal-next" aria-label="次の月"><i class="ph ph-caret-right"></i></button>' +
      '</div>' +
      '<div class="rv-cal-dow">' + DOW.map((w) => '<span>' + w + '</span>').join('') + '</div>' +
      '<div class="rv-cal-grid"></div>' +
      '<div class="rv-cal-sel"></div></div>';

    const grid = host.querySelector('.rv-cal-grid');
    const title = host.querySelector('.rv-cal-title');
    const note = host.querySelector('.rv-cal-sel');

    function scanRecords() {
      days = {};
      latest = '';
      const recs = (typeof opts.getRecords === 'function' ? opts.getRecords() : opts.records) || [];
      recs.forEach((r) => {
        if (!r || !r.date) return;
        const s = String(r.date);
        days[s] = true;
        if (s > latest) latest = s;
      });
    }

    // 開いたときに出す月。選んだ日があればその月、無ければ最後に記録した月
    // （そこが今いちばん選びたい月のはずなので）。
    function resetView() {
      const base = sel.from || latest;
      const d = base
        ? new Date(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1, 1)
        : new Date();
      view.y = d.getFullYear();
      view.m = d.getMonth();
    }

    function render() {
      title.textContent = view.y + '年' + (view.m + 1) + '月';
      const lead = new Date(view.y, view.m, 1).getDay();      // 1日が何曜日か（日曜=0）
      const last = new Date(view.y, view.m + 1, 0).getDate(); // その月の日数
      let cells = '';
      for (let i = 0; i < lead; i += 1) cells += '<span class="rv-cal-pad"></span>';
      for (let d = 1; d <= last; d += 1) {
        const s = iso(view.y, view.m, d);
        let cls = 'rv-cal-d';
        if (s === sel.from) cls += ' is-from';
        if (s === sel.to) cls += ' is-to';
        if (sel.from && sel.to && s > sel.from && s < sel.to) cls += ' is-mid';
        if (days[s]) cls += ' has-rec';
        cells += '<button type="button" class="' + cls + '" data-d="' + s + '">' + d + '</button>';
      }
      grid.innerHTML = cells;
      grid.querySelectorAll('.rv-cal-d').forEach((b) => {
        b.onclick = () => pick(b.getAttribute('data-d'));
      });
      note.textContent = !sel.from ? '開始日を選んでね'
        : !sel.to ? '終了日を選んでね（同じ日をもう一度押すと1日だけ）'
          : sel.from.replace(/-/g, '/') + ' 〜 ' + sel.to.replace(/-/g, '/');
    }

    function pick(s) {
      if (!sel.from || sel.to) { sel.from = s; sel.to = null; } // 1回目、または選び直し
      else if (s < sel.from) { sel.from = s; }                  // 開始より前を押したら開始を移す
      else { sel.to = s; }
      render();
      if (opts.onChange) opts.onChange(sel.from, sel.to);
    }

    host.querySelector('.rv-cal-prev').onclick = () => {
      userMoved = true;
      view.m -= 1; if (view.m < 0) { view.m = 11; view.y -= 1; } render();
    };
    host.querySelector('.rv-cal-next').onclick = () => {
      userMoved = true;
      view.m += 1; if (view.m > 11) { view.m = 0; view.y += 1; } render();
    };

    scanRecords();
    resetView();
    render();

    return {
      // 外から選択を入れ直す（絞り込みのリセットや、ふりかえりからの着地で使う）。
      // 同じ値なら何もしない ＝ onChange 経由で呼び返されても月表示が飛ばない。
      setValue(from, to) {
        const f = from || null;
        const t = to || null;
        if (f === sel.from && t === sel.to) return;
        sel.from = f; sel.to = t;
        userMoved = false;
        scanRecords();
        resetView();
        render();
      },
      getValue() { return { from: sel.from, to: sel.to }; },
      // 記録が届いた／変わったときに点と初期表示月を更新する
      refresh() {
        scanRecords();
        if (!sel.from && !userMoved) resetView(); // 見ている月を勝手に変えない
        render();
      },
    };
  }

  return { mount };
})();
