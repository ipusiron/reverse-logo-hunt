// Wikidata への問い合わせ（通信とキャッシュ）。組み立てと解析は wikidata-core.js
import { getCached, setCached } from "./cache.js";
import { searchUrl, parseSearch, detailsQuery, sparqlUrl, parseDetails, relationsQuery, parseRelations, ancestorsQuery, parseAncestors }
  from "./wikidata-core.js";
import { nextFrontier, MAX_DEPTH } from "./group-core.js";

const ONE_DAY = 1000 * 60 * 60 * 24;

export class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export async function getJson(url, accept = "application/json") {
  const res = await fetch(url, { headers: { Accept: accept }, credentials: "omit" });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

async function cached(store, key, ttl, load) {
  const hit = await getCached(store, key).catch(() => null);
  if (hit) return hit;
  const value = await load();
  await setCached(store, key, value, ttl).catch(() => false);
  return value;
}

// 検索: [{ qid, rank, label, description }]
export function searchEntities(term, uiLang = "ja") {
  const key = `search:${uiLang}:${String(term).trim().toLowerCase()}`;
  return cached("wikidata", key, ONE_DAY, async () => parseSearch(await getJson(searchUrl(term, { uiLang }))));
}

// 詳細: QID → { qid, logoFiles, hq, isOrg, isBrand }
export async function fetchDetails(qids, uiLang = "ja") {
  const key = `details:${uiLang}:${[...qids].sort().join(",")}`;
  const list = await cached("wikidata", key, ONE_DAY, async () => {
    const json = await getJson(sparqlUrl(detailsQuery(qids, { uiLang })), "application/sparql-results+json");
    return [...parseDetails(json).values()];
  });
  return new Map(list.map((d) => [d.qid, d]));
}

// 関係: { nodes, edges }（修飾子つき。キャッシュのキーは修飾子を入れた版 v2）
export function fetchRelations(qid, uiLang = "ja") {
  return cached("relations", `relations-v2:${uiLang}:${qid}`, ONE_DAY, async () => {
    const json = await getJson(sparqlUrl(relationsQuery(qid, { uiLang })), "application/sparql-results+json");
    return parseRelations(json, qid);
  });
}

// 共通の親: 選んだ会社から親・所有者を1段ずつ、最大 MAX_DEPTH 段までたどる（1段につき SPARQL を1回）
export async function fetchAncestorLinks(qids, uiLang = "ja") {
  const seen = new Set(qids);
  let frontier = [...seen];
  const links = [];
  for (let d = 1; d <= MAX_DEPTH && frontier.length; d++) {
    const key = `ancestors:${uiLang}:${[...frontier].sort().join(",")}`;
    const level = await cached("relations", key, ONE_DAY, async () => {
      const json = await getJson(sparqlUrl(ancestorsQuery(frontier, { uiLang })), "application/sparql-results+json");
      return parseAncestors(json);
    });
    links.push(...level);
    frontier = nextFrontier(level, seen);
    frontier.forEach((q) => seen.add(q));
  }
  return links;
}
