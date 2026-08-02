window.App = window.App || {};
App.filters = (function () {
  // 記録が日付条件にマッチするか
  function matchDate(record, state) {
    if (state.mode === 'all') return true;
    if (state.mode === 'day') return record.date === state.day;
    if (state.mode === 'range') {
      if (state.from && record.date < state.from) return false;
      if (state.to && record.date > state.to) return false;
      return true;
    }
    return true;
  }

  // 記録がジャンル条件にマッチするか（空集合＝全ジャンル表示）
  function matchGenre(record, state) {
    if (!state.genres || state.genres.size === 0) return true;
    return state.genres.has(record.genre);
  }

  // 表示すべき記録だけ返す
  function apply(records, state) {
    return records.filter((r) => matchDate(r, state) && matchGenre(r, state));
  }

  return { apply, matchDate, matchGenre };
})();

App.filters._selfTest = function () {
  const recs = [
    { id: 1, date: '2026-07-01', genre: 'food' },
    { id: 2, date: '2026-07-15', genre: 'cafe' },
    { id: 3, date: '2026-08-01', genre: 'food' },
  ];
  const S = (o) => Object.assign({ mode: 'all', day: null, from: null, to: null, genres: new Set() }, o);
  const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);

  eq('all',        App.filters.apply(recs, S({})).length, 3);
  eq('day',        App.filters.apply(recs, S({ mode: 'day', day: '2026-07-15' })).length, 1);
  eq('range',      App.filters.apply(recs, S({ mode: 'range', from: '2026-07-01', to: '2026-07-31' })).length, 2);
  eq('range-open', App.filters.apply(recs, S({ mode: 'range', from: '2026-08-01', to: null })).length, 1);
  eq('genre',      App.filters.apply(recs, S({ genres: new Set(['food']) })).length, 2);
  eq('day+genre',  App.filters.apply(recs, S({ mode: 'day', day: '2026-08-01', genres: new Set(['food']) })).length, 1);
  eq('genre-empty',App.filters.apply(recs, S({ genres: new Set() })).length, 3);
};
