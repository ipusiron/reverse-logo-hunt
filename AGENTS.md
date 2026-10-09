# Repository Guidelines

## Project Structure & Module Organization
- `index.html` hosts the single-page app. Keep it free of inline scripts, inline event handlers and `style` attributes (the CSP forbids them).
- `style.css` defines the dark (default) and light themes with CSS variables. Add colours as variables so `test/contrast.test.js` can check them.
- `js/*-core.js`, `js/logo-match.js`, `js/brand-text.js`, `js/candidate-rank.js`, `js/ocr-prep.js`, `js/roi-suggest.js` and `js/session-core.js` are pure logic modules. Keep them free of DOM and network access so they run under `node --test`.
- `js/wikidata.js`, `js/commons.js`, `js/cache.js`, `js/analysis.js`, `js/ocr.js` handle network and OCR; `js/main.js`, `js/marking.js`, `js/map.js`, `js/graph.js` handle the UI.
- `test/` holds the tests; `test/fixtures/` holds real API responses; `test/synthetic.js` builds synthetic images (no real logos).
- `assets/` holds the README screenshots only.

## Build, Test, and Development Commands
- `npm test` - run all tests with `node --test` (Node 22+, no dependencies).
- `python -m http.server 8000` - serve locally; Chrome and Edge refuse ES modules from `file://`.

## Coding Style & Naming Conventions
- 2-space indentation, semicolons, double quotes, `const`/`let`.
- Lines up to 160 characters in JS and CSS, 250 in `index.html`.
- Put user-visible strings in `js/messages.js`.
- Insert external text with `textContent`; never `innerHTML`.

## Testing Guidelines
- Add tests next to any change in a pure module. Compute expected values by running the code, not by hand.
- When README numbers change, update `test/readme.test.js` together.
- Check the page in a real browser (Chromium and Firefox) for CSP violations and console errors after UI changes, at 1280, 390 and 320 px wide, in both themes.

## Commit & Pull Request Guidelines
- Commit messages in Japanese, short first line; describe what changed and why.
- Merge through pull requests after GitHub Actions passes.

## Security & Configuration Tips
- Keep the app client-only. Do not send images, marked regions or OCR text anywhere.
- New external scripts need a pinned version, SRI computed from the real file, and a CSP update.
- Do not commit trademark logo images; screenshots may show public-domain Commons logos.
