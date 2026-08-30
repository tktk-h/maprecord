window.App = window.App || {};
App.genreEdit = (function () {
  var HEX = /^#[0-9a-fA-F]{6}$/;

  // rows: [{key,label,color}] を検証。{ ok, error } を返す。
  function validate(rows) {
    if (!rows || rows.length < 1) return { ok: false, error: '種類は最低1つ必要です' };
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].label || !String(rows[i].label).trim()) return { ok: false, error: '名前が空の種類があります' };
      if (!HEX.test(rows[i].color)) return { ok: false, error: '色の形式が正しくありません' };
    }
    return { ok: true, error: '' };
  }

  // records のうち genre===key の件数（削除可否＝使用中判定に使う）。
  function usageCount(records, key) {
    var n = 0;
    (records || []).forEach(function (r) { if (r && r.genre === key) n++; });
    return n;
  }

  // existingKeys と衝突しない新規キー。
  function newKey(existingKeys) {
    var used = {};
    (existingKeys || []).forEach(function (k) { used[k] = true; });
    var k;
    do { k = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 90 + 10); } while (used[k]);
    return k;
  }

  // 保存用に {key,label,color} だけへ整形（label は trim）。
  function normalize(rows) {
    return (rows || []).map(function (r) { return { key: r.key, label: String(r.label).trim(), color: r.color }; });
  }

  function _selfTest() {
    var fails = 0;
    function eq(n, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    }
    eq('valid-ok', validate([{ key: 'a', label: 'A', color: '#123456' }]).ok, true);
    eq('valid-empty-list', validate([]).ok, false);
    eq('valid-blank-label', validate([{ key: 'a', label: '  ', color: '#123456' }]).ok, false);
    eq('valid-bad-color', validate([{ key: 'a', label: 'A', color: 'red' }]).ok, false);
    eq('usage', usageCount([{ genre: 'a' }, { genre: 'b' }, { genre: 'a' }], 'a'), 2);
    eq('usage-zero', usageCount([{ genre: 'b' }], 'a'), 0);
    var k = newKey(['x', 'y']);
    eq('newkey-type', typeof k, 'string');
    eq('newkey-nodup', (k !== 'x' && k !== 'y'), true);
    eq('normalize', normalize([{ key: 'a', label: ' A ', color: '#111111', extra: 9 }]), [{ key: 'a', label: 'A', color: '#111111' }]);
    console.log(fails === 0 ? '✅ genreEdit ALL PASS' : ('❌ genreEdit ' + fails + ' FAIL'));
    return fails;
  }

  var spaceId = null;
  function setSpaceId(id) { spaceId = id || null; }
  var PALETTE = ['#c2703f', '#a07850', '#6b8299', '#7a9471', '#9a7099', '#928b80', '#b76e64', '#8f9e6a'];
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function open() {
    var host = el('genre-editor');
    if (!host) return;
    var rows = App.genres.list.map(function (g) { return { key: g.key, label: g.label, color: g.color }; }); // 作業用コピー
    var records = (App.records && App.records.getAll) ? App.records.getAll() : [];
    var busy = false;

    // 保存中(busy)は閉じない＝保存は必ず完走して適用（stale状態を作らない）。保存は一瞬なので実害なし。
    function close() {
      if (busy) return;
      // 中身を捨てるのは閉じ終わってから。先に捨てると滑っている最中の画面が空になる。
      // 印を外すのも同じで、先に外すと地図の浮きボタンが滑っている画面の上に顔を出す。
      App.overlay.close(host, function () {
        host.innerHTML = '';
        // ⚠️閉じている間にもう片方の編集画面が開いていることがある。印は共有しているので、
        // 無条件に外すと開いたばかりの画面から剥がれ、地図の浮きボタンがその上に出る。
        var other = document.getElementById('trip-editor');
        if (!other || other.hidden) document.body.classList.remove('editor-open');
      });
    }
    function showErr(msg) { var e = host.querySelector('.ge-err'); if (e) { e.textContent = msg; e.hidden = false; } }
    function save() {
      if (busy) return;
      var v = App.genreEdit.validate(rows);
      if (!v.ok) { showErr(v.error); return; }
      var list = App.genreEdit.normalize(rows);
      var saveBtn = host.querySelector('.ge-save');
      if (saveBtn) saveBtn.disabled = true;
      busy = true;
      Promise.resolve(App.space.setGenres(spaceId, list)).then(function () {
        busy = false;
        App.genres.setList(list);
        if (App.records && App.records.refreshGenres) App.records.refreshGenres();
        close();
      }).catch(function (e) {
        busy = false;
        if (saveBtn) saveBtn.disabled = false;
        showErr('保存に失敗しました: ' + ((e && e.message) || ''));
      });
    }

    function render() {
      host.innerHTML =
        '<div class="ge-panel ov-card">' +
        '<div class="ge-head"><div class="ge-title">ジャンル編集</div>' +
        '<button class="x-btn" aria-label="閉じる"><i class="ph ph-x"></i></button></div>' +
        '<div class="ge-rows"></div>' +
        '<button class="ge-add" type="button"><i class="ph ph-plus"></i> 種類を追加</button>' +
        '<div class="ge-err" hidden></div>' +
        '<div class="ge-actions"><button class="ge-cancel" type="button">キャンセル</button>' +
        '<button class="ge-save" type="button">保存</button></div>' +
        '</div>';
      var rowsBox = host.querySelector('.ge-rows');
      rows.forEach(function (row, i) {
        var used = App.genreEdit.usageCount(records, row.key);
        var safeColor = /^#[0-9a-fA-F]{6}$/.test(row.color) ? row.color : '#928b80';
        var r = document.createElement('div');
        r.className = 'ge-row';
        r.innerHTML =
          '<input type="color" class="ge-color" value="' + safeColor + '">' +
          '<input type="text" class="ge-label" value="' + esc(row.label) + '" placeholder="名前" maxlength="12">' +
          '<button type="button" class="ge-up" ' + (i === 0 ? 'disabled' : '') + ' aria-label="上へ"><i class="ph ph-caret-up"></i></button>' +
          '<button type="button" class="ge-down" ' + (i === rows.length - 1 ? 'disabled' : '') + ' aria-label="下へ"><i class="ph ph-caret-down"></i></button>' +
          '<button type="button" class="ge-del" ' + (used > 0 ? 'disabled' : '') + ' aria-label="削除">' +
          (used > 0 ? ('<span class="ge-used">' + used + '件</span>') : '<i class="ph ph-trash"></i>') + '</button>';
        r.querySelector('.ge-color').oninput = function () { row.color = this.value; };
        r.querySelector('.ge-label').oninput = function () { row.label = this.value; };
        r.querySelector('.ge-up').onclick = function () { if (i > 0) { var t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; render(); } };
        r.querySelector('.ge-down').onclick = function () { if (i < rows.length - 1) { var t = rows[i + 1]; rows[i + 1] = rows[i]; rows[i] = t; render(); } };
        if (used === 0) { r.querySelector('.ge-del').onclick = function () { rows.splice(i, 1); render(); }; }
        rowsBox.appendChild(r);
      });
      host.querySelector('.ge-add').onclick = function () {
        var keys = rows.map(function (x) { return x.key; });
        rows.push({ key: App.genreEdit.newKey(keys), label: '', color: PALETTE[rows.length % PALETTE.length] });
        render();
      };
      host.querySelector('.x-btn').onclick = close;
      host.querySelector('.ge-cancel').onclick = close;
      host.querySelector('.ge-save').onclick = save;
    }

    render();
    App.overlay.open(host);
    // 地図の上に浮くボタン（z-index:500）はこのオーバーレイを突き抜けるので、印を付けて隠す
    document.body.classList.add('editor-open');
  }

  return { validate: validate, usageCount: usageCount, newKey: newKey, normalize: normalize,
    open: open, setSpaceId: setSpaceId, _selfTest: _selfTest };
})();
