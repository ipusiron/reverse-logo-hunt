// Wikidata の問い合わせの組み立てと結果の解析（計算部。DOM にも通信にも依存しない）
//
// 検索は wbsearchentities（ラベルと別名の検索。順位がそのまま返る）を使い、
// 上位の項目について、ロゴ（P154）・本社所在地（P159）の座標（P625）・種類を SPARQL でまとめて引く。
// SPARQL に埋め込むのは検証済みの QID だけにする（利用者の文字列は埋め込まない）。

export const SEARCH_API = "https://www.wikidata.org/w/api.php";
export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
export const SEARCH_LIMIT = 8;
const COMMONS_FILEPATH = /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;

export function isQid(s) {
  return typeof s === "string" && /^Q[1-9][0-9]{0,11}$/.test(s);
}

export function qidFromUri(uri) {
  const m = /\/entity\/(Q[1-9][0-9]{0,11})$/.exec(String(uri || ""));
  return m ? m[1] : null;
}

// 日本語の文字を含む検索語は日本語のラベル、それ以外は英語のラベルで探す
export function searchLanguage(term) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(term || "")) ? "ja" : "en";
}

export function searchUrl(term, { uiLang = "ja", limit = SEARCH_LIMIT } = {}) {
  const q = String(term || "").trim();
  if (!q) throw new Error("検索語が空です");
  const params = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    origin: "*",
    type: "item",
    search: q.slice(0, 80),
    language: searchLanguage(q),
    uselang: uiLang === "en" ? "en" : "ja",
    limit: String(Math.max(1, Math.min(20, limit))),
  });
  return `${SEARCH_API}?${params.toString()}`;
}

// 検索結果を、順位（1始まり）つきの候補にする
export function parseSearch(json) {
  const list = json && Array.isArray(json.search) ? json.search : [];
  const out = [];
  for (const e of list) {
    if (!e || !isQid(e.id) || out.some((c) => c.qid === e.id)) continue;
    out.push({
      qid: e.id,
      rank: out.length + 1,
      label: typeof e.label === "string" ? e.label : e.id,
      description: typeof e.description === "string" ? e.description : "",
    });
  }
  return out;
}

function langList(uiLang) {
  return uiLang === "en" ? "en,ja,mul" : "ja,en,mul";
}

// 候補の詳細（ロゴ・本社の座標と名前・組織らしさ・ブランドか）
// 組織らしさ＝本社所在地・業種・親会社・子会社・所有者のどれかを持つこと（上位クラスをたどる判定は遅いので使わない）
export function detailsQuery(qids, { uiLang = "ja" } = {}) {
  const ok = [...new Set((qids || []).filter(isQid))];
  if (!ok.length) throw new Error("QID がありません");
  const values = ok.map((q) => `wd:${q}`).join(" ");
  return [
    "SELECT ?item ?logo ?hq ?hqLabel ?coord ?isOrg ?isBrand WHERE {",
    `  VALUES ?item { ${values} }`,
    "  OPTIONAL { ?item wdt:P154 ?logo. }",
    "  OPTIONAL { ?item wdt:P159 ?hq. OPTIONAL { ?hq wdt:P625 ?coord. } }",
    "  BIND(EXISTS { { ?item wdt:P159 ?o1 } UNION { ?item wdt:P452 ?o2 } UNION { ?item wdt:P749 ?o3 }",
    "    UNION { ?item wdt:P355 ?o4 } UNION { ?item wdt:P127 ?o5 } } AS ?isOrg)",
    "  BIND(EXISTS { ?item wdt:P31 wd:Q431289 } AS ?isBrand)",
    `  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langList(uiLang)}". }`,
    "}",
  ].join("\n");
}

export function sparqlUrl(query) {
  return `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
}

// "Point(経度 緯度)" を { lat, lng } に
export function parsePoint(wkt) {
  const m = /^Point\(\s*(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)\s+(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)\s*\)$/.exec(String(wkt || "").trim());
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Special:FilePath の URL から Commons のファイル名（空白区切り）を取り出す
export function logoFileFromUri(uri) {
  const s = String(uri || "");
  if (!COMMONS_FILEPATH.test(s)) return null;
  let name = s.replace(COMMONS_FILEPATH, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  name = name.replace(/_/g, " ").trim();
  if (!name || name.includes("/") || name.length > 240) return null;
  return name;
}

function bool(b) {
  return !!(b && b.value === "true");
}

// SPARQL の結果を QID ごとにまとめる。ロゴ・本社は複数あれば重複を除いて並べる
export function parseDetails(json) {
  const rows = json && json.results && Array.isArray(json.results.bindings) ? json.results.bindings : [];
  const map = new Map();
  for (const b of rows) {
    const qid = qidFromUri(b.item && b.item.value);
    if (!qid) continue;
    if (!map.has(qid)) map.set(qid, { qid, logoFiles: [], hq: null, isOrg: false, isBrand: false });
    const d = map.get(qid);
    const logo = logoFileFromUri(b.logo && b.logo.value);
    if (logo && !d.logoFiles.includes(logo)) d.logoFiles.push(logo);
    const coord = parsePoint(b.coord && b.coord.value);
    if (!d.hq && coord) {
      d.hq = { qid: qidFromUri(b.hq && b.hq.value), label: (b.hqLabel && b.hqLabel.value) || "", coord };
    }
    d.isOrg = d.isOrg || bool(b.isOrg);
    d.isBrand = d.isBrand || bool(b.isBrand);
  }
  return map;
}

// 関係（子会社 P355・親会社 P749・所有者 P127）
export function relationsQuery(qid, { uiLang = "ja" } = {}) {
  if (!isQid(qid)) throw new Error("QID が不正です");
  return [
    "SELECT ?kind ?other ?otherLabel WHERE {",
    `  VALUES ?company { wd:${qid} }`,
    '  { ?company wdt:P355 ?other. BIND("subsidiary" AS ?kind) }',
    '  UNION { ?company wdt:P749 ?other. BIND("parent" AS ?kind) }',
    '  UNION { ?company wdt:P127 ?other. BIND("owner" AS ?kind) }',
    `  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langList(uiLang)}". }`,
    "} LIMIT 300",
  ].join("\n");
}

export const RELATION_KINDS = Object.freeze(["subsidiary", "parent", "owner"]);

// 矢印は常に「親・所有者 → 子・所有される側」に向ける
//   subsidiary: 中心 → 相手（相手は中心の子会社）
//   parent    : 相手 → 中心（相手は中心の親会社）
//   owner     : 相手 → 中心（相手は中心の所有者）
export function parseRelations(json, centerQid) {
  if (!isQid(centerQid)) throw new Error("QID が不正です");
  const rows = json && json.results && Array.isArray(json.results.bindings) ? json.results.bindings : [];
  const nodes = new Map();
  const edges = new Map();
  for (const b of rows) {
    const kind = b.kind && b.kind.value;
    const other = qidFromUri(b.other && b.other.value);
    if (!RELATION_KINDS.includes(kind) || !other || other === centerQid) continue;
    if (!nodes.has(other)) nodes.set(other, { qid: other, label: (b.otherLabel && b.otherLabel.value) || other });
    const source = kind === "subsidiary" ? centerQid : other;
    const target = kind === "subsidiary" ? other : centerQid;
    const key = `${source}>${target}`;
    if (!edges.has(key)) edges.set(key, { source, target, kinds: [] });
    const e = edges.get(key);
    if (!e.kinds.includes(kind)) e.kinds.push(kind);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
