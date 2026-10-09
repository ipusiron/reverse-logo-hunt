import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../js/wikidata-core.js";

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("QID の検証は Q と数字だけ", () => {
  assert.equal(W.isQid("Q8093"), true);
  assert.equal(W.isQid("Q0"), false);
  assert.equal(W.isQid("q8093"), false);
  assert.equal(W.isQid("Q1 }"), false);
  assert.equal(W.isQid("P154"), false);
  assert.equal(W.qidFromUri("http://www.wikidata.org/entity/Q8093"), "Q8093");
  assert.equal(W.qidFromUri("http://www.wikidata.org/entity/Q8093/x"), null);
});

test("検索の URL: 日本語の語は日本語のラベルで探す", () => {
  const u = new URL(W.searchUrl("任天堂"));
  assert.equal(u.origin + u.pathname, W.SEARCH_API);
  assert.equal(u.searchParams.get("action"), "wbsearchentities");
  assert.equal(u.searchParams.get("language"), "ja");
  assert.equal(u.searchParams.get("origin"), "*");
  assert.equal(u.searchParams.get("search"), "任天堂");
  assert.equal(new URL(W.searchUrl("nintendo", { uiLang: "en" })).searchParams.get("language"), "en");
  assert.equal(new URL(W.searchUrl("nintendo", { uiLang: "en" })).searchParams.get("uselang"), "en");
  assert.throws(() => W.searchUrl("   "));
});

test("実際の検索結果（nintendo）: 任天堂が1位で、順位がそのまま残る", () => {
  const c = W.parseSearch(fx("search-nintendo.json"));
  assert.equal(c.length, 8);
  assert.deepEqual(c[0], { qid: "Q8093", rank: 1, label: "任天堂", description: c[0].description });
  assert.deepEqual(c.map((x) => x.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("詳細の問い合わせに埋め込むのは検証済みの QID だけ", () => {
  const q = W.detailsQuery(["Q8093", "Q1 } DELETE { ?s ?p ?o }", "Q8093", "Q41187"]);
  assert.match(q, /VALUES \?item \{ wd:Q8093 wd:Q41187 \}/);
  assert.doesNotMatch(q, /DELETE/);
  assert.throws(() => W.detailsQuery(["x"]));
  assert.throws(() => W.relationsQuery("Q1 }"));
});

test("実際の詳細（nintendo の上位8件）: 組織は任天堂だけ、本社は京都市", () => {
  const d = W.parseDetails(fx("details-nintendo.json"));
  const n = d.get("Q8093");
  assert.equal(n.isOrg, true);
  assert.deepEqual(n.logoFiles, ["Nintendo.svg"]);
  assert.equal(n.hq.label, "京都市");
  assert.ok(Math.abs(n.hq.coord.lat - 35.0116) < 0.001 && Math.abs(n.hq.coord.lng - 135.7681) < 0.001);
  const orgs = [...d.values()].filter((v) => v.isOrg).map((v) => v.qid);
  assert.deepEqual(orgs, ["Q8093"]);
  assert.deepEqual(d.get("Q172742").logoFiles, ["Family Computer logo.svg", "NES logo.svg"]);
});

test("座標とファイル名の読み取り", () => {
  assert.deepEqual(W.parsePoint("Point(135.768 35.0116)"), { lat: 35.0116, lng: 135.768 });
  assert.equal(W.parsePoint("Point(200 10)"), null);
  assert.equal(W.parsePoint("LINESTRING(1 2)"), null);
  assert.equal(W.logoFileFromUri("http://commons.wikimedia.org/wiki/Special:FilePath/Nintendo%20DS%20Logo.svg"), "Nintendo DS Logo.svg");
  assert.equal(W.logoFileFromUri("https://example.com/wiki/Special:FilePath/x.svg"), null);
  assert.equal(W.logoFileFromUri("http://commons.wikimedia.org/wiki/Special:FilePath/%E0%A4%A"), null);
});

test("実際の関係（任天堂）: 矢印は親・所有者から子へ向く", () => {
  const r = W.parseRelations(fx("relations-Q8093.json"), "Q8093");
  const subs = r.edges.filter((e) => e.kinds.includes("subsidiary"));
  const owners = r.edges.filter((e) => e.kinds.includes("owner"));
  assert.equal(subs.length, 16);
  assert.equal(owners.length, 3);
  assert.ok(subs.every((e) => e.source === "Q8093"));
  assert.ok(owners.every((e) => e.target === "Q8093"));
  const noa = r.nodes.find((n) => n.qid === "Q20651008");
  assert.equal(noa.label, "Nintendo of America");
});

test("同じ相手との親子と所有は1本の矢印にまとめ、向きをそろえる", () => {
  const uri = (q) => ({ value: `http://www.wikidata.org/entity/${q}` });
  const json = {
    results: {
      bindings: [
        { kind: { value: "parent" }, other: uri("Q2"), otherLabel: { value: "親" } },
        { kind: { value: "owner" }, other: uri("Q2"), otherLabel: { value: "親" } },
        { kind: { value: "subsidiary" }, other: uri("Q3"), otherLabel: { value: "子" } },
        { kind: { value: "evil" }, other: uri("Q4") },
        { kind: { value: "parent" }, other: uri("Q1") },
      ],
    },
  };
  const r = W.parseRelations(json, "Q1");
  assert.deepEqual(r.edges, [
    { source: "Q2", target: "Q1", kinds: ["parent", "owner"] },
    { source: "Q1", target: "Q3", kinds: ["subsidiary"] },
  ]);
  assert.equal(r.nodes.length, 2);
});
