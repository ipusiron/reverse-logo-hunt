// ロゴの照合（計算部。DOM に依存しない）
// 入力の画像は { width, height, data }（data は RGBA の Uint8ClampedArray か同じ形の配列）。
//
// 方針: 背景を推定して前景（ロゴの部分）だけを取り出し、次の4つを別々に比べる。
//   形     … 前景の外接矩形を 32×32 の格子に収めた「前景の割合」の重なり（柔らかい IoU）
//   明暗   … 外接矩形の中の明るさの並び（24×24、平均0・分散1）の相関の絶対値。白抜きの看板にも使える
//   縦横比 … 前景の外接矩形の縦横比の近さ
//   色     … 前景の画素だけの色相12区分＋無彩色1区分の分布のコサイン類似度（白と黒は区別しない）
// Commons などの参照ロゴは透明な背景が多いので、透明度があれば透明度で前景を決める。

export const GRID = 32;
export const STRUCTURE_GRID = 24;
export const FG_THRESHOLD = 60;
export const WEIGHTS = Object.freeze({ shape: 0.35, structure: 0.25, aspect: 0.15, color: 0.25 });

function assertImage(img) {
  if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) {
    throw new TypeError("画像の大きさが不正です");
  }
  if (!img.data || img.data.length !== img.width * img.height * 4) {
    throw new TypeError("画像の画素数が大きさと合いません");
  }
}

// 透明な画素を白に合成する（参照ロゴの透明な背景を「白い紙」として扱う）
export function compositeOnWhite(img) {
  assertImage(img);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = Math.round(img.data[i] * a + 255 * (1 - a));
    out[i + 1] = Math.round(img.data[i + 1] * a + 255 * (1 - a));
    out[i + 2] = Math.round(img.data[i + 2] * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// 外周（最大2px）の画素の中央値を背景色とみなす
export function estimateBackground(img) {
  assertImage(img);
  const { width: w, height: h, data } = img;
  const ring = Math.max(1, Math.min(2, Math.floor(Math.min(w, h) / 4)));
  const r = [];
  const g = [];
  const b = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      r.push(data[i]);
      g.push(data[i + 1]);
      b.push(data[i + 2]);
    }
  }
  return [median(r), median(g), median(b)];
}

export function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// 背景色との距離が threshold を超える画素を前景（1）にする
export function foregroundMask(img, bg, threshold = FG_THRESHOLD) {
  assertImage(img);
  const { width: w, height: h, data } = img;
  const m = new Uint8Array(w * h);
  const t2 = threshold * threshold;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    m[p] = dr * dr + dg * dg + db * db > t2 ? 1 : 0;
  }
  return { width: w, height: h, data: m };
}

function fullMask(w, h) {
  return { width: w, height: h, data: new Uint8Array(w * h).fill(1) };
}

function alphaMask(img) {
  const m = new Uint8Array(img.width * img.height);
  for (let p = 0; p < m.length; p++) m[p] = img.data[p * 4 + 3] >= 128 ? 1 : 0;
  return { width: img.width, height: img.height, data: m };
}

// 外周の画素のうち不透明（alpha >= 128）なものの割合
export function opaqueBorderRatio(img) {
  assertImage(img);
  const { width: w, height: h, data } = img;
  let n = 0;
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) continue;
      n++;
      if (data[(y * w + x) * 4 + 3] >= 128) opaque++;
    }
  }
  return n ? opaque / n : 1;
}

// 前景の外接矩形。前景がなければ画像全体を返し empty を立てる
export function contentBox(mask) {
  const { width: w, height: h, data } = mask;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h, empty: true };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, empty: false };
}

// 外接矩形を縦横比を保って size×size に収めたときの、各マスの「前景の割合」（3×3 でならす）
export function maskGrid(mask, box, size = GRID) {
  const sum = new Float32Array(size * size);
  const cnt = new Float32Array(size * size);
  const scale = size / Math.max(box.w, box.h);
  const offX = (size - box.w * scale) / 2;
  const offY = (size - box.h * scale) / 2;
  for (let y = 0; y < box.h; y++) {
    const gy = Math.min(size - 1, Math.floor(offY + (y + 0.5) * scale));
    for (let x = 0; x < box.w; x++) {
      const gx = Math.min(size - 1, Math.floor(offX + (x + 0.5) * scale));
      const k = gy * size + gx;
      sum[k] += mask.data[(box.y + y) * mask.width + box.x + x];
      cnt[k] += 1;
    }
  }
  for (let k = 0; k < sum.length; k++) sum[k] = cnt[k] ? sum[k] / cnt[k] : 0;
  return smooth3(sum, size);
}

