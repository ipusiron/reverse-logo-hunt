import test from "node:test";
import assert from "node:assert/strict";
import { prepareForOcr, ocrScale, isDarkBackground, removeFrames, otsuThreshold, TARGET_HEIGHT, MAX_SCALE } from "../js/ocr-prep.js";
import { makeImage, fillRect } from "./synthetic.js";

test("小さい領域は高さ120pxまで拡大し、3倍を超えない", () => {
  assert.equal(ocrScale(40), MAX_SCALE);
  assert.equal(ocrScale(60), 2);
  assert.equal(ocrScale(TARGET_HEIGHT), 1);
  assert.equal(ocrScale(500), 1);
  const out = prepareForOcr(makeImage(100, 60, [255, 255, 255, 255]));
  assert.deepEqual([out.width, out.height, out.scale], [200, 120, 2]);
});

test("白地に黒い字はそのまま、暗い地の白抜きは反転して白地に黒い字にそろえる", () => {
  const light = fillRect(makeImage(50, 20, [250, 250, 250, 255]), 10, 5, 30, 10, [10, 10, 10, 255]);
  const dark = fillRect(makeImage(50, 20, [20, 20, 30, 255]), 10, 5, 30, 10, [245, 245, 245, 255]);
  assert.equal(isDarkBackground(light), false);
  assert.equal(isDarkBackground(dark), true);
  for (const img of [light, dark]) {
    const out = prepareForOcr(img);
    const at = (x, y) => out.data[(y * out.width + x) * 4];
    assert.ok(at(0, 0) > 200, "地は白");
    assert.ok(at(Math.round(20 * out.scale), Math.round(10 * out.scale)) < 60, "字は黒");
  }
});

test("反転の向きを指定できる（読み直し用）", () => {
  const light = fillRect(makeImage(50, 20, [250, 250, 250, 255]), 10, 5, 30, 10, [10, 10, 10, 255]);
  assert.equal(prepareForOcr(light).inverted, false);
  assert.equal(prepareForOcr(light, { invert: true }).inverted, true);
  assert.ok(prepareForOcr(light, { invert: true }).data[0] < 10, "地が黒になる");
});

test("大津のしきい値は、2つの山の間に来る", () => {
  const values = [...new Array(100).fill(20), ...new Array(100).fill(220)];
  const t = otsuThreshold(values);
  assert.ok(t >= 20 && t < 220, `t=${t}`);
});

test("字を囲む枠（画像の幅いっぱいの塊）を取り除き、中の字は残す", () => {
  const img = makeImage(200, 80, [235, 235, 235, 255]);
  // 角丸の代わりに四角い枠
  fillRect(img, 4, 4, 192, 4, [0, 0, 0, 255]);
  fillRect(img, 4, 72, 192, 4, [0, 0, 0, 255]);
  fillRect(img, 4, 4, 4, 72, [0, 0, 0, 255]);
  fillRect(img, 192, 4, 4, 72, [0, 0, 0, 255]);
  // 中の字（棒）
  for (const x of [30, 60, 90, 120, 150]) fillRect(img, x, 25, 12, 30, [0, 0, 0, 255]);
  const out = removeFrames(img);
  const at = (x, y) => out.data[(y * out.width + x) * 4];
  assert.equal(at(5, 5), 255, "枠は白に");
  assert.equal(at(100, 74), 255, "枠は白に");
  assert.equal(at(35, 40), 0, "字は残る");
  assert.equal(at(155, 40), 0, "字は残る");
  const prepared = prepareForOcr(img, { frames: true });
  const pt = (x, y) => prepared.data[(Math.round(y * prepared.scale) * prepared.width + Math.round(x * prepared.scale)) * 4];
  assert.equal(pt(5, 5), 255, "拡大したあとも枠は白");
  assert.equal(pt(35, 40), 0, "拡大したあとも字は残る");
});
