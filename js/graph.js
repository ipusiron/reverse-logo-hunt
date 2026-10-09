// 関係図（Cytoscape.js）。矢印は常に「親会社・所有者 → 子会社・所有される側」に向ける
// 関係のデータは wikidata-core.js の parseRelations() の形 { nodes, edges: [{ source, target, kinds }] }
import { t } from "./messages.js";

let cy = null;
let current = null;
let controlBuilt = false;
let layoutName = "cose";
let selectedEdge = null;
const filterState = { subsidiary: true, parent: true, owner: true };
// 矢印ごとに手で変えた曲線の設定（再描画しても残す）
const edgeStyles = new Map();
const DEFAULT_STYLE = Object.freeze({ curveStyle: "bezier", distance: 40, weight: 0.5 });

function ensureCy() {
  if (cy || typeof cytoscape === "undefined") return cy;
  cy = cytoscape({
    container: document.getElementById("graph"),
    elements: [],
    style: [
      {
        selector: "node",
        style: {
          "background-color": "#4aa3ff",
          label: "data(label)",
          color: "#ffffff",
          "font-size": "14px",
          "font-weight": "bold",
          "text-wrap": "wrap",
          "text-max-width": "140px",
          "text-outline-color": "#001a33",
          "text-outline-width": "2px",
          "text-valign": "center",
          "text-halign": "center",
          width: "60px",
          height: "60px",
          "border-width": "2px",
          "border-color": "#0066cc",
        },
      },
      {
        selector: 'node[type = "company"]',
        style: {
          "background-color": "#ffcc00",
          color: "#000000",
          "text-outline-color": "#fff8e1",
          "text-outline-width": "3px",
          "font-size": "16px",
          width: "80px",
          height: "80px",
          "border-width": "3px",
          "border-color": "#ff9900",
        },
      },
      {
        selector: "edge",
        style: {
          width: 3,
          "line-color": "#00d9ff",
          "target-arrow-color": "#00d9ff",
          "target-arrow-shape": "triangle",
          "arrow-scale": 2,
          "curve-style": "data(curveStyle)",
          "control-point-distances": "data(distance)",
          "control-point-weights": "data(weight)",
          label: "data(label)",
          "font-size": "12px",
          "font-weight": "bold",
          color: "#ffffff",
          "text-background-color": "#001a33",
          "text-background-opacity": 0.9,
          "text-background-padding": "4px",
          "text-border-color": "#00d9ff",
          "text-border-width": 1,
          "text-border-opacity": 0.8,
        },
      },
      { selector: "edge:selected", style: { "line-color": "#ff2a6d", "target-arrow-color": "#ff2a6d", width: 5, "text-border-color": "#ff2a6d" } },
    ],
    layout: { name: "grid" },
  });
  cy.on("select", "edge", (evt) => {
    selectedEdge = evt.target;
    showEdgePanel(evt.target);
  });
  cy.on("unselect", "edge", () => {
    selectedEdge = null;
    hideEdgePanel();
  });
  return cy;
}

export function kindLabel(kind) {
  return t(`rel.${kind}`);
}

export function resetGraph() {
  current = null;
  ensureControl();
  if (ensureCy()) cy.elements().remove();
  hideEdgePanel();
}

// center = { qid, label }、rel = { nodes, edges }
export function showRelations(center, rel) {
  current = { center, rel };
  render();
}

function styleOf(id) {
  return edgeStyles.get(id) || DEFAULT_STYLE;
}

function render() {
  ensureControl();
  if (!ensureCy() || !current) return;
  cy.elements().remove();
  const { center, rel } = current;
  cy.add({ group: "nodes", data: { id: center.qid, label: center.label || center.qid, type: "company" } });
  const used = new Set([center.qid]);
  for (const e of rel.edges) {
    const kinds = e.kinds.filter((k) => filterState[k]);
    if (!kinds.length) continue;
    for (const q of [e.source, e.target]) {
      if (used.has(q)) continue;
      const n = rel.nodes.find((x) => x.qid === q);
      cy.add({ group: "nodes", data: { id: q, label: n ? n.label : q } });
      used.add(q);
    }
    const id = `${e.source}>${e.target}`;
    const s = styleOf(id);
    cy.add({
      group: "edges",
      data: {
        id,
        source: e.source,
        target: e.target,
        label: kinds.map(kindLabel).join("・"),
        curveStyle: s.curveStyle,
        distance: [s.distance],
        weight: [s.weight],
      },
    });
  }
  runLayout();
}

function runLayout() {
  if (!cy) return;
  cy.resize();
  cy.layout({ name: layoutName, animate: false, fit: true, padding: 30 }).run();
}

// タブを表示したときに呼ぶ（隠れたタブで配置すると大きさ0で計算され、表示したときに図が切れるため）
export function refreshGraph() {
  if (!cy) return;
  cy.resize();
  if (cy.elements().length) cy.fit(undefined, 30);
}

