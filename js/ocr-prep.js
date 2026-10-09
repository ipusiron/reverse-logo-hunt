// OCR に渡す前の下ごしらえ（計算部。DOM に依存しない）
//   - 小さい領域は、高さが TARGET_HEIGHT になるまで拡大する（最大3倍。Tesseract は小さい字を読み落とす）
//   - グレースケールにする
//   - 地が暗い（白抜きの看板）ときは明暗を反転して「白地に黒い字」にそろえる
import { estimateBackground } from "./logo-match.js";

export const TARGET_HEIGHT = 120;
export const MAX_SCALE = 3;

export function ocrScale(height) {
  if (!(height > 0)) return 1;
  return Math.max(1, Math.min(MAX_SCALE, TARGET_HEIGHT / height));
}

export function isDarkBackground(img) {
  const [r, g, b] = estimateBackground(img);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

// 大津の方法で、明るさのしきい値を決める（0..255 の値の配列）
export function otsuThreshold(values) {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[v] += 1;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// 白地に黒い字の画像を2値にし、横か縦に大きく広がる黒い塊（ロゴの枠・札の縁）を白で塗りつぶす
//   Tesseract は、字を囲む枠があると領域ごと「図」とみなして字を探さないことがある（Nintendo のロゴで実測）。
//   1つの字が画像の幅の70%・高さの90%を超えることはまずないので、それを超える塊を枠とみなす。
export function removeFrames(img, { maxWidth = 0.7, maxHeight = 0.9 } = {}) {
  const { width: w, height: h } = img;
  const lum = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) lum[p] = img.data[p * 4];
  const t = otsuThreshold(lum);
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) dark[p] = lum[p] <= t ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const pixels = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    pixels.length = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const q = stack.pop();
      pixels.push(q);
      const x = q % w;
      const y = (q - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) {
        if (n >= 0 && dark[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (x1 - x0 + 1 > w * maxWidth || y1 - y0 + 1 > h * maxHeight) for (const q of pixels) dark[q] = 0;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < dark.length; p++) {
    const v = dark[p] ? 0 : 255;
    out[p * 4] = v;
    out[p * 4 + 1] = v;
    out[p * 4 + 2] = v;
    out[p * 4 + 3] = 255;
  }
  return { ...img, data: out };
}

// 最近傍で拡大し、グレースケール（必要なら反転）にした RGBA を返す
// invert を省くと地の明るさで決める。true・false を渡すとそのとおりにする（1回目で読めなかったときの読み直しに使う）
// frames=true で、枠を取り除いた2値の画像にする（読み直し用）
export function prepareForOcr(img, { invert: forced, frames = false } = {}) {
  const scale = ocrScale(img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const invert = typeof forced === "boolean" ? forced : isDarkBackground(img);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const i = (sy * img.width + sx) * 4;
      let v = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
      if (invert) v = 255 - v;
      const o = (y * w + x) * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  const prepared = { width: w, height: h, data: out, scale, inverted: invert };
  return frames ? removeFrames(prepared) : prepared;
}
