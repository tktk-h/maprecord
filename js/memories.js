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

  return { pickMemories, _selfTest };
})();
