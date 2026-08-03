window.App = window.App || {};
App.records = (function () {
  let all = [];                 // 全記録（メモリ上のキャッシュ）
  let filterState = { mode: 'all', day: null, from: null, to: null, genres: new Set() };
  let activeTag = null;         // ハッシュタグ検索中のタグ（#なし・小文字）。null=絞り込みなし
  let routeEditMode = false;    // ルートシートで並べ替え編集中か
  let searchResults = null;     // 場所名検索の複数該当リスト。null=検索結果モードでない
  let searchQuery = '';         // 検索結果の見出し用
  const panel = () => document.getElementById('panel-content');

  function setRecords(records) { all = records; render(); } // 購読から最新を受け取る
  async function reload() { render(); }                      // 互換用（購読が供給）
  function setFilterState(state) { searchResults = null; filterState = state; render(); }
  function getAll() { return all; }

  // 文字列 → タグ配列（空白/カンマ/読点区切り、先頭の#は除去、重複除去）
  function parseTags(str) {
    const tags = (str || '').split(/[\s,、　]+/)
      .map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
    return [...new Set(tags)];
  }
  // タグ配列 → 入力欄用の文字列（#付き・スペース区切り）
  function tagsToInput(tags) {
    return (tags || []).map((t) => '#' + t).join(' ');
  }

  // ルートの並び順（order 昇順、無ければ登録順=id）
  function byOrder(a, b) {
    const oa = (a.order == null) ? 1e9 : a.order;
    const ob = (b.order == null) ? 1e9 : b.order;
    if (oa !== ob) return oa - ob;
    return (a.id || 0) - (b.id || 0);
  }

  // 同じ場所（座標）の識別キー
  function coordKey(r) { return r.lat.toFixed(6) + ',' + r.lng.toFixed(6); }
  // その座標の全記録（訪問）を日付順で返す
  function visitsAt(lat, lng) {
    const key = lat.toFixed(6) + ',' + lng.toFixed(6);
    return all.filter((r) => coordKey(r) === key)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  // 'YYYY-MM-DD' → 'YYYY.M.D'
  function formatVisitDate(dateStr) {
    const d = dateStr.split('-');
    return `${d[0]}.${Number(d[1])}.${Number(d[2])}`;
  }

  function countsByCoord() {
    const counts = {};
    all.forEach((r) => { const k = coordKey(r); counts[k] = (counts[k] || 0) + 1; });
    return counts;
  }

  function render() {
    // 検索結果モード：場所ごとにまとめた代表ピンだけ表示＋候補リスト
    if (searchResults) {
      const counts = countsByCoord();
      const reps = searchResults.map((g) => g.rep);
      App.map.renderPins(reps, showDetail, { countAt: (r) => counts[coordKey(r)] || 1 });
      showSearchResults();
      return;
    }
    let visible = App.filters.apply(all, filterState);
    if (activeTag) {
      visible = visible.filter((r) =>
        (r.tags || []).some((t) => t.toLowerCase() === activeTag));
    }
    const dayMode = filterState.mode === 'day' && !!filterState.day; // 1日＝1デート
    if (dayMode) visible = visible.slice().sort(byOrder);
    const counts = countsByCoord();
    App.map.renderPins(visible, showDetail, {
      numbered: dayMode,
      countAt: (r) => counts[coordKey(r)] || 1,
    });
    // 1日を選んでいる間は、サイドパネルにルート（順番編集）を表示
    if (dayMode) showDayRoute(visible);
    else if (document.getElementById('day-route') || document.getElementById('search-results')) clearPanel();
  }

  // その場所（座標）にある写真を1枚返す（サムネイル用）
  function firstPhotoAt(lat, lng) {
    const v = visitsAt(lat, lng).find((x) => (x.photos || []).length);
    return v ? v.photos[0] : null;
  }

  // 場所名で検索。同じ場所（座標）はまとめる。
  // 0=なし / 1=その場所へ移動して詳細 / 2以上=候補ピン＋リスト表示
  function searchByName(q) {
    activeTag = null;
    const matches = all.filter((r) => r.name && r.name.includes(q));
    if (matches.length === 0) { searchResults = null; return 0; }
    const counts = countsByCoord();
    const seen = {};
    const groups = [];
    // 新しい訪問を代表にするため日付の新しい順に見る
    matches.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .forEach((r) => {
        const k = coordKey(r);
        if (seen[k]) return;
        seen[k] = true;
        groups.push({ rep: r, count: counts[k] || 1, photo: firstPhotoAt(r.lat, r.lng) });
      });

    if (groups.length === 1) {
      searchResults = null;
      const rep = groups[0].rep;
      App.map.flyTo(rep.lat, rep.lng);
      showDetail(rep); // 詳細に「この場所に◯回訪問」が出る
      return 1;
    }
    searchResults = groups;
    searchQuery = q;
    render();                                  // 代表ピン＋リスト
    App.map.fitTo(groups.map((g) => g.rep));   // 全候補が見えるように
    if (App.sheet) App.sheet.snapTo('half');
    return groups.length;
  }

  function clearSearch() {
    searchResults = null;
    activeTag = null;
    clearPanel(); // 詳細や候補リストが出ていても、まっさらな初期表示へ
    render();
    if (App.sheet) App.sheet.snapTo('peek'); // 下シートも下げる
  }

  // 検索候補リスト（下シート・場所ごとにまとめ、回数を表示）
  function showSearchResults() {
    const groups = searchResults || [];
    const rows = groups.map((g) => {
      const r = g.rep;
      const thumb = g.photo
        ? `<span class="result-thumb" style="background-image:url(${g.photo.url})"></span>`
        : `<span class="result-thumb" style="background:${App.genres.color(r.genre)}"></span>`;
      const sub = g.count > 1
        ? `${App.genres.label(r.genre)} ・ ${g.count}回訪問`
        : `${App.genres.label(r.genre)} ・ ${r.date}`;
      return `<li><button type="button" class="result-row" data-id="${r.id}">
        ${thumb}
        <span class="result-text">
          <span class="result-name">${r.name || '(名称未設定)'}</span>
          <span class="result-sub">${sub}</span>
        </span>
        <i class="ph ph-caret-right result-caret"></i>
      </button></li>`;
    }).join('');
    const q = (searchQuery || '').replace(/</g, '&lt;');
    panel().innerHTML = `<div id="search-results">
      <div class="dr-head"><h2>「${q}」の検索結果 <span class="result-count">${groups.length}件</span></h2></div>
      <ul class="result-list">${rows}</ul>
    </div>`;
    panel().querySelectorAll('.result-row').forEach((b) => {
      b.onclick = () => {
        const rec = all.find((x) => String(x.id) === b.dataset.id);
        if (rec) { App.map.flyTo(rec.lat, rec.lng); showDetail(rec); }
      };
    });
  }

  // その日の流れ（Googleマップ風の下シート）。編集ボタンで並べ替えモードに
  function showDayRoute(list) {
    if (!list.length) {
      panel().innerHTML = '<div id="day-route"><p class="hint">この日の記録はありません</p></div>';
      return;
    }
    const edit = routeEditMode;
    const d = list[0].date.split('-'); // [YYYY, MM, DD]
    const title = `${Number(d[1])}月${Number(d[2])}日のルート`;
    const rows = list.map((r, i) => {
      const move = edit ? `
        <span class="route-move">
          <button type="button" class="route-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}><i class="ph ph-caret-up"></i></button>
          <button type="button" class="route-down" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''}><i class="ph ph-caret-down"></i></button>
        </span>` : '';
      return `<li class="flow-row">
        <span class="flow-no">${i + 1}</span>
        <button type="button" class="route-name" data-id="${r.id}">
          <span class="flow-name">${r.name || '(名称未設定)'}</span>
          <span class="flow-genre">${App.genres.label(r.genre)}</span>
        </button>
        ${move}
      </li>`;
    }).join('');
    panel().innerHTML = `<div id="day-route">
      <div class="dr-head">
        <h2>${title}</h2>
        <button type="button" id="route-edit-btn" class="${edit ? 'editing' : ''}">${edit ? '<i class="ph ph-check"></i>完了' : '<i class="ph ph-pencil-simple"></i>編集'}</button>
      </div>
      <ol class="route-flow">${rows}</ol>
      ${edit ? '<p class="hint">▲▼で順番を変えられます</p>' : ''}
    </div>`;

    document.getElementById('route-edit-btn').onclick = () => {
      routeEditMode = !routeEditMode;
      showDayRoute(list);
    };
    panel().querySelectorAll('.route-name').forEach((b) => {
      b.onclick = () => {
        const rec = all.find((x) => String(x.id) === b.dataset.id);
        if (rec) { App.map.flyTo(rec.lat, rec.lng); showDetail(rec); } // その場所へ飛ぶ
      };
    });
    panel().querySelectorAll('.route-up').forEach((b) => {
      b.onclick = () => moveSpot(list, Number(b.dataset.i), -1);
    });
    panel().querySelectorAll('.route-down').forEach((b) => {
      b.onclick = () => moveSpot(list, Number(b.dataset.i), +1);
    });
  }

  // i番目のスポットを dir(-1/+1) 方向へ移動し、順番を 0..n-1 で振り直して保存
  async function moveSpot(list, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const arr = list.slice();
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    for (let k = 0; k < arr.length; k += 1) {
      if (arr[k].order !== k) { arr[k].order = k; await App.cloud.put(arr[k]); }
    }
    // 購読が最新を供給して自動で再描画される
  }

  // ハッシュタグで絞り込む（tag は # あり/なしどちらでも可）。一致件数を返す
  function searchTag(tag) {
    searchResults = null;
    activeTag = tag ? tag.replace(/^#+/, '').trim().toLowerCase() : null;
    render();
    if (!activeTag) return -1;
    return all.filter((r) => (r.tags || []).some((t) => t.toLowerCase() === activeTag)).length;
  }
  function clearTag() { activeTag = null; render(); }

  // 詳細パネルのタグをクリック → 検索欄に反映して絞り込み
  function runTagSearch(tag) {
    const box = document.getElementById('search-box');
    if (box) box.value = '#' + tag;
    searchTag(tag);
  }

  function genreOptions(selected) {
    return App.genres.list.map((g) =>
      `<option value="${g.key}" ${g.key === selected ? 'selected' : ''}>${g.label}</option>`
    ).join('');
  }

  // 「場所を検索して追加」：下シートに検索フォームを出す（Aの入口）
  function showPlaceSearch() {
    searchResults = null;
    App.map.clearTempMarker();
    panel().innerHTML = `
      <button type="button" id="ps-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      <h2>場所を検索して追加</h2>
      <form id="ps-form" class="ps-form">
        <input type="text" id="ps-input" placeholder="店名・地名（例：渋谷 スターバックス）" autocomplete="off">
        <button type="submit" id="ps-go" title="検索"><i class="ph ph-magnifying-glass"></i></button>
      </form>
      <div id="ps-results"><p class="hint">場所名を入力して検索してください</p></div>`;
    if (App.sheet) App.sheet.snapTo('half');
    document.getElementById('ps-back').onclick = clearPanel;
    const form = document.getElementById('ps-form');
    const input = document.getElementById('ps-input');
    const results = document.getElementById('ps-results');
    const goBtn = document.getElementById('ps-go');
    input.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      goBtn.disabled = true;
      results.innerHTML = '<p class="hint">検索中…</p>';
      try {
        const list = await App.geocode.search(q, { viewbox: App.map.getViewbox() });
        renderPlaceResults(list);
      } catch (err) {
        results.innerHTML = '<p class="hint">検索に失敗しました。通信環境を確認してください。</p>';
      } finally {
        goBtn.disabled = false;
      }
    };
  }

  // 検索候補（最大5件）を下シートに描画。タップで追加フォームへ。
  function renderPlaceResults(list) {
    const results = document.getElementById('ps-results');
    if (!results) return;
    if (!list.length) {
      results.innerHTML = '<p class="hint">見つかりませんでした。別のキーワードでお試しください。</p>';
      return;
    }
    const esc = (s) => (s || '').replace(/</g, '&lt;');
    results.innerHTML = `<ul class="result-list">${list.map((p, i) => `
      <li><button type="button" class="result-row ps-pick" data-i="${i}">
        <span class="result-thumb icon"><i class="ph ph-map-pin"></i></span>
        <span class="result-text">
          <span class="result-name">${esc(p.name)}</span>
          <span class="result-sub">${esc(p.address)}</span>
        </span>
        <i class="ph ph-caret-right result-caret"></i>
      </button></li>`).join('')}</ul>`;
    results.querySelectorAll('.ps-pick').forEach((b) => {
      b.onclick = () => {
        const p = list[Number(b.dataset.i)];
        App.map.flyTo(p.lat, p.lng);
        showAddForm(p.lat, p.lng, { name: p.name });
      };
    });
  }

  // 追加フォーム表示（地図クリック時／同じ場所への再訪時）
  // prefill: { name, genre } を渡すと場所名・ジャンルを引き継ぐ（日付は今日・メモ/写真は空）
  function showAddForm(lat, lng, prefill) {
    searchResults = null; // 追加を始めたら検索結果モードは終了
    prefill = prefill || {};
    const today = new Date().toISOString().slice(0, 10);
    const nameVal = (prefill.name || '').replace(/"/g, '&quot;');
    panel().innerHTML = `
      <h2>記録を追加</h2>
      <form id="rec-form">
        <label>日付<input type="date" name="date" value="${today}" required></label>
        <label>場所名<input type="text" name="name" value="${nameVal}" placeholder="お店・施設の名前" required></label>
        <label>ジャンル<select name="genre">${genreOptions(prefill.genre || 'food')}</select></label>
        <label>メモ・感想<textarea name="memo" rows="4"></textarea></label>
        <label>ハッシュタグ<input type="text" name="tags" placeholder="#カフェ #記念日"></label>
        <label>写真<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="form-actions">
          <button type="submit">保存</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;
    App.map.showTempMarker(lat, lng); // 追加地点の目印を表示
    if (App.sheet) App.sheet.snapTo('half'); // シートを開く
    document.getElementById('cancel-btn').onclick = clearPanel;
    document.getElementById('rec-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const files = Array.from(f.photos.files);
      const order = all.filter((r) => r.date === f.date.value).length; // その日の末尾に追加
      const submitBtn = f.querySelector('button[type=submit]');
      submitBtn.disabled = true; submitBtn.textContent = '保存中…';
      try {
        const photos = await App.photos.toStoredMany(files); // 圧縮 → {url}[]
        await App.cloud.add({
          date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order, lat, lng, photos,
        });
        clearPanel(); // 保存後は購読が自動反映
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
        submitBtn.disabled = false; submitBtn.textContent = '保存';
      }
    };
  }

  function clearPanel() {
    App.map.clearTempMarker(); // 追加地点の目印を消す
    routeEditMode = false;     // ルート編集モードを解除
    panel().innerHTML = '<p class="hint">地図をクリックして記録を追加</p>';
  }

  // 詳細から戻る：検索結果／ルート／初期表示 のいずれかへ
  function goBack() {
    if (searchResults) { showSearchResults(); return; } // 候補リストへ
    const dayMode = filterState.mode === 'day' && !!filterState.day;
    if (dayMode) render(); // showDayRoute が呼ばれてルート一覧に戻る
    else clearPanel();
  }

  function showDetail(record) {
    App.map.clearTempMarker(); // 追加中の目印が残っていれば消す
    if (App.sheet) App.sheet.snapTo('half'); // シートを開く
    const photosHtml = (record.photos || []).map((p, i) =>
      `<img class="thumb" src="${p.url}" alt="" data-i="${i}">`).join('');
    const visits = visitsAt(record.lat, record.lng);
    const visitsHtml = visits.length > 1 ? `
      <div class="visits">
        <div class="visits-head"><i class="ph ph-repeat"></i>この場所に ${visits.length} 回 訪問</div>
        <div class="visit-list">${visits.map((v) =>
          `<button type="button" class="visit-chip ${v.id === record.id ? 'current' : ''}" data-id="${v.id}">${formatVisitDate(v.date)}</button>`
        ).join('')}</div>
      </div>` : '';
    panel().innerHTML = `
      <button type="button" id="detail-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      <h2>${record.name}</h2>
      <p class="meta">${App.genres.label(record.genre)} ・ ${record.date}</p>
      ${visitsHtml}
      <div class="photos">${photosHtml || '<span class="hint">写真なし</span>'}</div>
      <p class="memo">${(record.memo || '').replace(/\n/g, '<br>') || '<span class="hint">メモなし</span>'}</p>
      <div class="tags">${(record.tags || []).map((t) =>
        `<button type="button" class="tag-chip" data-tag="${t}">#${t}</button>`).join('')
        || '<span class="hint">タグなし</span>'}</div>
      <button type="button" id="revisit-btn" class="revisit-btn"><i class="ph ph-plus"></i>同じ場所にもう一度記録</button>
      <div class="form-actions">
        <button type="button" id="edit-btn"><i class="ph ph-pencil-simple"></i>編集</button>
        <button type="button" id="del-btn"><i class="ph ph-trash"></i>削除</button>
      </div>`;
    document.getElementById('detail-back').onclick = goBack;
    document.getElementById('revisit-btn').onclick = () =>
      showAddForm(record.lat, record.lng, { name: record.name, genre: record.genre });
    panel().querySelectorAll('.visit-chip').forEach((b) => {
      b.onclick = () => {
        const rec = all.find((x) => String(x.id) === b.dataset.id);
        if (rec) showDetail(rec);
      };
    });
    panel().querySelectorAll('.photos .thumb[data-i]').forEach((img) => {
      img.onclick = () => App.lightbox.open((record.photos || []).map((p) => p.url), Number(img.dataset.i));
    });
    panel().querySelectorAll('.tag-chip').forEach((btn) => {
      btn.onclick = () => runTagSearch(btn.dataset.tag);
    });
    document.getElementById('edit-btn').onclick = () => showEditForm(record);
    document.getElementById('del-btn').onclick = async () => {
      if (!confirm(`「${record.name}」を削除しますか？`)) return;
      await App.cloud.remove(record.id);
      clearPanel(); // 購読が自動反映
    };
  }

  function showEditForm(record) {
    const keep = (record.photos || []).slice(); // 残す既存写真（×で減らす）
    panel().innerHTML = `
      <h2>記録を編集</h2>
      <form id="edit-form">
        <label>日付<input type="date" name="date" value="${record.date}" required></label>
        <label>場所名<input type="text" name="name" value="${record.name}" required></label>
        <label>ジャンル<select name="genre">${genreOptions(record.genre)}</select></label>
        <label>メモ・感想<textarea name="memo" rows="4">${record.memo || ''}</textarea></label>
        <label>ハッシュタグ<input type="text" name="tags" value="${tagsToInput(record.tags)}" placeholder="#カフェ #記念日"></label>
        <label>今の写真（×で削除）</label>
        <div id="existing-photos" class="photos"></div>
        <label>写真を追加<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="form-actions">
          <button type="submit">更新</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;

    const box = document.getElementById('existing-photos');
    function renderExisting() {
      if (keep.length === 0) { box.innerHTML = '<span class="hint">写真なし</span>'; return; }
      box.innerHTML = keep.map((p, i) =>
        `<div class="photo-edit"><img class="thumb" src="${p.url}" alt="">
          <button type="button" class="photo-del" data-i="${i}"><i class="ph ph-x"></i></button></div>`).join('');
      box.querySelectorAll('.photo-del').forEach((btn) => {
        btn.onclick = () => { keep.splice(Number(btn.dataset.i), 1); renderExisting(); };
      });
    }
    renderExisting();

    document.getElementById('cancel-btn').onclick = () => showDetail(record);
    document.getElementById('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '更新中…';
      try {
        const newFiles = Array.from(f.photos.files);
        const uploaded = newFiles.length ? await App.photos.toStoredMany(newFiles) : [];
        const updated = {
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: record.lat, lng: record.lng,
          photos: keep.concat(uploaded), // 残した既存写真＋追加分
        };
        await App.cloud.put(updated);
        showDetail(updated);
      } catch (err) {
        alert('更新に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '更新';
      }
    };
  }

  function buildGenreFilters() {
    const box = document.getElementById('genre-filters');
    box.innerHTML = App.genres.list.map((g) =>
      `<label class="gf"><input type="checkbox" value="${g.key}" checked>
        <span style="color:${g.color}">●</span>${g.label}</label>`
    ).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', applyUiFilter));
  }

  function readFilterState() {
    const mode = document.getElementById('mode-select').value;
    const checked = Array.from(
      document.querySelectorAll('#genre-filters input:checked')).map((c) => c.value);
    // 全ジャンルON = 空Set（＝全表示）として扱う
    const genres = checked.length === App.genres.list.length ? new Set() : new Set(checked);
    return {
      mode,
      day: document.getElementById('day-input').value || null,
      from: document.getElementById('from-input').value || null,
      to: document.getElementById('to-input').value || null,
      genres,
    };
  }

  function applyUiFilter() {
    // mode に応じて日付入力の表示切替
    const mode = document.getElementById('mode-select').value;
    document.getElementById('day-input').hidden = mode !== 'day';
    document.getElementById('range-inputs').hidden = mode !== 'range';
    setFilterState(readFilterState());
  }

  // カレンダーで日付を選んだとき：その日で絞り込み、最初の記録へ移動
  function focusDay(dateStr) {
    routeEditMode = false; // 新しい日を開くときは閲覧モードから
    document.getElementById('mode-select').value = 'day';
    document.getElementById('day-input').value = dateStr;
    applyUiFilter();
    if (App.sheet) App.sheet.snapTo('half'); // ルートのシートを開く
    const rec = all.find((r) => r.date === dateStr);
    if (rec) App.map.flyTo(rec.lat, rec.lng);
  }

  // 絞り込みを最初の状態（全部・全ジャンル）に戻し、検索も解除
  function resetFilters() {
    activeTag = null;
    searchResults = null;
    document.getElementById('mode-select').value = 'all';
    document.getElementById('day-input').value = '';
    document.getElementById('from-input').value = '';
    document.getElementById('to-input').value = '';
    document.querySelectorAll('#genre-filters input').forEach((cb) => { cb.checked = true; });
    const box = document.getElementById('search-box');
    if (box) box.value = '';
    clearPanel();
    applyUiFilter();
    if (App.sheet) App.sheet.snapTo('peek');
  }

  function init() {
    App.map.setClickHandler(showAddForm);
    buildGenreFilters();
    ['mode-select', 'day-input', 'from-input', 'to-input'].forEach((id) =>
      document.getElementById(id).addEventListener('change', applyUiFilter));
    document.getElementById('filter-clear').addEventListener('click', resetFilters);
    reload();
  }

  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showPlaceSearch, _clearPanel: clearPanel };
})();
