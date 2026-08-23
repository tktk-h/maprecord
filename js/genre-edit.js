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

  return { validate: validate, usageCount: usageCount, newKey: newKey, normalize: normalize, _selfTest: _selfTest };
})();
