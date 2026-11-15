# Local music library

A local, browser-based music library and player. Choose a folder to recursively index its MP3 files, then search, sort, or rescan the collection. Files stay in their original locations; folder handles, the index, and playlists are stored in IndexedDB on this browser and device. Nothing is uploaded.

## Run

Use Node.js and npm to build the static site:

```sh
npm install
npm run build
```

Serve the project root using any static HTTP server, for example `npx serve .`, and open its localhost address in a current Chromium-based browser. Deploy `index.html` and the generated `dist` directory together to a static host over HTTPS. Folder access requires HTTPS or localhost and a browser supporting the File System Access API.

Folder controls are below the navigation. When opening the site again, the saved index and playlists remain visible even if folder permission has expired. Use **Reconnect** to grant access again, or **Change folder** if the saved handle is no longer available. **Rescan** discovers added and removed MP3 files; a failed scan leaves the previous index intact. Playlist entries for removed files remain visible until removed. Choosing a different folder clears the current playlist but keeps saved playlists. Clearing browser site data removes the index, playlists, and saved folder permission.

Title, artist, album, track number, and year come from MP3 tags, with the filename, “Unknown artist,” “Unknown album,” and a dash used when tags are missing. Rescan an existing library to index track numbers and years. An album’s year is the earliest year among its tracks. Duration is read by the browser. Files with unreadable metadata are still indexed; the dismissible scan result lists their paths and whether metadata or duration could not be read. Missing durations are excluded from the total (indicated by `+`). A scan can take time for large collections.

Use **Artists**, **Albums**, and **Tracks** under Library to browse the center view. Navigation counts include unknown artist and album groups, and each saved playlist shows its track count. Select an artist to browse their albums, then select an album to see its tracks. The Albums view shows albums across the whole library. Artist and album tables show track counts and total duration; artists also show album counts. Counts, durations, and group actions reflect the current search results. Click a column heading to sort, and click it again to reverse the order. Use **+** to add tracks or all matching tracks in a group to the current playlist without duplicates. **Play** adds any missing tracks and starts the first track in the selection. Action buttons have hover labels and accessible names. Playback controls are above the playlist, and playback advances through the playlist automatically. Double-click an item in the current playlist (or focus it and press Enter) to play it.

Use the save icon on the current playlist to name and save a snapshot. Saving an existing name asks before replacing it. Select a saved playlist under **Playlists** to view its tracks in the center, or open **Playlists** for the full list. Viewing a snapshot does not change the current playlist; use its load icon to do that. Deleting a saved playlist does not change the current playlist. To load one, select the same music folder it was saved from. Changes to the current playlist do not automatically update a saved snapshot; save under the same name to replace it. Use the shuffle icon on the current playlist to generate random tracks by duration: enter minutes and the tracks are added after the current ones, skipping any already in the playlist. Clear the playlist first to start fresh. Tracks are picked at random without exceeding the requested time, and tracks with an unknown duration are never picked. On **Playlists**, use the export icons to download one playlist or all of them as a JSON file, and the import icon to add playlists from such files. Imported playlists are tied to the currently connected music folder, so import after choosing the folder their file paths belong to. Names that already exist get a number suffix instead of being replaced.

## Test

```sh
npm test
```
