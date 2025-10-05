import { detectInImages, drawBoundingBoxes, clearBoundingBoxes, suggestAutoROIs } from './detect.js';
import { readExifGps } from './exif.js';
import { initMap, setHQPoint, addOfficePoint, setShotPoint, resetMap, refreshMapLayers } from './map.js';
import { buildGraph, resetGraph } from './graph.js';
import { fetchCompanyBundle, companyRelationsBundle } from './wikidata.js';
import { fetchCommonsThumbMeta } from './commons.js';

// HTML escape function to prevent XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');

if(dropzone){
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('aria-label', '画像をアップロード');
  dropzone.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      fileInput?.click();
    }
  });
}

const imageList = document.getElementById('imageList');
const markedLogos = document.getElementById('markedLogos');
const historyList = document.getElementById('historyList');
const exportJSONBtn = document.getElementById('exportJSON');
const exportPNGBtn = document.getElementById('exportPNG');
let importJSONBtn = document.getElementById('importJSON');
let importJSONInput = document.getElementById('importJSONInput');

const exportControls = exportJSONBtn ? exportJSONBtn.parentElement : null;
if(exportControls){
  if(!importJSONBtn){
    importJSONBtn = document.createElement('button');
    importJSONBtn.id = 'importJSON';
    importJSONBtn.innerHTML = `JSON読み込み
      <span class="help-icon">?
        <span class="tooltip">保存済みのJSONワークスペースを読み込み、画像・マ�Eク・解析結果を復元します、E/span>
      </span>`;
    exportControls.insertBefore(importJSONBtn, exportJSONBtn);
  }
  if(!importJSONInput){
    importJSONInput = document.createElement('input');
    importJSONInput.type = 'file';
    importJSONInput.accept = 'application/json';
    importJSONInput.id = 'importJSONInput';
    importJSONInput.style.display = 'none';
    importJSONInput.setAttribute('aria-hidden', 'true');
    exportControls.appendChild(importJSONInput);
  }
}

const roiCanvas = document.getElementById('roiCanvas');
const commonsThumb = document.getElementById('commonsThumb');
const commonsMetaDiv = document.getElementById('commonsMeta');
const scoreBody = document.getElementById('scoreBody');
const logDiv = document.getElementById('log');

if(logDiv){
  logDiv.setAttribute('role', 'status');
  logDiv.setAttribute('aria-live', 'polite');
}

const markingCanvas = document.getElementById('markingCanvas');
const selectedImageCanvas = document.getElementById('selectedImageCanvas');
const clearSelectionBtn = document.getElementById('clearSelection');
const analyzeSelectionBtn = document.getElementById('analyzeSelection');
const selectedROIsDiv = document.getElementById('selectedROIs');

let images = []; // [{name, blobURL, exif:{lat,lng}, imgEl, canvasEl, ctx}]
let lastDetections = []; // per image results
let selectedImageIndex = -1;
let allDetectedLogos = []; // All logos from all images for selection
let allMarkedLogos = []; // All marked logos with analysis results

// Manual ROI selection state
let isDrawing = false;
let startX = 0;
let startY = 0;
let selectedROIs = []; // Array of {x, y, w, h, canvas} for selected regions

