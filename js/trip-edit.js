window.App = window.App || {};
// 旅行の編集画面（一覧 → 追加/編集）。判定は js/trips.js、保存はスペース、ここは画面だけ。
// ジャンル編集と同じ作法（ES5 調・.ge-* のクラスを借りる）で揃えている。
App.tripEdit = (function () {
  var spaceId = null;
  var onSaved = null; // 保存後にカレンダーや地図を描き直すための呼び返し

  function setSpaceId(id) { spaceId = id || null; }
  function setOnSaved(fn) { onSaved = fn; }
  function host() { return document.getElementById('trip-editor'); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 'YYYY-MM-DD' → '8/10'（帯や一覧に出す短い形）
  function short(dateStr) {
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) return '';
    return Number(p[1]) + '/' + Number(p[2]);
  }
  function rangeText(trip) {
    return short(trip.start) + '〜' + short(trip.end) + '（' + App.trips.lengthLabel(trip) + '）';
  }
  // その旅行に入っている記録の数（消してよいか判断する材料として出す）
  function countIn(trip) {
    var recs = (App.records && App.records.getAll()) || [];
    var n = 0;
    for (var i = 0; i < recs.length; i += 1) if (App.trips.inTrip(recs[i].date, trip)) n += 1;
    return n;
  }

  function open() {
    var box = host();
    if (!box) return;
    var rows = App.trips.clone(App.trips.list); // 作業用コピー（保存するまで本体は触らない）
    var busy = false;

    function close() { if (busy) return; box.hidden = true; box.innerHTML = ''; }

    function persist(next, errBox) {
      var check = App.trips.validate(next);
      if (!check.ok) { if (errBox) { errBox.textContent = check.error; errBox.hidden = false; } return; }
      if (!spaceId) { if (errBox) { errBox.textContent = 'スペースが未選択です'; errBox.hidden = false; } return; }
      busy = true;
      App.space.setTrips(spaceId, App.trips.normalize(next))
        .then(function () {
          App.trips.setList(next);
          rows = App.trips.clone(App.trips.list);
          busy = false;
          if (onSaved) onSaved();
          renderList();
        })
        .catch(function (e) {
          busy = false;
          if (errBox) { errBox.textContent = '保存に失敗しました: ' + e.message; errBox.hidden = false; }
        });
    }

    // ---- 一覧 ----
    function renderList() {
      box.innerHTML =
        '<div class="ge-panel">' +
        '<div class="ge-head"><div class="ge-title">旅行</div>' +
        '<button class="ge-x" aria-label="閉じる"><i class="ph ph-x"></i></button></div>' +
        '<p class="te-lead">期間を決めておくと、その間の記録はぜんぶこの旅行のものになります。' +
        'あとから足した記録も自動で入ります。</p>' +
        '<div class="ge-rows"></div>' +
        '<button class="ge-add" type="button"><i class="ph ph-plus"></i> 旅行を追加</button>' +
        '<div class="ge-err" hidden></div>' +
        '</div>';
      var rowsBox = box.querySelector('.ge-rows');
      var errBox = box.querySelector('.ge-err');
      if (!rows.length) {
        var empty = document.createElement('p');
        empty.className = 'te-empty';
        empty.textContent = 'まだ旅行はありません';
        rowsBox.appendChild(empty);
      }
      rows.forEach(function (trip, i) {
        var n = countIn(trip);
        var r = document.createElement('div');
        r.className = 'ge-row te-row';
        r.innerHTML =
          '<button type="button" class="te-open">' +
          '<span class="te-name">' + esc(trip.label) + '</span>' +
          '<span class="te-range">' + esc(rangeText(trip)) + ' ・ ' + n + '件</span>' +
          '</button>' +
          '<button type="button" class="ge-del" aria-label="削除"><i class="ph ph-trash"></i></button>';
        r.querySelector('.te-open').onclick = function () { renderForm(i); };
        r.querySelector('.ge-del').onclick = function () {
          if (!window.confirm('「' + trip.label + '」を消します。記録そのものは消えません。')) return;
          var next = rows.slice();
          next.splice(i, 1);
          persist(next, errBox);
        };
        rowsBox.appendChild(r);
      });
      box.querySelector('.ge-add').onclick = function () { renderForm(-1); };
      box.querySelector('.ge-x').onclick = close;
    }

    // ---- 追加/編集 ----
    // index が -1 なら新規。期間はふりかえりと同じ期間カレンダーを使い回す。
    function renderForm(index) {
      var editing = index >= 0 ? rows[index] : { id: '', label: '', start: '', end: '' };
      var draft = { id: editing.id, label: editing.label, start: editing.start, end: editing.end };
      box.innerHTML =
        '<div class="ge-panel">' +
        '<div class="ge-head"><div class="ge-title">' + (index >= 0 ? '旅行を編集' : '旅行を追加') + '</div>' +
        '<button class="ge-x" aria-label="閉じる"><i class="ph ph-x"></i></button></div>' +
        '<input type="text" class="ge-label te-name-input" placeholder="旅行の名前（例 沖縄旅行）" maxlength="20">' +
        '<div class="te-cal-host"></div>' +
        '<div class="ge-err" hidden></div>' +
        '<div class="ge-actions"><button class="ge-cancel" type="button">やめる</button>' +
        '<button class="ge-save" type="button">保存</button></div>' +
        '</div>';
      var errBox = box.querySelector('.ge-err');
      var nameInput = box.querySelector('.te-name-input');
      nameInput.value = draft.label;
      nameInput.oninput = function () { draft.label = this.value; };

      App.rangeCal.mount(box.querySelector('.te-cal-host'), {
        from: draft.start || null,
        to: draft.end || null,
        getRecords: function () { return (App.records && App.records.getAll()) || []; },
        onChange: function (from, to) { draft.start = from || ''; draft.end = to || ''; },
      });

      box.querySelector('.ge-cancel').onclick = renderList;
      box.querySelector('.ge-x').onclick = close;
      box.querySelector('.ge-save').onclick = function () {
        // 1日だけ押したときは日帰りとして扱う（終了を押し忘れても保存できる）
        if (draft.start && !draft.end) draft.end = draft.start;
        var next = rows.slice();
        if (index >= 0) next[index] = { id: draft.id, label: draft.label, start: draft.start, end: draft.end };
        else {
          next.push({
            id: App.trips.newId(next), label: draft.label, start: draft.start, end: draft.end,
          });
        }
        persist(next, errBox);
      };
    }

    renderList();
    box.hidden = false;
  }

  return { open: open, setSpaceId: setSpaceId, setOnSaved: setOnSaved, _short: short };
})();