function smooth3(g, n) {
  const out = new Float32Array(g.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= n || xx < 0 || xx >= n) continue;
          s += g[yy * n + xx];
          c++;
        }
      }
      out[y * n + x] = s / c;
    }
  }
  return out;
}

// 外接矩形の中の明るさを size×size に縮め、平均0・分散1にそろえる（外接矩形の外は背景の明るさで埋める）
export function structureGrid(img, box, bg, size = STRUCTURE_GRID) {
  const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const acc = new Float32Array(size * size);
  const cnt = new Float32Array(size * size);
  const scale = size / Math.max(box.w, box.h);
  const offX = (size - box.w * scale) / 2;
  const offY = (size - box.h * scale) / 2;
  for (let y = 0; y < box.h; y++) {
    const gy = Math.min(size - 1, Math.floor(offY + (y + 0.5) * scale));
    for (let x = 0; x < box.w; x++) {
      const gx = Math.min(size - 1, Math.floor(offX + (x + 0.5) * scale));
      const i = ((box.y + y) * img.width + box.x + x) * 4;
      acc[gy * size + gx] += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      cnt[gy * size + gx] += 1;
    }
  }
  const lum = new Float32Array(size * size);
  for (let k = 0; k < lum.length; k++) lum[k] = cnt[k] ? acc[k] / cnt[k] : bgLum;
  let mean = 0;
  for (const v of lum) mean += v;
  mean /= lum.length;
  let sd = 0;
  for (const v of lum) sd += (v - mean) * (v - mean);
  sd = Math.sqrt(sd / lum.length);
  return lum.map((v) => (sd > 1e-6 ? (v - mean) / sd : 0));
}

// 前景の画素だけで、色相12区分＋無彩色1区分（彩度0.25未満か明度0.2未満）
export function colorSignature(img, mask) {
  const bins = new Float32Array(13);
  const d = img.data;
  for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
    if (!mask.data[p]) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    if (s < 0.25 || mx < 0.2) {
      bins[12] += 1;
      continue;
    }
    const dd = mx - mn;
    let h;
    if (mx === r) h = ((g - b) / dd + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / dd + 2) / 6;
    else h = ((r - g) / dd + 4) / 6;
    bins[Math.floor(h * 12) % 12] += 1;
  }
  return bins;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function shapeSimilarity(a, b) {
  let mn = 0;
  let mx = 0;
  for (let i = 0; i < a.length; i++) {
    mn += Math.min(a[i], b[i]);
    mx += Math.max(a[i], b[i]);
  }
  return mx ? mn / mx : 0;
}

export function structureSimilarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return Math.min(1, Math.abs(s / a.length));
}

export function aspectSimilarity(boxA, boxB) {
  const ra = boxA.w / boxA.h;
  const rb = boxB.w / boxB.h;
  return Math.exp(-Math.abs(Math.log(ra / rb)) * 1.5);
}

// 画像の特徴をまとめて求める。reference=true は Commons などの参照ロゴ
//   外周の半分以上が透明 → 透明度で前景を決める
//   外周が不透明で白くない（端まで色が塗られたロゴ） → 画像全体を前景にする
//   それ以外（写真から切り出した領域など） → 外周の色を背景として差で決める
export function describe(input, { reference = false } = {}) {
  assertImage(input);
  const img = compositeOnWhite(input);
  let bg = estimateBackground(img);
  let mask;
  let mode = "difference";
  if (reference && opaqueBorderRatio(input) < 0.5) {
    bg = [255, 255, 255];
    mask = alphaMask(input);
    mode = "alpha";
  } else if (reference && colorDistance(bg, [255, 255, 255]) > FG_THRESHOLD) {
    mask = fullMask(img.width, img.height);
    mode = "full";
  } else {
    mask = foregroundMask(img, bg);
  }
  const box = contentBox(mask);
  let fg = 0;
  for (const v of mask.data) fg += v;
  return {
    mode,
    bg,
    box,
    foregroundRatio: fg / mask.data.length,
    grid: maskGrid(mask, box),
    structure: structureGrid(img, box, bg),
    color: colorSignature(img, mask),
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// 2つの特徴を比べる。各値は 0..1、total は重みつきの合計
export function compare(a, b) {
  const shape = shapeSimilarity(a.grid, b.grid);
  const structure = structureSimilarity(a.structure, b.structure);
  const aspect = aspectSimilarity(a.box, b.box);
  const color = cosine(a.color, b.color);
  const total = WEIGHTS.shape * shape + WEIGHTS.structure * structure + WEIGHTS.aspect * aspect + WEIGHTS.color * color;
  return { shape: round3(shape), structure: round3(structure), aspect: round3(aspect), color: round3(color), total: round3(total) };
}
