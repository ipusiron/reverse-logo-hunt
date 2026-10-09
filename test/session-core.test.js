import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeWorkspace, buildWorkspace, SessionError, VERSION } from "../js/session-core.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function v3(extra = {}) {
  return {
    version: VERSION,
    images: [{ id: "img-1", name: "a.png", width: 100, height: 50, scale: 1, exif: { lat: 35, lng: 135 }, dataUrl: PNG }],
    logos: [{
      id: "logo-1", imageId: "img-1", x: 10.6, y: 5.2, w: 200, h: 30, source: "manual",
      ocrText: "NINTENDO", queries: ["NINTENDO"], query: "NINTENDO", status: "done",
      candidates: [{
        qid: "Q8093", rank: 1, label: "任天堂", description: "", isOrg: true, isBrand: false,
        hq: { qid: "Q34600", label: "京都市", coord: { lat: 35.01, lng: 135.77 } },
        logo: {
          file: "Nintendo.svg",
          thumburl: "https://thumb.wikimedia.org/x.png",
          descUrl: "https://commons.wikimedia.org/wiki/File:Nintendo.svg",
          artist: "Nintendo",
          license: "Public domain",
        },
        match: { shape: 0.9, structure: 0.8, aspect: 0.95, color: 0.7, total: 0.84 }, combined: 0.93,
      }],
      selectedQid: "Q8093", selectedBy: "user",
    }],
    ...extra,
  };
}

test("正しい version 3 はそのまま読め、座標は整数にし画像の中に収める", () => {
  const s = sanitizeWorkspace(v3());
  assert.equal(s.images.length, 1);
  const l = s.logos[0];
  assert.deepEqual([l.x, l.y, l.w, l.h], [11, 5, 89, 30]);
  assert.equal(l.selectedQid, "Q8093");
  assert.equal(l.selectedBy, "user");
  assert.equal(l.candidates[0].logo.artist, "Nintendo");
});

test("知らない項目と危ない値は捨てる", () => {
  const p = v3();
  p.logos[0].candidates[0].logo.thumburl = "javascript:alert(1)";
  p.logos[0].candidates[0].hq.coord = { lat: 999, lng: 0 };
  p.logos[0].candidates[0].creditHtml = '<img src=x onerror="alert(1)">';
  p.logos[0].evil = "<script>";
  p.logos[0].status = "<b>";
  const s = sanitizeWorkspace(p);
  const c = s.logos[0].candidates[0];
  assert.equal(c.logo, null);
  assert.equal(c.hq, null);
  assert.equal("creditHtml" in c, false);
  assert.equal("evil" in s.logos[0], false);
  assert.equal(s.logos[0].status, "pending");
});

test("QID でない候補・存在しない候補を選んでいる状態は捨てる", () => {
  const p = v3();
  p.logos[0].candidates.push({ qid: "Q1 }" });
  p.logos[0].selectedQid = "Q999";
  const s = sanitizeWorkspace(p);
  assert.equal(s.logos[0].candidates.length, 1);
  assert.equal(s.logos[0].selectedQid, null);
});

test("画像のデータは data:image の Base64 だけ", () => {
  for (const bad of ["https://example.com/a.png", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4="]) {
    const p = v3();
    p.images[0].dataUrl = bad;
    assert.throws(() => sanitizeWorkspace(p), SessionError);
  }
});

test("形のおかしいもの・知らない版は拒否する", () => {
  assert.throws(() => sanitizeWorkspace(null), SessionError);
  assert.throws(() => sanitizeWorkspace({ version: 3 }), SessionError);
  assert.throws(() => sanitizeWorkspace({ version: 1, images: [] }), SessionError);
  const p = v3();
  p.images.push({ ...p.images[0] });
  assert.throws(() => sanitizeWorkspace(p), /duplicate-id/);
});

test("旧版（version 2）は選ばれていた会社を候補1件として読み、creditHtml は捨てる", () => {
  const v2 = {
    version: 2,
    images: [{
      name: "<img src=x>.png", width: 100, height: 50, dataUrl: PNG,
      marks: [{
        x: 1, y: 2, w: 30, h: 20, bestText: "nintendo", ocrText: "NINTENDO", source: "manual",
        companyData: { company: { qid: "Q123018", label: "Nintendo Software Technology", thumburl: "https://thumb.wikimedia.org/a.png",
          creditHtml: '<a href="javascript:alert(1)">x</a>', coord: null } },
      }],
    }],
  };
  const s = sanitizeWorkspace(v2);
  assert.equal(s.version, VERSION);
  assert.equal(s.images[0].name, "<img src=x>.png");
  const l = s.logos[0];
  assert.equal(l.query, "nintendo");
  assert.equal(l.selectedQid, "Q123018");
  assert.equal(JSON.stringify(l).includes("javascript"), false);
});

test("書き出した JSON を読み込むと同じ中身になる", () => {
  const s1 = sanitizeWorkspace(v3());
  const out = buildWorkspace({ images: s1.images, logos: s1.logos, savedAt: "2026-10-09T12:00:00.000Z" });
  assert.equal(out.app, "reverse-logo-hunt");
  const s2 = sanitizeWorkspace(JSON.parse(JSON.stringify(out)));
  assert.deepEqual(s2, s1);
});
