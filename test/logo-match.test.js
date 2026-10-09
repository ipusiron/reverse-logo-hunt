import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/logo-match.js";
import { makeImage, fillRect, place, invertDark, redBadge, blackRing, blueWord, greenWord } from "./synthetic.js";

const REFS = { redBadge: redBadge(), blackRing: blackRing(), blueWord: blueWord(), greenWord: greenWord() };
const REF_DESC = Object.fromEntries(Object.entries(REFS).map(([k, v]) => [k, M.describe(v, { reference: true })]));

function ranking(query) {
  const q = M.describe(query);
  return Object.entries(REF_DESC)
    .map(([k, d]) => ({ k, ...M.compare(q, d) }))
    .sort((a, b) => b.total - a.total);
}

test("透明な画素は白に合成する", () => {
  const img = makeImage(2, 1, [0, 0, 0, 0]);
  img.data.set([255, 0, 0, 255], 4);
  const out = M.compositeOnWhite(img);
  assert.deepEqual([...out.data], [255, 255, 255, 255, 255, 0, 0, 255]);
});

test("外周の色を背景とみなす", () => {
  const img = makeImage(20, 20, [10, 20, 30, 255]);
  fillRect(img, 5, 5, 10, 10, [250, 250, 250, 255]);
  assert.deepEqual(M.estimateBackground(img), [10, 20, 30]);
});

test("参照ロゴの前景の決め方は3通り", () => {
  assert.equal(REF_DESC.blackRing.mode, "alpha");
  assert.equal(REF_DESC.blueWord.mode, "alpha");
  assert.equal(REF_DESC.redBadge.mode, "full");
  const onWhite = place(blackRing(), [255, 255, 255], 0);
  assert.equal(M.describe(onWhite, { reference: true }).mode, "difference");
});

test("前景の外接矩形は余白を除いた大きさになる", () => {
  const d = M.describe(place(blueWord(), [250, 250, 247], 12));
  assert.deepEqual([d.box.w, d.box.h], [140, 31]);
});

test("紙・灰色の地・暗い地に置いても本物が1位になる", () => {
  const cases = [
    ["redBadge", place(redBadge(), [250, 250, 247], 10)],
    ["redBadge", place(redBadge(), [32, 34, 40], 10)],
    ["blackRing", place(blackRing(), [250, 250, 247], 8)],
    ["blackRing", place(invertDark(blackRing()), [32, 34, 40], 8)],
    ["blueWord", place(blueWord(), [226, 224, 218], 14)],
    ["greenWord", place(greenWord(), [250, 250, 247], 14)],
  ];
  for (const [want, img] of cases) {
    const r = ranking(img);
    assert.equal(r[0].k, want, `${want} が1位にならない: ${r.map((x) => `${x.k}:${x.total}`).join(" ")}`);
  }
});

test("白抜き（明暗が反転）でも形と明暗の構造は近い", () => {
  const q = M.describe(place(invertDark(blackRing()), [32, 34, 40], 8));
  const s = M.compare(q, REF_DESC.blackRing);
  assert.ok(s.shape > 0.9, `shape=${s.shape}`);
  assert.ok(s.structure > 0.9, `structure=${s.structure}`);
  assert.equal(s.color, 1);
});

test("色だけ違う偽物は、形が近く色が遠い", () => {
  const q = M.describe(place(greenWord(), [250, 250, 247], 14));
  const s = M.compare(q, REF_DESC.blueWord);
  assert.ok(s.shape > 0.95, `shape=${s.shape}`);
  assert.ok(s.color < 0.1, `color=${s.color}`);
});

test("値はすべて 0..1 で、合計は重みのとおり", () => {
  const q = M.describe(place(redBadge(), [250, 250, 247], 10));
  for (const d of Object.values(REF_DESC)) {
    const s = M.compare(q, d);
    for (const k of ["shape", "structure", "aspect", "color", "total"]) assert.ok(s[k] >= 0 && s[k] <= 1, `${k}=${s[k]}`);
    const w = M.WEIGHTS;
    const expected = w.shape * s.shape + w.structure * s.structure + w.aspect * s.aspect + w.color * s.color;
    assert.ok(Math.abs(s.total - expected) < 0.003);
  }
  assert.equal(M.WEIGHTS.shape + M.WEIGHTS.structure + M.WEIGHTS.aspect + M.WEIGHTS.color, 1);
});

test("前景のない一様な画像でも例外にならない", () => {
  const d = M.describe(makeImage(30, 30, [200, 200, 200, 255]));
  assert.equal(d.box.empty, true);
  const s = M.compare(d, REF_DESC.redBadge);
  assert.ok(Number.isFinite(s.total));
});

test("大きさと画素数の合わない入力は拒否する", () => {
  assert.throws(() => M.describe({ width: 2, height: 2, data: new Uint8ClampedArray(3) }));
  assert.throws(() => M.describe({ width: 0, height: 2, data: new Uint8ClampedArray(0) }));
});
