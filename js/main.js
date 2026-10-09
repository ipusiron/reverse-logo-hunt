// 画面の組み立てと操作（DOM）。計算は *-core.js・logo-match.js・candidate-rank.js などにある
import { readExifGps } from "./exif.js";
import { initMap, setHQPoint, setShotPoint, drawLine, resetMap, refreshMapLayers } from "./map.js";
import { distancesFrom } from "./geo.js";
import { resetGraph, showRelations, showGroup, refreshGraph, onModeChange, getMode } from "./graph.js";
import { fetchRelations, fetchAncestorLinks, HttpError } from "./wikidata.js";
import { buildGroup } from "./group-core.js";
import { findCandidates, imageDataOf, loadImage } from "./analysis.js";
import { recognize } from "./ocr.js";
import { brandQueries, normalizeQuery } from "./brand-text.js";
import { describe } from "./logo-match.js";
import { searchScore, typeScore, isCloseCall, WEIGHTS as RANK_WEIGHTS, NO_VISUAL } from "./candidate-rank.js";
import { isAllowedImageUrl, isCommonsPageUrl } from "./commons-core.js";
import { sanitizeWorkspace, buildWorkspace } from "./session-core.js";
import { suggestRois } from "./roi-suggest.js";
import { openMarking, isMarkingOpen } from "./marking.js";
import { t, getLang } from "./messages.js";
import { getItem, setItem, getJsonItem } from "./storage.js";

const MAX_LONG_SIDE = 1536;
const HISTORY_KEY = "rlogo_history";

const state = {
  images: [], // { id, name, canvasEl, width, height, scale, exif }
  logos: [], // { id, imageId, x, y, w, h, source, patch, ocrText, queries, query, status, candidates, selectedQid, selectedBy, error }
  activeLogoId: null,
  selectedImageId: null,
  seq: 0,
};

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const imageList = $("imageList");
const markedLogos = $("markedLogos");
const historyList = $("historyList");
const exportJSONBtn = $("exportJSON");
const exportPNGBtn = $("exportPNG");
const importJSONBtn = $("importJSON");
const importJSONInput = $("importJSONInput");
const logDiv = $("log");

function nextId(prefix) {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(3) : "-";
}

function log(msg) {
  const time = new Date().toLocaleTimeString(getLang() === "en" ? "en-US" : "ja-JP");
  logDiv.textContent = `[${time}] ${msg}\n${logDiv.textContent}`.slice(0, 4000);
}

function errorMessage(err) {
  if (err instanceof HttpError) return t("error.http", { status: err.status });
  if (err && err.message === "tesseract-missing") return t("error.tesseract");
  if (err instanceof TypeError) return t("error.network");
  return (err && err.message) || t("error.unknown");
}

function imageOf(logo) {
  return state.images.find((im) => im.id === logo.imageId);
}

function activeLogo() {
  return state.logos.find((l) => l.id === state.activeLogoId) || null;
}

function selectedCandidate(logo) {
  return logo ? logo.candidates.find((c) => c.qid === logo.selectedQid) || null : null;
}

// ---- タブ ----
function activateTab(tabId, { focus = false } = {}) {
  document.querySelectorAll(".tab-button").forEach((b) => {
    const on = b.dataset.tab === tabId;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  document.querySelectorAll(".tab").forEach((p) => {
    const on = p.id === tabId;
    p.classList.toggle("active", on);
    p.hidden = !on;
  });
  if (tabId === "tab-map") setTimeout(refreshMapLayers, 50);
  if (tabId === "tab-graph") setTimeout(refreshGraph, 50);
}

function setUpTabs() {
  const buttons = [...document.querySelectorAll(".tab-button")];
  buttons.forEach((btn, i) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      let j = i;
      if (e.key === "ArrowRight") j = (i + 1) % buttons.length;
      if (e.key === "ArrowLeft") j = (i - 1 + buttons.length) % buttons.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = buttons.length - 1;
      activateTab(buttons[j].dataset.tab, { focus: true });
    });
  });
  activateTab("tab-justify");
}

