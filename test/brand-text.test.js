import test from "node:test";
import assert from "node:assert/strict";
import { brandQueries, isPlausibleToken, cleanText, hasCJK, normalizeQuery } from "../js/brand-text.js";

test("1語の看板はその語", () => {
  assert.deepEqual(brandQueries("NINTENDO\n"), ["NINTENDO"]);
});

test("子音だけの略称・2文字の略称・数字を含む略称を捨てない", () => {
  assert.deepEqual(brandQueries("BMW"), ["BMW"]);
  assert.deepEqual(brandQueries("DHL"), ["DHL"]);
  assert.deepEqual(brandQueries("HSBC"), ["HSBC"]);
  assert.deepEqual(brandQueries("HP"), ["HP"]);
  assert.deepEqual(brandQueries("3M"), ["3M"]);
});

test("日本語の語を捨てない（全角は半角にそろえる）", () => {
  assert.deepEqual(brandQueries("任天堂"), ["任天堂"]);
  assert.deepEqual(brandQueries("ＳＯＮＹ"), ["SONY"]);
  assert.equal(hasCJK("ドコモ"), true);
  assert.equal(hasCJK("docomo"), false);
});

test("2〜4語の行は行ごとの候補も出し、語の候補が続く", () => {
  assert.deepEqual(brandQueries("BMW GROUP"), ["BMW GROUP", "BMW", "GROUP"]);
  assert.deepEqual(brandQueries("SONY\nmake.believe"), ["SONY", "make.believe"]);
});

test("文字の高さと確からしさがあれば、大きく確かな語を先にする", () => {
  const input = {
    text: "make.believe\nSONY",
    words: [
      { text: "make.believe", confidence: 90, bbox: { y0: 100, y1: 112 } },
      { text: "SONY", confidence: 95, bbox: { y0: 10, y1: 70 } },
    ],
  };
  assert.deepEqual(brandQueries(input), ["SONY", "make.believe"]);
});

test("読み違いに多いものは捨てる", () => {
  assert.deepEqual(brandQueries("||| ;; 1234 aaa x"), []);
  assert.equal(isPlausibleToken("fmsrtk"), false);
  assert.equal(isPlausibleToken("the"), false);
  assert.equal(isPlausibleToken("Ltd"), false);
  assert.equal(isPlausibleToken("Coca-Cola"), true);
  assert.equal(isPlausibleToken("AT&T"), true);
});

test("候補は最大5つで、大文字小文字の違いだけの重複を除く", () => {
  const q = brandQueries("Alpha Beta\nGamma Delta\nalpha\nEpsilon Zeta");
  assert.equal(q.length, 5);
  assert.equal(new Set(q.map((s) => s.toLowerCase())).size, q.length);
});

test("記号を空白にし、空白をまとめる", () => {
  assert.equal(cleanText("  Coca—Cola™ / Japan  "), "Coca Cola Japan");
  assert.deepEqual(brandQueries("Coca-Cola®"), ["Coca-Cola"]);
  assert.equal(normalizeQuery(""), "");
  assert.equal(normalizeQuery("x".repeat(200)).length, 80);
});

test("日本語の字の間の空白はつなぐ（英字との間はつながない）", () => {
  assert.deepEqual(brandQueries("任 天 堂"), ["任天堂"]);
  assert.deepEqual(brandQueries(["ド コ モ", "docomo"].join(String.fromCharCode(10))), ["ドコモ", "docomo"]);
  assert.equal(cleanText("ソニー グループ"), "ソニーグループ");
  assert.equal(cleanText("au 公式"), "au 公式");
});
