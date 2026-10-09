import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("index.html");
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || "";
const directives = Object.fromEntries(
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([k, ...v]) => [k, v]),
);

test("CSP は default-src 'self' を基本にし、危ない許可を含まない", () => {
  assert.ok(csp, "CSP の meta がない");
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'none'"]);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.doesNotMatch(csp, /frame-ancestors/, "meta の CSP では frame-ancestors は効かない");
  assert.ok(directives["script-src"].includes("'wasm-unsafe-eval'"), "Tesseract.js の WASM に必要");
});

test("CSP の通信先は Wikidata・Commons・OSM・CDN だけ（COCO のモデルの置き場はない）", () => {
  assert.deepEqual(directives["connect-src"], ["'self'", "data:", "https://www.wikidata.org", "https://query.wikidata.org",
    "https://commons.wikimedia.org", "https://cdn.jsdelivr.net"]);
  assert.ok(directives["img-src"].includes("https://thumb.wikimedia.org"), "Commons のサムネイルの配信元");
  assert.ok(directives["img-src"].includes("https://tile.openstreetmap.org"));
  assert.doesNotMatch(csp, /storage\.googleapis\.com|cdnjs/);
});

test("style-src のハッシュは Cytoscape が差し込む1行と一致する", async () => {
  const { createHash } = await import("node:crypto");
  const line = ".__________cytoscape_container { position: relative; }";
  const hash = createHash("sha256").update(line).digest("base64");
  assert.ok(directives["style-src"].includes(`'sha256-${hash}'`));
});

test("Referer を消さない（OSM のタイルの利用規約が有効な Referer を求める）", () => {
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin"/);
  assert.doesNotMatch(html, /no-referrer/);
  const map = read("js/map.js");
  assert.match(map, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.doesNotMatch(map, /\{s\}\.tile/);
  assert.match(map, /OpenStreetMap<\/a> contributors/);
});

test("外部のスクリプトは版を固定し、SRI と crossorigin を付ける", () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="(https:[^"]+)"[^>]*>/g)];
  assert.equal(tags.length, 4);
  for (const [tag, src] of tags) {
    assert.match(src, /@\d+\.\d+\.\d+\//, `${src} の版が固定されていない`);
    assert.match(tag, /integrity="sha(256|384)-[A-Za-z0-9+/=]+"/, `${src} に SRI がない`);
    assert.match(tag, /crossorigin="anonymous"/);
  }
  assert.match(html, /<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"\s+integrity="sha256-/);
});

test("インラインのスクリプト・イベント属性・style 属性がない", () => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)];
  assert.equal(inline.length, 0);
  const modules = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(modules, ["js/main.js"]);
});

test("JS は innerHTML を使わず、物体検出のモデルを読まない", () => {
  for (const f of readdirSync(new URL("../js/", import.meta.url))) {
    const src = read(`js/${f}`);
    assert.doesNotMatch(src, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/, `${f} が HTML を文字列で入れている`);
    assert.doesNotMatch(src, /tensorflow|coco-ssd|cocoSsd/i, `${f}`);
    assert.doesNotMatch(src, /window\.__rev/);
  }
});

test("画面の主な要素がある", () => {
  const ids = ["fileInput", "dropzone", "imageList", "markedLogos", "emptyState", "justifyContent", "roiCanvas", "commonsThumb",
    "commonsMeta", "ocrText", "queryChoices", "queryForm", "queryInput", "searchButton", "resultMessage", "candidateList",
    "closeCallNote", "scoreBody", "scoreFormula", "log", "map", "graph", "historyList", "importJSON", "importJSONInput",
    "exportJSON", "exportPNG", "helpModal", "helpButton", "themeToggle"];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<link rel="icon" href="data:,"/);
  assert.match(html, /<noscript>/);
});

test("タブは tablist・tab・tabpanel の対応がそろう", () => {
  const tabs = [...html.matchAll(/role="tab" id="(tab-btn-\d)" data-tab="([^"]+)" aria-controls="([^"]+)"/g)];
  assert.equal(tabs.length, 4);
  for (const [, btn, data, ctrl] of tabs) {
    assert.equal(data, ctrl);
    assert.match(html, new RegExp(`id="${ctrl}" class="tab[^"]*" role="tabpanel" aria-labelledby="${btn}"`));
  }
});
