let map;
let hqLayer;
let officeLayer;
let shotLayer;
let heatLayer;
let officeCluster;
let heatPoints = [];
let mapControlBuilt = false;
let pendingHeatAttach = false;

const mapState = {
  showHQ: true,
  showOffices: true,
  showHeat: true
};

// HTML escape function to prevent XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const CLUSTER_CSS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
const CLUSTER_DEFAULT_CSS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
const CLUSTER_JS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
const HEAT_JS = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';

let pluginPromise = null;

function loadStyle(url){
  return new Promise((resolve, reject) => {
    if(document.querySelector(`link[href="${url}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = (err) => reject(err);
    document.head.appendChild(link);
  });
}

function loadScript(url){
  return new Promise((resolve, reject) => {
    if(document.querySelector(`script[src="${url}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

async function ensurePlugins(){
  if(pluginPromise) return pluginPromise;
  pluginPromise = (async () => {
    try {
      await Promise.all([loadStyle(CLUSTER_CSS), loadStyle(CLUSTER_DEFAULT_CSS)]);
      await loadScript(CLUSTER_JS);
    } catch (err) {
      console.warn('[MAP] MarkerCluster plugin failed to load', err);
    }
    try {
      await loadScript(HEAT_JS);
    } catch (err) {
      console.warn('[MAP] Heatmap plugin failed to load', err);
    }
  })();
  return pluginPromise;
}

export async function initMap(){
  await ensurePlugins().catch(err => console.warn('[MAP] Plugin load error:', err));

  const mapContainer = document.getElementById('map');
  if(!mapContainer){
    console.error('[MAP] Map container not found');
    return;
  }

  // Set a minimum height to prevent zero-size issue
  if(!mapContainer.style.minHeight){
    mapContainer.style.minHeight = '400px';
  }

  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([35.68, 139.76], 3);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  hqLayer = L.layerGroup();
  shotLayer = L.layerGroup();
  officeCluster = typeof L.markerClusterGroup === 'function'
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 60, spiderfyOnMaxZoom: true })
    : L.layerGroup();
  officeLayer = officeCluster;
  heatLayer = typeof L.heatLayer === 'function'
    ? L.heatLayer([], { radius: 35, blur: 22, maxZoom: 11, minOpacity: 0.25 })
    : null;

  applyMapState();
  shotLayer.addTo(map);

  window.addEventListener('resize', () => {
    if(map && map.invalidateSize) map.invalidateSize();
  });

  buildMapControl();
  updateLegend();

  // Expose map globally for invalidateSize calls
  window.map = map;

  // Invalidate size immediately after initialization
  // This ensures the map renders correctly even if the tab is hidden
  setTimeout(() => {
    if(map && map.invalidateSize){
      map.invalidateSize();
      console.log('[MAP] Initial invalidateSize called');
    }
  }, 100);
}

function applyMapState(){
  if(!map) return;

  const container = map.getContainer ? map.getContainer() : null;
  const hasSize = container && container.offsetWidth > 0 && container.offsetHeight > 0;

  if(mapState.showHQ){
    if(hqLayer && !map.hasLayer(hqLayer)) hqLayer.addTo(map);
  } else if(hqLayer && map.hasLayer(hqLayer)){
    map.removeLayer(hqLayer);
  }

  if(mapState.showOffices){
    if(officeLayer && !map.hasLayer(officeLayer)) officeLayer.addTo(map);
  } else if(officeLayer && map.hasLayer(officeLayer)){
    map.removeLayer(officeLayer);
  }

  if(heatLayer){
    if(mapState.showHeat){
      if(hasSize){
        try {
          if(!map.hasLayer(heatLayer)) heatLayer.addTo(map);
          heatLayer.setLatLngs(heatPoints);
        } catch (err) {
          console.warn('[MAP] Heatmap layer update failed (likely zero-size canvas):', err);
          // Remove layer and retry later
          if(map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
          if(!pendingHeatAttach){
            pendingHeatAttach = true;
            setTimeout(() => {
              pendingHeatAttach = false;
              const c = map?.getContainer();
              if(c && c.offsetWidth > 0 && c.offsetHeight > 0){
                applyMapState();
              }
            }, 500);
          }
        }
      } else if(!pendingHeatAttach){
        pendingHeatAttach = true;
        setTimeout(() => {
          pendingHeatAttach = false;
          const c = map?.getContainer();
          if(c && c.offsetWidth > 0 && c.offsetHeight > 0){
            applyMapState();
          }
        }, 250);
      }
    } else if(map.hasLayer(heatLayer)){
      map.removeLayer(heatLayer);
    }
  }
}

function refreshHeatLayer(){
  if(!heatLayer || !mapState.showHeat) return;
  const container = map?.getContainer();
  if(container && container.offsetWidth > 0 && container.offsetHeight > 0){
    try {
      heatLayer.setLatLngs(heatPoints);
    } catch (err) {
      console.warn('[MAP] Heatmap refresh failed (likely zero-size canvas):', err);
    }
  }
}

function buildMapControl(){
  if(mapControlBuilt || !map) return;
  const control = L.control({ position: 'topright' });
  control.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-layer-control');
    div.innerHTML = `
      <label><input type="checkbox" data-layer="hq" ${mapState.showHQ ? 'checked' : ''}>HQ</label>
      <label><input type="checkbox" data-layer="offices" ${mapState.showOffices ? 'checked' : ''}>Offices</label>
      <label><input type="checkbox" data-layer="heat" ${mapState.showHeat ? 'checked' : ''}>Heatmap</label>
    `;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    div.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        const layer = input.dataset.layer;
        const checked = input.checked;
        if(layer === 'hq') mapState.showHQ = checked;
        if(layer === 'offices') mapState.showOffices = checked;
        if(layer === 'heat') mapState.showHeat = checked;
        applyMapState();
        refreshHeatLayer();
      });
    });
    return div;
  };
  control.addTo(map);
  mapControlBuilt = true;
}

