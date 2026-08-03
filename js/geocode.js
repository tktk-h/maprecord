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

  // 1回分のリクエスト。bounded=true なら viewbox 内に限定する。
  async function request(q, viewbox, bounded) {
    const params = new URLSearchParams({
      format: 'jsonv2', q, limit: String(LIMIT),
      'accept-language': 'ja', addressdetails: '1',
    });
    if (viewbox && viewbox.length === 4) {
      params.set('viewbox', viewbox.join(',')); // [west,south,east,north]（両隅で範囲を示す）
      params.set('bounded', bounded ? '1' : '0');
    }
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('geocode HTTP ' + res.status);
    return parseResults(await res.json(), LIMIT);
  }

  // viewbox の中心に近い順に並べ替える（近い候補を上に）
  function sortByCenter(list, viewbox) {
    const cx = (viewbox[0] + viewbox[2]) / 2;
    const cy = (viewbox[1] + viewbox[3]) / 2;
    return list.slice().sort((a, b) =>
      ((a.lng - cx) ** 2 + (a.lat - cy) ** 2) - ((b.lng - cx) ** 2 + (b.lat - cy) ** 2));
  }

  // query を検索。opts.viewbox=[west,south,east,north] があれば「今見えている範囲内」を優先。
  // まず範囲内に限定して探し（近い順に整列）、無ければ全国にフォールバックする。
  async function search(query, opts) {
    const q = (query || '').trim();
    if (!q) return [];
    const viewbox = opts && opts.viewbox;
    if (viewbox && viewbox.length === 4) {
      const local = await request(q, viewbox, true); // 範囲内に限定
      if (local.length) return sortByCenter(local, viewbox);
    }
    return request(q, viewbox, false); // 範囲外も含めて（全国）
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
