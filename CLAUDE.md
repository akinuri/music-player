# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, client-side music player for a local audio collection (no backend). It uses the File System Access API, so it only runs in Chromium over HTTPS or localhost. It is published to GitHub Pages (`akinuri.github.io/music-player`) as `index.html` + `dist/`. See README.md for the feature list.

## Commands

```sh
npm install
npm run build                       # Tailwind -> dist/styles.css, esbuild -> dist/app.js and dist/terrain.js (all minified)
npm test                            # node --test (runs test/*.test.js)
node --test test/playlists.test.js  # one test file
node --test --test-name-pattern="restoring" test/playback.test.js  # one test by name
npx serve .                         # serve the project root to try it in the browser
```

There is no linter, formatter or typecheck step.

## Build output is committed

`dist/` is checked in and is what the deployed site loads (`index.html` references `./dist/styles.css` and `./dist/app.js`). After changing anything in `src/`, `tailwind.config.js` or Tailwind classes in `index.html`, run `npm run build` and commit the regenerated `dist/` files too (history uses either the same commit or a follow-up `(build) dist: …` commit). Commit messages follow `(type) scope: summary`, e.g. `(feat) visualizer: …`, `(ui) current playlist: …`, `(fix) reconnect: …`.

## Architecture

- **`index.html`** holds all of the markup (every view, panel and the player bar); there is no templating or framework. A small inline script applies the saved theme before first paint and must stay in sync with `src/theme.js`.
- **`src/app.js`** is the controller (~3k lines): it looks up DOM elements by id into the `elements` map, owns all UI state as module-level variables (current view, library mode/group, sorts, selected playlist, permissions), renders views, wires events, and keeps the current view in the URL for deep links/back button. Nearly every UI change lands here.
- **Pure logic modules** (unit-tested, no DOM): `library.js` (grouping/filtering/sorting for artist/album/track views), `playlists.js` (create/migrate/import/export/resolve saved playlists, generate by minutes), `sources.js` (track keys, multi-source library merges), `analysis.js` (year timeline), `lyrics.js` (LRC parsing, text decoding), `theme.js` (preference resolution + `--c-*` CSS-var color reads for canvases), `spectrum.js` (offline copy of the Web Audio AnalyserNode math, used to fill gaps in the 3D terrain from the decoded file; must stay in step with the live analyser settings in `visualizer.js`), `id3.js` (writes changed text fields into an MP3's ID3v2.3/2.4 tag, copying every other frame byte for byte; refuses v2.2 and unsynchronised tags), `recording.js` (save/load format for the terrain's rows; each row is marked live or filled and keeps its Smooth setting).
- **Browser-facing modules:** `filesystem.js` (walks directory handles, finds audio and sibling `.txt` lyric files), `metadata.js` (jsmediatags wrapper), `storage.js` (IndexedDB), `playback.js` (`Playback` class around one `Audio` element; callbacks `onChange`/`onEnded`/`onError`), `visualizer.js` (2D spectrum bars + loop control), `tooltips.js` (tippy.js).
- **`src/terrain.js`** (three.js 3D terrain) is a separate esbuild entry, lazily loaded by `visualizer.js` via `import(new URL("./terrain.js", import.meta.url))` so three.js stays out of the main bundle. Keep it as its own entry in the build script.

### Data model invariants

- A library has multiple **sources** (folder handles). Tracks are keyed `"sourceId:relative/path"` (`sources.js` `trackKey`/`splitKey`); everything else (playlists, session, caches) treats keys as opaque strings. Saved playlists store relative paths plus source folder names and are re-resolved against the current library (`resolvePlaylist`) so they survive a folder being removed and re-added.
- Persistence: library and playlists live in IndexedDB database `"stillroom"` (name kept for backward compatibility; don't rename it), store `library`, key `current` for the library and `playlist:<id>` for each playlist. Settings/session (theme, volume, speed, resume position, etc.) are in localStorage. Older stored shapes are upgraded on load by `migrateLibrary` / `migrateSavedPlaylist` — add a migration rather than breaking existing data.
- Folder permissions can be `"granted" | "prompt" | "denied"` per source after a browser restart; flows must handle needing **Reconnect** before playing or rescanning.

### Theming hooks (public contract)

External themes (e.g. `music-player-christmas.user.js`, a userscript) rely on these, so keep them stable: `--c-*` CSS variables on `:root` holding `r g b` triplets, `<html data-theme="light|dark">`, the `themechange` event on `document`, `#theme-switch` with `[data-theme-option]` buttons, and `data-panel` on panels. Canvases re-read colors on their next draw.

## Tests

Tests use `node:test` + `node:assert/strict` and import directly from `src/` (no build needed). Browser APIs are stubbed per test by temporarily replacing globals (e.g. `globalThis.Audio`, `URL.createObjectURL`) and restoring them in `finally`. Logic worth testing should live in the pure modules rather than `app.js`, which has no tests.
