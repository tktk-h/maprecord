window.App = window.App || {};
// 年間ふりかえりを1枚のポスター画像（PNG）にする。UI・共有処理は持たない。
App.reviewPoster = (function () {
  const COLS = 3, ROWS = 5, TILES = COLS * ROWS;

  // 写真をタイル枚数ぶん選ぶ。urls は日付昇順で渡すこと。
  // 多いときは1年に散るよう等間隔で間引き、少ないときは繰り返して埋める。
  function pickPosterPhotos(urls, n, cols) {
    const src = urls || [];
    if (src.length === 0) return [];
    if (src.length >= n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(src[Math.round(i * (src.length - 1) / (n - 1))]);
      return out;
    }
    // 行ごとにずらして、上下でも同じ写真が隣り合わないようにする。
    // 縦の差は (cols + off) % len。これが0だと真上と同じ写真になるので、
    // 0にならない off を選ぶ（len>=2 なら 1 か 2 のどちらかが必ず成立する）。
    const len = src.length;
    const off = (len < 2 || (cols + 1) % len !== 0) ? 1 : 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      out.push(src[(i + row * off) % len]);
    }
    return out;
  }

  // ポスターに載せる数字の行。1行目に数字、2行目に記念日（無ければ1行だけ）。
  function statLines(data) {
    const lines = ['おでかけ ' + data.outingDays + '日 ・ 訪れた場所 ' + data.count + 'か所 ・ 写真 ' + data.photoCount + '枚'];
    if (data.daysTogether != null) lines.push('付き合って ' + data.daysTogether + '日目');
    return lines;
  }

  // 隙間なく敷き詰める矩形。端が1px空かないよう、境界を丸めてから幅を出す。
  function tileRects(w, h, cols, rows) {
    const out = [];
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round(h * r / rows), y1 = Math.round(h * (r + 1) / rows);
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(w * c / cols), x1 = Math.round(w * (c + 1) / cols);
        out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    return out;
  }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    // 上下左右に同じ写真が並んでいないか
    const noAdjacentDup = (arr, cols) => {
      for (let i = 0; i < arr.length; i++) {
        if (i % cols !== 0 && arr[i] === arr[i - 1]) return false;   // 左
        if (i >= cols && arr[i] === arr[i - cols]) return false;      // 上
      }
      return true;
    };
    const seq = (n) => Array.from({ length: n }, (_, i) => 'p' + i);

    // pickPosterPhotos：多い年は1年に散らして間引く
    const p30 = pickPosterPhotos(seq(30), TILES, COLS);
    eq('pick30-length', p30.length, 15);
    eq('pick30-first', p30[0], 'p0');
    eq('pick30-last', p30[14], 'p29');
    eq('pick15-identity', pickPosterPhotos(seq(15), TILES, COLS), seq(15));

    // 足りない年は繰り返して埋める。隣に同じ写真を置かない。
    [5, 4, 3, 2].forEach((n) => {
      const got = pickPosterPhotos(seq(n), TILES, COLS);
      eq('pick' + n + '-length', got.length, 15);
      eq('pick' + n + '-no-adjacent-dup', noAdjacentDup(got, COLS), true);
    });
    // 1枚しかない年は全面同じになる（許容）
    eq('pick1-all-same', pickPosterPhotos(['p0'], TILES, COLS).join(','), new Array(15).fill('p0').join(','));
    eq('pick0-empty', pickPosterPhotos([], TILES, COLS), []);

    // statLines
    const full = { outingDays: 28, count: 42, photoCount: 128, daysTogether: 830 };
    eq('stat-2-lines', statLines(full).length, 2);
    eq('stat-line1', statLines(full)[0], 'おでかけ 28日 ・ 訪れた場所 42か所 ・ 写真 128枚');
    eq('stat-line2', statLines(full)[1], '付き合って 830日目');
    const noAnniv = { outingDays: 28, count: 42, photoCount: 128, daysTogether: null };
    eq('stat-1-line-without-anniv', statLines(noAnniv).length, 1);
    eq('stat-no-newplaces', statLines(full).join('').indexOf('はじめて'), -1);

    // tileRects：隙間なく敷き詰める
    const rects = tileRects(1080, 1920, COLS, ROWS);
    eq('tiles-count', rects.length, 15);
    eq('tiles-cover-canvas', rects.reduce((s, r) => s + r.w * r.h, 0), 1080 * 1920);
    eq('tiles-first-origin', { x: rects[0].x, y: rects[0].y }, { x: 0, y: 0 });
    eq('tiles-last-corner', rects[14].x + rects[14].w, 1080);
    eq('tiles-last-bottom', rects[14].y + rects[14].h, 1920);

    console.log(fails === 0 ? 'ALL PASS (poster)' : (fails + ' FAILED (poster)'));
    return fails;
  }

  return { pickPosterPhotos, statLines, tileRects, _selfTest };
})();
