window.App = window.App || {};
// クラウド版：一次保存はFirestore。書き出しは「控え」用（写真は data URL を含む）。復元は「不足分だけ追加」。
App.backup = (function () {
  function exportJson() {
    const records = App.records.getAll();
    const blob = new Blob([JSON.stringify({ version: 2, records }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `date-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // JSONテキスト → { ok, records(有効のみ), skipped(除外数), error }
  // 必須：id(非空文字列) / date('YYYY-MM-DD') / 数値 lat / 数値 lng
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, records: [], skipped: 0, error: 'ファイルを読めませんでした（JSON形式ではありません）' }; }
    if (!data || !Array.isArray(data.records)) {
      return { ok: false, records: [], skipped: 0, error: 'バックアップ形式ではありません（records が見つかりません）' };
    }
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const valid = [];
    let skipped = 0;
    data.records.forEach((r) => {
      if (r && typeof r.id === 'string' && r.id
        && typeof r.date === 'string' && DATE.test(r.date)
        && typeof r.lat === 'number' && typeof r.lng === 'number') {
        valid.push(r);
      } else { skipped++; }
    });
    return { ok: true, records: valid, skipped, error: '' };
  }

  // fileRecords のうち existingRecords に id が無いものだけ → { toAdd, addCount, keepCount }
  function diffMissing(fileRecords, existingRecords) {
    const have = Object.create(null);
    (existingRecords || []).forEach((r) => { if (r && r.id) have[r.id] = true; });
    const toAdd = (fileRecords || []).filter((r) => r && r.id && !have[r.id]);
    return { toAdd, addCount: toAdd.length, keepCount: (fileRecords ? fileRecords.length : 0) - toAdd.length };
  }

  function _selfTest() {
    let fails = 0;
    const eq = (n, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + n, ok ? '' : ('got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    eq('parse-bad-json', parseBackup('{not json').ok, false);
    eq('parse-no-records', parseBackup('{"version":2}').ok, false);
    const good = JSON.stringify({ version: 2, records: [
      { id: 'a', date: '2026-01-02', lat: 35, lng: 139, name: 'A' },
      { id: 'b', date: '2026-03-04', lat: 35.1, lng: 139.1 },
      { id: '', date: '2026-01-01', lat: 1, lng: 1 },      // id空 → skip
      { id: 'c', date: '2026/01/01', lat: 1, lng: 1 },      // date形式NG → skip
      { id: 'd', date: '2026-01-01', lat: 'x', lng: 1 },    // lat非数 → skip
    ] });
    const p = parseBackup(good);
    eq('parse-ok', p.ok, true);
    eq('parse-valid-count', p.records.length, 2);
    eq('parse-skipped', p.skipped, 3);
    const d = diffMissing([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a' }]);
    eq('diff-add', d.addCount, 2);
    eq('diff-keep', d.keepCount, 1);
    eq('diff-toadd-ids', d.toAdd.map((x) => x.id), ['b', 'c']);
    eq('diff-empty-existing', diffMissing([{ id: 'a' }], []).addCount, 1);
    eq('diff-empty-file', diffMissing([], [{ id: 'a' }]).addCount, 0);
    console.log(fails === 0 ? '✅ backup ALL PASS' : ('❌ backup ' + fails + ' FAIL'));
    return fails;
  }

  let running = false;
  function importFlow() {
    if (running) return;
    const input = document.getElementById('import-file');
    if (!input) return;
    input.value = ''; // 同じファイルを連続で選べるように
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handleText(String(reader.result || ''));
      reader.onerror = () => alert('ファイルの読み込みに失敗しました');
      reader.readAsText(file);
    };
    input.click();
  }

  function handleText(text) {
    const p = parseBackup(text);
    if (!p.ok) { alert(p.error); return; }
    const existing = (App.records && App.records.getAll) ? App.records.getAll() : [];
    const d = diffMissing(p.records, existing);
    if (d.addCount === 0) { alert('追加する新しい記録はありませんでした（すべて既存です）'); return; }
    let msg = 'このファイル: ' + p.records.length + '件\n新しく追加: ' + d.addCount + '件\n既存はそのまま: ' + d.keepCount + '件';
    if (p.skipped) msg += '\n読めなかった: ' + p.skipped + '件';
    msg += '\n\n追加しますか？';
    if (!window.confirm(msg)) return;
    doImport(d.toAdd);
  }

  function doImport(toAdd) {
    running = true;
    let ok = 0, ng = 0, done = 0;
    const finish = () => {
      running = false;
      alert(ok + '件を追加しました' + (ng ? '（' + ng + '件は失敗）' : ''));
    };
    toAdd.forEach((r) => {
      Promise.resolve(App.cloud.put(r))
        .then(() => { ok++; })
        .catch(() => { ng++; })
        .then(() => { done++; if (done === toAdd.length) finish(); });
    });
  }

  return { exportJson, importFlow, parseBackup, diffMissing, _selfTest };
})();
