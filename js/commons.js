// Wikimedia Commons への問い合わせ（通信とキャッシュ）。組み立てと解析は commons-core.js
import { getCached, setCached } from "./cache.js";
import { imageInfoUrl, parseImageInfo, normalizeFileName } from "./commons-core.js";
import { getJson } from "./wikidata.js";

const ONE_DAY = 1000 * 60 * 60 * 24;

// ファイル名 → { thumburl, descUrl, artist, license }。キャッシュにないものだけを1回の問い合わせで引く
export async function fetchImageInfo(fileNames) {
  const names = [...new Set(fileNames.map(normalizeFileName).filter(Boolean))];
  const out = new Map();
  const missing = [];
  for (const n of names) {
    const hit = await getCached("commons", `ii:${n}`).catch(() => null);
    if (hit) out.set(n, hit);
    else missing.push(n);
  }
  if (missing.length) {
    const parsed = parseImageInfo(await getJson(imageInfoUrl(missing)));
    for (const [n, info] of parsed) {
      out.set(n, info);
      await setCached("commons", `ii:${n}`, info, ONE_DAY).catch(() => false);
    }
  }
  return out;
}
