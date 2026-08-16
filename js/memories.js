window.App = window.App || {};
App.memories = (function () {
  // records=記録配列, today='YYYY-MM-DD', anniversary='YYYY-MM-DD'|null
  // → 記念日一致: { type:'anniversary', years, date }
  //   過去同月同日: { type:'onThisDay', items:[{date,record,yearsAgo}], count }（新しい順）
  //   どちらも無し: null
  function pickMemories(records, today, anniversary) {
    const md = today.slice(5);              // 'MM-DD'
    const ty = Number(today.slice(0, 4));   // 今年
    if (anniversary && anniversary.slice(5) === md) {
      const years = ty - Number(anniversary.slice(0, 4));
      if (years >= 1) return { type: 'anniversary', years, date: anniversary };
    }
    const items = (records || [])
      .filter((r) => r.date && r.date.slice(5) === md && Number(r.date.slice(0, 4)) < ty)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 新しい順
      .map((r) => ({ date: r.date, record: r, yearsAgo: ty - Number(r.date.slice(0, 4)) }));
    if (items.length) return { type: 'onThisDay', items, count: items.length };
    return null;
  }

  function _selfTest() {
    const eq = (n, got, want) =>
      console.log((got === want ? 'PASS' : 'FAIL') + ' ' + n, got);
    const recs = [
      { id: 1, name: 'A', date: '2025-08-12' },
      { id: 2, name: 'B', date: '2024-08-12' },
      { id: 3, name: 'C', date: '2025-08-11' },
      { id: 4, name: 'D', date: '2027-08-12' }, // 未来は無視
    ];
    const anniv = pickMemories([], '2026-08-12', '2024-08-12');
    eq('anniv-type', anniv && anniv.type, 'anniversary');
    eq('anniv-years', anniv && anniv.years, 2);

    const otd = pickMemories(recs, '2026-08-12', null);
    eq('otd-type', otd && otd.type, 'onThisDay');
    eq('otd-count', otd && otd.count, 2);                 // id1,id2 のみ
    eq('otd-newest-first', otd && otd.items[0].record.id, 1);
    eq('otd-yearsAgo', otd && otd.items[0].yearsAgo, 1);

    eq('none', pickMemories([{ id: 9, date: '2025-08-11' }], '2026-08-12', null), null);
    // 記念日が同年（years=0）は祝わない → onThisDay/null にフォールバック
    eq('anniv-year0', pickMemories([], '2026-08-12', '2026-08-12'), null);
  }

  let anniv = null;
  function setAnniversary(date) { anniv = date || null; }

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function dismissedKey(d) { return 'memoryDismissed:' + d; }
  function escName(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dismiss(host, today) {
    try { localStorage.setItem(dismissedKey(today), '1'); } catch (_) { /* noop */ }
    host.hidden = true;
  }

  function render(host, mem, today) {
    if (mem.type === 'anniversary') {
      host.innerHTML = `
        <div class="mem-inner">
          <div class="mem-icon mem-icon-accent"><i class="ph ph-confetti"></i></div>
          <div class="mem-text">
            <div class="mem-label"><i class="ph ph-heart"></i>記念日</div>
            <div class="mem-title">今日で${mem.years}年！</div>
          </div>
          <button type="button" class="mem-x" aria-label="閉じる"><i class="ph ph-x"></i></button>
        </div>`;
      host.hidden = false;
      host.querySelector('.mem-x').onclick = () => dismiss(host, today);
      return;
    }
    const it = mem.items[0]; // 一番新しい過去の年
    const r = it.record;
    const photo = (r.photos || [])[0];
    const thumb = photo
      ? `<div class="mem-icon" style="background-image:url(${App.photos.thumbOf(photo)})"></div>`
      : `<div class="mem-icon mem-icon-accent"><i class="ph ph-map-pin"></i></div>`;
    const more = mem.count > 1 ? ` ・ ほか${mem.count - 1}件` : '';
    host.innerHTML = `
      <div class="mem-inner">
        ${thumb}
        <button type="button" class="mem-text mem-open">
          <div class="mem-label"><i class="ph ph-clock-counter-clockwise"></i>${it.yearsAgo}年前の今日</div>
          <div class="mem-title">${escName(r.name) || '(名称未設定)'}</div>
          <div class="mem-sub">${r.date.replace(/-/g, '.')}${more}</div>
        </button>
        <button type="button" class="mem-x" aria-label="閉じる"><i class="ph ph-x"></i></button>
      </div>`;
    host.hidden = false;
    host.querySelector('.mem-open').onclick = () => App.records.focusDay(it.date);
    host.querySelector('.mem-x').onclick = () => dismiss(host, today);
  }

  function show() {
    const host = document.getElementById('memory-card');
    if (!host) return;
    const today = todayStr();
    if (localStorage.getItem(dismissedKey(today))) { host.hidden = true; return; }
    const mem = pickMemories(App.records.getAll(), today, anniv);
    if (!mem) { host.hidden = true; return; }
    render(host, mem, today);
  }

  return { pickMemories, setAnniversary, show, _selfTest };
})();