// ---- 画像 ----
async function handleFiles(fileList) {
  const added = [];
  for (const file of fileList) {
    if (!file.type.startsWith("image/")) continue;
    const buf = await file.arrayBuffer();
    const exif = await readExifGps(buf).catch(() => null);
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      added.push(addImage(file.name, img, exif));
    } catch {
      log(t("error.imageLoad", { name: file.name }));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (added.length) {
    selectImage(added[0].id);
    showMarking(added[0]);
  }
}

function addImage(name, img, exif, { id } = {}) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(nw, nh));
  const canvasEl = document.createElement("canvas");
  canvasEl.width = Math.round(nw * scale);
  canvasEl.height = Math.round(nh * scale);
  canvasEl.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
  const meta = { id: id || nextId("img"), name, canvasEl, width: canvasEl.width, height: canvasEl.height, scale, exif: exif || null };
  state.images.push(meta);
  renderImages();
  return meta;
}

function renderImages() {
  imageList.replaceChildren();
  for (const meta of state.images) {
    const item = el("li", "image-item");
    item.classList.toggle("selected", meta.id === state.selectedImageId);
    const open = el("button", "image-item-open");
    open.type = "button";
    const thumb = document.createElement("canvas");
    thumb.width = 64;
    thumb.height = 64;
    const s = Math.max(64 / meta.width, 64 / meta.height);
    thumb.getContext("2d").drawImage(meta.canvasEl, (64 - meta.width * s) / 2, (64 - meta.height * s) / 2, meta.width * s, meta.height * s);
    const info = el("span", "image-item-info");
    info.appendChild(el("strong", "", meta.name));
    const exifText = meta.exif ? t("image.exif", { lat: meta.exif.lat.toFixed(5), lng: meta.exif.lng.toFixed(5) }) : t("image.noExif");
    info.appendChild(el("span", "meta", exifText));
    open.append(thumb, info);
    open.addEventListener("click", () => {
      selectImage(meta.id);
      showMarking(meta);
    });
    const rm = el("button", "remove-image-btn", "×");
    rm.type = "button";
    rm.setAttribute("aria-label", `${t("image.remove")}: ${meta.name}`);
    rm.addEventListener("click", () => removeImage(meta));
    item.append(open, rm);
    imageList.appendChild(item);
  }
}

function selectImage(id) {
  state.selectedImageId = id;
  renderImages();
  updateExportButtonText();
}

function removeImage(meta) {
  const n = state.logos.filter((l) => l.imageId === meta.id).length;
  const msg = n ? t("image.confirmRemoveWithLogos", { name: meta.name, n }) : t("image.confirmRemove", { name: meta.name });
  if (!window.confirm(msg)) return;
  state.logos.filter((l) => l.imageId === meta.id).forEach((l) => (l.deleted = true));
  state.logos = state.logos.filter((l) => l.imageId !== meta.id);
  state.images = state.images.filter((im) => im.id !== meta.id);
  if (state.selectedImageId === meta.id) state.selectedImageId = state.images[0] ? state.images[0].id : null;
  if (!activeLogo()) state.activeLogoId = null;
  renderImages();
  renderMarkedLogos();
  renderResult();
  updateExportButtonText();
  saveHistory();
}

function showMarking(meta) {
  openMarking(meta, {
    suggest: (canvasEl) => {
      const d = canvasEl.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvasEl.width, canvasEl.height);
      return suggestRois({ width: d.width, height: d.height, data: d.data });
    },
    onAnalyze: (rois, ui, options) => analyzeRois(rois, meta, ui, options),
  });
}

