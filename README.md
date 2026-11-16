# Local music library

A static, client-side player for your local MP3 collection. Pick a folder and it indexes the files in place. Nothing is uploaded; the index, playlists and settings live in this browser's IndexedDB and localStorage.

Requires a Chromium-based browser (File System Access API) over HTTPS or localhost.

## Features

- **Library:** browse by artist, album or track; search, sort any column, add to the playlist or play from anywhere.
- **Playlists:** save, rename, reorder by drag and drop, remove tracks, shuffle in tracks by minutes, import/export as JSON. The loaded playlist is remembered and its name pre-filled on save.
- **Playback:** resumes where you left off after a reload; volume remembered.
- **Analysis:** timeline of your library by release year, measured in albums or tracks.
- **Visualizer:** live spectrum of the playing track.
- **Folders:** choose a folder or drag one onto the folder button. Rescan after adding or removing files.
- **Deep links:** the current view is kept in the address, so reloads and the back button work.

## Notes

- Tags (title, artist, album, track number, year) come from the MP3 files. Rescan older libraries to pick up track numbers and years.
- After a browser restart the library stays visible, but folder access may need **Reconnect** before playing or rescanning.
- Playlists are tied to the folder they were saved from. Clearing site data removes everything.

## Run

```sh
npm install
npm run build
```

Serve the project root with any static server (for example `npx serve .`). To publish, deploy `index.html` and `dist/` together.

## Test

```sh
npm test
```
