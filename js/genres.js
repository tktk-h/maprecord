window.App = window.App || {};
App.genres = (function () {
  // key はデータ保存に使う不変ID、label は画面表示、color はピン色。
  var DEFAULTS = [
    { key: 'food',      label: 'ごはん',   color: '#c2703f' },
    { key: 'cafe',      label: 'カフェ',   color: '#a07850' },
    { key: 'facility',  label: '施設',     color: '#6b8299' },
    { key: 'sightsee',  label: '観光',     color: '#7a9471' },
    { key: 'shopping',  label: '買い物',   color: '#9a7099' },
    { key: 'other',     label: 'その他',   color: '#928b80' },
  ];
  function clone(arr) {
    return arr.map(function (g) { return { key: g.key, label: g.label, color: g.color }; });
  }
  var list = clone(DEFAULTS); // 現在有効なジャンル（消費者はこの配列を描画時に読む）
  function color(key) { var g = list.find(function (x) { return x.key === key; }); return g ? g.color : '#868e96'; }
  function label(key) { var g = list.find(function (x) { return x.key === key; }); return g ? g.label : 'その他'; }
  // arr が非空配列ならその内容で list を「その場置換」（参照を保持している消費者にも反映）。falsy/空なら DEFAULTS。
  function setList(arr) {
    var next = (arr && arr.length) ? clone(arr) : clone(DEFAULTS);
    list.length = 0;
    next.forEach(function (g) { list.push(g); });
  }
  function _selfTest() {
    var fails = 0;
    function eq(n, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    }
    eq('default-color-food', color('food'), '#c2703f');
    eq('default-label-cafe', label('cafe'), 'カフェ');
    eq('unknown-color', color('zzz'), '#868e96');
    eq('unknown-label', label('zzz'), 'その他');
    var ref = list;
    setList([{ key: 'x', label: 'エックス', color: '#123456' }]);
    eq('setList-len', list.length, 1);
    eq('setList-color', color('x'), '#123456');
    eq('same-ref', list === ref, true);            // その場置換で参照維持
    setList(null);                                  // 空→DEFAULTS
    eq('reset-len', list.length, 6);
    eq('reset-color', color('food'), '#c2703f');
    setList([]);                                    // 空配列→DEFAULTS
    eq('empty-reset-len', list.length, 6);
    console.log(fails === 0 ? '✅ genres ALL PASS' : ('❌ genres ' + fails + ' FAIL'));
    return fails;
  }
  return { list: list, DEFAULTS: DEFAULTS, color: color, label: label, setList: setList, _selfTest: _selfTest };
})();
