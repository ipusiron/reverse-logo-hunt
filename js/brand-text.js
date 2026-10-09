// OCR の文字列から、Wikidata で検索する語の候補を作る（計算部。DOM に依存しない）
//
// 方針:
//   - 1つの語に絞らず、候補を最大5つ並べる（1つ目を既定の検索語にし、残りは画面で選べる）
//   - 文字の高さと確からしさ（Tesseract の words）があれば、大きく確かな語を前にする
//   - 子音だけの短い略称（BMW・DHL・HSBC）、2文字の略称（HP・LG・3M）、日本語の語を捨てない
//   - 数字だけ、同じ文字の繰り返し、母音のない長い英字列（OCR の読み違いに多い）は捨てる

export const MAX_QUERIES = 5;
const STOP_WORDS = new Set(["the", "and", "of", "co", "ltd", "inc", "corp", "tm", "llc", "gmbh", "www", "com", "jp"]);

export function hasCJK(s) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(s || ""));
}

// 商標の記号（™ ® © ℠）を空白にし、全角を半角へそろえ、文字・数字と & ' . - 以外を空白にする
// 記号を先に外すのは、NFKC が ™ を「TM」に変えて前の語にくっつけるため（Cola™ → ColaTM）
export function cleanText(s) {
  return String(s || "")
    .replace(/[™®©℠]/gu, " ")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}&'.\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimPunct(t) {
  return t.replace(/^[&'.\-]+|[&'.\-]+$/g, "");
}

export function isPlausibleToken(token) {
  const t = trimPunct(String(token || ""));
  if (!t) return false;
  if (STOP_WORDS.has(t.toLowerCase())) return false;
  if (hasCJK(t)) return [...t].length >= 2;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters === 0) return false;
  if ([...t].length < 2) return false;
  if (/^(.)\1+$/u.test(t.toLowerCase()) && t.length >= 3) return false;
  const latin = t.toLowerCase().replace(/[^a-z]/g, "");
  if (latin.length >= 6 && !/[aeiouy]/.test(latin)) return false;
  return true;
}

function wordWeights(words) {
  const weight = new Map();
  for (const w of Array.isArray(words) ? words : []) {
    const bbox = w && w.bbox ? w.bbox : {};
    const h = Math.max(1, (Number(bbox.y1) || 0) - (Number(bbox.y0) || 0));
    const c = Math.max(0, Math.min(100, Number(w && w.confidence) || 0)) / 100;
    for (const tok of cleanText(w && w.text).split(" ")) {
      const k = trimPunct(tok).toLowerCase();
      if (!k) continue;
      weight.set(k, Math.max(weight.get(k) || 0, h * (0.5 + c)));
    }
  }
  return weight;
}

// input は文字列か { text, words: [{ text, confidence, bbox: { y0, y1 } }] }
export function brandQueries(input, { max = MAX_QUERIES } = {}) {
  const text = typeof input === "string" ? input : String((input && input.text) || "");
  const weight = wordWeights(input && typeof input === "object" ? input.words : null);
  const out = [];
  const seen = new Set();
  let order = 0;
  const push = (q, score) => {
    const k = q.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ q, score, order: order++ });
  };
  for (const raw of text.split(/\r?\n/)) {
    const tokens = cleanText(raw).split(" ").map(trimPunct).filter(isPlausibleToken);
    if (!tokens.length) continue;
    const scores = tokens.map((t) => weight.get(t.toLowerCase()) || 0);
    if (tokens.length >= 2 && tokens.length <= 4) push(tokens.join(" "), Math.max(...scores) * 1.01);
    tokens.forEach((t, i) => push(t, scores[i]));
  }
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.slice(0, max).map((o) => o.q);
}

// 手で入れた検索語を整える（空なら空文字）
export function normalizeQuery(s) {
  return cleanText(s).slice(0, 80);
}
