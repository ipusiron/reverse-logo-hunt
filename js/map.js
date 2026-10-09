// 地図（Leaflet＋OpenStreetMap のタイル）。本社と撮影地点（EXIF）を点で出す
// タイルの利用規約に従い、Referer を送る既定の設定のまま https://tile.openstreetmap.org/{z}/{x}/{y}.png を使う。
// ポップアップは HTML の文字列でなく DOM で組み立てる（会社名・ファイル名を HTML として解釈させない）。
import { t } from "./messages.js";

let map = null;
let hqLayer = null;
let shotLayer = null;
const DEFAULT_VIEW = { center: [35.68, 139.76], zoom: 3 };

function popup(lines) {
  const div = document.createElement("div");
  lines.forEach((line, i) => {
    const p = document.createElement(i === 0 ? "strong" : "div");
    p.textContent = line;
    div.appendChild(p);
  });
  return div;
}

export async function initMap() {
  if (map || typeof L === "undefined") return;
  const container = document.getElementById("map");
  if (!container) return;
  map = L.map(container, { zoomControl: true, attributionControl: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map);
  hqLayer = L.layerGroup().addTo(map);
  shotLayer = L.layerGroup().addTo(map);
  window.addEventListener("resize", () => map.invalidateSize());
}

export function resetMap() {
  if (!map) return;
  hqLayer.clearLayers();
  shotLayer.clearLayers();
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
}

function fit() {
  const pts = [];
  hqLayer.eachLayer((m) => pts.push(m.getLatLng()));
  shotLayer.eachLayer((m) => pts.push(m.getLatLng()));
  if (pts.length === 1) map.setView(pts[0], 6);
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 10 });
}

// company = { qid, label, place, coord: { lat, lng } }
export function setHQPoint(company) {
  if (!map || !company || !company.coord) return;
  const lines = [t("map.hq", { company: company.label || company.qid })];
  if (company.place) lines.push(t("map.hqPlace", { place: company.place }));
  L.circleMarker([company.coord.lat, company.coord.lng], { radius: 8, color: "#664d00", weight: 2, fillColor: "#ffcc00", fillOpacity: 0.9 })
    .bindPopup(popup(lines))
    .addTo(hqLayer);
  fit();
}

// exif = { lat, lng, name }
export function setShotPoint(exif) {
  if (!map || !exif || !Number.isFinite(exif.lat) || !Number.isFinite(exif.lng)) return;
  L.circleMarker([exif.lat, exif.lng], { radius: 7, color: "#7a1d1d", weight: 2, fillColor: "#ff6a6a", fillOpacity: 0.85 })
    .bindPopup(popup([t("map.shot", { name: exif.name || "" })]))
    .addTo(shotLayer);
  fit();
}

// タブを表示したときに呼ぶ（隠れた状態で作った地図は大きさを測り直す必要がある）
export function refreshMapLayers() {
  if (!map) return;
  map.invalidateSize();
  fit();
}
