import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGroup, nextFrontier, MAX_DEPTH } from "../js/group-core.js";
import { parseAncestors } from "../js/wikidata-core.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/ancestors-group.json", import.meta.url), "utf8"));
const links = fx.levels.flatMap((l) => parseAncestors(l));

test("実際のデータ（2026-10-09）: トヨタ自動車・日本生命保険・ファーストリテイリングが共通の親", () => {
  const g = buildGroup(fx.companies, links);
  assert.deepEqual(
    g.shared.map((s) => [s.label, s.companies.length, s.depth]),
    [["トヨタ自動車", 3, 1], ["日本生命保険", 3, 2], ["ファーストリテイリング", 2, 1]],
  );
  const fr = g.shared.find((s) => s.label === "ファーストリテイリング");
  assert.deepEqual(fr.companies.sort(), ["Q26070", "Q5512642"]);
  assert.ok(g.nodes.find((n) => n.qid === "Q53268").selected, "トヨタ自動車は選んだ会社でもある");
});

const L = (child, parent, extra = {}) => ({ child, parent, kind: "parent", parentLabel: parent, ended: false, ...extra });

test("段の上限を超えた祖先は数えない", () => {
  const chain = [L("A", "P1"), L("P1", "P2"), L("P2", "P3"), L("P3", "P4"), L("B", "P4")];
  const companies = [{ qid: "Q1" }, { qid: "Q2" }];
  const map = (l) => ({ ...l, child: l.child.replace("A", "Q1").replace("B", "Q2").replace(/^P(\d)$/, "Q10$1"),
    parent: l.parent.replace(/^P(\d)$/, "Q10$1") });
  const g = buildGroup(companies, chain.map(map));
  assert.equal(MAX_DEPTH, 3);
  assert.deepEqual(g.shared, [], "Q1 から Q104 は4段上なので届かない");
  const g4 = buildGroup(companies, chain.map(map), { maxDepth: 4 });
  assert.deepEqual(g4.shared.map((s) => [s.qid, s.depth]), [["Q104", 4]]);
});

test("終わった関係は共通の親の判定に使わないが、図には出す", () => {
  const g = buildGroup([{ qid: "Q1" }, { qid: "Q2" }], [L("Q1", "Q9"), L("Q2", "Q9", { ended: true }), L("Q2", "Q8")]);
  assert.deepEqual(g.shared, []);
  const ended = g.edges.find((e) => e.source === "Q9" && e.target === "Q2");
  assert.equal(ended && ended.ended, true);
});

test("同じ親子の親会社と所有者は1本の矢印、次の段の問い合わせ先は重複なし", () => {
  const ls = [L("Q1", "Q9"), L("Q1", "Q9", { kind: "owner" }), L("Q2", "Q9"), L("Q2", "Q8", { ended: true })];
  const g = buildGroup([{ qid: "Q1" }, { qid: "Q2" }], ls);
  assert.deepEqual(g.edges.find((e) => e.source === "Q9" && e.target === "Q1").kinds, ["parent", "owner"]);
  assert.deepEqual(nextFrontier(ls, new Set(["Q1", "Q2"])), ["Q9"]);
  assert.deepEqual(buildGroup([{ qid: "bad" }], ls).nodes, []);
});