function setUpTabs(){
  const tabList = document.querySelector('.tabs');
  if(tabList) tabList.setAttribute('role', 'tablist');

  document.querySelectorAll('.tab').forEach(panel => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('tabindex', '0');
    panel.setAttribute('aria-hidden', panel.classList.contains('active') ? 'false' : 'true');
  });

  document.querySelectorAll('.tab-button').forEach((btn, idx)=>{
    const panel = document.getElementById(btn.dataset.tab);
    if(!btn.id) btn.id = `tab-btn-${idx+1}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', btn.dataset.tab);
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
    if(panel){
      panel.setAttribute('aria-labelledby', btn.id);
      panel.setAttribute('aria-hidden', btn.classList.contains('active') ? 'false' : 'true');
    }

    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-button').forEach(b=>{
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab').forEach(t=>{
        t.classList.remove('active');
        t.setAttribute('aria-hidden', 'true');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const target = document.getElementById(btn.dataset.tab);
      if(target){
        target.classList.add('active');
        target.setAttribute('aria-hidden', 'false');
        target.focus({ preventScroll: false });
      }

      if(btn.dataset.tab === 'tab-map'){
        setTimeout(()=>{
          refreshMapLayers();
          if(window.map && window.map.invalidateSize){
            window.map.invalidateSize();
          }
        }, 100);
      }
    });
  });
}
setUpTabs();

// Initialize map immediately (even if tab is hidden)
// The map will auto-adjust when the tab is first shown
initMap().then(() => {
  console.log('[MAIN] Map initialized successfully');
}).catch(err => {
  console.error('[MAIN] Map init failed:', err);
});

updateMarkedLogosDisplay();

function addImageCard(meta){
  const div = document.createElement('div');
  div.className = 'image-item';
  div.dataset.index = images.length - 1;

  const img = document.createElement('img');
  img.src = meta.blobURL;

  const info = document.createElement('div');
  info.className = 'image-item-info';
  info.innerHTML = `<div><strong>${escapeHtml(meta.name)}</strong></div>
    <div class="meta">${meta.exif && meta.exif.lat ? `EXIF: ${meta.exif.lat.toFixed(5)}, ${meta.exif.lng.toFixed(5)}` : 'EXIF: なし'}</div>`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-image-btn';
  removeBtn.innerHTML = '×';
  removeBtn.title = '画像を削除';
  removeBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    removeImage(meta);
  });

  div.appendChild(img);
  div.appendChild(info);
  div.appendChild(removeBtn);

  div.addEventListener('click', ()=>{
    selectedImageIndex = images.indexOf(meta);
    focusResultCard(selectedImageIndex);
    highlightSelectedImage();
    updateExportButtonText();
    showMarkingModal(meta);
  });

  imageList.appendChild(div);
}

function removeImage(meta){
  const index = images.indexOf(meta);
  if(index === -1) return;

  // Count associated logos
  const associatedLogos = allMarkedLogos.filter(logo => logo.imageName === meta.name);
  const logoCount = associatedLogos.length;

  // Show confirmation dialog
  const message = logoCount > 0
    ? `この画像を削除しますか？\n画像: ${meta.name}\n関連ロゴ: ${logoCount}個のマークも削除されます`
    : `この画像を削除しますか？\n画像: ${meta.name}`;

  if(!confirm(message)){
    return;
  }

  // Remove associated logos
  if(logoCount > 0){
    allMarkedLogos = allMarkedLogos.filter(logo => logo.imageName !== meta.name);
    updateMarkedLogosDisplay();
  }

  // Remove from images array
  images.splice(index, 1);

  // Remove from lastDetections if exists
  if(lastDetections[index]){
    lastDetections.splice(index, 1);
  }

  // Revoke blob URL to free memory
  URL.revokeObjectURL(meta.blobURL);

  // Update selected index
  if(selectedImageIndex >= images.length){
    selectedImageIndex = images.length - 1;
  }

  // Rebuild image list
  rebuildImageList();

  // Update UI
  highlightSelectedImage();
  updateExportButtonText();

  // Update history
  saveToHistory();
  updateHistoryDisplay();

  // Clear right panel if no logos left
  if(allMarkedLogos.length === 0){
    const emptyState = document.getElementById('emptyState');
    const justifyContent = document.getElementById('justifyContent');
    if(emptyState) emptyState.style.display = 'block';
    if(justifyContent) justifyContent.style.display = 'none';
  }
}

function rebuildImageList(){
  imageList.innerHTML = '';
  images.forEach((meta, idx) => {
    const div = document.createElement('div');
    div.className = 'image-item';
    div.dataset.index = idx;

    const img = document.createElement('img');
    img.src = meta.blobURL;

    const info = document.createElement('div');
    info.className = 'image-item-info';
    info.innerHTML = `<div><strong>${escapeHtml(meta.name)}</strong></div>
      <div class="meta">${meta.exif && meta.exif.lat ? `EXIF: ${meta.exif.lat.toFixed(5)}, ${meta.exif.lng.toFixed(5)}` : 'EXIF: なし'}</div>`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-image-btn';
    removeBtn.innerHTML = '×';
    removeBtn.title = '画像を削除';
    removeBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      removeImage(meta);
    });

    div.appendChild(img);
    div.appendChild(info);
    div.appendChild(removeBtn);

    div.addEventListener('click', ()=>{
      selectedImageIndex = idx;
      focusResultCard(selectedImageIndex);
      highlightSelectedImage();
      updateExportButtonText();
      showMarkingModal(images[idx]);
    });

    imageList.appendChild(div);
  });
}

function highlightSelectedImage(){
  document.querySelectorAll('.image-item').forEach(item=>item.classList.remove('selected'));
  if(selectedImageIndex>=0){
    const item = document.querySelector(`.image-item[data-index="${selectedImageIndex}"]`);
    if(item) item.classList.add('selected');
  }
}

async function handleFiles(fileList){
  const startIndex = images.length;
  for(const file of fileList){
    if(!file.type.startsWith('image/')) continue;
    const arrayBuf = await file.arrayBuffer();
    const exif = await readExifGps(arrayBuf).catch(()=>null);

    const blobURL = URL.createObjectURL(file);
    const imgEl = new Image();
    await new Promise(res=>{
      imgEl.onload = res; imgEl.src = blobURL;
    });

    // Draw into canvas with resize
    const maxLong = 1536;
    const scale = Math.min(1, maxLong / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.round(imgEl.naturalWidth * scale);
    const h = Math.round(imgEl.naturalHeight * scale);
    const canvasEl = document.createElement('canvas');
    canvasEl.width = w; canvasEl.height = h;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    const meta = { name: file.name, blobURL, exif, imgEl, canvasEl, ctx, scale };
    images.push(meta);
    addImageCard(meta);
  }

  // Auto-select first newly added image and show modal
  if(images.length > startIndex){
    selectedImageIndex = startIndex;
    highlightSelectedImage();
    updateExportButtonText();
    showMarkingModal(images[startIndex]);
  }
}

// Show marking modal for manual ROI selection (fullscreen)
function showMarkingModal(meta){
  if(!meta || !meta.canvasEl) return;

  // Clear previous ROIs
  selectedROIs = [];

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'marking-modal';
  modal.innerHTML = `
    <div class="marking-modal-content">
      <div class="marking-modal-header">
        <h3>🎯 ロゴ領域を選択: ${meta.name}</h3>
        <button class="close-modal-btn" title="閉じる">✕</button>
      </div>
      <div class="marking-modal-body">
        <div class="marking-canvas-wrapper">
          <canvas id="modalMarkingCanvas"></canvas>
        </div>
        <div class="marking-modal-sidebar">
          <div class="marking-instructions">
            <h4>📝 操作方法</h4>
            <ol>
              <li>画像上でマウスをドラッグして矩形を描画</li>
              <li>複数のロゴがある場合は繰り返し選択可能</li>
              <li>選択した領域は右側にプレビュー表示されます</li>
              <li>完了したら「選択した領域を解析」をクリック</li>
            </ol>
          </div>
          <div class="marking-controls">
            <button id="modalClearSelection">選択をクリア</button>
            <button id="modalAutoSuggest" class="secondary">AI候補を追加</button>
            <button id="modalAnalyzeSelection" class="primary">選択した領域を解析</button>
          </div>
          <div class="selected-rois-container">
            <h4>選択済み領域</h4>
            <div id="modalSelectedROIs" class="modal-selected-rois"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const modalCanvas = document.getElementById('modalMarkingCanvas');
  const modalROIsDiv = document.getElementById('modalSelectedROIs');
  const closeBtn = modal.querySelector('.close-modal-btn');
  const clearBtn = document.getElementById('modalClearSelection');
  const autoBtn = document.getElementById('modalAutoSuggest');
  const analyzeBtn = document.getElementById('modalAnalyzeSelection');

  // Set canvas size and draw image
  const {width, height} = meta.canvasEl;
  modalCanvas.width = width;
  modalCanvas.height = height;

  const ctx = modalCanvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(meta.canvasEl, 0, 0);

  // Mouse event handlers
  let isDrawing = false;
  let startX = 0, startY = 0;

  modalCanvas.addEventListener('mousedown', (e) => {
    const rect = modalCanvas.getBoundingClientRect();
    const scaleX = modalCanvas.width / rect.width;
    const scaleY = modalCanvas.height / rect.height;
    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;
    isDrawing = true;
  });

  modalCanvas.addEventListener('mousemove', (e) => {
    if(!isDrawing) return;
    const rect = modalCanvas.getBoundingClientRect();
    const scaleX = modalCanvas.width / rect.width;
    const scaleY = modalCanvas.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    ctx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
    ctx.drawImage(meta.canvasEl, 0, 0);

    // Draw existing ROIs
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    selectedROIs.forEach(roi => {
      ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    });

    // Draw current selection
    ctx.strokeStyle = '#59b0ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
    ctx.setLineDash([]);
  });

  modalCanvas.addEventListener('mouseup', (e) => {
    if(!isDrawing) return;
    const rect = modalCanvas.getBoundingClientRect();
    const scaleX = modalCanvas.width / rect.width;
    const scaleY = modalCanvas.height / rect.height;
    const endX = (e.clientX - rect.left) * scaleX;
    const endY = (e.clientY - rect.top) * scaleY;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    if(w > 20 && h > 20){
      addModalROI(meta, modalCanvas, modalROIsDiv, x, y, w, h, { source: 'manual' });
    }

    isDrawing = false;
    redrawModalCanvas(meta, modalCanvas);
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    selectedROIs = [];
    modalROIsDiv.innerHTML = '';
    redrawModalCanvas(meta, modalCanvas);
  });

  const defaultAutoLabel = autoBtn ? autoBtn.textContent : '';

  if(autoBtn){
    autoBtn.addEventListener('click', async () => {
      autoBtn.disabled = true;
      autoBtn.textContent = '候補生成中...';
      try {
        const { boxes } = await suggestAutoROIs(meta.canvasEl, { max: 8, minScore: 0.5 });
        let added = 0;
        boxes.forEach(box => {
          const inserted = addModalROI(meta, modalCanvas, modalROIsDiv, box.x, box.y, box.w, box.h, {
            source: box.source || 'ai',
            score: typeof box.score === 'number' ? box.score : null,
            label: box.label || null
          });
          if(inserted) added++;
        });
        if(added === 0){
          autoBtn.textContent = '候補が見つかりません';
        } else {
          autoBtn.textContent = `候補を追加 (${added})`;
        }
      } catch (err) {
        console.error('AI候補生成に失敗しました', err);
        autoBtn.textContent = '生成に失敗しました';
      } finally {
        autoBtn.disabled = false;
        setTimeout(() => {
          autoBtn.textContent = defaultAutoLabel || 'AI候補を追加';
        }, 1600);
        redrawModalCanvas(meta, modalCanvas);
      }
    });
  }

  // Analyze button
  analyzeBtn.addEventListener('click', async () => {
    if(selectedROIs.length === 0){
      alert('ロゴ領域を選択してください。画像上でマウスをドラッグして矩形を描画できます。');
      return;
    }

    // Don't close modal yet, show progress
    analyzeBtn.disabled = true;
    clearBtn.disabled = true;

    await analyzeROIsDirectly(selectedROIs, meta, modal, analyzeBtn, clearBtn);
  });

  // Close button
  closeBtn.addEventListener('click', () => {
    modal.remove();
  });

  // ESC key to close
  const escHandler = (e) => {
    if(e.key === 'Escape'){
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function redrawModalCanvas(meta, canvas){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(meta.canvasEl, 0, 0);
  selectedROIs.forEach(roi => {
    ctx.lineWidth = roi.source === 'manual' ? 2 : 3;
    ctx.strokeStyle = roi.source === 'ai' ? '#ff2a6d' : roi.source === 'heuristic' ? '#d1f366' : '#00ff88';
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
  });
}

function addModalROI(meta, canvas, container, x, y, w, h, extra = {}){
  if(w < 20 || h < 20) return false;
  const source = extra.source || 'manual';
  if(source !== 'manual' && selectedROIs.some(existing => rectIoU(existing, {x, y, w, h}) > 0.6)){
    return false;
  }
  if(source !== 'manual' && selectedROIs.length >= 24) return false;

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = w;
  roiCanvas.height = h;
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = meta.ctx.getImageData(x, y, w, h);
  ctx.putImageData(imageData, 0, 0);

  const roi = {
    x,
    y,
    w,
    h,
    canvas: roiCanvas,
    source,
    score: typeof extra.score === 'number' ? extra.score : null,
    label: extra.label || null
  };
  selectedROIs.push(roi);

  const card = document.createElement('div');
  card.className = 'roi-preview';
  const badgeHtml = source === 'manual' ? '' : `<span class="badge roi-badge ${source === 'ai' ? 'roi-badge-ai' : 'roi-badge-heuristic'}">${source === 'ai' ? 'AI' : 'AUTO'}</span>`;
  const scoreText = typeof roi.score === 'number' ? ` · s=${Math.round(roi.score * 100)}%` : '';
  card.innerHTML = `
    <canvas width="80" height="80"></canvas>
    <div class="roi-info">
      <div class="roi-headline"><span class="roi-index">領域 ${selectedROIs.length}</span>${badgeHtml}</div>
      <div class="meta">${w}x${h}px${scoreText}</div>
    </div>
    <button class="remove-roi-btn" title="削除">×</button>
  `;

  const previewCanvas = card.querySelector('canvas');
  const previewCtx = previewCanvas.getContext('2d');
  const scale = Math.min(80 / w, 80 / h);
  const pw = w * scale;
  const ph = h * scale;
  previewCtx.drawImage(roiCanvas, (80-pw)/2, (80-ph)/2, pw, ph);

  card.querySelector('.remove-roi-btn').addEventListener('click', () => {
    const idx = Array.from(container.children).indexOf(card);
    if(idx >= 0){
      selectedROIs.splice(idx, 1);
    }
    card.remove();
    Array.from(container.children).forEach((child, index) => {
      const label = child.querySelector('.roi-index');
      if(label) label.textContent = `領域 ${index + 1}`;
    });
    redrawModalCanvas(meta, canvas);
  });

  container.appendChild(card);
  return true;
}

function rectIoU(a, b){
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const union = (a.w * a.h) + (b.w * b.h) - inter;
  return union ? inter / union : 0;
}

// Update marked logos display
function updateMarkedLogosDisplay(){
  if(allMarkedLogos.length === 0){
    markedLogos.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">マーク済みロゴはまだありません</div>';
    return;
  }

  markedLogos.innerHTML = allMarkedLogos.map((logo, idx) => {
    const statusIcon = logo.analyzed ? '✓' : '⏳';
    const statusClass = logo.analyzed ? 'analyzed' : 'pending';
    return `
      <div class="marked-logo-item ${statusClass}" data-logo-index="${idx}">
        <canvas class="marked-logo-preview" width="60" height="60" id="marked-preview-${idx}"></canvas>
        <div class="marked-logo-info">
          <div class="marked-logo-text">${escapeHtml(logo.ocrText) || '(テキストなし)'}</div>
          <div class="meta">${escapeHtml(logo.imageName)} | ${logo.w}x${logo.h}px</div>
        </div>
        <div class="marked-logo-status">${statusIcon}</div>
        <button class="remove-marked-logo" data-logo-index="${idx}" title="このロゴを削除">×</button>
      </div>
    `;
  }).join('');

  // Draw previews
  allMarkedLogos.forEach((logo, idx) => {
    const canvas = document.getElementById(`marked-preview-${idx}`);
    if(canvas && logo.patch){
      const ctx = canvas.getContext('2d');
      const scale = Math.min(60 / logo.patch.width, 60 / logo.patch.height);
      const w = logo.patch.width * scale;
      const h = logo.patch.height * scale;
      ctx.drawImage(logo.patch, (60-w)/2, (60-h)/2, w, h);
    }
  });

  // Add click handlers
  document.querySelectorAll('.marked-logo-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking delete button
      if(e.target.classList.contains('remove-marked-logo')) return;

      const logoIndex = parseInt(item.dataset.logoIndex);
      showLogoResult(logoIndex);

      // Highlight selected
      document.querySelectorAll('.marked-logo-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
  });

  // Add delete handlers
  document.querySelectorAll('.remove-marked-logo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const logoIndex = parseInt(btn.dataset.logoIndex);
      removeMarkedLogo(logoIndex);
    });
  });
}

function removeMarkedLogo(logoIndex){
  const logo = allMarkedLogos[logoIndex];
  if(!logo) return;

  if(!confirm(`このロゴを削除しますか？\n画像: ${logo.imageName}\nテキスト: ${logo.ocrText || '(なし)'}`)){
    return;
  }

  // Mark as deleted to stop any ongoing analysis
  logo.deleted = true;

  // Remove from array
  allMarkedLogos.splice(logoIndex, 1);

  // Update display
  updateMarkedLogosDisplay();

  // Save to history
  saveToHistory();
  updateHistoryDisplay();

  // Clear right panel if this logo was selected
  const emptyState = document.getElementById('emptyState');
  const justifyContent = document.getElementById('justifyContent');
  if(allMarkedLogos.length === 0){
    if(emptyState) emptyState.style.display = 'block';
    if(justifyContent) justifyContent.style.display = 'none';
  }
}

// Show individual logo result in right panel
function showLogoResult(logoIndex){
  const logo = allMarkedLogos[logoIndex];
  if(!logo) return;

  // Switch to justify tab
  document.querySelectorAll('.tab-button').forEach(btn => {
    if(btn.dataset.tab === 'tab-justify'){
      btn.click();
    }
  });

  // Show justify content
  const emptyState = document.getElementById('emptyState');
  const justifyContent = document.getElementById('justifyContent');
  if(emptyState) emptyState.style.display = 'none';
  if(justifyContent) justifyContent.style.display = 'flex';

  // Update ROI preview
  paintROI(logo.patch);

  // Reset map and graph before updating
  resetMap();
  resetGraph();

  // Update company info if analyzed
  if(logo.analyzed && logo.companyData){
    const {company, score, bundle} = logo.companyData;

    if(company.thumburl){
      commonsThumb.src = company.thumburl;
      commonsThumb.onerror = () => {
        commonsThumb.style.display = 'none';
        commonsMetaDiv.innerHTML = '<p style="color:var(--muted);font-style:italic;">画像読み込み失敗</p>' + (company.creditHtml || '');
      };
      commonsThumb.onload = () => {
        commonsThumb.style.display = 'block';
      };
    }
    if(company.creditHtml){
      commonsMetaDiv.innerHTML = company.creditHtml;
    }
    if(score){
      injectScore(score);
    }

    // Update map and graph
    if(company.coord){ setHQPoint(company); }
    if(bundle && bundle.offices) bundle.offices.slice(0,10).forEach(o => addOfficePoint(o, company));
    if(logo.exif && logo.exif.lat){ setShotPoint(logo.exif); }

    // Update relation graph
    companyRelationsBundle(company.qid).then(rels => {
      if(rels) buildGraph(company, rels);
    }).catch(err => {
      console.error('Relations error:', err);
    });
  } else if(!logo.analyzed){
    commonsThumb.src = '';
    commonsMetaDiv.innerHTML = '<span style="color:var(--muted)">解析待ち...</span>';
    scoreBody.innerHTML = '<tr><td colspan="2" style="color:var(--muted)">解析待ち...</td></tr>';
  } else {
    commonsThumb.src = '';
    commonsMetaDiv.innerHTML = '<span style="color:var(--muted)">企業情報が見つかりませんでした</span>';
    scoreBody.innerHTML = '<tr><td colspan="2" style="color:var(--muted)">データなし</td></tr>';
  }
}

// Analyze ROIs directly without logo selection UI (integrated flow)
async function analyzeROIsDirectly(rois, meta, modal, analyzeBtn, clearBtn){
  const detections = rois.map((roi, idx) => ({
    x: roi.x,
    y: roi.y,
    w: roi.w,
    h: roi.h,
    score: typeof roi.score === 'number' ? roi.score : 1.0,
    patch: roi.canvas,
    bestText: '',
    ocrText: '',
    imageIndex: selectedImageIndex,
    imageName: meta.name,
    exif: meta.exif || null,
    analyzed: false,
    source: roi.source || 'manual'
  }));

  // Show loading inside modal
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'modal-loading';
  loadingDiv.innerHTML = `
    <div class="loading-overlay" style="position:absolute;border-radius:16px">
      <div class="loading-content">
        <div class="spinner"></div>
        <div class="loading-text">OCR実行中...</div>
        <div class="loading-subtext">領域からテキストを抽出しています</div>
        <div class="loading-progress"></div>
      </div>
    </div>
  `;
  modal.querySelector('.marking-modal-content').appendChild(loadingDiv);

  // Add to marked logos list (before OCR)
  detections.forEach(det => {
    allMarkedLogos.push(det);
  });
  updateMarkedLogosDisplay();

  try {
    // Phase 1: OCR
    for(let i = 0; i < detections.length; i++){
      const det = detections[i];
      if(det.deleted) continue; // Skip if deleted
      loadingDiv.querySelector('.loading-subtext').textContent = `OCR: 領域 ${i+1}/${detections.length}`;
      const ocrText = await quickOCR(det.patch).catch(() => '');
      det.ocrText = ocrText;
      det.bestText = normalizeBrandWord(ocrText) || ocrText || `ROI-${i+1}`;
      updateMarkedLogosDisplay(); // Update with OCR result
    }

    // Phase 2: Wikidata & Commons matching
    loadingDiv.querySelector('.loading-text').textContent = 'Wikidata照合中...';

    for(let d = 0; d < detections.length; d++){
      const det = detections[d];
      if(det.deleted) continue; // Skip if deleted
      const queryTerm = det.bestText || det.ocrText || '';
      if(!queryTerm || queryTerm.startsWith('ROI-')) continue;

      loadingDiv.querySelector('.loading-subtext').textContent = `検索中: "${queryTerm}" (${d+1}/${detections.length})`;

      const bundle = await fetchCompanyBundle(queryTerm).catch(err => {
        console.error('Wikidata error:', err);
        return null;
      });

      if(!bundle || bundle.items.length === 0) continue;

      const withLogo = bundle.items.filter(it => it.logoFile);
      if(withLogo.length === 0) continue;

      // Similarity calculation
      const topK = withLogo.slice(0, 5);
      let best = null;
      let bestScore = 0;

      for(let k = 0; k < topK.length; k++){
        const it = topK[k];
        loadingDiv.querySelector('.loading-subtext').textContent = `類似度計算: ${it.label || 'Unknown'} (${k+1}/${topK.length})`;

        const cm = await fetchCommonsThumbMeta(it.logoFile).catch(() => null);
        if(!cm || !cm.thumburl) continue;

        const sim = await scoreSimilarity(det.patch, cm.thumburl);
        // Merge company info from Wikidata + Commons
        sim.company = {
          qid: it.qid,
          label: it.label,
          thumburl: cm.thumburl,
          creditHtml: cm.creditHtml,
          coord: it.coord
        };
        it._sim = sim;

        if(!best || sim.total > bestScore){
          best = sim;
          bestScore = sim.total;
        }
      }

      if(best && best.company){
        // Save company data to logo object
        det.companyData = {
          thumburl: best.company.thumburl,
          creditHtml: best.company.creditHtml,
          score: best,
          company: best.company,
          bundle: bundle
        };

        // Update UI (show last analyzed logo)
        if(best.company.thumburl){
          commonsThumb.src = best.company.thumburl;
          commonsThumb.onerror = () => {
            commonsThumb.style.display = 'none';
            commonsMetaDiv.innerHTML = '<p style="color:var(--muted);font-style:italic;">画像読み込み失敗</p>' + best.company.creditHtml;
          };
          commonsThumb.onload = () => {
            commonsThumb.style.display = 'block';
          };
        }
        commonsMetaDiv.innerHTML = best.company.creditHtml;
        injectScore(best);

        if(best.company.coord){ setHQPoint(best.company); }
        if(bundle.offices) bundle.offices.slice(0,10).forEach(o => addOfficePoint(o, best.company));

        const rels = await companyRelationsBundle(best.company.qid).catch(() => null);
        if(rels){ buildGraph(best.company, rels); }

        if(det.exif && det.exif.lat){ setShotPoint(det.exif); }
        paintROI(det.patch);

        // Mark as analyzed
        det.analyzed = true;
        updateMarkedLogosDisplay();
      } else {
        // No company found, still mark as analyzed
        det.analyzed = true;
        updateMarkedLogosDisplay();
      }
    }

    // Hide empty state, show content
    const emptyState = document.getElementById('emptyState');
    const justifyContent = document.getElementById('justifyContent');
    if(emptyState) emptyState.style.display = 'none';
    if(justifyContent) justifyContent.style.display = 'flex';

    // Close modal and cleanup
    modal.remove();

    // Auto-select first analyzed logo
    if(detections.length > 0){
      setTimeout(() => {
        const firstAnalyzed = detections.find(d => d.analyzed && d.companyData);
        if(firstAnalyzed){
          const index = allMarkedLogos.indexOf(firstAnalyzed);
          if(index >= 0){
            showLogoResult(index);
            const item = document.querySelector(`.marked-logo-item[data-logo-index="${index}"]`);
            if(item) item.classList.add('selected');
          }
        }
      }, 100);
    }

    // Save to history
    saveToHistory();
    updateHistoryDisplay();

  } catch(err) {
    console.error('Analysis error:', err);
    alert(`解析エラー: ${err.message}`);
    loadingDiv.remove();
    analyzeBtn.disabled = false;
    clearBtn.disabled = false;
  }
}


// OCR helper (same as detect.js)
async function quickOCR(canvas){
  const worker = await Tesseract.createWorker('eng', 1, {
    logger:()=>{}
  });
  const { data: { text } } = await worker.recognize(canvas);
  await worker.terminate();
  return (text||'').trim();
}

function normalizeBrandWord(t){
  if(!t) return '';
  t = t.toLowerCase().replace(/[^a-z0-9\s\-\_]/g,' ').replace(/\s+/g,' ').trim();
  const toks = t.split(' ').filter(s=>s.length>=2);
  toks.sort((a,b)=>b.length-a.length);
  const best = toks[0]||'';
  if(best.length < 3) return '';
  if(/^[0-9]+$/.test(best)) return '';
  if(/^(.)\\1+$/.test(best)) return '';
  const vowels = (best.match(/[aeiou]/g) || []).length;
  const consonants = (best.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
  if(consonants > 0 && vowels === 0 && consonants > 2) return '';
  return best;
}

fileInput.addEventListener('change', (e)=>handleFiles(e.target.files));
fileInput.addEventListener('click', (e)=>e.stopPropagation()); // Prevent double trigger
dropzone.addEventListener('dragover', e=>{e.preventDefault(); dropzone.classList.add('drag');});
dropzone.addEventListener('dragleave', ()=>dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e=>{
  e.preventDefault(); dropzone.classList.remove('drag');
  if(e.dataTransfer.files) handleFiles(e.dataTransfer.files);
});
dropzone.addEventListener('click', (e)=>{
  if(e.target !== fileInput) fileInput.click();
});

function showLogoSelectionUI(){
  // Create selection modal
  const modal = document.createElement('div');
  modal.className = 'loading-overlay';
  modal.innerHTML = `
    <div class="loading-content" style="min-width:600px;max-width:800px;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 16px 0;color:var(--accent)">🔍 解析するロゴを選択</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
        ${allDetectedLogos.length}個のロゴが検出されました。解析するロゴを選択してください（複数選択可）。<br>
        <strong style="color:var(--accent-2)">⏱️ 推定時間: 1ロゴあたり30秒-1分</strong>
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button id="selectAllLogos" style="flex:1">すべて選択</button>
        <button id="deselectAllLogos" style="flex:1">すべて解除</button>
      </div>
      <div id="logoSelectionList" class="logo-selection">
        ${allDetectedLogos.map((det, idx) => `
          <div class="logo-item" data-index="${idx}">
            <input type="checkbox" id="logo-${idx}" checked>
            <canvas class="logo-item-preview" width="60" height="60" id="preview-${idx}"></canvas>
            <div class="logo-item-info">
              <div class="text">${det.bestText || det.ocrText || '(テキストなし)'}</div>
              <div class="score">画像: ${det.imageName} | 信頼度: ${(det.score * 100).toFixed(0)}%</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="cancelAnalysis" style="flex:1">キャンセル</button>
        <button id="startAnalysis" class="primary" style="flex:2">選択したロゴを解析 (<span id="selectedCount">${allDetectedLogos.length}</span>個)</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Draw previews
  allDetectedLogos.forEach((det, idx) => {
    const canvas = document.getElementById(`preview-${idx}`);
    if(canvas && det.patch){
      const ctx = canvas.getContext('2d');
      const scale = Math.min(60 / det.patch.width, 60 / det.patch.height);
      const w = det.patch.width * scale;
      const h = det.patch.height * scale;
      ctx.drawImage(det.patch, (60-w)/2, (60-h)/2, w, h);
    }
  });

  // Toggle selection on click
  document.querySelectorAll('.logo-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if(e.target.type !== 'checkbox'){
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  });

  // Update selected count and visual feedback
  function updateSelection(){
    const checkboxes = document.querySelectorAll('#logoSelectionList input[type="checkbox"]');
    let count = 0;
    checkboxes.forEach((cb, idx) => {
      const item = cb.closest('.logo-item');
      if(cb.checked){
        count++;
        item.classList.add('selected');
      }else{
        item.classList.remove('selected');
      }
    });
    document.getElementById('selectedCount').textContent = count;
  }

  document.querySelectorAll('#logoSelectionList input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateSelection);
  });

  document.getElementById('selectAllLogos').addEventListener('click', () => {
    document.querySelectorAll('#logoSelectionList input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateSelection();
  });

  document.getElementById('deselectAllLogos').addEventListener('click', () => {
    document.querySelectorAll('#logoSelectionList input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateSelection();
  });

  document.getElementById('cancelAnalysis').addEventListener('click', () => {
    modal.remove();
  });

  document.getElementById('startAnalysis').addEventListener('click', () => {
    const selected = [];
    document.querySelectorAll('#logoSelectionList input[type="checkbox"]').forEach((cb, idx) => {
      if(cb.checked) selected.push(allDetectedLogos[idx]);
    });
    modal.remove();
    if(selected.length > 0){
      analyzeSelectedLogos(selected);
    }else{
      alert('少なくとも1つのロゴを選択してください。');
    }
  });

  updateSelection();
}

async function analyzeSelectedLogos(selectedLogos){
  // Show justify tab UI
  const emptyState = document.getElementById('emptyState');
  const justifyContent = document.getElementById('justifyContent');
  if(emptyState) emptyState.style.display = 'none';
  if(justifyContent) justifyContent.style.display = 'flex';

  const loading = document.createElement('div');
  loading.className = 'loading-overlay';
  loading.innerHTML = `<div class="loading-content">
    <div class="spinner"></div>
    <div class="loading-text">フェーズ2: ロゴ解析</div>
    <div class="loading-subtext">Wikidata照合を実行中...</div>
    <div class="loading-progress"></div>
    <div class="loading-timer">経過時間: 0秒</div>
  </div>`;
  document.body.appendChild(loading);

  const startTime = Date.now();
  const timerInterval = setInterval(()=>{
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timer = loading.querySelector('.loading-timer');
    if(timer) timer.textContent = `経過時間: ${elapsed}秒`;
  }, 1000);

  const updateLoading = (text, subtext, progress='')=>{
    const t = loading.querySelector('.loading-text');
    const s = loading.querySelector('.loading-subtext');
    const p = loading.querySelector('.loading-progress');
    if(t) t.textContent = text;
    if(s) s.textContent = subtext;
    if(p) p.textContent = progress;
  };

  try {
    for(let d=0; d<selectedLogos.length; d++){
      const det = selectedLogos[d];
      if(det.deleted) continue; // Skip if deleted
      const queryTerm = det.bestText || det.ocrText || '';
      if(!queryTerm) continue;

      updateLoading(`ロゴ ${d+1}/${selectedLogos.length}を解析中`, `Wikidata検索中: "${queryTerm}"`, `${Math.round((d/selectedLogos.length)*100)}%`);
      log(`Wikidata検索: "${queryTerm}" ...`);
      const bundle = await fetchCompanyBundle(queryTerm).catch(err=>{
        console.error('Wikidata error:', err);
        log(`Wikidata検索エラー: ${err.message}`);
        return null;
      });
      if(!bundle || bundle.items.length===0){
        log(`❌ 候補なし: "${queryTerm}"`);
        continue;
      }
      log(`✓ Wikidata候補: ${bundle.items.length}件 (ロゴ付き: ${bundle.items.filter(it=>it.logoFile).length}件)`);

      // Basic re-ranking by pHash/Color/ORB similarity to Commons logo of top candidates
      // Fetch first with logo
      const withLogo = bundle.items.filter(it=>it.logoFile);
      if(withLogo.length===0){
        log(`⚠️ ロゴ画像なし: ${queryTerm} - HQのみマップに表示`);
        // map HQ only
        bundle.items.slice(0,1).forEach(it=>{
          if(it.coord){ setHQPoint(it); }
        });
        continue;
      }
      // Compute similarity for top-5 logo items (increased from 5 to 10 for better matching)
      const topK = withLogo.slice(0,10);
      log(`🔍 類似度計算: ${topK.length}候補を照合中...`);
      let best = null;
      let bestScore = 0;
      for(let k=0; k<topK.length; k++){
        const it = topK[k];
        updateLoading(`ロゴ ${d+1}/${selectedLogos.length}を解析中`, `類似度計算中: ${it.label || 'Unknown'} (${k+1}/${topK.length})`, `${Math.round((d/selectedLogos.length)*100)}%`);
        const cm = await fetchCommonsThumbMeta(it.logoFile).catch(err=>{
          console.error('Commons fetch error:', err);
          log(`Commons取得エラー: ${err.message}`);
          return null;
        });
        if(!cm || !cm.thumburl){
          log(`⚠️ Commons画像取得失敗: ${it.label}`);
          continue;
        }
        const sim = await scoreSimilarity(det.patch, cm.thumburl);
        // Merge company info from Wikidata + Commons
        sim.company = {
          qid: it.qid,
          label: it.label,
          thumburl: cm.thumburl,
          creditHtml: cm.creditHtml,
          coord: it.coord
        };
        it._sim = sim;
        log(`  [${k+1}/${topK.length}] ${it.label} (${it.qid}): total=${sim.total.toFixed(3)} (pHash=${sim.pHash.toFixed(3)}, color=${sim.color.toFixed(3)}, orb=${sim.orb.toFixed(3)})`);
        if(!best || sim.total>bestScore){
          best = sim;
          bestScore = sim.total;
        }
      }
      log(`🏆 最高スコア: ${bestScore.toFixed(3)} - ${best?.company?.label || 'N/A'}`);
      if(best && best.company){
        // Store result in detection
        det.companyData = {
          company: best.company,
          score: best,
          bundle: bundle
        };
        det.analyzed = true;

        // Update UI root
        console.log('[UI] Updating Commons thumbnail:', best.company.thumburl);
        if(best.company.thumburl){
          commonsThumb.src = best.company.thumburl;
          commonsThumb.onerror = ()=>{
            console.error('[UI] Failed to load Commons image:', best.company.thumburl);
            commonsThumb.alt = '画像読み込みエラー';
          };
          commonsThumb.onload = ()=>{
            console.log('[UI] Commons image loaded successfully');
          };
        }else{
          console.warn('[UI] No thumbnail URL available');
          commonsThumb.alt = 'サムネイルなし';
        }
        commonsMetaDiv.innerHTML = best.company.creditHtml;
        injectScore(best);
        // Set HQ/Offices
        if(best.company.coord){ setHQPoint(best.company); }
        if(bundle.offices) bundle.offices.slice(0,10).forEach(o=>addOfficePoint(o, best.company));
        // Relations graph
        const rels = await companyRelationsBundle(best.company.qid).catch(()=>null);
        if(rels){ buildGraph(best.company, rels); }
        // EXIF point
        if(det.exif && det.exif.lat){ setShotPoint(det.exif); }
        // ROI canvas
        paintROI(det.patch);

        // Update marked logos display
        updateMarkedLogosDisplay();
      } else {
        // No company found
        det.analyzed = true;
        updateMarkedLogosDisplay();
      }
    }

    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    updateLoading('完了', `処理完了 (合計: ${totalTime}秒)`, '100%');

    // Auto-select first analyzed logo after completion
    setTimeout(() => {
      const firstAnalyzed = selectedLogos.find(d => d.analyzed && d.companyData);
      if(firstAnalyzed){
        const index = allMarkedLogos.indexOf(firstAnalyzed);
        if(index >= 0){
          showLogoResult(index);
          const item = document.querySelector(`.marked-logo-item[data-logo-index="${index}"]`);
          if(item) item.classList.add('selected');
        }
      }
    }, 100);
  } catch(err) {
    console.error('Fatal error:', err);
    alert(`エラーが発生しました: ${err.message}\n\n詳細はコンソールログを確認してください。`);
    log(`致命的エラー: ${err.message}`);
  } finally {
    clearInterval(timerInterval); // Stop timer
    if(images.length>0) {
      selectedImageIndex = 0;
      highlightSelectedImage();
      updateExportButtonText();
    }

    // Remove loading overlay
    setTimeout(()=>{
      const loadingDiv = document.querySelector('.loading-overlay');
      if(loadingDiv) loadingDiv.remove();
    }, 1000);

    // Save to history
    saveToHistory();
    updateHistoryDisplay();
  }
}

function saveToHistory(){
  // Count marked logos per image
  const logoCountPerImage = {};
  images.forEach((im, idx) => {
    logoCountPerImage[im.name] = 0;
  });

  allMarkedLogos.forEach(logo => {
    if(logoCountPerImage[logo.imageName] !== undefined){
      logoCountPerImage[logo.imageName]++;
    }
  });

  const historyItem = {
    timestamp: Date.now(),
    images: images.map(im => ({
      name: im.name,
      markedCount: logoCountPerImage[im.name] || 0,
      analyzedCount: allMarkedLogos.filter(l => l.imageName === im.name && l.analyzed).length,
      exif: im.exif || null
    })),
    totalMarked: allMarkedLogos.length,
    totalAnalyzed: allMarkedLogos.filter(l => l.analyzed).length
  };
  let history = JSON.parse(localStorage.getItem('rlogo_history') || '[]');
  history.unshift(historyItem);
  history = history.slice(0, 20); // Keep last 20
  localStorage.setItem('rlogo_history', JSON.stringify(history));
}

function updateHistoryDisplay(){
  const history = JSON.parse(localStorage.getItem('rlogo_history') || '[]');
  if(history.length === 0){
    historyList.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">履歴はまだありません</div>';
    return;
  }
  historyList.innerHTML = history.map((item, idx)=>{
    const date = new Date(item.timestamp).toLocaleString('ja-JP');
    const imageNames = item.images.map(im=>im.name).join(', ');
    const totalMarked = item.totalMarked || 0;
    const totalAnalyzed = item.totalAnalyzed || 0;
    return `<div style="padding:8px;border-bottom:1px solid var(--border)">
      <div style="font-size:12px;color:var(--muted)">${date}</div>
      <div style="margin-top:4px">
        <strong>${totalMarked}</strong> 個マーク / <strong>${totalAnalyzed}</strong> 個解析完了
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${imageNames}</div>
    </div>`;
  }).join('');
}

// Load history on init
updateHistoryDisplay();

// Prevent button clicks when clicking help icon
document.addEventListener('click', (e) => {
  const target = e.target;
  if(!target || typeof target.closest !== 'function') return;
  const helpIcon = target.closest('.help-icon');
  if(helpIcon){
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// Tooltip position adjustment - always reposition to avoid clipping
const tooltipCache = new WeakMap();
let currentTooltip = null;

document.addEventListener('mouseenter', (e) => {
  const target = e.target;
  if(!target || typeof target.closest !== 'function') return;
  const helpIcon = target.closest('.help-icon');
  if(!helpIcon) return;

  const tooltip = helpIcon.querySelector('.tooltip');
  if(!tooltip) return;

  // Prevent re-calculation if already positioned
  if(currentTooltip === tooltip && tooltipCache.has(tooltip)) return;

  currentTooltip = tooltip;

  // Check cache
  if(tooltipCache.has(tooltip)){
    const cached = tooltipCache.get(tooltip);
    tooltip.style.cssText = cached;
    return;
  }

  // Always use fixed positioning for reliable placement
  tooltip.classList.add('repositioned');

  const iconRect = helpIcon.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // Get actual tooltip dimensions - keep invisible during measurement
  tooltip.style.visibility = 'hidden';
  tooltip.style.display = 'block';
  tooltip.style.opacity = '1';
  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipWidth = tooltipRect.width || 320;
  const tooltipHeight = tooltipRect.height || 150;
  tooltip.style.visibility = '';
  tooltip.style.display = '';

  // Calculate available space in all directions
  const spaceAbove = iconRect.top;
  const spaceBelow = viewportHeight - iconRect.bottom;

  // Determine vertical position
  let top, bottom;
  if(spaceBelow >= tooltipHeight + 20 || spaceBelow > spaceAbove){
    // Show below
    tooltip.classList.add('below');
    tooltip.classList.remove('above');
    top = iconRect.bottom + 12;
    bottom = 'auto';
  } else {
    // Show above
    tooltip.classList.add('above');
    tooltip.classList.remove('below');
    top = 'auto';
    bottom = viewportHeight - iconRect.top + 12;
  }

  // Determine horizontal position
  let left = iconRect.left + (iconRect.width / 2) - (tooltipWidth / 2);

  // Adjust if clipping left edge
  const minLeft = 10;
  if(left < minLeft){
    left = minLeft;
  }

  // Adjust if clipping right edge
  const maxLeft = viewportWidth - tooltipWidth - 10;
  if(left > maxLeft){
    left = maxLeft;
  }

  // Calculate arrow position relative to tooltip
  // Arrow should point to the center of the help icon
  const iconCenterX = iconRect.left + (iconRect.width / 2);
  const arrowLeft = iconCenterX - left;

  // Apply styles with !important to override any conflicting styles
  const cssText = `
    position: fixed !important;
    top: ${top === 'auto' ? 'auto' : top + 'px'} !important;
    bottom: ${bottom === 'auto' ? 'auto' : bottom + 'px'} !important;
    left: ${left}px !important;
    right: auto !important;
    transform: none !important;
    width: 320px !important;
    max-width: calc(100vw - 20px) !important;
    --arrow-left: ${arrowLeft}px;
  `;

  tooltip.style.cssText = cssText;
  tooltipCache.set(tooltip, cssText);
}, true);

// Remove tooltip positioning on mouseleave
document.addEventListener('mouseleave', (e) => {
  const target = e.target;
  if(!target || typeof target.closest !== 'function') return;
  const helpIcon = target.closest('.help-icon');
  if(!helpIcon) return;

  const tooltip = helpIcon.querySelector('.tooltip');
  if(!tooltip) return;

  // Clear current tooltip reference
  if(currentTooltip === tooltip){
    currentTooltip = null;
  }
}, true);

// Help modal
const helpButton = document.getElementById('helpButton');
const helpModal = document.getElementById('helpModal');
const closeHelpModal = document.querySelector('.close-help-modal');

if(helpButton && helpModal){
  helpButton.addEventListener('click', () => {
    helpModal.style.display = 'flex';
  });

  if(closeHelpModal){
    closeHelpModal.addEventListener('click', () => {
      helpModal.style.display = 'none';
    });
  }

  // Close on background click
  helpModal.addEventListener('click', (e) => {
    if(e.target === helpModal){
      helpModal.style.display = 'none';
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && helpModal.style.display === 'flex'){
      helpModal.style.display = 'none';
    }
  });
}

// Theme toggle
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('theme') || 'dark';
themeToggle.setAttribute('role', 'switch');
themeToggle.setAttribute('aria-label', 'テーマ切り替え');
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeButton(savedTheme);

function updateThemeButton(theme){
  themeToggle.setAttribute('aria-checked', theme === 'light' ? 'true' : 'false');
  const themeIcon = themeToggle.querySelector('.theme-icon');
  const themeLabel = themeToggle.querySelector('.theme-label');
  if(theme === 'light'){
    if(themeIcon) themeIcon.textContent = '☀️';
    if(themeLabel) themeLabel.textContent = 'ライトモード';
  }else{
    if(themeIcon) themeIcon.textContent = '🌙';
    if(themeLabel) themeLabel.textContent = 'ダークモード';
  }
}

themeToggle.addEventListener('click', ()=>{
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeButton(newTheme);
});

// Keyboard navigation
document.addEventListener('keydown', (e)=>{
  // Tab navigation: 1-4 for tabs
  if(e.key>='1' && e.key<='4' && !e.ctrlKey && !e.altKey && !e.shiftKey){
    const tabButtons = document.querySelectorAll('.tab-button');
    const idx = parseInt(e.key) - 1;
    if(tabButtons[idx]){
      tabButtons[idx].click();
      e.preventDefault();
    }
  }
  // Arrow keys for image selection
  if((e.key==='ArrowLeft' || e.key==='ArrowRight') && images.length>0){
    if(e.key==='ArrowLeft' && selectedImageIndex>0){
      selectedImageIndex--;
    }else if(e.key==='ArrowRight' && selectedImageIndex<images.length-1){
      selectedImageIndex++;
    }
    focusResultCard(selectedImageIndex);
    highlightSelectedImage();
    updateExportButtonText();
    showMarkingModal(images[selectedImageIndex]);
    e.preventDefault();
  }
});

function paintROI(patchCanvas){
  if(!patchCanvas || !patchCanvas.width || !patchCanvas.height){
    console.warn('[UI] Invalid patch canvas');
    return;
  }

  const ctx = roiCanvas.getContext('2d');
  ctx.clearRect(0,0,roiCanvas.width, roiCanvas.height);

  // Fill with background
  ctx.fillStyle = 'var(--panel)';
  ctx.fillRect(0,0,roiCanvas.width, roiCanvas.height);

  const scale = Math.min(roiCanvas.width/patchCanvas.width, roiCanvas.height/patchCanvas.height);
  const w = Math.round(patchCanvas.width*scale);
  const h = Math.round(patchCanvas.height*scale);
  const x = (roiCanvas.width-w)/2;
  const y = (roiCanvas.height-h)/2;

  console.log('[UI] Painting ROI: patch size', patchCanvas.width, 'x', patchCanvas.height, '→ scaled', w, 'x', h, 'at', x, y);
  ctx.drawImage(patchCanvas, x, y, w, h);
}

function injectScore(sim){
  scoreBody.innerHTML = '';
  const rows = [
    {
      label: 'pHash(1-dist)',
      value: sim.pHash.toFixed(3),
      help: 'Perceptual Hash。画像の形状・構造の類似度を0-1で評価。1に近いほど形状が類似。'
    },
    {
      label: '色相コサイン',
      value: sim.color.toFixed(3),
      help: 'HSV色相ヒストグラムのコサイン類似度。0-1で評価。1に近いほど色使いが類似。'
    },
    {
      label: 'ORB内点率',
      value: sim.orb.toFixed(3),
      help: 'ORB特徴点マッチングの内点比率。0-1で評価。特徴的な点の一致度を示す。'
    },
    {
      label: '総合スコア',
      value: sim.total.toFixed(3),
      help: '重み付け平均: 0.5×pHash + 0.3×色相 + 0.2×ORB。1に近いほど総合的に類似。'
    },
  ];
  for(const row of rows){
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.innerHTML = `${row.label} <span class="help-icon score-help">?<span class="tooltip">${row.help}</span></span>`;
    const tdValue = document.createElement('td');
    tdValue.textContent = row.value;
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    scoreBody.appendChild(tr);
  }
}
function log(msg){
  const t = new Date().toLocaleTimeString();
  logDiv.textContent = `[${t}] ${msg}\n` + logDiv.textContent;
}

async function scoreSimilarity(roiPatchCanvas, commonsThumbUrl){
  // compute pHash, color similarity and ORB inliers
  const roiPhash = await computePHash(roiPatchCanvas);
  const roiHist = colorHistogram(roiPatchCanvas);

  const cmImg = await loadImage(commonsThumbUrl);
  const cmCanvas = document.createElement('canvas');
  cmCanvas.width = cmImg.naturalWidth; cmCanvas.height = cmImg.naturalHeight;
  const ctx = cmCanvas.getContext('2d');
  ctx.drawImage(cmImg,0,0);

  const cmPhash = await computePHash(cmCanvas);
  const cmHist = colorHistogram(cmCanvas);

  const pDist = hammingDistance(roiPhash, cmPhash) / 64; // normalize 64-bit
  const pHashScore = 1 - pDist;
  const colorScore = cosine(roiHist, cmHist);

  // simple ORB via offscreen canvas fallback (approximation using feature points)
  const orbInlier = await approxOrbInlier(roiPatchCanvas, cmCanvas);

  const total = 0.5*pHashScore + 0.3*colorScore + 0.2*orbInlier;

  return {
    pHash: pHashScore,
    color: colorScore,
    orb: orbInlier,
    total,
    company: { thumburl: commonsThumbUrl }
  };
}

async function serializeSession(){
  const history = JSON.parse(localStorage.getItem('rlogo_history') || '[]');
  const imagesPayload = await Promise.all(images.map(async (im) => {
    const marks = allMarkedLogos.filter(logo => logo.imageName === im.name).map(serializeDetection);
    const dataUrl = im.canvasEl.toDataURL('image/png', 0.92);
    return {
      name: im.name,
      exif: im.exif || null,
      width: im.canvasEl.width,
      height: im.canvasEl.height,
      scale: im.scale || 1,
      dataUrl,
      marks
    };
  }));
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    images: imagesPayload,
    history
  };
}

function serializeDetection(det){
  return {
    x: det.x,
    y: det.y,
    w: det.w,
    h: det.h,
    score: det.score || 0,
    bestText: det.bestText || '',
    ocrText: det.ocrText || '',
    analyzed: !!det.analyzed,
    source: det.source || 'manual',
    imageName: det.imageName,
    exif: det.exif || null,
    companyData: det.companyData ? sanitizeCompanyData(det.companyData) : null
  };
}

function sanitizeCompanyData(data){
  if(!data) return null;
  const score = data.score ? {
    total: data.score.total || 0,
    pHash: data.score.pHash || 0,
    color: data.score.color || 0,
    orb: data.score.orb || 0
  } : null;
  const company = data.company ? {
    qid: data.company.qid,
    label: data.company.label,
    thumburl: data.company.thumburl || data.thumburl || '',
    creditHtml: data.company.creditHtml || data.creditHtml || '',
    coord: data.company.coord || null
  } : null;
  const bundle = data.bundle ? {
    items: (data.bundle.items || []).slice(0, 20).map(item => ({
      qid: item.qid,
      label: item.label,
      logoFile: item.logoFile || null,
      coord: item.coord || null
    })),
    offices: data.bundle.offices || []
  } : null;
  return {
    score,
    company,
    bundle,
    thumburl: data.thumburl || company?.thumburl || '',
    creditHtml: data.creditHtml || company?.creditHtml || ''
  };
}

async function importSessionFromFile(file){
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error('JSONの解析に失敗しました');
  }
  if(!payload || !Array.isArray(payload.images)){
    throw new Error('JSON形式が不正です');
  }
  if(payload.version && payload.version >= 2){
    await restoreSessionFromPayload(payload);
  } else {
    throw new Error('旧バージョンのJSONには対応していません');
  }
}

async function restoreSessionFromPayload(payload){
  resetSessionState();
  for(const img of payload.images){
    const meta = await buildImageMetaFromPayload(img);
    images.push(meta);
    addImageCard(meta);
  }

  const hqPlaced = new Set();
  const hqQueue = [];
  const officeQueue = [];
  let shotPoint = null;
  payload.images.forEach((img, idx) => {
    lastDetections[idx] = img.marks || [];
    (img.marks || []).forEach(mark => {
      const patch = document.createElement('canvas');
      patch.width = Math.round(mark.w);
      patch.height = Math.round(mark.h);
      const pctx = patch.getContext('2d');
      pctx.drawImage(images[idx].canvasEl, mark.x, mark.y, mark.w, mark.h, 0, 0, mark.w, mark.h);
      const det = {
        x: mark.x,
        y: mark.y,
        w: mark.w,
        h: mark.h,
        score: mark.score || 0,
        bestText: mark.bestText || '',
        ocrText: mark.ocrText || '',
        analyzed: !!mark.analyzed,
        source: mark.source || 'manual',
        patch,
        imageIndex: idx,
        imageName: images[idx].name,
        exif: mark.exif || images[idx].exif || null,
        companyData: mark.companyData || null
      };
      allMarkedLogos.push(det);

      const company = det.companyData?.company;
      if(company?.coord && !hqPlaced.has(company.qid)){
        hqPlaced.add(company.qid);
        hqQueue.push(company);
      }
      const offices = det.companyData?.bundle?.offices || [];
      offices.slice(0, 10).forEach(o => officeQueue.push({ office: o, company }));
      if(!shotPoint && det.exif && det.exif.lat){
        shotPoint = det.exif;
      }
    });
  });

  updateMarkedLogosDisplay();
  if(images.length){
    selectedImageIndex = 0;
    highlightSelectedImage();
    updateExportButtonText();
  }

  if(allMarkedLogos.length){
    showLogoResult(0);
  } else {
    commonsThumb.src = '';
    commonsMetaDiv.innerHTML = '';
    scoreBody.innerHTML = '';
  }

  resetMap();
  resetGraph();
  hqQueue.forEach(company => setHQPoint(company));
  officeQueue.forEach(entry => addOfficePoint(entry.office, entry.company));
  if(shotPoint){ setShotPoint(shotPoint); }
  if(allMarkedLogos.length){
    const firstCompany = allMarkedLogos.find(det => det.companyData?.company);
    if(firstCompany?.companyData?.company){
      companyRelationsBundle(firstCompany.companyData.company.qid).then(rels => {
        if(rels) buildGraph(firstCompany.companyData.company, rels);
      }).catch(err => console.warn('Relation load after import failed', err));
    }
  }

  if(Array.isArray(payload.history)){
    localStorage.setItem('rlogo_history', JSON.stringify(payload.history.slice(0, 20)));
  } else {
    saveToHistory();
  }
  updateHistoryDisplay();
  refreshMapLayers();
}

function resetSessionState(){
  images.forEach(im => {
    if(im.blobURL && typeof im.blobURL === 'string' && im.blobURL.startsWith('blob:')){
      URL.revokeObjectURL(im.blobURL);
    }
  });
  images = [];
  lastDetections = [];
  allDetectedLogos = [];
  allMarkedLogos = [];
  selectedROIs = [];
  selectedImageIndex = -1;
  imageList.innerHTML = '';
  markedLogos.innerHTML = '';
  updateMarkedLogosDisplay();
  resetMap();
  resetGraph();
  commonsThumb.src = '';
  commonsMetaDiv.innerHTML = '';
  scoreBody.innerHTML = '';
  logDiv.innerHTML = '';
}

async function buildImageMetaFromPayload(data){
  if(!data?.dataUrl) throw new Error('画像データが不足しています');
  const imgEl = await loadImage(data.dataUrl);
  const canvasEl = document.createElement('canvas');
  canvasEl.width = data.width || imgEl.naturalWidth;
  canvasEl.height = data.height || imgEl.naturalHeight;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, canvasEl.width, canvasEl.height);
  return {
    name: data.name,
    exif: data.exif || null,
    canvasEl,
    ctx,
    blobURL: data.dataUrl,
    scale: data.scale || 1
  };
}

// --- Small utilities (pHash, histogram, cosine, ORB approx) ---
async function computePHash(canvas){
  // average hash 8x8 DCT-like (simplified aHash fallback)
  const s = 32;
  const c = document.createElement('canvas'); c.width=s; c.height=s;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas,0,0,s,s);
  const imgData = ctx.getImageData(0,0,s,s).data;
  const gray = new Float32Array(s*s);
  for(let i=0;i<gray.length;i++){
    const r=imgData[i*4], g=imgData[i*4+1], b=imgData[i*4+2];
    gray[i]=(r*0.299+g*0.587+b*0.114);
  }
  // downsample to 8x8 average
  const tile=4;
  const vals=[];
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      let sum=0;
      for(let ty=0;ty<tile;ty++){
        for(let tx=0;tx<tile;tx++){
          const ix=(y*tile+ty)*s+(x*tile+tx);
          sum+=gray[ix];
        }
      }
      vals.push(sum/(tile*tile));
    }
  }
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  let hash=0n;
  for(let i=0;i<64;i++){
    if(vals[i]>=mean) hash |= (1n << BigInt(63-i));
  }
  return hash;
}
function hammingDistance(a,b){
  let x = a ^ b;
  let count = 0;
  while(x){
    x &= (x-1n);
    count++;
  }
  return count;
}
function colorHistogram(canvas){
  const ctx = canvas.getContext('2d');
  const {width,height} = canvas;
  const imgData = ctx.getImageData(0,0,width,height).data;
  const bins = new Float32Array(24); // 12 hue bins x 2 value bands
  for(let i=0;i<imgData.length;i+=4){
    const r=imgData[i]/255, g=imgData[i+1]/255, b=imgData[i+2]/255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    const v=mx;
    let h=0, s = mx===0?0:(mx-mn)/mx;
    if(mx===mn){ h=0; } else {
      const d = mx-mn;
      if(mx===r) h=(g-b)/d + (g<b?6:0);
      else if(mx===g) h=(b-r)/d + 2;
      else h=(r-g)/d + 4;
      h/=6;
    }
    const hi = Math.floor(h*12)%12;
    const vi = v>0.5?1:0;
    bins[hi*2+vi] += 1;
  }
  // normalize
  const sum = bins.reduce((a,b)=>a+b,0) || 1;
  for(let i=0;i<bins.length;i++) bins[i]/=sum;
  return bins;
}
function cosine(a,b){
  let dot=0, na=0, nb=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) || 1);
}
async function approxOrbInlier(aCanvas,bCanvas){
  // Lightweight placeholder that returns moderate score based on edge overlap
  const w=128,h=128;
  function edgeCanvas(src){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const ctx=c.getContext('2d');
    ctx.drawImage(src,0,0,w,h);
    const d=ctx.getImageData(0,0,w,h);
    // Sobel-like gradient magnitude
    function idx(x,y){return (y*w+x)*4;}
    for(let y=1;y<h-1;y++){
      for(let x=1;x<w-1;x++){
        const i=idx(x,y), il=idx(x-1,y), ir=idx(x+1,y), it=idx(x,y-1), ib=idx(x,y+1);
        const gx = d.data[ir]-d.data[il] + d.data[ir+1]-d.data[il+1] + d.data[ir+2]-d.data[il+2];
        const gy = d.data[ib]-d.data[it] + d.data[ib+1]-d.data[it+1] + d.data[ib+2]-d.data[it+2];
        const mag = Math.min(255, Math.abs(gx)+Math.abs(gy));
        d.data[i]=d.data[i+1]=d.data[i+2]=mag; d.data[i+3]=255;
      }
    }
    ctx.putImageData(d,0,0);
    return c;
  }
  const ea = edgeCanvas(aCanvas), eb = edgeCanvas(bCanvas);
  // pixel-wise correlation
  const da = ea.getContext('2d').getImageData(0,0,w,h).data;
  const db = eb.getContext('2d').getImageData(0,0,w,h).data;
  let dot=0, na=0, nb=0;
  for(let i=0;i<da.length;i+=4){
    const va = da[i]/255, vb = db[i]/255;
    dot += va*vb; na += va*va; nb += vb*vb;
  }
  const corr = dot / (Math.sqrt(na)*Math.sqrt(nb) || 1);
  return Math.max(0, Math.min(1, corr)); // 0..1
}
function loadImage(src){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.crossOrigin='anonymous'; // for commons
    img.onload=()=>res(img);
    img.onerror=rej;
    img.src=src;
  });
}