// ---- 解析 ----
async function analyzeRois(rois, meta, ui, { lang = "eng" } = {}) {
  const logos = rois.map((r) => ({
    id: nextId("logo"),
    imageId: meta.id,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    source: r.source === "auto" ? "auto" : "manual",
    patch: r.canvas,
    ocrText: "",
    queries: [],
    query: "",
    status: "pending",
    candidates: [],
    selectedQid: null,
    selectedBy: "auto",
    error: null,
  }));
  state.logos.push(...logos);
  renderMarkedLogos();
  try {
    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      if (logo.deleted) continue;
      ui.progress(t("progress.ocr"), t("progress.ocrItem", { i: i + 1, n: logos.length }));
      try {
        const { r, queries } = await readText(logo, lang);
        logo.ocrText = r.text;
        logo.queries = queries;
      } catch (err) {
        logo.error = errorMessage(err);
        log(logo.error);
      }
      logo.query = logo.queries[0] || "";
      renderMarkedLogos();
    }
    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      if (logo.deleted) continue;
      await runSearch(logo, (key, params) => ui.progress(t("progress.searchTitle"), `${t(key, params)} (${i + 1}/${logos.length})`));
    }
    ui.progress(t("progress.done"));
    ui.close();
    const first = logos.find((l) => !l.deleted && l.candidates.length) || logos.find((l) => !l.deleted);
    if (first) setActiveLogo(first.id);
    saveHistory();
  } catch (err) {
    ui.fail(errorMessage(err));
  }
}

