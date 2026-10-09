import test from "node:test";
import assert from "node:assert/strict";
import { searchScore, typeScore, combinedScore, rankCandidates, isCloseCall, WEIGHTS, NO_VISUAL } from "../js/candidate-rank.js";

test("検索の順位の点", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((r) => Math.round(searchScore(r) * 1000) / 1000), [1, 0.667, 0.5, 0.4, 0.333]);
  assert.equal(searchScore(0), 0);
  assert.equal(searchScore("x"), 0);
});

test("重みの合計は1", () => {
  assert.equal(WEIGHTS.search + WEIGHTS.type + WEIGHTS.visual, 1);
});

test("組織かブランドなら種類の点は1、それ以外は0.4", () => {
  assert.equal(typeScore({ isOrg: true }), 1);
  assert.equal(typeScore({ isBrand: true }), 1);
  assert.equal(typeScore({}), 0.4);
});

test("見た目が近い子会社より、検索1位の親会社が上に来る", () => {
  // 照合の値は渚のベンチ（紙に印刷した任天堂のロゴ）で出た値
  const ranked = rankCandidates([
    { qid: "Q123018", rank: 5, isOrg: true, match: { total: 0.79 } },
    { qid: "Q8093", rank: 1, isOrg: true, match: { total: 0.753 } },
  ]);
  assert.equal(ranked[0].qid, "Q8093");
  assert.equal(ranked[0].combined, 0.901);
  assert.equal(ranked[1].combined, 0.649);
});

test("ロゴのない組織（検索1位）は、ロゴのある製品（検索2位）より上", () => {
  const ranked = rankCandidates([
    { qid: "Q2", rank: 2, isOrg: false, match: { total: 0.8 } },
    { qid: "Q1", rank: 1, isOrg: true, match: null },
  ]);
  assert.equal(ranked[0].qid, "Q1");
  assert.equal(combinedScore({ rank: 1, isOrg: true }), WEIGHTS.search + WEIGHTS.type + WEIGHTS.visual * NO_VISUAL);
});

test("1位と2位の差が0.05未満なら確認を促す", () => {
  assert.equal(isCloseCall([{ combined: 0.8 }, { combined: 0.76 }]), true);
  assert.equal(isCloseCall([{ combined: 0.8 }, { combined: 0.7 }]), false);
  assert.equal(isCloseCall([{ combined: 0.8 }]), false);
});
