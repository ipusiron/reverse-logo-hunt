// 2点の距離と方角（計算部。DOM に依存しない）
// 地球を半径 6371.0088 km の球とみなす大円距離（ハバーサインの式）。楕円体との差は最大で0.5%ほどなので、
// 「撮影地点から本社までどのくらい離れているか」の目安に使う。

export const EARTH_RADIUS_KM = 6371.0088;
export const COMPASS = Object.freeze(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

const rad = (d) => (d * Math.PI) / 180;

function check(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
    throw new TypeError("緯度・経度が不正です");
  }
}

export function haversineKm(a, b) {
  check(a);
  check(b);
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// a から見た b の方位（真北から時計回りの度、0 以上 360 未満）
export function initialBearing(a, b) {
  check(a);
  check(b);
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// 8方位（北・北東・東…）のキー
export function compass8(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// 表示用の km（10 km 未満は小数1桁、それ以上は整数）
export function roundKm(km) {
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}

// 撮影地点から各社の本社までの距離と方角。本社の座標がない会社は km を null にする
export function distancesFrom(shot, companies) {
  return (companies || []).map((c) => {
    if (!shot || !c.coord) return { ...c, km: null, bearing: null, dir: null };
    const km = haversineKm(shot, c.coord);
    const bearing = initialBearing(shot, c.coord);
    return { ...c, km: roundKm(km), bearing: Math.round(bearing), dir: compass8(bearing) };
  });
}