function cropCanvas(src, box, pad = 4) {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(src.width - x, box.w + pad * 2);
  const h = Math.min(src.height - y, box.h + pad * 2);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d", { willReadFrequently: true }).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

// 文字を読み、検索語の候補を作る。1回目で候補が出なければ読み直す
//   ロゴの字は枠や札に囲まれていることが多く、Tesseract は枠ごと「図」とみなして字を探さないことがある。
//   読み直しでは、前景の外接矩形（札だけ）に切り詰め、2値にして枠を取り除いてから読む（明暗の向きは2通り試す）。
async function readText(logo, lang = "eng") {
  const first = await recognize(logo.patch, lang);
  let queries = brandQueries(first);
  if (queries.length) return { r: first, queries };
  if (!logo.desc) logo.desc = describe(imageDataOf(logo.patch));
  const box = logo.desc.box;
  const cropped = !box.empty && (box.w < logo.patch.width - 8 || box.h < logo.patch.height - 8);
  const target = cropped ? cropCanvas(logo.patch, box) : logo.patch;
  const a = await recognize(target, lang, { frames: true });
  queries = brandQueries(a);
  if (queries.length) return { r: a, queries };
  const b = await recognize(target, lang, { frames: true, invert: !a.inverted });
  queries = brandQueries(b);
  if (queries.length) return { r: b, queries };
  return { r: first, queries: [] };
}

async function runSearch(logo, onStep = () => {}) {
  logo.error = null;
  if (!logo.query) {
    logo.status = "noquery";
    logo.candidates = [];
    logo.selectedQid = null;
    renderMarkedLogos();
    return;
  }
  if (!logo.desc) logo.desc = describe(imageDataOf(logo.patch));
  try {
    const ranked = await findCandidates(logo.query, logo.desc, { uiLang: getLang(), onStep });
    if (logo.deleted) return;
    logo.candidates = ranked;
    logo.status = ranked.length ? "done" : "nohit";
    logo.selectedQid = ranked.length ? ranked[0].qid : null;
    logo.selectedBy = "auto";
    log(`${logo.query}: ${ranked.length ? `${ranked[0].label} (${ranked[0].qid})` : "-"}`);
  } catch (err) {
    logo.status = "error";
    logo.error = errorMessage(err);
    log(`${logo.query}: ${logo.error}`);
  }
  renderMarkedLogos();
}

// ---- マーク済みロゴの一覧 ----
function logoTitle(logo) {
  const c = selectedCandidate(logo);
  return c ? c.label : logo.query || logo.ocrText || t("marked.noText");
}

function renderMarkedLogos() {
  markedLogos.replaceChildren();
  if (!state.logos.length) {
    markedLogos.appendChild(el("li", "marked-empty", t("marked.empty")));
    return;
  }
  for (const logo of state.logos) {
    const im = imageOf(logo);
    const item = el("li", `marked-logo-item status-${logo.status}`);
    item.classList.toggle("selected", logo.id === state.activeLogoId);
    const open = el("button", "marked-logo-open");
    open.type = "button";
    const pv = document.createElement("canvas");
    pv.className = "marked-logo-preview";
    pv.width = 60;
    pv.height = 60;
    const s = Math.min(60 / logo.w, 60 / logo.h);
    pv.getContext("2d").drawImage(logo.patch, (60 - logo.w * s) / 2, (60 - logo.h * s) / 2, logo.w * s, logo.h * s);
    const info = el("span", "marked-logo-info");
    info.appendChild(el("span", "marked-logo-text", logoTitle(logo)));
    info.appendChild(el("span", "meta", `${im ? im.name : ""} | ${logo.w}×${logo.h}px`));
    const status = el("span", "marked-logo-status", t(`status.${logo.status}`));
    open.append(pv, info, status);
    open.addEventListener("click", () => setActiveLogo(logo.id));
    const rm = el("button", "remove-marked-logo", "×");
    rm.type = "button";
    rm.setAttribute("aria-label", `${t("marked.remove")}: ${logoTitle(logo)}`);
    rm.addEventListener("click", () => removeLogo(logo));
    item.append(open, rm);
    markedLogos.appendChild(item);
  }
}

function removeLogo(logo) {
  const im = imageOf(logo);
  if (!window.confirm(t("marked.confirmRemove", { image: im ? im.name : "", text: logoTitle(logo) }))) return;
  logo.deleted = true;
  state.logos = state.logos.filter((l) => l !== logo);
  if (state.activeLogoId === logo.id) state.activeLogoId = state.logos[0] ? state.logos[0].id : null;
  renderMarkedLogos();
  renderResult();
  saveHistory();
}

function setActiveLogo(id) {
  state.activeLogoId = id;
  const logo = activeLogo();
  if (logo) selectImage(logo.imageId);
  renderMarkedLogos();
  renderResult();
  activateTab("tab-justify");
}

// ---- 根拠・照合 ----
function paintRoi(patch) {
  const canvas = $("roiCanvas");
  const ctx = canvas.getContext("2d");
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#0f1429";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!patch) return;
  const s = Math.min(canvas.width / patch.width, canvas.height / patch.height);
  const w = Math.round(patch.width * s);
  const h = Math.round(patch.height * s);
  ctx.drawImage(patch, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
}

function typeLabel(c) {
  if (c.isOrg) return t("cand.type.org");
  if (c.isBrand) return t("cand.type.brand");
  return t("cand.type.other");
}

function renderCredit(c) {
  const meta = $("commonsMeta");
  meta.replaceChildren();
  const thumb = $("commonsThumb");
  if (!c || !c.logo || !isAllowedImageUrl(c.logo.thumburl)) {
    thumb.hidden = true;
    thumb.removeAttribute("src");
    if (c) meta.textContent = c.matchError ? t("cand.logoFailed") : t("cand.noLogo");
    return;
  }
  thumb.hidden = false;
  thumb.crossOrigin = "anonymous";
  thumb.referrerPolicy = "no-referrer";
  thumb.src = c.logo.thumburl;
  thumb.alt = t("cand.logoAlt", { label: c.label });
  meta.append(t("credit.line", { artist: c.logo.artist || t("credit.unknown"), license: c.logo.license || t("credit.unknown") }));
  if (isCommonsPageUrl(c.logo.descUrl)) {
    const a = el("a", "", t("credit.link"));
    a.href = c.logo.descUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    meta.appendChild(a);
  } else {
    meta.append(t("credit.link"));
  }
}

function renderScores(c) {
  const body = $("scoreBody");
  body.replaceChildren();
  if (!c) return;
  const rows = [];
  if (c.match) {
    rows.push(["score.shape", c.match.shape], ["score.structure", c.match.structure], ["score.aspect", c.match.aspect]);
    rows.push(["score.color", c.match.color], ["score.matchTotal", c.match.total]);
  } else {
    rows.push(["score.matchTotal", null]);
  }
  rows.push(["score.search", searchScore(c.rank)], ["score.type", typeScore(c)], ["score.combined", c.combined]);
  for (const [key, v] of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(el("th", "", t(key)));
    tr.lastChild.scope = "row";
    tr.appendChild(el("td", "", v === null ? t("score.none") : fmt(v)));
    body.appendChild(tr);
  }
  $("scoreFormula").textContent = t("score.formula", {
    s: RANK_WEIGHTS.search,
    k: RANK_WEIGHTS.type,
    v: RANK_WEIGHTS.visual,
    none: NO_VISUAL,
  });
}

function candidateCard(logo, c, index) {
  const li = el("li", "candidate");
  const selected = c.qid === logo.selectedQid;
  li.classList.toggle("selected", selected);
  const thumbBox = el("div", "candidate-thumb");
  if (c.logo && isAllowedImageUrl(c.logo.thumburl)) {
    const img = document.createElement("img");
    // 照合で読んだときと同じ取り方（CORS・Referer なし）にして、ブラウザーのキャッシュを使い回す
    img.crossOrigin = "anonymous";
    img.src = c.logo.thumburl;
    img.alt = t("cand.logoAlt", { label: c.label });
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    thumbBox.appendChild(img);
  } else {
    thumbBox.appendChild(el("span", "candidate-nologo", c.matchError ? t("cand.logoFailed") : t("cand.noLogo")));
  }
  const body = el("div", "candidate-body");
  const head = el("div", "candidate-head");
  head.appendChild(el("span", "candidate-place", `${index + 1}.`));
  head.appendChild(el("strong", "candidate-label", c.label));
  head.appendChild(el("span", "candidate-qid", c.qid));
  body.appendChild(head);
  if (c.description) body.appendChild(el("p", "candidate-desc", c.description));
  const tags = el("div", "candidate-tags");
  tags.appendChild(el("span", "tag", t("cand.rank", { rank: c.rank })));
  tags.appendChild(el("span", "tag", typeLabel(c)));
  if (c.hq) tags.appendChild(el("span", "tag", t("cand.hq", { label: c.hq.label || "-" })));
  body.appendChild(tags);
  const scores = el("div", "candidate-scores");
  scores.appendChild(el("span", "", c.match ? t("cand.match", { v: fmt(c.match.total) }) : t("score.none")));
  scores.appendChild(el("strong", "", t("cand.combined", { v: fmt(c.combined) })));
  body.appendChild(scores);
  const action = el("div", "candidate-action");
  if (selected) {
    action.appendChild(el("span", "candidate-selected", logo.selectedBy === "user" ? t("cand.selectedUser") : t("cand.selectedAuto")));
  } else {
    const b = el("button", "secondary", t("cand.select"));
    b.type = "button";
    b.setAttribute("aria-label", `${t("cand.select")}: ${c.label}`);
    b.addEventListener("click", () => selectCandidate(logo, c.qid));
    action.appendChild(b);
  }
  li.append(thumbBox, body, action);
  return li;
}

function renderResult() {
  const logo = activeLogo();
  $("emptyState").hidden = !!logo;
  $("justifyContent").hidden = !logo;
  if (!logo) {
    resetMap();
    renderGraph();
    return;
  }
  paintRoi(logo.patch);
  $("ocrText").textContent = logo.ocrText || t("result.noOcr");
  const choices = $("queryChoices");
  choices.replaceChildren();
  for (const q of logo.queries) {
    const b = el("button", "chip", q);
    b.type = "button";
    b.setAttribute("aria-pressed", q === logo.query ? "true" : "false");
    b.addEventListener("click", () => researchActive(q));
    choices.appendChild(b);
  }
  $("queryChoicesRow").hidden = !logo.queries.length;
  $("queryInput").value = logo.query;
  const msg = $("resultMessage");
  msg.textContent = "";
  if (logo.status === "noquery") msg.textContent = t("result.noquery");
  if (logo.status === "nohit") msg.textContent = t("result.nohit", { query: logo.query });
  if (logo.status === "error") msg.textContent = t("result.error", { message: logo.error || "" });
  const list = $("candidateList");
  list.replaceChildren();
  logo.candidates.forEach((c, i) => list.appendChild(candidateCard(logo, c, i)));
  $("candidateSection").hidden = !logo.candidates.length;
  $("closeCallNote").hidden = !(isCloseCall(logo.candidates) && logo.selectedBy !== "user");
  const c = selectedCandidate(logo);
  renderCredit(c);
  renderScores(c);
  renderMapAndGraph(logo, c);
}

let graphToken = 0;
// 地図: 同じ画像で会社を選んだロゴの本社をすべて出し、撮影地点からの線と距離の表を出す
function renderMapAndGraph(logo, c) {
  resetMap();
  const im = imageOf(logo);
  const seen = new Set();
  const companies = [];
  for (const l of state.logos.filter((x) => x.imageId === logo.imageId)) {
    const sc = selectedCandidate(l);
    if (!sc || seen.has(sc.qid)) continue;
    seen.add(sc.qid);
    companies.push({ qid: sc.qid, label: sc.label, place: sc.hq ? sc.hq.label : "", coord: sc.hq ? sc.hq.coord : null, active: !!c && c.qid === sc.qid });
  }
  const shot = im && im.exif ? im.exif : null;
  const rows = distancesFrom(shot, companies);
  for (const r of rows) {
    if (!r.coord) continue;
    if (shot) drawLine(shot, r.coord);
    setHQPoint(r);
  }
  if (shot) setShotPoint({ ...shot, name: im.name });
  renderDistanceTable(shot, rows);
  renderGraph();
}

function renderDistanceTable(shot, rows) {
  const box = $("distanceBox");
  box.replaceChildren();
  box.appendChild(el("h4", "", t("dist.title")));
  if (!rows.length) {
    box.appendChild(el("p", "small", t("dist.none")));
    return;
  }
  if (!shot) box.appendChild(el("p", "small", t("dist.noExif")));
  const table = el("table", "score-table distance-table");
  const head = document.createElement("tr");
  for (const k of ["dist.company", "dist.hq", "dist.km", "dist.dir"]) {
    const th = el("th", "", t(k));
    th.scope = "col";
    head.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(head);
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "", r.label));
    tr.appendChild(el("td", "", r.coord ? r.place || "-" : t("dist.noHq")));
    tr.appendChild(el("td", "", r.km === null ? "-" : t("dist.kmValue", { km: r.km })));
    tr.appendChild(el("td", "", r.dir ? t(`dir.${r.dir}`) : "-"));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  box.appendChild(table);
}

// 写真の中で会社を選んだロゴ（重複なし）
function selectedCompanies() {
  const out = [];
  for (const l of state.logos) {
    const c = selectedCandidate(l);
    if (c && !out.some((x) => x.qid === c.qid)) out.push({ qid: c.qid, label: c.label });
  }
  return out;
}

function renderGroupSummary(message, shared = [], names = new Map()) {
  const box = $("groupSummary");
  box.replaceChildren();
  box.hidden = getMode() !== "group";
  if (box.hidden) return;
  box.appendChild(el("h4", "", t("group.title")));
  if (message) {
    box.appendChild(el("p", "small", message));
    return;
  }
  const ul = el("ul", "group-list");
  for (const s of shared) {
    const who = s.companies.map((q) => names.get(q) || q).join("・");
    ul.appendChild(el("li", "", t("group.item", { label: s.label, companies: who, depth: s.depth })));
  }
  box.appendChild(ul);
}

function renderGraph() {
  resetGraph();
  const token = ++graphToken;
  if (getMode() === "group") {
    const companies = selectedCompanies();
    if (companies.length < 2) {
      renderGroupSummary(t("group.needTwo"));
      return;
    }
    renderGroupSummary(t("group.loading"));
    fetchAncestorLinks(companies.map((c) => c.qid), getLang())
      .then((links) => {
        if (token !== graphToken) return;
        const group = buildGroup(companies, links);
        showGroup(group);
        const names = new Map(group.nodes.map((n) => [n.qid, n.label]));
        renderGroupSummary(group.shared.length ? "" : t("group.none"), group.shared, names);
      })
      .catch((err) => {
        if (token === graphToken) renderGroupSummary(errorMessage(err));
      });
    return;
  }
  renderGroupSummary();
  const c = selectedCandidate(activeLogo());
  if (!c) return;
  fetchRelations(c.qid, getLang())
    .then((rel) => {
      if (token === graphToken) showRelations({ qid: c.qid, label: c.label }, rel);
    })
    .catch((err) => log(`${c.label}: ${errorMessage(err)}`));
}

onModeChange(() => renderGraph());

function selectCandidate(logo, qid) {
  logo.selectedQid = qid;
  logo.selectedBy = "user";
  renderMarkedLogos();
  renderResult();
  saveHistory();
}

async function researchActive(query) {
  const logo = activeLogo();
  if (!logo) return;
  logo.query = normalizeQuery(query);
  const btn = $("searchButton");
  btn.disabled = true;
  $("resultMessage").textContent = t("progress.search", { query: logo.query });
  try {
    await runSearch(logo, (key, params) => ($("resultMessage").textContent = t(key, params)));
  } finally {
    btn.disabled = false;
  }
  if (state.activeLogoId === logo.id) renderResult();
  saveHistory();
}

$("queryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  researchActive($("queryInput").value);
});

