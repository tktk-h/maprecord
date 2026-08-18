window.App = window.App || {};
// Places（店・施設）情報の取得。将来ここに検索(autocomplete/textSearch)も足す想定。
// UI は Google 固有型に依存しないよう、正規化したオブジェクトを返す。
App.places = (function () {
  // Google の place types 配列 → App.genres の key を推定
  function genreFromTypes(types) {
    const t = new Set(types || []);
    const has = (...ks) => ks.some((k) => t.has(k));
    if (has('cafe', 'coffee_shop')) return 'cafe';
    if (has('restaurant', 'food', 'meal_takeaway', 'meal_delivery', 'bakery', 'bar')) return 'food';
    if (has('tourist_attraction', 'park', 'museum', 'aquarium', 'zoo', 'art_gallery', 'landmark')) return 'sightsee';
    if (has('store', 'shopping_mall', 'clothing_store', 'department_store', 'supermarket', 'convenience_store')) return 'shopping';
    if (has('lodging', 'spa', 'gym', 'movie_theater', 'amusement_park', 'stadium')) return 'facility';
    return 'other';
  }

  // LatLng or LatLngLiteral → { lat, lng }
  function coord(loc) {
    if (!loc) return { lat: null, lng: null };
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    return { lat, lng };
  }

  // 今日の営業時間文字列（weekdayDescriptions は月曜始まり）
  function hoursToday(hours) {
    const desc = hours && hours.weekdayDescriptions;
    if (!Array.isArray(desc) || desc.length < 7) return null;
    const idx = (new Date().getDay() + 6) % 7; // 0=月曜
    return desc[idx] || null;
  }

  async function fetchPlace(placeId) {
    const { Place } = await google.maps.importLibrary('places');
    const place = new Place({ id: placeId });
    await place.fetchFields({ fields: [
      'displayName', 'formattedAddress', 'rating', 'userRatingCount',
      'regularOpeningHours', 'nationalPhoneNumber', 'websiteURI',
      'googleMapsURI', 'photos', 'location', 'types',
    ] });
    let openNow = null;
    try { const o = await place.isOpen(); if (typeof o === 'boolean') openNow = o; } catch (e) { /* 取得不可は null */ }
    const photoUrls = (place.photos || []).slice(0, 5)
      .map((ph) => { try { return ph.getURI({ maxWidth: 400, maxHeight: 400 }); } catch (e) { return null; } })
      .filter(Boolean);
    const { lat, lng } = coord(place.location);
    return {
      name: place.displayName || '(名称不明)',
      address: place.formattedAddress || '',
      rating: (typeof place.rating === 'number') ? place.rating : null,
      ratingCount: (typeof place.userRatingCount === 'number') ? place.userRatingCount : null,
      openNow,
      hoursToday: hoursToday(place.regularOpeningHours),
      phone: place.nationalPhoneNumber || null,
      website: place.websiteURI || null,
      googleMapsURI: place.googleMapsURI || null,
      photoUrls, lat, lng,
      genre: genreFromTypes(place.types),
    };
  }

  // 生の suggestions（Google）→ 正規化。google 非依存でテスト可能。
  function _normalizePredictions(suggestions) {
    return (suggestions || [])
      .map((s) => s && s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        mainText: (p.mainText && p.mainText.text) || (p.text && p.text.text) || '',
        secondaryText: (p.secondaryText && p.secondaryText.text) || '',
      }))
      .filter((x) => x.placeId && x.mainText);
  }

  function _selfTest() {
    const raw = [
      { placePrediction: { placeId: 'a', mainText: { text: 'スカイツリー' }, secondaryText: { text: '東京都墨田区' } } },
      { placePrediction: { placeId: 'b', mainText: { text: 'マクドナルド 渋谷' }, secondaryText: { text: '東京都渋谷区' } } },
      { placePrediction: { placeId: '', mainText: { text: '欠番' } } },
      { queryPrediction: { text: { text: 'クエリ候補' } } },
    ];
    const out = _normalizePredictions(raw);
    const eq = (name, got, want) => console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name, got);
    eq('normalize-count', out.length, 2);
    eq('normalize-main', out[0].mainText, 'スカイツリー');
    eq('normalize-sub', out[0].secondaryText, '東京都墨田区');
    eq('normalize-drops-empty-id', out.every((x) => x.placeId), true);
  }

  async function newSessionToken() {
    const { AutocompleteSessionToken } = await google.maps.importLibrary('places');
    return new AutocompleteSessionToken();
  }

  // query → 正規化候補[]。opts.bias=LatLngBounds|null, opts.token=session token
  async function searchPlaces(query, opts) {
    opts = opts || {};
    const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
    const req = { input: query, language: 'ja', region: 'JP' };
    if (opts.token) req.sessionToken = opts.token;
    if (opts.bias) req.locationBias = opts.bias;
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return _normalizePredictions(suggestions);
  }

  // Place.searchByText の結果 → 正規化（google 非依存でテスト可能）
  function _normalizeTextResults(places) {
    return (places || []).map((p) => {
      const loc = p && p.location;
      const lat = loc ? (typeof loc.lat === 'function' ? loc.lat() : loc.lat) : null;
      const lng = loc ? (typeof loc.lng === 'function' ? loc.lng() : loc.lng) : null;
      const name = (p && (typeof p.displayName === 'string'
        ? p.displayName : (p.displayName && p.displayName.text))) || '';
      const addr = (p && p.formattedAddress) || '';
      return { placeId: p && p.id, name, lat, lng, genre: genreFromTypes(p && p.types), addr };
    }).filter((x) => x.placeId && x.lat != null && x.lng != null);
  }

  function _selfTestText() {
    const raw = [
      { id: 'a', displayName: 'スカイツリー', location: { lat: 35.7, lng: 139.8 }, types: ['tourist_attraction'] },
      { id: 'b', displayName: { text: 'マック渋谷' }, location: { lat: () => 35.6, lng: () => 139.7 }, types: ['restaurant'] },
      { id: 'c', displayName: '座標なし', types: ['store'] },
    ];
    const out = _normalizeTextResults(raw);
    const eq = (n, g, w) => console.log((g === w ? 'PASS' : 'FAIL') + ' ' + n, g);
    eq('text-count', out.length, 2);
    eq('text-name-str', out[0].name, 'スカイツリー');
    eq('text-name-obj', out[1].name, 'マック渋谷');
    eq('text-latfn', out[1].lat, 35.6);
    eq('text-genre-sightsee', out[0].genre, 'sightsee');
    eq('text-genre-food', out[1].genre, 'food');
    eq('text-drop-noloc', out.every((x) => x.lat != null), true);
  }

  // query → 座標付き候補[]（最大20）。opts.bias=LatLngBounds|null
  // bias は現在の表示範囲。並びは既定（関連度＋近さ）＝Googleマップ風。
  async function searchText(query, opts) {
    opts = opts || {};
    const { Place } = await google.maps.importLibrary('places');
    const req = {
      textQuery: query,
      fields: ['id', 'displayName', 'location', 'types', 'formattedAddress'],
      language: 'ja', region: 'JP', maxResultCount: 20,
    };
    if (opts.bias) req.locationBias = opts.bias;
    const { places } = await Place.searchByText(req);
    return _normalizeTextResults(places);
  }

  // (lat,lng) の近くの店・施設を距離順に取得。正規化は searchText と同型。
  // opts.radius=半径m（既定120）, opts.max=最大件数（既定8）
  async function nearbyPlaces(lat, lng, opts) {
    opts = opts || {};
    const { Place, SearchNearbyRankPreference } =
      await google.maps.importLibrary('places');
    const req = {
      fields: ['id', 'displayName', 'location', 'types', 'formattedAddress'],
      locationRestriction: { center: { lat, lng }, radius: opts.radius || 120 },
      maxResultCount: opts.max || 8,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
      language: 'ja', region: 'JP',
    };
    const { places } = await Place.searchNearby(req);
    return _normalizeTextResults(places); // [{ placeId, name, lat, lng, genre }]
  }

  return { fetchPlace, genreFromTypes, searchPlaces, searchText, nearbyPlaces, newSessionToken,
           _normalizePredictions, _normalizeTextResults, _selfTest, _selfTestText };
})();
