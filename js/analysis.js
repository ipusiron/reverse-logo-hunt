// 1つのロゴ領域について「検索 → 詳細 → ロゴの照合 → 並べ替え」を行う（通信と画像の読み込みを含む）
import { describe, compare } from "./logo-match.js";
import { rankCandidates } from "./candidate-rank.js";
import { normalizeFileName } from "./commons-core.js";
import { searchEntities, fetchDetails } from "./wikidata.js";
import { fetchImageInfo } from "./commons.js";

// 照合する候補の上限（Commons の画像の取得を増やしすぎない）
export const MAX_VISUAL = 6;

export function imageDataOf(source) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: d.width, height: d.height, data: d.data };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load"));
    img.src = src;
  });
}

// roiDesc は logo-match.js の describe() の結果。onStep(key, params) で進み具合を知らせる
export async function findCandidates(query, roiDesc, { uiLang = "ja", onStep = () => {} } = {}) {
  onStep("progress.search", { query });
  const found = await searchEntities(query, uiLang);
  if (!found.length) return [];
  const details = await fetchDetails(found.map((c) => c.qid), uiLang);
  const cands = found.map((c) => {
    const d = details.get(c.qid) || { logoFiles: [], hq: null, isOrg: false, isBrand: false };
    return { ...c, logoFiles: d.logoFiles, hq: d.hq, isOrg: d.isOrg, isBrand: d.isBrand, logo: null, match: null, matchError: false };
  });
  const withLogo = cands.filter((c) => c.logoFiles.length).slice(0, MAX_VISUAL);
  if (withLogo.length) {
    let infos = new Map();
    try {
      infos = await fetchImageInfo(withLogo.map((c) => c.logoFiles[0]));
    } catch {
      withLogo.forEach((c) => (c.matchError = true));
    }
    for (const c of withLogo) {
      const info = infos.get(normalizeFileName(c.logoFiles[0]));
      if (!info) continue;
      c.logo = { file: normalizeFileName(c.logoFiles[0]), ...info };
      onStep("progress.match", { label: c.label });
      try {
        const img = await loadImage(info.thumburl);
        c.match = compare(roiDesc, describe(imageDataOf(img), { reference: true }));
      } catch {
        c.matchError = true;
      }
    }
  }
  return rankCandidates(cands);
}
