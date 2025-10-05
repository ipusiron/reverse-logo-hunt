# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reverse Logo Hunt** is a client-side OSINT tool that detects corporate logos in images and visualizes company relationships through maps and graphs. All image processing happens in the browser using Wikidata/Wikimedia Commons as data sources.

Key capabilities:
- Logo detection in uploaded images using edge detection + OCR
- Company information retrieval from Wikidata
- Logo verification via image similarity (pHash, color histogram, edge correlation)
- Geographic visualization of HQ/offices on Leaflet maps
- Corporate relationship graphs using Cytoscape.js

## Running the Application

This is a static web application with no build step:

```bash
# Local development - serve with any HTTP server
npx http-server .
# or
python -m http.server 8000

# Open browser to http://localhost:8000
```

For Windows with Git Bash:
```bash
start index.html  # Opens directly in default browser
```

The app is also deployable to GitHub Pages (already configured with `.nojekyll`).

## Architecture

### Module Structure

The application uses ES6 modules with clear separation of concerns:

- **main.js** - Entry point, UI orchestration, image upload handling, similarity scoring pipeline, JSON import/export
- **detect.js** - Logo ROI extraction (edge detection → sliding window → OCR → NMS)
- **wikidata.js** - SPARQL queries for company data (logo P154, HQ P159, relations P355/P749/P127)
- **commons.js** - Wikimedia Commons API for logo thumbnails and attribution metadata
- **cache.js** - IndexedDB caching layer for Wikidata/Commons responses (24-hour TTL)
- **map.js** - Leaflet map with HQ/office/EXIF location markers
- **graph.js** - Cytoscape.js visualization of corporate relationships
- **exif.js** - GPS coordinate extraction from uploaded images

### Data Flow

1. **Image Upload** → Resize to configurable max dimension (default 1536px)
2. **ROI Detection** → Sobel edge detection → Grid sampling → Edge density scoring → NMS deduplication
3. **OCR** → Tesseract.js on each ROI → Brand name extraction
4. **Wikidata Lookup** → SPARQL search by brand name → Retrieve top 10 candidates with logo/HQ data
5. **Logo Matching** → Download Commons logo thumbnails → Compute similarity scores:
   - 50% pHash (perceptual hash hamming distance)
   - 30% Color histogram cosine similarity
   - 20% Edge correlation (ORB approximation via Sobel)
6. **Visualization** → Best match triggers:
   - Map pin at HQ coordinates
   - Corporate relationship graph
   - ROI/Commons logo comparison UI

### Key Algorithms

**Logo Detection (detect.js:84-105)**
- Sliding window at 15%/23% of min(width,height)
- 60% overlap for better coverage
- Edge density threshold >0.15
- Maximum 16 ROIs per image

**Similarity Scoring (main.js:214-244)**
- Simplified pHash using 8x8 average hash (64-bit)
- 24-bin color histogram (12 hue bins × 2 value bands)
- Edge-based ORB approximation (128×128 Sobel correlation)
- Combined score: 0.5×pHash + 0.3×color + 0.2×ORB

**Wikidata Integration (wikidata.js)**
- Uses MWApi service for fuzzy search (not exact match)
- Retrieves P154 (logo), P159→P625 (HQ coordinates)
- Relation queries: P355 (subsidiary), P749 (parent), P127 (owned by)

## Important Implementation Details

### Content Security Policy
The CSP in index.html:5 is strict and allows only:
- Self + specific CDNs (unpkg, jsdelivr, cdnjs)
- Wikidata/Commons APIs
- `data:` and `blob:` for local image processing
- `unsafe-inline` styles only (no inline scripts)

When adding external dependencies, update the CSP header.

### Privacy & Licensing
- No uploaded images leave the browser (stated in index.html)
- Commons logos are fetched on-demand, not permanently stored
- Attribution is auto-generated (commons.js) with artist/license/source link
- IndexedDB cache implemented (cache.js) with 24-hour TTL for Wikidata/Commons API responses

### Performance Considerations
- Tesseract.js workers are terminated after each ROI to free memory
- Images are downscaled before processing (default max 1536px)
- NMS deduplication prevents redundant Wikidata queries
- IndexedDB cache reduces API calls for repeated queries (cache.js with 24-hour expiry)
- CORS enabled for Commons images via `crossOrigin='anonymous'`

## Common Development Tasks

### Adding a New Tab
1. Add button in index.html with `data-tab="tab-name"` and `class="tab-button"`
2. Add content div with `id="tab-name"` and `class="tab"`
3. Tab switching is handled automatically by event delegation in main.js
4. Keyboard shortcuts 1-4 are auto-assigned to first four tabs

### Working with Cached Data
- Get cached data: `await getCached(storeName, key)` (cache.js)
- Set cached data: `await setCached(storeName, key, value, ttlMs)` (cache.js)
- Store names: 'wikidata', 'relations', 'commons'
- Default TTL: 24 hours (86400000ms)

### JSON Workspace Export/Import
- Export: Creates JSON with images (base64), ROIs, OCR results, and analysis data
- Import: Fully restores session including images and all detection results
- Implementation in main.js (exportWorkspaceJSON/importWorkspaceJSON functions)

### Modifying Detection Parameters
- ROI window sizes: detect.js (currently 15% and 23% of image min dimension)
- Edge threshold: detect.js (currently 0.15)
- Score weights: main.js (pHash/color/ORB ratio: 0.5/0.3/0.2)
- NMS IoU threshold: detect.js (currently 0.3)
- Image downscale limit: main.js (default 1536px max dimension)

### UI Keyboard Shortcuts
- `1-4`: Switch between tabs (Justify/Map/Graph/History)
- `←→`: Navigate between uploaded images
- Shortcuts are defined in main.js keyboard event handler

### Adding Wikidata Properties
1. Update SPARQL query in wikidata.js (fetchCompanyBundle or companyRelationsBundle functions)
2. Add parsing logic for new property in wikidata.js
3. Wire up visualization in main.js or relevant module (map.js/graph.js)
4. Consider adding to cache.js stores if caching is needed

## Testing Notes

No automated tests exist. Manual testing checklist:
- Upload images with clear logos (PNG/JPG)
- Verify EXIF GPS parsing with geotagged photos
- Test with Japanese and English company names
- Confirm Commons attribution links work
- Check CSP compliance in browser console
- Verify map markers appear at correct coordinates