// Export handlers (simple)
exportJSONBtn.addEventListener('click', async () => {
  try {
    const payload = await serializeSession();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;

    a.download = `reverse-logo-hunt-workspace_${timestamp}.json`;
    a.click();
  } catch (err) {
    console.error('JSON export failed:', err);
    alert(`JSON書き出しに失敗しました: ${err.message}`);
  }
});

if(importJSONBtn && importJSONInput){
  importJSONBtn.addEventListener('click', () => importJSONInput.click());
  importJSONInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if(!file) return;
    try {
      await importSessionFromFile(file);
      log('✅ JSONワークスペースを読み込みました');
    } catch (err) {
      console.error('JSON import failed:', err);
      alert(`JSON読み込み中にエラーが発生しました: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  });
}
exportPNGBtn.addEventListener('click', ()=>{
  if(selectedImageIndex<0 || !images[selectedImageIndex]){
    alert('画像を選択してください。左の画像一覧から対象画像をクリックして選択できます。');
    return;
  }
  const meta = images[selectedImageIndex];
  meta.canvasEl.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download=meta.name.replace(/\.[^.]+$/,'')+'-with-bb.png';
    a.click();
  }, 'image/png', 0.95);
});

// Update export button text to show selected image
function updateExportButtonText(){
  if(selectedImageIndex>=0 && images[selectedImageIndex]){
    exportPNGBtn.textContent = `${images[selectedImageIndex].name} を出力`;
  }else{
    exportPNGBtn.textContent = '選択画像にBB焼き込み出力';
  }
}

function focusResultCard(index){
  // just mark selection & scroll
  const cards = Array.from(document.querySelectorAll('.result-card'));
  cards.forEach(c=>c.style.outline='none');
  if(cards[index]){ cards[index].style.outline='2px solid #59b0ff'; cards[index].scrollIntoView({behavior:'smooth',block:'center'}); }
}

// expose for debug
window.__rev = { images };
