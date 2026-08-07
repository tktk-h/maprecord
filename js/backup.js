window.App = window.App || {};
// クラウド版：一次保存はFirestore。書き出しは「控え」用（写真は data URL を含む）。
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
  return { exportJson };
})();
