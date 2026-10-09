// テスト用の合成画像（実在のロゴは使わない）。RGBA の { width, height, data } を作る
// test/ の下の .js は node --test がすべて読み込むので、ここではテストを定義せず関数だけを出す。

export function makeImage(w, h, rgba = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}

export function fillRect(img, x, y, w, h, rgba) {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) img.data.set(rgba, (yy * img.width + xx) * 4);
  }
  return img;
}

export function fillEllipse(img, cx, cy, rx, ry, rgba) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) img.data.set(rgba, (y * img.width + x) * 4);
    }
  }
  return img;
}

// 参照ロゴを地の色の上に余白つきで置く（写真から切り出した領域のつもり）
export function place(logo, bg, margin) {
  const out = makeImage(logo.width + margin * 2, logo.height + margin * 2, [...bg, 255]);
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      const i = (y * logo.width + x) * 4;
      const a = logo.data[i + 3] / 255;
      const o = ((y + margin) * out.width + x + margin) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(logo.data[i + c] * a + out.data[o + c] * (1 - a));
    }
  }
  return out;
}

// 暗い色（明度 90 未満）の前景を白に置き換える（暗い地の看板の白抜きのつもり）
export function invertDark(logo) {
  const out = { width: logo.width, height: logo.height, data: new Uint8ClampedArray(logo.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] > 0 && Math.max(out.data[i], out.data[i + 1], out.data[i + 2]) < 90) out.data.set([245, 245, 245], i);
  }
  return out;
}

const RED = [220, 0, 18, 255];
const WHITE = [255, 255, 255, 255];
const BLACK = [20, 20, 20, 255];
const BLUE = [20, 60, 200, 255];
const GREEN = [20, 160, 60, 255];
const CLEAR = [0, 0, 0, 0];

// 端まで赤い横長の札に白い枠と白い字（の棒）
export function redBadge() {
  const img = makeImage(120, 40, RED);
  fillRect(img, 6, 5, 108, 2, WHITE);
  fillRect(img, 6, 33, 108, 2, WHITE);
  for (const x of [18, 34, 50, 66, 82, 98]) fillRect(img, x, 12, 6, 16, WHITE);
  return img;
}

// 透明な地に黒い輪
export function blackRing() {
  const img = makeImage(80, 80, CLEAR);
  fillEllipse(img, 40, 40, 36, 36, BLACK);
  fillEllipse(img, 40, 40, 22, 22, CLEAR);
  return img;
}

function word(color) {
  const img = makeImage(150, 40, CLEAR);
  const bars = [[4, 20], [30, 12], [48, 26], [80, 10], [96, 22], [124, 20]];
  for (const [x, w] of bars) fillRect(img, x, 6, w, 28, color);
  fillRect(img, 4, 34, 140, 3, color);
  return img;
}

// 透明な地に青い字（の棒）。greenWord は形が同じで色だけ違う
export function blueWord() {
  return word(BLUE);
}

export function greenWord() {
  return word(GREEN);
}
