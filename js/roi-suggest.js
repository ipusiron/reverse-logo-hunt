// 「自動で候補を囲む」（計算部。DOM に依存しない）
//
// ロゴや看板の文字は「周りより明暗の差が大きい画素のまとまり」として現れる。
//   1. 長辺 320px 程度に縮める（速さのため）
//   2. 縦横の明るさの差（Sobel）が大きい画素を「インク」とみなす
//   3. 横に近いインクどうしをつなぐ（文字を語・ロゴの単位にまとめる）、縦にも少しつなぐ
//   4. つながった塊の外接矩形を候補にし、小さすぎ・大きすぎ・細すぎるものを外す
//   5. 少し余白を足して元の大きさに戻し、重なるものはまとめる
// 物体検出のモデルは使わない（ロゴの検出には向かず、読み込みも重いため）。

export const WORK_SIZE = 320;
export const EDGE_THRESHOLD = 90;

function downscale(img, size) {
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const gray = new Float32Array(w * h);
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < img.height; y++) {
    const gy = Math.min(h - 1, Math.floor(y * scale));
    for (let x = 0; x < img.width; x++) {
      const gx = Math.min(w - 1, Math.floor(x * scale));
      const i = (y * img.width + x) * 4;
      const a = img.data[i + 3] / 255;
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      gray[gy * w + gx] += lum * a + 255 * (1 - a);
      cnt[gy * w + gx] += 1;
    }
  }
  for (let k = 0; k < gray.length; k++) gray[k] = cnt[k] ? gray[k] / cnt[k] : 255;
  return { w, h, gray, scale };
}

function inkMask(g, w, h, threshold) {
  const m = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      if (Math.abs(gx) + Math.abs(gy) > threshold) m[i] = 1;
    }
  }
  return m;
}

// 横方向に gap 以内のインクをつなぎ、縦方向に vgap 以内をつなぐ
function close(m, w, h, gap, vgap) {
  const out = new Uint8Array(m);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (last >= 0 && x - last <= gap) for (let k = last + 1; k < x; k++) out[y * w + k] = 1;
      last = x;
    }
  }
  const out2 = new Uint8Array(out);
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) {
      if (!out[y * w + x]) continue;
      if (last >= 0 && y - last <= vgap) for (let k = last + 1; k < y; k++) out2[k * w + x] = 1;
      last = y;
    }
  }
  return out2;
}

function components(m, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const boxes = [];
  const stack = [];
  for (let start = 0; start < m.length; start++) {
    if (!m[start] || label[start] >= 0) continue;
    const id = boxes.length;
    const b = { x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      b.n++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && m[q] && label[q] < 0) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    boxes.push(b);
  }
  return boxes;
}

export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

// img は RGBA の { width, height, data }。戻り値は元の画像の座標の [{ x, y, w, h, score }]（score の大きい順）
export function suggestRois(img, { max = 8 } = {}) {
  const { w, h, gray, scale } = downscale(img, WORK_SIZE);
  if (w < 8 || h < 8) return [];
  const ink = inkMask(gray, w, h, EDGE_THRESHOLD);
  const joined = close(ink, w, h, Math.max(2, Math.round(w * 0.03)), Math.max(1, Math.round(h * 0.01)));
  const area = w * h;
  const out = [];
  for (const b of components(joined, w, h)) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (bw < 6 || bh < 4) continue;
    if (bw * bh < area * 0.002 || bw * bh > area * 0.6) continue;
    const aspect = bw / bh;
    if (aspect > 16 || aspect < 1 / 6) continue;
    const fill = b.n / (bw * bh);
    const padX = Math.max(1, Math.round(bw * 0.08));
    const padY = Math.max(1, Math.round(bh * 0.15));
    const x0 = Math.max(0, b.x0 - padX);
    const y0 = Math.max(0, b.y0 - padY);
    const x1 = Math.min(w, b.x1 + 1 + padX);
    const y1 = Math.min(h, b.y1 + 1 + padY);
    out.push({
      x: Math.floor(x0 / scale),
      y: Math.floor(y0 / scale),
      w: Math.min(img.width, Math.ceil(x1 / scale)) - Math.floor(x0 / scale),
      h: Math.min(img.height, Math.ceil(y1 / scale)) - Math.floor(y0 / scale),
      score: Math.round(Math.sqrt((bw * bh) / area) * Math.min(1, fill * 2) * 1000) / 1000,
    });
  }
  out.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const r of out) {
    if (kept.some((k) => iou(k, r) > 0.3)) continue;
    kept.push(r);
    if (kept.length >= max) break;
  }
  return kept;
}
