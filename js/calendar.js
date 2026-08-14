window.App = window.App || {};
App.calendar = (function () {
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  let onDayClick = null;

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
    if (!recs || recs.length === 0) {
      return `<div class="cal-cell empty"><span class="cal-num">${dayNum}</span></div>`;
    }
    const badge = recs.length > 1 ? `<span class="cal-badge">${recs.length}</span>` : '';
    const photo = recs.map((r) => (r.photos || [])[0]).find(Boolean);
    if (photo) {
      return `<button type="button" class="cal-cell has-photo" data-date="${dateStr}" `
        + `style="background-image:url(${photo.url})">`
        + `<span class="cal-scrim"></span><span class="cal-num on-photo">${dayNum}</span>${badge}</button>`;
    }
    // 写真なしの記録 → ジャンル色で塗る
    const color = App.genres.color(recs[0].genre);
    return `<button type="button" class="cal-cell has-rec" data-date="${dateStr}" `
      + `style="background:${color}">`
      + `<span class="cal-scrim"></span><span class="cal-num on-photo">${dayNum}</span>${badge}</button>`;
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
    return '<div class="cal-month">'
      + `<div class="cal-title"><span class="cal-mon">${m + 1}月</span><span class="cal-yr">${y}</span>${countHtml}</div>`
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
  }

  function setDayClickHandler(fn) { onDayClick = fn; }

  return { render, setDayClickHandler };
})();
