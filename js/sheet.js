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
  }

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

  function onDown(e) {
    if (!isMobile()) return;
    dragging = true;
    startPointerY = e.clientY;
    startY = currentY;
    panel.style.transition = 'none';
    if (grip.setPointerCapture) grip.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!dragging) return;
    computeSnaps();
    // 高さベース：指を上に動かすと（clientYが減る）高くなる
    let y = startY - (e.clientY - startPointerY);
    y = Math.max(snaps.peek, Math.min(snaps.full, y));
    setY(y);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    setY(nearest(currentY));
  }

  function init() {
    panel = document.getElementById('panel');
    grip = document.getElementById('sheet-grip');
    computeSnaps();
    setY(snaps.peek); // 最初は小さく（地図を広く見せる）
    grip.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', () => { computeSnaps(); setY(nearest(currentY)); });
  }

  return { init, snapTo, hide };
})();
