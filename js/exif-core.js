// EXIF の GPS を緯度・経度にする（計算部。DOM に依存しない）
//
// ExifReader 4.x を { expanded: true } で読むと、tags.gps.Latitude / Longitude は
// 南緯・西経を負にした10進の数値で返る（2026-10-09 に京都・シドニー・リオの3枚で確認）。
// 念のため、tags.exif の GPSLatitude（度・分・秒の有理数）と参照（N/S/E/W）からも求められるようにする。

function rationalToNumber(r) {
  if (typeof r === "number") return r;
  if (Array.isArray(r) && r.length === 2) return r[1] ? r[0] / r[1] : NaN;
  if (r && typeof r === "object" && "numerator" in r) return r.denominator ? r.numerator / r.denominator : NaN;
  return Number.parseFloat(r);
}

export function dmsToDecimal(dms, ref) {
  let v;
  if (Array.isArray(dms) && dms.length >= 3) {
    v = rationalToNumber(dms[0]) + rationalToNumber(dms[1]) / 60 + rationalToNumber(dms[2]) / 3600;
  } else {
    v = rationalToNumber(dms);
  }
  if (!Number.isFinite(v)) return NaN;
  const r = Array.isArray(ref) ? ref[0] : ref;
  return r === "S" || r === "W" ? -Math.abs(v) : v;
}

function valid(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // 測位できなかったカメラが 0,0 を書くことがあるので、ちょうど 0,0 は位置なしとみなす
  return !(lat === 0 && lng === 0);
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

export function gpsFromTags(tags) {
  if (!tags || typeof tags !== "object") return null;
  const g = tags.gps;
  if (g && typeof g.Latitude === "number" && typeof g.Longitude === "number") {
    return valid(g.Latitude, g.Longitude) ? { lat: round6(g.Latitude), lng: round6(g.Longitude) } : null;
  }
  const e = tags.exif || tags;
  const pick = (k) => (e[k] && "value" in e[k] ? e[k].value : e[k]);
  const lat = dmsToDecimal(pick("GPSLatitude"), pick("GPSLatitudeRef"));
  const lng = dmsToDecimal(pick("GPSLongitude"), pick("GPSLongitudeRef"));
  return valid(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
}
