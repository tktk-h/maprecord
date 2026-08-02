window.App = window.App || {};
App.genres = {
  // 表示順。key はデータ保存に使う不変ID、label は画面表示、color はピン色。
  list: [
    { key: 'food',      label: 'ごはん',   color: '#c2703f' },
    { key: 'cafe',      label: 'カフェ',   color: '#a07850' },
    { key: 'facility',  label: '施設',     color: '#6b8299' },
    { key: 'sightsee',  label: '観光',     color: '#7a9471' },
    { key: 'shopping',  label: '買い物',   color: '#9a7099' },
    { key: 'other',     label: 'その他',   color: '#928b80' },
  ],
  color(key) {
    const g = this.list.find((x) => x.key === key);
    return g ? g.color : '#868e96';
  },
  label(key) {
    const g = this.list.find((x) => x.key === key);
    return g ? g.label : 'その他';
  },
};
