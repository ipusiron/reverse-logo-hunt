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

// 最近傍で拡大し、グレースケール（必要なら反転）にした RGBA を返す
export function prepareForOcr(img) {
  const scale = ocrScale(img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const invert = isDarkBackground(img);
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
  return { width: w, height: h, data: out, scale, inverted: invert };
}
