# Local music library

A static, client-side player for your local MP3 collection. Add folders and it indexes the files in place. Nothing is uploaded; the index, playlists and settings live in this browser's IndexedDB and localStorage.

Requires a Chromium-based browser (File System Access API) over HTTPS or localhost.

## Features

- **Sources:** add one or more folders (or drag them onto the add button); rescan, reconnect or remove each, or all at once. Folders with the same name are told apart by their contents.
- **Cover art:** from the track's tag, or a `cover.jpg` / `folder.jpg` (and the like) next to it. Shown by the playing track, on album rows and album pages, and as a grid of albums (List / Grid in the album lists). Thumbnails are kept, so lists of covers are quick after a reload.
- **Library:** browse by artist, album or track; search, sort any column (kept in the address), filter by source, add to the playlist or play from anywhere.
- **Tag editor:** edit an MP3's (in the library or dropped) title, artist, album, genre, track number and year; album artist, composer, lyricist, copyright, disc and comment; the cover (choose, drop or paste an image, or remove it); embedded lyrics; and the `.lrc` / `.txt` lyrics files next to it (for library tracks and dropped folders), created when missing and deleted when emptied (right-click a track in the library or a playlist). Only the changed fields are written into the file; cover art, embedded lyrics and other tag data are kept. The first save in a folder asks for permission to change files there.
- **Media info:** everything about a track's file, like MediaInfo (right-click a track): exact duration and bit rate from every MPEG frame, sample rate, channel mode, encoder and its settings, each ID3v2 frame (with cover art), ID3v1 and APE tags. Copy puts it all on the clipboard as text.
- **Direct play:** drop music files or folders on the current playlist to play them right away without adding them to the library. Dropped on an empty playlist (or on the playlists' import button), they become an auto-saved playlist that keeps growing while it's loaded.
- **Playlists:** save, rename, reorder by drag and drop, remove tracks, shuffle in tracks by minutes, import/export as JSON. Total, elapsed and remaining length at a glance.
- **Playback:** resumes where you left off after a reload; volume and speed remembered. A cut handle on the progress bar fades each track out at a set point and moves on. A gap setting waits 1–10 s between tracks, or stops after each one (∞).
- **Lyrics:** read from the MP3's tags, or else a same-named `.lrc` or `.txt` file next to it (switchable in the Lyrics view; only the chosen format is looked for). Timed (LRC) lyrics follow along and seek on click; an offset per track shifts them when they were timed to a different recording.
- **Visualizer:** live spectrum of the playing track as 2D bars or a rotatable 3D terrain of the song so far (parts missed in a background tab or skipped by jumping ahead are filled in from the file), which can be downloaded and loaded back; shown after 30 s without input while music plays.
- **Analysis:** timeline of your library by release year, measured in albums or tracks.
- **Installable:** install it as an app (the browser's install button, or right-click → Install app) to open it in its own window from the Start menu. It starts offline too, from a copy kept by its service worker.
- **Deep links:** the current view is kept in the address, so reloads and the back button work.

## Notes

- Tags (title, artist, album, track number, year) come from the MP3 files. Rescan older libraries to pick up track numbers and years.
- After a browser restart the library stays visible, but folder access may need **Reconnect** before playing or rescanning. Direct-play playlists may ask for access to their files again.
- Saved playlists find their tracks by folder (even after a folder is removed and re-added). Clearing site data removes everything.

## Custom themes

The app can be re-themed from outside (e.g. a userscript) through these hooks, which are kept stable:

- Colors are CSS variables on `:root` named `--c-*`, holding `r g b` triplets (e.g. `--c-primary: 49 94 85`). Override them under a more specific selector such as `html:root[data-my-theme]`. Canvases pick up changes to `<html>` attributes on their next draw.
- `<html data-theme>` is the active built-in theme (`light` / `dark`). The `themechange` event fires on `document` whenever it changes.
- The theme picker is `#theme-switch`, with one button per `[data-theme-option]`.
- Panels (sidebar blocks, views, player cards) carry `data-panel`.

## Run

```sh
npm install
npm run build
```

Serve the project root with any static server (for example `npx serve .`). To publish, deploy `index.html`, `dist/`, `manifest.webmanifest`, `sw.js` and `icons/` together.

## Test

```sh
npm test
```
