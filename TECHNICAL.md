# Technical Documentation - Reverse Logo Hunt

このドキュメントでは、Reverse Logo Huntの技術的な実装詳細、コアアルゴリズム、設計上の工夫について解説します。

---

## 📚 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [ロゴ検出アルゴリズム](#ロゴ検出アルゴリズム)
3. [類似度スコアリング](#類似度スコアリング)
4. [Wikidata統合](#wikidata統合)
5. [地図可視化の最適化](#地図可視化の最適化)
6. [キャッシング戦略](#キャッシング戦略)
7. [セキュリティ対策](#セキュリティ対策)
8. [パフォーマンス最適化](#パフォーマンス最適化)

---

## アーキテクチャ概要

### ES6モジュール構成

```
js/
├── main.js       - エントリポイント、UI制御、統合処理
├── detect.js     - ロゴROI検出（エッジ検出、OCR、NMS）
├── wikidata.js   - SPARQL検索、企業データ取得
├── commons.js    - Wikimedia Commons API、ロゴ画像取得
├── map.js        - Leaflet地図、ヒートマップ、レイヤー管理
├── graph.js      - Cytoscape.js関係図、エッジ調整機能
├── exif.js       - GPS座標抽出
└── cache.js      - IndexedDB TTLキャッシュ
```

### データフロー

```
画像アップロード
    ↓
手動ROI選択（モーダル）
    ↓
OCR (Tesseract.js WASM)
    ↓
Wikidata SPARQL検索
    ↓
Commons APIでロゴ取得
    ↓
類似度計算 (pHash + Color + ORB)
    ↓
地図・関係図の可視化
```

---

## ロゴ検出アルゴリズム

### 1. エッジベース領域検出（detect.js:84-158）

**目的**: 画像内のロゴ候補領域を自動検出

**アルゴリズム**:

```javascript
// 1. Sobelエッジ検出
function sobelEdgeDetection(imageData) {
  const kernelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const kernelY = [[1, 2, 1], [0, 0, 0], [-1, -2, -1]];

  // 各ピクセルで勾配計算
  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      const gx = convolve(kernel_x);
      const gy = convolve(kernel_y);
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edge[y][x] = magnitude > threshold ? 255 : 0;
    }
  }
}

// 2. スライディングウィンドウ + エッジ密度計算
const windowSizes = [
  Math.floor(minDim * 0.15),  // 小ロゴ用
  Math.floor(minDim * 0.23)   // 大ロゴ用
];
const stride = Math.floor(windowSize * 0.4); // 60%オーバーラップ

for (let y = 0; y <= h - windowSize; y += stride) {
  for (let x = 0; x <= w - windowSize; x += stride) {
    const density = calculateEdgeDensity(x, y, windowSize);
    if (density > 0.15) {  // エッジ密度閾値
      candidates.push({ x, y, w: windowSize, h: windowSize, score: density });
    }
  }
}

// 3. Non-Maximum Suppression (NMS)
function nms(boxes, iouThreshold = 0.3) {
  // IoU (Intersection over Union) で重複除去
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];

  for (const box of boxes) {
    let suppress = false;
    for (const kept of keep) {
      if (iou(box, kept) > iouThreshold) {
        suppress = true;
        break;
      }
    }
    if (!suppress) keep.push(box);
  }
  return keep.slice(0, 16); // 最大16ROI
}
```

**特徴**:
- **2段階ウィンドウサイズ**: 小ロゴ（15%）と大ロゴ（23%）を同時検出
- **60%オーバーラップ**: ロゴの位置ズレに対応
- **エッジ密度フィルター**: ノイズ除去（密度 > 0.15）
- **NMS重複除去**: IoU 0.3で類似領域を統合

### 2. OCRによるブランド名抽出（detect.js:124-136）

```javascript
async function quickOCR(canvas) {
  const worker = await Tesseract.createWorker();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const { data: { text } } = await worker.recognize(canvas);
  await worker.terminate(); // メモリリーク防止

  return text.trim();
}
```

**工夫**:
- **Workerの即座終了**: 各ROIごとにWorkerを作成・破棄してメモリ管理
- **英語のみ**: ブランド名は通常ラテン文字（高速化）

---

## 類似度スコアリング

### 総合スコア計算式（main.js:214-244）

```javascript
const totalScore = 0.5 * phashScore + 0.3 * colorScore + 0.2 * orbScore;
```

### 1. pHash（Perceptual Hash）

**実装**: 簡易8x8平均ハッシュ

```javascript
function simplePHash(canvas) {
  const temp = document.createElement('canvas');
  temp.width = 32;
  temp.height = 32;
  const ctx = temp.getContext('2d');

  // グレースケール変換
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const imageData = ctx.getImageData(0, 0, 32, 32);
  const gray = toGrayscale(imageData);

  // 8x8にダウンサンプリング
  const small = resize(gray, 8, 8);

  // 平均値計算
  const avg = small.reduce((a, b) => a + b) / 64;

  // 64ビットハッシュ生成
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (small[i] > avg) {
      hash |= (1n << BigInt(i));
    }
  }

  return hash;
}

function hammingDistance(hash1, hash2) {
  let xor = hash1 ^ hash2;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

const phashScore = 1 - (hammingDistance(hash1, hash2) / 64);
```

**特徴**:
- **形状重視**: 色変化に頑健
- **高速**: DCTの代わりに平均値ベース
- **BigInt使用**: 64ビットハッシュの正確な比較

### 2. 色相ヒストグラム類似度

```javascript
function colorHistogramSimilarity(canvas1, canvas2) {
  const hist1 = computeHSVHistogram(canvas1, 16); // 16ビン
  const hist2 = computeHSVHistogram(canvas2, 16);

  // コサイン類似度
  const dotProduct = hist1.reduce((sum, val, i) => sum + val * hist2[i], 0);
  const mag1 = Math.sqrt(hist1.reduce((sum, val) => sum + val * val, 0));
  const mag2 = Math.sqrt(hist2.reduce((sum, val) => sum + val * val, 0));

  return dotProduct / (mag1 * mag2);
}

function computeHSVHistogram(canvas, bins) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Array(bins).fill(0);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const [h, s, v] = rgbToHSV(
      imageData.data[i],
      imageData.data[i + 1],
      imageData.data[i + 2]
    );

    if (s > 0.2 && v > 0.2) { // 低彩度・低明度を除外
      const binIndex = Math.floor((h / 360) * bins);
      histogram[binIndex]++;
    }
  }

  // 正規化
  const total = histogram.reduce((a, b) => a + b, 0);
  return histogram.map(v => v / total);
}
```

**工夫**:
- **HSV色空間**: RGBより色相の一貫性が高い
- **低彩度除外**: 背景ノイズを除去
- **コサイン類似度**: ヒストグラム分布の比較に最適

### 3. ORB特徴点マッチング（簡易版）

```javascript
function orbFeatureMatching(canvas1, canvas2) {
  // Sobelエッジ検出で特徴点近似
  const edges1 = detectEdges(canvas1);
  const edges2 = detectEdges(canvas2);

  // 128x128に正規化
  const norm1 = resizeEdges(edges1, 128, 128);
  const norm2 = resizeEdges(edges2, 128, 128);

  // ピクセル単位の相関計算
  let matches = 0;
  let total = 0;
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      if (norm1[y][x] > 0 || norm2[y][x] > 0) {
        total++;
        if (norm1[y][x] > 0 && norm2[y][x] > 0) {
          matches++;
        }
      }
    }
  }

  return total > 0 ? matches / total : 0;
}
```

**注意**: 真のORBではなくエッジベースの近似実装（高速化のため）

---

## Wikidata統合

### SPARQL検索クエリ（wikidata.js:7-27）

```sparql
SELECT ?item ?itemLabel ?logo ?hq ?coord ?country WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org";
                    wikibase:api "Search";
                    mwapi:srsearch "sony";  -- ブランド名
                    mwapi:srlimit "10".
    ?item wikibase:apiOutputItem mwapi:title.
  }
  OPTIONAL { ?item wdt:P154 ?logo. }           -- ロゴ画像
  OPTIONAL { ?item wdt:P159 ?hq.
             ?hq wdt:P625 ?coord. }            -- 本社座標
  OPTIONAL { ?item wdt:P17 ?country. }         -- 国
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,ja".
  }
}
```

**工夫**:
- **MWApi検索**: ファジーマッチング（完全一致不要）
- **OPTIONAL句**: データが欠けていても結果を返す
- **多言語ラベル**: 英語・日本語の両方対応

### 関係グラフ取得（wikidata.js:30-62）

```sparql
SELECT ?related ?relatedLabel ?rel WHERE {
  VALUES ?item { wd:Q34600 }  -- Nintendo
  VALUES ?rel { wdt:P355 wdt:P749 wdt:P127 }  -- 子会社/親会社/所有者
  ?item ?rel ?related.
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,ja".
  }
}
```

**プロパティ**:
- **P355**: 子会社（subsidiary）
- **P749**: 親会社（parent organization）
- **P127**: 所有者（owned by）

---

## 地図可視化の最適化

### ゼロサイズキャンバス対策（map.js:137-171）

**問題**: タブが非表示時（`display:none`）、Leaflet heatmapのキャンバスがゼロサイズになりエラー

**解決策**:

```javascript
function applyMapState() {
  const container = map.getContainer ? map.getContainer() : null;
  const hasSize = container && container.offsetWidth > 0 && container.offsetHeight > 0;

  if (heatLayer) {
    if (mapState.showHeat) {
      if (hasSize) {
        try {
          if (!map.hasLayer(heatLayer)) heatLayer.addTo(map);
          heatLayer.setLatLngs(heatPoints);
        } catch (err) {
          console.warn('[MAP] Heatmap failed (zero-size canvas):', err);
          // リトライ機構
          if (!pendingHeatAttach) {
            pendingHeatAttach = true;
            setTimeout(() => {
              pendingHeatAttach = false;
              const c = map?.getContainer();
              if (c && c.offsetWidth > 0 && c.offsetHeight > 0) {
                applyMapState();
              }
            }, 500);
          }
        }
      } else {
        // サイズ取得まで待機
        setTimeout(() => applyMapState(), 250);
      }
    }
  }
}
```

**工夫**:
- **サイズチェック**: `offsetWidth > 0`で描画可能判定
- **Try-Catch**: エラー時のグレースフルフォールバック
- **リトライ機構**: 500ms後に再試行
- **最小高さ設定**: CSS `min-height: 400px`

### プラグインの遅延ロード（map.js:48-64）

```javascript
async function ensurePlugins() {
  if (pluginPromise) return pluginPromise;

  pluginPromise = (async () => {
    try {
      // MarkerCluster CSS/JS
      await Promise.all([
        loadStyle(CLUSTER_CSS),
        loadStyle(CLUSTER_DEFAULT_CSS)
      ]);
      await loadScript(CLUSTER_JS);
    } catch (err) {
      console.warn('[MAP] MarkerCluster load failed', err);
    }

    try {
      // Heatmap JS
      await loadScript(HEAT_JS);
    } catch (err) {
      console.warn('[MAP] Heatmap load failed', err);
    }
  })();

  return pluginPromise;
}
```

**利点**:
- **並列ロード**: CSS2つを同時取得
- **個別エラーハンドリング**: 片方失敗しても続行
- **シングルトンパターン**: 重複ロード防止

---

## キャッシング戦略

### IndexedDB TTLキャッシュ（cache.js）

**設計**:

```javascript
const DB_NAME = 'ReverseLogoHuntCache';
const DB_VERSION = 1;
const STORES = {
  wikidata: 'wikidata',
  commons: 'commons',
  relations: 'relations'
};

// データ構造
interface CachedData {
  key: string;
  value: any;
  expires: number;  // Unix timestamp (ms)
}

async function setCached(storeName, key, value, ttlMs = 86400000) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);

  await store.put({
    key,
    value,
    expires: Date.now() + ttlMs
  });
}

async function getCached(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const data = await store.get(key);

  if (!data) return null;
  if (Date.now() > data.expires) {
    // 期限切れ削除
    await deleteCached(storeName, key);
    return null;
  }

  return data.value;
}
```

**キャッシュ対象**:
- **Wikidata検索結果**: 24時間（1日）
- **Commons画像メタデータ**: 24時間
- **企業関係データ**: 24時間

**利点**:
- **オフライン動作**: 一度取得したデータは再利用
- **API負荷軽減**: Wikidataへのリクエスト削減
- **高速化**: ネットワーク待ち時間ゼロ

---

## セキュリティ対策

### 1. XSS対策（main.js:8-14, map.js:17-23）

```javascript
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;  // textContentは自動エスケープ
  return div.innerHTML;
}

// 使用例
info.innerHTML = `<div><strong>${escapeHtml(meta.name)}</strong></div>`;
markerPopup = `<strong>HQ</strong><br/>${escapeHtml(company.label)}`;
```

**対策箇所**:
- ファイル名（ユーザー入力）
- OCRテキスト（Tesseract.js出力）
- Wikidata企業名（APIレスポンス）
- Wikimedia Commonsメタデータ

### 2. CSP（Content Security Policy）

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self'
    https://unpkg.com
    https://cdn.jsdelivr.net
    https://cdnjs.cloudflare.com
    https://www.wikidata.org
    https://query.wikidata.org
    https://commons.wikimedia.org
    data: blob:;
  img-src 'self' data: blob:
    https://upload.wikimedia.org
    https://commons.wikimedia.org
    https://tile.openstreetmap.org;
  style-src 'self' 'unsafe-inline'
    https://unpkg.com
    https://cdn.jsdelivr.net
    https://cdnjs.cloudflare.com;
  script-src 'self' 'wasm-unsafe-eval'
    https://unpkg.com
    https://cdn.jsdelivr.net
    https://cdnjs.cloudflare.com;
  worker-src 'self' blob:;
  connect-src 'self'
    https://unpkg.com
    https://cdn.jsdelivr.net
    https://www.wikidata.org
    https://query.wikidata.org
    https://commons.wikimedia.org
    https://upload.wikimedia.org
    https://storage.googleapis.com
    data:;
"/>
```

**ポリシー**:
- **default-src**: 信頼できるCDNのみ許可
- **script-src**: `'wasm-unsafe-eval'`でTesseract.js (WASM)対応
- **img-src**: Commons/OSMタイル許可
- **インラインスクリプト禁止**: XSS攻撃を防御

### 3. SRI（Subresource Integrity）

```html
<!-- Leaflet -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin="anonymous" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossorigin="anonymous"></script>
```

**対象**:
- Leaflet CSS/JS
- （Cytoscape.jsとExifReaderは動的CDNのため除外）

### 4. セキュアな外部リンク

```html
<a href="https://github.com/..."
   target="_blank"
   rel="noopener noreferrer">GitHub</a>
```

- **`rel="noopener"`**: `window.opener`アクセス防止
- **`rel="noreferrer"`**: Refererヘッダー送信防止

---

## パフォーマンス最適化

### 1. 画像リサイズ（main.js:75-89）

```javascript
async function resizeImage(file, maxDimension = 1536) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxDimension / img.width, maxDimension / img.height, 1);

      canvas.width = Math.floor(img.width * ratio);
      canvas.height = Math.floor(img.height * ratio);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas);
    };
    img.src = URL.createObjectURL(file);
  });
}
```

**効果**:
- **メモリ削減**: 4Kサイズ → 1536px
- **OCR高速化**: Tesseract.jsの処理時間短縮
- **Canvas描画軽量化**: ブラウザー負荷低減

### 2. Tesseract.js Worker管理

```javascript
async function quickOCR(canvas) {
  const worker = await Tesseract.createWorker();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const { data: { text } } = await worker.recognize(canvas);

  await worker.terminate(); // 重要: メモリリーク防止

  return text.trim();
}
```

**工夫**:
- **即座に終了**: 各ROIごとにWorkerを破棄
- **メモリ管理**: 長時間実行でのメモリ肥大化防止

### 3. 並列処理の制限

```javascript
// NG: 全ROIを同時処理（メモリ不足）
await Promise.all(rois.map(roi => analyzeROI(roi)));

