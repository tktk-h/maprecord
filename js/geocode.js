window.App = window.App || {};
// 場所名 → 座標（ジオコーディング）。プロバイダは Nominatim(OSM)・無料・キー不要。
// records.js からはこの search() だけを使う（プロバイダ非依存にしておき、将来差し替え可能に）。
App.geocode = (function () {
  const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const LIMIT = 5;

  // Nominatim の生JSON配列 → [{ name, address, lat, lng }]（最大 limit 件、無効座標は除外）
  function parseResults(json, limit) {
    if (!Array.isArray(json)) return [];
    return json.map((r) => {
      const full = r.display_name || '';
      const name = r.name || full.split(',')[0].trim() || '(名称不明)';
      return { name, address: full, lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).slice(0, limit);
  }

  // query を検索。opts.viewbox=[west,south,east,north] があれば近場を優先。返り値は parseResults の形。
  async function search(query, opts) {
    const q = (query || '').trim();
    if (!q) return [];
    const params = new URLSearchParams({
      format: 'jsonv2', q, limit: String(LIMIT),
      'accept-language': 'ja', addressdetails: '1',
    });
    if (opts && opts.viewbox && opts.viewbox.length === 4) {
      params.set('viewbox', opts.viewbox.join(',')); // [west,south,east,north]（両隅で範囲を示す）
      params.set('bounded', '0');                     // 範囲外も出すが近場を優先
    }
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('geocode HTTP ' + res.status);
    return parseResults(await res.json(), LIMIT);
  }

  function _selfTest() {
    const sample = [
      { display_name: '東京駅, 丸の内, 千代田区, 東京都, 日本', name: '東京駅', lat: '35.6812', lon: '139.7671' },
      { display_name: '無効座標の場所, どこか', lat: 'x', lon: 'y' }, // 除外される想定
    ];
    const out = parseResults(sample, 5);
    const ok = out.length === 1
      && out[0].name === '東京駅'
      && out[0].address.startsWith('東京駅')
      && Math.abs(out[0].lat - 35.6812) < 1e-6
      && Math.abs(out[0].lng - 139.7671) < 1e-6;
    console.log((ok ? 'PASS' : 'FAIL') + ' geocode.parseResults', JSON.stringify(out));
  }

  return { search, parseResults, _selfTest };
})();
