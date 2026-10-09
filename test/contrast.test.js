// 配色の検査: style.css の変数（ダーク＝:root、ライト＝[data-theme="light"]）から、文字と背景の組のコントラスト比を計算する
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

function vars(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} がない`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const dark = vars(":root");
const light = { ...dark, ...vars('[data-theme="light"]') };

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [前景, 背景, 必要な比]。文字は4.5、枠・フォーカスの枠など文字でないものは3
const PAIRS = [
  ["text", "bg", 4.5],
  ["text", "panel", 4.5],
  ["text", "panel-2", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "panel", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "panel", 4.5],
  ["accent-2", "panel", 4.5],
  ["on-accent", "primary-from", 4.5],
  ["on-accent", "primary-to", 4.5],
  ["logo-note", "logo-bg", 4.5],
  ["focus", "bg", 3],
  ["focus", "panel", 3],
  ["control-border", "bg", 3],
  ["control-border", "panel", 3],
  ["accent-3", "panel", 3],
];

for (const [name, theme] of [["ダーク", dark], ["ライト", light]]) {
  test(`${name}テーマの文字と背景の組は基準を満たす`, () => {
    for (const [fg, bg, need] of PAIRS) {
      assert.ok(theme[fg] && theme[bg], `${fg} か ${bg} の変数がない`);
      const r = ratio(theme[fg], theme[bg]);
      assert.ok(r >= need, `${name}: ${fg} ${theme[fg]} / ${bg} ${theme[bg]} = ${r.toFixed(2)}（${need} 以上が必要）`);
    }
  });
}

test("ボタンのフォーカスの枠を消していない", () => {
  assert.doesNotMatch(css, /:focus\s*\{\s*outline:\s*none/);
  assert.match(css, /:focus-visible\s*\{\s*outline: 3px solid var\(--focus\)/);
});

test("muted の文字を panel-2 の上に置かない（ライトで4.5に届かないため）", () => {
  assert.ok(ratio(light.muted, light["panel-2"]) < 4.5, "前提が変わったらこのテストを見直す");
  assert.doesNotMatch(css, /\.graph-control \{[^}]*background: var\(--panel-2\)/);
});
