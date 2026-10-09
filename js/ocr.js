// Tesseract.js（WASM）で文字を読む。ワーカーは言語ごとに1つ作って使い回す
//
// 読み込み先（Tesseract.js 5.0.5 の既定。すべて版を固定した jsDelivr）:
//   ワーカー  https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.5/dist/worker.min.js
//   コア      https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/
//   言語データ https://cdn.jsdelivr.net/npm/@tesseract.js-data/<言語>/4.0.0_best_int/
// 画像そのものはブラウザーの中で処理し、外へは送らない。
import { prepareForOcr } from "./ocr-prep.js";

const workers = new Map();

function getWorker(lang) {
  if (typeof Tesseract === "undefined") return Promise.reject(new Error("tesseract-missing"));
  if (!workers.has(lang)) {
    const p = Tesseract.createWorker(lang, 1, { logger: () => {} });
    p.catch(() => workers.delete(lang));
    workers.set(lang, p);
  }
  return workers.get(lang);
}

function toCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

// patch は canvas。戻り値は { text, words: [{ text, confidence, bbox: { y0, y1 } }], inverted }
// options.invert で明暗の反転を指定できる（省くと地の明るさで決める）
// options.psm でページの区切り方（Tesseract の page segmentation mode）を変えられる。既定は 3（自動）、11 は「まばらな文字」
export async function recognize(patch, lang = "eng", options = {}) {
  const ctx = patch.getContext("2d", { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, patch.width, patch.height);
  const prep = prepareForOcr({ width: src.width, height: src.height, data: src.data }, options);
  const worker = await getWorker(lang);
  const psm = String(options.psm || 3);
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(toCanvas(prep));
  const words = (data.words || []).map((w) => ({
    text: String(w.text || ""),
    confidence: Number(w.confidence) || 0,
    bbox: { y0: w.bbox ? w.bbox.y0 : 0, y1: w.bbox ? w.bbox.y1 : 0 },
  }));
  return { text: String(data.text || "").trim(), words, inverted: prep.inverted };
}
