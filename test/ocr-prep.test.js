import test from "node:test";
import assert from "node:assert/strict";
import { prepareForOcr, ocrScale, isDarkBackground, TARGET_HEIGHT, MAX_SCALE } from "../js/ocr-prep.js";
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