// ---- 履歴 ----
function saveHistory() {
  const item = {
    timestamp: Date.now(),
    images: state.images.map((im) => im.name).slice(0, 20),
    totalMarked: state.logos.length,
    totalDone: state.logos.filter((l) => l.status === "done").length,
  };
  const history = getJsonItem(HISTORY_KEY, []);
  const list = Array.isArray(history) ? history : [];
  list.unshift(item);
  setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const raw = getJsonItem(HISTORY_KEY, []);
  const history = Array.isArray(raw) ? raw : [];
  historyList.replaceChildren();
  if (!history.length) {
    historyList.appendChild(el("li", "history-empty", t("history.empty")));
    return;
  }
  for (const h of history) {
    if (!h || typeof h !== "object") continue;
    const li = el("li", "history-item");
    const date = Number.isFinite(h.timestamp) ? new Date(h.timestamp).toLocaleString(getLang() === "en" ? "en-US" : "ja-JP") : "";
    li.appendChild(el("span", "history-date", date));
    li.appendChild(el("span", "history-counts", t("history.counts", { marked: Number(h.totalMarked) || 0, done: Number(h.totalDone) || 0 })));
    const names = Array.isArray(h.images) ? h.images.filter((n) => typeof n === "string").join(", ") : "";
    li.appendChild(el("span", "history-images", names));
    historyList.appendChild(li);
  }
}

