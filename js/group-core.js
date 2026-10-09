// 写真の中の複数の会社について、親会社・所有者を最大3段までたどり、共通の親を見つける（計算部。DOM に依存しない）
//
// たどるのは終了の年がない（今も続いている）関係だけ。終わった関係は図には点線で出すが、共通の親の判定には使わない。
// 選んだ会社どうしが親子のとき（レクサスとトヨタ自動車など）は、親の会社そのものも「共通の親」に数える。
import { isQid } from "./wikidata-core.js";

export const MAX_DEPTH = 3;

// companies: [{ qid, label }]、links: parseAncestors() の結果をすべての段について並べたもの
export function buildGroup(companies, links, { maxDepth = MAX_DEPTH } = {}) {
  const selected = [];
  for (const c of companies || []) {
    if (c && isQid(c.qid) && !selected.some((s) => s.qid === c.qid)) selected.push({ qid: c.qid, label: c.label || c.qid });
  }
  const labels = new Map(selected.map((c) => [c.qid, c.label]));
  const edges = new Map();
  for (const l of links || []) {
    if (!labels.has(l.parent)) labels.set(l.parent, l.parentLabel || l.parent);
    const key = `${l.parent}>${l.child}`;
    if (!edges.has(key)) edges.set(key, { source: l.parent, target: l.child, kinds: [], ended: true });
    const e = edges.get(key);
    if (!e.kinds.includes(l.kind)) e.kinds.push(l.kind);
    if (!l.ended) e.ended = false;
  }
  const up = new Map();
  for (const e of edges.values()) {
    if (e.ended) continue;
    if (!up.has(e.target)) up.set(e.target, []);
    up.get(e.target).push(e.source);
  }
  // reach: 祖先 → (選んだ会社 → 何段上か)
  const reach = new Map();
  for (const c of selected) {
    const seen = new Map([[c.qid, 0]]);
    const queue = [c.qid];
    while (queue.length) {
      const q = queue.shift();
      const d = seen.get(q);
      if (!reach.has(q)) reach.set(q, new Map());
      const m = reach.get(q);
      if (!m.has(c.qid) || m.get(c.qid) > d) m.set(c.qid, d);
      if (d >= maxDepth) continue;
      for (const p of up.get(q) || []) {
        if (!seen.has(p)) {
          seen.set(p, d + 1);
          queue.push(p);
        }
      }
    }
  }
  const shared = [...reach.entries()]
    .filter(([, m]) => m.size >= 2)
    .map(([qid, m]) => ({ qid, label: labels.get(qid) || qid, companies: [...m.keys()], depth: Math.max(...m.values()) }))
    .sort((a, b) => b.companies.length - a.companies.length || a.depth - b.depth || a.label.localeCompare(b.label));
  const sharedSet = new Set(shared.map((s) => s.qid));
  const selectedSet = new Set(selected.map((s) => s.qid));
  const nodes = [...reach.keys()].map((qid) => ({ qid, label: labels.get(qid) || qid, selected: selectedSet.has(qid), shared: sharedSet.has(qid) }));
  const nodeSet = new Set(nodes.map((n) => n.qid));
  // 図には、たどれた範囲の矢印を出す（終わった関係も、両端が範囲にあれば出す）
  const shownEdges = [...edges.values()].filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { nodes, edges: shownEdges, shared };
}

// 次の段で問い合わせる会社（まだたどっていない親・所有者）
export function nextFrontier(links, seen) {
  const out = [];
  for (const l of links) {
    if (l.ended || seen.has(l.parent) || out.includes(l.parent)) continue;
    out.push(l.parent);
  }
  return out;
}