function ensureControl() {
  if (controlBuilt) return;
  const graphEl = document.getElementById("graph");
  if (!graphEl || !graphEl.parentElement) return;
  const control = document.createElement("div");
  control.className = "graph-control";

  const g1 = document.createElement("div");
  g1.className = "graph-control-group";
  const head = document.createElement("strong");
  head.textContent = t("graph.relations");
  g1.appendChild(head);
  for (const kind of ["subsidiary", "parent", "owner"]) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = filterState[kind];
    input.dataset.kind = kind;
    input.addEventListener("change", () => {
      filterState[kind] = input.checked;
      render();
    });
    const span = document.createElement("span");
    span.textContent = kindLabel(kind);
    span.dataset.relLabel = kind;
    label.append(input, span);
    g1.appendChild(label);
  }

  const g2 = document.createElement("div");
  g2.className = "graph-control-group";
  const lab = document.createElement("label");
  lab.htmlFor = "graphLayout";
  lab.textContent = t("graph.layout");
  const select = document.createElement("select");
  select.id = "graphLayout";
  for (const name of ["cose", "breadthfirst", "circle"]) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = t(`layout.${name}`);
    select.appendChild(o);
  }
  select.value = layoutName;
  select.addEventListener("change", () => {
    layoutName = select.value;
    runLayout();
  });
  g2.append(lab, select);

  const hint = document.createElement("p");
  hint.className = "graph-control-hint";
  hint.textContent = t("graph.hint");
  control.append(g1, g2, hint);
  graphEl.parentElement.insertBefore(control, graphEl);
  controlBuilt = true;
}

// 言語を切り替えたときに、操作部の文言と矢印の名前を描き直す
export function relabelGraph() {
  const control = document.querySelector(".graph-control");
  if (control) {
    control.remove();
    controlBuilt = false;
  }
  render();
  if (!current) ensureControl();
}

function hideEdgePanel() {
  const panel = document.getElementById("edgeAdjustPanel");
  if (panel) panel.hidden = true;
}

function field(labelText, input) {
  const wrap = document.createElement("div");
  wrap.className = "edge-adjust-field";
  const label = document.createElement("label");
  label.htmlFor = input.id;
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

function applyEdgeStyle(edge, s) {
  edgeStyles.set(edge.id(), s);
  edge.data({ curveStyle: s.curveStyle, distance: [s.distance], weight: [s.weight] });
}

function showEdgePanel(edge) {
  let panel = document.getElementById("edgeAdjustPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "edgeAdjustPanel";
    panel.className = "edge-adjust-panel";
    panel.setAttribute("role", "dialog");
    document.body.appendChild(panel);
  }
  panel.replaceChildren();
  const s = { ...styleOf(edge.id()) };

  const header = document.createElement("div");
  header.className = "edge-adjust-header";
  const h = document.createElement("h4");
  h.textContent = t("edge.title");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close-edge-adjust";
  close.setAttribute("aria-label", t("common.close"));
  close.textContent = "✕";
  close.addEventListener("click", () => {
    if (selectedEdge) selectedEdge.unselect();
    hideEdgePanel();
  });
  header.append(h, close);

  const body = document.createElement("div");
  body.className = "edge-adjust-body";
  const curve = document.createElement("select");
  curve.id = "edgeCurveStyle";
  for (const v of ["bezier", "unbundled-bezier", "straight", "segments"]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t(`edge.curve.${v}`);
    curve.appendChild(o);
  }
  curve.value = s.curveStyle;
  const dist = document.createElement("input");
  Object.assign(dist, { type: "range", id: "edgeDistance", min: "-200", max: "200", step: "10", value: String(s.distance) });
  const weight = document.createElement("input");
  Object.assign(weight, { type: "range", id: "edgeWeight", min: "0", max: "1", step: "0.1", value: String(s.weight) });
  const distOut = document.createElement("output");
  distOut.htmlFor = "edgeDistance";
  distOut.textContent = String(s.distance);
  const weightOut = document.createElement("output");
  weightOut.htmlFor = "edgeWeight";
  weightOut.textContent = String(s.weight);
  const fDist = field(t("edge.distance"), dist);
  fDist.appendChild(distOut);
  const fWeight = field(t("edge.weight"), weight);
  fWeight.appendChild(weightOut);
  const update = () => {
    const next = { curveStyle: curve.value, distance: Number(dist.value), weight: Number(weight.value) };
    distOut.textContent = dist.value;
    weightOut.textContent = weight.value;
    const curved = next.curveStyle === "bezier" || next.curveStyle === "unbundled-bezier";
    fDist.hidden = !curved;
    fWeight.hidden = !curved;
    if (selectedEdge) applyEdgeStyle(selectedEdge, next);
  };
  curve.addEventListener("change", update);
  dist.addEventListener("input", update);
  weight.addEventListener("input", update);

  const actions = document.createElement("div");
  actions.className = "edge-adjust-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "secondary";
  reset.textContent = t("edge.reset");
  reset.addEventListener("click", () => {
    curve.value = DEFAULT_STYLE.curveStyle;
    dist.value = String(DEFAULT_STYLE.distance);
    weight.value = String(DEFAULT_STYLE.weight);
    update();
  });
  const all = document.createElement("button");
  all.type = "button";
  all.className = "primary";
  all.textContent = t("edge.applyAll");
  all.addEventListener("click", () => {
    if (!selectedEdge || !cy) return;
    const cur = styleOf(selectedEdge.id());
    cy.edges().forEach((e) => applyEdgeStyle(e, { ...cur }));
  });
  actions.append(reset, all);
  body.append(field(t("edge.curve"), curve), fDist, fWeight, actions);
  panel.append(header, body);
  panel.hidden = false;
  update();
}
