window.App = window.App || {};
// スマホの下シートを上下にドラッグ／スナップさせる（Googleマップ風）
App.sheet = (function () {
  let panel, grip;
  let snaps = { full: 0, half: 0, peek: 0 };
  let currentY = 0;
  let dragging = false;
  let startPointerY = 0;
  let startY = 0;

  const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

  function computeSnaps() {
    const vh = window.innerHeight;
    // translateY(px)。小さいほどシートが上（大きく開く）
    snaps = {
      full: Math.round(vh * 0.08),
      half: Math.round(vh * 0.45),
      peek: Math.round(vh * 0.78),
    };
  }
  function setY(y) {
    currentY = y;
    panel.style.setProperty('--sheet-y', y + 'px');
  }
  function nearest(y) {
    return [snaps.full, snaps.half, snaps.peek]
      .reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  }

  function snapTo(name) {
    if (!panel) return;
    computeSnaps();
    panel.style.transition = '';
    setY(snaps[name] != null ? snaps[name] : snaps.half);
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
    let y = startY + (e.clientY - startPointerY);
    y = Math.max(snaps.full, Math.min(snaps.peek, y));
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

  return { init, snapTo };
})();
