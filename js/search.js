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

  // 連打を間引く（.cancel() で保留中の発火を打ち切れる）
  function debounce(fn, ms) {
    let t = null;
    const wrapped = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
    wrapped.cancel = function () { clearTimeout(t); t = null; };
    return wrapped;
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

  let box, wrap, dropdown, researchBtn;
  let sessionToken = null;   // 1検索セッションのトークン
  let seq = 0;               // 場所検索の応答レース対策
  let lastPlaceQuery = null;   // 「このエリアを再検索」で使う直前の検索語

  const MIN_PLACE_LEN = 2;   // 場所APIは2文字以上
  const REC_LIMIT = 8;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function open() { dropdown.hidden = false; dropdown.classList.add('open'); }
  function close() { dropdown.classList.remove('open'); dropdown.hidden = true; }

  function showResearch() { if (researchBtn) researchBtn.hidden = false; }
  function hideResearch() { if (researchBtn) researchBtn.hidden = true; }

  // 記録候補＋場所候補を1リストに描画（記録が上）
  function render(recs, places, opts) {
    opts = opts || {};
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
      if (opts.loadingPlaces) html = '<div class="ss-empty">検索中…</div>';   // 点滅防止：閉じずに待つ
      else if (opts.placesError) html = '<div class="ss-empty">場所候補を取得できませんでした</div>';
      else html = '<div class="ss-empty">該当なし</div>';
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
      App.map.clearPlaceResults();           // 記録を選んだら場所ピンは消す
      lastPlaceQuery = null; hideResearch();
      const rec = App.records.getAll().find((x) => String(x.id) === btn.dataset.id);
      if (rec) { App.map.flyTo(rec.lat, rec.lng); App.records.showDetail(rec); }
    } else if (kind === 'place') {
      lastPlaceQuery = null; hideResearch(); // 単一の場所を選んだら「このエリアを再検索」は出さない
      App.records.showPlaceCard(btn.dataset.id, { fly: true, pin: true }); // 単一ピン付き
      sessionToken = null;
    }
  }

  // 通常語の候補更新（記録＝即時、場所＝非同期）
  async function updateSuggestions(q) {
    const mySeq = ++seq;                 // どの入力変化でも進める（保留中の非同期応答を無効化）
    const recs = App.records.suggestRecords(q, REC_LIMIT);
    if (q.length < MIN_PLACE_LEN) { render(recs, [], {}); return; }
    render(recs, [], { loadingPlaces: true });
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

  // Enter：テキスト検索を実行し、結果をマップにピン表示（0件は記録名検索へ）
  async function runPlaceSearch(q, opts) {
    opts = opts || {};
    const mySeq = ++seq;                 // 連続 Enter のレース対策（古い応答を無効化）
    hideResearch();
    App.records.clearSearch();           // 記録検索リスト・シート・場所ピンを一旦リセット
    let results = [];
    try {
      results = await App.places.searchText(q, { bias: App.map.getBounds() });
    } catch (e) { console.error('place text search failed', e); results = []; }
    if (mySeq !== seq) return;           // 途中で新しい検索が始まっていたら破棄
    if (!results.length) {
      lastPlaceQuery = null;
      const n = App.records.searchByName(q);
      if (n === 0) alert('該当する場所・記録が見つかりませんでした');
      return;
    }
    lastPlaceQuery = q;                   // このエリアを再検索用に保持
    // 検索中は記録の写真ピンを隠す（検索結果と同じ場所の記録ピンは残す）
    App.map.renderPlaceResults(results, (id) => App.records.showPlaceCard(id, { fly: true }), { hideRecords: true });
    if (opts.fit !== false) App.map.fitTo(results); // 「このエリアを再検索」では地図を動かさない（現在の範囲を保つ）
  }

  const onInput = debounce(function () {
    const c = classifyQuery(box.value);
    if (c.kind === 'empty') { seq++; close(); App.records.clearSearch(); lastPlaceQuery = null; hideResearch(); return; }
    if (c.kind === 'tag') { seq++; close(); return; }
    updateSuggestions(c.q);
  }, 250);

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); box.blur(); return; }
    if (e.key !== 'Enter') return;
    box.blur(); // Enter でソフトキーボードを下げる
    onInput.cancel(); // 保留中のオートコンプリート（デバウンス）を打ち切り、検索結果を横取りさせない
    const c = classifyQuery(box.value);
    if (c.kind === 'tag') {
      const count = App.records.searchTag(c.q);
      if (count === 0) alert('そのハッシュタグの記録は見つかりませんでした');
      close();
      return;
    }
    if (c.kind === 'empty') { seq++; App.records.clearSearch(); close(); lastPlaceQuery = null; hideResearch(); return; }
    close();
    runPlaceSearch(c.q); // 内部で seq を進めてレース対策

  }

  function onDocPointer(e) {
    if (!wrap.contains(e.target)) close();
  }

  function init() {
    box = document.getElementById('search-box');
    wrap = document.getElementById('search-wrap');
    dropdown = document.getElementById('search-suggest');
    researchBtn = document.getElementById('research-btn');
    if (!box || !wrap || !dropdown) return;
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKeydown);
    document.addEventListener('pointerdown', onDocPointer);
    if (researchBtn) researchBtn.addEventListener('click', () => {
      hideResearch();
      if (lastPlaceQuery) runPlaceSearch(lastPlaceQuery, { fit: false }); // 現在の表示範囲のまま再検索
    });
    if (App.map.setUserPanHandler) App.map.setUserPanHandler(() => { if (lastPlaceQuery) showResearch(); });
    // セッショントークンは遅延生成し、場所選択時にのみ破棄（focus 毎に作り直すと課金セッションが分断される）
  }

  return { init, classifyQuery, debounce, render, updateSuggestions, runPlaceSearch, _selfTest };
})();
