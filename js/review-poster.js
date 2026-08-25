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
  const DRAW_W = 270, DRAW_H = 480; // タイルを描く大きさ。ここで写真を縮小するので、小さすぎると粗く拾ってしまう
  const BLUR_MIN = 68;              // ここまで縮めてから戻すと、モックで選んだ「弱め」のやわらかさになる
  const STEP = 1.6;                 // 戻すときの1段の倍率。小刻みなほどガウスに近くなる

  const HEAD_MAX_W = 920;    // W - 左右の余白160
  const HEAD_BASE = 240;     // 年号の大きさ。これを上限にする
  const HEAD_MIN = 72;
  const HEAD_WRAP_AT = 120;  // ここまで縮むなら、割れるラベルは2行にしたほうが読める
  const HEAD_WRAP_MAX = 200; // 2行にしたときの上限（1行より大きくは見せない）

  // 見出しの行組みとフォントサイズを決める。measure(text, size) は幅(px)を返す関数。
  // canvas 無しでも試せるよう、測る手段を外から渡す。
  function planHeadline(label, measure) {
    const text = String(label == null ? '' : label);
    const fit = (t) => {
      const w = measure(t, HEAD_BASE);
      if (!(w > 0)) return HEAD_BASE;
      return Math.min(HEAD_BASE, Math.floor(HEAD_BASE * HEAD_MAX_W / w));
    };
    const one = fit(text);
    const at = text.indexOf('〜');
    // 先頭が 〜 のときに割ると空行ができるので、at<=0 は1行のまま
    if (one >= HEAD_WRAP_AT || at <= 0) {
      return { lines: [text], size: Math.max(HEAD_MIN, one) };
    }
    const a = text.slice(0, at);
    const b = text.slice(at); // 2行目は 〜 から始める
    const size = Math.min(HEAD_WRAP_MAX, Math.min(fit(a), fit(b)));
    return { lines: [a, b], size: Math.max(HEAD_MIN, size) };
  }

  // 共有・保存のファイル名。ラベルはユーザーが打った文字なので、
  // ファイル名に使えない字を落としてから使う。
  function posterFileName(label) {
    const safe = String(label == null ? '' : label)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
    return 'ashiato-' + (safe || 'period') + '.png';
  }

  const LOAD_TIMEOUT = 8000; // これを過ぎたら諦める。電波が悪いと onerror も来ず永久に待つため

  // どこで失敗したかを残す。実機でしか起きない不具合を、次に当て推量なしで追うため。
  var diag = null;
  function resetDiag(n) { diag = { urls: n, viaFetch: 0, viaImg: 0, failed: 0, why: '' }; }
  function note(what) { if (diag && !diag.why) diag.why = what; }
  function lastDiag() { return diag; }

  // <img> で1枚読む。失敗しても reject せず null を返す。
  // cors=true のときだけ crossOrigin を付ける。付けないと canvas が汚染され、
  // 書き出しのときだけ SecurityError になる。ただし blob: は同一オリジン扱いなので不要
  //（blob: に crossOrigin を付けると逆に失敗する端末がある）。
  // 応答が返らないまま止まることがあるので、時間切れでも必ず決着させる。
  function loadImgEl(url, cors) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      let timer = null;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
      timer = setTimeout(() => { img.src = ''; finish(null); }, LOAD_TIMEOUT);
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = url;
    });
  }

  // キャッシュを明示的に迂回して取り直し、Blob 経由で読む。
  // blob: URL は同一オリジン扱いなので canvas が汚れず、toBlob() も通る。
  // createImageBitmap は端末差が大きいので使わない（実機で読めなかった）。
  // 解放は描き終わってから。ここで revoke すると描画前に画像が消える。
  async function fetchAsImage(url) {
    if (typeof fetch !== 'function') { note('no-fetch'); return null; }
    if (/^data:/.test(url)) return null; // data URL はキャッシュと無縁。img 経路で十分
    let timer = null;
    let objUrl = null;
    try {
      const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      if (ctl) timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT);
      const res = await fetch(url, { mode: 'cors', cache: 'reload', signal: ctl ? ctl.signal : undefined });
      if (!res.ok) { note('http' + res.status); return null; }
      const blob = await res.blob();
      objUrl = URL.createObjectURL(blob);
      const img = await loadImgEl(objUrl, false);
      if (!img) { URL.revokeObjectURL(objUrl); note('blob-decode'); return null; }
      img._objUrl = objUrl; // build が描き終わってから解放する
      return img;
    } catch (e) {
      if (objUrl) URL.revokeObjectURL(objUrl);
      note('fetch:' + ((e && e.name) || 'err'));
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // 写真を1枚読む。
  //
  // この読み込みが総集編ページと競合していた時期がある。ページ側が同じ写真を
  // 背景画像（no-cors）で先に読むと、その応答が使い回されて crossOrigin 付きの
  // 読み込みだけが失敗していた。いまはページ側も crossorigin を付けた <img> で
  // 読むよう揃えてあるので、取り合いは起きない（js/review-ui.js の写真グリッド）。
  //
  // 順番は「実機で動く経路が先」。<img crossOrigin> は端末で実績があり、
  // fetch は環境によっては CORS 前で TypeError になることがあるので保険に回す。
  async function loadImage(url) {
    const viaImg = await loadImgEl(url, true);
    if (viaImg) { if (diag) diag.viaImg++; return viaImg; }
    const viaFetch = await fetchAsImage(url);
    if (viaFetch) { if (diag) diag.viaFetch++; return viaFetch; }
    if (diag) diag.failed++;
    return null;
  }

  // 一度失敗した URL を、キャッシュを避けて読み直すための別URLにする。
  // 総集編のページ側は CSS の background-image（no-cors）で同じ写真を読んでいる。
  // その応答が使い回されると、crossOrigin 付きの読み込みだけが失敗することがある。
  // 問い合わせ先を変えれば取り直せる。data URL はキャッシュと無縁なので対象外。
  function bustCache(url) {
    if (!url || /^data:/.test(url)) return null;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_p=1';
  }

  // 読めなかった枠を、読めた写真で埋め直す。
  // 1枚でも失敗すると背景に単色の四角が残り、ポスターとして破綻してしまうため、
  // 穴は必ず塞ぐ。ぼかしがかかるので同じ写真を使い回しても目立たない。
  function fillGaps(imgs) {
    const ok = imgs.filter(Boolean);
    if (!ok.length) return imgs;             // 全滅なら呼び出し側が暖色背景に落とす
    let k = 0;
    return imgs.map((im) => im || ok[k++ % ok.length]);
  }

  // 枠いっぱいに写真を敷く（元画像の側を切り出す＝object-fit:cover 相当）
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;                          // 元画像から切り出す範囲
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // 指定サイズの canvas に描き写す（補間は最高品質で）
  function scaled(src, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    return c;
  }

  // 背景をぼかして原寸で描く。ctx.filter は端末差があるので使わない。
  // 半分ずつ縮めてから 1.6倍ずつ戻すことで補間を何度も重ね、
  // 一気に拡大したときの「直線的な継ぎ目」ではなくガウスに近いなめらかさを作る。
  function drawBlurred(ctx, src, w, h) {
    let cur = src;
    const drop = (c) => { if (c !== src) { c.width = c.height = 0; } }; // 作業用canvasは早めに返す
    while (Math.round(cur.width / 2) >= BLUR_MIN) {
      const next = scaled(cur, Math.round(cur.width / 2), Math.round(cur.height / 2));
      drop(cur); cur = next;
    }
    while (cur.width * STEP < w) {
      const next = scaled(cur, Math.round(cur.width * STEP), Math.round(cur.height * STEP));
      drop(cur); cur = next;
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    drop(cur);
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

  // ポスターに出す文字。フォント読み込みに「この字が要る」と伝えるために使う。
  // Google Fonts の日本語は多数のサブセットに分割配信されるので、字を指定せずに
  // load() すると欧文サブセットしか保証されず、一部の字だけ既定書体に化ける。
  const GLYPHS = 'あしあと年のおでかけ日訪れた場所か写真枚付き合って目・これまで〜./0123456789';

  // アプリと同じ書体で描くため、canvas に使う前にフォントを読み込ませる。
  // 待たないと日本語が既定ゴシックになり、別物の見た目になる。
  // extra には実際に描く文字（期間ラベルと日付行）を渡すこと。任意の字が来るため。
  async function ensureFonts(extra) {
    const glyphs = GLYPHS + (extra || '');
    try {
      await Promise.all([
        document.fonts.load('300 240px "Zen Kaku Gothic New"', glyphs),
        document.fonts.load('400 30px "Zen Kaku Gothic New"', glyphs),
      ]);
      await document.fonts.ready;
    } catch (e) { /* 読めなくても既定書体で続行する */ }
  }

  // data=computePeriodReview の戻り値, photoUrls=その期間の写真URL（日付昇順）
  async function build(data, photoUrls) {
    const period = data.period;
    const dateLine = App.reviewStats.formatDateLine(period);
    await ensureFonts(period.label + dateLine);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // --- 背景：小さく描いて拡大＝ぼかし ---
    const picked = pickPosterPhotos(photoUrls || [], TILES, COLS);
    // 同じ写真が複数の枠に入る。URLごとに1回だけ読む——毎回ネットワークまで
    // 取りに行くので、枠の数だけ読むと同じ写真を何度も落とすことになる。
    const uniq = Array.from(new Set(picked));
    resetDiag(uniq.length);
    const byUrl = new Map();
    await Promise.all(uniq.map((u) => loadImage(u).then((im) => { byUrl.set(u, im); })));
    // それでも読めなかったものだけ、問い合わせ先を変えてもう一度だけ試す（保険）
    await Promise.all(uniq.filter((u) => !byUrl.get(u)).map((u) => {
      const alt = bustCache(u);
      if (!alt) return null;
      return loadImage(alt).then((im) => { if (im) byUrl.set(u, im); });
    }));
    const loaded = picked.map((u) => byUrl.get(u) || null);
    const failed = loaded.filter((im) => !im).length;
    if (failed) console.warn('poster: 読めなかった写真 ' + failed + '/' + loaded.length);
    const imgs = fillGaps(loaded);
    const usable = imgs.filter(Boolean).length;

    const sw = DRAW_W, sh = DRAW_H;
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';

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

    drawBlurred(ctx, small, W, H);
    small.width = small.height = 0; // 端末のメモリを早めに返す
    // blob: URL は描き終わってから解放する。同じ写真が複数の枠に入るので重複を除いてから。
    new Set(imgs).forEach((im) => { if (im && im._objUrl) URL.revokeObjectURL(im._objUrl); });

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
    const head = planHeadline(period.label, (t, size) => {
      ctx.font = '300 ' + size + 'px "Zen Kaku Gothic New", sans-serif';
      return ctx.measureText(t).width;
    });
    ctx.font = '300 ' + head.size + 'px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#fff';
    // 行が増えても見出しの中心が動かないよう、上下に振り分ける
    const headLineH = Math.round(head.size * 1.15);
    const top = H * 0.31 - (head.lines.length - 1) * headLineH / 2;
    head.lines.forEach((t, i) => { ctx.fillText(t, W / 2, top + i * headLineH); });

    // 副題は最終行の下に置く。1行のときは従来と同じ位置になる。
    const subY = top + (head.lines.length - 1) * headLineH + Math.round(head.size * 0.5) + 45;
    ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    drawSpaced(ctx, period.kind === 'year' ? '年のあしあと' : 'のあしあと', W / 2, subY, 9);

    if (dateLine) {
      ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText(dateLine, W / 2, subY + 58);
    }

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

    // --- 見出しの行組み ---
    // 全角=1.0em / 半角=0.5em として幅を見積もる簡易 measure（実測の代わり）
    const measure = (text, size) => {
      let w = 0;
      for (const ch of String(text)) w += (/[\x20-\x7e]/.test(ch) ? 0.5 : 1) * size;
      return w;
    };
    // 年号は今までどおり基準サイズのまま1行
    eq('head-year-lines', planHeadline('2026', measure).lines, ['2026']);
    eq('head-year-size', planHeadline('2026', measure).size, 240);
    // 4文字の日本語は少し縮んで1行
    eq('head-imamade-lines', planHeadline('これまで', measure).lines, ['これまで']);
    eq('head-imamade-size', planHeadline('これまで', measure).size, 230);
    eq('head-trip-lines', planHeadline('沖縄旅行', measure).lines, ['沖縄旅行']);
    // 短い日付ラベルは割らない
    eq('head-short-range-lines', planHeadline('3/1〜3/5', measure).lines, ['3/1〜3/5']);
    // 年をまたぐ長い日付ラベルは 〜 の前で2行に割り、2行目は 〜 から始める
    const cross = planHeadline('2025/12/30〜2026/1/3', measure);
    eq('head-cross-2-lines', cross.lines.length, 2);
    eq('head-cross-line1', cross.lines[0], '2025/12/30');
    eq('head-cross-line2', cross.lines[1], '〜2026/1/3');
    eq('head-cross-size', cross.size, 184);
    // 〜 を含まない長いラベルは折り返さず、縮めて1行に収める
    const long10 = planHeadline('あいうえおかきくけこ', measure);
    eq('head-long-1-line', long10.lines.length, 1);
    eq('head-long-size', long10.size, 92);
    // 下限を割らない（入力は10文字までだが関数としては守る）
    eq('head-min-size', planHeadline(new Array(21).join('あ'), measure).size, 72);
    // 先頭が 〜 のときは空行を作らない
    eq('head-leading-tilde-1-line', planHeadline('〜あいうえおかきくけこ', measure).lines.length, 1);

    // --- 共有ファイル名 ---
    eq('file-year', posterFileName('2026'), 'ashiato-2026.png');
    eq('file-label', posterFileName('沖縄旅行'), 'ashiato-沖縄旅行.png');
    eq('file-strips-path-chars', posterFileName('a/b:c*d?e"f<g>h|i'), 'ashiato-a_b_c_d_e_f_g_h_i.png');
    eq('file-strips-backslash', posterFileName('a\\b'), 'ashiato-a_b.png');
    // 空白とハイフンは消さない（制御文字の範囲を書き損じると、ここが落ちる）
    eq('file-keeps-inner-space', posterFileName('沖縄 旅行'), 'ashiato-沖縄 旅行.png');
    eq('file-keeps-hyphen', posterFileName('3-1'), 'ashiato-3-1.png');
    eq('file-blank-falls-back', posterFileName('   '), 'ashiato-period.png');
    eq('file-null-falls-back', posterFileName(null), 'ashiato-period.png');

    console.log(fails === 0 ? 'ALL PASS (poster)' : (fails + ' FAILED (poster)'));
    return fails;
  }

  return { build, pickPosterPhotos, statLines, tileRects, planHeadline, posterFileName, lastDiag, _selfTest };
})();
