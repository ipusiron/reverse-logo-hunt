// Simple ROI extraction by edge density + OCR words to brand candidates.
// Produces detections with patches and initial bestText.
// Bounding boxes drawn on the displayed canvas.

const TF_SRC = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
const COCO_SRC = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js';
const LOGO_LIKE_CLASSES = new Set([
  'book','tv','laptop','cell phone','remote','keyboard','mouse','toaster','microwave',
  'oven','broccoli','clock','stop sign','traffic light','tie','sports ball','skateboard',
  'suitcase','handbag','backpack','wine glass','bottle','cup','umbrella','baseball bat',
  'baseball glove','tennis racket','surfboard','truck','bus','car','bench','boat','frisbee',
  'kite','toothbrush','hair drier','scissors','vase','spoon','fork','knife','sandwich',
  'donut','pizza','hot dog','cake','chair','potted plant','refrigerator','sink','bed'
]);

let cocoModel = null;
let cocoModelPromise = null;

function loadExternalScript(src){
  const existing = document.querySelector(`script[data-auto-loaded="${src}"]`) || document.querySelector(`script[src="${src}"]`);
  if(existing){
    if(existing.dataset.loaded === 'true' || existing.getAttribute('data-loaded') === 'true' || existing.readyState === 'complete'){
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => {
        existing.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = false;
    script.dataset.autoLoaded = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = (err) => {
      reject(new Error(`Failed to load script ${src}: ${err?.message||err}`));
    };
    document.head.appendChild(script);
  });
}

async function ensureCocoModel(){
  if(cocoModel) return cocoModel;
  if(cocoModelPromise) return cocoModelPromise;
  cocoModelPromise = (async () => {
    await loadExternalScript(TF_SRC);
    await loadExternalScript(COCO_SRC);
    if(!window.cocoSsd){
      throw new Error('cocoSsd global not available after loading script');
    }
    const model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    cocoModel = model;
    return model;
  })();
  return cocoModelPromise;
}

function classIsLogoFriendly(name){
  if(!name) return false;
  if(LOGO_LIKE_CLASSES.has(name)) return true;
  if(name.includes('sign')) return true;
  return false;
}

function clampBoxToCanvas(box, canvas){
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  const maxW = Math.max(0, canvas.width - x);
  const maxH = Math.max(0, canvas.height - y);
  const clampedW = Math.max(1, Math.min(w, maxW));
  const clampedH = Math.max(1, Math.min(h, maxH));
  return { ...box, x, y, w: clampedW, h: clampedH };
}

function boxAreaRatio(box, canvas){
  const area = box.w * box.h;
  const total = canvas.width * canvas.height;
  return total ? area / total : 0;
}

async function detectWithCoco(canvas, { minScore = 0.45, max = 12 } = {}){
  try {
    const model = await ensureCocoModel();
    const predictions = await model.detect(canvas);
    return predictions
      .filter(pred => pred.score >= minScore && classIsLogoFriendly(pred.class))
      .map(pred => ({
        x: pred.bbox[0],
        y: pred.bbox[1],
        w: pred.bbox[2],
        h: pred.bbox[3],
        score: pred.score,
        label: pred.class,
        source: 'ai'
      }))
      .filter(box => {
        const ratio = boxAreaRatio(box, canvas);
        return ratio >= 0.003 && ratio <= 0.45;
      })
      .slice(0, max)
      .map(box => clampBoxToCanvas(box, canvas))
      .filter(box => box.w >= 24 && box.h >= 24);
  } catch (err) {
    console.warn('[AI] coco-ssd detection failed:', err);
    return [];
  }
}

function collectHeuristicROIs(canvas, { max = 12 } = {}){
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if(!ctx) return [];
  const { width, height } = canvas;
  const src = ctx.getImageData(0, 0, width, height);
  const gray = toGray(src);
  const edges = sobel(gray, width, height);
  const colorVar = colorVariance(src, width, height);
  return proposeROIs(edges, colorVar, width, height)
    .slice(0, max)
    .map(box => ({
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      score: box.score,
      label: box.aspectRatio,
      source: 'heuristic'
    }))
    .map(box => clampBoxToCanvas(box, canvas))
    .filter(box => box.w >= 24 && box.h >= 24);
}

export async function suggestAutoROIs(canvas, { max = 10, minScore = 0.45, useModel = true } = {}){
  const heuristicBoxes = collectHeuristicROIs(canvas, { max: max * 2 });
  const aiBoxes = useModel ? await detectWithCoco(canvas, { minScore, max: max * 2 }) : [];
  const merged = [...heuristicBoxes, ...aiBoxes];
  if(merged.length === 0){
    return { boxes: [], stats: { heuristic: heuristicBoxes.length, ai: aiBoxes.length } };
  }
  const deduped = nms(merged, 0.35).slice(0, max);
  return { boxes: deduped, stats: { heuristic: heuristicBoxes.length, ai: aiBoxes.length } };
}

export async function detectInImages(canvas, {scoreThresh=0.6}={}){
  const {width, height} = canvas;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0,0,width,height);
  const gray = toGray(src);
  const edges = sobel(gray, width, height);

  console.log('[DETECT] Image size:', width, 'x', height);

  // Compute color variance map for detecting colorful logos (symbols/icons)
  const colorVar = colorVariance(src, width, height);

  // Sliding window to find ROIs by edge density + color variance
  const rois = proposeROIs(edges, colorVar, width, height);
  console.log('[DETECT] Proposed ROIs:', rois.length, 'candidates');
  console.log('[DETECT] ROI details:', rois.map(r => ({x:r.x, y:r.y, w:r.w, h:r.h, score:r.score.toFixed(3)})));

  // OCR on ROIs (fast path: union crop for top-K)
  const detections = [];
  let ocrSuccess = 0, ocrFailed = 0, textTooShort = 0, keptByEdge = 0;

  for(const r of rois){
    // crop patch
    const patch = document.createElement('canvas');
    patch.width = r.w; patch.height = r.h;
    const pctx = patch.getContext('2d');
    pctx.putImageData(crop(src, width, height, r.x, r.y, r.w, r.h), 0, 0);

    const ocrText = await quickOCR(patch).catch(()=> '');
    const bestText = normalizeBrandWord(ocrText);

    console.log(`[OCR] ROI(${r.x},${r.y},${r.w}x${r.h}) [${r.aspectRatio}]: "${ocrText}" -> normalized: "${bestText}"`);

    // Only keep ROI if we have meaningful text or strong visual features
    const hasText = bestText && bestText.length>=3; // Increased from 2 to 3
    const highEdge = r.score>0.40; // Raised threshold

    // For wide aspect ratios (likely text logos), be more lenient
    const aspectRatio = r.w / r.h;
    const isWide = aspectRatio > 2.5;
    const isUltraWide = aspectRatio > 4.0;

    // Ultra-wide logos (banners) - require text but allow low edge score
    const ultraWideKeep = isUltraWide && hasText && r.score > 0.07;
    // Wide logos - require text with moderate edge
    const wideKeep = isWide && !isUltraWide && hasText && r.score > 0.10;

    const keep = hasText || highEdge || ultraWideKeep || wideKeep;

    if(!keep) {
      console.log(`[REJECT] ROI rejected: text="${bestText}" (len=${bestText?.length||0}), edgeScore=${r.score.toFixed(3)}, aspect=${(r.w/r.h).toFixed(2)}`);
      if(!bestText || bestText.length<2) textTooShort++;
      continue;
    }

    if(hasText) ocrSuccess++;
    if(highEdge && !hasText) keptByEdge++;
    if(!hasText && !highEdge) ocrFailed++;

    detections.push({
      x:r.x, y:r.y, w:r.w, h:r.h,
      score:r.score,
      ocrText,
      bestText: bestText || '[no-text]',
      patch,
      debugInfo: {hasText, highEdge, ocrRaw: ocrText}
    });
  }

  console.log('[STATS] OCR success:', ocrSuccess, '/ Failed:', ocrFailed, '/ Text too short:', textTooShort, '/ Kept by edge:', keptByEdge);
  console.log('[STATS] Detections before NMS:', detections.length);

  // De-duplicate by IoU (NMS) - relaxed threshold for better recall
  const final = nms(detections, 0.4);
  console.log('[STATS] Detections after NMS:', final.length);

  return { detections: final, overlay: edges, debugStats: {rois: rois.length, ocrSuccess, ocrFailed, textTooShort, keptByEdge, beforeNMS: detections.length, afterNMS: final.length} };
}

