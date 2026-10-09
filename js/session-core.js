// ワークスペースの JSON（書き出し・読み込み）の形と検証（計算部。DOM に依存しない）
//
// 読み込みでは、知っている項目だけを型と範囲を確かめて組み直す。知らない項目は捨てる。
// 文字列は表示のときに textContent で入れるが、念のため長さも切る。HTML を持つ項目（旧版の creditHtml）は捨てる。
// 旧版（version 2）の JSON は、選ばれていた会社だけを候補1件として読み替える。
import { isQid } from "./wikidata-core.js";
import { isAllowedImageUrl, isCommonsPageUrl } from "./commons-core.js";

export const VERSION = 3;
export const LIMITS = Object.freeze({ images: 50, logos: 500, candidates: 20, queries: 5, dataUrlChars: 40 * 1024 * 1024 });
export const STATUSES = Object.freeze(["pending", "done", "nohit", "noquery", "error"]);
const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class SessionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function str(v, max = 200) {
  return typeof v === "string" ? [...v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")].slice(0, max).join("") : "";
}

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function coord(c) {
  if (!c || typeof c !== "object") return null;
  const lat = num(c.lat, -90, 90);
  const lng = num(c.lng, -180, 180);
  return lat === null || lng === null ? null : { lat, lng };
}

function score01(v) {
  const n = num(v, 0, 1);
  return n === null ? 0 : n;
}

function match(m) {
  if (!m || typeof m !== "object") return null;
  return { shape: score01(m.shape), structure: score01(m.structure), aspect: score01(m.aspect), color: score01(m.color), total: score01(m.total) };
}

function logoInfo(l) {
  if (!l || typeof l !== "object" || !isAllowedImageUrl(l.thumburl)) return null;
  return {
    file: str(l.file, 240),
    thumburl: l.thumburl,
    descUrl: isCommonsPageUrl(l.descUrl) ? l.descUrl : "",
    artist: str(l.artist, 200),
    license: str(l.license, 80),
  };
}

function candidate(c) {
  if (!c || typeof c !== "object" || !isQid(c.qid)) return null;
  let hq = null;
  if (c.hq && typeof c.hq === "object" && coord(c.hq.coord)) {
    hq = { qid: isQid(c.hq.qid) ? c.hq.qid : null, label: str(c.hq.label, 120), coord: coord(c.hq.coord) };
  }
  return {
    qid: c.qid,
    rank: Math.round(num(c.rank, 1, 100) || 1),
    label: str(c.label, 160) || c.qid,
    description: str(c.description, 240),
    isOrg: c.isOrg === true,
    isBrand: c.isBrand === true,
    hq,
    logo: logoInfo(c.logo),
    match: match(c.match),
    combined: score01(c.combined),
  };
}

function image(im, index) {
  if (!im || typeof im !== "object") throw new SessionError("image");
  if (typeof im.dataUrl !== "string" || im.dataUrl.length > LIMITS.dataUrlChars || !DATA_URL.test(im.dataUrl)) {
    throw new SessionError("image-data");
  }
  const width = Math.round(num(im.width, 1, 20000) || 0);
  const height = Math.round(num(im.height, 1, 20000) || 0);
  if (!width || !height) throw new SessionError("image-size");
  return {
    id: typeof im.id === "string" && ID.test(im.id) ? im.id : `img-${index + 1}`,
    name: str(im.name, 200) || `image-${index + 1}`,
    width,
    height,
    scale: num(im.scale, 0.0001, 1) || 1,
    exif: coord(im.exif),
    dataUrl: im.dataUrl,
  };
}

// 座標は整数にし、画像からはみ出す分は画像の中へ切り詰める（左上が画像の外なら捨てる）
function box(l, img) {
  const x = num(l.x, 0, img.width - 1);
  const y = num(l.y, 0, img.height - 1);
  const w = num(l.w, 1, 1e6);
  const h = num(l.h, 1, 1e6);
  if (x === null || y === null || w === null || h === null) return null;
  const bx = Math.round(x);
  const by = Math.round(y);
  return { x: bx, y: by, w: Math.max(1, Math.min(img.width - bx, Math.round(w))), h: Math.max(1, Math.min(img.height - by, Math.round(h))) };
}

function logo(l, images, index) {
  if (!l || typeof l !== "object") return null;
  const img = images.find((im) => im.id === l.imageId);
  if (!img) return null;
  const b = box(l, img);
  if (!b) return null;
  const candidates = (Array.isArray(l.candidates) ? l.candidates : []).slice(0, LIMITS.candidates).map(candidate).filter(Boolean);
  const selectedQid = isQid(l.selectedQid) && candidates.some((c) => c.qid === l.selectedQid) ? l.selectedQid : null;
  return {
    id: typeof l.id === "string" && ID.test(l.id) ? l.id : `logo-${index + 1}`,
    imageId: img.id,
    ...b,
    source: l.source === "auto" ? "auto" : "manual",
    ocrText: str(l.ocrText, 400),
    queries: (Array.isArray(l.queries) ? l.queries : []).map((q) => str(q, 80)).filter(Boolean).slice(0, LIMITS.queries),
    query: str(l.query, 80),
    status: STATUSES.includes(l.status) ? l.status : "pending",
    candidates,
    selectedQid,
    selectedBy: selectedQid && l.selectedBy === "user" ? "user" : "auto",
  };
}

// 旧版（version 2）: images[].marks[].companyData.company を候補1件にする
function fromV2(payload) {
  const images = [];
  const logos = [];
  payload.images.slice(0, LIMITS.images).forEach((im, i) => {
    const img = image({ ...im, id: `img-${i + 1}` }, i);
    images.push(img);
    (Array.isArray(im.marks) ? im.marks : []).forEach((m) => {
      const co = m && m.companyData && m.companyData.company;
      const cand = co && isQid(co.qid)
        ? candidate({ qid: co.qid, rank: 1, label: co.label, hq: coord(co.coord) ? { coord: co.coord, label: "" } : null,
          logo: isAllowedImageUrl(co.thumburl) ? { thumburl: co.thumburl } : null })
        : null;
      logos.push({
        id: `logo-${logos.length + 1}`,
        imageId: img.id,
        x: m && m.x, y: m && m.y, w: m && m.w, h: m && m.h,
        source: m && m.source === "manual" ? "manual" : "auto",
        ocrText: m && m.ocrText,
        queries: m && m.bestText ? [m.bestText] : [],
        query: m && m.bestText,
        status: cand ? "done" : "pending",
        candidates: cand ? [cand] : [],
        selectedQid: cand ? cand.qid : null,
        selectedBy: "auto",
      });
    });
  });
  return { images, logos };
}

export function sanitizeWorkspace(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.images)) throw new SessionError("format");
  if (payload.images.length > LIMITS.images) throw new SessionError("too-many-images");
  let raw;
  if (payload.version === 2) raw = fromV2(payload);
  else if (payload.version === VERSION) {
    const images = payload.images.map(image);
    if (new Set(images.map((i) => i.id)).size !== images.length) throw new SessionError("duplicate-id");
    raw = { images, logos: Array.isArray(payload.logos) ? payload.logos.slice(0, LIMITS.logos) : [] };
  } else throw new SessionError("version");
  const logos = raw.logos.map((l, i) => logo(l, raw.images, i)).filter(Boolean);
  const seen = new Set();
  for (const l of logos) {
    if (seen.has(l.id)) l.id = `logo-${seen.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
    seen.add(l.id);
  }
  return { version: VERSION, images: raw.images, logos };
}

// 書き出し用に、画面の状態から JSON に入れる項目だけを取り出す
export function buildWorkspace({ images, logos, savedAt }) {
  return {
    app: "reverse-logo-hunt",
    version: VERSION,
    savedAt: str(savedAt, 40),
    images: images.map((im) => ({ id: im.id, name: im.name, width: im.width, height: im.height, scale: im.scale, exif: im.exif, dataUrl: im.dataUrl })),
    logos: logos.map((l) => ({
      id: l.id, imageId: l.imageId, x: l.x, y: l.y, w: l.w, h: l.h, source: l.source,
      ocrText: l.ocrText, queries: l.queries, query: l.query, status: l.status,
      candidates: l.candidates.map(candidate).filter(Boolean),
      selectedQid: l.selectedQid, selectedBy: l.selectedBy,
    })),
  };
}
