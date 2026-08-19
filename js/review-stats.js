window.App = window.App || {};
App.reviewStats = (function () {
  // 場所の識別キー：placeId 優先、無ければ丸めた緯度経度（records.js の coordKey と同じ桁）
  function placeKey(r) {
    if (r.placeId) return 'id:' + r.placeId;
    return 'xy:' + Number(r.lat).toFixed(6) + ',' + Number(r.lng).toFixed(6);
  }
  function yearOf(d) { return Number(String(d).slice(0, 4)); }
  function monthOf(d) { return Number(String(d).slice(5, 7)); }

  // 記念日 a から基準日 b までの日数（両端含む＝記念日当日を1日目）。不正なら null。
  function daysBetweenInclusive(a, b) {
    const da = Date.parse(a + 'T00:00:00Z');
    const db = Date.parse(b + 'T00:00:00Z');
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000) + 1;
  }

  // allRecords=全期間の全記録, year=対象年(number), anniversary='YYYY-MM-DD'|null, today='YYYY-MM-DD'
  function computeYearReview(allRecords, year, anniversary, today) {
    const recs = (allRecords || []).filter((r) => r && r.date);
    const yearRecs = recs.filter((r) => yearOf(r.date) === year)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const count = yearRecs.length;

    // 付き合って◯日：基準日は今年なら today、過去年なら 12/31
    let daysTogether = null;
    if (anniversary && year <= yearOf(today)) {
      const asOf = (year === yearOf(today)) ? today : (year + '-12-31');
      const d = daysBetweenInclusive(anniversary, asOf);
      daysTogether = (d != null && d >= 1) ? d : null;
    }

    // 各場所の「最初に訪れた年」を全期間から求める → その年が対象年なら新規
    const firstYearOf = {};
    for (const r of recs) {
      const k = placeKey(r); const yr = yearOf(r.date);
      if (firstYearOf[k] == null || yr < firstYearOf[k]) firstYearOf[k] = yr;
    }
    let newPlaces = 0;
    const seen = new Set();
    for (const r of yearRecs) {
      const k = placeKey(r);
      if (seen.has(k)) continue; seen.add(k);
      if (firstYearOf[k] === year) newPlaces++;
    }

    // 対象年を場所ごとに集計（代表名＝最新の記録の名前）
    const byKey = {};
    for (const r of yearRecs) {
      const k = placeKey(r);
      if (!byKey[k]) byKey[k] = { key: k, count: 0, name: r.name || '', lastDate: r.date };
      byKey[k].count++;
      if (r.date >= byKey[k].lastDate) { byKey[k].lastDate = r.date; byKey[k].name = r.name || byKey[k].name; }
    }
    const spots = Object.keys(byKey).map((k) => byKey[k])
      .sort((a, b) => b.count - a.count || (a.lastDate === b.lastDate ? 0 : (a.lastDate < b.lastDate ? 1 : -1)));
    const topSpot = (spots[0] && spots[0].count >= 2)
      ? { name: spots[0].name, count: spots[0].count, key: spots[0].key } : null;
    const best3 = spots.slice(0, 3).map((s) => ({ name: s.name, count: s.count, key: s.key }));

    // ジャンル
    const gCount = {};
    for (const r of yearRecs) { const g = r.genre || 'other'; gCount[g] = (gCount[g] || 0) + 1; }
    const genreBreakdown = Object.keys(gCount).map((k) => ({ key: k, count: gCount[k] }))
      .sort((a, b) => b.count - a.count);
    const topGenre = genreBreakdown[0] ? { key: genreBreakdown[0].key, count: genreBreakdown[0].count } : null;

    // 月別
    const monthlyCounts = new Array(12).fill(0);
    for (const r of yearRecs) { const mm = monthOf(r.date); if (mm >= 1 && mm <= 12) monthlyCounts[mm - 1]++; }
    let bmIdx = -1, bmMax = 0;
    for (let i = 0; i < 12; i++) { if (monthlyCounts[i] > bmMax) { bmMax = monthlyCounts[i]; bmIdx = i; } }
    const busiestMonth = (bmMax >= 2) ? { month: bmIdx + 1, count: bmMax } : null;

    // 写真枚数
    let photoCount = 0;
    for (const r of yearRecs) photoCount += (r.photos ? r.photos.length : 0);

    // ピン（時系列順・1記録1本）
    const pins = yearRecs
      .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => ({ lat: r.lat, lng: r.lng, genre: r.genre || 'other', name: r.name || '', date: r.date }));

    return {
      year, count,
      isEmpty: count === 0,
      isSparse: count > 0 && count < 3,
      daysTogether, newPlaces, topSpot, best3,
      topGenre, genreBreakdown, busiestMonth, monthlyCounts,
      photoCount, pins,
      firstOuting: yearRecs[0] || null,
      lastOuting: count ? yearRecs[count - 1] : null,
    };
  }

  // 記録のある年を新しい順で（年ピッカー用）
  function yearsWithRecords(allRecords) {
    const set = new Set();
    for (const r of (allRecords || [])) { if (r && r.date) set.add(yearOf(r.date)); }
    return Array.from(set).sort((a, b) => b - a);
  }

  // どのスライドを出すか（順序つき）。sparse/empty は open() 側で別扱いなので、ここは通常年向け。
  function planSlides(data) {
    const ids = [];
    if (data.isEmpty) return ids;
    if (data.daysTogether != null) ids.push('days');
    ids.push('places'); // 主役（count>=1）
    if (data.newPlaces >= 1) ids.push('new');
    if (data.topSpot) ids.push('topspot');
    if (data.count >= 2 && data.topGenre) ids.push('genre');
    if (data.busiestMonth) ids.push('month');
    ids.push('closing');
    return ids;
  }

  function _selfTest() {
    let fails = 0;
    const eq = (name, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + name, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    const recs = [
      { name: 'A珈琲', date: '2026-03-01', lat: 35.0, lng: 139.0, genre: 'cafe', placeId: 'A', photos: [1, 2] },
      { name: 'A珈琲', date: '2026-05-02', lat: 35.0, lng: 139.0, genre: 'cafe', placeId: 'A', photos: [3] },
      { name: 'B食堂', date: '2026-05-10', lat: 35.1, lng: 139.1, genre: 'food', placeId: 'B' },
      { name: 'C公園', date: '2025-08-01', lat: 35.2, lng: 139.2, genre: 'sightsee', placeId: 'C' }, // 前年に初訪問
      { name: 'C公園', date: '2026-05-20', lat: 35.2, lng: 139.2, genre: 'sightsee', placeId: 'C' }, // 2026は再訪＝新規でない
      { name: '未来', date: '2027-01-01', lat: 35.3, lng: 139.3, genre: 'food' },
    ];
    const d = computeYearReview(recs, 2026, '2024-05-10', '2026-08-19');
    eq('count', d.count, 4);                       // 2026 の記録は4件
    eq('newPlaces', d.newPlaces, 2);               // A,B が新規（C は前年初訪問なので除外）
    eq('topSpot.count', d.topSpot && d.topSpot.count, 2);   // A珈琲 2回
    eq('topSpot.name', d.topSpot && d.topSpot.name, 'A珈琲');
    eq('topGenre.key', d.topGenre && d.topGenre.key, 'cafe'); // cafe=2 が最多
    eq('busiestMonth', d.busiestMonth, { month: 5, count: 3 }); // 5月に3件
    eq('photoCount', d.photoCount, 3);             // A珈琲の 2+1
    eq('pins.length', d.pins.length, 4);
    eq('firstOuting.date', d.firstOuting && d.firstOuting.date, '2026-03-01');
    eq('lastOuting.date', d.lastOuting && d.lastOuting.date, '2026-05-20');
    eq('isSparse-false', d.isSparse, false);

    // daysTogether：2024-05-10 → 2026-08-19（両端含む）
    eq('daysTogether', d.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));
    eq('daysBetween-sameday', daysBetweenInclusive('2026-01-01', '2026-01-01'), 1);
    eq('daysBetween-oneday', daysBetweenInclusive('2026-01-01', '2026-01-02'), 2);

    // 過去年は基準日が 12/31
    const d25 = computeYearReview(recs, 2025, '2024-05-10', '2026-08-19');
    eq('past-year-count', d25.count, 1);
    eq('past-year-days', d25.daysTogether, daysBetweenInclusive('2024-05-10', '2025-12-31'));

    // anniversary 無し → null
    const dna = computeYearReview(recs, 2026, null, '2026-08-19');
    eq('noAnniv-days', dna.daysTogether, null);

    // 未来年は daysTogether を出さない（付き合って日数は無意味）
    eq('future-year-days', computeYearReview(recs, 2027, '2024-05-10', '2026-08-19').daysTogether, null);

    // sparse / empty
    eq('sparse', computeYearReview([recs[0]], 2026, null, '2026-08-19').isSparse, true);
    eq('empty', computeYearReview([], 2020, null, '2026-08-19').isEmpty, true);

    // yearsWithRecords
    eq('years', yearsWithRecords(recs), [2027, 2026, 2025]);

    // planSlides：全部そろう年
    eq('planSlides-full', planSlides(d), ['days', 'places', 'new', 'topspot', 'genre', 'month', 'closing']);
    // 記念日なし・再訪なし・単月の年 → days/topspot/month が落ちる
    eq('planSlides-min', planSlides(computeYearReview([recs[2]], 2026, null, '2026-08-19')),
      ['places', 'new', 'closing']); // count=1, B食堂は2026が初訪問なので newPlaces=1 → 'new' が入る

    console.log(fails === 0 ? '✅ review-stats ALL PASS' : ('❌ review-stats ' + fails + ' FAIL'));
    return fails;
  }

  return { computeYearReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive, _selfTest };
})();
