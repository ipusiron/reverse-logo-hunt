// 書式の検査: 1行に詰め込んだ（minify した）ファイルや、途中で切れたファイル、見えない文字を公開前に見つける
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const lines = (rel) => readFileSync(new URL(rel, ROOT), "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
const maxLen = (rel) => lines(rel).reduce((m, l) => Math.max(m, [...l].length), 0);
const listJs = (dir) => readdirSync(new URL(dir, ROOT)).filter((f) => f.endsWith(".js")).map((f) => `${dir}${f}`);
const JS = listJs("js/");
const TESTS = listJs("test/");

const MIN_LINES = {
  "index.html": 200,
  "style.css": 400,
  "js/main.js": 450,
  "js/logo-match.js": 200,
  "js/marking.js": 200,
  "js/graph.js": 200,
  "js/wikidata-core.js": 120,
  "js/session-core.js": 150,
};

test("JS とテストの最長行は160文字以下", () => {
  for (const f of [...JS, ...TESTS]) assert.ok(maxLen(f) <= 160, `${f} の最長行が ${maxLen(f)} 文字`);
});

test("CSS の最長行は160文字以下、index.html は250文字以下", () => {
  assert.ok(maxLen("style.css") <= 160, `style.css の最長行が ${maxLen("style.css")} 文字`);
  assert.ok(maxLen("index.html") <= 250, `index.html の最長行が ${maxLen("index.html")} 文字`);
});

test("主なファイルが1行に詰め込まれていない", () => {
  for (const [f, min] of Object.entries(MIN_LINES)) {
    const n = lines(f).length;
    assert.ok(n >= min, `${f} が ${n} 行しかない（最低 ${min} 行）`);
  }
});

test("ソースに見えない文字・制御文字が混ざっていない", () => {
  // 範囲は数値で持つ（エスケープ表記をエディターが実物に変えると、探しているものが隠れるため）
  const bad = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
  for (const f of ["index.html", "style.css", ...JS, ...TESTS]) {
    let text;
    try {
      text = readFileSync(new URL(f, ROOT), "utf8");
    } catch {
      continue;
    }
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
      assert.ok(!bad.some(([a, b]) => cp >= a && cp <= b), `${f} に U+${cp.toString(16).toUpperCase().padStart(4, "0")} がある`);
    }
  }
});
