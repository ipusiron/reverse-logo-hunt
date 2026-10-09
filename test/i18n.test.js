import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MESSAGES, chooseLang, setLang, t, LANGS } from "../js/messages.js";
import { COMPASS } from "../js/geo.js";
import { RELATION_KINDS } from "../js/wikidata-core.js";
import { STATUSES } from "../js/session-core.js";

const ROOT = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", ROOT), "utf8");
const JA = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("日英の辞書は同じキーを持ち、空の値がない", () => {
  const ja = Object.keys(MESSAGES.ja).sort();
  const en = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(en, ja);
  for (const lang of LANGS) for (const [k, v] of Object.entries(MESSAGES[lang])) assert.ok(v.trim(), `${lang} ${k} が空`);
});

test("差し込み（{name}）は日英で同じ", () => {
  for (const k of Object.keys(MESSAGES.ja)) assert.deepEqual(placeholders(MESSAGES.en[k]), placeholders(MESSAGES.ja[k]), k);
});

test("英語の辞書に日本語の字が残っていない（言語の切り替えボタンの「日本語」を除く）", () => {
  for (const [k, v] of Object.entries(MESSAGES.en)) {
    if (k === "ui.lang.button") continue;
    assert.doesNotMatch(v, JA, `${k}: ${v}`);
  }
});

test("日本語の辞書で、日本語と英字の間に空白を入れない", () => {
  const J = "[\\u3040-\\u30ff\\u3400-\\u9fff\\u3001\\u3002\\u300c-\\u300f\\uff08\\uff09]";
  const re = new RegExp(`${J} [A-Za-z0-9{]|[A-Za-z0-9}] ${J}`);
  for (const [k, v] of Object.entries(MESSAGES.ja)) assert.doesNotMatch(v, re, `${k}: ${v}`);
});

test("index.html の data-i18n のキーはすべて辞書にあり、既定の文は日本語の値と同じ", () => {
  const items = [...html.matchAll(/<(\w+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([^<]*)</g)];
  assert.ok(items.length >= 70, `data-i18n が ${items.length} 個`);
  for (const [, , key, text] of items) {
    assert.ok(MESSAGES.ja[key], `辞書に ${key} がない`);
    assert.equal(text.replace(/\s+/g, " ").trim(), MESSAGES.ja[key].replace(/\s+/g, " ").trim(), key);
  }
});

test("index.html の data-i18n-attr のキーはすべて辞書にあり、属性の既定値は日本語の値と同じ", () => {
  const tags = [...html.matchAll(/<\w+\b[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/g)];
  assert.ok(tags.length >= 10);
  for (const [tag, spec] of tags) {
    for (const pair of spec.split(";")) {
      const [attr, key] = pair.split(":");
      assert.ok(MESSAGES.ja[key], `辞書に ${key} がない`);
      const m = new RegExp(`\\s${attr}="([^"]*)"`).exec(tag);
      assert.ok(m, `${attr} の既定値がない: ${tag.slice(0, 80)}`);
      assert.equal(m[1], MESSAGES.ja[key], key);
    }
  }
});

test("JS が使うキーはすべて辞書にある（組み立てて使うキーも含む）", () => {
  const used = new Set();
  for (const f of readdirSync(new URL("js/", ROOT))) {
    const src = readFileSync(new URL(`js/${f}`, ROOT), "utf8");
    for (const m of src.matchAll(/\bt\("([\w.+-]+)"/g)) used.add(m[1]);
  }
  for (const k of [...COMPASS].map((d) => `dir.${d}`)) used.add(k);
  for (const k of RELATION_KINDS) used.add(`rel.${k}`);
  for (const k of STATUSES) used.add(`status.${k}`);
  for (const k of ["concentric", "cose", "breadthfirst", "circle"]) used.add(`layout.${k}`);
  for (const k of ["bezier", "unbundled-bezier", "straight", "segments"]) used.add(`edge.curve.${k}`);
  for (const k of ["single", "group"]) used.add(`graph.mode.${k}`);
  for (const k of ["eng", "jpn+eng"]) used.add(`mark.ocrLang.${k}`);
  assert.ok(used.size > 100, `${used.size}`);
  for (const k of used) assert.ok(MESSAGES.ja[k] && MESSAGES.en[k], `辞書に ${k} がない`);
});

test("最初の言語: ?lang= → 保存した選択 → ブラウザーの言語", () => {
  assert.equal(chooseLang({ param: "en", stored: "ja", browser: "ja-JP" }), "en");
  assert.equal(chooseLang({ param: "xx", stored: "ja", browser: "en-US" }), "ja");
  assert.equal(chooseLang({ browser: "ja" }), "ja");
  assert.equal(chooseLang({ browser: "fr-FR" }), "en");
  assert.equal(chooseLang({}), "en");
});

test("t は今の言語で引き、差し込む", () => {
  setLang("en");
  assert.equal(t("cand.rank", { rank: 2 }), "Search rank 2");
  setLang("ja");
  assert.equal(t("cand.rank", { rank: 2 }), "検索2位");
  assert.equal(t("no.such.key"), "no.such.key");
});
