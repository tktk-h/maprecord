window.App = window.App || {};
App.calendar = (function () {
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  let onDayClick = null;
  let onTripClick = null;

  // 旅行名は自分たちで書いた文字（HTML に落とすので必ず逃がす）
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 'YYYY-MM-DD' → '8/10'
  function short(dateStr) {
    const p = String(dateStr || '').split('-');
    return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : '';
  }
  // その月にかかっている旅行（開始が前月でも、終わりが翌月でも拾う）
  function tripsInMonth(y, m) {
    const first = ymd(new Date(y, m, 1));
    const last = ymd(new Date(y, m + 1, 0));
    return ((App.trips && App.trips.list) || []).filter((t) => t.start <= last && t.end >= first);
  }
  // 旅行の日は帯を敷く。端だけ角を丸めて、始まりと終わりが分かるようにする。
  function tripClass(dateStr) {
    const t = App.trips && App.trips.tripOf(dateStr);
    if (!t) return '';
    return ' in-trip' + (dateStr === t.start ? ' trip-first' : '') + (dateStr === t.end ? ' trip-last' : '');
  }

  // Date → 'YYYY-MM-DD'（ローカル時刻ベース）
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 記録を日付(YYYY-MM-DD)ごとにまとめる
  function groupByDate(records) {
    const map = {};
    records.forEach((r) => {
      if (!r.date) return;
      (map[r.date] = map[r.date] || []).push(r);
    });
    return map;
  }

  // 表示する月の一覧（最古の記録の月〜今月）。記録がなければ今月のみ
  function monthsToShow(records) {
    const dates = records.map((r) => r.date).filter(Boolean).sort();
    const now = new Date();
    const start = dates.length ? new Date(dates[0] + 'T00:00:00') : now;
    let end = now;
    if (dates.length) {
      const last = new Date(dates[dates.length - 1] + 'T00:00:00');
      if (last > end) end = last;
    }
    const months = [];
    let y = start.getFullYear();
    let m = start.getMonth();
    const ey = end.getFullYear();
    const em = end.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      months.push({ y, m });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    return months;
  }

  // 1日ぶんのセル。空の日は静かに（薄い数字だけ）、記録の日は写真/ジャンル色で主役に
  function cellHtml(dateStr, dayNum, recs) {
    const tc = tripClass(dateStr);
    const band = tc ? '<span class="cal-band"></span>' : '';
    if (!recs || recs.length === 0) {
      return `<div class="cal-cell empty${tc}">${band}<span class="cal-num">${dayNum}</span></div>`;
    }
    const badge = recs.length > 1 ? `<span class="cal-badge">${recs.length}</span>` : '';
    const photo = recs.map((r) => (r.photos || [])[0]).find(Boolean);
    if (photo) {
      return `<button type="button" class="cal-cell has-photo${tc}" data-date="${dateStr}" `
        + `style="background-image:url(${photo.url})">`
        + `<span class="cal-scrim"></span>${band}<span class="cal-num on-photo">${dayNum}</span>${badge}</button>`;
    }
    // 写真なしの記録 → ジャンル色で塗る
    const color = App.genres.color(recs[0].genre);
    return `<button type="button" class="cal-cell has-rec${tc}" data-date="${dateStr}" `
      + `style="background:${color}">`
      + `<span class="cal-scrim"></span>${band}<span class="cal-num on-photo">${dayNum}</span>${badge}</button>`;
  }

  // 1か月ぶんのグリッド
  function monthHtml(y, m, grouped) {
    const startWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let cells = '';
    let count = 0; // その月の記録数（「N つの思い出」）
    for (let i = 0; i < startWeekday; i += 1) cells += '<div class="cal-cell blank"></div>';
    for (let d = 1; d <= daysInMonth; d += 1) {
      const dateStr = ymd(new Date(y, m, d));
      const recs = grouped[dateStr];
      if (recs) count += recs.length;
      cells += cellHtml(dateStr, d, recs);
    }
    const head = WEEKDAYS.map((w, i) =>
      `<div class="cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('');
    const countHtml = count ? `<span class="cal-count">${count}つの思い出</span>` : '';
    // その月にかかっている旅行。押すとその旅行だけに絞り込む。
    const trips = tripsInMonth(y, m);
    const chips = trips.length
      ? `<div class="cal-trips">${trips.map((t) => `<button type="button" class="cal-trip-chip" data-trip="${esc(t.id)}">`
        + `<i class="ph ph-suitcase-rolling"></i><span class="ctc-name">${esc(t.label)}</span>`
        + `<span class="ctc-range">${short(t.start)}〜${short(t.end)}</span></button>`).join('')}</div>`
      : '';
    return '<div class="cal-month">'
      + `<div class="cal-title"><span class="cal-mon">${m + 1}月</span><span class="cal-yr">${y}</span>${countHtml}</div>`
      + chips
      + `<div class="cal-grid">${head}${cells}</div>`
      + '</div>';
  }

  function render(records) {
    const host = document.getElementById('calendar-view');
    const grouped = groupByDate(records);
    const months = monthsToShow(records);
    host.innerHTML = months.map((mm) => monthHtml(mm.y, mm.m, grouped)).join('')
      || '<p class="hint">まだ記録がありません</p>';
    host.querySelectorAll('.cal-cell[data-date]').forEach((el) => {
      el.onclick = () => { if (onDayClick) onDayClick(el.dataset.date); };
    });
    host.querySelectorAll('.cal-trip-chip').forEach((el) => {
      el.onclick = () => { if (onTripClick) onTripClick(el.dataset.trip); };
    });
  }

  function setDayClickHandler(fn) { onDayClick = fn; }
  function setTripClickHandler(fn) { onTripClick = fn; }

  return { render, setDayClickHandler, setTripClickHandler };
})();
