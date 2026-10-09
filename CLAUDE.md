# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reverse Logo Hunt** is a client-side OSINT tool. The user marks a logo in an image; the tool reads its text with OCR (Tesseract.js), searches Wikidata, compares each candidate with its official logo on Wikimedia Commons, and ranks the candidates. The user confirms the company; its headquarters and the photo location (EXIF GPS) are shown on a map, and its parents, subsidiaries and owners on a relation graph. Images never leave the browser.

See `README.md` for users and `TECHNICAL.md` for the algorithms, queries and security design.

## Running and Testing

```bash
npm test                      # node --test, Node 22+, no dependencies
python -m http.server 8000    # then open http://localhost:8000/ (Chrome/Edge refuse ES modules from file://)
```

GitHub Actions runs `npm test` on every push and pull request (`.github/workflows/test.yml`).

## Architecture

Pure logic ("calculation") modules have no DOM or network dependencies and are tested with `node --test`:

- `js/logo-match.js` - background estimation, foreground extraction, and the four similarity values (shape, light-dark structure, aspect ratio, colour). Weights 0.35/0.25/0.15/0.25
- `js/brand-text.js` - search-query candidates from OCR text (keeps BMW/HP/3M/Japanese, up to 5)
- `js/wikidata-core.js` - wbsearchentities URL, SPARQL builders (only validated QIDs are embedded), parsers, relation direction (always parent/owner -> child)
- `js/commons-core.js` - imageinfo URL (width 330), parser, `htmlToText` for the Artist field, URL allow-lists
- `js/exif-core.js` - GPS from ExifReader's expanded tags (signed decimal numbers)
- `js/candidate-rank.js` - combined score = 0.4*search rank + 0.2*type + 0.4*visual (0.5 when no logo)
- `js/ocr-prep.js` - upscale, grayscale, inversion, frame removal for OCR retries
- `js/roi-suggest.js` - "auto mark" by connected ink components
- `js/session-core.js` - workspace JSON v3 builder and validator (also reads v2)
- `js/group-core.js` - follows parents/owners of all selected companies (up to 3 levels) and finds shared parents
- `js/geo.js` - great-circle distance and 8-point bearing from the photo location to each headquarters

Network / UI modules:

- `js/wikidata.js`, `js/commons.js`, `js/cache.js` - fetch with a 24-hour IndexedDB cache
- `js/analysis.js` - search -> details -> logo matching -> ranking for one region
- `js/ocr.js` - one shared Tesseract worker per language
- `js/marking.js` - the marking modal (Pointer Events: mouse, touch, pen)
- `js/map.js` (Leaflet + OSM tiles), `js/graph.js` (Cytoscape, concentric layout by default)
- `js/main.js` - state, rendering, export/import, theme, keyboard
- `js/messages.js` - UI strings in Japanese and English (same keys); `js/i18n.js` - applies them to `data-i18n` / `data-i18n-attr` and switches language
- `js/storage.js` - safe localStorage

## Rules That Tests Enforce

- CSP stays `default-src 'self'`; no `'unsafe-inline'` or `'unsafe-eval'` (`'wasm-unsafe-eval'` only). The `style-src` hash allows Cytoscape's single injected line. `connect-src` keeps `data:` for Tesseract's embedded WASM
- Every external `<script>` is version-pinned with SRI. Recompute hashes from the real files if a version changes
- Keep `<meta name="referrer" content="strict-origin-when-cross-origin">` (the OSM tile policy needs a Referer)
- Never use `innerHTML`/`insertAdjacentHTML`; build DOM with `textContent`
- No inline event handlers or `style` attributes in `index.html`
- Colours live in CSS variables in `style.css`; `test/contrast.test.js` checks text pairs at 4.5:1 in both themes
- Lines: JS/CSS <= 160 characters, `index.html` <= 250
- README numbers (weights, example values) are recomputed by `test/readme.test.js` for both `README.md` and `README.en.md`; update them together with the code
- Every user-visible string goes through `js/messages.js` with the same keys in `ja` and `en`; the default text in `index.html` must equal the `ja` value
- Keep Tesseract's page segmentation mode at 6 by default (3 makes single-line text signs read as nothing)
- The README directory tree must list every file with a one-line description

## Notes

- Commons thumbnails are served from `thumb.wikimedia.org` (as of 2026-10-09). If Wikimedia changes the host again, update both the CSP and `IMAGE_HOSTS` in `commons-core.js`
- Fixtures in `test/fixtures/` are real API responses captured on 2026-10-09 (Wikidata is CC0)
- Screenshots are taken by a script outside this repository; the sample board uses public-domain Commons logos and is not committed
