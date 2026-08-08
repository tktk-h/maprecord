window.App = window.App || {};
// スマホの下シートを上下にドラッグ／スナップさせる（Googleマップ風）
App.sheet = (function () {
  let panel, grip;
  let snaps = { full: 0, half: 0, peek: 0 };
  let currentY = 0;
  let dragging = false;
  let startPointerY = 0;
  let startY = 0;
  let closing = false; // 閉じアニメ中フラグ（途中で開き直したらキャンセル）
  let mode = null;     // ドラッグ中の意図: 'sheet'（シート上下）/ 'scroll'（中身スクロール）
  let downOnGrip = false; // つまみ（グリップ）から始まったドラッグか
  let vY = 0;          // ドラッグ速度（px/ms、上げ方向を+）
  let lastT = 0, lastPY = 0; // 速度計算用の直前サンプル

  const FLICK_V = 0.4; // これ以上の速さは弾き（フリック）＝方向へ1段進める
  const COMMIT = 40;   // これだけ動かせば次の段へ確定（軽く動かすだけでOK）

  const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

  function computeSnaps() {
    const vh = window.innerHeight;
    // 浮かせたヘッダー（検索バー等）の高さぶんは空ける
    const header = document.getElementById('topbar');
    const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 110;
    // シートの高さ(px)。大きいほど大きく開く
    snaps = {
      full: Math.round(vh - headerH - 12), // full でもヘッダーと重ならない
      half: Math.round(vh * 0.50),
      peek: Math.round(vh * 0.12),
    };
  }
  function setY(y) {
    currentY = y;
    panel.style.setProperty('--sheet-h', y + 'px');
  }
  function nearest(y) {
    return [snaps.full, snaps.half, snaps.peek]
      .reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  }
  // 段（peek→half→full の昇順）で、y に一番近い段から dir 方向へ1段ぶん動いた高さ
  function stepFrom(y, dir) {
    const list = [snaps.peek, snaps.half, snaps.full];
    let bi = 0, bd = Infinity;
    list.forEach((v, i) => { const d = Math.abs(v - y); if (d < bd) { bd = d; bi = i; } });
    let i = Math.max(0, Math.min(list.length - 1, bi + dir));
    return list[i];
  }

  function snapTo(name) {
    if (!panel) return;
    computeSnaps();
    const target = snaps[name] != null ? snaps[name] : snaps.half;
    closing = false;                       // 閉じ動作が進行中なら取り消す
    const wasHidden = panel.hidden;
    panel.hidden = false;                  // 何か表示するときはシートを出す
    if (isMobile() && wasHidden) {
      // 隠れていた状態から：目標の高さにしたうえで、いったん画面下へ逃がし
      // → translateY(0) へ戻すことで「下からせり上がる」アニメにする。
      // 高さ(var)ではなく transform を動かすので端末を問わず確実に動く。
      panel.style.transition = 'none';
      setY(target);
      panel.style.transform = 'translateY(100%)';
      panel.getBoundingClientRect();       // 強制リフローで開始位置を確定
      panel.style.transition = '';
      panel.style.transform = 'translateY(0)';
    } else {
      panel.style.transition = '';
      panel.style.transform = 'translateY(0)'; // 閉じ途中なら引き戻す
      setY(target);
    }
    updateAtFull();
  }

  // 地図タップなどで、開いているシートを最小（peek）まで下げる
  function collapse() {
    if (!panel || panel.hidden || !isMobile()) return;
    computeSnaps();
    if (currentY <= snaps.peek + 1) return; // すでに最小
    panel.style.transition = '';
    panel.style.transform = 'translateY(0)';
    setY(snaps.peek);
    updateAtFull();
  }

  function atFull() { return currentY >= snaps.full - 1; }
  function updateAtFull() { if (panel) panel.classList.toggle('at-full', atFull()); }

  function onHideEnd(e) {
    if (e.propertyName !== 'transform') return;
    panel.removeEventListener('transitionend', onHideEnd);
    if (closing) { panel.hidden = true; panel.style.transform = ''; closing = false; }
  }
  function hide() { // シートを隠す（選択解除）
    if (!panel || panel.hidden) return;
    if (!isMobile()) { panel.hidden = true; return; } // デスクトップは即時
    // 下へスライドして隠す → 終わってから hidden にする（下に戻るアニメ）
    closing = true;
    panel.style.transition = '';
    panel.addEventListener('transitionend', onHideEnd);
    panel.style.transform = 'translateY(100%)';
  }

  // シート全体（つまみ＋中身）でドラッグを受ける。中身のスクロールとの両立は
  // onMove で意図（mode）を判定して切り替える（Googleマップ風）。
  function onDown(e) {
    if (!isMobile()) return;
    dragging = true;
    mode = null;
    startPointerY = e.clientY;
    startY = currentY;
    vY = 0; lastT = performance.now(); lastPY = e.clientY;
    downOnGrip = !!(grip && (e.target === grip || grip.contains(e.target)));
    // transition はドラッグ確定時に切る（タップを壊さないため、ここでは触らない）
  }
  function onMove(e) {
    if (!dragging) return;
    const total = e.clientY - startPointerY; // 下方向+ / 上方向-
    if (mode === null) {
      if (Math.abs(total) < 6) return;       // 閾値未満はタップ判定を残す
      computeSnaps();
      if (!atFull() || downOnGrip) {
        // full 未満、またはつまみ操作 → 常にシートを上下
        mode = 'sheet';
      } else {
        // full のとき：中身が最上部で下げようとした → シートを下げる
        // それ以外（上スクロール／途中位置）は中身のネイティブスクロールに任せる
        const content = document.getElementById('panel-content');
        if (total > 0 && content && content.scrollTop <= 0) mode = 'sheet';
        else { mode = 'scroll'; dragging = false; return; }
      }
      panel.style.transition = 'none';
      try { if (panel.setPointerCapture) panel.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }
    if (mode !== 'sheet') return;
    computeSnaps();
    // 速度を更新（上げ方向を+）。フリック判定に使う。
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) { vY = -(e.clientY - lastPY) / dt; lastT = now; lastPY = e.clientY; }
    let y = startY - total;                   // 指を上に動かすと高くなる
    y = Math.max(snaps.peek, Math.min(snaps.full, y));
    setY(y);
    if (e.cancelable) e.preventDefault();
  }
  function onUp() {
    if (!dragging) { mode = null; return; }
    dragging = false;
    if (mode === 'sheet') {
      panel.style.transition = '';
      const moved = currentY - startY;        // + は上げ方向
      const dir = (vY !== 0 ? (vY > 0 ? 1 : -1) : (moved > 0 ? 1 : -1));
      let target = nearest(currentY);         // 基本は今の位置に一番近い段
      // 少しでも動かした／フリックしたら、開始段から方向へ1段は進める
      if (Math.abs(vY) > FLICK_V || Math.abs(moved) >= COMMIT) {
        const stepped = stepFrom(startY, dir);
        target = dir > 0 ? Math.max(target, stepped) : Math.min(target, stepped);
      }
      setY(target);
    }
    updateAtFull();
    mode = null;
    vY = 0;
  }

  function init() {
    panel = document.getElementById('panel');
    grip = document.getElementById('sheet-grip');
    computeSnaps();
    setY(snaps.peek); // 最初は小さく（地図を広く見せる）
    panel.addEventListener('pointerdown', onDown); // つまみ＋中身のどちらからでもドラッグ
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', () => { computeSnaps(); setY(nearest(currentY)); updateAtFull(); });
  }

  return { init, snapTo, hide, collapse };
})();
