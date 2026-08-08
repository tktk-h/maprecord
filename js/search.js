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

  return { classifyQuery, debounce, _selfTest };
})();
