# Repository Guidelines

## Project Structure & Module Organization
- `index.html` hosts the single-page workspace; keep layout tweaks declarative so classes stay aligned with `style.css` utilities.
- `style.css` defines both neon-dark and light themes; extend it by reusing custom properties and grouping related selectors.
- `js/` contains the feature modules (`main.js`, `detect.js`, `map.js`, `graph.js`, `wikidata.js`, `commons.js`, `exif.js`, `cache.js`); add new logic to the closest module and export named functions only.
- `assets/` stores static references such as logos or mock screenshots; keep filenames in kebab-case and document additions in `README.md`.

## Build, Test, and Development Commands
- `npx http-server . --cors` - serve the SPA locally with module-compatible headers on `http://localhost:8080`.
- `python -m http.server 4173` - alternate static server when Node.js is unavailable; open the matching port in the browser.
- `npm run format` - run formatting hooks you introduce; update the README if tooling or flags change.
- After starting a server, enable DevTools network throttling to simulate slow Wikidata calls and validate status handling.

## Coding Style & Naming Conventions
- Use 2-space indentation, keep semicolons, and prefer `const`/`let`; follow camelCase for variables, functions, and DOM IDs.
- Order imports with external packages first, then local utilities, and favor concise arrow functions with early-return guards.
- Keep CSS declarations compact, leverage shared custom properties for color and spacing, and co-locate new rules near related selectors.
- Name new files with lowercase-kebab-case and use descriptive data attributes such as `data-tab`, `data-layer`, or `data-mode`.

## Testing Guidelines
- No automated suite exists yet; manually load multiple images, draw ROIs, and confirm overlays, graph rendering, and marker updates before each PR.
- Exercise EXIF paths with one geotagged image and one without metadata to confirm fallback messaging and safe defaults.
- With Commons data cached, toggle offline mode to ensure `cache.js` continues serving sessions without throwing errors.
- Export a workspace JSON, re-import it, and confirm `serializeSession` restores AI suggestions, tab state, and map controls.

## Commit & Pull Request Guidelines
- Write imperative, Title Case commit subjects under 72 characters (e.g., `Add Manual ROI Replay Cache`) and add context in the body when needed.
- Reference issues with `Closes #123`, summarize UI-visible changes with concise bullets, and attach updated screenshots or recordings for notable UI tweaks.
- Document manual testing coverage (browsers, sample assets, throttling) in the PR description and flag any new configuration toggles.
- Request review from module owners (`map.js`, `graph.js`, etc.) when editing their domains and highlight cross-module impacts in the summary.

## Security & Configuration Tips
- Keep the app client-only: avoid adding persistence layers, embedding secrets, or bypassing Wikimedia authentication flows.
- Scrub personal metadata from contributed assets and prefer synthetic or anonymized imagery when sharing test files.
- Document any new CDN scripts in `index.html`, include integrity hashes, and limit third-party dependencies to essential ones.
