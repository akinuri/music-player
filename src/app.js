import { scanLibrary } from "./filesystem.js";
import { readMetadata } from "./metadata.js";
import { loadLibrary, saveLibrary, loadSavedPlaylists, saveSavedPlaylist, deleteSavedPlaylist } from "./storage.js";
import { Playback } from "./playback.js";
import { createSavedPlaylist, playlistMatchesLibrary } from "./playlists.js";
import { filterLibraryTracks, groupArtistLabel, groupKey, groupLibraryTracks, sortLibraryGroups, sortLibraryTracks } from "./library.js";

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(["choose-folder", "reconnect", "rescan", "search", "track-count", "artist-nav-count", "album-nav-count", "track-nav-count", "heading-count", "library-heading", "library-title", "tracks-table", "track-rows", "groups-table", "group-rows", "group-albums-col", "group-albums-heading", "group-artist-col", "group-artist-heading", "group-year-col", "group-year-heading", "group-name-heading", "total-duration", "folder-name", "folder-status", "notice", "notice-content", "dismiss-notice", "empty", "empty-title", "empty-description", "nav-library", "nav-artist", "nav-album", "nav-track", "nav-playlists", "playlist-nav-items", "library-view", "playlists-view", "saved-title", "saved-description", "saved-actions", "saved-count", "saved-playlists", "saved-empty", "playlist", "playlist-count", "playlist-nav-count", "playlist-duration", "playlist-empty", "save-playlist", "save-form", "playlist-name", "save-submit", "save-cancel", "clear-playlist", "now-playing", "now-artist", "previous", "play-pause", "next", "elapsed", "seek", "playback-duration"].map(id => [id, $(id)]));
const sortButtons = document.querySelectorAll("[data-sort]");
const groupSortButtons = document.querySelectorAll("[data-group-sort]");
let library = null;
let savedPlaylists = [];
let currentView = "library";
let libraryMode = "track";
let libraryGroup = null;
let artistAlbum = null;
let sortKey = "title";
let sortDirection = "ascending";
const groupSort = { artist: { key: "name", direction: "ascending" }, album: { key: "name", direction: "ascending" } };
let selectedPlaylistId = null;
let selectedPlaylistMatchesLibrary = false;
let permission = "prompt";
let busy = true;
const player = new Playback({
  onChange: renderPlayback,
  onEnded: () => advance(1),
  onError: error => {
    console.error("Playback failed:", error);
    notice("Couldn't play this file. It may be missing, unreadable, or unsupported.", true);
  }
});