// ---- 書き出し・読み込み ----
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

exportJSONBtn.addEventListener("click", () => {
  try {
    const ws = buildWorkspace({
      savedAt: new Date().toISOString(),
      images: state.images.map((im) => ({ ...im, dataUrl: im.canvasEl.toDataURL("image/png") })),
      logos: state.logos,
    });
    download(new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" }), `reverse-logo-hunt-workspace_${stamp()}.json`);
  } catch (err) {
    window.alert(t("export.jsonFailed", { message: errorMessage(err) }));
  }
});

importJSONBtn.addEventListener("click", () => importJSONInput.click());
importJSONInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const ws = sanitizeWorkspace(JSON.parse(await file.text()));
    await restoreWorkspace(ws);
    log(t("import.done"));
  } catch (err) {
    window.alert(t("import.failed", { message: err && err.code ? err.code : errorMessage(err) }));
  }
});

async function restoreWorkspace(ws) {
  const images = [];
  for (const im of ws.images) {
    const img = await loadImage(im.dataUrl);
    images.push({ im, img });
  }
  state.logos.forEach((l) => (l.deleted = true));
  state.images = [];
  state.logos = [];
  state.activeLogoId = null;
  for (const { im, img } of images) addImage(im.name, img, im.exif, { id: im.id }).scale = im.scale;
  for (const l of ws.logos) {
    const meta = state.images.find((m) => m.id === l.imageId);
    if (!meta) continue;
    const patch = document.createElement("canvas");
    patch.width = l.w;
    patch.height = l.h;
    patch.getContext("2d", { willReadFrequently: true }).drawImage(meta.canvasEl, l.x, l.y, l.w, l.h, 0, 0, l.w, l.h);
    state.logos.push({ ...l, patch, error: null });
  }
  state.seq = state.images.length + state.logos.length + 1;
  state.selectedImageId = state.images[0] ? state.images[0].id : null;
  renderImages();
  renderMarkedLogos();
  if (state.logos.length) setActiveLogo(state.logos[0].id);
  else renderResult();
  updateExportButtonText();
  saveHistory();
}

