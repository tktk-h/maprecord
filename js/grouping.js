window.App = window.App || {};
// 写真を「訪問ごと」にグループ化する純粋ロジック。UI/EXIF非依存＝テスト可能。
App.grouping = (function () {
  const DIST_M = 150;                 // これより離れたら別グループ（GPSあり）
  const GAP_MS = 2 * 60 * 60 * 1000;  // これ以上あいたら別グループ

  // 2点間の距離(m)。ハバースイン。
  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // 座標配列の重心（単純平均。市内スケールなら十分）。空なら null。
  function centroid(points) {
    if (!points.length) return null;
    let sLat = 0, sLng = 0;
    for (const p of points) { sLat += p.lat; sLng += p.lng; }
    return { lat: sLat / points.length, lng: sLng / points.length };
  }

  // ローカル時刻の 'YYYY-MM-DD'
  function dateOf(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // items: [{ time:Number(ms), gps:{lat,lng}|null }]（順不同でよい。元の位置は index で保持）
  // 返り値: グループ配列。各 { idx:[元index...], date, center:{lat,lng}|null, hasGps }
  //   ・GPSあり: 中心から150m超 or 直前から2時間超で切る
  //   ・GPSなし: 2時間超だけで切る（場所未設定）
  //   ・日付では切らない。各グループの date は最早写真の日。
  //   ・全グループを最早時刻の昇順で並べて返す（GPS有無を混ぜて時系列）。
  function groupPhotos(items) {
    const withIdx = items.map((it, i) => ({ i, time: it.time, gps: it.gps || null }));
    const gps = withIdx.filter((x) => x.gps).sort((a, b) => a.time - b.time);
    const nogps = withIdx.filter((x) => !x.gps).sort((a, b) => a.time - b.time);
    const groups = [];

    // GPSあり
    let cur = null;
    for (const x of gps) {
      if (cur) {
        const c = centroid(cur.pts);
        const far = haversineM(c.lat, c.lng, x.gps.lat, x.gps.lng) > DIST_M;
        const gap = (x.time - cur.lastTime) > GAP_MS;
        if (far || gap) cur = null;
      }
      if (!cur) { cur = { idx: [], pts: [], firstTime: x.time, lastTime: x.time }; groups.push(cur); }
      cur.idx.push(x.i); cur.pts.push(x.gps); cur.lastTime = x.time;
    }
    // GPSなし
    let curN = null;
    for (const x of nogps) {
      if (curN && (x.time - curN.lastTime) > GAP_MS) curN = null;
      if (!curN) { curN = { idx: [], pts: null, firstTime: x.time, lastTime: x.time, nogps: true }; groups.push(curN); }
      curN.idx.push(x.i); curN.lastTime = x.time;
    }

    return groups
      .sort((a, b) => a.firstTime - b.firstTime)
      .map((g) => ({
        idx: g.idx,
        date: dateOf(g.firstTime),
        center: g.nogps ? null : centroid(g.pts),
        hasGps: !g.nogps,
      }));
  }

  function _selfTest() {
    const eq = (n, got, want) => console.log((JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL') + ' ' + n, JSON.stringify(got));
    const H = 60 * 60 * 1000;
    const base = Date.UTC(2026, 7, 16, 4, 0, 0); // 適当な基準(ms)
    const A = { lat: 35.0000, lng: 135.0000 };
    const near = { lat: 35.0010, lng: 135.0000 };  // 約111m（<150）
    const far = { lat: 35.0030, lng: 135.0000 };   // 約333m（>150）

    // 近い＆10分差 → 1グループ [0,1]
    eq('near-close', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base + 10 * 60000, gps: near },
    ]).map((g) => g.idx), [[0, 1]]);

    // 遠い＆同時刻 → 2グループ
    eq('far-split', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base, gps: far },
    ]).map((g) => g.idx), [[0], [1]]);

    // 近いが3時間差 → 時間で2グループ
    eq('gap-split', App.grouping.groupPhotos([
      { time: base, gps: A }, { time: base + 3 * H, gps: near },
    ]).map((g) => g.idx), [[0], [1]]);

    // GPSなし2枚30分差 → 1グループ・hasGps=false
    eq('nogps-one', App.grouping.groupPhotos([
      { time: base, gps: null }, { time: base + 30 * 60000, gps: null },
    ]).map((g) => ({ idx: g.idx, hasGps: g.hasGps, center: g.center })),
      [{ idx: [0, 1], hasGps: false, center: null }]);

    // 混在の時系列順: GPS(13時)→無GPS(14時)→GPS(15時) は idx 昇順 [[0],[1],[2]]
    eq('interleave', App.grouping.groupPhotos([
      { time: base, gps: far }, { time: base + 1 * H, gps: null }, { time: base + 2 * H, gps: A },
    ]).map((g) => g.idx), [[0], [1], [2]]);

    // 距離関数のサニティ（約111m）
    const d = App.grouping.haversineM(35, 135, 35.001, 135);
    console.log((d > 100 && d < 125 ? 'PASS' : 'FAIL') + ' haversine-111m', Math.round(d));
  }

  return { haversineM, centroid, dateOf, groupPhotos, _selfTest };
})();
