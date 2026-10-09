import test from "node:test";
import assert from "node:assert/strict";
import { suggestRois, iou } from "../js/roi-suggest.js";
import { makeImage, fillRect } from "./synthetic.js";

// 看板のつもり: 白地に、字の棒を並べた語を2つ（上は赤、下は黒）
function sign() {
  const img = makeImage(1200, 700, [255, 255, 255, 255]);
  for (let i = 0; i < 8; i++) fillRect(img, 120 + i * 72, 140, 50, 80, [228, 0, 15, 255]);
  for (let i = 0; i < 4; i++) fillRect(img, 150 + i * 88, 440, 64, 90, [0, 0, 0, 255]);
  return img;
}

test("語のまとまりを1つずつ囲む", () => {
  const boxes = suggestRois(sign());
  const word1 = { x: 120, y: 140, w: 554, h: 80 };
  const word2 = { x: 150, y: 440, w: 328, h: 90 };
  assert.ok(boxes.length >= 2, JSON.stringify(boxes));
  assert.ok(boxes.some((b) => iou(b, word1) > 0.5), JSON.stringify(boxes));
  assert.ok(boxes.some((b) => iou(b, word2) > 0.5), JSON.stringify(boxes));
});

test("囲みは画像の中に収まり、整数で、大きい順", () => {
  const img = sign();
  const boxes = suggestRois(img);
  for (const b of boxes) {
    for (const k of ["x", "y", "w", "h"]) assert.ok(Number.isInteger(b[k]), `${k}=${b[k]}`);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= img.width && b.y + b.h <= img.height);
  }
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i - 1].score >= boxes[i].score);
});

test("一様な画像では何も囲まない", () => {
  assert.deepEqual(suggestRois(makeImage(400, 300, [240, 240, 240, 255])), []);
  assert.deepEqual(suggestRois(makeImage(4, 4, [0, 0, 0, 255])), []);
});

test("max で数を絞る", () => {
  const img = makeImage(800, 800, [255, 255, 255, 255]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) fillRect(img, 40 + c * 190, 40 + r * 190, 90, 40, [0, 0, 0, 255]);
  assert.equal(suggestRois(img, { max: 5 }).length, 5);
});