export function drawBoundingBoxes(container, detections){
  for(const d of detections){
    const el = document.createElement('div');
    el.className = 'bb';
    el.style.left = d.x + 'px';
    el.style.top = d.y + 'px';
    el.style.width = d.w + 'px';
    el.style.height = d.h + 'px';
    el.title = `${d.bestText||'(no-text)'} / s=${d.score.toFixed(2)}`;

    // Add label
    const label = document.createElement('div');
    label.className = 'bb-label';
    label.textContent = `${d.bestText||'?'} (${(d.score*100).toFixed(0)}%)`;
    el.appendChild(label);

    container.appendChild(el);
  }
}
export function clearBoundingBoxes(container){
  container.querySelectorAll('.bb').forEach(el=>el.remove());
}

// ---- helpers ----

function toGray(imgData){
  const {data} = imgData;
  const g = new Uint8ClampedArray(data.length/4);
  for(let i=0,j=0;i<data.length;i+=4,j++){
    g[j] = (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114)|0;
  }
  return g;
}

function colorVariance(imgData, w, h){
  // Compute local color variance to detect colorful regions (logo symbols)
  const {data} = imgData;
  const variance = new Uint8ClampedArray(w * h);

  for(let y=1; y<h-1; y++){
    for(let x=1; x<w-1; x++){
      const idx = y*w + x;
      const pIdx = idx * 4;

      // Get neighboring pixels
      let sumR=0, sumG=0, sumB=0, count=0;
      for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
          const nIdx = ((y+dy)*w + (x+dx)) * 4;
          sumR += data[nIdx];
          sumG += data[nIdx+1];
          sumB += data[nIdx+2];
          count++;
        }
      }
      const avgR = sumR/count, avgG = sumG/count, avgB = sumB/count;

      // Variance
      let varSum = 0;
      for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
          const nIdx = ((y+dy)*w + (x+dx)) * 4;
          const dr = data[nIdx] - avgR;
          const dg = data[nIdx+1] - avgG;
          const db = data[nIdx+2] - avgB;
          varSum += dr*dr + dg*dg + db*db;
        }
      }
      variance[idx] = Math.min(255, Math.sqrt(varSum/count))|0;
    }
  }
  return {data: variance, w, h};
}
function sobel(gray,w,h){
  const out = new Uint8ClampedArray(gray.length);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i=y*w+x;
      const gx = -gray[i-w-1]-2*gray[i-1]-gray[i+w-1] + gray[i-w+1]+2*gray[i+1]+gray[i+w+1];
      const gy = -gray[i-w-1]-2*gray[i-w]-gray[i-w+1] + gray[i+w-1]+2*gray[i+w]+gray[i+w+1];
      const mag = Math.min(255, Math.abs(gx)+Math.abs(gy));
      out[i]=mag;
    }
  }
  return {data:out,w,h};
}
function proposeROIs(edges, colorVar, w, h){
  // Multi-scale, multi-aspect-ratio windows for diverse logo shapes
  const wins = [];
  const minDim = Math.min(w,h);
  const maxDim = Math.max(w,h);

  // Base sizes: small to extra-large (minimum 48px to avoid character fragments)
  const baseSizes = [
    Math.max(48, Math.round(minDim*0.12)),  // Small logos (min 48px)
    Math.max(64, Math.round(minDim*0.20)),  // Medium logos (min 64px)
    Math.max(96, Math.round(minDim*0.30)),  // Large logos (min 96px)
    Math.max(128, Math.round(minDim*0.45))  // Extra large logos (min 128px)
  ];

  // Aspect ratios: optimized for various logo shapes
  const aspectRatios = [
    {w: 1.0, h: 1.0, name: 'square'},
    {w: 1.8, h: 1.0, name: 'landscape'},     // Common horizontal logos
    {w: 2.8, h: 1.0, name: 'wide'},          // Horizontal text logos (Nike, Adidas)
    {w: 4.0, h: 1.0, name: 'extra-wide'},    // Very long text (Coca-Cola, Google)
    {w: 5.5, h: 1.0, name: 'ultra-wide'},    // Extremely long banners
    {w: 1.0, h: 1.5, name: 'portrait'}
  ];

  console.log('[ROI] Base sizes:', baseSizes);
  console.log('[ROI] Aspect ratios:', aspectRatios.map(a => a.name));

  for(const baseSize of baseSizes){
    for(const ar of aspectRatios){
      const winW = Math.round(baseSize * ar.w);
      const winH = Math.round(baseSize * ar.h);

      // Skip if window is larger than image
      if(winW > w || winH > h) continue;

      const stride = Math.round(Math.min(winW, winH) * 0.4); // Denser sampling

      for(let y=0; y<h; y+=stride){
        for(let x=0; x<w; x+=stride){
          if(x+winW>w || y+winH>h) continue;

          const edgeScore = edgeDensity(edges,x,y,winW,winH);
          const colorScore = edgeDensity(colorVar,x,y,winW,winH); // Reuse same function

          // Combine edge and color variance scores
          const combinedScore = Math.max(edgeScore, colorScore * 0.8);

          // Adaptive threshold based on aspect ratio and window size
          let threshold = 0.12; // Base threshold
          if(ar.w >= 4.0) threshold = 0.08; // Ultra-wide text logos (very low edge density)
          else if(ar.w >= 2.5) threshold = 0.09; // Wide text logos
          if(winW < 60 || winH < 60) threshold = 0.15; // Penalize very small windows

          if(combinedScore > threshold){
            wins.push({x,y,w:winW,h:winH,score:combinedScore,edgeScore,colorScore,aspectRatio:ar.name});
          }
        }
      }
    }
  }

  console.log('[ROI] Total windows before NMS:', wins.length);

  // merge overlaps by greedy NMS on score
  wins.sort((a,b)=>b.score-a.score);
  const res=[];
  for(const r of wins){
    if(!res.some(o=>iou(o,r)>0.25)) res.push(r); // More aggressive NMS
    if(res.length>32) break; // Increased limit
  }

  console.log('[ROI] After NMS:', res.length, 'candidates');
  console.log('[ROI] Sample scores:', res.slice(0,5).map(r => ({aspect:r.aspectRatio, edge:r.edgeScore?.toFixed(3), color:r.colorScore?.toFixed(3), combined:r.score.toFixed(3)})));
  return res;
}
function edgeDensity(edges,x,y,w,h){
  let sum=0;
  for(let yy=y; yy<y+h; yy+=2){
    const off = yy*edges.w + x;
    for(let xx=0; xx<w; xx+=2){
      sum += edges.data[off+xx]>64 ? 1 : 0;
    }
  }
  return sum / ((w/2)*(h/2));
}
function crop(img,w,h,x,y,cw,ch){
  const out = new ImageData(cw,ch);
  for(let yy=0;yy<ch;yy++){
    for(let xx=0;xx<cw;xx++){
      const si = ((y+yy)*w + (x+xx))*4;
      const di = (yy*cw + xx)*4;
      out.data[di]=img.data[si];
      out.data[di+1]=img.data[si+1];
      out.data[di+2]=img.data[si+2];
      out.data[di+3]=255;
    }
  }
  return out;
}
async function quickOCR(canvas){
  // Preprocess image for better OCR (contrast enhancement, binarization)
  const preprocessed = preprocessForOCR(canvas);

  // Tesseract quick config (eng+jpn is heavy; use eng fast, still OK for brand names)
  const worker = await Tesseract.createWorker('eng', 1, {
    logger:()=>{}
  });
  const { data: { text } } = await worker.recognize(preprocessed);
  await worker.terminate();
  return (text||'').trim();
}

