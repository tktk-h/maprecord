window.App = window.App || {};
App.records = (function () {
  let all = [];                 // 全記録（メモリ上のキャッシュ）
  let filterState = { mode: 'all', day: null, from: null, to: null, genres: new Set() };
  let activeTag = null;         // ハッシュタグ検索中のタグ（#なし・小文字）。null=絞り込みなし
  let routeEditMode = false;    // ルートシートで並べ替え編集中か
  let searchResults = null;     // 場所名検索の複数該当リスト。null=検索結果モードでない
  let searchQuery = '';         // 検索結果の見出し用
  let suppressPlaceUntil = 0;   // 地図タップで詳細を閉じた直後は店カードを出さない（ms）
  const panel = () => document.getElementById('panel-content');
  let rangeCal = null;          // 絞り込みの期間カレンダー（ふりかえりと共通の App.rangeCal）

  function setRecords(records) {
    all = records;
    if (rangeCal) rangeCal.refresh(); // 記録のある日の印と初期表示月を合わせる
    render();
  } // 購読から最新を受け取る
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
  // 表示・属性用エスケープ（ユーザー入力の名前/メモ/タグに < > & " が入っても壊れないように）
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    // 地図の読み込みと並行で記録を購読するので、地図ができる前にデータが届くことがある。
    // そのときは all に入れるだけにしておき、地図ができたあと app.js がもう一度ここを呼ぶ。
    if (!App.map.isReady()) return;
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
    // 絞り込みの期間が旅行そのものと一致していれば「旅行を見ている」状態
    const trip = (!dayMode && filterState.mode === 'range' && filterState.from && filterState.to)
      ? (App.trips.list || []).find((t) => t.start === filterState.from && t.end === filterState.to) || null
      : null;
    const counts = countsByCoord();
    App.map.renderPins(visible, showDetail, {
      numbered: dayMode,
      countAt: (r) => counts[coordKey(r)] || 1,
      cluster: !dayMode && App.map.clusterEnabled(), // 通常表示のみ束ねる（ルート表示は順番が要るので除外）
    });
    // 1日を選んでいる間は、サイドパネルにルート（順番編集）を表示
    if (dayMode) showDayRoute(visible);
    else if (trip) showTripRoute(trip, visible);
    else if (document.getElementById('day-route') || document.getElementById('search-results')) clearPanel();
  }

  // その場所（座標）にある写真を1枚返す（サムネイル用）
  function firstPhotoAt(lat, lng) {
    const v = visitsAt(lat, lng).find((x) => (x.photos || []).length);
    return v ? v.photos[0] : null;
  }

  // 名前一致を座標でまとめ、訪問回数を付けて返す（純粋・テスト可能）
  // records=全記録配列, q=検索語, limit=安全上限
  function matchRecords(records, q, limit) {
    if (!q) return [];
    const key = (r) => r.lat + ',' + r.lng;
    const counts = {};
    records.forEach((r) => { const k = key(r); counts[k] = (counts[k] || 0) + 1; });
    const seen = {};
    const out = [];
    records
      .filter((r) => r.name && r.name.includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 新しい順を代表に
      .forEach((r) => {
        const k = key(r);
        if (seen[k]) return;
        seen[k] = true;
        out.push({ rep: r, count: counts[k] || 1 });
      });
    return out.slice(0, limit || 8);
  }

  // ドロップダウン用：内部の全記録から候補を作る
  function suggestRecords(q, limit) {
    return matchRecords(all, q, limit).map((g) => Object.assign({}, g, {
      photo: firstPhotoAt(g.rep.lat, g.rep.lng),
    }));
  }

  function _selfTest() {
    const recs = [
      { id: 1, name: 'マクドナルド渋谷', lat: 1, lng: 1, date: '2026-07-01' },
      { id: 2, name: 'マクドナルド渋谷', lat: 1, lng: 1, date: '2026-08-01' },
      { id: 3, name: 'マクドナルド新宿', lat: 2, lng: 2, date: '2026-07-15' },
      { id: 4, name: 'スターバックス',   lat: 3, lng: 3, date: '2026-07-20' },
    ];
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    const mac = matchRecords(recs, 'マクドナルド', 8);
    eq('match-groups', mac.length, 2);
    eq('match-count', mac[0].count, 2);
    eq('match-rep-newest', mac[0].rep.id, 2);
    eq('match-none', matchRecords(recs, 'ラーメン', 8).length, 0);
    eq('match-empty', matchRecords(recs, '', 8).length, 0);
    eq('match-limit', matchRecords(recs, 'マ', 1).length, 1);
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
    App.map.clearPlaceResults();
    clearPanel(); // 詳細や候補リストが出ていても、まっさらな初期表示へ（シートも隠れる）
    render();
  }

  // 検索候補リスト（下シート・場所ごとにまとめ、回数を表示）
  function showSearchResults() {
    const groups = searchResults || [];
    const rows = groups.map((g) => {
      const r = g.rep;
      const thumb = g.photo
        ? `<span class="result-thumb" style="background-image:url(${App.photos.thumbOf(g.photo)})"></span>`
        : `<span class="result-thumb" style="background:${App.genres.color(r.genre)}"></span>`;
      const sub = g.count > 1
        ? `${esc(App.genres.label(r.genre))} ・ ${g.count}回訪問`
        : `${esc(App.genres.label(r.genre))} ・ ${r.date}`;
      return `<li><button type="button" class="result-row" data-id="${r.id}">
        ${thumb}
        <span class="result-text">
          <span class="result-name">${esc(r.name) || '(名称未設定)'}</span>
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

  // 旅行の流れ。日をまたぐので、1日目・2日目…で区切って時系列に並べる。
  // 日の見出しを押すと、その日のルート（順番を編集できる画面）へ移る。
  function showTripRoute(trip, list) {
    const byDate = {};
    list.forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });
    const days = App.trips.daysOf(trip).filter((d) => byDate[d]);
    if (!days.length) {
      panel().innerHTML = `<div id="day-route"><p class="hint">${esc(trip.label)}の記録はまだありません</p></div>`;
      return;
    }
    const sections = days.map((d) => {
      const rows = byDate[d].slice().sort(byOrder).map((r, i) => `<li class="flow-row">
          <span class="flow-no">${i + 1}</span>
          <button type="button" class="route-name" data-id="${r.id}">
            <span class="flow-name">${esc(r.name) || '(名称未設定)'}</span>
            <span class="flow-genre">${esc(App.genres.label(r.genre))}</span>
          </button>
        </li>`).join('');
      return `<div class="trip-day">
        <button type="button" class="trip-day-head" data-date="${d}">
          <span class="trip-day-no">${App.trips.dayIndex(trip, d)}日目</span>
          <span class="trip-day-date">${formatVisitDate(d)}</span>
          <i class="ph ph-caret-right"></i>
        </button>
        <ol class="route-flow">${rows}</ol>
      </div>`;
    }).join('');
    panel().innerHTML = `<div id="day-route">
      <div class="dr-head">
        <h2>${esc(trip.label)}の流れ</h2>
        <span class="trip-len">${App.trips.lengthLabel(trip)}・${list.length}件</span>
      </div>
      ${sections}
    </div>`;
    panel().querySelectorAll('.route-name').forEach((b) => {
      b.onclick = () => {
        const rec = all.find((x) => String(x.id) === b.dataset.id);
        if (rec) { App.map.flyTo(rec.lat, rec.lng); showDetail(rec); }
      };
    });
    panel().querySelectorAll('.trip-day-head').forEach((b) => {
      b.onclick = () => focusDay(b.dataset.date); // その日だけのルート（並べ替えはそちらで）
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
          <span class="flow-name">${esc(r.name) || '(名称未設定)'}</span>
          <span class="flow-genre">${esc(App.genres.label(r.genre))}</span>
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
      `<option value="${g.key}" ${g.key === selected ? 'selected' : ''}>${esc(g.label)}</option>`
    ).join('');
  }

  // ジャンル選択の色チップ（単一選択）。真実は隠した <select name="genre">。
  // selId を渡すと select に id を付ける（クイック記録が onchange で参照）
  function genrePicker(selected, selId) {
    const idAttr = selId ? ` id="${selId}"` : '';
    const chips = App.genres.list.map((g) =>
      `<button type="button" class="gp-chip${g.key === selected ? ' active' : ''}" data-key="${g.key}" style="--gc:${g.color}"><span class="gp-dot"></span>${esc(g.label)}</button>`).join('');
    return `<div class="gpick"><select name="genre"${idAttr} class="gpick-select">${genreOptions(selected)}</select>${chips}</div>`;
  }
  // .gpick 内のチップを配線：クリックで隠しselectを更新＋active切替＋change発火
  function wireGenrePicker(scope) {
    const pick = scope.querySelector('.gpick');
    if (!pick) return;
    const sel = pick.querySelector('select');
    pick.querySelectorAll('.gp-chip').forEach((b) => {
      b.onclick = () => {
        sel.value = b.dataset.key;
        pick.querySelectorAll('.gp-chip').forEach((x) => x.classList.toggle('active', x === b));
        sel.dispatchEvent(new Event('change'));
      };
    });
  }

  // 写真ファイル選択（生の input を隠して破線タイルに）
  function fileDrop(label) {
    return `<label class="filedrop"><i class="ph ph-image"></i><span>${label}</span>`
      + '<input type="file" name="photos" accept="image/*" multiple></label>';
  }

  // ファイル選択にプレビューを配線。選んだ写真を即サムネ表示し、×で保存前に外せる。
  // 何度でも選び直せる（選択は追記）。返り値 getFiles() が保存時に使う現在の File[]。
  function wireFilePicker(input, box) {
    const pending = []; // { file, url }
    function render() {
      box.innerHTML = pending.map((p, i) =>
        `<div class="photo-edit">
          <img class="thumb" src="${p.url}" alt="">
          <button type="button" class="photo-del" data-i="${i}"><i class="ph ph-x"></i></button>
        </div>`).join('');
      box.querySelectorAll('.photo-del').forEach((btn) => {
        btn.onclick = () => {
          const [removed] = pending.splice(Number(btn.dataset.i), 1);
          URL.revokeObjectURL(removed.url); // プレビュー用URLを解放
          render();
        };
      });
    }
    input.addEventListener('change', () => {
      for (const f of Array.from(input.files)) pending.push({ file: f, url: URL.createObjectURL(f) });
      input.value = ''; // 同じ写真を選び直せるように＆二重取得を防ぐ
      render();
    });
    return () => pending.map((p) => p.file);
  }

  // 追加フォーム表示（地図クリック時／同じ場所への再訪時）
  // prefill: { name, genre, placeId } を渡すと場所名・ジャンル・Google場所IDを引き継ぐ（日付は今日・メモ/写真は空）
  function showAddForm(lat, lng, prefill) {
    searchResults = null; // 追加を始めたら検索結果モードは終了
    prefill = prefill || {};
    const placeId = prefill.placeId || null; // Google の場所から来た記録だけ持つ（手動追加は null）
    const today = new Date().toISOString().slice(0, 10);
    const nameVal = esc(prefill.name);
    panel().innerHTML = `
      <h2>記録を追加</h2>
      <form id="rec-form">
        <label>日付<input type="date" name="date" value="${today}" required></label>
        <label>場所名<input type="text" name="name" value="${nameVal}" placeholder="お店・施設の名前" required></label>
        <label>ジャンル</label>${genrePicker(prefill.genre || 'food')}
        <label>メモ・感想<textarea name="memo" rows="4" placeholder="今日はどんな一日だった？"></textarea></label>
        <label>ハッシュタグ<input type="text" name="tags" placeholder="#カフェ #記念日"></label>
        <label>写真</label>${fileDrop('写真を選ぶ')}
        <div id="new-photos" class="photos"></div>
        <div class="form-actions">
          <button type="button" id="cancel-btn">キャンセル</button>
          <button type="submit">保存</button>
        </div>
      </form>`;
    App.map.showTempMarker(lat, lng); // 追加地点の目印を表示
    if (App.sheet) App.sheet.snapTo('half'); // シートを開く
    wireGenrePicker(panel());
    const getNewFiles = wireFilePicker(panel().querySelector('#rec-form input[name=photos]'), document.getElementById('new-photos'));
    document.getElementById('cancel-btn').onclick = clearPanel;
    document.getElementById('rec-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const files = getNewFiles();
      const order = all.filter((r) => r.date === f.date.value).length; // その日の末尾に追加
      const submitBtn = f.querySelector('button[type=submit]');
      submitBtn.disabled = true; submitBtn.textContent = '保存中…';
      let photos = [];
      try {
        const groupId = 'new-' + Date.now(); // recordId 未確定なので一時ID（パスは表示用途のみ）
        photos = await App.photos.toStoredMany(files, groupId, (done, total) => {
          if (total > 1) submitBtn.textContent = `アップロード中 ${done}/${total}`;
        });
        await App.cloud.add({
          date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order, lat, lng, photos,
          ...(placeId ? { placeId } : {}),
        });
        clearPanel(); // 保存後は購読が自動反映
      } catch (err) {
        // DB保存前に上げた写真が孤児化しないよう掃除（ベストエフォート）
        for (const p of photos) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        alert('保存に失敗しました: ' + err.message);
        submitBtn.disabled = false; submitBtn.textContent = '保存';
      }
    };
  }

  // クイック記録：現在地から一瞬で保存。近くの店を候補表示、写真/メモは後から。
  async function showQuickLog(lat, lng) {
    searchResults = null;
    activeTag = null;
    const today = new Date().toISOString().slice(0, 10);
    const state = { name: '', genre: 'food', candidates: [], placeId: null };
    let cancelled = false; // 保存/詳しく書く に移ったら候補の遅延描画を止める

    function draw() {
      const chips = state.candidates.length
        ? `<div class="ql-cands-label">近くの候補</div>
           <div class="ql-cands">
             ${state.candidates.map((c, i) =>
               `<button type="button" class="ql-chip" data-i="${i}">${esc(c.name)}</button>`).join('')}
             <button type="button" class="ql-chip ql-chip-manual" data-manual="1">手動で入力</button>
           </div>`
        : '';
      panel().innerHTML = `
        <div id="quick-log">
          <h2>今ここを記録</h2>
          <p class="meta">${today} ・ 今日</p>
          <label>場所名<input type="text" id="ql-name" value="${esc(state.name)}" placeholder="お店・施設の名前"></label>
          ${chips}
          <label>ジャンル</label>${genrePicker(state.genre, 'ql-genre')}
          <div class="form-actions">
            <button type="button" id="ql-save">保存</button>
          </div>
          <button type="button" id="ql-more" class="back-btn ql-more"><i class="ph ph-pencil-simple"></i>詳しく書く</button>
        </div>`;
      const nameInput = document.getElementById('ql-name');
      nameInput.oninput = () => { state.name = nameInput.value; state.placeId = null; }; // 手入力に変えたら候補の紐付けを解除
      document.getElementById('ql-genre').onchange = (e) => { state.genre = e.target.value; };
      wireGenrePicker(panel());
      panel().querySelectorAll('.ql-chip').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.manual) { document.getElementById('ql-name').focus(); return; }
          const c = state.candidates[Number(b.dataset.i)];
          state.name = c.name;
          state.placeId = c.placeId || null; // 候補＝Google の場所なので placeId を紐付け
          if (c.genre) state.genre = c.genre;
          draw();
        };
      });
      document.getElementById('ql-save').onclick = save;
      document.getElementById('ql-more').onclick = () => {
        cancelled = true;
        showAddForm(lat, lng, { name: state.name, genre: state.genre });
      };
    }

    async function save() {
      cancelled = true;
      const btn = document.getElementById('ql-save');
      btn.disabled = true; btn.textContent = '保存中…';
      const name = state.name.trim();
      const genre = state.genre;
      try {
        const order = all.filter((r) => r.date === today).length;
        const placeId = state.placeId || null;
        const rec = { date: today, name, genre, memo: '', tags: [], order, lat, lng, photos: [],
          ...(placeId ? { placeId } : {}) };
        const id = await App.cloud.add(rec);
        showDetail({ id, ...rec });
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '保存';
      }
    }

    App.map.showTempMarker(lat, lng);
    if (App.sheet) App.sheet.snapTo('half');
    draw(); // まず即描画（候補取得を待たない）

    try {
      const cands = await App.places.nearbyPlaces(lat, lng);
      if (cancelled) return; // 既に保存/詳しく書くへ移った後は上書きしない
      state.candidates = cands.slice(0, 3);
      if (cands.length && !state.name) {
        state.name = cands[0].name;
        if (cands[0].genre) state.genre = cands[0].genre;
      }
      const active = document.activeElement;
      const typing = !!(active && active.id === 'ql-name');
      const caret = typing ? active.selectionStart : null;
      draw();
      if (typing) {
        const ni = document.getElementById('ql-name');
        if (ni) { ni.focus(); if (caret != null) { try { ni.setSelectionRange(caret, caret); } catch (_) { /* noop */ } } }
      }
    } catch (_) { /* 候補取得失敗は空のまま */ }
  }

  // 店(POI)カード：Places の情報を Googleマップ風に下シートへ。「記録に追加」で追加フォームへ。
  async function showPlaceCard(placeId, opts) {
    searchResults = null;
    activeTag = null;
    App.map.clearTempMarker();
    panel().innerHTML = `
      <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      <p class="hint">読み込み中…</p>`;
    if (App.sheet) App.sheet.snapTo('half');
    document.getElementById('pc-back').onclick = clearPanel;

    let p;
    try {
      p = await App.places.fetchPlace(placeId);
    } catch (err) {
      panel().innerHTML = `
        <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
        <p class="hint">店の情報を取得できませんでした。</p>`;
      document.getElementById('pc-back').onclick = clearPanel;
      return;
    }

    if (opts && opts.fly) App.map.flyTo(p.lat, p.lng); // 検索から開いた時はその場所へ寄せる
    if (opts && opts.pin) App.map.renderPlaceResults(
      [{ placeId, name: p.name, lat: p.lat, lng: p.lng, genre: p.genre }],
      (id) => showPlaceCard(id, { fly: true }));

    const photos = p.photoUrls.length
      ? `<div class="pc-photos">${p.photoUrls.map((u, i) => `<img class="pc-photo" src="${u}" data-i="${i}" alt="">`).join('')}</div>`
      : '';
    const rating = (p.rating != null)
      ? `<div class="pc-rating"><i class="ph ph-star"></i>${p.rating}${p.ratingCount != null ? `<span class="pc-count">（${p.ratingCount}）</span>` : ''}</div>`
      : '';
    let openHtml = '';
    if (p.openNow === true) openHtml = '<span class="pc-open">営業中</span>';
    else if (p.openNow === false) openHtml = '<span class="pc-closed">営業時間外</span>';
    const hours = p.hoursToday ? `<span class="pc-hours">${esc(p.hoursToday)}</span>` : '';
    const mapsUrl = p.googleMapsURI || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
    const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    const actions = [
      p.phone ? `<a class="pc-act" href="tel:${p.phone.replace(/[^0-9+]/g, '')}"><i class="ph ph-phone"></i>電話</a>` : '',
      `<a class="pc-act" href="${dirUrl}" target="_blank" rel="noopener"><i class="ph ph-arrow-bend-up-right"></i>経路</a>`,
      `<a class="pc-act" href="${mapsUrl}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i>マップ</a>`,
    ].filter(Boolean).join('');

    panel().innerHTML = `
      <button type="button" id="pc-back" class="back-btn"><i class="ph ph-arrow-left"></i>戻る</button>
      ${photos}
      <h2>${esc(p.name)}</h2>
      <p class="meta">${esc(App.genres.label(p.genre))}</p>
      <div class="pc-sub">${rating}${openHtml}${hours}</div>
      <div class="pc-actions">${actions}</div>
      <button type="button" id="pc-add" class="revisit-btn"><i class="ph ph-plus"></i>この店を記録に追加</button>
      ${p.website ? `<a class="gmaps-btn" href="${p.website}" target="_blank" rel="noopener"><i class="ph ph-globe"></i>公式サイト</a>` : ''}
      <p class="memo">${esc(p.address) || ''}</p>`;

    document.getElementById('pc-back').onclick = clearPanel;
    panel().querySelectorAll('.pc-photo').forEach((img) => {
      img.onclick = () => App.lightbox.open(p.photoUrls, Number(img.dataset.i));
    });
    document.getElementById('pc-add').onclick = () => {
      App.map.flyTo(p.lat, p.lng);
      showAddForm(p.lat, p.lng, { name: p.name, genre: p.genre, placeId });
    };
  }

  function clearPanel() {
    App.map.clearTempMarker();       // 追加地点の目印を消す
    App.map.stopPickLocation();      // 位置修正中のドラッグマーカーも片付ける
    routeEditMode = false;           // ルート編集モードを解除
    panel().innerHTML = '<p class="hint">地図を長押しして記録を追加</p>';
    if (App.sheet) App.sheet.hide(); // 何も選んでいないときはシートを隠す
  }

  // 詳細から戻る：検索結果／ルート／初期表示 のいずれかへ
  function goBack() {
    if (searchResults) { showSearchResults(); return; } // 候補リストへ
    const dayMode = filterState.mode === 'day' && !!filterState.day;
    if (dayMode) render(); // showDayRoute が呼ばれてルート一覧に戻る
    else clearPanel();
  }

  // 記録の詳細（思い出ページ）：写真ヒーロー＋編集的レイアウト
  function showDetail(record) {
    App.map.clearTempMarker(); // 追加中の目印が残っていれば消す
    if (App.sheet) App.sheet.snapTo('half'); // シートを開く
    const photos = record.photos || [];
    const urls = photos.map((p) => p.url);
    const genreColor = App.genres.color(record.genre);

    // ヒーロー：1枚目の写真。写真なしはジャンル色の温かいグラデにフォールバック
    const heroStyle = photos.length
      ? `background-image:url(${photos[0].url})`
      : `background-image:linear-gradient(160deg, color-mix(in srgb, ${genreColor} 22%, #fff), color-mix(in srgb, ${genreColor}, #000 14%))`;
    const countBadge = photos.length > 1 ? `<span class="dt-count">1 / ${photos.length}</span>` : '';
    const heroIcon = photos.length ? '' : '<span class="dt-hero-icon"><i class="ph ph-map-pin"></i></span>';
    const strip = photos.length > 1
      ? `<div class="dt-strip">${photos.map((p, i) =>
          `<span class="dt-thumb" data-i="${i}" style="background-image:url(${App.photos.thumbOf(p)})"></span>`).join('')}</div>`
      : '';

    // 同じ場所の訪問（新しい順）。2回以上ならチップで切替
    const visits = visitsAt(record.lat, record.lng)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const visitsHtml = visits.length > 1 ? `
      <div class="dt-visits-label">訪れた日（${visits.length}回）</div>
      <div class="dt-visits">${visits.map((v) =>
        `<button type="button" class="visit-chip ${v.id === record.id ? 'current' : ''}" data-id="${v.id}">${formatVisitDate(v.date)}</button>`
      ).join('')}</div>` : '';

    const tagsHtml = (record.tags || []).length
      ? `<div class="dt-tags">${(record.tags || []).map((t) =>
          `<button type="button" class="tag-chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>`
      : '';
    // placeId があれば「その店そのもの」を開く（同名店で別の店に飛ぶのを防ぐ）。無ければ名前で検索。
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(record.name || '')}`
      + (record.placeId ? `&query_place_id=${encodeURIComponent(record.placeId)}` : '');

    panel().innerHTML = `
      <div class="detail">
        <div class="dt-hero${photos.length ? '' : ' no-photo'}" style="${heroStyle}">
          <button type="button" id="detail-back" class="dt-back" aria-label="戻る"><i class="ph ph-arrow-left"></i></button>
          ${heroIcon}${countBadge}
        </div>
        ${strip}
        <div class="dt-body">
          <div class="dt-date">${formatVisitDate(record.date)}</div>
          <h2 class="dt-title">${esc(record.name) || '(名称未設定)'}</h2>
          <div class="dt-genre"><span class="dt-dot" style="background:${genreColor}"></span>${esc(App.genres.label(record.genre))}</div>
          ${visitsHtml}
          <div class="dt-rule"></div>
          <p class="dt-memo">${esc(record.memo).replace(/\n/g, '<br>') || '<span class="hint">メモなし</span>'}</p>
          ${tagsHtml}
          <button type="button" id="revisit-btn" class="dt-primary"><i class="ph ph-plus"></i>またここに記録する</button>
          <div class="dt-actions">
            <button type="button" id="edit-btn"><i class="ph ph-pencil-simple"></i>編集</button>
            <a href="${gmapsUrl}" target="_blank" rel="noopener"><i class="ph ph-map-trifold"></i>マップで開く</a>
            <button type="button" id="del-btn"><i class="ph ph-trash"></i>削除</button>
          </div>
        </div>
      </div>`;

    document.getElementById('detail-back').onclick = goBack;
    document.getElementById('revisit-btn').onclick = () =>
      showAddForm(record.lat, record.lng, { name: record.name, genre: record.genre, placeId: record.placeId });
    panel().querySelectorAll('.visit-chip').forEach((b) => {
      b.onclick = () => {
        const rec = all.find((x) => String(x.id) === b.dataset.id);
        if (rec) showDetail(rec);
      };
    });
    if (photos.length) { // ヒーロー・ストリップをタップでライトボックス
      const hero = panel().querySelector('.dt-hero');
      if (hero) hero.onclick = () => App.lightbox.open(urls, 0);
      panel().querySelectorAll('.dt-thumb').forEach((t) => {
        t.onclick = () => App.lightbox.open(urls, Number(t.dataset.i));
      });
    }
    panel().querySelectorAll('.tag-chip').forEach((btn) => {
      btn.onclick = () => runTagSearch(btn.dataset.tag);
    });
    document.getElementById('edit-btn').onclick = () => showEditForm(record);
    document.getElementById('del-btn').onclick = async () => {
      if (!confirm(`「${record.name}」を削除しますか？`)) return;
      await App.cloud.remove(record.id);
      // 記録が持つ写真の実ファイルも掃除（Base64はpath無し=no-op、失敗は握りつぶす）
      for (const p of (record.photos || [])) {
        try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ }
      }
      clearPanel(); // 購読が自動反映
    };
  }

  function showEditForm(record) {
    const keep = (record.photos || []).slice(); // 残す既存写真（×で減らす）
    let linkedPlaceId = record.placeId || null; // Googleの場所ID（紐付けボタンで後付け／既存を維持）
    panel().innerHTML = `
      <h2>記録を編集</h2>
      <form id="edit-form">
        <label>日付<input type="date" name="date" value="${record.date}" required></label>
        <label>場所名<input type="text" name="name" value="${esc(record.name)}" required></label>
        <label>ジャンル</label>${genrePicker(record.genre)}
        <label>メモ・感想<textarea name="memo" rows="4">${esc(record.memo)}</textarea></label>
        <label>ハッシュタグ<input type="text" name="tags" value="${esc(tagsToInput(record.tags))}" placeholder="#カフェ #記念日"></label>
        <label>今の写真（<i class="ph ph-map-pin"></i>でピンの写真に・×で削除）</label>
        <div id="existing-photos" class="photos"></div>
        <label>写真を追加</label>${fileDrop('写真を選ぶ')}
        <div id="add-photos" class="photos"></div>
        <label>場所の位置</label>
        <button type="button" id="fix-loc-btn" class="fix-loc-btn"><i class="ph ph-map-pin"></i>位置を修正</button>
        <p id="fix-loc-hint" class="hint" hidden>ピンをドラッグして正しい位置へ。「更新」で保存されます。</p>
        <label>Googleの場所と紐付け</label>
        <button type="button" id="link-place-btn" class="fix-loc-btn"><i class="ph ph-link-simple"></i><span id="link-place-label"></span></button>
        <div id="link-place-box" hidden>
          <input type="text" id="link-place-q" placeholder="店名で検索">
          <div class="ql-cands" style="margin-top:8px">
            <button type="button" id="link-place-search" class="ql-chip">この名前で検索</button>
          </div>
          <div id="link-place-results" class="ql-cands" style="margin-top:8px"></div>
        </div>
        <div class="form-actions">
          <button type="submit">更新</button>
          <button type="button" id="cancel-btn">キャンセル</button>
        </div>
      </form>`;

    const box = document.getElementById('existing-photos');
    function renderExisting() {
      if (keep.length === 0) { box.innerHTML = '<span class="hint">写真なし</span>'; return; }
      // 先頭(keep[0])の写真がピンに使われる。各写真の📍でその写真を先頭に持ってくる。
      box.innerHTML = keep.map((p, i) =>
        `<div class="photo-edit${i === 0 ? ' is-cover' : ''}">
          <img class="thumb" src="${App.photos.thumbOf(p)}" alt="">
          ${i === 0
            ? '<span class="cover-badge"><i class="ph ph-map-pin"></i>ピン</span>'
            : `<button type="button" class="photo-cover" data-i="${i}" title="ピンの写真にする"><i class="ph ph-map-pin"></i></button>`}
          <button type="button" class="photo-del" data-i="${i}"><i class="ph ph-x"></i></button>
        </div>`).join('');
      box.querySelectorAll('.photo-cover').forEach((btn) => {
        btn.onclick = () => {
          const [chosen] = keep.splice(Number(btn.dataset.i), 1);
          keep.unshift(chosen); // 選んだ写真を先頭＝ピンの写真にする
          renderExisting();
        };
      });
      box.querySelectorAll('.photo-del').forEach((btn) => {
        btn.onclick = () => { keep.splice(Number(btn.dataset.i), 1); renderExisting(); };
      });
    }
    renderExisting();
    const getAddFiles = wireFilePicker(panel().querySelector('#edit-form input[name=photos]'), document.getElementById('add-photos'));
    wireGenrePicker(panel());

    // Googleの場所と紐付け（既存記録に placeId を後付け。検索したときだけ Places を1回叩く）
    const linkLabel = document.getElementById('link-place-label');
    const linkBtn = document.getElementById('link-place-btn');
    const linkBox = document.getElementById('link-place-box');
    const linkQ = document.getElementById('link-place-q');
    const linkResults = document.getElementById('link-place-results');
    linkLabel.textContent = linkedPlaceId ? '紐付け済み（変更する）' : 'Googleの場所を選んで紐付け';
    linkBtn.classList.toggle('active', !!linkedPlaceId);
    async function runLinkSearch() {
      const q = linkQ.value.trim();
      if (!q) return;
      linkResults.innerHTML = '<span class="hint">検索中…</span>';
      try {
        const bias = { center: { lat: record.lat, lng: record.lng }, radius: 3000 }; // 記録の近くを優先
        const places = await App.places.searchText(q, { bias });
        if (!places.length) { linkResults.innerHTML = '<span class="hint">該当なし（紐付けなしのまま保存でOK）</span>'; return; }
        linkResults.innerHTML = places.slice(0, 6).map((p, i) =>
          `<button type="button" class="ql-chip" data-i="${i}">${esc(p.name)}</button>`).join('');
        linkResults.querySelectorAll('.ql-chip').forEach((b) => {
          b.onclick = () => {
            const p = places[Number(b.dataset.i)];
            linkedPlaceId = p.placeId;
            linkBox.hidden = true;
            linkBtn.classList.add('active');
            linkLabel.textContent = '紐付け済み: ' + p.name + '（更新で保存）';
          };
        });
      } catch (e) { linkResults.innerHTML = '<span class="hint">検索できませんでした</span>'; }
    }
    linkBtn.onclick = () => {
      linkBox.hidden = !linkBox.hidden;
      if (!linkBox.hidden && !linkQ.value) { linkQ.value = record.name || ''; runLinkSearch(); }
    };
    document.getElementById('link-place-search').onclick = runLinkSearch;
    linkQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runLinkSearch(); } });

    document.getElementById('fix-loc-btn').onclick = () => {
      App.map.startPickLocation(record.lat, record.lng);
      const btn = document.getElementById('fix-loc-btn');
      btn.classList.add('active');
      btn.innerHTML = '<i class="ph ph-map-pin"></i>位置修正中（ドラッグ）';
      document.getElementById('fix-loc-hint').hidden = false;
      if (App.sheet) App.sheet.snapTo('peek'); // 地図を広く見せる
    };

    document.getElementById('cancel-btn').onclick = () => { App.map.stopPickLocation(); showDetail(record); };
    document.getElementById('edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '更新中…';
      let uploaded = [];
      try {
        const newFiles = getAddFiles();
        uploaded = newFiles.length
          ? await App.photos.toStoredMany(newFiles, record.id, (done, total) => {
              if (total > 1) btn.textContent = `アップロード中 ${done}/${total}`;
            })
          : [];
        const picked = App.map.getPickedLatLng(); // 「位置を修正」していれば新座標
        const photos = keep.concat(uploaded); // 残した既存写真＋追加分
        const updated = {
          id: record.id, date: f.date.value, name: f.name.value, genre: f.genre.value,
          memo: f.memo.value, tags: parseTags(f.tags.value), order: record.order,
          lat: picked ? picked.lat : record.lat,
          lng: picked ? picked.lng : record.lng,
          photos,
          ...(linkedPlaceId ? { placeId: linkedPlaceId } : {}), // 既存の場所IDを維持／紐付けで後付け
        };
        App.map.stopPickLocation();
        await App.cloud.put(updated);
        // 保存成功後：×で外したStorage写真の実ファイルを掃除（Base64はpath無し=no-op）
        const removed = (record.photos || []).filter((p) => !keep.includes(p));
        for (const p of removed) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        showDetail(updated);
      } catch (err) {
        // 保存できなかったら新規アップ分が孤児化しないよう掃除
        for (const p of uploaded) { try { await App.photos.deletePhotoFiles(p); } catch (_) { /* noop */ } }
        alert('更新に失敗しました: ' + err.message);
        btn.disabled = false; btn.textContent = '更新';
      }
    };
  }

  function buildGenreFilters() {
    const box = document.getElementById('genre-filters');
    box.innerHTML = App.genres.list.map((g) =>
      `<label class="gf" style="--gc:${g.color}">
        <input type="checkbox" value="${g.key}" checked>
        <span class="gf-dot"></span>${esc(g.label)}
      </label>`
    ).join('');
    box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', applyUiFilter));
  }

  // モード切替のセグメントUI。真実は隠した #mode-select。押下で select を変えて change を発火。
  function buildModeSegment() {
    const sel = document.getElementById('mode-select');
    const seg = document.getElementById('mode-segment');
    if (!sel || !seg) return;
    // 先頭の下地が、選ばれているボタンの位置と幅へ滑る（地図/カレンダーのタブと同じ作り）
    seg.innerHTML = '<span class="seg-thumb"></span>' + Array.from(sel.options).map((o) =>
      `<button type="button" class="seg-btn" data-val="${o.value}">${o.textContent}</button>`).join('');
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => {
        sel.value = b.dataset.val;
        sel.dispatchEvent(new Event('change')); // 既存の applyUiFilter が走る
      };
    });
    syncModeSegment();
  }
  // #mode-select の現在値に合わせてセグメントの active 表示を更新
  // instant=true なら下地を animation 無しで置く（絞り込みを開いた瞬間に左から滑ってこないように）
  function syncModeSegment(instant) {
    const sel = document.getElementById('mode-select');
    const seg = document.getElementById('mode-segment');
    if (!sel || !seg) return;
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.val === sel.value);
    });
    moveSegThumb(instant === true);
  }
  // 下地を、選ばれているボタンの位置と幅に合わせる。
  // ⚠️offsetLeft/offsetWidth を使う。絞り込みパネルは開く途中で縮んでいるので、
  // getBoundingClientRect だと変形後の箱を測ってしまい、位置がずれる。
  function moveSegThumb(instant) {
    const seg = document.getElementById('mode-segment');
    if (!seg) return;
    const thumb = seg.querySelector('.seg-thumb');
    const on = seg.querySelector('.seg-btn.active');
    // 閉じている間は display:none で幅が 0。測れないので触らない（開いたときに置き直す）
    if (!thumb || !on || !on.offsetWidth) return;
    if (instant) thumb.classList.add('no-anim');
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + on.offsetLeft + 'px)';
    if (instant) {
      requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.remove('no-anim')));
    }
  }

  // 期間の絞り込みは、ふりかえりと同じ「1枚のカレンダーを 2 回タップ」で選ぶ。
  // 真実は隠し入力 #from-input / #to-input のままなので、読む側は今までどおり。
  function buildRangeCalendar() {
    const host = document.getElementById('range-cal');
    if (!host || !App.rangeCal) return;
    rangeCal = App.rangeCal.mount(host, {
      getRecords: () => all,
      onChange: (from, to) => {
        document.getElementById('from-input').value = from || '';
        document.getElementById('to-input').value = to || '';
        applyUiFilter();
      },
    });
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

  // 絞り込みが効いているか（モードが全部以外、またはジャンルを一部外している）
  function isFiltering() {
    const mode = document.getElementById('mode-select').value;
    const boxes = document.querySelectorAll('#genre-filters input');
    const checked = document.querySelectorAll('#genre-filters input:checked');
    return mode !== 'all' || checked.length < boxes.length;
  }

  function applyUiFilter() {
    // mode に応じて日付入力の表示切替
    const mode = document.getElementById('mode-select').value;
    document.getElementById('day-input').hidden = mode !== 'day';
    document.getElementById('range-inputs').hidden = mode !== 'range';
    const clr = document.getElementById('filter-clear-top');
    if (clr) clr.hidden = !isFiltering(); // 絞り込み中だけ×を出す
    // リセットや「ふりかえり→本物の地図」のように外から from/to が入ることがあるので、
    // 隠し入力を真実としてカレンダーを合わせる（同じ値なら setValue は何もしない）
    if (rangeCal) {
      rangeCal.setValue(
        document.getElementById('from-input').value || null,
        document.getElementById('to-input').value || null,
      );
    }
    setFilterState(readFilterState());
    syncModeSegment(); // focusDay/resetFilters 経由でもセグメント表示を合わせる
  }

  // ジャンル編集の保存後に呼ぶ：フィルタチップを作り直し、現在の絞り込みで再描画（ピン色も更新）。
  function refreshGenres() { buildGenreFilters(); applyUiFilter(); }

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

  // 旅行を開く：その期間で絞り込み、地図を旅行ぜんぶが入る範囲に合わせる。
  // 日を開くのと同じ入口（カレンダーの帯・旅行の一覧）から呼ぶ。
  function focusTrip(tripId) {
    const trip = App.trips.byId(tripId);
    if (!trip) return;
    routeEditMode = false;
    document.getElementById('mode-select').value = 'range';
    document.getElementById('from-input').value = trip.start;
    document.getElementById('to-input').value = trip.end;
    applyUiFilter();
    if (App.sheet) App.sheet.snapTo('half');
    const inTrip = all.filter((r) => App.trips.inTrip(r.date, trip));
    if (inTrip.length) App.map.fitTo(inTrip);
  }

  // 自分でかけた絞り込みを、自分の×で外すための共通処理。
  //
  // カードやバーが絞り込みをかけたなら、その×はかけたぶんも戻す。ただし戻すのは
  // 「今の絞り込みが自分のかけたものと同じとき」だけ。そのあと本人が絞り込みを
  // 変えていたら、それは本人の操作なので触らない（全体リセットではない）。
  // applied = { mode:'day', day } または { mode:'range', from, to }
  function undoFilter(applied) {
    if (!applied) return false;
    const sel = document.getElementById('mode-select');
    if (!sel || sel.value !== applied.mode) return false;
    const val = (id) => document.getElementById(id).value;
    if (applied.mode === 'day') {
      if (val('day-input') !== applied.day) return false;
      document.getElementById('day-input').value = '';
    } else if (applied.mode === 'range') {
      if (val('from-input') !== (applied.from || '')) return false;
      if (val('to-input') !== (applied.to || '')) return false;
      document.getElementById('from-input').value = '';
      document.getElementById('to-input').value = '';
    } else {
      return false;
    }
    sel.value = 'all';
    clearPanel();  // その日のルートシートも一緒に閉じる
    applyUiFilter();
    return true;
  }

  // 絞り込みを最初の状態（全部・全ジャンル）に戻し、検索も解除
  function resetFilters() {
    activeTag = null;
    searchResults = null;
    App.map.clearPlaceResults(); // 場所検索のピンも消す
    document.getElementById('mode-select').value = 'all';
    document.getElementById('day-input').value = '';
    document.getElementById('from-input').value = '';
    document.getElementById('to-input').value = '';
    document.querySelectorAll('#genre-filters input').forEach((cb) => { cb.checked = true; });
    const box = document.getElementById('search-box');
    if (box) box.value = '';
    const sc = document.getElementById('search-clear');
    if (sc) sc.hidden = true; // 検索バーの×も消す
    clearPanel(); // シートも隠れる
    applyUiFilter();
  }

  function init() {
    App.map.setLongPressHandler(showAddForm); // 長押しで記録追加
    App.map.setPlaceClickHandler((placeId) => {
      if (Date.now() < suppressPlaceUntil) return; // 直前のタップで詳細を閉じたときは店カードを出さない
      if (panel().querySelector('.detail')) { clearPanel(); return; }
      showPlaceCard(placeId);
    });
    // 地図の短いタップ（pointer検出・Google click に依存しない）
    App.map.setTapHandler(() => {
      // 絞り込みパネルを開いているときは、地図タップで閉じる
      const topbar = document.getElementById('topbar');
      if (topbar && topbar.classList.contains('filters-open')) {
        App.closeFilters(); // 印を外すだけでなくパネルも閉じる（js/app.js）
        return;
      }
      // 詳細を開いているときは地図タップで閉じる。それ以外はシートを下げるだけ
      if (panel().querySelector('.detail')) { clearPanel(); suppressPlaceUntil = Date.now() + 600; return; }
      if (App.sheet) App.sheet.collapse();
    });
    buildGenreFilters();
    buildModeSegment();
    buildRangeCalendar();
    ['mode-select', 'day-input'].forEach((id) =>
      document.getElementById(id).addEventListener('change', applyUiFilter));
    document.getElementById('filter-clear').addEventListener('click', resetFilters);
    const clrTop = document.getElementById('filter-clear-top');
    if (clrTop) clrTop.addEventListener('click', resetFilters); // 絞り込みボタン右の×
    reload();
  }

  return { init, reload, setRecords, render, getAll, setFilterState, applyUiFilter, focusDay,
           placeSegThumb: () => syncModeSegment(true), // 絞り込みを開いた直後に置き直す（js/app.js）
           refreshGenres, undoFilter, focusTrip,
           searchTag, clearTag, searchByName, clearSearch,
           showDetail, showEditForm, showAddForm, showQuickLog, showPlaceCard, suggestRecords,
           _clearPanel: clearPanel, _selfTest };
})();
