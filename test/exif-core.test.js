import test from "node:test";
import assert from "node:assert/strict";
import { gpsFromTags, dmsToDecimal } from "../js/exif-core.js";

// ExifReader 4.23.5 を { expanded: true } で読んだときの tags.gps の実際の形（2026-10-09 にブラウザーで確認）
test("ExifReader の expanded（南緯・西経は負の数値）", () => {
  assert.deepEqual(gpsFromTags({ gps: { Latitude: 34.98566666666667, Longitude: 135.75866666666667 } }), { lat: 34.985667, lng: 135.758667 });
  assert.deepEqual(gpsFromTags({ gps: { Latitude: -33.86666666666667, Longitude: 151.2 } }), { lat: -33.866667, lng: 151.2 });
  assert.deepEqual(gpsFromTags({ gps: { Latitude: -22.9, Longitude: -43.2 } }), { lat: -22.9, lng: -43.2 });
});

test("度・分・秒の有理数と N/S/E/W からも求める", () => {
  const tags = {
    exif: {
      GPSLatitude: { value: [[34, 1], [59, 1], [84, 10]] },
      GPSLatitudeRef: { value: ["N"] },
      GPSLongitude: { value: [[135, 1], [45, 1], [312, 10]] },
      GPSLongitudeRef: { value: ["E"] },
    },
  };
  assert.deepEqual(gpsFromTags(tags), { lat: 34.985667, lng: 135.758667 });
  assert.equal(dmsToDecimal([[22, 1], [54, 1], [0, 1]], "S"), -22.9);
});

test("位置のないもの・おかしな値は null", () => {
  assert.equal(gpsFromTags(null), null);
  assert.equal(gpsFromTags({}), null);
  assert.equal(gpsFromTags({ gps: { Latitude: 0, Longitude: 0 } }), null);
  assert.equal(gpsFromTags({ gps: { Latitude: 95, Longitude: 10 } }), null);
  assert.equal(gpsFromTags({ gps: { Latitude: Number.NaN, Longitude: 10 } }), null);
  assert.equal(gpsFromTags({ exif: { GPSLatitude: { value: [[1, 0], [0, 1], [0, 1]] }, GPSLongitude: { value: [[1, 1], [0, 1], [0, 1]] } } }), null);
});
