window.App = window.App || {};
// 検索ボックスのライブ候補（Google マップ風）。記録＋場所を一つのドロップダウンに。
App.search = (function () {
  // 入力語の種類を判定
  function classifyQuery(raw) {
    const q = (raw || '').trim();
    if (!q) return { kind: 'empty', q: '' };
    if (q[0] === '#') return { kind: 'tag', q };
    return { kind: 'text', q };
  }

  // 連打を間引く
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function _selfTest() {
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    eq('classify-empty', classifyQuery('   ').kind, 'empty');
    eq('classify-tag', classifyQuery('#デート').kind, 'tag');
    eq('classify-text', classifyQuery('スカイツリー').kind, 'text');
    eq('classify-trim', classifyQuery('  渋谷 ').q, '渋谷');
    let calls = 0;
    const d = debounce(() => { calls++; }, 20);
    d(); d(); d();
    setTimeout(() => eq('debounce-once', calls, 1), 60);
  }

  let box, wrap, dropdown;
  let sessionToken = null;   // 1検索セッションのトークン
  let seq = 0;               // 場所検索の応答レース対策
  let lastPlaces = [];       // 直近の場所候補
  let lastRecords = [];      // 直近の記録候補

  const MIN_PLACE_LEN = 2;   // 場所APIは2文字以上
  const REC_LIMIT = 8;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function open() { dropdown.hidden = false; dropdown.classList.add('open'); }
  function close() { dropdown.classList.remove('open'); dropdown.hidden = true; }

  // 記録候補＋場所候補を1リストに描画（記録が上）
  function render(recs, places, opts) {
    opts = opts || {};
    lastRecords = recs || [];
    lastPlaces = places || [];
    const recRows = (recs || []).map((g) => {
      const r = g.rep;
      const thumb = g.photo
        ? `<span class="ss-thumb" style="background-image:url(${g.photo.url})"></span>`
        : `<span class="ss-thumb" style="background:${App.genres.color(r.genre)}"></span>`;
      const sub = g.count > 1
        ? `${App.genres.label(r.genre)} ・ ${g.count}回訪問`
        : `${App.genres.label(r.genre)} ・ ${r.date}`;
      return `<button type="button" class="ss-row" data-kind="rec" data-id="${r.id}">
        ${thumb}
        <span class="ss-text"><span class="ss-main">${esc(r.name) || '(名称未設定)'}</span>
        <span class="ss-sub">${esc(sub)}</span></span>
        <i class="ph ph-star ss-saved" aria-hidden="true"></i></button>`;
    }).join('');
    const placeRows = (places || []).map((p) => `
      <button type="button" class="ss-row" data-kind="place" data-id="${esc(p.placeId)}">
        <span class="ss-icon"><i class="ph ph-map-pin" aria-hidden="true"></i></span>
        <span class="ss-text"><span class="ss-main">${esc(p.mainText)}</span>
        <span class="ss-sub">${esc(p.secondaryText)}</span></span></button>`).join('');
    let html = recRows + placeRows;
    if (!html) {
      html = opts.loadingPlaces
        ? ''
        : '<div class="ss-empty">該当なし</div>';
      if (opts.placesError && recRows === '') html = '<div class="ss-empty">場所候補を取得できませんでした</div>';
    } else if (opts.placesError) {
      html += '<div class="ss-note">場所候補を取得できませんでした</div>';
    }
    dropdown.innerHTML = html;
    if (html) open(); else close();
    wireRows();
  }

  function wireRows() {
    dropdown.querySelectorAll('.ss-row').forEach((btn) => {
      btn.onclick = () => activateRow(btn);
    });
  }

  function activateRow(btn) {
    const kind = btn.dataset.kind;
    close();
    if (kind === 'rec') {
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
      App.records.showPlaceCard(btn.dataset.id, { fly: true });
      sessionToken = null;
    }
  }

  // 通常語の候補更新（記録＝即時、場所＝非同期）
  async function updateSuggestions(q) {
    const recs = App.records.suggestRecords(q, REC_LIMIT);
    if (q.length < MIN_PLACE_LEN) { render(recs, [], {}); return; }
    render(recs, [], { loadingPlaces: true });
    const mySeq = ++seq;
    try {
      if (!sessionToken) sessionToken = await App.places.newSessionToken();
      const bias = App.map.getBounds();
      const places = await App.places.searchPlaces(q, { bias, token: sessionToken });
      if (mySeq !== seq) return;
      render(recs, places, {});
    } catch (e) {
      if (mySeq !== seq) return;
      render(recs, [], { placesError: true });
    }
  }

  const onInput = debounce(function () {
    const c = classifyQuery(box.value);
    if (c.kind === 'empty') { close(); App.records.clearSearch(); return; }
    if (c.kind === 'tag') { close(); return; }
    updateSuggestions(c.q);
  }, 250);

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); box.blur(); return; }
    if (e.key !== 'Enter') return;
    const c = classifyQuery(box.value);
    if (c.kind === 'tag') {
      const count = App.records.searchTag(c.q);
      if (count === 0) alert('そのハッシュタグの記録は見つかりませんでした');
      close();
      return;
    }
    if (c.kind === 'empty') { App.records.clearSearch(); close(); return; }
    const first = dropdown.querySelector('.ss-row');
    if (first && !dropdown.hidden) { activateRow(first); return; }
    const n = App.records.searchByName(c.q);
    if (n === 0) alert('その名前の記録は見つかりませんでした');
    close();
  }

  function onDocPointer(e) {
    if (!wrap.contains(e.target)) close();
  }

  function init() {
    box = document.getElementById('search-box');
    wrap = document.getElementById('search-wrap');
    dropdown = document.getElementById('search-suggest');
    if (!box || !wrap || !dropdown) return;
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKeydown);
    box.addEventListener('focus', () => { sessionToken = null; });
    document.addEventListener('pointerdown', onDocPointer);
  }

  return { init, classifyQuery, debounce, render, updateSuggestions, _selfTest };
})();