// 選んだ画像に、囲んだ領域と選んだ会社の名前を描いて PNG にする
function burnBoxes(meta) {
  const c = document.createElement("canvas");
  c.width = meta.width;
  c.height = meta.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(meta.canvasEl, 0, 0);
  const lw = Math.max(2, Math.round(Math.max(c.width, c.height) / 400));
  const fs = Math.max(12, Math.round(Math.max(c.width, c.height) / 60));
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  for (const logo of state.logos.filter((l) => l.imageId === meta.id)) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#00ff88";
    // 線の太さの半分だけ内側に描く（画像の端の枠が半分切れないように）
    ctx.strokeRect(logo.x + lw / 2, logo.y + lw / 2, logo.w - lw, logo.h - lw);
    const label = logoTitle(logo);
    const tw = ctx.measureText(label).width + 8;
    // 札は枠の上、入らなければ下、どちらも入らなければ枠の内側の左上に置く
    let ty = logo.y - fs - 6;
    if (ty < 0) ty = logo.y + logo.h + fs + 6 <= c.height ? logo.y + logo.h : logo.y + lw;
    ctx.fillStyle = "#00ff88";
    ctx.fillRect(logo.x, ty, tw, fs + 6);
    ctx.fillStyle = "#000000";
    ctx.fillText(label, logo.x + 4, ty + 3);
  }
  return c;
}

