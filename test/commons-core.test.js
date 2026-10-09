import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../js/commons-core.js";

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("imageinfo の URL: 既定の幅330で、複数のファイルを1回で引く", () => {
  const u = new URL(C.imageInfoUrl(["Nintendo.svg", "File:Sony_Group_logo.svg", "Nintendo.svg"]));
  assert.equal(u.searchParams.get("iiurlwidth"), "330");
  assert.equal(u.searchParams.get("titles"), "File:Nintendo.svg|File:Sony Group logo.svg");
  assert.equal(u.searchParams.get("origin"), "*");
  assert.throws(() => C.imageInfoUrl([]));
  assert.throws(() => C.imageInfoUrl(["a|b"]));
});

test("実際の応答: サムネイルは thumb.wikimedia.org、作者は HTML でなく文字", () => {
  const m = C.parseImageInfo(fx("imageinfo-nintendo-sony.json"));
  const n = m.get("Nintendo.svg");
  assert.match(n.thumburl, /^https:\/\/thumb\.wikimedia\.org\/.+\/330px-Nintendo\.svg\.png/);
  assert.equal(n.descUrl, "https://commons.wikimedia.org/wiki/File:Nintendo.svg");
  assert.equal(n.artist, "Nintendo");
  assert.equal(n.license, "Public domain");
  assert.equal(m.get("Sony Group logo.svg").artist, "Sony Group Corporation");
});

test("配信元と出典ページの URL は決まったものだけ通す", () => {
  assert.equal(C.isAllowedImageUrl("https://thumb.wikimedia.org/a.png"), true);
  assert.equal(C.isAllowedImageUrl("https://upload.wikimedia.org/a.png"), true);
  assert.equal(C.isAllowedImageUrl("http://upload.wikimedia.org/a.png"), false);
  assert.equal(C.isAllowedImageUrl("https://evil.example/thumb.wikimedia.org/a.png"), false);
  assert.equal(C.isCommonsPageUrl("https://commons.wikimedia.org/wiki/File:A.svg"), true);
  assert.equal(C.isCommonsPageUrl("javascript:alert(1)"), false);
  assert.equal(C.isCommonsPageUrl("https://commons.wikimedia.org.evil.example/wiki/x"), false);
});

test("HTML から文字だけを取り出す", () => {
  const html = '<bdi><a href="https://en.wikipedia.org/wiki/en:Nintendo" class="extiw"><span title="x">Nintendo</span></a></bdi>';
  assert.equal(C.htmlToText(html), "Nintendo");
  assert.equal(C.htmlToText('<img src=x onerror="alert(1)">Tom &amp; Jerry &#x41;&#66; &lt;b&gt;'), "Tom & Jerry AB <b>");
  assert.equal(C.htmlToText("<script>alert(1)</script>ok"), "ok");
  assert.equal(C.htmlToText("a".repeat(500)).length, 200);
});

test("見つからない・配信元が違うページは捨てる", () => {
  const json = {
    query: {
      pages: {
        "-1": { title: "File:Missing.svg", missing: "" },
        5: {
          title: "File:Bad.svg",
          imageinfo: [{ thumburl: "https://evil.example/x.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:Bad.svg" }],
        },
        6: { title: "File:Ok_1.svg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/x.png", descriptionurl: "javascript:x" }] },
      },
    },
  };
  const m = C.parseImageInfo(json);
  assert.deepEqual([...m.keys()], ["Ok 1.svg"]);
  assert.equal(m.get("Ok 1.svg").descUrl, "");
});