// OK: 順次処理（安定性優先）
for (const roi of rois) {
  await analyzeROI(roi);
}
```

**理由**:
- Tesseract.jsはメモリ消費が大きい
- 5-10ROIの並列処理でブラウザークラッシュのリスク
- 順次処理で安定性を確保

### 4. キーボードショートカット（main.js:1926-1959）

```javascript
document.addEventListener('keydown', (e) => {
  // モーダル表示中はスキップ
  if (document.querySelector('.marking-modal[style*="display: flex"]')) return;
  if (document.querySelector('.help-modal[style*="display: flex"]')) return;

  // タブ切り替え（1-4）
  if (e.key >= '1' && e.key <= '4') {
    const tabButtons = document.querySelectorAll('.tab-button');
    const index = parseInt(e.key) - 1;
    if (tabButtons[index]) tabButtons[index].click();
  }

  // 画像切り替え（←→）
  if (e.key === 'ArrowLeft') selectPreviousImage();
  if (e.key === 'ArrowRight') selectNextImage();
});
```

**UX改善**:
- 頻繁な操作のショートカット化
- モーダル中は無効化（誤操作防止）

---

## 高度な機能

### 関係図のエッジ調整（graph.js:174-323）

**機能**: Cytoscape.jsのエッジ（矢印）を手動調整

```javascript
cy.on('tap', 'edge', function(evt) {
  const edge = evt.target;
  selectedEdge = edge;
  showEdgeAdjustmentPanel(edge);
});

