import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// theme-init.js を、保存値と OS 設定を差し替えた仮の window で動かし、data-theme の値を返す
function run({ saved = null, prefersDark = false, storageThrows = false } = {}) {
  const attrs = {};
  const window = {
    localStorage: { getItem: () => { if (storageThrows) throw new Error("blocked"); return saved; } },
    matchMedia: () => ({ matches: prefersDark }),
    document: { documentElement: { setAttribute: (name, value) => { attrs[name] = value; } } },
  };
  vm.runInNewContext(read("js/theme-init.js"), { window });
  return attrs["data-theme"];
}

test("保存値がなければ OS の設定によらずダーク", () => {
  assert.equal(run({ prefersDark: true }), "dark");
  assert.equal(run({ prefersDark: false }), "dark");
});

test("保存値が light ならライト、dark ならダーク", () => {
  assert.equal(run({ saved: "light", prefersDark: true }), "light");
  assert.equal(run({ saved: "dark", prefersDark: false }), "dark");
});

test("想定外の保存値は無視してダーク", () => {
  assert.equal(run({ saved: "blue" }), "dark");
  assert.equal(run({ saved: "Light" }), "dark");
});

test("localStorage が使えなくても落ちず、ダーク", () => {
  assert.equal(run({ storageThrows: true, prefersDark: false }), "dark");
});

test("index.html の <head> で、stylesheet のあとに同期で読み込む", () => {
  const html = read("index.html");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(head.includes('<script src="js/theme-init.js"></script>'), "<head> に theme-init.js がない");
  assert.ok(head.indexOf('href="style.css"') < head.indexOf("js/theme-init.js"));
});
