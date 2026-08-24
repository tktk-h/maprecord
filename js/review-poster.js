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

  const W = 1080, H = 1920;
  const SHRINK = 8;                 // 1/8に縮小してから戻すことでぼかす

  // 画像を1枚読む。失敗しても reject せず null を返す（1枚の失敗で全体を止めない）。
  // crossOrigin を付けないと canvas が汚染され、書き出しのときだけ SecurityError になる。
  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // 枠いっぱいに写真を敷く（元画像の側を切り出す＝object-fit:cover 相当）
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;                          // 元画像から切り出す範囲
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // 写真が無い年の背景。暖色のグラデーションで成立させる。
  function drawWarmField(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4a3527');
    g.addColorStop(1, '#2c1e16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    [[0.18, 0.12, '#b8825e'], [0.84, 0.26, '#8aa286'], [0.22, 0.78, '#c08a80'], [0.88, 0.9, '#9c92b8']]
      .forEach(([px, py, color]) => {
        const r = ctx.createRadialGradient(w * px, h * py, 0, w * px, h * py, w * 0.6);
        r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
      });
  }

  // 字間を空けて中央に描く。ctx.letterSpacing は対応がまちまちなので1文字ずつ置く。
  function drawSpaced(ctx, text, cx, y, spacing) {
    const prev = ctx.textAlign;
    ctx.textAlign = 'center';
    const chars = String(text).split('');
    let total = 0;
    chars.forEach((c) => { total += ctx.measureText(c).width + spacing; });
    total -= spacing;
    let x = cx - total / 2;
    chars.forEach((c) => {
      const w = ctx.measureText(c).width;
      ctx.fillText(c, x + w / 2, y);
      x += w + spacing;
    });
    ctx.textAlign = prev;
  }

  // アプリと同じ書体で描くため、canvas に使う前にフォントを読み込ませる。
  // 待たないと日本語が既定ゴシックになり、別物の見た目になる。
  async function ensureFonts() {
    try {
      await Promise.all([
        document.fonts.load('300 240px "Zen Kaku Gothic New"'),
        document.fonts.load('400 30px "Zen Kaku Gothic New"'),
      ]);
      await document.fonts.ready;
    } catch (e) { /* 読めなくても既定書体で続行する */ }
  }

  // data=computeYearReview の戻り値, photoUrls=その年の写真URL（日付昇順）
  async function build(data, photoUrls) {
    await ensureFonts();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // --- 背景：小さく描いて拡大＝ぼかし ---
    const picked = pickPosterPhotos(photoUrls || [], TILES, COLS);
    const imgs = await Promise.all(picked.map(loadImage));
    const usable = imgs.filter(Boolean).length;

    const sw = Math.round(W / SHRINK), sh = Math.round(H / SHRINK);
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d');

    if (usable === 0) {
      drawWarmField(sctx, sw, sh);
    } else {
      const rects = tileRects(sw, sh, COLS, ROWS);
      rects.forEach((r, i) => {
        const img = imgs[i];
        if (img) { drawCover(sctx, img, r.x, r.y, r.w, r.h); }
        else { sctx.fillStyle = '#8d5a3c'; sctx.fillRect(r.x, r.y, r.w, r.h); } // 読めなかった枠
      });
    }

    // 一気に8倍すると角が立つので、2段階で戻して滑らかにする
    const mid = document.createElement('canvas');
    mid.width = Math.round(W / 2); mid.height = Math.round(H / 2);
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingEnabled = true; mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(small, 0, 0, mid.width, mid.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, W, H);
    small.width = small.height = 0; mid.width = mid.height = 0; // 端末のメモリを早めに返す

    // --- 暗幕 ---
    ctx.fillStyle = 'rgba(38, 26, 19, 0.55)';
    ctx.fillRect(0, 0, W, H);

    // --- 文字 ---
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '400 20px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    drawSpacedLeft(ctx, 'あしあと', 60, 66, 5);

    ctx.textAlign = 'center';
    ctx.font = '300 240px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(data.year), W / 2, H * 0.31);

    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    drawSpaced(ctx, '年のあしあと', W / 2, H * 0.31 + 165, 9);

    const lines = statLines(data);
    const lineH = 58;
    const blockBottom = H - 120;                    // 下端からの位置は行数に関わらず固定
    const firstY = blockBottom - (lines.length - 1) * lineH;
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(W / 2 - 26, firstY - 62, 52, 1);   // 区切り線
    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    lines.forEach((t, i) => { ctx.fillText(t, W / 2, firstY + i * lineH); });

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('toBlob failed'));
      }, 'image/png');
    });
  }

  // 左揃えで字間を空ける（左上のロゴ用）
  function drawSpacedLeft(ctx, text, x, y, spacing) {
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    let cx = x;
    String(text).split('').forEach((c) => {
      ctx.fillText(c, cx, y);
      cx += ctx.measureText(c).width + spacing;
    });
    ctx.textAlign = prev;
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

  return { build, pickPosterPhotos, statLines, tileRects, _selfTest };
})();
