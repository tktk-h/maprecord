window.App = window.App || {};
App.lightbox = (function () {
  let urls = [];      // 表示中の写真のobject URL
  let idx = 0;
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'lightbox';
    overlay.hidden = true;
    overlay.innerHTML =
      '<button class="lb-close" aria-label="閉じる"><i class="ph ph-x"></i></button>'
      + '<button class="lb-prev" aria-label="前へ"><i class="ph ph-caret-left"></i></button>'
      + '<img class="lb-img" alt="">'
      + '<button class="lb-next" aria-label="次へ"><i class="ph ph-caret-right"></i></button>'
      + '<div class="lb-counter"></div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.lb-close').onclick = close;
    overlay.querySelector('.lb-prev').onclick = (e) => { e.stopPropagation(); prev(); };
    overlay.querySelector('.lb-next').onclick = (e) => { e.stopPropagation(); next(); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); }; // 背景タップで閉じる

    // スワイプ（左右）
    let startX = null;
    overlay.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (dx > 40) prev();
      else if (dx < -40) next();
      startX = null;
    });
    return overlay;
  }

  function keyHandler(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  }

  function show() {
    const o = ensureOverlay();
    o.querySelector('.lb-img').src = urls[idx];
    o.querySelector('.lb-counter').textContent = `${idx + 1} / ${urls.length}`;
    const multi = urls.length > 1;
    o.querySelector('.lb-prev').style.display = multi ? '' : 'none';
    o.querySelector('.lb-next').style.display = multi ? '' : 'none';
  }
  function next() { if (urls.length) { idx = (idx + 1) % urls.length; show(); } }
  function prev() { if (urls.length) { idx = (idx - 1 + urls.length) % urls.length; show(); } }

  function open(urlList, startIndex) {
    close(); // 前回ぶんを掃除
    urls = (urlList || []).slice(); // url 文字列の配列
    if (!urls.length) return;
    idx = Math.min(Math.max(startIndex || 0, 0), urls.length - 1);
    ensureOverlay().hidden = false;
    document.addEventListener('keydown', keyHandler);
    show();
  }
  function close() {
    if (overlay) overlay.hidden = true;
    document.removeEventListener('keydown', keyHandler);
    urls = [];
  }

  return { open, close };
})();
