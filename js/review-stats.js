window.App = window.App || {};
App.reviewStats = (function () {
  // 場所の識別キー：placeId 優先、無ければ丸めた緯度経度（records.js の coordKey と同じ桁）
  function placeKey(r) {
    if (r.placeId) return 'id:' + r.placeId;
    return 'xy:' + Number(r.lat).toFixed(6) + ',' + Number(r.lng).toFixed(6);
  }
  function yearOf(d) { return Number(String(d).slice(0, 4)); }
  function monthOf(d) { return Number(String(d).slice(5, 7)); }
  function dayOf(d) { return Number(String(d).slice(8, 10)); }

  // 期間ラベルの自動生成。同じ年なら 3/1〜3/5、年をまたぐなら 2025/12/30〜2026/1/3。
  function formatRangeLabel(start, end) {
    var sy = yearOf(start), ey = yearOf(end);
    var s = monthOf(start) + '/' + dayOf(start);
    var e = monthOf(end) + '/' + dayOf(end);
    if (sy === ey) return s + '〜' + e;
    return sy + '/' + s + '〜' + ey + '/' + e;
  }

  // ポスターと総集編に添える控えめな日付行。同じ年なら右側の年を省く。
  // 年のふりかえりは見出しの年号がすでに日付を語っているので出さない。
  function formatDateLine(period) {
    if (!period || period.kind === 'year') return '';
    var sy = yearOf(period.start), ey = yearOf(period.end);
    var left = sy + '.' + monthOf(period.start) + '.' + dayOf(period.start);
    var right = (sy === ey ? '' : ey + '.') + monthOf(period.end) + '.' + dayOf(period.end);
    return left + ' 〜 ' + right;
  }

  function makeYearPeriod(y) {
    return { kind: 'year', start: y + '-01-01', end: y + '-12-31', label: String(y) };
  }

  // 全期間。終了日を today で止めず最新の記録日まで伸ばすのは、
  // 先の日付で入れた記録が「これまで」から黙って消えないようにするため。
  function makeAllPeriod(allRecords, today) {
    var dates = (allRecords || []).filter(function (r) { return r && r.date; })
      .map(function (r) { return String(r.date); }).sort();
    var first = dates.length ? dates[0] : today;
    var last = dates.length ? dates[dates.length - 1] : today;
    return { kind: 'all', start: first, end: (last > today ? last : today), label: 'これまで' };
  }

  // ラベルは任意。空や空白だけなら日付から自動生成する。
  function makeRangePeriod(start, end, label) {
    var t = (label == null ? '' : String(label)).trim();
    return { kind: 'range', start: start, end: end, label: t || formatRangeLabel(start, end) };
  }

  // 記念日 a から基準日 b までの日数（両端含む＝記念日当日を1日目）。不正なら null。
  function daysBetweenInclusive(a, b) {
    const da = Date.parse(a + 'T00:00:00Z');
    const db = Date.parse(b + 'T00:00:00Z');
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000) + 1;
  }

  // 期間の刻みを決めてバケットの並びを作る。
  // 366日以内は月刻み（またぐ月だけ並べる）、超えたら年刻み。
  // count は「おでかけ日数」＝同じ日に何か所まわっても1日。
  function bucketize(period, recs) {
    var span = daysBetweenInclusive(period.start, period.end);
    var unit = (span != null && span <= 366) ? 'month' : 'year';
    var items = [];
    if (unit === 'month') {
      var y = yearOf(period.start), m = monthOf(period.start);
      var ey = yearOf(period.end), em = monthOf(period.end);
      while (y < ey || (y === ey && m <= em)) {
        items.push({ key: y + '-' + (m < 10 ? '0' + m : String(m)), label: m + '月', count: 0 });
        m++; if (m > 12) { m = 1; y++; }
      }
    } else {
      for (var yy = yearOf(period.start); yy <= yearOf(period.end); yy++) {
        items.push({ key: String(yy), label: yy + '年', count: 0 });
      }
    }
    var idx = {};
    items.forEach(function (b, i) { idx[b.key] = i; });
    var seen = {}; // バケットごとに数えた日付。重複を弾いて「日数」にする
    (recs || []).forEach(function (r) {
      var k = (unit === 'month') ? String(r.date).slice(0, 7) : String(r.date).slice(0, 4);
      if (idx[k] == null) return;
      if (!seen[k]) seen[k] = {};
      if (seen[k][r.date]) return;
      seen[k][r.date] = 1;
      items[idx[k]].count++;
    });
    return { unit: unit, items: items };
  }

  // いちばん濃かったバケット。棒が1本しかない期間は比較にならないので出さない。
  function pickBusiest(buckets) {
    if (!buckets || buckets.items.length < 2) return null;
    var best = null;
    buckets.items.forEach(function (b) { if (!best || b.count > best.count) best = b; });
    if (!best || best.count < 2) return null;
    return { label: best.label, count: best.count };
  }

  // allRecords=全期間の全記録, period={kind,start,end,label}, anniversary='YYYY-MM-DD'|null, today='YYYY-MM-DD'
  function computePeriodReview(allRecords, period, anniversary, today) {
    const recs = (allRecords || []).filter((r) => r && r.date);
    const inRecs = recs.filter((r) => String(r.date) >= period.start && String(r.date) <= period.end)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const count = inRecs.length;

    // おでかけ＝記録がある「日」の数（同じ日に何か所まわっても1日）
    const outingDays = new Set(inRecs.map((r) => r.date)).size;

    // 付き合って◯日：基準日は期間の終了日。現在進行中なら今日で止める。
    // 期間まるごとが未来なら出さない（まだ来ていない日を数えても意味がない）。
    let daysTogether = null;
    if (anniversary && period.start <= today) {
      const asOf = (period.end < today) ? period.end : today;
      const d = daysBetweenInclusive(anniversary, asOf);
      daysTogether = (d != null && d >= 1) ? d : null;
    }

    // 各場所の初訪問日を全期間から求める → 期間の開始日以降なら「はじめて」。
    // 年ではなく日付で見るので、年内の短い期間でも正しく判定できる。
    const firstDateOf = {};
    for (const r of recs) {
      const k = placeKey(r); const dt = String(r.date);
      if (firstDateOf[k] == null || dt < firstDateOf[k]) firstDateOf[k] = dt;
    }
    let newPlaces = 0;
    const seen = new Set();
    for (const r of inRecs) {
      const k = placeKey(r);
      if (seen.has(k)) continue; seen.add(k);
      if (firstDateOf[k] >= period.start) newPlaces++;
    }

    // 期間内を場所ごとに集計（代表名＝最新の記録の名前）
    const byKey = {};
    for (const r of inRecs) {
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
    for (const r of inRecs) { const g = r.genre || 'other'; gCount[g] = (gCount[g] || 0) + 1; }
    const genreBreakdown = Object.keys(gCount).map((k) => ({ key: k, count: gCount[k] }))
      .sort((a, b) => b.count - a.count);
    const topGenre = genreBreakdown[0] ? { key: genreBreakdown[0].key, count: genreBreakdown[0].count } : null;

    const buckets = bucketize(period, inRecs);
    const busiest = pickBusiest(buckets);

    // 写真枚数
    let photoCount = 0;
    for (const r of inRecs) photoCount += (r.photos ? r.photos.length : 0);

    // ピン（時系列順・1記録1本）
    const pins = inRecs
      .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => ({ lat: r.lat, lng: r.lng, genre: r.genre || 'other', name: r.name || '', date: r.date }));

    return {
      period, count, outingDays,
      isEmpty: count === 0,
      isSparse: count > 0 && count < 3,
      daysTogether, newPlaces, topSpot, best3,
      topGenre, genreBreakdown, buckets, busiest,
      photoCount, pins,
      firstOuting: inRecs[0] || null,
      lastOuting: count ? inRecs[count - 1] : null,
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
    ids.push('outings'); // ふたりで過ごした日数（記念日の有無に関わらず出す）
    ids.push('places'); // 主役（count>=1）
    if (data.newPlaces >= 1) ids.push('new');
    if (data.topSpot) ids.push('topspot');
    if (data.count >= 2 && data.topGenre) ids.push('genre');
    if (data.busiest) ids.push('busiest');
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
    // 2月：3件だが全部同じ日 → 1日。7月：2件が別の日 → 2日。
    // 記録本数なら2月(3)が最多、日数なら7月(2)が最多になる。
    const dayRecs = [
      { date: '2026-02-03', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-02-03', lat: 35.1, lng: 139.1, genre: 'cafe' },
      { date: '2026-02-03', lat: 35.2, lng: 139.2, genre: 'food' },
      { date: '2026-07-01', lat: 35.0, lng: 139.0, genre: 'food' },
      { date: '2026-07-11', lat: 35.0, lng: 139.0, genre: 'food' },
    ];

    // --- period の生成とラベル整形 ---
    eq('year-period', makeYearPeriod(2026),
      { kind: 'year', start: '2026-01-01', end: '2026-12-31', label: '2026' });

    eq('range-label-same-year', formatRangeLabel('2026-03-01', '2026-03-05'), '3/1〜3/5');
    eq('range-label-cross-year', formatRangeLabel('2025-12-30', '2026-01-03'), '2025/12/30〜2026/1/3');
    eq('range-uses-given-label', makeRangePeriod('2026-03-01', '2026-03-05', '沖縄旅行').label, '沖縄旅行');
    eq('range-trims-label', makeRangePeriod('2026-03-01', '2026-03-05', '  沖縄旅行  ').label, '沖縄旅行');
    eq('range-blank-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', '   ').label, '3/1〜3/5');
    eq('range-null-label-falls-back', makeRangePeriod('2026-03-01', '2026-03-05', null).label, '3/1〜3/5');
    eq('range-kind', makeRangePeriod('2026-03-01', '2026-03-05', 'x').kind, 'range');

    eq('dateline-same-year',
      formatDateLine({ kind: 'range', start: '2026-03-01', end: '2026-03-05' }), '2026.3.1 〜 3.5');
    eq('dateline-cross-year',
      formatDateLine({ kind: 'range', start: '2025-12-30', end: '2026-01-03' }), '2025.12.30 〜 2026.1.3');
    eq('dateline-year-empty', formatDateLine(makeYearPeriod(2026)), '');

    eq('all-period-start', makeAllPeriod(recs, '2026-08-19').start, '2025-08-01');
    eq('all-period-end-covers-future', makeAllPeriod(recs, '2026-08-19').end, '2027-01-01');
    eq('all-period-end-is-today-when-no-future',
      makeAllPeriod([recs[0]], '2026-08-19').end, '2026-08-19');
    eq('all-period-label', makeAllPeriod(recs, '2026-08-19').label, 'これまで');
    eq('all-period-no-records',
      makeAllPeriod([], '2026-08-19'),
      { kind: 'all', start: '2026-08-19', end: '2026-08-19', label: 'これまで' });

    // --- バケット（月刻み／年刻み）---
    const bYear = bucketize(makeYearPeriod(2026), dayRecs);
    eq('bucket-year-unit', bYear.unit, 'month');
    eq('bucket-year-len', bYear.items.length, 12);
    eq('bucket-year-labels', [bYear.items[0].label, bYear.items[11].label], ['1月', '12月']);
    eq('bucket-year-feb-is-days', bYear.items[1].count, 1);
    eq('bucket-year-jul-is-days', bYear.items[6].count, 2);
    eq('bucket-leap-year-still-month', bucketize(makeYearPeriod(2024), []).unit, 'month');

    const bTrip = bucketize(makeRangePeriod('2026-07-01', '2026-07-11', ''), dayRecs);
    eq('bucket-trip-len', bTrip.items.length, 1);
    eq('bucket-trip-count', bTrip.items[0].count, 2);

    const bTwo = bucketize(makeRangePeriod('2026-02-01', '2026-07-31', ''), dayRecs);
    eq('bucket-two-len', bTwo.items.length, 6);
    eq('bucket-two-labels', [bTwo.items[0].label, bTwo.items[5].label], ['2月', '7月']);

    const bCross = bucketize(makeRangePeriod('2025-12-01', '2026-02-28', ''), []);
    eq('bucket-cross-unit', bCross.unit, 'month');
    eq('bucket-cross-len', bCross.items.length, 3);
    eq('bucket-cross-labels', bCross.items.map((b) => b.label), ['12月', '1月', '2月']);

    const bLong = bucketize(makeRangePeriod('2025-01-01', '2026-12-31', ''), recs);
    eq('bucket-long-unit', bLong.unit, 'year');
    eq('bucket-long-len', bLong.items.length, 2);
    eq('bucket-long-labels', bLong.items.map((b) => b.label), ['2025年', '2026年']);
    eq('bucket-long-2025', bLong.items[0].count, 1);
    eq('bucket-long-2026', bLong.items[1].count, 4);

    eq('busiest-by-days', pickBusiest(bYear), { label: '7月', count: 2 });
    eq('busiest-null-when-single-bucket', pickBusiest(bTrip), null);
    eq('busiest-null-when-max-is-one', pickBusiest(bucketize(makeYearPeriod(2026), [recs[2]])), null);

    // --- 年の期間：既存の期待値がそのまま通ること（リグレッション確認）---
    const d = computePeriodReview(recs, makeYearPeriod(2026), '2024-05-10', '2026-08-19');
    eq('count', d.count, 4);
    eq('newPlaces', d.newPlaces, 2);                          // A,B が新規（C は前年初訪問）
    eq('topSpot.count', d.topSpot && d.topSpot.count, 2);
    eq('topSpot.name', d.topSpot && d.topSpot.name, 'A珈琲');
    eq('topGenre.key', d.topGenre && d.topGenre.key, 'cafe');
    eq('busiest', d.busiest, { label: '5月', count: 3 });
    eq('photoCount', d.photoCount, 3);
    eq('pins.length', d.pins.length, 4);
    eq('firstOuting.date', d.firstOuting && d.firstOuting.date, '2026-03-01');
    eq('lastOuting.date', d.lastOuting && d.lastOuting.date, '2026-05-20');
    eq('isSparse-false', d.isSparse, false);
    eq('period-passed-through', d.period.kind, 'year');
    eq('buckets-12', d.buckets.items.length, 12);

    // daysTogether：2024-05-10 → 2026-08-19（両端含む）
    eq('daysTogether', d.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));
    eq('daysBetween-sameday', daysBetweenInclusive('2026-01-01', '2026-01-01'), 1);
    eq('daysBetween-oneday', daysBetweenInclusive('2026-01-01', '2026-01-02'), 2);

    // 過去年は基準日が 12/31
    const d25 = computePeriodReview(recs, makeYearPeriod(2025), '2024-05-10', '2026-08-19');
    eq('past-year-count', d25.count, 1);
    eq('past-year-days', d25.daysTogether, daysBetweenInclusive('2024-05-10', '2025-12-31'));

    eq('noAnniv-days',
      computePeriodReview(recs, makeYearPeriod(2026), null, '2026-08-19').daysTogether, null);
    // 未来の期間は「付き合って◯日目」が無意味なので出さない
    eq('future-year-days',
      computePeriodReview(recs, makeYearPeriod(2027), '2024-05-10', '2026-08-19').daysTogether, null);
    // 期間全体が記念日より前なら出さない
    eq('before-anniversary-days',
      computePeriodReview(recs, makeYearPeriod(2026), '2027-01-01', '2026-08-19').daysTogether, null);

    eq('sparse', computePeriodReview([recs[0]], makeYearPeriod(2026), null, '2026-08-19').isSparse, true);
    eq('empty', computePeriodReview([], makeYearPeriod(2020), null, '2026-08-19').isEmpty, true);

    // おでかけ日数と記録本数は別物
    const dd = computePeriodReview(dayRecs, makeYearPeriod(2026), null, '2026-12-31');
    eq('outingDays', dd.outingDays, 3);
    eq('count-stays-records', dd.count, 5);
    eq('outingDays-empty',
      computePeriodReview([], makeYearPeriod(2020), null, '2026-12-31').outingDays, 0);

    // --- 期間（range）---
    // 5月の3件だけを切り出す。年では再訪だった C公園 も、5月に初めて来ているので新規になる。
    const may = computePeriodReview(recs, makeRangePeriod('2026-05-01', '2026-05-31', '五月'),
      '2024-05-10', '2026-08-19');
    eq('range-count', may.count, 3);
    eq('range-label-kept', may.period.label, '五月');
    eq('range-newPlaces', may.newPlaces, 1);                  // B のみ（A は3月、C は前年が初訪問）
    eq('range-single-bucket-no-busiest', may.busiest, null);
    // 終わった期間なので基準日は today ではなく期間の終了日
    eq('range-days-uses-period-end', may.daysTogether, daysBetweenInclusive('2024-05-10', '2026-05-31'));
    // まだ続いている期間は today で止める
    const ongoing = computePeriodReview(recs, makeRangePeriod('2026-01-01', '2026-12-31', '今'),
      '2024-05-10', '2026-08-19');
    eq('range-days-clamped-to-today', ongoing.daysTogether, daysBetweenInclusive('2024-05-10', '2026-08-19'));

    // 終わった旅行は、その期間の終了日が「付き合って◯日目」の基準になる
    const trip = computePeriodReview(recs, makeRangePeriod('2026-03-01', '2026-03-05', '旅行'),
      '2024-05-10', '2026-08-19');
    eq('trip-count', trip.count, 1);
    eq('trip-days-uses-period-end', trip.daysTogether, daysBetweenInclusive('2024-05-10', '2026-03-05'));
    eq('trip-newPlaces', trip.newPlaces, 1);                  // A珈琲はこの日が初訪問

    // --- これまで ---
    const all = computePeriodReview(recs, makeAllPeriod(recs, '2026-08-19'), null, '2026-08-19');
    eq('all-count', all.count, 6);                            // 未来の記録も含む
    eq('all-unit-is-year', all.buckets.unit, 'year');
    eq('all-buckets', all.buckets.items.map((b) => b.label), ['2025年', '2026年', '2027年']);
    eq('all-newPlaces-is-every-place', all.newPlaces, 4);      // A,B,C,未来 すべてが初訪問

    // yearsWithRecords
    eq('years', yearsWithRecords(recs), [2027, 2026, 2025]);

    // planSlides：全部そろう年
    eq('planSlides-full', planSlides(d), ['days', 'outings', 'places', 'new', 'topspot', 'genre', 'busiest', 'closing']);
    // 記念日が無くても「ふたりで過ごした日」は出す（付き合って日数とは別物）
    eq('planSlides-outings-without-anniv',
      planSlides(computePeriodReview(dayRecs, makeYearPeriod(2026), null, '2026-12-31')).indexOf('outings') >= 0, true);
    // 記念日なし・再訪なし・単月 → days/topspot/busiest が落ちる
    eq('planSlides-min',
      planSlides(computePeriodReview([recs[2]], makeYearPeriod(2026), null, '2026-08-19')),
      ['outings', 'places', 'new', 'closing']);
    // 記録1件の旅行でもスライドは出る（しきい値の扱いは open() 側）
    eq('planSlides-one-record-trip', planSlides(trip).length > 0, true);

    console.log(fails === 0 ? '✅ review-stats ALL PASS' : ('❌ review-stats ' + fails + ' FAIL'));
    return fails;
  }

  return { computePeriodReview, yearsWithRecords, planSlides, placeKey, daysBetweenInclusive,
    formatRangeLabel, formatDateLine, makeYearPeriod, makeAllPeriod, makeRangePeriod,
    bucketize, pickBusiest, _selfTest };
})();
