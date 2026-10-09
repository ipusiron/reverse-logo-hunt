import test from "node:test";
import assert from "node:assert/strict";
import { haversineKm, initialBearing, compass8, roundKm, distancesFrom, EARTH_RADIUS_KM } from "../js/geo.js";

const near = (a, b, eps) => Math.abs(a - b) <= eps;

test("赤道上で経度90°離れた2点は、円周の4分の1", () => {
  assert.ok(near(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }), (Math.PI * EARTH_RADIUS_KM) / 2, 1e-6));
  assert.ok(near(haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 }), Math.PI * EARTH_RADIUS_KM, 1e-6));
  assert.equal(haversineKm({ lat: 35, lng: 135 }, { lat: 35, lng: 135 }), 0);
});

test("距離は向きによらず同じ", () => {
  const a = { lat: 35.681111, lng: 139.766944 };
  const b = { lat: 35.011611, lng: 135.768111 };
  assert.ok(near(haversineKm(a, b), haversineKm(b, a), 1e-9));
});

test("方位: 真北0°・真東90°・真南180°・真西270°", () => {
  assert.ok(near(initialBearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 }), 0, 1e-9));
  assert.ok(near(initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }), 90, 1e-9));
  assert.ok(near(initialBearing({ lat: 10, lng: 0 }, { lat: 0, lng: 0 }), 180, 1e-9));
  assert.ok(near(initialBearing({ lat: 0, lng: 10 }, { lat: 0, lng: 0 }), 270, 1e-9));
});

test("8方位", () => {
  // 各方位は ±22.5° の範囲（W は 247.5° 以上 292.5° 未満）
  assert.deepEqual([0, 22, 23, 90, 180, 247, 248, 315, 337.4, 337.6, 359].map(compass8),
    ["N", "N", "NE", "E", "S", "SW", "W", "NW", "NW", "N", "N"]);
});

test("丸め: 10 km 未満は小数1桁", () => {
  assert.equal(roundKm(3.456), 3.5);
  assert.equal(roundKm(365.4), 365);
});

test("撮影地点がない・本社の座標がない会社は距離なし", () => {
  const r = distancesFrom(null, [{ qid: "Q1", coord: { lat: 0, lng: 0 } }]);
  assert.equal(r[0].km, null);
  const r2 = distancesFrom({ lat: 0, lng: 0 }, [{ qid: "Q1", coord: null }, { qid: "Q2", coord: { lat: 0, lng: 1 } }]);
  assert.equal(r2[0].km, null);
  assert.equal(r2[1].dir, "E");
  assert.throws(() => haversineKm({ lat: 91, lng: 0 }, { lat: 0, lng: 0 }));
});