function updateLegend(){
  const legend = document.getElementById('mapLegend');
  if(!legend || legend.dataset.heatAppended) return;
  const span = document.createElement('span');
  span.className = 'dot heat';
  span.textContent = ' Heatmap';
  legend.appendChild(span);
  legend.dataset.heatAppended = 'true';
}

export function resetMap(){
  heatPoints = [];
  if(hqLayer) hqLayer.clearLayers();
  if(officeLayer) officeLayer.clearLayers();
  if(shotLayer) shotLayer.clearLayers();
  if(heatLayer) heatLayer.setLatLngs([]);
  if(map) map.setView([35.68, 139.76], 3);
  applyMapState();
}

export function setHQPoint(company){
  if(!company?.coord || !hqLayer) return;
  const marker = L.circleMarker([company.coord.lat, company.coord.lng], {
    radius: 7,
    color: '#664d00',
    weight: 1,
    fillColor: '#ffcc00',
    fillOpacity: 0.9
  }).bindPopup(`<strong>HQ</strong><br/>${escapeHtml(company.label || company.qid)}`);
  marker.addTo(hqLayer);
  heatPoints.push([company.coord.lat, company.coord.lng, 0.9]);
  applyMapState();

  // Only refresh heatmap when map is visible and has size
  if(map?.getContainer()?.offsetWidth > 0){
    refreshHeatLayer();
  }

  if(map) map.setView([company.coord.lat, company.coord.lng], 6, { animate: true });
}

export function addOfficePoint(office, company){
  if(!office?.coord || !officeLayer) return;
  const marker = L.circleMarker([office.coord.lat, office.coord.lng], {
    radius: 6,
    color: '#005266',
    weight: 1,
    fillColor: '#00c6ff',
    fillOpacity: 0.8
  }).bindPopup(`<strong>${escapeHtml(company?.label || company?.qid || 'Company')}</strong><br/>${escapeHtml(office.name || 'Office/Factory')}`);
  officeLayer.addLayer(marker);
  heatPoints.push([office.coord.lat, office.coord.lng, 0.5]);
  applyMapState();

  // Only refresh heatmap when map is visible and has size
  if(map?.getContainer()?.offsetWidth > 0){
    refreshHeatLayer();
  }
}

export function setShotPoint(exif){
  if(!exif?.lat || !shotLayer) return;
  const marker = L.circleMarker([exif.lat, exif.lng], {
    radius: 6,
    color: '#7a1d1d',
    weight: 1,
    fillColor: '#ff6a6a',
    fillOpacity: 0.8
  }).bindPopup('撮影地点 (EXIF)');
  marker.addTo(shotLayer);
  if(!map.hasLayer(shotLayer)) shotLayer.addTo(map);
}

export function refreshMapLayers(){
  applyMapState();
  refreshHeatLayer();
  if(map){
    map.invalidateSize();
  }
}
