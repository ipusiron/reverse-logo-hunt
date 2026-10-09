import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import * as LM from "../js/logo-match.js";
import * as CR from "../js/candidate-rank.js";
import { SEARCH_LIMIT, parseRelations, parseDetails } from "../js/wikidata-core.js";
import { THUMB_WIDTH } from "../js/commons-core.js";
import { MAX_QUERIES } from "../js/brand-text.js";
import { TARGET_HEIGHT } from "../js/ocr-prep.js";
import { MAX_VISUAL } from "../js/analysis.js";
import { place, invertDark, blueWord, greenWord, blackRing } from "./synthetic.js";

const ROOT = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", ROOT), "utf8").replace(/\r\n/g, "\n");
const body = readme.slice(readme.indexOf("-->") + 3);

// 見出し（## ）ごとに分ける
function sections(text) {
  const out = [];
  let cur = { title: "(前書き)", lines: [] };
  let fence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      out.push(cur);
      cur = { title: line.slice(3), lines: [] };
    }
    cur.lines.push(line);
  }
  out.push(cur);
  return out;
}

function proseLines(text) {
  let fence = false;
  return text.split("\n").filter((l) => {
    if (l.startsWith("```")) {
      fence = !fence;
      return false;
    }
    return !fence;
  });
}

test("YAML のメタデータの構造と固定の値", () => {
  const m = /^<!--\n---\n([\s\S]*?)\n---\n-->/.exec(readme);
  assert.ok(m, "先頭の YAML がない");
  const yaml = m[1];
  const keys = [...yaml.matchAll(/^([a-z_]+):/gm)].map((x) => x[1]);
  assert.deepEqual(keys, ["id", "slug", "title", "subtitle_ja", "subtitle_en", "description_ja", "description_en",
    "category_ja", "category_en", "difficulty", "tags", "repo_url", "demo_url", "hub"]);
  assert.match(yaml, /^id: day091$/m);
  assert.match(yaml, /^slug: reverse-logo-hunt$/m);
  assert.match(yaml, /^repo_url: "https:\/\/github\.com\/ipusiron\/reverse-logo-hunt"$/m);
  assert.match(yaml, /^demo_url: "https:\/\/ipusiron\.github\.io\/reverse-logo-hunt\/"$/m);
  assert.match(yaml, /^hub: true$/m);
  for (const k of ["category_ja", "category_en", "tags"]) assert.match(yaml, new RegExp(`^${k}:\\n  - `, "m"), `${k} はブロック形式`);
});

test("シリーズの決まった形（H1・Day の行・このツールについて）", () => {
  assert.match(body, /^# Reverse Logo Hunt - ロゴを逆引きして企業マップ化するOSINTツール$/m);
  assert.match(body, /^\*\*Day091 - 生成AIで作るセキュリティツール100\*\*$/m);
  assert.match(body, /「生成AIで作るセキュリティツール100」プロジェクトの一環/);
  assert.match(body, /https:\/\/akademeia\.info\/\?page_id=42163/);
  assert.doesNotMatch(body, /page_id=44607|セキュリティツール200/);
  const heads = [...body.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
  assert.deepEqual(heads.slice(0, 2), ["🌐 デモページ", "📸 スクリーンショット"]);
  assert.deepEqual(heads.slice(-5), ["📁 ディレクトリー構造", "🧪 テスト", "💻 動作環境", "📄 ライセンス", "🛠️ このツールについて"]);
});

test("README の画像は実在し、assets の画像はすべて README から参照される", () => {
  const refs = [...body.matchAll(/!\[([^\]]+)\]\((assets\/[^)]+)\)/g)];
  assert.equal(refs.length, 6);
  for (const [, alt, path] of refs) {
    assert.ok(alt.trim(), "代替テキストが空");
    assert.ok(existsSync(new URL(path, ROOT)), `${path} がない`);
  }
  const pngs = readdirSync(new URL("assets/", ROOT)).filter((f) => f.endsWith(".png")).map((f) => `assets/${f}`).sort();
  assert.deepEqual(pngs, refs.map((r) => r[2]).sort());
});

function walk(dir, base = "") {
  const out = [];
  for (const name of readdirSync(new URL(dir, ROOT))) {
    if ([".git", ".claude", "node_modules"].includes(name)) continue;
    const rel = base + name;
    if (statSync(new URL(dir + name, ROOT)).isDirectory()) out.push(...walk(`${dir}${name}/`, `${rel}/`));
    else out.push(rel);
  }
  return out;
}