function preprocessForOCR(canvas){
  const {width, height} = canvas;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Convert to grayscale and enhance contrast
  for(let i=0; i<data.length; i+=4){
    const r = data[i], g = data[i+1], b = data[i+2];
    let gray = (r * 0.299 + g * 0.587 + b * 0.114);

    // Contrast enhancement
    gray = ((gray - 128) * 1.5) + 128;
    gray = Math.max(0, Math.min(255, gray));

    // Simple thresholding (binarization)
    gray = gray > 128 ? 255 : 0;

    data[i] = data[i+1] = data[i+2] = gray;
  }

  const processed = document.createElement('canvas');
  processed.width = width;
  processed.height = height;
  const pctx = processed.getContext('2d');
  pctx.putImageData(imageData, 0, 0);

  return processed;
}
function normalizeBrandWord(t){
  if(!t) return '';
  t = t.toLowerCase().replace(/[^a-z0-9\s\-\_]/g,' ').replace(/\s+/g,' ').trim();

  // pick the most plausible token (longest)
  const toks = t.split(' ').filter(s=>s.length>=2);
  toks.sort((a,b)=>b.length-a.length);
  const best = toks[0]||'';

  // Filter out obvious noise patterns
  if(best.length < 3) return ''; // Too short (fragments like "of", "ma", "fn")
  if(/^[0-9]+$/.test(best)) return ''; // Pure numbers
  if(/^(.)\1+$/.test(best)) return ''; // Repeated single character (e.g., "aaa")

  // Check if it's mostly consonants (likely OCR error)
  const vowels = (best.match(/[aeiou]/g) || []).length;
  const consonants = (best.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
  if(consonants > 0 && vowels === 0 && consonants > 2) return ''; // No vowels in long word (e.g., "fms", "sfms")

  return best;
}
function iou(a,b){
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y);
  const x2=Math.min(a.x+a.w,b.x+b.w), y2=Math.min(a.y+a.h,b.y+b.h);
  const iw=Math.max(0,x2-x1), ih=Math.max(0,y2-y1);
  const inter = iw*ih;
  const uni = a.w*a.h + b.w*b.h - inter;
  return uni? inter/uni : 0;
}
function nms(boxes, thresh){
  const arr = boxes.slice().sort((a,b)=>b.score-a.score);
  const kept=[];
  while(arr.length){
    const cur = arr.shift();
    kept.push(cur);
    for(let i=arr.length-1;i>=0;i--){
      if(iou(cur, arr[i])>thresh) arr.splice(i,1);
    }
  }
  return kept;
}