function notice(message, error = false, warnings = []) {
  const element = elements.notice;
  const content = elements["notice-content"];
  content.textContent = message;
  element.className = `flex items-start gap-3 rounded-lg border px-4 py-3 text-base ${error ? "border-[#efd6ce] bg-[#fff7f4] text-[#8c4a36]" : "border-[#c9dfd3] bg-[#f2f8ee] text-forest"}`;
  if (warnings.length) {
    const list = document.createElement("ul");
    list.className = "mt-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8c4a36]";
    list.tabIndex = 0;
    list.setAttribute("aria-label", "Problematic tracks");
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.className = "break-words";
      item.textContent = `${warning.path} — ${warning.issues.join(" and ")} could not be read`;
      list.append(item);
    }
    content.append(list);
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatTotal(tracks) {
  const known = tracks.filter(track => Number.isFinite(track.duration));
  const total = known.reduce((sum, track) => sum + track.duration, 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  return known.length ? `${hours ? `${hours}h ` : ""}${minutes}m ${String(seconds).padStart(2, "0")}s${known.length < tracks.length ? " +" : ""}` : "—";
}

function playlistPaths() {
  return library?.playlist || [];
}

function trackFor(path) {
  return library?.tracks.find(track => track.path === path);
}

function renderPlayback() {
  const track = trackFor(player.path);
  const index = playlistPaths().indexOf(player.path);
  elements["now-playing"].textContent = player.path ? track?.title || player.path : "Nothing playing";
  elements["now-artist"].textContent = track ? track.artist || "Unknown artist" : "";
  const playing = player.path && !player.audio.paused;
  const playLabel = playing ? "Pause" : "Play";
  elements["play-pause"].setAttribute("aria-label", playLabel);
  elements["play-pause"].title = playLabel;
  elements["play-pause"].querySelector("use").setAttribute("href", playing ? "#icon-pause" : "#icon-play");
  elements["play-pause"].disabled = !player.path && !playlistPaths().length;
  elements.previous.disabled = index <= 0;
  elements.next.disabled = index < 0 || index >= playlistPaths().length - 1;
  const duration = player.audio.duration;
  elements.elapsed.textContent = formatDuration(player.audio.currentTime);
  elements["playback-duration"].textContent = formatDuration(duration);
  elements.seek.disabled = !Number.isFinite(duration) || duration <= 0;
  elements.seek.max = elements.seek.disabled ? "0" : String(duration);
  elements.seek.value = String(player.audio.currentTime || 0);
  for (const row of elements.playlist.children) {
    row.classList.toggle("bg-[#dcece6]", row.dataset.path === player.path);
  }
}

const buttonTitles = {
  play: "Play",
  add: "Add to playlist",
  added: "Added to playlist",
  remove: "Remove from playlist",
  load: "Load playlist",
  clear: "Delete playlist"
};

function button(icon, label, action, disabled = false, compact = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = buttonTitles[icon];
  element.className = `flex ${compact ? "h-8 w-8" : "h-10 w-10"} shrink-0 items-center justify-center rounded border border-[#c1ced1] bg-white text-[#28454a] hover:bg-[#e7f0ed] disabled:cursor-not-allowed disabled:opacity-40`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "h-5 w-5");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${icon}`);
  svg.append(use);
  element.append(svg);
  element.disabled = disabled;
  element.addEventListener("click", action);
  return element;
}

function trackCell(value, style) {
  const cell = document.createElement("td");
  cell.className = `px-3 py-3 ${style}`;
  const text = document.createElement("span");
  text.className = "block truncate";
  text.textContent = value;
  text.title = value;
  cell.append(text);
  return cell;
}

function render() {
  for (const view of ["library", "playlists"]) {
    const active = currentView === view;
    const nav = elements[`nav-${view}`];
    const panel = elements[`${view}-view`];
    nav.classList.toggle("bg-[#e1eee8]", active);
    nav.classList.toggle("font-semibold", active);
    nav.classList.toggle("text-[#284f48]", active);
    nav.classList.toggle("font-medium", !active);
    nav.classList.toggle("text-[#273b44]", !active);
    if (active && view === "playlists" && !selectedPlaylistId) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
    panel.classList.toggle("hidden", !active);
    panel.classList.toggle("flex", active);
  }
  for (const mode of ["artist", "album", "track"]) {
    const nav = elements[`nav-${mode}`];
    const active = currentView === "library" && libraryMode === mode;
    nav.classList.toggle("bg-[#e1eee8]", active);
    nav.classList.toggle("font-semibold", active);
    nav.classList.toggle("text-[#284f48]", active);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  const focusedPlaylist = document.activeElement?.dataset.playlistId;
  elements["playlist-nav-items"].replaceChildren();
  for (const saved of [...savedPlaylists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))) {
    const nav = document.createElement("button");
    nav.type = "button";
    nav.dataset.playlistId = saved.id;
    nav.className = "flex min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-base hover:bg-[#edf5f1]";
    const name = document.createElement("span");
    name.className = "min-w-0 break-words";
    name.textContent = saved.name;
    const count = document.createElement("span");
    count.className = "shrink-0 text-[#5d7079]";
    count.textContent = saved.tracks.length.toLocaleString();
    nav.append(name, count);
    const active = currentView === "playlists" && selectedPlaylistId === saved.id;
    if (active) {
      nav.classList.add("bg-[#e1eee8]", "font-semibold", "text-[#284f48]");
      nav.setAttribute("aria-current", "page");
    }
    nav.addEventListener("click", () => selectPlaylist(saved));
    elements["playlist-nav-items"].append(nav);
    if (saved.id === focusedPlaylist) nav.focus();
  }
  const tracks = library?.tracks || [];
  elements["artist-nav-count"].textContent = new Set(tracks.map(track => groupKey(track, "artist"))).size.toLocaleString();
  elements["album-nav-count"].textContent = new Set(tracks.map(track => groupKey(track, "album"))).size.toLocaleString();
  elements["track-nav-count"].textContent = tracks.length.toLocaleString();
  const query = elements.search.value.trim().toLocaleLowerCase();
  const filtered = sortLibraryTracks(filterLibraryTracks(tracks, libraryMode, libraryGroup, artistAlbum, query), sortKey, sortDirection);
  elements["track-count"].textContent = tracks.length.toLocaleString();
  const artistAlbums = libraryMode === "artist" && libraryGroup !== null;
  const grouped = libraryMode !== "track" && (libraryGroup === null || (artistAlbums && artistAlbum === null));
  const groupMode = artistAlbums ? "album" : libraryMode;
  const groupName = (value, mode) => value || (mode === "artist" ? "Unknown artist" : "Unknown album");
  if (groupMode === "album" && artistAlbums && groupSort.album.key === "artist") groupSort.album = { key: "name", direction: "ascending" };
  const groups = grouped ? sortLibraryGroups(groupLibraryTracks(filtered, groupMode), groupMode, groupSort[groupMode].key, groupSort[groupMode].direction) : [];
  elements["library-title"].textContent = libraryMode === "track" ? "Tracks"
    : artistAlbums ? `${groupName(libraryGroup, "artist")} · ${artistAlbum === null ? "Albums" : groupName(artistAlbum, "album")}`
    : grouped ? (libraryMode === "artist" ? "Artists" : "Albums") : groupName(libraryGroup, libraryMode);
  elements["heading-count"].textContent = (grouped ? groups.length : filtered.length).toLocaleString();
  elements["tracks-table"].classList.toggle("hidden", grouped);
  elements["groups-table"].classList.toggle("hidden", !grouped);
  const albumsPage = groupMode === "album" && !artistAlbums;
  elements["group-artist-col"].classList.toggle("hidden", !albumsPage);
  elements["group-artist-heading"].classList.toggle("hidden", !albumsPage);
  elements["group-albums-col"].classList.toggle("hidden", groupMode !== "artist");
  elements["group-albums-heading"].classList.toggle("hidden", groupMode !== "artist");
  elements["group-year-col"].classList.toggle("hidden", groupMode !== "album");
  elements["group-year-heading"].classList.toggle("hidden", groupMode !== "album");
  elements["group-name-heading"].textContent = groupMode === "artist" ? "Artist" : "Album";
  for (const sortButton of [...sortButtons, ...groupSortButtons]) {
    const isGroup = "groupSort" in sortButton.dataset;
    const key = isGroup ? groupSort[groupMode]?.key : sortKey;
    const direction = isGroup ? groupSort[groupMode]?.direction : sortDirection;
    const active = (isGroup ? sortButton.dataset.groupSort : sortButton.dataset.sort) === key;
    const heading = sortButton.closest("th");
    if (active) heading.setAttribute("aria-sort", direction);
    else heading.removeAttribute("aria-sort");
    const indicator = sortButton.querySelector("[data-sort-indicator]");
    indicator.textContent = active ? (direction === "ascending" ? "↑" : "↓") : "↕";
    indicator.classList.toggle("opacity-50", !active);
    indicator.classList.toggle("font-bold", active);
    indicator.classList.toggle("text-[#284f48]", active);
  }
  elements["total-duration"].textContent = formatTotal(tracks);
  elements["folder-name"].textContent = library?.folderName || "Not connected";
  elements["folder-name"].title = library?.folderName || "No folder selected";
  elements["folder-status"].textContent = !library ? "Choose a folder to get started" : permission === "granted" ? "Connected on this device" : "Permission needed to play or rescan";
  const folderLabel = library ? "Change folder" : "Choose folder";
  elements["choose-folder"].setAttribute("aria-label", folderLabel);
  elements["choose-folder"].title = folderLabel;
  elements.reconnect.classList.toggle("hidden", !library || permission === "granted");
  elements.reconnect.classList.toggle("flex", !!library && permission !== "granted");
  elements.reconnect.disabled = busy;
  elements["choose-folder"].disabled = busy || !("showDirectoryPicker" in window);
  elements.rescan.disabled = busy || !library || permission !== "granted";
  elements["group-rows"].replaceChildren();
  elements["track-rows"].replaceChildren();
  if (grouped) {
    for (const group of groups) {
      const row = document.createElement("tr");
      row.className = "cursor-pointer border-b border-[#e7ecec] hover:bg-[#f7faf9] last:border-b-0";
      const name = groupName(group.key, groupMode);
      const open = () => {
        if (artistAlbums) artistAlbum = group.key;
        else libraryGroup = group.key;
        elements.search.value = "";
        render();
        elements["library-heading"].focus();
      };
      row.addEventListener("click", event => {
        if (!event.target.closest("button")) open();
      });
      const nameCell = document.createElement("td");
      nameCell.className = "px-3 py-3";
      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "block max-w-full truncate text-left font-medium text-[#263940]";
      nameButton.textContent = name;
      nameButton.title = name;
      nameButton.addEventListener("click", open);
      nameCell.append(nameButton);
      row.append(nameCell);
      if (albumsPage) {
        const artistLabel = groupArtistLabel(group);
        row.append(trackCell(artistLabel, "text-[#5d7079]"));
      }
      if (groupMode === "artist") row.append(trackCell(group.albums.size.toLocaleString(), "text-right tabular-nums text-[#5d7079]"));
      if (groupMode === "album") row.append(trackCell(group.year === null ? "—" : String(group.year), "text-right tabular-nums text-[#5d7079]"));
      row.append(
        trackCell(group.tracks.length.toLocaleString(), "text-right tabular-nums text-[#5d7079]"),
        trackCell(formatTotal(group.tracks), "text-right tabular-nums text-[#5d7079]")
      );
      const paths = group.tracks.map(track => track.path);
      const missing = paths.filter(path => !playlistPaths().includes(path));
      const addGroup = () => missing.length ? updatePlaylist([...playlistPaths(), ...missing]) : Promise.resolve(true);
      const actions = document.createElement("div");
      actions.className = "flex justify-end gap-1";
      actions.append(
        button("play", `Play ${groupMode}: ${name}`, async () => {
          if (await addGroup()) await playTrack(paths[0]);
        }, busy, true),
        button(missing.length ? "add" : "added", `${missing.length ? "Add to playlist" : "Added to playlist"}: ${name}`, addGroup, busy || !missing.length, true)
      );
      const actionCell = document.createElement("td");
      actionCell.className = "px-3 py-1";
      actionCell.append(actions);
      row.append(actionCell);
      elements["group-rows"].append(row);
    }
  } else filtered.forEach(track => {
    const row = document.createElement("tr");
    row.className = "border-b border-[#e7ecec] hover:bg-[#f7faf9] last:border-b-0";
    const added = playlistPaths().includes(track.path);
    const actions = document.createElement("div");
    actions.className = "flex justify-end gap-1";
    actions.append(
      button("play", `Play from library: ${track.title} (${track.path})`, async () => {
        if (added || await updatePlaylist([...playlistPaths(), track.path])) await playTrack(track.path);
      }, busy, true),
      button(added ? "added" : "add", `${added ? "Added to playlist" : "Add to playlist"}: ${track.title} (${track.path})`, () => updatePlaylist([...playlistPaths(), track.path]), busy || added, true)
    );
    const actionCell = document.createElement("td");
    actionCell.className = "px-3 py-1";
    actionCell.append(actions);
    row.append(
      trackCell(Number.isSafeInteger(track.trackNumber) && track.trackNumber > 0 ? String(track.trackNumber) : "—", "tabular-nums text-[#5d7079]"),
      trackCell(track.title, "font-medium text-[#263940]"),
      trackCell(track.artist || "Unknown artist", "text-[#5d7079]"),
      trackCell(track.album || "Unknown album", "text-[#5d7079]"),
      trackCell(formatDuration(track.duration), "text-right tabular-nums text-[#5d7079]"),
      actionCell
    );
    elements["track-rows"].append(row);
  });
  elements.empty.classList.toggle("hidden", filtered.length > 0);
  elements["empty-title"].textContent = query ? "No tracks found" : library ? "No MP3 files found" : "No folder selected";
  elements["empty-description"].textContent = query ? "Try a different search term." : library ? "Add MP3 files to your folder and rescan to see them here." : "Choose a folder to index your MP3 files. Files are not uploaded.";
  const paths = playlistPaths();
  elements["playlist-count"].textContent = paths.length.toLocaleString();
  elements["playlist-nav-count"].textContent = savedPlaylists.length.toLocaleString();
  const selected = savedPlaylists.find(saved => saved.id === selectedPlaylistId);
  elements["saved-title"].textContent = selected ? selected.name : "Playlists";
  elements["saved-count"].textContent = (selected ? selected.tracks.length : savedPlaylists.length).toLocaleString();
  elements["saved-description"].textContent = selected
    ? `${formatTotal(selected.tracks)} · ${selected.folderName}`
    : "Saved playlists on this device";
  elements["saved-empty"].textContent = selected ? "This playlist has no tracks." : "Save the current playlist to see it here.";
  elements["saved-empty"].classList.toggle("hidden", selected ? selected.tracks.length > 0 : savedPlaylists.length > 0);
  elements["saved-actions"].replaceChildren();
  elements["saved-playlists"].replaceChildren();
  if (selected) {
    elements["saved-actions"].append(
      button("load", `Load playlist: ${selected.name}`, () => loadPlaylist(selected), busy),
      button("clear", `Delete playlist: ${selected.name}`, () => removeSavedPlaylist(selected), busy)
    );
    selected.tracks.forEach((track, index) => {
      const currentTrack = selectedPlaylistMatchesLibrary ? trackFor(track.path) : null;
      const trackTitle = track.title || currentTrack?.title;
      const row = document.createElement("div");
      row.className = "flex items-start gap-3 border-b border-[#e7ecec] px-4 py-3 last:border-b-0 sm:px-6";
      const number = document.createElement("span");
      number.className = "w-6 shrink-0 tabular-nums text-[#687c82]";
      number.textContent = String(index + 1);
      const details = document.createElement("div");
      details.className = "min-w-0 flex-1";
      const title = document.createElement("p");
      title.className = "break-words font-medium text-[#263940]";
      title.textContent = trackTitle || track.path;
      const meta = document.createElement("p");
      meta.className = "mt-0.5 break-words text-[#5d7079]";
      meta.textContent = [track.artist || currentTrack?.artist, formatDuration(track.duration), trackTitle ? track.path : ""].filter(Boolean).join(" · ");
      details.append(title, meta);
      row.append(number, details);
      elements["saved-playlists"].append(row);
    });
  } else for (const saved of [...savedPlaylists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3 border-b border-[#e7ecec] px-4 py-4 last:border-b-0 sm:px-6";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "min-w-0 flex-1 rounded text-left hover:bg-[#f7faf9]";
    details.addEventListener("click", () => selectPlaylist(saved));
    const title = document.createElement("span");
    title.className = "block break-words text-base font-semibold text-[#263940]";
    title.textContent = saved.name;
    const meta = document.createElement("span");
    meta.className = "mt-1 block break-words text-base text-[#5d7079]";
    const trackCount = saved.tracks.length;
    meta.textContent = `${trackCount.toLocaleString()} ${trackCount === 1 ? "track" : "tracks"} · ${formatTotal(saved.tracks)} · ${saved.folderName}`;
    details.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 gap-1";
    actions.append(
      button("load", `Load playlist: ${saved.name}`, () => loadPlaylist(saved), busy),
      button("clear", `Delete playlist: ${saved.name}`, () => removeSavedPlaylist(saved), busy)
    );
    row.append(details, actions);
    elements["saved-playlists"].append(row);
  }
  elements["playlist-duration"].textContent = formatTotal(paths.map(path => trackFor(path) || { duration: null }));
  elements["playlist-empty"].classList.toggle("hidden", paths.length > 0);
  elements["clear-playlist"].disabled = busy || !paths.length;
  elements["save-playlist"].disabled = busy || !paths.length;
  elements["save-submit"].disabled = busy || !paths.length;
  elements["playlist-name"].disabled = busy;
  elements["save-cancel"].disabled = busy;
  elements.playlist.replaceChildren();
  paths.forEach((path, index) => {
    const track = trackFor(path);
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 border-b border-[#e7ecec] px-4 py-3 last:border-b-0";
    row.dataset.path = path;
    const number = document.createElement("span");
    number.className = "w-6 shrink-0 text-base tabular-nums text-[#687c82]";
    number.textContent = String(index + 1);
    const details = document.createElement("div");
    details.className = "min-w-0 flex-1";
    const title = document.createElement("p");
    title.className = "truncate text-base font-semibold text-[#263940]";
    title.textContent = track?.title || path;
    title.title = path;
    const meta = document.createElement("p");
    meta.className = "mt-0.5 truncate text-base text-[#5d7079]";
    meta.textContent = track ? `${track.artist || "Unknown artist"} · ${formatDuration(track.duration)}` : "Not found in library";
    details.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 gap-1";
    actions.append(
      button("play", `Play ${track?.title || path} (${path})`, () => playTrack(path), busy || !track),
      button("remove", `Remove ${track?.title || path} (${path}) from playlist`, () => updatePlaylist(paths.filter((_, i) => i !== index)), busy));
    row.append(number, details, actions);
    elements.playlist.append(row);
  });
  renderPlayback();
}

async function refreshSelectedPlaylistMatch() {
  const saved = savedPlaylists.find(item => item.id === selectedPlaylistId);
  const currentLibrary = library;
  selectedPlaylistMatchesLibrary = false;
  if (!saved || !currentLibrary) return;
  try {
    const matches = await playlistMatchesLibrary(saved, currentLibrary);
    if (selectedPlaylistId === saved.id && library === currentLibrary) {
      selectedPlaylistMatchesLibrary = matches;
      render();
    }
  } catch (error) {
    console.error("Could not compare playlist folder:", error);
    notice("Couldn't check the saved playlist's folder. Saved file paths are shown instead.", true);
  }
}

function selectPlaylist(saved) {
  currentView = "playlists";
  selectedPlaylistId = saved.id;
  selectedPlaylistMatchesLibrary = false;
  render();
  refreshSelectedPlaylistMatch();
}

async function saveNamedPlaylist() {
  if (busy) return;
  const name = elements["playlist-name"].value.trim();
  if (!name) {
    notice("Enter a playlist name.", true);
    elements["playlist-name"].focus();
    return;
  }
  const existing = savedPlaylists.find(saved => saved.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing && !window.confirm(`Replace the saved playlist "${existing.name}" from "${existing.folderName}"?`)) return;
  busy = true;
  render();
  try {
    const saved = createSavedPlaylist(name, library, existing);
    await saveSavedPlaylist(saved);
    savedPlaylists = [...savedPlaylists.filter(item => item.id !== saved.id), saved];
    await refreshSelectedPlaylistMatch();
    elements["save-form"].classList.add("hidden");
    elements["playlist-name"].value = "";
    notice(`Saved playlist "${saved.name}".`);
  } catch (error) {
    console.error("Could not save named playlist:", error);
    notice("Couldn't save the playlist. Your saved playlists were not changed.", true);
  } finally {
    busy = false;
    render();
  }
  if (elements["save-form"].classList.contains("hidden")) elements["save-playlist"].focus();
}

async function loadPlaylist(saved) {
  if (busy) return;
  busy = true;
  render();
  let matches;
  try {
    matches = await playlistMatchesLibrary(saved, library);
  } catch (error) {
    console.error("Could not compare playlist folder:", error);
    notice("Couldn't check the saved playlist's folder. Choose its music folder and try again.", true);
  } finally {
    busy = false;
    render();
  }
  if (matches === undefined) return;
  if (!matches) {
    notice(`Choose the folder "${saved.folderName}" before loading this playlist.`, true);
    return;
  }
  if (await updatePlaylist(saved.tracks.map(track => track.path))) {
    notice(`Loaded playlist "${saved.name}".`);
  }
}

async function removeSavedPlaylist(saved) {
  if (busy || !window.confirm(`Delete the saved playlist "${saved.name}"?`)) return;
  busy = true;
  render();
  try {
    await deleteSavedPlaylist(saved.id);
    savedPlaylists = savedPlaylists.filter(item => item.id !== saved.id);
    if (selectedPlaylistId === saved.id) selectedPlaylistId = null;
    notice(`Deleted playlist "${saved.name}".`);
  } catch (error) {
    console.error("Could not delete saved playlist:", error);
    notice("Couldn't delete the playlist. Your saved playlists were not changed.", true);
  } finally {
    busy = false;
    render();
  }
}

async function updatePlaylist(paths) {
  if (!library || busy) return false;
  busy = true;
  render();
  try {
    const next = { ...library, playlist: paths };
    await saveLibrary(next);
    library = next;
    if ((player.path && !paths.includes(player.path)) || (player.pendingPath && !paths.includes(player.pendingPath))) player.stop();
    return true;
  } catch (error) {
    console.error("Could not save playlist:", error);
    notice("Couldn't save the playlist. Your previous playlist was kept.", true);
    return false;
  } finally {
    busy = false;
    render();
  }
}

async function playTrack(path) {
  if (!library || !trackFor(path)) {
    notice("This playlist track is not in the library. Rescan or remove it.", true);
    return;
  }
  if (permission !== "granted") {
    notice("Reconnect the music folder before playing tracks.", true);
    return;
  }
  try {
    await player.play(library.handle, path);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Playback failed:", error);
    try {
      permission = await library.handle.queryPermission({ mode: "read" });
    } catch (permissionError) {
      console.error("Could not check folder permission:", permissionError);
      permission = "prompt";
    }
    notice(permission === "granted" ? "Couldn't play this file. It may have been moved, removed, or be unsupported. Try rescanning." : "Folder access expired. Reconnect the folder to play tracks.", true);
    render();
  }
}

function advance(direction) {
  const paths = playlistPaths();
  const index = paths.indexOf(player.path);
  const next = paths[index + direction];
  if (index >= 0 && next) {
    if (trackFor(next)) playTrack(next);
    else notice("The next playlist track is not in the library. Rescan or remove it.", true);
  }
}

async function runScan(handle) {
  busy = true;
  render();
  notice("Scanning your folder…");
  try {
    const { tracks, warnings } = await scanLibrary(handle, readMetadata, count => notice(`Scanning your folder… ${count.toLocaleString()} tracks indexed`));
    const sameFolder = library && await library.handle.isSameEntry(handle);
    const next = { handle, folderName: handle.name, tracks, scannedAt: Date.now(), playlist: sameFolder ? playlistPaths() : [] };
    await saveLibrary(next);
    if (!sameFolder) {
      player.stop();
      libraryGroup = null;
      artistAlbum = null;
    }
    library = next;
    permission = "granted";
    await refreshSelectedPlaylistMatch();
    const trackCount = tracks.length.toLocaleString();
    const warningCount = warnings.length.toLocaleString();
    notice(`Library updated: ${trackCount} ${tracks.length === 1 ? "track" : "tracks"}.${warnings.length ? ` ${warningCount} ${warnings.length === 1 ? "track has" : "tracks have"} unreadable information:` : ""}`, warnings.length > 0, warnings);
  } catch (error) {
    console.error("Library scan failed:", error);
    if (library) {
      try {
        permission = await library.handle.queryPermission({ mode: "read" });
      } catch (permissionError) {
        console.error("Could not check folder permission:", permissionError);
        permission = "prompt";
      }
    }
    notice("Couldn't finish the scan or save the index. Your previous library was kept. Check folder access and try again.", true);
  } finally {
    busy = false;
    render();
  }
}

elements["dismiss-notice"].addEventListener("click", () => {
  elements.notice.classList.add("hidden");
  elements.notice.classList.remove("flex");
});
elements["choose-folder"].addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await runScan(handle);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Folder selection failed:", error);
      notice("Couldn't open that folder. Check browser permissions and try again.", true);
    }
  }
});

elements.reconnect.addEventListener("click", async () => {
  try {
    permission = await library.handle.requestPermission({ mode: "read" });
    render();
    if (permission === "granted") notice("Folder reconnected. You can play tracks or rescan your library.");
    else notice("Folder access was not granted. Reconnect or choose the folder again to play or rescan.", true);
  } catch (error) {
    console.error("Folder reconnection failed:", error);
    notice("Couldn't reconnect this folder. Choose the folder again to restore access.", true);
  }
});
elements.rescan.addEventListener("click", () => runScan(library.handle));
elements.search.addEventListener("input", render);
for (const sortButton of sortButtons) {
  sortButton.addEventListener("click", () => {
    const key = sortButton.dataset.sort;
    sortDirection = key === sortKey && sortDirection === "ascending" ? "descending" : "ascending";
    sortKey = key;
    render();
  });
}
for (const sortButton of groupSortButtons) {
  sortButton.addEventListener("click", () => {
    const mode = libraryMode === "artist" && libraryGroup === null ? "artist" : "album";
    const state = groupSort[mode];
    const key = sortButton.dataset.groupSort;
    state.direction = key === state.key && state.direction === "ascending" ? "descending" : "ascending";
    state.key = key;
    render();
  });
}
function browseLibrary(mode) {
  currentView = "library";
  libraryMode = mode;
  libraryGroup = null;
  artistAlbum = null;
  elements.search.value = "";
  render();
}
elements["nav-library"].addEventListener("click", () => browseLibrary("track"));
for (const mode of ["artist", "album", "track"]) {
  elements[`nav-${mode}`].addEventListener("click", () => browseLibrary(mode));
}
elements["nav-playlists"].addEventListener("click", () => { currentView = "playlists"; selectedPlaylistId = null; render(); });
elements["save-playlist"].addEventListener("click", () => {
  elements["save-form"].classList.remove("hidden");
  elements["playlist-name"].focus();
});
elements["save-cancel"].addEventListener("click", () => {
  elements["save-form"].classList.add("hidden");
  elements["playlist-name"].value = "";
  elements["save-playlist"].focus();
});
elements["save-form"].addEventListener("submit", event => {
  event.preventDefault();
  saveNamedPlaylist();
});
elements["clear-playlist"].addEventListener("click", () => updatePlaylist([]));
elements.previous.addEventListener("click", () => advance(-1));
elements.next.addEventListener("click", () => advance(1));
elements["play-pause"].addEventListener("click", async () => {
  if (!player.path) {
    if (playlistPaths().length) await playTrack(playlistPaths()[0]);
  } else if (player.audio.paused) {
    try {
      await player.audio.play();
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Playback failed:", error);
        notice("Couldn't resume playback. Try playing the track again.", true);
      }
    }
  } else {
    player.audio.pause();
  }
});
elements.seek.addEventListener("input", () => { player.audio.currentTime = Number(elements.seek.value); });

async function init() {
  render();
  if (!("showDirectoryPicker" in window)) {
    notice("Folder access requires a modern Chromium browser and a secure context (HTTPS or localhost).", true);
  }
  try {
    const [storedLibrary, storedPlaylists] = await Promise.all([loadLibrary(), loadSavedPlaylists()]);
    library = storedLibrary || null;
    savedPlaylists = storedPlaylists;
    if (library) {
      try {
        permission = await library.handle.queryPermission({ mode: "read" });
      } catch (error) {
        console.error("Could not check folder permission:", error);
        notice("The saved folder is unavailable. Choose the folder again to restore access.", true);
      }
    }
  } catch (error) {
    console.error("Could not load library:", error);
    notice("Couldn't open local storage. Check your browser's storage settings and reload.", true);
    elements["choose-folder"].disabled = true;
    return;
  }
  busy = false;
  render();
}

init();