function treeEntries() {
  const sec = body.slice(body.indexOf("## 📁 ディレクトリー構造"));
  const block = sec.slice(sec.indexOf("```\n") + 4, sec.indexOf("\n```", sec.indexOf("```\n") + 4));
  const lines = block.split("\n").slice(1);
  const stack = [];
  return lines.map((line) => {
    const m = /^((?:│   |    )*)(?:├── |└── )(\S+)\s*(?:# (.*))?$/.exec(line);
    assert.ok(m, `ツリーの行の形が違う: ${line}`);
    const depth = m[1].length / 4;
    stack.length = depth;
    const name = m[2].replace(/\/$/, "");
    stack.push(name);
    return { path: stack.join("/"), isDir: m[2].endsWith("/"), comment: (m[3] || "").trim() };
  });
}

test("ディレクトリー構造: 全ファイルが載り、全行に説明がある", () => {
  const entries = treeEntries();
  for (const e of entries) assert.ok(e.comment, `${e.path} に説明がない`);
  const files = entries.filter((e) => !e.isDir).map((e) => e.path).sort();
  const actual = walk("").sort();
  assert.deepEqual(files, actual);
});

test("表記の決まり（禁止語・長音・リポジトリ）", () => {
  const text = proseLines(body).join("\n");
  const banned = [/全て/, /分かる/, /既に/, /無い/, /ブラウザ(?!ー)/, /サーバ(?!ー)/, /ユーザ(?!ー)/, /インターフェース/, /リポジトリー/,
    /ディレクトリ(?!ー)/, /もっとも/];
  for (const re of banned) assert.doesNotMatch(text, re, `${re} がある`);
});

test("日本語と英字の間に空白を入れない（コードの外）", () => {
  const J = "[\\u3040-\\u30ff\\u3400-\\u9fff\\u3001\\u3002\\u300c-\\u300f\\uff08\\uff09]";
  const re = new RegExp(`${J} [A-Za-z0-9\`]|[A-Za-z0-9\`] ${J}`);
  for (const line of proseLines(body)) {
    const plain = line.replace(/`[^`]*`/g, "x");
    assert.doesNotMatch(plain, re, line);
  }
});

test("太字は1つの節に2か所まで、箇条書きの項目名は太字にしない", () => {
  for (const s of sections(body)) {
    const n = (proseLines(s.lines.join("\n")).join("\n").match(/\*\*[^*]+\*\*/g) || []).length;
    assert.ok(n <= 2, `${s.title} に太字が ${n} か所`);
    for (const l of s.lines) assert.doesNotMatch(l, /^\s*- \*\*/, `${s.title}: ${l}`);
  }
});

test("しくみの数値は計算部の定数と一致する", () => {
  const w = LM.WEIGHTS;
  for (const [name, v] of [["形", w.shape], ["明暗の構造", w.structure], ["縦横比", w.aspect], ["色", w.color]]) {
    assert.match(body, new RegExp(`^\\| ${name} \\| .+ \\| ${v.toFixed(2)} \\|$`, "m"), name);
  }
  const r = CR.WEIGHTS;
  assert.match(body, new RegExp(`総合 = ${r.search}×検索の順位の点 \\+ ${r.type}×種類の点 \\+ ${r.visual}×照合の合計`));
  const pts = [1, 2, 3, 4].map((k) => Math.round(CR.searchScore(k) * 1000) / 1000);
  assert.match(body, new RegExp(`1位が${pts[0]}、2位が${pts[1]}、3位が${pts[2]}、4位が${pts[3]}`));
  assert.match(body, new RegExp(`それ以外（製品・作品など）は${CR.typeScore({})}`));
  assert.match(body, new RegExp(`取得できない候補は${CR.NO_VISUAL}`));
  assert.match(body, new RegExp(`上位${SEARCH_LIMIT}件`));
  assert.match(body, new RegExp(`最大${MAX_VISUAL}件`));
  assert.match(body, new RegExp(`幅${THUMB_WIDTH}px`));
  assert.match(body, new RegExp(`高さ${TARGET_HEIGHT}px`));
  assert.match(body, new RegExp(`最大${MAX_QUERIES}つ`));
  assert.equal(CR.isCloseCall([{ combined: 0.8 }, { combined: 0.751 }]), true);
  assert.equal(CR.isCloseCall([{ combined: 0.8 }, { combined: 0.749 }]), false);
  assert.match(body, /差が0\.05未満/);
});

test("このツールならではの使い方の数値は計算部で出した値", () => {
  const f3 = (v) => v.toFixed(3);
  const ref = (img) => LM.describe(img, { reference: true });
  const fake = LM.compare(LM.describe(place(greenWord(), [250, 250, 247], 14)), ref(blueWord()));
  const real = LM.compare(LM.describe(place(blueWord(), [250, 250, 247], 14)), ref(blueWord()));
  assert.ok(body.includes(`形・明暗の構造・縦横比が${f3(fake.shape)}のまま色だけが${f3(fake.color)}に下がり、照合の合計は${f3(fake.total)}`));
  assert.equal(fake.shape, fake.structure);
  assert.equal(fake.shape, fake.aspect);
  assert.ok(body.includes(`（本物は${f3(real.total)}）`));
  const parent = CR.combinedScore({ rank: 1, isOrg: true, match: { total: 0.753 } });
  const child = CR.combinedScore({ rank: 5, isOrg: true, match: { total: 0.79 } });
  assert.ok(body.includes(`任天堂が${f3(parent)}、子会社が${f3(child)}`));
  const inv = LM.compare(LM.describe(place(invertDark(blackRing()), [32, 34, 40], 8)), ref(blackRing()));
  assert.ok(body.includes(`元の黒い輪と照合の合計${f3(inv.total)}`));
});

test("任天堂の事例の数は、保存した実際の応答と一致する", () => {
  const fx = (n) => JSON.parse(readFileSync(new URL(`test/fixtures/${n}`, ROOT), "utf8"));
  const rel = parseRelations(fx("relations-Q8093.json"), "Q8093");
  const subs = rel.edges.filter((e) => e.kinds.includes("subsidiary")).length;
  const owners = rel.edges.filter((e) => e.kinds.includes("owner"));
  const names = owners.map((e) => rel.nodes.find((n) => n.qid === e.source).label).sort();
  assert.ok(body.includes(`子会社${subs}社と所有者${owners.length}者（`), `子会社${subs}・所有者${owners.length}`);
  for (const n of names) assert.ok(body.includes(n), n);
  assert.equal(rel.edges.filter((e) => e.kinds.includes("parent")).length, 0);
  const d = parseDetails(fx("details-nintendo.json")).get("Q8093");
  assert.ok(body.includes(`本社は${d.hq.label}`));
  assert.ok(body.includes(d.logoFiles[0]));
});
