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

  return { fetchPlace, genreFromTypes };
})();
