# Local music library

A static, client-side player for your local MP3 collection. Add folders and it indexes the files in place. Nothing is uploaded; the index, playlists and settings live in this browser's IndexedDB and localStorage.

Requires a Chromium-based browser (File System Access API) over HTTPS or localhost.

## Features

- **Sources:** add one or more folders (or drag them onto the add button); rescan, reconnect or remove each, or all at once. Folders with the same name are told apart by their contents.
- **Library:** browse by artist, album or track; search, sort any column (kept in the address), filter by source, add to the playlist or play from anywhere.
- **Direct play:** drop music files or folders on the current playlist to play them right away without adding them to the library. Dropped on an empty playlist (or on the playlists' import button), they become an auto-saved playlist that keeps growing while it's loaded.
- **Playlists:** save, rename, reorder by drag and drop, remove tracks, shuffle in tracks by minutes, import/export as JSON. Total, elapsed and remaining length at a glance.
- **Playback:** resumes where you left off after a reload; volume and speed remembered. A cut handle on the progress bar fades each track out at a set point and moves on.
- **Lyrics:** read from the MP3's tags or a same-named `.txt` next to it; timed (LRC) lyrics follow along and seek on click.
- **Visualizer:** live spectrum of the playing track; shown after 30 s without input while music plays.
- **Analysis:** timeline of your library by release year, measured in albums or tracks.
- **Deep links:** the current view is kept in the address, so reloads and the back button work.

## Notes

- Tags (title, artist, album, track number, year) come from the MP3 files. Rescan older libraries to pick up track numbers and years.
- After a browser restart the library stays visible, but folder access may need **Reconnect** before playing or rescanning. Direct-play playlists may ask for access to their files again.
- Saved playlists find their tracks by folder (even after a folder is removed and re-added). Clearing site data removes everything.

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