function showEdgeAdjustmentPanel(edge) {
  const panel = document.getElementById('edgeAdjustPanel');

  // 現在の設定を取得
  const style = edge.style();
  const curveStyle = style['curve-style'];
  const distances = style['control-point-distances'] || [40];
  const weights = style['control-point-weights'] || [0.5];

  // UIに反映
  curveStyleSelect.value = curveStyle;
  distanceSlider.value = distances[0];
  weightSlider.value = weights[0];

  // リアルタイム更新
  distanceSlider.addEventListener('input', (e) => {
    edge.style({
      'control-point-distances': [parseFloat(e.target.value)]
    });
  });
}
```

**保存機能**:

```javascript
const edgeData = cy.edges().map(e => ({
  id: e.id(),
  curveStyle: e.style('curve-style'),
  controlPointDistances: e.style('control-point-distances'),
  controlPointWeights: e.style('control-point-weights')
}));

localStorage.setItem('graphEdgeStyles', JSON.stringify(edgeData));
```

---

## デバッグとロギング

### コンソールログ規約

```javascript
console.log('[MAP] Initial invalidateSize called');
console.warn('[MAP] Heatmap failed (zero-size canvas):', err);
console.error('[COMMONS] Fetch failed:', res.status);
```

**プレフィックス**:
- `[MAP]`: map.js
- `[COMMONS]`: commons.js
- `[WIKIDATA]`: wikidata.js
- `[MAIN]`: main.js
- `[UI]`: UI関連処理

**レベル**:
- `log`: 情報（正常動作）
- `warn`: 警告（続行可能なエラー）
- `error`: エラー（処理失敗）

---

## 既知の制限と将来の改善

### 現在の制限

1. **OCR精度**: Tesseract.jsは完璧ではない
   - 手書き・低解像度ロゴで誤認識
   - 対策: 手動ROI選択で精度向上

2. **Wikidata依存**: ロゴ（P154）がない企業は検出不可
   - カバレッジ: 主要企業の約70%
   - 対策: Wikidataへの貢献を促進

3. **ブラウザーメモリ制限**: 大量ROIで不安定
   - 制限: 最大16ROI
   - 対策: 順次処理で安定性確保

### 将来の改善案

1. **機械学習ベースのロゴ検出**
   - TensorFlow.js + MobileNetV2
   - ブラウザー内推論で精度向上

2. **WebWorkerでの並列処理**
   - OCRをWorkerに分離
   - UIブロッキング解消

3. **オフラインPWA化**
   - Service Worker + Cache API
   - 完全オフライン動作

4. **カスタムロゴDB**
   - Wikidataにないロゴの手動登録
   - localStorage/IndexedDBで管理

---

## 開発環境

### 推奨ツール

- **エディター**: VS Code + ESLint
- **ブラウザー**: Chrome/Edge DevTools
- **ローカルサーバー**: `npx http-server .`

### デバッグ手法

```javascript
// 1. ブレークポイント
debugger;

// 2. パフォーマンス測定
console.time('OCR');
await quickOCR(canvas);
console.timeEnd('OCR');

// 3. メモリ使用量
console.log(performance.memory.usedJSHeapSize / 1024 / 1024, 'MB');
```

---

## 貢献ガイドライン

### コーディング規約

- **ES6+**: モダンJavaScript構文
- **非同期処理**: async/await優先
- **命名規則**: camelCase（関数・変数）、UPPER_SNAKE_CASE（定数）
- **コメント**: 複雑なロジックには必ず説明

### プルリクエスト

1. **機能追加**: 新規モジュールは`js/`に配置
2. **バグ修正**: 再現手順を明記
3. **パフォーマンス改善**: ベンチマーク結果を添付

---

## ライセンス

MIT License - 詳細は [LICENSE](LICENSE) を参照

---

## 参考資料

- [Tesseract.js Documentation](https://github.com/naptha/tesseract.js)
- [Leaflet API Reference](https://leafletjs.com/reference.html)
- [Cytoscape.js Documentation](https://js.cytoscape.org/)
- [Wikidata SPARQL Examples](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/queries/examples)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