exportPNGBtn.addEventListener("click", () => {
  const meta = state.images.find((m) => m.id === state.selectedImageId);
  if (!meta) {
    window.alert(t("export.needImage"));
    return;
  }
  burnBoxes(meta).toBlob((b) => {
    if (b) download(b, `${meta.name.replace(/\.[^.]+$/, "")}-with-bb.png`);
  }, "image/png");
});

function updateExportButtonText() {
  const meta = state.images.find((m) => m.id === state.selectedImageId);
  exportPNGBtn.textContent = meta ? t("export.pngTo", { name: meta.name }) : t("export.pngDefault");
}

// ---- 入力（ファイル選択・ドロップ） ----
fileInput.addEventListener("change", (e) => {
  handleFiles(e.target.files);
  e.target.value = "";
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
});

// ---- ヘルプ ----
const helpModal = $("helpModal");
const helpButton = $("helpButton");
function closeHelp() {
  helpModal.hidden = true;
  helpButton.focus();
}
helpButton.addEventListener("click", () => {
  helpModal.hidden = false;
  helpModal.querySelector(".close-help-modal").focus();
});
helpModal.querySelector(".close-help-modal").addEventListener("click", closeHelp);
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) closeHelp();
});

// ---- テーマ ----
const themeToggle = $("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
  themeToggle.querySelector(".theme-icon").textContent = theme === "light" ? "☀️" : "🌙";
  themeToggle.querySelector(".theme-label").textContent = t(theme === "light" ? "theme.light" : "theme.dark");
  themeToggle.setAttribute("aria-label", t("theme.toggle"));
}
applyTheme(getItem("theme") === "light" ? "light" : "dark");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  setItem("theme", next);
  applyTheme(next);
  if (activeLogo()) paintRoi(activeLogo().patch);
});

// ---- キー操作 ----
function isTyping(target) {
  return !!(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !helpModal.hidden) {
    closeHelp();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || isMarkingOpen() || !helpModal.hidden || isTyping(e.target)) return;
  if (e.key >= "1" && e.key <= "4") {
    const btn = document.querySelectorAll(".tab-button")[Number(e.key) - 1];
    if (btn) {
      e.preventDefault();
      activateTab(btn.dataset.tab, { focus: true });
    }
  }
});

// ---- 起動 ----
setUpTabs();
renderImages();
renderMarkedLogos();
renderHistory();
renderResult();
updateExportButtonText();
initMap().catch((err) => log(errorMessage(err)));
