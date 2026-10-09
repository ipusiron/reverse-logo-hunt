// 候補の並べ方（計算部。DOM に依存しない）
//
// 照合（ロゴの見た目）だけで会社を決めない。子会社のロゴが親のロゴを中に含むことがあり、
// 見た目は子会社のほうが近く出ることがあるため（例: Nintendo Software Technology のロゴ）。
// そこで次の3つを足し合わせて「仮の1位」を決め、最後は人が確定する。
//   検索 … wbsearchentities の順位（1位=1、2位=0.667、3位=0.5 …）
//   種類 … 組織（本社所在地・業種・親子会社・所有者のどれかを持つ）かブランドなら1、それ以外は0.4
//   照合 … ロゴの照合の合計（logo-match.js の total）。ロゴがない・取得できないときは 0.5（判断材料なし）とする

export const WEIGHTS = Object.freeze({ search: 0.4, type: 0.2, visual: 0.4 });
export const NO_VISUAL = 0.5;

export function searchScore(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r < 1) return 0;
  return 1 / (1 + 0.5 * (r - 1));
}

export function typeScore(c) {
  return c && (c.isOrg || c.isBrand) ? 1 : 0.4;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export function combinedScore(c) {
  const visual = c && c.match && Number.isFinite(c.match.total) ? c.match.total : NO_VISUAL;
  const s = WEIGHTS.search * searchScore(c && c.rank) + WEIGHTS.type * typeScore(c) + WEIGHTS.visual * visual;
  return round3(s);
}

// 総合の高い順。同点は検索の順位が上のもの
export function rankCandidates(candidates) {
  return (candidates || [])
    .map((c) => ({ ...c, combined: combinedScore(c) }))
    .sort((a, b) => b.combined - a.combined || a.rank - b.rank);
}

// 1位と2位の差が小さいとき（0.05 未満）は「確かめてください」と出す
export function isCloseCall(ranked) {
  return Array.isArray(ranked) && ranked.length >= 2 && ranked[0].combined - ranked[1].combined < 0.05;
}
