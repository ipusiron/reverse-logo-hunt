// ロゴ領域を選ぶ画面（モーダル）。マウス・タッチ・ペンを Pointer Events でまとめて扱う
import { t } from "./messages.js";
import { getItem, setItem } from "./storage.js";

export const MIN_ROI = 20;
// OCR の言語。jpn+eng を選んだときだけ日本語のデータ（約2MB）を追加で読み込む
export const OCR_LANGS = Object.freeze(["eng", "jpn+eng"]);

export function ocrLangSetting() {
  const v = getItem("ocrLang");
  return OCR_LANGS.includes(v) ? v : "eng";
}
let openModal = null;

export function isMarkingOpen() {
  return !!openModal;
}

export function closeMarking() {
  if (openModal) openModal.close();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// 画面上の点を画像の座標（整数）に直す。画像の外は端に寄せる
export function toImagePoint(clientX, clientY, rect, width, height) {
  const x = ((clientX - rect.left) / rect.width) * width;
  const y = ((clientY - rect.top) / rect.height) * height;
  return { x: Math.round(Math.max(0, Math.min(width, x))), y: Math.round(Math.max(0, Math.min(height, y))) };
}

export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// meta = { name, canvasEl }。onAnalyze(rois, ui) / suggest(canvasEl) → [{ x, y, w, h, score }]
export function openMarking(meta, { onAnalyze, suggest }) {
  closeMarking();
  const previousFocus = document.activeElement;
  const rois = [];

  const modal = el("div", "marking-modal");
  const content = el("div", "marking-modal-content");
  content.setAttribute("role", "dialog");
  content.setAttribute("aria-modal", "true");
  content.setAttribute("aria-labelledby", "markingTitle");
  const header = el("div", "marking-modal-header");
  const title = el("h3", "", t("mark.title", { name: meta.name }));
  title.id = "markingTitle";
  const closeBtn = button("✕", "close-modal-btn", () => close());
  closeBtn.setAttribute("aria-label", t("common.close"));
  header.append(title, closeBtn);

  const body = el("div", "marking-modal-body");
  const wrapper = el("div", "marking-canvas-wrapper");
  const canvas = document.createElement("canvas");
  canvas.id = "modalMarkingCanvas";
  canvas.width = meta.canvasEl.width;
  canvas.height = meta.canvasEl.height;
  canvas.setAttribute("aria-label", t("mark.canvasLabel"));
  wrapper.appendChild(canvas);

  const side = el("div", "marking-modal-sidebar");
  const howto = el("div", "marking-instructions");
  howto.appendChild(el("h4", "", t("mark.howTitle")));
  const ol = el("ol");
  for (const k of ["mark.how1", "mark.how2", "mark.how3", "mark.how4"]) ol.appendChild(el("li", "", t(k)));
  howto.appendChild(ol);

  const controls = el("div", "marking-controls");
  const clearBtn = button(t("mark.clear"), "", () => {
    rois.length = 0;
    renderList();
    redraw();
  });
  const wholeBtn = button(t("mark.whole"), "secondary", () => {
    addRoi({ x: 0, y: 0, w: canvas.width, h: canvas.height }, "manual");
  });
  const autoBtn = button(t("mark.auto"), "secondary", () => {
    const boxes = suggest ? suggest(meta.canvasEl) : [];
    let added = 0;
    for (const b of boxes) if (addRoi(b, "auto")) added++;
    status.textContent = added ? t("mark.autoAdded", { n: added }) : t("mark.autoNone");
  });
  const analyzeBtn = button(t("mark.analyze"), "primary", async () => {
    if (!rois.length) {
      status.textContent = t("analyze.needRoi");
      return;
    }
    setBusy(true);
    await onAnalyze(rois.slice(), ui, { lang: langSelect.value });
  });
  clearBtn.id = "modalClearSelection";
  wholeBtn.id = "modalWholeImage";
  autoBtn.id = "modalAutoSuggest";
  analyzeBtn.id = "modalAnalyzeSelection";
  controls.append(clearBtn, wholeBtn, autoBtn, analyzeBtn);
  const langWrap = el("div", "ocr-lang");
  const langLabel = el("label", "", t("mark.ocrLang"));
  langLabel.htmlFor = "ocrLang";
  const langSelect = document.createElement("select");
  langSelect.id = "ocrLang";
  for (const v of OCR_LANGS) {
    const o = el("option", "", t(`mark.ocrLang.${v}`));
    o.value = v;
    langSelect.appendChild(o);
  }
  langSelect.value = ocrLangSetting();
  langSelect.addEventListener("change", () => setItem("ocrLang", langSelect.value));
  langWrap.append(langLabel, langSelect);
  const status = el("p", "marking-status");
  status.setAttribute("role", "status");

  const listWrap = el("div", "selected-rois-container");
  listWrap.appendChild(el("h4", "", t("mark.selected")));
  const list = el("ul", "modal-selected-rois");
  list.id = "modalSelectedROIs";
  listWrap.appendChild(list);
  side.append(howto, langWrap, controls, status, listWrap);
  body.append(wrapper, side);

  const overlay = el("div", "modal-loading");
  overlay.hidden = true;
  const box = el("div", "loading-content");
  const spinner = el("div", "spinner");
  const loadingText = el("div", "loading-text");
  const loadingSub = el("div", "loading-subtext");
  loadingSub.setAttribute("role", "status");
  box.append(spinner, loadingText, loadingSub);
  overlay.appendChild(box);

  content.append(header, body, overlay);
  modal.appendChild(content);
  document.body.appendChild(modal);

  const ctx = canvas.getContext("2d");
  let drag = null;

  function redraw(current) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(meta.canvasEl, 0, 0);
    const lw = Math.max(2, Math.round(canvas.width / 400));
    rois.forEach((r) => {
      ctx.lineWidth = lw;
      ctx.strokeStyle = r.source === "auto" ? "#ff2a6d" : "#00ff88";
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    });
    if (current) {
      ctx.lineWidth = lw + 1;
      ctx.strokeStyle = "#59b0ff";
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(current.x, current.y, current.w, current.h);
      ctx.setLineDash([]);
    }
  }

  function addRoi(r, source) {
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.min(canvas.width - x, Math.round(r.w));
    const h = Math.min(canvas.height - y, Math.round(r.h));
    if (w < MIN_ROI || h < MIN_ROI) return false;
    if (rois.some((o) => o.x === x && o.y === y && o.w === w && o.h === h)) return false;
    const patch = document.createElement("canvas");
    patch.width = w;
    patch.height = h;
    patch.getContext("2d", { willReadFrequently: true }).drawImage(meta.canvasEl, x, y, w, h, 0, 0, w, h);
    rois.push({ x, y, w, h, source, canvas: patch });
    renderList();
    redraw();
    return true;
  }

  function renderList() {
    list.replaceChildren();
    rois.forEach((r, i) => {
      const li = el("li", "roi-preview");
      const pv = document.createElement("canvas");
      pv.width = 80;
      pv.height = 80;
      const s = Math.min(80 / r.w, 80 / r.h);
      pv.getContext("2d").drawImage(r.canvas, (80 - r.w * s) / 2, (80 - r.h * s) / 2, r.w * s, r.h * s);
      const info = el("div", "roi-info");
      const head = el("div", "roi-headline");
      head.appendChild(el("span", "roi-index", t("mark.roi", { n: i + 1 })));
      if (r.source === "auto") head.appendChild(el("span", "badge roi-badge", t("mark.autoBadge")));
      info.append(head, el("div", "meta", `${r.w}×${r.h}px`));
      const rm = button("×", "remove-roi-btn", () => {
        rois.splice(rois.indexOf(r), 1);
        renderList();
        redraw();
      });
      rm.setAttribute("aria-label", t("mark.removeRoi", { n: i + 1 }));
      li.append(pv, info, rm);
      list.appendChild(li);
    });
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, start: toImagePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height) };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toImagePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    redraw(rectFromPoints(drag.start, p));
  });
  const finish = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toImagePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    const r = rectFromPoints(drag.start, p);
    drag = null;
    if (e.type === "pointerup" && !addRoi(r, "manual")) {
      if (r.w > 2 || r.h > 2) status.textContent = t("mark.tooSmall", { n: MIN_ROI });
      redraw();
    } else if (e.type !== "pointerup") {
      redraw();
    }
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  const onKey = (e) => {
    if (e.key === "Escape" && overlay.hidden) {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey);

  function setBusy(busy) {
    overlay.hidden = !busy;
    [clearBtn, wholeBtn, autoBtn, analyzeBtn, closeBtn, langSelect].forEach((b) => (b.disabled = busy));
  }

  function close() {
    document.removeEventListener("keydown", onKey);
    modal.remove();
    if (openModal && openModal.modal === modal) openModal = null;
    if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) previousFocus.focus();
  }

  const ui = {
    progress(main, sub = "") {
      loadingText.textContent = main;
      loadingSub.textContent = sub;
    },
    fail(message) {
      setBusy(false);
      status.textContent = message;
    },
    close,
  };

  openModal = { modal, close };
  redraw();
  closeBtn.focus();
  return openModal;
}
