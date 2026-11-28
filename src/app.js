import { findAudioFiles, findFolderImage, findSibling, findSiblingFile, getTrackFile, getTrackFileHandle, isAudioFile, listContents, scanLibrary } from "./filesystem.js";
import { readLyrics, readMetadata, readTags } from "./metadata.js";
import { readCover, readFields, tagLength, TagWriteError, writeTags } from "./id3.js";
import { describeMedia, formatBytes, mediaInfoText } from "./mediainfo.js";
import { Covers } from "./covers.js";
import { activeLyricIndex, decodeText, formatOffset, isLyricsFile, LYRICS_FORMATS, lyricsFormat, parseLyrics, roundOffset } from "./lyrics.js";
import { loadLibrary, saveLibrary, deleteLibrary, loadSavedPlaylists, saveSavedPlaylist, deleteSavedPlaylist } from "./storage.js";
import { Playback } from "./playback.js";
import { buildYearTimeline } from "./analysis.js";
import { Visualizer } from "./visualizer.js";
import { parseRecording, RecordingFileError, serializeRecording } from "./recording.js";
import { initTooltips } from "./tooltips.js";
import { currentPreference, initTheme, setPreference } from "./theme.js";
import { createImportedPlaylist, createSavedPlaylist, generatePlaylistPaths, migrateSavedPlaylist, uniquePlaylistName, parsePlaylists, PlaylistFileError, resolvePlaylist, serializePlaylists } from "./playlists.js";
import { migrateLibrary, relativePath, splitKey, withoutSource, withSourceTracks } from "./sources.js";
import { filterLibraryTracks, groupArtistLabel, groupKey, groupLibraryTracks, sortLibraryGroups, sortLibraryTracks } from "./library.js";

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(["choose-folder", "reconnect", "rescan", "reset-library", "sources-list", "sources-empty", "sources-footer", "sources-toggle", "sources-body", "sources-count", "sources-header", "source-filter", "source-filter-label", "source-filter-menu", "search", "track-count", "artist-nav-count", "album-nav-count", "track-nav-count", "library-heading", "library-title", "tracks-table", "track-rows", "groups-table", "group-rows", "group-albums-col", "group-albums-heading", "group-artist-col", "group-artist-heading", "group-year-col", "group-year-heading", "group-name-heading", "track-artist-col", "track-artist-heading", "track-album-col", "track-album-heading", "library-meta", "notice", "notice-content", "notice-progress", "dismiss-notice", "empty", "empty-title", "empty-description", "nav-library", "nav-artist", "nav-album", "nav-track", "nav-playlists", "nav-analysis", "nav-visualizer", "visualizer-view", "visualizer-empty", "nav-lyrics", "lyrics-view", "lyrics-meta", "lyrics-format", "lyrics-offset", "lyrics-earlier", "lyrics-later", "lyrics-offset-value", "lyrics-lines", "lyrics-empty", "analysis-view", "analysis-heading", "analysis-title", "analysis-meta", "analysis-albums", "analysis-tracks", "analysis-empty", "analysis-body", "analysis-chart", "analysis-detail", "playlist-nav-items", "library-view", "playlists-view", "saved-title", "saved-playlists-heading", "saved-meta", "saved-actions", "import-file", "rename-form", "rename-input", "rename-submit", "rename-cancel", "saved-playlists", "saved-empty", "playlist", "playlist-drop", "playlist-stats-tabs", "playlist-count", "playlist-nav-count", "playlist-duration", "playlist-empty", "save-playlist", "save-form", "playlist-name", "save-submit", "save-cancel", "generate-playlist", "generate-form", "generate-field", "generate-minutes", "generate-toggle", "generate-options", "generate-submit", "generate-cancel", "clear-playlist", "context-menu", "context-info", "context-tags", "context-remove", "context-reload", "context-install", "now-playing", "now-artist", "previous", "play-pause", "stop", "next", "elapsed", "seek", "playback-duration", "speed", "speed-label", "speed-menu", "gap", "gap-label", "gap-menu", "mute", "volume", "volume-value", "cut-zone", "cut-handle", "now-cover", "library-cover", "library-header-rows", "library-header-top", "library-header-controls", "library-header-static", "album-grid", "album-view-controls", "album-sort-controls", "album-sort", "album-sort-direction"].map(id => [id, $(id)]));
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
let currentAlbumView = null;
let sortBeforeAlbum = null;
// Sort per grouped list: all artists, all albums, and one artist's albums (chronological by default, like a discography).
const groupSortDefaults = { artist: "name", album: "name", artistAlbum: "year" };
const groupSort = Object.fromEntries(Object.entries(groupSortDefaults).map(([slot, key]) => [slot, { key, direction: "ascending" }]));
// Album lists as a table ("list") or cover cards ("grid"), remembered per browser.
let albumView = "list";
try { if (localStorage.getItem("albumView") === "grid") albumView = "grid"; } catch {}
let selectedPlaylistId = null;
let renamingId = null;
let analysisMetric = "albums";
let analysisYear = null;
const analysisSort = { albums: { column: 0, direction: "ascending" }, tracks: { column: null, direction: "ascending" } };
// Current library keys of the selected saved playlist's tracks (null until resolved), see resolvePlaylist.
let selectedPlaylistPaths = null;
// Read permission per source id: "granted", "prompt" or "denied".
const permissions = new Map();
let busy = true;
const player = new Playback({
  onChange: renderPlayback,
  onEnded: () => finishTrack(),
  onError: error => {
    // Saving tags rewrites the playing file; the player reloads it right after.
    if (tagSavingPath && tagSavingPath === player.path) return;
    console.error("Playback failed:", error);
    notice("Couldn't play this file. It may be missing, unreadable, or unsupported.", true);
  }
});
const visualizer = new Visualizer(player.audio, $("visualizer-canvas"), $("visualizer-stage"));

const NOTICE_DURATION = 5000;
const ERROR_NOTICE_DURATION = NOTICE_DURATION * 10;
let noticeTimer = 0;

// Notices slide in and fade out (instantly with reduced motion).
let noticeLeaving = null;
const noticeMotion = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;

function hideNotice() {
  clearTimeout(noticeTimer);
  const element = elements.notice;
  if (element.classList.contains("hidden") || noticeLeaving) return;
  const done = () => {
    noticeLeaving = null;
    element.classList.add("hidden");
    element.classList.remove("flex");
  };
  if (!noticeMotion()) return done();
  noticeLeaving = element.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 -6px" }], { duration: 160, easing: "ease-in" });
  noticeLeaving.onfinish = done;
}

// Notices dismiss themselves, errors after a longer time; in-progress messages stay.
function notice(message, error = false, warnings = [], { sticky = false } = {}) {
  clearTimeout(noticeTimer);
  const element = elements.notice;
  // Arriving fresh slides in; replacing a notice on screen just swaps its text.
  const arriving = element.classList.contains("hidden") || !!noticeLeaving;
  noticeLeaving?.cancel();
  noticeLeaving = null;
  const content = elements["notice-content"];
  content.textContent = message;
  element.className = `fixed right-4 top-4 z-40 flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3 overflow-hidden rounded-lg border px-4 py-3 text-base shadow-lg sm:right-6 lg:right-8 ${error ? "border-bd-danger bg-danger-soft text-danger" : "border-bd-ok bg-ok-soft text-forest"}`;
  const bar = elements["notice-progress"];
  bar.classList.toggle("hidden", sticky);
  if (!sticky) {
    const duration = error ? ERROR_NOTICE_DURATION : NOTICE_DURATION;
    bar.classList.toggle("bg-danger/40", error);
    bar.classList.toggle("bg-primary/50", !error);
    bar.style.transition = "none";
    bar.style.width = "100%";
    bar.getBoundingClientRect();
    bar.style.transition = `width ${duration}ms linear`;
    bar.style.width = "0%";
    noticeTimer = setTimeout(hideNotice, duration);
  }
  if (warnings.length) {
    const list = document.createElement("ul");
    list.className = "mt-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger";
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
  if (arriving && noticeMotion()) element.animate([{ opacity: 0, translate: "0 -8px" }, { opacity: 1, translate: "0 0" }], { duration: 200, easing: "ease-out" });
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

const permissionOf = source => permissions.get(source?.id) ?? "prompt";
const sourceOf = path => (path && library?.sources.find(source => source.id === splitKey(path).sourceId)) || null;
const sourcesNeedingAccess = () => (library?.sources || []).filter(source => permissionOf(source) !== "granted");
const quoteNames = names => names.map(name => `"${name}"`).join(", ");
// What a source contains, e.g. "Rock, Jazz, cover.jpg…" ("" if not known yet).
// (Folders listed by an earlier version end in "/", which is dropped.)
const contentsText = source => source.contents?.names.length ? `${source.contents.names.map(name => name.replace(/\/$/, "")).join(", ")}${source.contents.more ? "…" : ""}` : "";
// Whether another source has the same name, so the contents are needed to tell them apart.
const nameClashes = source => (library?.sources || []).some(other => other.id !== source.id && other.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());

// Chrome can leave folder-handle calls (queryPermission, requestPermission, isSameEntry) pending
// for a site whose stored permissions it has wedged (seen after a restart, on GitHub Pages).
const PERMISSION_TIMEOUT = 3000;
const withTimeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
]);
const STUCK_ACCESS_HELP = "Chrome isn't answering folder-access requests for this site. Click the lock icon in the address bar → Site settings → Reset permissions, then reload. Or add the folder again with the folder button.";

async function checkPermission(source) {
  let state = "prompt";
  try {
    state = await withTimeout(source.handle.queryPermission({ mode: "read" }), PERMISSION_TIMEOUT, "Timed out checking folder access.");
  } catch (error) {
    console.error(`Could not check access to "${source.name}":`, error);
  }
  permissions.set(source.id, state);
  return state;
}

async function droppedFile(entry, { ask = false } = {}) {
  if (!entry.file) {
    // Access was granted by the drop; after a reload it's per dropped folder (or file) and may need asking again.
    const scope = entry.directory || entry.handle;
    if (ask && scope.queryPermission && await scope.queryPermission({ mode: "read" }) !== "granted") await scope.requestPermission({ mode: "read" });
    entry.file = await entry.handle.getFile();
  }
  return entry.file;
}

async function trackFile(path) {
  if (dropped.has(path)) return droppedFile(dropped.get(path));
  const source = sourceOf(path);
  if (!source) throw new Error("The track's folder is not in the library.");
  return getTrackFile(source.handle, relativePath(path));
}

// Music dropped on the current playlist plays straight from the dropped files and is never added to the library or
// saved: it lives in memory under "drop:<n>/<path>" keys and is forgotten on reload or once it leaves the playlist.
const dropped = new Map();
const isDropped = path => !!path && path.startsWith("drop:");
// The current playlist when there is no library yet (only dropped music); kept in memory, with the saved playlist it
// was loaded from.
let unsavedPlaylist = [];
let unsavedLoadedId = null;
const loadedPlaylistId = () => (library ? library.loadedPlaylistId : unsavedLoadedId) ?? null;

// Direct-play playlists are created when music is dropped on an empty current playlist. They are saved like any
// playlist, holding the dropped files' handles so they can be played again after a reload (with the browser's consent).
const isDirectPlaylist = saved => saved?.instant === true;

// Makes a direct-play playlist's tracks playable in this session.
function registerDirectTracks(saved) {
  for (const track of saved.tracks) {
    if (!isDropped(track.path) || dropped.has(track.path) || !track.handle) continue;
    const { handle, directory, relative, ...info } = track;
    // Labelled as when it was dropped: the folder's name and the path in it, or the file's name.
    const label = directory ? `${directory.name}/${relative}` : relative;
    dropped.set(track.path, { handle, directory, relative, label, track: { ...info } });
  }
}

// A saved-playlist entry for a track in the current playlist (dropped music keeps its file handles).
function trackSnapshot(path) {
  const track = trackFor(path);
  const info = { path, title: track?.title || "", artist: track?.artist || "", album: track?.album || "", year: track?.year ?? null, trackNumber: track?.trackNumber ?? null, duration: track?.duration ?? null };
  const drop = dropped.get(path);
  return drop ? { ...info, handle: drop.handle ?? null, directory: drop.directory ?? null, relative: drop.relative } : info;
}

// Appends tracks to a saved playlist, recording the library folders they come from so it can find them again.
async function appendToSavedPlaylist(saved, paths) {
  const known = new Set(saved.sources.map(source => source.id));
  const sources = [...saved.sources];
  for (const path of paths) {
    const source = sourceOf(path);
    if (source && !known.has(source.id)) {
      known.add(source.id);
      sources.push({ id: source.id, handle: source.handle, name: source.name });
    }
  }
  const updated = { ...saved, sources, tracks: [...saved.tracks, ...paths.map(trackSnapshot)] };
  await saveSavedPlaylist(updated);
  savedPlaylists = savedPlaylists.map(item => item.id === saved.id ? updated : item);
  return updated;
}

function playlistPaths() {
  return library ? library.playlist : unsavedPlaylist;
}

function trackFor(path) {
  return library?.tracks.find(track => track.path === path) || dropped.get(path)?.track;
}

function albumText(track) {
  return `${track.album || "Unknown album"}${Number.isFinite(track.year) ? ` (${track.year})` : ""}`;
}

function renderCrumbs(container, crumbs) {
  container.replaceChildren();
  crumbs.forEach((crumb, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.setAttribute("aria-hidden", "true");
      separator.className = "shrink-0 font-normal";
      separator.textContent = ">";
      container.append(separator);
    }
    const link = document.createElement("button");
    link.type = "button";
    // Long names are cut short where the heading doesn't wrap, given in full on hover only then.
    link.className = "min-w-0 truncate font-medium text-deep-2 hover:text-deep hover:underline";
    if (index === crumbs.length - 1) link.setAttribute("aria-current", "page");
    link.textContent = crumb.label;
    link.addEventListener("pointerover", () => { link.title = link.scrollWidth > link.clientWidth ? crumb.label : ""; });
    link.addEventListener("click", crumb.action);
    container.append(link);
  });
}

function renderMeta(container, items) {
  container.replaceChildren(...items.map(text => {
    const chip = document.createElement("span");
    chip.className = "rounded-md bg-accent-soft px-2 py-0.5 text-deep";
    chip.textContent = text;
    return chip;
  }));
}

function trackNumberText(number) {
  return Number.isSafeInteger(number) && number > 0 ? `#${number}` : "";
}

function setTitle(element, text, number) {
  element.textContent = text;
  const numberText = trackNumberText(number);
  if (!numberText) return;
  const suffix = document.createElement("span");
  suffix.className = "font-normal text-faint-2";
  suffix.textContent = ` · ${numberText}`;
  element.append(suffix);
}

const TITLE_STEP_MS = 600;
const TITLE_WINDOW = 22;
const TITLE_HOLD_STEPS = 4;
let titleKey = "";
let titleTimer = 0;

// While playing, long names slide back and forth through a fixed-width window in the tab title.
function setPageTitle(text, scroll) {
  const key = `${scroll}|${text}`;
  if (key === titleKey) return;
  titleKey = key;
  clearInterval(titleTimer);
  titleTimer = 0;
  if (!scroll) {
    document.title = text;
    return;
  }
  const overflow = text.length - TITLE_WINDOW;
  if (overflow <= 0) {
    document.title = `▶ ${text}`;
    return;
  }
  const forward = Array.from({ length: overflow + 1 }, (_, offset) => offset);
  const cycle = [
    ...Array(TITLE_HOLD_STEPS).fill(0),
    ...forward,
    ...Array(TITLE_HOLD_STEPS).fill(overflow),
    ...forward.slice(0, -1).reverse()
  ];
  let step = 0;
  const tick = () => {
    const offset = cycle[step++ % cycle.length];
    document.title = `▶ ${text.slice(offset, offset + TITLE_WINDOW)}`;
  };
  tick();
  titleTimer = setInterval(tick, TITLE_STEP_MS);
}

// Cover art (see covers.js). Library tracks keep their thumbnails by path and modification time; dropped music only
// for the session. A track whose folder needs reconnecting is simply tried again later.
const covers = new Covers({
  file: path => {
    const drop = dropped.get(path);
    if (drop) return droppedFile(drop).catch(() => null);
    const source = sourceOf(path);
    return source && permissionOf(source) === "granted" ? trackFile(path) : null;
  },
  folder: path => {
    const drop = dropped.get(path);
    if (drop) return drop.directory ? { directory: drop.directory, path: drop.relative } : null;
    const source = sourceOf(path);
    return source ? { directory: source.handle, path: relativePath(path) } : null;
  },
  key: path => {
    const track = !isDropped(path) && trackFor(path);
    return track ? `${path}@${track.lastModified ?? ""}:${track.size ?? ""}` : null;
  }
});

// Covers in lists load as they come into view (a little before), not all at once.
const coverObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    coverObserver.unobserve(entry.target);
    entry.target.loadCover?.();
  }
}, { rootMargin: "200px" });

// A square cover with a disc standing in until (or unless) there is one. size: Tailwind size classes. load(): the
// cover's URL or null.
function coverTile(size, load, { lazy = true } = {}) {
  const tile = document.createElement("div");
  tile.className = `relative shrink-0 overflow-hidden rounded-md border border-bd bg-subtle text-faint ${size}`;
  tile.innerHTML = '<svg aria-hidden="true" class="absolute inset-0 m-auto h-2/5 w-2/5"><use href="#icon-disc"></use></svg>';
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  image.className = "absolute inset-0 hidden h-full w-full object-cover";
  tile.append(image);
  tile.loadCover = () => load().then(url => {
    if (!url) return;
    image.src = url;
    image.classList.remove("hidden");
  });
  if (lazy) coverObserver.observe(tile);
  else tile.loadCover();
  return tile;
}

// The playing track's cover in the player card, shown once it's known to be for the track still playing.
let nowCoverPath;
function renderNowCover() {
  if (player.path === nowCoverPath) return;
  nowCoverPath = player.path;
  const image = elements["now-cover"];
  image.classList.add("hidden");
  image.removeAttribute("src");
  if (!player.path) return;
  const path = player.path;
  covers.track(path).then(url => {
    if (!url || player.path !== path) return;
    image.src = url;
    image.classList.remove("hidden");
  });
}

function renderPlayback() {
  renderNowCover();
  const track = trackFor(player.path);
  const index = playlistPaths().indexOf(player.path);
  setTitle(elements["now-playing"], player.path ? track?.title || relativePath(player.path) : "Nothing playing", track?.trackNumber);
  const details = track ? [track.artist || "Unknown artist", albumText(track)].join(" · ") : "";
  setPageTitle(track ? `${track.title || relativePath(player.path)} · ${track.artist || "Unknown artist"}` : "Music player", !!track && !player.audio.paused);
  elements["now-artist"].textContent = details;
  elements["now-artist"].title = details;
  elements["visualizer-empty"].classList.toggle("hidden", !!player.path || !!player.pendingPath);
  const playing = player.path && !player.audio.paused;
  const playLabel = playing ? "Pause" : "Play";
  elements["play-pause"].setAttribute("aria-label", playLabel);
  elements["play-pause"].title = playLabel;
  elements["play-pause"].querySelector("use").setAttribute("href", playing ? "#icon-pause" : "#icon-play");
  elements["play-pause"].disabled = !player.path && !playlistPaths().length;
  elements.previous.disabled = index <= 0;
  elements.stop.disabled = !player.path && !player.pendingPath;
  elements.next.disabled = index < 0 || index >= playlistPaths().length - 1;
  const duration = player.audio.duration;
  elements.elapsed.textContent = formatDuration(player.audio.currentTime);
  elements["playback-duration"].textContent = formatDuration(duration);
  elements.seek.disabled = !Number.isFinite(duration) || duration <= 0;
  elements.seek.max = elements.seek.disabled ? "0" : String(duration);
  elements.seek.value = String(player.audio.currentTime || 0);
  for (const row of elements.playlist.children) {
    row.classList.toggle("bg-sel-2", row.dataset.path === player.path);
    row.classList.toggle("hover:bg-subtle", row.dataset.path !== player.path);
  }
  if (player.path !== scrolledPath) scrollToPlayingRow();
  renderPlaylistStats();
  if (currentView === "lyrics") renderLyrics();
}

// Library filter by source: null shows every source, a set shows exactly those (possibly none). Remembered per browser.
let sourceFilter = null;
try {
  const stored = JSON.parse(localStorage.getItem("sourceFilter"));
  // Older versions stored a plain array where empty meant "all".
  if (Array.isArray(stored)) sourceFilter = stored.length ? new Set(stored) : null;
  else if (Array.isArray(stored?.selected)) sourceFilter = new Set(stored.selected);
} catch {}

// The effective selection, or null when everything is shown.
function activeSourceFilter() {
  const ids = new Set((library?.sources || []).map(source => source.id));
  if (!sourceFilter || ids.size < 2) return null;
  const selected = [...sourceFilter].filter(id => ids.has(id));
  // Selecting every source is no filter; a selection whose folders were all removed falls back to everything.
  if (selected.length === ids.size || (!selected.length && sourceFilter.size)) return null;
  return new Set(selected);
}

function inSourceFilter(track) {
  const active = activeSourceFilter();
  return !active || active.has(splitKey(track.path).sourceId);
}

function saveSourceFilter() {
  try { localStorage.setItem("sourceFilter", JSON.stringify(sourceFilter ? { selected: [...sourceFilter] } : null)); } catch {}
}

function renderSourceFilter() {
  const sources = library?.sources || [];
  const button = elements["source-filter"];
  const several = sources.length > 1;
  button.classList.toggle("hidden", !several);
  button.classList.toggle("flex", several);
  // Whichever is first pushes the controls to the right.
  elements.search.classList.toggle("ml-auto", !several);
  if (!several) closeSourceFilter();
  const active = activeSourceFilter();
  const chosen = active ? sources.filter(source => active.has(source.id)) : [];
  elements["source-filter-label"].textContent = !active ? "All sources" : !chosen.length ? "No sources" : chosen.length === 1 ? chosen[0].name : `${chosen.length} sources`;
  button.toggleAttribute("data-filtered", !!active);
  button.setAttribute("aria-label", `Sources: ${!active ? "all" : chosen.map(source => source.name).join(", ") || "none"}`);
  const menu = elements["source-filter-menu"];
  const option = (label, checked, onChange, extraClass = "") => {
    const row = document.createElement("label");
    row.className = `flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-tint ${extraClass}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.className = "h-4 w-4 shrink-0 accent-primary";
    input.addEventListener("change", onChange);
    const text = document.createElement("span");
    text.className = "min-w-0 truncate";
    text.textContent = label;
    text.title = label;
    row.append(input, text);
    return row;
  };
  const focused = menu.contains(document.activeElement) ? [...menu.querySelectorAll("input")].indexOf(document.activeElement) : -1;
  menu.replaceChildren(
    // Toggles between everything and nothing; shown as mixed when only some sources are selected.
    option("All sources", !active, event => {
      sourceFilter = event.target.checked ? null : new Set();
      saveSourceFilter();
      render();
    }, "border-b border-bd-2 font-medium"),
    ...sources.map(source => option(nameClashes(source) && contentsText(source) ? `${source.name} (${contentsText(source)})` : source.name, !active || active.has(source.id), event => {
      const next = new Set(active || sources.map(item => item.id));
      if (event.target.checked) next.add(source.id);
      else next.delete(source.id);
      sourceFilter = next.size < sources.length ? next : null;
      saveSourceFilter();
      render();
    }))
  );
  menu.querySelector("input").indeterminate = !!active && chosen.length > 0;
  // The menu is rebuilt on every render; keep keyboard focus on the same checkbox.
  if (focused >= 0) menu.querySelectorAll("input")[focused]?.focus();
}

function openSourceFilter() {
  const menu = elements["source-filter-menu"];
  const button = elements["source-filter"];
  menu.classList.remove("hidden");
  const bounds = button.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 4))}px`;
  const below = bounds.bottom + 4;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 4 ? Math.max(4, bounds.top - menu.offsetHeight - 4) : below}px`;
  button.setAttribute("aria-expanded", "true");
}

function closeSourceFilter() {
  elements["source-filter-menu"].classList.add("hidden");
  elements["source-filter"].setAttribute("aria-expanded", "false");
}

elements["source-filter"].addEventListener("click", () => {
  if (elements["source-filter-menu"].classList.contains("hidden")) {
    openSourceFilter();
    elements["source-filter-menu"].querySelector("input")?.focus();
  } else closeSourceFilter();
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest("#source-filter, #source-filter-menu")) closeSourceFilter();
});
elements["source-filter-menu"].addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeSourceFilter();
    elements["source-filter"].focus();
  }
});
// Tabbing away closes the menu. (Focus lost to a re-render has no relatedTarget and is restored by renderSourceFilter.)
elements["source-filter-menu"].addEventListener("focusout", event => {
  const next = event.relatedTarget;
  if (next && !event.currentTarget.contains(next) && next !== elements["source-filter"]) closeSourceFilter();
});
window.addEventListener("resize", closeSourceFilter);
document.addEventListener("scroll", event => {
  if (!elements["source-filter-menu"].contains(event.target)) closeSourceFilter();
}, true);

// Sources card: one row per folder with its own reconnect/rescan/remove, plus "all" actions when there are several.
function sourceButton(icon, label, action, { disabled = false, primary = false } = {}) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = label;
  element.className = `flex h-7 w-7 shrink-0 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "border-primary-dark bg-primary text-on-primary hover:bg-primary-dark" : "border-bd-in bg-field text-fg-2 hover:bg-tint-2"}`;
  element.innerHTML = `<svg aria-hidden="true" class="h-4 w-4"><use href="#icon-${icon}"></use></svg>`;
  element.disabled = disabled;
  element.addEventListener("click", action);
  return element;
}

// The card collapses to its header (set-and-forget); the choice is remembered. A count in the header stays visible,
// turning red when a folder needs access.
let sourcesCollapsed = false;
try { sourcesCollapsed = localStorage.getItem("sourcesCollapsed") === "1"; } catch {}
elements["sources-toggle"].addEventListener("click", () => {
  sourcesCollapsed = !sourcesCollapsed;
  try { localStorage.setItem("sourcesCollapsed", sourcesCollapsed ? "1" : "0"); } catch {}
  renderSources();
});

function renderSources() {
  const sources = library?.sources || [];
  const locked = sourcesNeedingAccess().length;
  elements["sources-toggle"].setAttribute("aria-expanded", String(!sourcesCollapsed));
  elements["sources-body"].classList.toggle("hidden", sourcesCollapsed);
  elements["sources-body"].classList.toggle("flex", !sourcesCollapsed);
  // Collapsed with nothing below it, the header is the whole card: it takes the bottom padding and drops its divider.
  const headerOnly = sourcesCollapsed && sources.length > 0;
  for (const name of ["-mb-2", "rounded-b-[11px]"]) elements["sources-header"].classList.toggle(name, headerOnly);
  elements["sources-header"].classList.toggle("border-b", !headerOnly);
  const count = elements["sources-count"];
  count.classList.toggle("hidden", !sources.length);
  count.textContent = locked ? `${locked.toLocaleString()} locked` : sources.length.toLocaleString();
  count.className = `${sources.length ? "" : "hidden "}rounded px-1.5 text-xs font-medium ${locked ? "bg-danger-soft text-danger" : "bg-sel text-fg-2"}`;
  count.title = locked ? `${locked.toLocaleString()} ${locked === 1 ? "folder needs" : "folders need"} access` : `${sources.length.toLocaleString()} ${sources.length === 1 ? "folder" : "folders"}`;
  const counts = new Map();
  for (const track of library?.tracks || []) {
    const id = splitKey(track.path).sourceId;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  elements["sources-list"].replaceChildren(...sources.map(source => {
    const granted = permissionOf(source) === "granted";
    const item = document.createElement("li");
    item.className = "px-1.5 py-1.5";
    const name = document.createElement("div");
    name.className = "truncate text-sm font-medium text-fg";
    name.textContent = source.name;
    const clash = nameClashes(source) && contentsText(source);
    // When the contents are shown under the name, a tooltip would repeat them.
    if (!clash) name.title = contentsText(source) || source.name;
    const footer = document.createElement("div");
    footer.className = "mt-1 flex items-center justify-between gap-2";
    const count = counts.get(source.id) || 0;
    const meta = document.createElement("span");
    meta.className = `min-w-0 truncate text-xs ${granted ? "text-soft" : "text-danger"}`;
    meta.textContent = granted ? `${count.toLocaleString()} ${count === 1 ? "track" : "tracks"}` : "Needs access";
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 gap-1";
    if (!granted) actions.append(sourceButton("reconnect", `Reconnect ${source.name}`, () => reconnectSources([source]), { disabled: busy, primary: true }));
    actions.append(
      sourceButton("rescan", `Rescan ${source.name}`, () => scanSources([source]), { disabled: busy || !granted }),
      sourceButton("remove", `Remove ${source.name}`, () => removeSource(source), { disabled: busy })
    );
    footer.append(meta, actions);
    item.append(name);
    if (clash) {
      const contents = document.createElement("div");
      contents.className = "truncate text-xs text-soft";
      contents.textContent = contentsText(source);
      item.append(contents);
    }
    item.append(footer);
    return item;
  }));
  elements["sources-empty"].classList.toggle("hidden", sources.length > 0);
  const several = sources.length > 1;
  elements["sources-footer"].classList.toggle("hidden", !several);
  elements["sources-footer"].classList.toggle("flex", several);
  const needAccess = sourcesNeedingAccess().length > 0;
  elements.reconnect.classList.toggle("hidden", !needAccess);
  elements.reconnect.classList.toggle("flex", needAccess);
  elements.reconnect.disabled = busy;
  elements.rescan.disabled = busy || sources.every(source => permissionOf(source) !== "granted");
  elements["reset-library"].disabled = busy;
}

// Lyrics of the playing track, read from the file on demand and cached per path.
const lyricsCache = new Map();
let lyricsShown = null;
let lyricsActive = -1;
let lyricsUserScrolledAt = 0;
// Which lyrics file format is looked for next to tracks (see LYRICS_FORMATS).
let lyricsFormatId = lyricsFormat(null).id;
try { lyricsFormatId = lyricsFormat(localStorage.getItem("lyricsFormat")).id; } catch {}

async function loadLyrics(path) {
  const pending = { status: "loading" };
  lyricsCache.set(path, pending);
  // Embedded lyrics win; otherwise a same-named file of the chosen format next to the track is used.
  const format = lyricsFormat(lyricsFormatId);
  let parsed = { synced: false, lines: [] };
  let source = "Embedded";
  let failed = false;
  try {
    parsed = parseLyrics(await readLyrics(await trackFile(path)));
  } catch (error) {
    console.error("Could not read embedded lyrics:", error);
    failed = true;
  }
  if (!parsed.lines.length) {
    try {
      const drop = dropped.get(path);
      const hasExtension = file => file.name.toLowerCase().endsWith(format.extension);
      const sidecar = !drop ? await findSiblingFile(sourceOf(path).handle, relativePath(path), format.extension)
        : drop.directory ? await findSiblingFile(drop.directory, drop.relative, format.extension)
        : drop.lyricsFiles?.find(hasExtension);
      if (sidecar) {
        parsed = format.parse(decodeText(await sidecar.arrayBuffer()));
        source = sidecar.name;
      }
    } catch (error) {
      console.error("Could not read lyrics file:", error);
      failed = true;
    }
  }
  const entry = parsed.lines.length ? { status: "ready", source, ...parsed } : { status: failed ? "error" : "none" };
  // A newer load (e.g. after switching the format) replaced this one.
  if (lyricsCache.get(path) !== pending) return;
  lyricsCache.set(path, entry);
  if (currentView === "lyrics" && player.path === path) renderLyrics();
}

function renderLyrics() {
  const path = player.path;
  const track = path && trackFor(path);
  const meta = track ? [track.title || relativePath(path), track.artist || "Unknown artist"] : path ? [relativePath(path)] : [];
  const source = path && lyricsCache.get(path)?.source;
  if (source) meta.push(source);
  const metaKey = meta.join("\n");
  if (elements["lyrics-meta"].dataset.key !== metaKey) {
    elements["lyrics-meta"].dataset.key = metaKey;
    renderMeta(elements["lyrics-meta"], meta);
  }
  if (path && (library || dropped.has(path)) && !lyricsCache.has(path)) loadLyrics(path);
  const entry = path ? lyricsCache.get(path) : null;
  if (entry !== lyricsShown) {
    lyricsShown = entry;
    lyricsActive = -1;
    const lines = entry?.status === "ready" ? entry.lines : [];
    elements["lyrics-lines"].replaceChildren(...lines.map(line => {
      const row = document.createElement("p");
      row.textContent = line.text || "\u00a0";
      if (entry.synced) {
        row.dataset.time = line.time;
        row.className = "-mx-2 cursor-pointer rounded-md px-2 py-1 text-faint transition-colors duration-200 hover:bg-subtle hover:text-soft";
      } else {
        row.className = "text-fg-2";
      }
      return row;
    }));
    elements["lyrics-lines"].scrollTop = 0;
    const message = !path ? "Play a track to see its lyrics."
      : !entry || entry.status === "loading" ? "Loading lyrics…"
      : entry.status === "none" ? `No lyrics in this file or a matching ${lyricsFormat(lyricsFormatId).extension} file.`
      : entry.status === "error" ? "Couldn't read lyrics from this file."
      : "";
    elements["lyrics-empty"].textContent = message;
    elements["lyrics-empty"].classList.toggle("hidden", !message);
  }
  if (entry?.status === "ready" && entry.synced) highlightLyric(entry.lines);
  renderLyricsOffset();
}

// Per-track shift of timed lyrics in seconds (positive: lines come later), for lyrics timed to another recording.
const LYRICS_OFFSETS_KEY = "lyricsOffsets";
let lyricsOffsets = {};
try {
  const stored = JSON.parse(localStorage.getItem(LYRICS_OFFSETS_KEY));
  if (stored && typeof stored === "object" && !Array.isArray(stored)) lyricsOffsets = stored;
} catch {}
const lyricsOffset = path => (path && roundOffset(lyricsOffsets[path])) || 0;

function setLyricsOffset(path, seconds) {
  const value = roundOffset(seconds);
  if (value) lyricsOffsets[path] = value;
  else delete lyricsOffsets[path];
  try { localStorage.setItem(LYRICS_OFFSETS_KEY, JSON.stringify(lyricsOffsets)); } catch {}
  renderLyricsOffset();
  const entry = lyricsCache.get(path);
  if (player.path === path && entry?.status === "ready" && entry.synced) highlightLyric(entry.lines);
}

// The offset control shows only for timed lyrics.
function renderLyricsOffset() {
  const entry = player.path && lyricsCache.get(player.path);
  const shown = entry?.status === "ready" && entry.synced;
  elements["lyrics-offset"].classList.toggle("hidden", !shown);
  elements["lyrics-offset"].classList.toggle("flex", shown);
  const offset = lyricsOffset(player.path);
  const value = elements["lyrics-offset-value"];
  value.textContent = formatOffset(offset);
  value.toggleAttribute("data-changed", offset !== 0);
  value.setAttribute("aria-label", `Lyrics offset ${formatOffset(offset)}${offset ? ", reset" : ""}`);
  value.title = offset ? "Lyrics offset for this track. Scroll to change by 0.1 s, click to reset" : "Lyrics offset for this track. Scroll to change by 0.1 s";
}

for (const [id, direction] of [["lyrics-earlier", -1], ["lyrics-later", 1]]) {
  elements[id].addEventListener("click", event => {
    if (player.path) setLyricsOffset(player.path, lyricsOffset(player.path) + direction * (event.shiftKey ? 0.1 : 0.5));
  });
}
elements["lyrics-offset-value"].addEventListener("click", () => {
  if (player.path) setLyricsOffset(player.path, 0);
});
elements["lyrics-offset-value"].addEventListener("wheel", event => {
  if (!player.path || !event.deltaY) return;
  event.preventDefault();
  setLyricsOffset(player.path, lyricsOffset(player.path) + (event.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// Highlights the synced line being sung and keeps it centred, unless the user scrolled the lyrics recently.
function highlightLyric(lines) {
  const index = activeLyricIndex(lines, (player.audio.currentTime || 0) + 0.2 - lyricsOffset(player.path));
  if (index === lyricsActive) return;
  const rows = elements["lyrics-lines"].children;
  rows[lyricsActive]?.classList.remove("!text-deep", "font-semibold");
  lyricsActive = index;
  const row = rows[index];
  if (!row) return;
  row.classList.add("!text-deep", "font-semibold");
  if (Date.now() - lyricsUserScrolledAt < 4000) return;
  const scroller = elements["lyrics-lines"];
  const view = scroller.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  scroller.scrollTo({ top: scroller.scrollTop + bounds.top - view.top - (view.height - bounds.height) / 2, behavior: "smooth" });
}

elements["lyrics-lines"].addEventListener("click", event => {
  const row = event.target.closest("[data-time]");
  if (!row || !player.path) return;
  player.audio.currentTime = Math.max(0, Number(row.dataset.time) + lyricsOffset(player.path));
  lyricsUserScrolledAt = 0;
});
for (const type of ["wheel", "touchmove"]) elements["lyrics-lines"].addEventListener(type, () => { lyricsUserScrolledAt = Date.now(); }, { passive: true });

// One button per lyrics format; the chosen one is the only file looked for next to tracks.
elements["lyrics-format"].replaceChildren(...LYRICS_FORMATS.map((format, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.lyricsFormat = format.id;
  button.textContent = format.extension;
  button.title = `Read lyrics from ${format.extension} files next to tracks`;
  button.className = `px-3 py-1.5${index ? " border-l border-bd-in" : ""}`;
  return button;
}));
function renderLyricsFormat() {
  for (const button of elements["lyrics-format"].children) {
    const active = button.dataset.lyricsFormat === lyricsFormatId;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("bg-sel", active);
    button.classList.toggle("font-semibold", active);
    button.classList.toggle("text-deep", active);
    button.classList.toggle("bg-field", !active);
    button.classList.toggle("hover:bg-tint-2", !active);
  }
}
elements["lyrics-format"].addEventListener("click", event => {
  const id = event.target.closest("[data-lyrics-format]")?.dataset.lyricsFormat;
  if (!id || id === lyricsFormatId) return;
  lyricsFormatId = id;
  try { localStorage.setItem("lyricsFormat", id); } catch {}
  lyricsCache.clear();
  renderLyricsFormat();
  renderLyrics();
});
renderLyricsFormat();

// Track count and duration for the whole playlist, or the part before/after the playing track (which itself is excluded).
let playlistStats = "total";
try { if (["total", "elapsed", "remaining"].includes(localStorage.getItem("playlistStats"))) playlistStats = localStorage.getItem("playlistStats"); } catch {}
function renderPlaylistStats() {
  const paths = playlistPaths();
  const index = paths.indexOf(player.path);
  const part = playlistStats === "elapsed" ? paths.slice(0, Math.max(index, 0))
    : playlistStats === "remaining" ? paths.slice(index + 1)
    : paths;
  elements["playlist-count"].textContent = `${part.length.toLocaleString()} ${part.length === 1 ? "Track" : "Tracks"}`;
  // Shown as listening time (playback speed and cut applied); the tooltip gives the tracks' own length when it differs.
  const tracks = part.map(path => trackFor(path) || { duration: null });
  const listening = tracks.map(track => ({ duration: listeningSeconds(track.duration) }));
  // Gaps count between tracks: each elapsed track was followed by one, each remaining one is preceded by one.
  const gaps = Number.isFinite(playbackGap) && playbackGap > 0 ? (playlistStats === "total" ? Math.max(part.length - 1, 0) : part.length) : 0;
  if (gaps && listening.some(track => Number.isFinite(track.duration))) listening.push({ duration: gaps * playbackGap });
  const shown = formatTotal(listening);
  const original = formatTotal(tracks);
  const durationPill = elements["playlist-duration"];
  durationPill.textContent = shown;
  const tip = shown === original ? "" : `Original length: ${original}`;
  // Only touch the title when it changes; this runs on every playback tick.
  if (durationPill.dataset.lastTip !== tip) {
    durationPill.dataset.lastTip = tip;
    durationPill.title = tip;
  }
  for (const tab of elements["playlist-stats-tabs"].children) tab.setAttribute("aria-selected", String(tab.dataset.stats === playlistStats));
}
elements["playlist-stats-tabs"].addEventListener("click", event => {
  const tab = event.target.closest("[data-stats]");
  if (!tab) return;
  playlistStats = tab.dataset.stats;
  try { localStorage.setItem("playlistStats", playlistStats); } catch {}
  renderPlaylistStats();
});

// Centres the playing track in the playlist when it changes, even if it was already in view. Only the playlist list
// scrolls, never the page; near the ends it stops where the list does.
let scrolledPath = null;
function scrollToPlayingRow() {
  const row = player.path && elements.playlist.querySelector(`[data-path="${CSS.escape(player.path)}"]`);
  const scroller = elements.playlist.closest(".overflow-y-auto");
  if (!player.path) scrolledPath = null;
  if (!row || !scroller || !scroller.clientHeight) return;
  scrolledPath = player.path;
  const view = scroller.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  const top = scroller.scrollTop + bounds.top - view.top - (view.height - bounds.height) / 2;
  scroller.scrollTo({ top, behavior: "smooth" });
}

const buttonTitles = {
  play: "Play",
  add: "Add to playlist",
  added: "Added to playlist",
  remove: "Remove from playlist",
  load: "Load playlist",
  clear: "Delete playlist",
  export: "Export playlist",
  import: "Import playlists",
  rename: "Rename playlist"
};

function button(icon, label, action, disabled = false, compact = false, title = buttonTitles[icon]) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = title;
  // compact: true = 32px, "small" = 28px (library groups), "tiny" = 24px (library tracks), otherwise 40px.
  element.className = `flex ${compact === "tiny" ? "h-6 w-6" : compact === "small" ? "h-7 w-7" : compact ? "h-8 w-8" : "h-10 w-10"} shrink-0 items-center justify-center rounded border border-bd-in bg-field text-fg-2 hover:bg-tint-2 disabled:cursor-not-allowed disabled:opacity-40`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", compact === "tiny" ? "h-3.5 w-3.5" : compact === "small" ? "h-4 w-4" : "h-5 w-5");
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
  cell.className = `px-3 py-2 ${style}`;
  const text = document.createElement("span");
  text.className = "block truncate";
  text.textContent = value;
  text.title = value;
  cell.append(text);
  return cell;
}

function openAlbum(name) {
  currentView = "library";
  libraryMode = "album";
  libraryGroup = name;
  artistAlbum = null;
  elements.search.value = "";
  render();
  elements["library-heading"].focus();
}

function renderAnalysis() {
  const timeline = buildYearTimeline(library?.tracks || []);
  const hasYears = timeline.years.length > 0;
  const selected = timeline.years.find(item => item.year === analysisYear);
  const albumsMetric = analysisMetric === "albums";
  const count = (number, noun) => `${number.toLocaleString()} ${noun}${number === 1 ? "" : "s"}`;
  const valueOf = item => albumsMetric ? item.albums.length : item.tracks.length;

  elements["analysis-empty"].textContent = library
    ? "No release years found. Rescan the library to read years from your tags."
    : "Choose a folder to see how your library spreads over the years.";
  elements["analysis-empty"].classList.toggle("hidden", hasYears);
  elements["analysis-body"].classList.toggle("hidden", !hasYears);
  elements["analysis-body"].classList.toggle("flex", hasYears);
  for (const [metric, buttonElement] of [["albums", elements["analysis-albums"]], ["tracks", elements["analysis-tracks"]]]) {
    const active = metric === analysisMetric;
    buttonElement.setAttribute("aria-pressed", String(active));
    buttonElement.classList.toggle("bg-sel", active);
    buttonElement.classList.toggle("font-semibold", active);
    buttonElement.classList.toggle("text-deep", active);
    buttonElement.classList.toggle("bg-field", !active);
    buttonElement.classList.toggle("hover:bg-tint-2", !active);
  }
  renderCrumbs(elements["analysis-title"], [
    { label: "Analysis", action: () => { analysisYear = null; render(); elements["analysis-heading"].focus(); } },
    ...(selected ? [{ label: String(selected.year), action: () => render() }] : [])
  ]);
  renderMeta(elements["analysis-meta"], hasYears ? [
    count(timeline.knownAlbums, "Album"),
    count(timeline.knownTracks, "Track"),
    timeline.min === timeline.max ? String(timeline.min) : `${timeline.min}–${timeline.max}`,
    ...(timeline.unknownTracks ? [`${timeline.unknownTracks.toLocaleString()} without year`] : [])
  ] : []);
  if (!hasYears) return;

  const chart = elements["analysis-chart"];
  const scroll = chart.scrollLeft;
  const peak = Math.max(1, ...timeline.years.map(valueOf));
  chart.replaceChildren(...timeline.years.map(item => {
    const value = valueOf(item);
    const isSelected = item === selected;
    const column = document.createElement("button");
    column.type = "button";
    column.className = `flex h-full w-10 shrink-0 flex-col rounded-t-md ${isSelected ? "bg-sel" : "hover:bg-subtle"}`;
    column.setAttribute("aria-pressed", String(isSelected));
    column.setAttribute("aria-label", `${item.year}: ${count(value, albumsMetric ? "album" : "track")}`);
    column.addEventListener("click", () => {
      analysisYear = isSelected ? null : item.year;
      render();
    });
    const plot = document.createElement("div");
    plot.className = "relative min-h-0 w-full flex-1";
    if (value) {
      const height = (value / peak) * 82;
      const bar = document.createElement("div");
      bar.className = `absolute bottom-0 left-1/2 w-5 -translate-x-1/2 rounded-t ${isSelected ? "bg-bar-sel" : "bg-bar"}`;
      bar.style.height = `${height}%`;
      const label = document.createElement("span");
      label.className = "absolute inset-x-0 text-center text-xs tabular-nums text-soft";
      label.style.bottom = `calc(${height}% + 2px)`;
      label.textContent = String(value);
      plot.append(bar, label);
    }
    const year = document.createElement("span");
    year.className = `py-1.5 text-center text-xs tabular-nums ${value ? "font-medium text-deep-2" : "text-faint-2"}`;
    year.textContent = String(item.year);
    column.append(plot, year);
    return column;
  }));
  chart.scrollLeft = scroll;
  const selectedColumn = chart.querySelector('[aria-pressed="true"]');
  if (selectedColumn) {
    const left = selectedColumn.getBoundingClientRect().left - chart.getBoundingClientRect().left + chart.scrollLeft;
    if (left < chart.scrollLeft || left + selectedColumn.offsetWidth > chart.scrollLeft + chart.clientWidth) {
      chart.scrollLeft = left - (chart.clientWidth - selectedColumn.offsetWidth) / 2;
    }
  }

  const detail = elements["analysis-detail"];
  detail.replaceChildren();
  const hint = text => {
    const message = document.createElement("p");
    message.className = "px-4 py-8 text-center text-base text-soft sm:px-6";
    message.textContent = text;
    detail.append(message);
  };
  if (!selected) return hint(`Select a year to see its ${albumsMetric ? "albums" : "tracks"}.`);
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const columns = albumsMetric
    ? [{ label: "Album", width: "" }, { label: "Artist", width: "" }, { label: "Tracks", width: "w-24", end: true, numeric: true }]
    : [{ label: "#", width: "w-16", numeric: true }, { label: "Title", width: "" }, { label: "Artist", width: "" }, { label: "Album", width: "" }, { label: "Time", width: "w-24", end: true, numeric: true }];
  const rows = albumsMetric
    ? [...selected.albums].sort((a, b) => byName(a.key || "Unknown album", b.key || "Unknown album")).map(album => ({
      cells: [album.key || "Unknown album", groupArtistLabel(album), album.tracks.length.toLocaleString()],
      sortValues: [album.key || "Unknown album", groupArtistLabel(album), album.tracks.length],
      album: album.key
    }))
    : [...selected.tracks].sort((a, b) => byName(a.album || "", b.album || "") || (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity) || byName(a.title, b.title)).map(track => ({
      cells: [Number.isSafeInteger(track.trackNumber) && track.trackNumber > 0 ? String(track.trackNumber) : "—", track.title, track.artist || "Unknown artist", track.album || "Unknown album", formatDuration(track.duration)],
      sortValues: [Number.isSafeInteger(track.trackNumber) && track.trackNumber > 0 ? track.trackNumber : null, track.title, track.artist || "Unknown artist", track.album || "Unknown album", Number.isFinite(track.duration) ? track.duration : null],
      album: track.album || null
    }));
  if (!rows.length) return hint(`No ${albumsMetric ? "albums" : "tracks"} for ${selected.year}.`);
  const sort = analysisSort[analysisMetric];
  if (sort.column !== null) {
    const sign = sort.direction === "ascending" ? 1 : -1;
    const numeric = columns[sort.column].numeric;
    rows.sort((a, b) => {
      const left = a.sortValues[sort.column];
      const right = b.sortValues[sort.column];
      if (numeric && (left === null) !== (right === null)) return left === null ? 1 : -1;
      return sign * (numeric ? (left ?? 0) - (right ?? 0) : byName(left, right));
    });
  }

  const table = document.createElement("table");
  table.className = "w-full min-w-[480px] table-fixed border-collapse text-base";
  const colgroup = document.createElement("colgroup");
  const headRow = document.createElement("tr");
  headRow.className = "border-b border-bd-2";
  columns.forEach((column, index) => {
    const col = document.createElement("col");
    col.className = column.width;
    colgroup.append(col);
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.className = `px-3 py-2.5 ${column.end ? "text-right" : "text-left"}`;
    const active = sort.column === index;
    if (active) heading.setAttribute("aria-sort", sort.direction);
    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = `flex w-full items-center gap-2 hover:text-deep ${column.end ? "justify-end text-right" : "text-left"}`;
    const label = document.createElement("span");
    label.textContent = column.label;
    const indicator = document.createElement("span");
    indicator.setAttribute("aria-hidden", "true");
    indicator.className = active ? "font-bold text-deep" : "opacity-50";
    indicator.textContent = active ? (sort.direction === "ascending" ? "↑" : "↓") : "↕";
    sortButton.append(label, indicator);
    sortButton.addEventListener("click", () => {
      sort.direction = active && sort.direction === "ascending" ? "descending" : "ascending";
      sort.column = index;
      render();
    });
    heading.append(sortButton);
    headRow.append(heading);
  });
  const thead = document.createElement("thead");
  thead.className = "sticky top-0 z-10 bg-head text-soft";
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  const nameColumn = albumsMetric ? 0 : 1;
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = `border-b border-bd-3 last:border-b-0 ${row.album === null ? "" : "cursor-pointer hover:bg-field"}`;
    if (row.album !== null) tr.addEventListener("click", event => {
      if (!event.target.closest("button")) openAlbum(row.album);
    });
    row.cells.forEach((value, index) => {
      const cell = trackCell(value, `${columns[index].end ? "text-right tabular-nums" : ""} ${index === nameColumn ? "font-medium text-fg-2" : "text-soft"}`);
      if (index === nameColumn && row.album !== null) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "block max-w-full truncate text-left";
        open.textContent = value;
        open.addEventListener("click", () => openAlbum(row.album));
        cell.replaceChildren(open);
      }
      tr.append(cell);
    });
    tbody.append(tr);
  }
  table.append(colgroup, thead, tbody);
  detail.append(table);
}

function render() {
  syncHash();
  hideContextMenu();
  for (const view of ["library", "playlists", "analysis", "visualizer", "lyrics"]) {
    const active = currentView === view;
    const nav = elements[`nav-${view}`];
    const panel = elements[`${view}-view`];
    nav.classList.toggle("bg-sel", active);
    nav.classList.toggle("font-semibold", active);
    nav.classList.toggle("text-deep", active);
    nav.classList.toggle("font-medium", !active);
    nav.classList.toggle("text-fg-2", !active);
    if (active && (view === "analysis" || view === "visualizer" || view === "lyrics" || (view === "playlists" && !selectedPlaylistId))) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
    panel.classList.toggle("hidden", !active);
    panel.classList.toggle("flex", active);
  }
  if (currentView === "analysis") renderAnalysis();
  if (currentView === "visualizer") visualizer.start();
  else visualizer.stop();
  if (currentView === "lyrics") renderLyrics();
  for (const mode of ["artist", "album", "track"]) {
    const nav = elements[`nav-${mode}`];
    const active = currentView === "library" && libraryMode === mode;
    nav.classList.toggle("bg-sel", active);
    nav.classList.toggle("font-semibold", active);
    nav.classList.toggle("text-deep", active);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  const focusedPlaylist = document.activeElement?.dataset.playlistId;
  elements["playlist-nav-items"].replaceChildren();
  for (const saved of [...savedPlaylists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))) {
    const nav = document.createElement("button");
    nav.type = "button";
    nav.dataset.playlistId = saved.id;
    nav.className = "flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-tint";
    // One line per playlist; a long name is cut short, and given in full on hover (only then: a tooltip repeating a name
    // in plain view says nothing). Set as the pointer arrives, before the tooltip reads it.
    const name = document.createElement("span");
    name.className = "min-w-0 truncate";
    name.textContent = saved.name;
    nav.addEventListener("pointerover", () => { nav.title = name.scrollWidth > name.clientWidth ? saved.name : ""; });
    const count = document.createElement("span");
    count.className = "shrink-0 tabular-nums text-soft";
    count.textContent = saved.tracks.length.toLocaleString();
    nav.append(name, count);
    const active = currentView === "playlists" && selectedPlaylistId === saved.id;
    if (active) {
      nav.classList.add("bg-sel", "font-semibold", "text-deep");
      nav.setAttribute("aria-current", "page");
    }
    nav.addEventListener("click", () => selectPlaylist(saved));
    elements["playlist-nav-items"].append(nav);
    if (saved.id === focusedPlaylist) nav.focus();
  }
  const tracks = (library?.tracks || []).filter(inSourceFilter);
  renderSourceFilter();
  elements["artist-nav-count"].textContent = new Set(tracks.map(track => groupKey(track, "artist"))).size.toLocaleString();
  elements["album-nav-count"].textContent = new Set(tracks.map(track => groupKey(track, "album"))).size.toLocaleString();
  elements["track-nav-count"].textContent = tracks.length.toLocaleString();
  const query = elements.search.value.trim().toLocaleLowerCase();
  const hideTrackArtist = libraryMode === "artist" && libraryGroup !== null && artistAlbum !== null;
  const hideTrackAlbum = (libraryMode === "artist" && artistAlbum !== null) || (libraryMode === "album" && libraryGroup !== null);
  const albumViewKey = hideTrackAlbum ? JSON.stringify([libraryMode, libraryGroup, artistAlbum]) : null;
  if (albumViewKey !== currentAlbumView) {
    if (albumViewKey !== null) {
      if (currentAlbumView === null) sortBeforeAlbum = { key: sortKey, direction: sortDirection };
      sortKey = "trackNumber";
      sortDirection = "ascending";
    } else if (sortBeforeAlbum) {
      ({ key: sortKey, direction: sortDirection } = sortBeforeAlbum);
    }
    currentAlbumView = albumViewKey;
  }
  if (routeTrackSort) {
    ({ key: sortKey, direction: sortDirection } = routeTrackSort === "default" ? { key: hideTrackAlbum ? "trackNumber" : "title", direction: "ascending" } : routeTrackSort);
    routeTrackSort = null;
  }
  if ((hideTrackArtist && sortKey === "artist") || (hideTrackAlbum && sortKey === "album")) {
    sortKey = "title";
    sortDirection = "ascending";
  }
  const filtered = sortLibraryTracks(filterLibraryTracks(tracks, libraryMode, libraryGroup, artistAlbum, query), sortKey, sortDirection);
  for (const [name, hidden] of [["artist", hideTrackArtist], ["album", hideTrackAlbum]]) {
    elements[`track-${name}-col`].classList.toggle("hidden", hidden);
    elements[`track-${name}-heading`].classList.toggle("hidden", hidden);
  }
  elements["track-count"].textContent = tracks.length.toLocaleString();
  const artistAlbums = libraryMode === "artist" && libraryGroup !== null;
  const grouped = libraryMode !== "track" && (libraryGroup === null || (artistAlbums && artistAlbum === null));
  const groupMode = artistAlbums ? "album" : libraryMode;
  const groupName = (value, mode) => value || (mode === "artist" ? "Unknown artist" : "Unknown album");
  const sortSlot = artistAlbums ? "artistAlbum" : groupMode;
  if (artistAlbums && groupSort.artistAlbum.key === "artist") groupSort.artistAlbum = { key: groupSortDefaults.artistAlbum, direction: "ascending" };
  const groups = grouped ? sortLibraryGroups(groupLibraryTracks(filtered, groupMode), groupMode, groupSort[sortSlot].key, groupSort[sortSlot].direction) : [];
  elements["library-title"].replaceChildren();
  const scoped = filterLibraryTracks(tracks, libraryMode, libraryGroup, artistAlbum, "");
  const albumLabel = name => {
    const years = scoped.map(track => track.year).filter(Number.isFinite);
    return `${groupName(name, "album")}${years.length ? ` (${Math.min(...years)})` : ""}`;
  };
  const crumbs = libraryMode === "track" ? [{ label: "Tracks", group: null, album: null }]
    : libraryMode === "artist" ? [
      { label: "Artists", group: null, album: null },
      ...(libraryGroup !== null ? [{ label: groupName(libraryGroup, "artist"), group: libraryGroup, album: null }] : []),
      ...(artistAlbum !== null ? [{ label: albumLabel(artistAlbum), group: libraryGroup, album: artistAlbum }] : [])
    ]
    : [{ label: "Albums", group: null, album: null }, ...(libraryGroup !== null ? [{ label: albumLabel(libraryGroup), group: libraryGroup, album: null }] : [])];
  renderCrumbs(elements["library-title"], crumbs.map(crumb => ({
    label: crumb.label,
    action: () => {
      libraryGroup = crumb.group;
      artistAlbum = crumb.album;
      elements.search.value = "";
      render();
      elements["library-heading"].focus();
    }
  })));
  const plural = (count, noun) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
  const meta = [];
  if (grouped) meta.push(plural(groups.length, libraryMode === "artist" && !artistAlbums ? "Artist" : "Album"));
  meta.push(plural(filtered.length, "Track"), formatTotal(filtered));
  renderMeta(elements["library-meta"], meta);
  elements["library-meta"].classList.toggle("hidden", !library);
  const albumsPage = groupMode === "album" && !artistAlbums;
  // Album lists (all albums, an artist's albums) can be shown as a grid of covers instead of the table.
  const albumList = grouped && groupMode === "album";
  const gridView = albumList && albumView === "grid";
  elements["tracks-table"].classList.toggle("hidden", grouped);
  elements["groups-table"].classList.toggle("hidden", !grouped || gridView);
  elements["album-grid"].classList.toggle("hidden", !gridView);
  elements["album-grid"].classList.toggle("grid", gridView);
  renderAlbumViewControls(albumList, gridView, sortSlot, albumsPage);
  // Album views have more in their header (view and sort controls, the cover): two rows that don't wrap. Other views
  // keep one wrapping row, the two rows' contents flowing into it.
  const twoRows = groupMode === "album";
  elements["library-header-rows"].className = twoRows ? "flex min-w-0 flex-1 flex-col gap-2" : "flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2";
  elements["library-header-top"].className = twoRows ? "flex min-w-0 items-center gap-x-6" : "contents";
  elements["library-header-controls"].className = twoRows ? "flex min-w-0 items-center gap-2" : "contents";
  // Source filter and search lead the controls row; in a single row they sit at its end, as they always have.
  // In album views the album controls follow straight after, so the group doesn't stretch; search keeps its usual width.
  elements["library-header-static"].classList.toggle("justify-end", !twoRows);
  elements["library-header-static"].classList.toggle("flex-1", !twoRows);
  elements.search.classList.toggle("sm:w-80", twoRows);
  elements["library-title"].classList.toggle("whitespace-nowrap", twoRows);
  elements["library-title"].classList.toggle("flex-wrap", !twoRows);
  // An album's own page shows its cover by the title.
  const albumPage = !grouped && ((libraryMode === "album" && libraryGroup !== null) || (artistAlbums && artistAlbum !== null));
  renderLibraryCover(albumPage ? scoped : null, albumPage ? `${libraryMode}\n${libraryGroup}\n${artistAlbum}` : null);
  elements["group-artist-col"].classList.toggle("hidden", !albumsPage);
  elements["group-artist-heading"].classList.toggle("hidden", !albumsPage);
  elements["group-albums-col"].classList.toggle("hidden", groupMode !== "artist");
  elements["group-albums-heading"].classList.toggle("hidden", groupMode !== "artist");
  elements["group-year-col"].classList.toggle("hidden", groupMode !== "album");
  elements["group-year-heading"].classList.toggle("hidden", groupMode !== "album");
  elements["group-name-heading"].textContent = groupMode === "artist" ? "Artist" : "Album";
  for (const sortButton of [...sortButtons, ...groupSortButtons]) {
    const isGroup = "groupSort" in sortButton.dataset;
    const key = isGroup ? groupSort[sortSlot]?.key : sortKey;
    const direction = isGroup ? groupSort[sortSlot]?.direction : sortDirection;
    const active = (isGroup ? sortButton.dataset.groupSort : sortButton.dataset.sort) === key;
    const heading = sortButton.closest("th");
    if (active) heading.setAttribute("aria-sort", direction);
    else heading.removeAttribute("aria-sort");
    const indicator = sortButton.querySelector("[data-sort-indicator]");
    indicator.textContent = active ? (direction === "ascending" ? "↑" : "↓") : "↕";
    indicator.classList.toggle("opacity-50", !active);
    indicator.classList.toggle("font-bold", active);
    indicator.classList.toggle("text-deep", active);
  }
  elements["choose-folder"].disabled = busy || !("showDirectoryPicker" in window);
  // Draw attention to the folder button until there is something to play.
  elements["choose-folder"].classList.toggle("motion-safe:animate-attention", !library && !elements["choose-folder"].disabled);
  renderSources();
  // Covers of the rows about to be replaced needn't load any more.
  coverObserver.disconnect();
  elements["group-rows"].replaceChildren();
  elements["album-grid"].replaceChildren();
  elements["track-rows"].replaceChildren();
  if (grouped) {
    for (const [position, group] of groups.entries()) {
      if (gridView) {
        elements["album-grid"].append(albumCard(group, groupName(group.key, "album"), albumsPage, () => {
          if (artistAlbums) artistAlbum = group.key;
          else libraryGroup = group.key;
          elements.search.value = "";
          render();
          elements["library-heading"].focus();
        }));
        continue;
      }
      const row = document.createElement("tr");
      row.className = "cursor-pointer border-b border-bd-3 hover:bg-field last:border-b-0";
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
      nameCell.className = "px-3 py-2";
      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "block max-w-full truncate text-left font-medium text-fg-2";
      nameButton.textContent = name;
      nameButton.title = name;
      nameButton.addEventListener("click", open);
      if (groupMode === "album") {
        // Albums carry a small cover before the name.
        nameCell.className = "px-3 py-1.5";
        const named = document.createElement("div");
        named.className = "flex min-w-0 items-center gap-2.5";
        named.append(coverTile("h-8 w-8", () => covers.album(group.tracks)), nameButton);
        nameCell.append(named);
      } else nameCell.append(nameButton);
      row.append(trackCell(String(position + 1), "tabular-nums text-faint-2"), nameCell);
      if (albumsPage) {
        const artistLabel = groupArtistLabel(group);
        row.append(trackCell(artistLabel, "text-soft"));
      }
      if (groupMode === "artist") row.append(trackCell(group.albums.size.toLocaleString(), "text-right tabular-nums text-soft"));
      if (groupMode === "album") row.append(trackCell(group.year === null ? "—" : String(group.year), "text-right tabular-nums text-soft"));
      row.append(
        trackCell(group.tracks.length.toLocaleString(), "text-right tabular-nums text-soft"),
        trackCell(formatTotal(group.tracks), "text-right tabular-nums text-soft")
      );
      const paths = group.tracks.map(track => track.path);
      const missing = paths.filter(path => !playlistPaths().includes(path));
      const addGroup = () => missing.length ? updatePlaylist([...playlistPaths(), ...missing]) : Promise.resolve(true);
      const actions = document.createElement("div");
      actions.className = "flex justify-end gap-1.5";
      actions.append(
        button("play", `Play ${groupMode}: ${name}`, async () => {
          if (await addGroup()) await playTrack(paths[0]);
        }, busy, "small"),
        button(missing.length ? "add" : "added", `${missing.length ? "Add to playlist" : "Added to playlist"}: ${name}`, addGroup, busy || !missing.length, "small")
      );
      const actionCell = document.createElement("td");
      actionCell.className = "px-3 py-1";
      actionCell.append(actions);
      row.append(actionCell);
      elements["group-rows"].append(row);
    }
  } else filtered.forEach((track, position) => {
    const row = document.createElement("tr");
    row.className = "border-b border-bd-3 hover:bg-field last:border-b-0";
    const added = playlistPaths().includes(track.path);
    const actions = document.createElement("div");
    actions.className = "flex justify-end gap-1";
    actions.append(
      button("play", `Play from library: ${track.title} (${relativePath(track.path)})`, async () => {
        if (added || await updatePlaylist([...playlistPaths(), track.path])) await playTrack(track.path);
      }, busy, "tiny"),
      button(added ? "added" : "add", `${added ? "Added to playlist" : "Add to playlist"}: ${track.title} (${relativePath(track.path)})`, () => updatePlaylist([...playlistPaths(), track.path]), busy || added, "tiny")
    );
    // Tag editing is rare, so it lives in the row's context menu rather than among the buttons.
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      openContextMenu(row, null, event, track.path);
    });
    const actionCell = document.createElement("td");
    actionCell.className = "px-3 py-1";
    actionCell.append(actions);
    row.append(
      trackCell(String(position + 1), "tabular-nums text-faint-2"),
      trackCell(Number.isSafeInteger(track.trackNumber) && track.trackNumber > 0 ? String(track.trackNumber) : "—", "tabular-nums text-soft"),
      trackCell(track.title, "font-medium text-fg-2"),
      ...(hideTrackArtist ? [] : [trackCell(track.artist || "Unknown artist", "text-soft")]),
      ...(hideTrackAlbum ? [] : [trackCell(track.album || "Unknown album", "text-soft")]),
      trackCell(formatDuration(track.duration), "text-right tabular-nums text-soft"),
      actionCell
    );
    elements["track-rows"].append(row);
  });
  elements.empty.classList.toggle("hidden", filtered.length > 0);
  const noSources = activeSourceFilter()?.size === 0;
  elements["empty-title"].textContent = noSources ? "No sources selected" : query ? "No tracks found" : library ? "No MP3 files found" : "No folder selected";
  elements["empty-description"].textContent = noSources ? "Pick sources in the filter to see their tracks." : query ? "Try a different search term." : library ? "Add MP3 files to your folder and rescan to see them here." : "Choose a folder to index your MP3 files. Files are not uploaded.";
  const paths = playlistPaths();
  elements["playlist-nav-count"].textContent = savedPlaylists.length.toLocaleString();
  const selected = savedPlaylists.find(saved => saved.id === selectedPlaylistId);
  if (renamingId !== null && (currentView !== "playlists" || renamingId !== selectedPlaylistId)) renamingId = null;
  elements["rename-form"].classList.toggle("hidden", !selected || renamingId !== selected.id);
  elements["rename-input"].disabled = busy;
  elements["rename-submit"].disabled = busy;
  const showPlaylists = () => {
    selectedPlaylistId = null;
    render();
    elements["saved-playlists-heading"].focus();
  };
  renderCrumbs(elements["saved-title"], [
    { label: "Playlists", action: showPlaylists },
    ...(selected ? [{ label: selected.name, action: () => selectPlaylist(selected) }] : [])
  ]);
  const savedMeta = selected
    ? [`${selected.tracks.length.toLocaleString()} ${selected.tracks.length === 1 ? "Track" : "Tracks"}`, formatTotal(selected.tracks)]
    : [`${savedPlaylists.length.toLocaleString()} ${savedPlaylists.length === 1 ? "Playlist" : "Playlists"}`];
  renderMeta(elements["saved-meta"], savedMeta);
  elements["saved-empty"].textContent = selected ? "This playlist has no tracks." : "Save the current playlist or import one to see it here.";
  elements["saved-empty"].classList.toggle("hidden", selected ? selected.tracks.length > 0 : savedPlaylists.length > 0);
  elements["saved-actions"].replaceChildren();
  elements["saved-playlists"].replaceChildren();
  if (!selected) {
    const exportAll = button("export", "Export all playlists", () => exportPlaylists(savedPlaylists, "playlists"), busy || !savedPlaylists.length);
    exportAll.title = "Export all playlists";
    const importButton = button("import", "Import playlists", () => elements["import-file"].click(), busy);
    importButton.dataset.drop = "playlists";
    importButton.classList.add("origin-center", "transition-transform", "duration-150");
    elements["saved-actions"].append(importButton, exportAll);
  }
  if (selected) {
    elements["saved-actions"].append(
      button("rename", `Rename playlist: ${selected.name}`, () => openRename(selected), busy),
      button("export", `Export playlist: ${selected.name}`, () => exportPlaylists([selected], selected.name), busy),
      button("load", `Load playlist: ${selected.name}`, () => loadPlaylist(selected), busy),
      button("clear", `Delete playlist: ${selected.name}`, () => removeSavedPlaylist(selected), busy)
    );
    selected.tracks.forEach((track, index) => {
      const currentTrack = selectedPlaylistPaths ? trackFor(selectedPlaylistPaths[index]) : null;
      // The library's current details (they may have been edited since), else what the playlist saved.
      const albumName = currentTrack?.album || track.album;
      const row = itemRow(
        index,
        currentTrack?.title || track.title || relativePath(track.path),
        [currentTrack?.artist || track.artist || "Unknown artist", albumName ? albumText({ album: albumName, year: currentTrack?.year ?? track.year }) : ""].filter(Boolean).join(" · "),
        formatDuration(track.duration),
        "select-none sm:px-6"
      );
      setTitle(row.querySelector("[data-title]"), currentTrack?.title || track.title || relativePath(track.path), currentTrack?.trackNumber ?? track.trackNumber);
      row.addEventListener("dblclick", () => playSavedTrack(selected, index));
      row.tabIndex = 0;
      row.classList.add("focus-visible:outline", "focus-visible:outline-2", "focus-visible:-outline-offset-2", "focus-visible:outline-primary");
      row.addEventListener("keydown", event => {
        if (event.target === row && event.key === "Delete" && !busy) removeSavedTrack(selected, index);
      });
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        // The track as matched to the library; until matching is done (or if it stalls), its saved key, which is the
        // library's own when its folder hasn't changed.
        openContextMenu(row, () => removeSavedTrack(selected, index), event, selectedPlaylistPaths?.[index] ?? track.path);
      });
      makeReorderable(row, index, elements["saved-playlists"], (from, to) => updateSavedTracks(selected, moveItem(selected.tracks, from, to), "reorder"));
      elements["saved-playlists"].append(row);
    });
  } else [...savedPlaylists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })).forEach((saved, index) => {
    const trackCount = saved.tracks.length;
    const row = itemRow(index, saved.name, [`${trackCount.toLocaleString()} ${trackCount === 1 ? "track" : "tracks"}`, formatTotal(saved.tracks)], "", "cursor-pointer sm:px-6");
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = row.querySelector("[data-title]").className;
    nameButton.textContent = saved.name;
    nameButton.addEventListener("click", () => selectPlaylist(saved));
    row.querySelector("[data-title]").replaceWith(nameButton);
    row.addEventListener("click", event => {
      if (!event.target.closest("button")) selectPlaylist(saved);
    });
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 gap-2";
    actions.append(
      button("rename", `Rename playlist: ${saved.name}`, () => openRename(saved), busy, true),
      button("load", `Load playlist: ${saved.name}`, () => loadPlaylist(saved), busy, true),
      button("clear", `Delete playlist: ${saved.name}`, () => removeSavedPlaylist(saved), busy, true)
    );
    row.append(actions);
    elements["saved-playlists"].append(row);
  });
  elements["playlist-empty"].classList.toggle("hidden", paths.length > 0);
  elements["clear-playlist"].disabled = busy || !paths.length;
  elements["save-playlist"].disabled = busy || !library || !paths.some(path => !isDropped(path));
  elements["save-submit"].disabled = busy || !paths.length;
  elements["playlist-name"].disabled = busy;
  elements["save-cancel"].disabled = busy;
  for (const id of ["generate-playlist", "generate-submit", "generate-minutes", "generate-toggle", "generate-cancel"]) elements[id].disabled = busy || !library;
  elements.playlist.replaceChildren();
  paths.forEach((path, index) => {
    const track = trackFor(path);
    const row = itemRow(index, track?.title || relativePath(path), track ? track.artist || "Unknown artist" : "Not found in library", track ? formatDuration(track.duration) : "", "select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary");
    row.dataset.path = path;
    row.tabIndex = 0;
    row.addEventListener("dblclick", event => {
      if (!event.target.closest("button") && track && !busy) playTrack(path);
    });
    row.addEventListener("keydown", event => {
      if (event.target !== row) return;
      if (event.key === "Enter" && track && !busy) playTrack(path);
      if (event.key === "Delete" && !busy) {
        const next = row.nextElementSibling || row.previousElementSibling;
        updatePlaylist(paths.filter((_, i) => i !== index)).then(() => next && elements.playlist.querySelector(`[data-path="${CSS.escape(next.dataset.path)}"]`)?.focus());
      }
    });
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      openContextMenu(row, () => updatePlaylist(paths.filter((_, i) => i !== index)), event, path);
    });
    makeReorderable(row, index, elements.playlist, (from, to) => updatePlaylist(moveItem(paths, from, to)));
    elements.playlist.append(row);
  });
  renderGapCountdown();
  renderPlayback();
}

// One playlist line: index, "title · subtitle" and a right-aligned time.
function itemRow(index, titleText, metaText, timeText, extraClass = "") {
  const row = document.createElement("div");
  row.className = `flex items-center gap-3 border-b border-bd-3 px-4 py-2 text-sm last:border-b-0 hover:bg-subtle ${extraClass}`;
  const number = document.createElement("span");
  number.className = "w-6 shrink-0 tabular-nums text-faint-2";
  number.textContent = String(index + 1);
  const details = document.createElement("div");
  details.className = "flex min-w-0 flex-1 items-baseline gap-2";
  const title = document.createElement("span");
  title.dataset.title = "";
  title.className = "max-w-[55%] shrink-0 truncate font-semibold text-fg-2";
  title.textContent = titleText;
  const parts = [].concat(metaText);
  details.append(title);
  parts.forEach((part, i) => {
    const separator = document.createElement("span");
    separator.className = "shrink-0 text-faint-2";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";
    const meta = document.createElement("span");
    meta.className = i === parts.length - 1 ? "min-w-0 flex-1 truncate text-soft" : "shrink-0 text-soft";
    meta.textContent = part;
    details.append(separator, meta);
  });
  const time = document.createElement("span");
  time.className = "shrink-0 tabular-nums text-soft";
  time.textContent = timeText;
  row.append(number, details, time);
  return row;
}

let dragState = null;
const dropMarks = ["shadow-[inset_0_2px_0_rgb(var(--c-primary))]", "shadow-[inset_0_-2px_0_rgb(var(--c-primary))]"];

// Makes a row draggable within its container; move(from, to) receives final indexes.
function makeReorderable(row, index, container, move) {
  const isAfter = event => event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
  const clearMarks = () => row.classList.remove(...dropMarks);
  row.draggable = true;
  row.addEventListener("dragstart", event => {
    if (busy || event.target !== row) return event.preventDefault();
    dragState = { container, index };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("opacity-50");
  });
  row.addEventListener("dragend", () => {
    dragState = null;
    row.classList.remove("opacity-50");
    for (const item of container.children) item.classList.remove(...dropMarks);
  });
  row.addEventListener("dragover", event => {
    if (dragState?.container !== container) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearMarks();
    row.classList.add(dropMarks[isAfter(event) ? 1 : 0]);
  });
  row.addEventListener("dragleave", event => {
    if (!row.contains(event.relatedTarget)) clearMarks();
  });
  row.addEventListener("drop", event => {
    if (dragState?.container !== container) return;
    event.preventDefault();
    clearMarks();
    const from = dragState.index;
    let to = index + (isAfter(event) ? 1 : 0);
    if (to > from) to--;
    dragState = null;
    if (to !== from && !busy) move(from, to);
  });
}

function moveItem(items, from, to) {
  const next = [...items];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

let contextRow = null;
let contextRemove = null;
// The library track the menu's "Edit tags" opens (null when the row's track can't be edited).
let contextTagPath = null;
// The track the menu's "Media info" opens (null when its file can't be reached: not in the library, nor dropped).
let contextInfoPath = null;

const GENERATE_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60];

function renderGenerateOptions() {
  elements["generate-options"].replaceChildren(...GENERATE_PRESETS.map(minutes => {
    const option = document.createElement("li");
    option.id = `generate-option-${minutes}`;
    option.setAttribute("role", "option");
    option.dataset.minutes = minutes;
    option.className = "group flex cursor-pointer items-center justify-between gap-4 py-1.5 pl-3 pr-2 tabular-nums hover:bg-subtle aria-selected:bg-tint aria-selected:font-semibold aria-selected:text-deep";
    option.innerHTML = `<span>${minutes} min</span><svg aria-hidden="true" class="invisible h-4 w-4 group-aria-selected:visible"><use href="#icon-added"></use></svg>`;
    return option;
  }));
}

function isGenerateOptionsOpen() {
  return !elements["generate-options"].classList.contains("hidden");
}

// Marks the preset matching the typed value; the full list always stays visible.
function syncGenerateOptions() {
  const input = elements["generate-minutes"];
  let selected = null;
  for (const option of elements["generate-options"].children) {
    const match = input.value !== "" && option.dataset.minutes === String(Number(input.value));
    option.setAttribute("aria-selected", String(match));
    if (match) selected = option;
  }
  if (selected) input.setAttribute("aria-activedescendant", selected.id);
  else input.removeAttribute("aria-activedescendant");
}

function openGenerateOptions() {
  const list = elements["generate-options"];
  if (elements["generate-minutes"].disabled) return;
  syncGenerateOptions();
  list.classList.remove("hidden");
  const field = elements["generate-field"].getBoundingClientRect();
  list.style.minWidth = `${field.width}px`;
  list.style.left = `${Math.max(4, Math.min(field.left, window.innerWidth - list.offsetWidth - 4))}px`;
  const below = field.bottom + 4;
  list.style.top = `${below + list.offsetHeight > window.innerHeight - 4 ? Math.max(4, field.top - list.offsetHeight - 4) : below}px`;
  elements["generate-minutes"].setAttribute("aria-expanded", "true");
  elements["generate-toggle"].setAttribute("aria-expanded", "true");
}

function closeGenerateOptions() {
  elements["generate-options"].classList.add("hidden");
  elements["generate-minutes"].setAttribute("aria-expanded", "false");
  elements["generate-toggle"].setAttribute("aria-expanded", "false");
}

function focusGenerateMinutes(open = false) {
  const input = elements["generate-minutes"];
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  if (open) openGenerateOptions();
}

// Arrow keys move to the next/previous preset, starting from whatever value is typed.
function stepGenerateMinutes(direction) {
  const input = elements["generate-minutes"];
  const current = Number(input.value) || 0;
  input.value = direction > 0
    ? GENERATE_PRESETS.find(minutes => minutes > current) ?? GENERATE_PRESETS.at(-1)
    : GENERATE_PRESETS.findLast(minutes => minutes < current) ?? GENERATE_PRESETS[0];
  focusGenerateMinutes(true);
}

function hideContextMenu() {
  elements["context-menu"].classList.add("hidden");
  contextRow?.classList.remove("outline", "outline-2", "-outline-offset-2", "outline-primary");
  contextRow = null;
  contextRemove = null;
  contextTagPath = null;
  contextInfoPath = null;
}

// Where an MP3's tags can be written, for library tracks and dropped music alike (null when they can't):
// - scope: what write access is asked for (the library folder, the dropped folder, or a dropped file itself);
// - fileHandle(): the track's file;
// - folder: the folder and path its lyrics files sit next to (null for a single dropped file, whose folder the browser
//   doesn't give);
// - source or drop: where the track comes from.
function tagTarget(path) {
  if (!path || !/\.mp3$/i.test(path)) return null;
  const drop = dropped.get(path);
  if (drop) {
    // Music dropped without a file handle (a browser without them) can be read but not written.
    if (!drop.handle && !drop.directory) return null;
    return {
      drop,
      scope: drop.directory || drop.handle,
      fileHandle: () => drop.handle || getTrackFileHandle(drop.directory, drop.relative),
      folder: drop.directory ? { directory: drop.directory, path: drop.relative } : null
    };
  }
  const source = sourceOf(path);
  if (!source || !library?.tracks.some(track => track.path === path)) return null;
  return {
    source,
    scope: source.handle,
    fileHandle: () => getTrackFileHandle(source.handle, relativePath(path)),
    folder: { directory: source.handle, path: relativePath(path) }
  };
}
const canEditTags = path => !!tagTarget(path);

// The menu shows the items that apply: "Media info" for a track whose file can be reached and "Edit tags" for a library
// track (trackPath), "Remove from playlist" when the row is in one (onRemove). Without any, there is nothing to show.
function openContextMenu(row, onRemove, event, trackPath = null) {
  hideContextMenu();
  const infoPath = trackPath && trackFor(trackPath) ? trackPath : null;
  const tagsPath = canEditTags(trackPath) ? trackPath : null;
  if (!infoPath && !tagsPath && !onRemove) return;
  contextRow = row;
  contextRemove = onRemove;
  contextTagPath = tagsPath;
  contextInfoPath = infoPath;
  showContextItems({ info: !!contextInfoPath, tags: !!contextTagPath, remove: !!onRemove });
  row.classList.add("outline", "outline-2", "-outline-offset-2", "outline-primary");
  const keyboard = event.clientX === 0 && event.clientY === 0;
  const bounds = row.getBoundingClientRect();
  placeContextMenu(keyboard ? bounds.left + 24 : event.clientX, keyboard ? bounds.bottom : event.clientY);
}

// Shows the given items (the rest are hidden) and focuses the first, for the arrow keys.
function showContextItems(shown) {
  for (const name of ["info", "tags", "remove", "reload", "install"]) {
    const item = elements[`context-${name}`];
    item.classList.toggle("hidden", !shown[name]);
    item.classList.toggle("flex", !!shown[name]);
    item.disabled = busy && name !== "reload" && name !== "install";
  }
}

// Opens the menu at a point, kept inside the window, with its first item focused.
function placeContextMenu(x, y) {
  const menu = elements["context-menu"];
  menu.classList.remove("hidden");
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  menu.querySelector("button:not(.hidden)")?.focus();
}

// Anywhere else, the menu holds what applies to the whole app.
function openGeneralMenu(event) {
  hideContextMenu();
  showContextItems({ reload: true, install: !!installPrompt });
  const keyboard = event.clientX === 0 && event.clientY === 0;
  placeContextMenu(keyboard ? 24 : event.clientX, keyboard ? 24 : event.clientY);
}

async function refreshSelectedPlaylistMatch() {
  const saved = savedPlaylists.find(item => item.id === selectedPlaylistId);
  const currentLibrary = library;
  selectedPlaylistPaths = null;
  if (!saved || !currentLibrary) return;
  try {
    const { paths } = await resolvePlaylist(saved, currentLibrary);
    if (selectedPlaylistId === saved.id && library === currentLibrary) {
      selectedPlaylistPaths = paths;
      render();
    }
  } catch (error) {
    console.error("Could not match playlist folders:", error);
    notice("Couldn't check the saved playlist's folders. Saved file paths are shown instead.", true);
  }
}

function selectPlaylist(saved) {
  currentView = "playlists";
  selectedPlaylistId = saved.id;
  selectedPlaylistPaths = null;
  render();
  refreshSelectedPlaylistMatch();
}

function openRename(saved) {
  selectPlaylist(saved);
  renamingId = saved.id;
  elements["rename-input"].value = saved.name;
  render();
  elements["rename-input"].focus();
  elements["rename-input"].setSelectionRange(saved.name.length, saved.name.length);
}

function closeRename() {
  renamingId = null;
  render();
}

async function renameSavedPlaylist() {
  const saved = savedPlaylists.find(item => item.id === renamingId);
  if (busy || !saved) return;
  const name = elements["rename-input"].value.trim();
  if (!name) {
    notice("Enter a playlist name.", true);
    elements["rename-input"].focus();
    return;
  }
  if (name === saved.name) return closeRename();
  if (savedPlaylists.some(item => item.id !== saved.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    notice(`A saved playlist named "${name}" already exists.`, true);
    elements["rename-input"].focus();
    return;
  }
  busy = true;
  render();
  try {
    const renamed = { ...saved, name };
    await saveSavedPlaylist(renamed);
    savedPlaylists = savedPlaylists.map(item => item.id === saved.id ? renamed : item);
    renamingId = null;
    notice(`Renamed playlist to "${name}".`);
  } catch (error) {
    console.error("Could not rename playlist:", error);
    notice("Couldn't rename the playlist. Its name was not changed.", true);
  } finally {
    busy = false;
    render();
  }
}

async function generatePlaylist() {
  if (busy || !library) return;
  const minutes = Number(elements["generate-minutes"].value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    notice("Enter how many minutes of music to generate.", true);
    elements["generate-minutes"].focus();
    return;
  }
  const { paths } = generatePlaylistPaths(library.tracks, minutes * 60, { exclude: playlistPaths() });
  if (!paths.length) {
    notice("Every track with a known duration is already in the playlist.", true);
    return;
  }
  if (!await updatePlaylist([...playlistPaths(), ...paths])) return;
  closeGenerateOptions();
  elements["generate-form"].classList.add("hidden");
  notice(`Added ${paths.length.toLocaleString()} random ${paths.length === 1 ? "track" : "tracks"} (${formatTotal(paths.map(trackFor))}).`);
  // Start the new tracks unless something is already playing.
  if (!player.path || player.audio.paused) await playTrack(paths[0]);
}

// A file name made of `name` (letters, digits, spaces and _.- only) and the extension, or `fallback` when nothing is left.
const safeFileName = (name, fallback, extension) => `${String(name ?? "").replace(/[^\p{L}\p{N} _.-]+/gu, "").trim() || fallback}${extension}`;

function downloadJson(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPlaylists(playlists, name) {
  const fileName = safeFileName(name, "playlist", ".json");
  downloadJson(fileName, serializePlaylists(playlists));
  notice(`Exported ${playlists.length.toLocaleString()} ${playlists.length === 1 ? "playlist" : "playlists"} to ${fileName}.`);
}

async function importPlaylists(files) {
  if (busy || !files.length) return;
  if (!library) {
    notice("Choose your music folder before importing playlists.", true);
    return;
  }
  busy = true;
  render();
  const imported = [];
  const problems = [];
  try {
    const names = savedPlaylists.map(saved => saved.name);
    for (const file of files) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new PlaylistFileError("The file is too large.");
        for (const parsed of parsePlaylists(await file.text())) {
          const saved = createImportedPlaylist(parsed, library, names);
          await saveSavedPlaylist(saved);
          names.push(saved.name);
          imported.push(saved);
        }
      } catch (error) {
        if (!(error instanceof PlaylistFileError)) throw error;
        problems.push(`${file.name}: ${error.message}`);
      }
    }
    const summary = imported.length ? `Imported ${imported.length.toLocaleString()} ${imported.length === 1 ? "playlist" : "playlists"}.` : "";
    notice([summary, ...problems].filter(Boolean).join(" "), problems.length > 0);
  } catch (error) {
    console.error("Could not import playlists:", error);
    notice("Couldn't save the imported playlists. Your saved playlists may be incomplete.", true);
  } finally {
    savedPlaylists = [...savedPlaylists, ...imported];
    busy = false;
    render();
  }
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
  if (existing && !window.confirm(`Replace the saved playlist "${existing.name}"?`)) return;
  busy = true;
  render();
  try {
    // Dropped music isn't in the library, so a saved playlist can't find it again.
    const skipped = playlistPaths().filter(isDropped).length;
    const saved = createSavedPlaylist(name, { ...library, playlist: playlistPaths().filter(path => !isDropped(path)) }, existing);
    await saveSavedPlaylist(saved);
    savedPlaylists = [...savedPlaylists.filter(item => item.id !== saved.id), saved];
    library = { ...library, loadedPlaylistId: saved.id };
    await saveLibrary(library);
    await refreshSelectedPlaylistMatch();
    elements["save-form"].classList.add("hidden");
    elements["playlist-name"].value = "";
    notice(`Saved playlist "${saved.name}".${skipped ? ` ${skipped.toLocaleString()} dropped ${skipped === 1 ? "track was" : "tracks were"} left out, as ${skipped === 1 ? "it isn't" : "they aren't"} in the library.` : ""}`);
  } catch (error) {
    console.error("Could not save named playlist:", error);
    notice("Couldn't save the playlist. Your saved playlists were not changed.", true);
  } finally {
    busy = false;
    render();
  }
  if (elements["save-form"].classList.contains("hidden")) elements["save-playlist"].focus();
}

// Loads a saved playlist into the current one; returns the loaded track keys, or null.
async function loadPlaylist(saved) {
  if (busy) return null;
  busy = true;
  render();
  let resolved = null;
  try {
    resolved = await resolvePlaylist(saved, library);
  } catch (error) {
    console.error("Could not match playlist folders:", error);
    notice("Couldn't check the saved playlist's folders. Add its music folders and try again.", true);
  } finally {
    busy = false;
    render();
  }
  if (!resolved) return null;
  const anyFound = resolved.paths.some(path => sourceOf(path) || dropped.has(path));
  if (!anyFound && saved.tracks.length) {
    notice(`Add ${resolved.missing.length === 1 ? "the folder" : "the folders"} ${quoteNames(resolved.missing)} before loading this playlist.`, true);
    return null;
  }
  if (!await updatePlaylist(resolved.paths, { loadedPlaylistId: saved.id })) return null;
  notice(`Loaded playlist "${saved.name}".${resolved.missing.length ? ` Tracks from ${quoteNames(resolved.missing)} aren't in the library.` : ""}`, resolved.missing.length > 0);
  return resolved.paths;
}

async function removeSavedTrack(saved, index) {
  return updateSavedTracks(saved, saved.tracks.filter((_, i) => i !== index), "remove");
}

async function updateSavedTracks(saved, tracks, action) {
  if (busy) return;
  busy = true;
  render();
  try {
    const updated = { ...saved, tracks };
    await saveSavedPlaylist(updated);
    savedPlaylists = savedPlaylists.map(item => item.id === saved.id ? updated : item);
  } catch (error) {
    console.error("Could not update playlist:", error);
    notice(`Couldn't ${action} the track. The playlist was not changed.`, true);
  } finally {
    busy = false;
    render();
  }
}

async function playSavedTrack(saved, index) {
  if (busy) return;
  let paths = null;
  if (loadedPlaylistId() === saved.id) {
    try {
      ({ paths } = await resolvePlaylist(saved, library));
    } catch (error) {
      console.error("Could not match playlist folders:", error);
    }
  }
  const loaded = paths && playlistPaths().length === paths.length && playlistPaths().every((item, i) => item === paths[i]);
  if (!loaded) paths = await loadPlaylist(saved);
  if (paths) playTrack(paths[index]);
}

async function removeSavedPlaylist(saved) {
  if (busy || !window.confirm(`Delete the saved playlist "${saved.name}"?`)) return;
  busy = true;
  render();
  try {
    await deleteSavedPlaylist(saved.id);
    savedPlaylists = savedPlaylists.filter(item => item.id !== saved.id);
    if (unsavedLoadedId === saved.id) unsavedLoadedId = null;
    if (library?.loadedPlaylistId === saved.id) {
      library = { ...library, loadedPlaylistId: null };
      await saveLibrary(library);
    }
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

async function updatePlaylist(paths, extra = {}) {
  if (busy) return false;
  const added = paths.filter(path => !playlistPaths().includes(path));
  if (!library) {
    unsavedPlaylist = paths;
    unsavedLoadedId = paths.length ? extra.loadedPlaylistId ?? unsavedLoadedId : null;
    if ((player.path && !paths.includes(player.path)) || (player.pendingPath && !paths.includes(player.pendingPath))) player.stop();
    forgetDropped(paths);
    await growDirectPlaylist(added, extra);
    render();
    return true;
  }
  busy = true;
  render();
  try {
    const next = { ...library, playlist: paths, ...extra, ...(paths.length ? {} : { loadedPlaylistId: null }) };
    await saveLibrary(next);
    library = next;
    if ((player.path && !paths.includes(player.path)) || (player.pendingPath && !paths.includes(player.pendingPath))) {
      player.stop();
      clearSession();
    }
    forgetDropped(paths);
    await growDirectPlaylist(added, extra);
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

// While a direct-play playlist is the current one, whatever is added to the current playlist is added to it too.
async function growDirectPlaylist(added, extra) {
  const saved = savedPlaylists.find(item => item.id === loadedPlaylistId());
  if (!added.length || "loadedPlaylistId" in extra || !isDirectPlaylist(saved)) return;
  const known = new Set(saved.tracks.map(track => track.path));
  const fresh = added.filter(path => !known.has(path));
  if (!fresh.length) return;
  try {
    await appendToSavedPlaylist(saved, fresh);
  } catch (error) {
    console.error("Could not update the direct-play playlist:", error);
    notice(`Couldn't add the new tracks to "${saved.name}". They're in the current playlist only.`, true);
  }
}

function forgetDropped(paths) {
  // Tracks of saved direct-play playlists stay playable even when they leave the current playlist.
  const kept = new Set([...paths, ...savedPlaylists.filter(isDirectPlaylist).flatMap(saved => saved.tracks.map(track => track.path))]);
  for (const key of dropped.keys()) {
    if (!kept.has(key) && key !== player.path) {
      dropped.delete(key);
      lyricsCache.delete(key);
    }
  }
}

// Dropping music (on the current playlist or the playlists' import button) works in steps shared by both targets.

// Everything on a DataTransfer must be taken synchronously, before the first await.
function takeDrop(dataTransfer) {
  const items = [...dataTransfer.items].filter(item => item.kind === "file");
  const files = [...dataTransfer.files];
  const handles = "getAsFileSystemHandle" in DataTransferItem.prototype ? items.map(item => item.getAsFileSystemHandle().catch(() => null)) : [];
  return { count: Math.max(items.length, files.length), files, handles };
}

// Music in what was dropped (folders read recursively, in natural order), files that may hold lyrics, and any other files.
async function readDrop({ count, files, handles }) {
  const found = [];
  const texts = [];
  const others = [];
  for (let i = 0; i < count; i++) {
    const handle = await handles[i];
    if (handle?.kind === "directory") {
      const inFolder = [];
      for await (const { path, handle: fileHandle } of findAudioFiles(handle)) inFolder.push({ handle: fileHandle, directory: handle, relative: path });
      inFolder.sort((a, b) => a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: "base" }));
      found.push(...inFolder.map(item => ({ ...item, label: `${handle.name}/${item.relative}` })));
      continue;
    }
    const file = handle ? await handle.getFile() : files[i];
    if (!file) continue;
    if (isAudioFile(file.name)) found.push({ file, handle, relative: file.name, label: file.name });
    else if (isLyricsFile(file.name)) texts.push(file);
    else others.push(file);
  }
  return { found, texts, others };
}

// Makes dropped music playable in this session; returns its keys.
function registerDrop(found, texts) {
  const baseName = name => name.replace(/\.[^.]*$/, "").toLocaleLowerCase();
  return found.map(item => {
    // Unique across reloads, since direct-play playlists keep these keys.
    const key = `drop:${crypto.randomUUID().slice(0, 8)}/${item.label}`;
    const name = item.relative.split("/").pop();
    // Every format is kept, so switching the lyrics format still finds the matching one.
    const lyricsFiles = item.file ? texts.filter(text => baseName(text.name) === baseName(name)) : [];
    dropped.set(key, { ...item, lyricsFiles, track: { path: key, title: name.replace(/\.[^.]*$/, ""), artist: "", album: "", trackNumber: null, year: null, duration: null } });
    return key;
  });
}

// Saves a direct-play playlist of dropped music, named after a single dropped folder or "Direct play 001"…
async function createDirectPlaylist(found, keys) {
  const folders = [...new Set(found.map(item => item.directory?.name ?? null))];
  const folderName = folders.length === 1 && folders[0] ? folders[0] : null;
  const names = savedPlaylists.map(saved => saved.name);
  let name = folderName ? uniquePlaylistName(folderName, names) : null;
  for (let number = 1; !name; number++) {
    const candidate = `Direct play ${String(number).padStart(3, "0")}`;
    if (!names.some(existing => existing.toLocaleLowerCase() === candidate.toLocaleLowerCase())) name = candidate;
  }
  const saved = { id: crypto.randomUUID(), name, instant: true, sources: [], tracks: keys.map(trackSnapshot), savedAt: Date.now() };
  try {
    await saveSavedPlaylist(saved);
  } catch (error) {
    console.error("Could not save the direct-play playlist:", error);
    for (const key of keys) dropped.delete(key);
    notice("Couldn't save the new playlist. Check your browser's storage settings and try again.", true);
    return null;
  }
  savedPlaylists = [...savedPlaylists, saved];
  return saved;
}

// Reads tags and durations of dropped music in the background, then stores them in the direct-play playlists holding it.
async function fillDropDetails(keys) {
  let lastRender = Date.now();
  for (const key of keys) {
    const entry = dropped.get(key);
    if (!entry) continue;
    try {
      const metadata = await readMetadata(await droppedFile(entry));
      Object.assign(entry.track, {
        title: metadata.title || entry.track.title,
        artist: metadata.artist,
        album: metadata.album,
        trackNumber: metadata.trackNumber,
        year: metadata.year,
        duration: metadata.duration
      });
    } catch (error) {
      console.error("Could not read dropped file:", error);
    }
    if (Date.now() - lastRender > 400) {
      lastRender = Date.now();
      render();
    }
  }
  const keySet = new Set(keys);
  for (const saved of savedPlaylists.filter(item => isDirectPlaylist(item) && item.tracks.some(track => keySet.has(track.path)))) {
    const updated = { ...saved, tracks: saved.tracks.map(track => keySet.has(track.path) ? trackSnapshot(track.path) : track) };
    try {
      await saveSavedPlaylist(updated);
      savedPlaylists = savedPlaylists.map(item => item.id === saved.id ? updated : item);
    } catch (error) {
      console.error("Could not update the playlist's track details:", error);
    }
  }
  render();
}

// Dropped on the current playlist: an empty one becomes a new direct-play playlist; otherwise the music is appended
// (and added to the direct-play playlist if that's the one loaded). Playback starts right away unless something plays.
async function dropToPlaylist(dataTransfer) {
  return addToPlaylist(takeDrop(dataTransfer));
}

// What dropToPlaylist does with a drop (see takeDrop), also used for files opened with the installed app. playNow:
// play the first of them even if something is playing (opening a file means wanting to hear it).
async function addToPlaylist(drop, { playNow = false } = {}) {
  let found, texts;
  try {
    ({ found, texts } = await readDrop(drop));
  } catch (error) {
    console.error("Could not read dropped items:", error);
    notice("Couldn't read what was dropped. Check browser permissions and try again.", true);
    return;
  }
  if (!found.length) {
    notice("No music files in what was dropped.", true);
    return;
  }
  const keys = registerDrop(found, texts);
  const count = `${keys.length.toLocaleString()} ${keys.length === 1 ? "track" : "tracks"}`;
  let message;
  if (!playlistPaths().length) {
    const saved = await createDirectPlaylist(found, keys);
    if (!saved) return;
    if (!await updatePlaylist(keys, { loadedPlaylistId: saved.id })) {
      if (busy) notice(`Saved "${saved.name}". Wait for the current task to finish, then load it.`, true);
      return;
    }
    message = `Created playlist "${saved.name}" with ${count}. Dropped music plays from its files and isn't added to the library.`;
  } else {
    const direct = savedPlaylists.find(saved => saved.id === loadedPlaylistId() && isDirectPlaylist(saved));
    if (!await updatePlaylist([...playlistPaths(), ...keys])) {
      for (const key of keys) dropped.delete(key);
      if (busy) notice("Wait for the current task to finish, then drop again.", true);
      return;
    }
    message = direct ? `Added ${count} to "${direct.name}".` : `Added ${count}. Dropped music plays from its files and isn't added to the library.`;
  }
  notice(message);
  if (playNow || !player.path || player.audio.paused) playTrack(keys[0]);
  await fillDropDetails(keys);
}

const SESSION_KEY = "playback-session";
let pendingSession = null;
let lastSessionSave = 0;

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return typeof session?.path === "string" ? { path: session.path, time: Number.isFinite(session.time) ? Math.max(0, session.time) : 0, playing: session.playing === true } : null;
  } catch (error) {
    console.error("Could not read the saved playback position:", error);
    return null;
  }
}

function saveSession(force = false) {
  // Without metadata the position is still 0, which would overwrite the saved one.
  if (!player.path || player.audio.readyState === 0) return;
  const now = Date.now();
  if (!force && now - lastSessionSave < 1000) return;
  lastSessionSave = now;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ path: player.path, time: player.audio.currentTime || 0, playing: !player.audio.paused }));
  } catch (error) {
    console.error("Could not save the playback position:", error);
  }
}

function clearSession() {
  pendingSession = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.error("Could not clear the playback position:", error);
  }
}

async function restoreSession() {
  const session = pendingSession;
  if (!session || !library || player.path || player.pendingPath) return;
  // Sessions saved before multiple sources existed hold a path inside the (then only) folder.
  const path = splitKey(session.path).sourceId || !library.sources.length ? session.path : `${library.sources[0].id}:${session.path}`;
  const source = sourceOf(path);
  if (source && permissionOf(source) !== "granted") return;
  pendingSession = null;
  if (!source || !playlistPaths().includes(path) || !trackFor(path)) {
    clearSession();
    return;
  }
  try {
    await player.play(source.handle, path, { startAt: session.time, autoplay: session.playing, filePath: relativePath(path) });
  } catch (error) {
    // Browsers may block autoplay after a reload; the track stays loaded and paused.
    if (error.name === "NotAllowedError" || error.name === "AbortError") return;
    console.error("Could not restore playback:", error);
    clearSession();
  }
}

async function playTrack(path) {
  const drop = dropped.get(path);
  if (drop) {
    try {
      await player.play(null, path, { file: await droppedFile(drop, { ask: true }) });
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Playback failed:", error);
      notice(error.name === "NotAllowedError" || error.name === "SecurityError" ? "Access to this file wasn't granted. Play it again to allow access." : "Couldn't play this dropped file. It may have been moved, removed, or be unsupported.", true);
    }
    return;
  }
  const source = sourceOf(path);
  if (!library || !trackFor(path) || !source) {
    notice("This playlist track is not in the library. Rescan or remove it.", true);
    return;
  }
  if (permissionOf(source) !== "granted") {
    notice(`Reconnect "${source.name}" before playing its tracks.`, true);
    return;
  }
  try {
    await player.play(source.handle, path, { filePath: relativePath(path) });
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Playback failed:", error);
    const state = await checkPermission(source);
    notice(state === "granted" ? "Couldn't play this file. It may have been moved, removed, or be unsupported. Try rescanning." : `Access to "${source.name}" expired. Reconnect it to play its tracks.`, true);
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

// Scans the given sources one after another, saving after each so a failure keeps the folders already done.
async function scanSources(sources) {
  if (busy || !sources.length) return;
  busy = true;
  render();
  const several = sources.length > 1;
  const scanned = [];
  const failed = [];
  const warnings = [];
  let total = 0;
  try {
    for (const source of sources) {
      const prefix = several ? `Scanning "${source.name}" (${scanned.length + failed.length + 1} of ${sources.length})…` : `Scanning "${source.name}"…`;
      notice(prefix, false, [], { sticky: true });
      try {
        const contents = await listContents(source.handle);
        const result = await scanLibrary(source.handle, readMetadata, count => notice(`${prefix} ${count.toLocaleString()} tracks indexed`, false, [], { sticky: true }));
        const next = withSourceTracks(library, { ...source, contents, scannedAt: Date.now() }, result.tracks);
        await saveLibrary(next);
        library = next;
        permissions.set(source.id, "granted");
        scanned.push(source);
        total += result.tracks.length;
        warnings.push(...result.warnings.map(warning => several ? { ...warning, path: `${source.name}/${warning.path}` } : warning));
      } catch (error) {
        console.error(`Scan of "${source.name}" failed:`, error);
        failed.push(source);
        if (library?.sources.some(item => item.id === source.id)) await checkPermission(source);
      }
    }
    lyricsCache.clear();
    await refreshSelectedPlaylistMatch();
    const parts = [];
    if (scanned.length) parts.push(`${several ? `Scanned ${scanned.length.toLocaleString()} folders` : `Scanned "${scanned[0].name}"`}: ${total.toLocaleString()} ${total === 1 ? "track" : "tracks"}.`);
    if (failed.length) parts.push(`Couldn't scan ${quoteNames(failed.map(source => source.name))}. Check folder access and try again.`);
    if (warnings.length) parts.push(`${warnings.length.toLocaleString()} ${warnings.length === 1 ? "track has" : "tracks have"} unreadable information:`);
    notice(parts.join(" "), failed.length > 0 || warnings.length > 0, warnings);
  } finally {
    busy = false;
    render();
    restoreSession();
  }
}

// Adds folders as new sources; a folder that is already a source is rescanned instead.
async function addFolders(handles) {
  if (busy || !handles.length) return;
  const targets = [];
  for (const handle of handles) {
    let existing = null;
    for (const source of [...(library?.sources || []), ...targets]) {
      try {
        if (await withTimeout(source.handle.isSameEntry(handle), PERMISSION_TIMEOUT, "Timed out comparing folders.")) {
          existing = source;
          break;
        }
      } catch (error) {
        console.error("Could not compare folders:", error);
      }
    }
    if (targets.includes(existing)) continue;
    targets.push(existing ? { ...existing, handle } : { id: crypto.randomUUID(), handle, name: handle.name, scannedAt: null });
  }
  await scanSources(targets);
}

async function reconnectSources(sources) {
  if (busy || !sources.length) return;
  // A permission prompt can legitimately stay open a while, so this only explains a silent wait.
  const stuckTimer = setTimeout(() => notice(STUCK_ACCESS_HELP, true, [], { sticky: true }), 5000);
  try {
    for (const source of sources) {
      try {
        permissions.set(source.id, await source.handle.requestPermission({ mode: "read" }));
      } catch (error) {
        console.error(`Could not reconnect "${source.name}":`, error);
      }
    }
  } finally {
    clearTimeout(stuckTimer);
  }
  render();
  const missing = sources.filter(source => permissionOf(source) !== "granted");
  if (missing.length) notice(`No access to ${quoteNames(missing.map(source => source.name))}. Reconnect again, or remove and re-add the folder.`, true);
  else notice(sources.length === 1 ? `Reconnected "${sources[0].name}".` : "Folders reconnected.");
  restoreSession();
}

// Forgets one folder: its tracks leave the library and the current playlist. The folder on disk is untouched.
async function removeSource(source) {
  if (busy || !confirm(`Remove "${source.name}" from the library? Its tracks leave the library and the current playlist. The folder itself isn't touched.`)) return;
  if (library.sources.length === 1) return resetLibrary(`Removed "${source.name}". Add a folder to start again.`);
  busy = true;
  render();
  try {
    const next = withoutSource(library, source.id);
    await saveLibrary(next);
    if (splitKey(player.path || player.pendingPath || "").sourceId === source.id) {
      player.stop();
      clearSession();
    }
    library = next;
    permissions.delete(source.id);
    lyricsCache.clear();
    validateRoute();
    await refreshSelectedPlaylistMatch();
    notice(`Removed "${source.name}".`);
  } catch (error) {
    console.error("Could not remove source:", error);
    notice(`Couldn't remove "${source.name}". Check your browser's storage settings and try again.`, true);
  } finally {
    busy = false;
    render();
  }
}

elements["dismiss-notice"].addEventListener("click", hideNotice);

// Forgets every folder, their index and the current playlist. Saved playlists are kept.
async function resetLibrary(message = "Library cleared. Add a folder to start again.") {
  if (busy || !library) return;
  busy = true;
  render();
  try {
    await deleteLibrary();
    player.stop();
    clearSession();
    library = null;
    permissions.clear();
    libraryGroup = null;
    artistAlbum = null;
    lyricsCache.clear();
    await refreshSelectedPlaylistMatch();
    notice(message);
  } catch (error) {
    console.error("Library reset failed:", error);
    notice("Couldn't clear the library. Check your browser's storage settings and try again.", true);
  } finally {
    busy = false;
    render();
    if (!library) elements["choose-folder"].focus();
  }
}

elements["reset-library"].addEventListener("click", () => {
  if (confirm("Remove all folders from the library? This forgets their index and the current playlist. Saved playlists are kept.")) resetLibrary();
});

const dropActive = ["scale-[2]", "border-2", "border-dashed", "!border-primary", "!animate-none"];
// Extra emphasis while the drag is over the button itself, i.e. a drop would land.
const dropHover = ["!border-solid", "!bg-accent-soft", "!text-deep", "ring-4", "ring-primary/20"];

const dragHasFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
const canDropFolder = () => !busy && "showDirectoryPicker" in window && "getAsFileSystemHandle" in DataTransferItem.prototype;

async function dropFolder(dataTransfer) {
  try {
    const handles = await Promise.all([...dataTransfer.items].filter(item => item.kind === "file").map(item => item.getAsFileSystemHandle()));
    const folders = handles.filter(handle => handle?.kind === "directory");
    if (!folders.length) notice("Drop folders, not files.", true);
    else await addFolders(folders);
  } catch (error) {
    console.error("Folder drop failed:", error);
    notice("Couldn't open that folder. Check browser permissions and try again.", true);
  }
}

// Dropped on the playlists' import button: exported playlist files are imported; music files and folders become a new
// direct-play playlist (saved and shown, not loaded into the current playlist). Neither touches the library.
async function dropOnPlaylists(dataTransfer) {
  const drop = takeDrop(dataTransfer);
  let found, texts, others;
  try {
    ({ found, texts, others } = await readDrop(drop));
  } catch (error) {
    console.error("Could not read dropped items:", error);
    notice("Couldn't read what was dropped. Check browser permissions and try again.", true);
    return;
  }
  const exported = others.filter(file => file.type === "application/json" || /\.json$/i.test(file.name));
  if (!exported.length && !found.length) {
    notice("Drop exported playlists (.json), or music files or folders.", true);
    return;
  }
  if (exported.length) await importPlaylists(exported);
  if (!found.length) return;
  const keys = registerDrop(found, texts);
  const saved = await createDirectPlaylist(found, keys);
  if (!saved) return;
  selectPlaylist(saved);
  notice(`Created playlist "${saved.name}" with ${keys.length.toLocaleString()} ${keys.length === 1 ? "track" : "tracks"}. Load it to play; dropped music plays from its files and isn't added to the library.`);
  await fillDropDetails(keys);
}

// Buttons that accept dropped files. The import button is re-created on render, so targets are looked up on demand.
const dropTargets = [
  { element: () => elements["choose-folder"], enabled: canDropFolder, drop: dropFolder, text: "Drop folders" },
  // Same look as the buttons, except a whole panel can't grow: the dashed edge is an inset outline (so the list doesn't
  // shift) and the caption sits in its middle.
  {
    element: () => elements["playlist-drop"], enabled: () => !busy, drop: dropToPlaylist, text: "Drop to play", inside: true,
    active: ["outline", "outline-[3px]", "outline-dashed", "-outline-offset-4", "outline-primary"], hover: ["!outline", "!bg-accent-soft", "!text-deep"]
  },
  // The playlists card clips its contents (rounded corners), which would cut off the enlarged button, so unclip it while dragging.
  { element: () => document.querySelector("[data-drop=playlists]"), enabled: () => !busy, drop: dropOnPlaylists, text: "Drop playlists (.json) or music", unclip: node => node.closest("section") }
];

function activeDropTargets() {
  return dropTargets.map(target => ({ ...target, node: target.element() })).filter(target => target.node?.offsetParent && target.enabled());
}

function dropTargetAt(event) {
  return activeDropTargets().find(target => target.node.contains(event.target));
}

// A caption under each drop target saying what it accepts. Fixed to the page so card clipping can't hide it.
function placeDropLabel(target, node, hovered) {
  if (!node) {
    target.label?.classList.add("hidden");
    return;
  }
  if (!target.label) {
    target.label = document.createElement("div");
    target.label.setAttribute("aria-hidden", "true");
    target.label.textContent = target.text;
    document.body.append(target.label);
  }
  const label = target.label;
  label.className = `pointer-events-none fixed z-50 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium shadow-sm transition-colors ${hovered ? "bg-primary text-on-primary" : "border border-bd-ok bg-ok-soft text-deep"}`;
  const bounds = node.getBoundingClientRect();
  const left = bounds.left + bounds.width / 2 - label.offsetWidth / 2;
  label.style.left = `${Math.max(4, Math.min(left, window.innerWidth - label.offsetWidth - 4))}px`;
  const top = target.inside ? bounds.top + Math.min(bounds.height, window.innerHeight - bounds.top) / 2 - label.offsetHeight / 2 : bounds.bottom + 6;
  label.style.top = `${Math.max(4, Math.min(top, window.innerHeight - label.offsetHeight - 4))}px`;
}

function setDropState(active, hovered = null) {
  for (const target of dropTargets) {
    const node = target.element();
    if (!node) continue;
    const on = active && !!node.offsetParent && target.enabled();
    node.classList.toggle("relative", on);
    node.classList.toggle("z-10", on);
    for (const name of target.active || dropActive) node.classList.toggle(name, on);
    for (const name of target.hover || dropHover) node.classList.toggle(name, on && node === hovered);
    target.unclip?.(node)?.classList.toggle("!overflow-visible", on);
    placeDropLabel(target, on && node, node === hovered);
  }
}

// dragenter/dragleave pairs get unbalanced as the cursor crosses (or re-rendered) child elements, which made the targets flicker.
// dragover keeps firing every few dozen ms while a drag is over the page, so the state lives as long as dragover does.
let dragEndTimer = 0;
function endDrag() {
  clearTimeout(dragEndTimer);
  setDropState(false);
}

document.addEventListener("dragover", event => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  const target = dropTargetAt(event);
  event.dataTransfer.dropEffect = target ? "copy" : "none";
  setDropState(true, target?.node);
  clearTimeout(dragEndTimer);
  dragEndTimer = setTimeout(endDrag, 200);
});
document.addEventListener("drop", async event => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  const target = dropTargetAt(event);
  endDrag();
  if (target) await target.drop(event.dataTransfer);
});
document.addEventListener("dragend", endDrag);
elements["choose-folder"].addEventListener("click", async () => {
  try {
    await addFolders([await window.showDirectoryPicker({ mode: "read" })]);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Folder selection failed:", error);
      notice("Couldn't open that folder. Check browser permissions and try again.", true);
    }
  }
});
elements.reconnect.addEventListener("click", () => reconnectSources(sourcesNeedingAccess()));
elements.rescan.addEventListener("click", () => {
  const sources = library.sources.filter(source => permissionOf(source) === "granted");
  scanSources(sources);
});
elements.search.addEventListener("input", render);
for (const sortButton of sortButtons) {
  sortButton.addEventListener("click", () => {
    const key = sortButton.dataset.sort;
    sortDirection = key === sortKey && sortDirection === "ascending" ? "descending" : "ascending";
    sortKey = key;
    render();
  });
}
// A card in the album grid: the cover, with play and add buttons showing on it, and the name, artist and year below.
function albumCard(group, name, showArtist, open) {
  const card = document.createElement("div");
  card.className = "group min-w-0 cursor-pointer";
  card.addEventListener("click", event => {
    if (!event.target.closest("button")) open();
  });
  const cover = coverTile("aspect-square w-full shadow-sm transition-shadow group-hover:shadow-md", () => covers.album(group.tracks));
  const paths = group.tracks.map(track => track.path);
  const missing = paths.filter(path => !playlistPaths().includes(path));
  const addGroup = () => missing.length ? updatePlaylist([...playlistPaths(), ...missing]) : Promise.resolve(true);
  const actions = document.createElement("div");
  actions.className = "absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100";
  actions.append(
    button("play", `Play album: ${name}`, async () => {
      if (await addGroup()) await playTrack(paths[0]);
    }, busy, "small"),
    button(missing.length ? "add" : "added", `${missing.length ? "Add to playlist" : "Added to playlist"}: ${name}`, addGroup, busy || !missing.length, "small")
  );
  cover.append(actions);
  const title = document.createElement("button");
  title.type = "button";
  title.className = "mt-2 block max-w-full truncate text-left text-sm font-medium text-fg-2";
  title.textContent = name;
  title.title = name;
  title.addEventListener("click", open);
  const details = document.createElement("p");
  details.className = "truncate text-sm text-soft";
  details.textContent = [showArtist ? groupArtistLabel(group) : "", group.year ?? ""].filter(Boolean).join(" · ");
  card.append(cover, title, details);
  return card;
}

// The grid's sorts, as the table's column headings offer them (the artist only where albums of several show).
const ALBUM_SORTS = [["name", "Name"], ["artist", "Artist"], ["year", "Year"], ["tracks", "Tracks"], ["duration", "Time"]];

function renderAlbumViewControls(shown, grid, slot, withArtist) {
  const controls = elements["album-view-controls"];
  controls.classList.toggle("hidden", !shown);
  controls.classList.toggle("flex", shown);
  for (const choice of controls.querySelectorAll("[data-album-view]")) {
    const active = choice.dataset.albumView === albumView;
    choice.setAttribute("aria-pressed", String(active));
    choice.classList.toggle("bg-sel", active);
    choice.classList.toggle("font-semibold", active);
    choice.classList.toggle("text-deep", active);
    choice.classList.toggle("bg-field", !active);
    choice.classList.toggle("hover:bg-tint-2", !active);
  }
  elements["album-sort-controls"].classList.toggle("hidden", !grid);
  elements["album-sort-controls"].classList.toggle("flex", grid);
  if (!grid) return;
  const select = elements["album-sort"];
  const options = ALBUM_SORTS.filter(([key]) => key !== "artist" || withArtist);
  const signature = options.map(([key]) => key).join();
  if (select.dataset.options !== signature) {
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    select.dataset.options = signature;
  }
  const state = groupSort[slot];
  select.value = options.some(([key]) => key === state.key) ? state.key : "name";
  const ascending = state.direction === "ascending";
  elements["album-sort-direction"].textContent = ascending ? "↑" : "↓";
  elements["album-sort-direction"].title = ascending ? "Ascending" : "Descending";
  elements["album-sort-direction"].setAttribute("aria-label", ascending ? "Ascending; switch to descending" : "Descending; switch to ascending");
}

// The cover by an album page's title; key tells pages apart, so it only changes when the page does.
let libraryCoverKey = null;
let libraryCoverTracks = null;
function renderLibraryCover(tracks, key) {
  libraryCoverTracks = tracks;
  if (key === libraryCoverKey) return;
  libraryCoverKey = key;
  const image = elements["library-cover"];
  image.classList.add("hidden");
  image.removeAttribute("src");
  if (!tracks?.length) return;
  covers.album(tracks).then(url => {
    if (!url || libraryCoverKey !== key) return;
    image.src = url;
    image.classList.remove("hidden");
  });
}

for (const choice of document.querySelectorAll("[data-album-view]")) {
  choice.addEventListener("click", () => {
    albumView = choice.dataset.albumView;
    try { localStorage.setItem("albumView", albumView); } catch {}
    render();
  });
}
elements["album-sort"].addEventListener("change", () => {
  groupSort[libraryShape().sortSlot].key = elements["album-sort"].value;
  render();
});
elements["album-sort-direction"].addEventListener("click", () => {
  const state = groupSort[libraryShape().sortSlot];
  state.direction = state.direction === "ascending" ? "descending" : "ascending";
  render();
});

for (const sortButton of groupSortButtons) {
  sortButton.addEventListener("click", () => {
    const state = groupSort[libraryShape().sortSlot];
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
elements["nav-analysis"].addEventListener("click", () => { currentView = "analysis"; render(); });
elements["nav-visualizer"].addEventListener("click", () => { currentView = "visualizer"; render(); });
elements["nav-lyrics"].addEventListener("click", () => { currentView = "lyrics"; render(); });

// Visualizer mode: 2D bars or the 3D terrain (three.js, loaded on first use). Remembered per browser.
const vizModeButtons = [...document.querySelectorAll("[data-viz-mode]")];
function setVisualizerMode(mode) {
  visualizer.setMode(mode);
  const is3d = visualizer.mode === "3d";
  // Invisible rather than hidden: the canvas keeps its size for when 2D comes back.
  $("visualizer-canvas").classList.toggle("invisible", is3d);
  $("visualizer-stage").classList.toggle("hidden", !is3d);
  $("visualizer-hint").classList.toggle("hidden", !is3d);
  $("visualizer-sheet-control").classList.toggle("hidden", !is3d);
  $("visualizer-sheet-control").classList.toggle("flex", is3d);
  for (const button of vizModeButtons) button.setAttribute("aria-pressed", String(button.dataset.vizMode === visualizer.mode));
  try { localStorage.setItem("visualizerMode", visualizer.mode); } catch {}
}
visualizer.onTerrainError = () => {
  notice("Couldn't load the 3D visualizer. Showing the bars instead.", true);
  setVisualizerMode("2d");
};
for (const button of vizModeButtons) button.addEventListener("click", () => setVisualizerMode(button.dataset.vizMode));

// Behaviour shared by the app's dialogs. They move by dragging `handle`, kept fully on screen, and open above the middle
// (half the space above them, as centred, taken away), back in place each time. A click on the backdrop closes them,
// or, for dialogs that would lose edits (keepOpen), makes the card pulse to say it's still waiting. Backdrop clicks land
// on the dialog itself, outside its card. Returns a function that opens the dialog.
function setUpDialog(dialog, handle, { keepOpen = false } = {}) {
  const offset = { x: 0, y: 0 };
  let drag = null;
  const move = (x, y) => {
    const bounds = dialog.getBoundingClientRect();
    // Where the dialog would be unmoved, so the offset can be held within the window.
    const left = bounds.left - offset.x;
    const top = bounds.top - offset.y;
    if (dialog.open) {
      x = Math.min(Math.max(x, -left), window.innerWidth - bounds.width - left);
      y = Math.min(Math.max(y, -top), window.innerHeight - bounds.height - top);
    }
    offset.x = x;
    offset.y = y;
    dialog.style.translate = x || y ? `${x}px ${y}px` : "";
  };
  // Until it's dragged, the dialog keeps its place above the middle as its size changes (content that arrives after
  // opening, a status line): the shift is always taken from where it is centred now.
  let placed = false;
  const place = () => move(0, -(dialog.getBoundingClientRect().top - offset.y) / 2);
  new ResizeObserver(() => {
    if (dialog.open && placed) place();
  }).observe(dialog);
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    placed = false;
    drag = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (drag) move(event.clientX - drag.x, event.clientY - drag.y);
  });
  for (const type of ["pointerup", "pointercancel"]) handle.addEventListener(type, () => { drag = null; });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
    if (!keepOpen) dialog.close();
    else if (!matchMedia("(prefers-reduced-motion: reduce)").matches) dialog.animate([{ scale: 1 }, { scale: 1.03 }, { scale: 1 }], { duration: 240, easing: "ease-in-out" });
  });
  return () => {
    move(0, 0);
    dialog.showModal();
    placed = true;
    place();
  };
}

// A simple tag editor for library MP3s: title, artist, album, genre, track number, year and lyrics, written into the
// file's ID3 tag (other tag data such as cover art is kept). The library entry is then updated from the saved file.
// It also edits the lyrics files next to the track (one tab per format in LYRICS_FORMATS), which aren't tags.
const TAG_FIELDS = ["title", "artist", "album", "genre", "trackNumber", "year", "albumArtist", "composer", "lyricist", "copyright", "discNumber", "comment", "lyrics"];
// Fields read straight from the tag rather than through jsmediatags (which doesn't know them, or reads them oddly).
const TAG_OWN_FIELDS = ["genre", "albumArtist", "composer", "lyricist", "copyright", "discNumber", "comment", "lyrics"];
const lyricsFileBox = format => $(`tag-file-${format.id}`);
// Lyrics keep their spacing and line breaks; the other fields are trimmed.
const tagFieldValue = field => field === "lyrics" ? $("tag-lyrics").value : $(`tag-${field}`).value.trim();
const tagEditor = $("tag-editor");
// The track being edited and its fields as opened, so only changed ones are written.
let tagEditing = null;
// The track whose file is being written (the player ignores the error that can cause while it plays).
let tagSavingPath = null;

function setTagStatus(text, error = false) {
  const status = $("tag-status");
  status.textContent = text;
  status.classList.toggle("hidden", !text);
  status.classList.toggle("text-danger", error);
  status.classList.toggle("text-soft", !error);
}

async function openTagEditor(path) {
  const track = trackFor(path);
  const target = tagTarget(path);
  if (!track || !target) return;
  if (target.source && permissionOf(target.source) !== "granted") {
    notice(`Reconnect "${target.source.name}" before editing its tracks.`, true);
    return;
  }
  // The file's own tags; the library's values stand in when they can't be read (its title may be the file name).
  // The rest is read here directly from the tag (TAG_OWN_FIELDS): numbered genres ("(17)" for Rock) need translating,
  // the lyrics and comment are the very frames saving replaces, and the extra fields are unknown to jsmediatags.
  let tags = null;
  let own = {};
  let cover = null;
  try {
    // Dropped music may need its access asked for again after a reload (this menu click allows it).
    const file = target.drop ? await droppedFile(target.drop, { ask: true }) : await trackFile(path);
    tags = await readTags(file);
    const length = tagLength(new Uint8Array(await file.slice(0, 10).arrayBuffer()));
    if (length) {
      const tag = new Uint8Array(await file.slice(0, length).arrayBuffer());
      own = readFields(tag);
      cover = readCover(tag);
    }
  } catch (error) {
    console.error("Could not read the tags to edit:", error);
  }
  // Without an embedded cover, the app may be showing the folder's image; the Cover tab says so.
  let folderImage = null;
  if (!cover && target.folder) folderImage = await findFolderImage(target.folder.directory, target.folder.path).catch(() => null);
  // The text box keeps line breaks as \n; reading them the same way means an untouched box counts as unchanged.
  if (own.lyrics) own.lyrics = own.lyrics.replace(/\r\n?/g, "\n");
  const values = { ...(tags || track), ...Object.fromEntries(TAG_OWN_FIELDS.map(field => [field, own[field] ?? ""])) };
  const original = Object.fromEntries(TAG_FIELDS.map(field => [field, values[field] === null || values[field] === undefined ? "" : String(values[field])]));
  // The lyrics files: where each is (or would be created), its text, and whether it used Windows line breaks.
  const files = {};
  for (const format of LYRICS_FORMATS) {
    let entry = null;
    if (target.folder) {
      try {
        const found = await findSibling(target.folder.directory, target.folder.path, format.extension);
        const raw = found.handle ? decodeText(await (await found.handle.getFile()).arrayBuffer()) : "";
        entry = { ...found, text: raw.replace(/\r\n?/g, "\n"), crlf: raw.includes("\r\n") };
      } catch (error) {
        console.error(`Could not read the ${format.extension} file:`, error);
      }
    }
    files[format.id] = entry;
    const box = lyricsFileBox(format);
    box.value = entry?.text ?? "";
    box.disabled = !entry;
    box.placeholder = !target.folder ? `A single dropped file doesn't give access to its folder, where ${format.extension} files sit. Drop the folder instead.`
      : !entry ? `Couldn't read the ${format.extension} file.`
      : entry.handle ? "" : `No ${entry.name} yet. Saving creates it.`;
  }
  // The cover as opened and as it is now (the same object until it's replaced or removed).
  tagEditing = { path, original, files, cover: { original: cover, current: cover, folderImage: folderImage?.name ?? null } };
  renderTagCover();
  for (const field of TAG_FIELDS) $(`tag-${field}`).value = original[field];
  const fileLabel = target.drop ? target.drop.label : relativePath(path);
  $("tag-file").textContent = fileLabel;
  $("tag-file").title = fileLabel;
  setTagStatus("");
  $("tag-save").disabled = false;
  showTagTab("general");
  showTagEditor();
  focusAtEnd($("tag-title"));
}

async function saveTags() {
  const editing = tagEditing;
  if (!editing || tagSavingPath) return;
  const changes = {};
  for (const field of TAG_FIELDS) {
    const value = tagFieldValue(field);
    if (value !== editing.original[field]) changes[field] = value;
  }
  if (editing.cover.current !== editing.cover.original) changes.cover = editing.cover.current && { mime: editing.cover.current.mime, data: editing.cover.current.data };
  const fileChanges = LYRICS_FORMATS.filter(format => editing.files[format.id] && lyricsFileBox(format).value !== editing.files[format.id].text);
  const tagsChanged = Object.keys(changes).length > 0;
  if (!tagsChanged && !fileChanges.length) {
    tagEditor.close();
    return;
  }
  const { path } = editing;
  const target = tagTarget(path);
  if (!target) {
    setTagStatus("This track's file can no longer be reached.", true);
    return;
  }
  $("tag-save").disabled = true;
  setTagStatus("Saving…");
  tagSavingPath = path;
  // The playing track is reloaded from the new file, where it was.
  const playing = tagsChanged && player.path === path ? { time: player.audio.currentTime || 0, paused: player.audio.paused } : null;
  try {
    // Changing files needs more than the read access playing has; asked once per folder, or per dropped file (this
    // click allows it).
    if (await target.scope.queryPermission({ mode: "readwrite" }) !== "granted" && await target.scope.requestPermission({ mode: "readwrite" }) !== "granted") {
      throw new TagWriteError(`Saving needs permission to change ${target.scope.kind === "file" ? "this file" : "files in this folder"}.`);
    }
    // Lyrics files first: they're small, and the track's tags may then be saved knowing they went through.
    for (const format of fileChanges) {
      const entry = editing.files[format.id];
      const text = lyricsFileBox(format).value;
      if (!text) {
        // Emptied: the file goes (there's nothing to keep an empty file for).
        if (entry.handle) await entry.directory.removeEntry(entry.name);
        Object.assign(entry, { handle: null, text: "" });
        continue;
      }
      const handle = entry.handle ?? await entry.directory.getFileHandle(entry.name, { create: true });
      const writable = await handle.createWritable();
      // Saved as UTF-8, with the line breaks the file had.
      await writable.write(entry.crlf ? text.replace(/\n/g, "\r\n") : text);
      await writable.close();
      Object.assign(entry, { handle, text });
    }
    lyricsCache.delete(path);
    if (!tagsChanged) {
      tagEditing = null;
      tagEditor.close();
      notice(`Saved ${fileChanges.map(format => editing.files[format.id].name).join(" and ")}.`);
      return;
    }
    const handle = await target.fileHandle();
    const bytes = writeTags(new Uint8Array(await (await handle.getFile()).arrayBuffer()), changes);
    // The browser writes to a copy and swaps it in on close, so a failure leaves the file as it was.
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    const file = await handle.getFile();
    if (target.source) {
      const metadata = await readMetadata(file);
      const track = trackFor(path);
      const updated = {
        ...track,
        title: metadata.title || file.name.replace(/\.mp3$/i, ""),
        artist: metadata.artist,
        album: metadata.album,
        trackNumber: metadata.trackNumber,
        year: metadata.year,
        duration: metadata.duration ?? track.duration,
        size: file.size,
        lastModified: file.lastModified
      };
      const next = { ...library, tracks: library.tracks.map(item => item.path === path ? updated : item) };
      await saveLibrary(next);
      library = next;
    } else {
      // Dropped music plays from the file it was given; that one is now out of date. Its details are read again, which
      // also updates the direct-play playlists that keep it.
      target.drop.file = file;
      await fillDropDetails([path]);
    }
    // Embedded lyrics win in the Lyrics view; read them again. The cover too may come from the rewritten tag.
    lyricsCache.delete(path);
    covers.forget(path);
    if (nowCoverPath === path) nowCoverPath = undefined;
    libraryCoverKey = null;
    tagEditing = null;
    tagEditor.close();
    const name = target.drop ? target.drop.label : relativePath(path);
    notice(`Saved the tags of ${name}${fileChanges.length ? ` and ${fileChanges.map(format => editing.files[format.id].name).join(" and ")}` : ""}.`);
    if (playing && player.path === path) {
      const reload = { startAt: playing.time, autoplay: !playing.paused };
      await (target.source ? player.play(target.source.handle, path, { ...reload, filePath: relativePath(path) }) : player.play(null, path, { ...reload, file }));
    }
  } catch (error) {
    if (!(error instanceof TagWriteError)) console.error("Could not save the tags:", error);
    const message = error instanceof TagWriteError ? error.message
      : error.name === "NotAllowedError" ? "Saving needs permission to change files in this folder."
      : "Couldn't save. The files may be in use, read-only, or moved.";
    setTagStatus(message, true);
    $("tag-save").disabled = false;
  } finally {
    tagSavingPath = null;
    render();
  }
}

// The editor moves by dragging the top of its header (title and file); a backdrop click would lose edits, so it pulses.
const showTagEditor = setUpDialog(tagEditor, $("tag-editor-handle"), { keepOpen: true });

// Clicking a field's label focuses it with the cursor at the end, instead of the browser's select-all.
function focusAtEnd(input) {
  input.focus();
  // Number fields don't support placing the cursor.
  if (input.type === "text" || input.type === "textarea") input.setSelectionRange(input.value.length, input.value.length);
}
// Labels sit beside their fields and fit their text, so only the words themselves are clickable.
for (const label of $("tag-form").querySelectorAll("label[for]")) {
  label.addEventListener("click", event => {
    event.preventDefault();
    focusAtEnd(label.control);
  });
}

// The cover, on the General tab: the embedded one (see readCover), replaced by choosing, dropping or pasting an image, or removed.
// Nothing is written until Save; Undo goes back to the cover as opened.
let tagCoverUrl = null;
const imageFormat = mime => ({ "image/jpeg": "JPEG", "image/png": "PNG" })[mime] ?? mime.replace(/^image\//, "").toUpperCase();

function renderTagCover() {
  const state = tagEditing?.cover;
  if (!state) return;
  const { current, original } = state;
  const changed = current !== original;
  const image = $("tag-cover-image");
  // Its own label, like the fields', and the details below it.
  const label = $("tag-cover-label");
  const info = $("tag-cover-details");
  if (tagCoverUrl) URL.revokeObjectURL(tagCoverUrl);
  tagCoverUrl = null;
  image.classList.toggle("hidden", !current);
  if (current) {
    tagCoverUrl = URL.createObjectURL(new Blob([current.data], { type: current.mime }));
    label.textContent = changed ? "New cover" : current.type === 3 ? "Front cover" : "Cover";
    const details = size => [size, formatBytes(current.data.length), imageFormat(current.mime)].filter(Boolean).join(" · ");
    info.textContent = details("");
    image.onload = () => { info.textContent = details(`${image.naturalWidth} × ${image.naturalHeight}`); };
    image.src = tagCoverUrl;
  } else {
    image.onload = null;
    image.removeAttribute("src");
    label.textContent = "Cover";
    info.textContent = changed ? "The cover will be removed when you save."
      : state.folderImage ? `No embedded cover. The app shows the folder's ${state.folderImage}, which isn't changed here.`
      : "No embedded cover. Choose, drop or paste an image.";
  }
  $("tag-cover-remove").disabled = !current;
  $("tag-cover-undo").classList.toggle("hidden", !changed);
}

// Takes an image as the new cover. JPEG and PNG go in as they are (every player reads them); other formats are
// turned into JPEG for the same reason.
async function setTagCover(blob) {
  const state = tagEditing?.cover;
  if (!state || !blob) return;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    $("tag-cover-details").textContent = "That file isn't an image this browser can read.";
    return;
  }
  let mime = blob.type;
  let data;
  if (mime === "image/jpeg" || mime === "image/png") {
    data = new Uint8Array(await blob.arrayBuffer());
  } else {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    data = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
    mime = "image/jpeg";
  }
  bitmap.close();
  if (tagEditing?.cover !== state) return;
  state.current = { mime, data, type: state.original?.type ?? 3 };
  renderTagCover();
}

const imageIn = items => [...(items ?? [])].find(file => file.type.startsWith("image/"));
$("tag-cover-choose").addEventListener("click", () => $("tag-cover-file").click());
// Clicking the cover shows it full size (the image in the tag, not a thumbnail), as elsewhere.
$("tag-cover-image").addEventListener("click", () => {
  const image = $("tag-cover-image");
  if (!tagCoverUrl || !image.naturalWidth) return;
  openImageViewer(tagCoverUrl, `${$("tag-cover-label").textContent} · ${image.naturalWidth} × ${image.naturalHeight} · ${formatBytes(tagEditing.cover.current.data.length)}`);
});
$("tag-cover-file").addEventListener("change", () => {
  const file = $("tag-cover-file").files[0];
  $("tag-cover-file").value = "";
  setTagCover(file);
});
$("tag-cover-remove").addEventListener("click", () => {
  if (!tagEditing) return;
  tagEditing.cover.current = null;
  renderTagCover();
});
$("tag-cover-undo").addEventListener("click", () => {
  if (!tagEditing) return;
  tagEditing.cover.current = tagEditing.cover.original;
  renderTagCover();
});
// An image dropped on the cover takes its place; the page's own drop handling (music onto playlists) stays out of it.
const coverDrop = $("tag-cover-drop");
for (const type of ["dragenter", "dragover"]) {
  coverDrop.addEventListener(type, event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    coverDrop.toggleAttribute("data-dragover", true);
  });
}
coverDrop.addEventListener("dragleave", event => {
  if (!coverDrop.contains(event.relatedTarget)) coverDrop.removeAttribute("data-dragover");
});
coverDrop.addEventListener("drop", event => {
  event.preventDefault();
  event.stopPropagation();
  coverDrop.removeAttribute("data-dragover");
  setTagCover(imageIn(event.dataTransfer?.files));
});
// Pasting an image while the General tab (where the cover is) is open sets it; pasted text goes to the fields as usual.
document.addEventListener("paste", event => {
  if (!tagEditor.open || currentTagTab !== "general") return;
  const image = imageIn(event.clipboardData?.files);
  if (!image) return;
  event.preventDefault();
  setTagCover(image);
});
tagEditor.addEventListener("close", () => {
  if (tagCoverUrl) URL.revokeObjectURL(tagCoverUrl);
  tagCoverUrl = null;
});

// Tabs group the fields (General, Extra, Lyrics, …): each [data-tag-tab] shows the [data-tag-panel] of the same name.
// Hidden panels stay in place (invisible), so the dialog keeps its size.
// A field that blocks saving (a year of 99, say) may be on another tab; its tab opens so the browser can point at it.
$("tag-form").addEventListener("invalid", event => {
  const panel = event.target.closest("[data-tag-panel]");
  if (panel) showTagTab(panel.dataset.tagPanel);
}, true);
// A tab per lyrics file format, made like the Lyrics tab and placed after it, so a new format gets its own.
let previousTab = $("tag-tab-lyrics");
for (const format of LYRICS_FORMATS) {
  const tab = $("tag-tab-lyrics").cloneNode();
  Object.assign(tab, { id: `tag-tab-file-${format.id}`, textContent: `${format.extension} file` });
  tab.dataset.tagTab = `file-${format.id}`;
  tab.setAttribute("aria-controls", `tag-panel-file-${format.id}`);
  previousTab.after(tab);
  previousTab = tab;
  const panel = $("tag-panel-lyrics").cloneNode(true);
  Object.assign(panel, { id: `tag-panel-file-${format.id}` });
  panel.dataset.tagPanel = `file-${format.id}`;
  panel.setAttribute("aria-labelledby", tab.id);
  const box = panel.querySelector("textarea");
  Object.assign(box, { id: `tag-file-${format.id}`, name: `file-${format.id}`, value: "" });
  box.setAttribute("aria-label", `${format.extension} file`);
  $("tag-panel-lyrics").parentElement.append(panel);
}
const tagTabs = [...tagEditor.querySelectorAll("[data-tag-tab]")];
let currentTagTab = "general";
function showTagTab(name) {
  currentTagTab = name;
  for (const tab of tagTabs) {
    const selected = tab.dataset.tagTab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    // The open tab takes the body's color and joins it below the header's edge, like a folder tab.
    tab.classList.toggle("border-bd-2", selected);
    tab.classList.toggle("bg-surface", selected);
    tab.classList.toggle("text-deep", selected);
    tab.classList.toggle("border-transparent", !selected);
    tab.classList.toggle("text-soft", !selected);
    tab.classList.toggle("hover:bg-tint", !selected);
    tab.classList.toggle("hover:text-fg-2", !selected);
  }
  for (const panel of tagEditor.querySelectorAll("[data-tag-panel]")) panel.classList.toggle("invisible", panel.dataset.tagPanel !== name);
}
for (const tab of tagTabs) {
  tab.addEventListener("click", () => {
    showTagTab(tab.dataset.tagTab);
    const field = tagEditor.querySelector(`[data-tag-panel="${tab.dataset.tagTab}"]`).querySelector("input, textarea");
    if (field) focusAtEnd(field);
  });
  // Arrow keys move between tabs.
  tab.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tagTabs[(tagTabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tagTabs.length) % tagTabs.length];
    showTagTab(next.dataset.tagTab);
    next.focus();
  });
}

$("tag-form").addEventListener("submit", event => {
  event.preventDefault();
  saveTags();
});
$("tag-cancel").addEventListener("click", () => tagEditor.close());
// Escape closes the dialog, but not halfway through saving.
tagEditor.addEventListener("cancel", event => {
  if (tagSavingPath) event.preventDefault();
});

// Media info: everything readable about a track's file (see mediainfo.js), from the row's context menu.
const mediaInfo = $("media-info");
const showMediaInfo = setUpDialog(mediaInfo, $("media-info-handle"));
let mediaInfoSections = null;
// Pictures are shown from object URLs, let go when the dialog closes.
let mediaInfoUrls = [];

async function openMediaInfo(path) {
  let file;
  let location;
  try {
    const drop = dropped.get(path);
    if (drop) {
      file = await droppedFile(drop, { ask: true });
      location = drop.label;
    } else {
      const source = sourceOf(path);
      if (!source) return;
      if (permissionOf(source) !== "granted") {
        notice(`Reconnect "${source.name}" to see its tracks' details.`, true);
        return;
      }
      file = await trackFile(path);
      location = `${source.name}/${relativePath(path)}`;
    }
  } catch (error) {
    console.error("Could not open the file for its details:", error);
    notice("Couldn't read this file. It may have been moved, removed, or access wasn't granted.", true);
    return;
  }
  mediaInfoSections = null;
  $("media-info-file").textContent = file.name;
  $("media-info-file").title = location;
  $("media-info-copy").disabled = true;
  const reading = document.createElement("p");
  reading.className = "text-soft";
  reading.textContent = "Reading the file…";
  $("media-info-body").replaceChildren(reading);
  showMediaInfo();
  try {
    // MP3s are read whole: every frame is walked for exact length and bit rates. Other formats get file details only.
    const mp3 = /\.mp3$/i.test(file.name) || file.type === "audio/mpeg";
    const bytes = mp3 ? new Uint8Array(await file.arrayBuffer()) : null;
    mediaInfoSections = describeMedia({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, path: location }, bytes);
  } catch (error) {
    console.error("Could not read the file's details:", error);
    reading.textContent = "Couldn't read this file.";
    return;
  }
  if (!mediaInfo.open) return;
  renderMediaInfo(mediaInfoSections);
  $("media-info-copy").disabled = false;
}

function renderMediaInfo(sections) {
  // One grid for every section (each a subgrid of it), so the values line up in one column throughout.
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4";
  grid.append(...sections.map(section => {
    const block = document.createElement("section");
    block.className = "col-span-2 mt-5 grid grid-cols-subgrid first:mt-0";
    // A bar across the dialog that stays at the top while its section scrolls by (the body's top padding is -top-4).
    const title = document.createElement("h3");
    title.className = "sticky -top-4 z-10 col-span-2 -mx-5 mb-2 border-y border-bd-2 bg-head px-5 py-1.5 text-sm font-semibold text-deep";
    title.textContent = section.title;
    const list = document.createElement("dl");
    list.className = "col-span-2 grid grid-cols-subgrid gap-y-1";
    for (const [label, value] of section.rows) {
      const term = document.createElement("dt");
      // Field names in pure black (white in the dark theme, where black wouldn't show).
      term.className = "text-black dark:text-white";
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.className = "whitespace-pre-wrap break-words text-fg-2/85";
      detail.textContent = value;
      list.append(term, detail);
    }
    block.append(title, list);
    for (const picture of section.pictures ?? []) {
      const url = URL.createObjectURL(new Blob([picture.data], { type: picture.mime }));
      mediaInfoUrls.push(url);
      const figure = document.createElement("figure");
      figure.className = "col-span-2 mt-3 flex items-end gap-3";
      const image = document.createElement("img");
      image.className = "h-28 w-28 cursor-zoom-in rounded-md border border-bd object-contain";
      image.alt = picture.type;
      image.draggable = false;
      image.title = "View full size";
      const caption = document.createElement("figcaption");
      caption.className = "text-soft";
      caption.textContent = picture.type;
      image.addEventListener("load", () => { caption.textContent = `${picture.type} · ${image.naturalWidth} × ${image.naturalHeight}`; });
      image.addEventListener("error", () => {
        caption.textContent = `${picture.type} · can't be shown`;
        image.classList.remove("cursor-zoom-in");
        image.removeAttribute("title");
      });
      image.addEventListener("click", () => {
        if (image.naturalWidth) openImageViewer(url, `${picture.type} · ${image.naturalWidth} × ${image.naturalHeight} · ${formatBytes(picture.data.length)}`);
      });
      image.src = url;
      figure.append(image, caption);
      block.append(figure);
    }
    return block;
  }));
  $("media-info-body").replaceChildren(grid);
}

// A picture at full size, over Media info: fades and scales in and out; a click or Escape closes it. The picture can be moved
// a little by dragging, back in the middle each time it opens.
const imageViewer = $("image-viewer");
const viewerImage = $("image-viewer-image");
// Where the picture has been moved to, the drag in progress, and whether the last press moved it (so it isn't a click).
const viewerOffset = { x: 0, y: 0 };
let viewerDrag = null;
let viewerMoved = false;

function moveViewerImage(x, y) {
  // Up to a tenth of the window each way, giving more slowly toward the edge.
  const soften = (value, limit) => limit * Math.tanh(value / limit);
  viewerOffset.x = x;
  viewerOffset.y = y;
  viewerImage.style.translate = x || y ? `${soften(x, window.innerWidth / 10)}px ${soften(y, window.innerHeight / 10)}px` : "";
}

viewerImage.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  viewerDrag = { x: event.clientX - viewerOffset.x, y: event.clientY - viewerOffset.y, startX: event.clientX, startY: event.clientY };
  viewerMoved = false;
  viewerImage.setPointerCapture(event.pointerId);
});
viewerImage.addEventListener("pointermove", event => {
  if (!viewerDrag) return;
  if (Math.hypot(event.clientX - viewerDrag.startX, event.clientY - viewerDrag.startY) > 3) {
    viewerMoved = true;
    viewerImage.classList.add("cursor-grabbing");
  }
  if (viewerMoved) moveViewerImage(event.clientX - viewerDrag.x, event.clientY - viewerDrag.y);
});
for (const type of ["pointerup", "pointercancel"]) {
  viewerImage.addEventListener(type, () => {
    viewerDrag = null;
    viewerImage.classList.remove("cursor-grabbing");
  });
}

// owned: the viewer made the URL for itself and lets it go when closed.
let viewerOwnedUrl = null;
function openImageViewer(url, caption, { owned = false } = {}) {
  if (viewerOwnedUrl) URL.revokeObjectURL(viewerOwnedUrl);
  viewerOwnedUrl = owned ? url : null;
  viewerImage.src = url;
  $("image-viewer-caption").textContent = caption;
  moveViewerImage(0, 0);
  // Fading in and out is styles.css's (#image-viewer).
  imageViewer.showModal();
}
imageViewer.addEventListener("click", () => {
  // Letting go after moving the picture isn't a click.
  if (viewerMoved) {
    viewerMoved = false;
    return;
  }
  imageViewer.close();
});
imageViewer.addEventListener("close", () => {
  // A picture already shown stays on screen while it fades out, so its URL can go now.
  if (viewerOwnedUrl) URL.revokeObjectURL(viewerOwnedUrl);
  viewerOwnedUrl = null;
});

// A cover at full size: load() gives the original image (not the thumbnail), shown with its size.
async function viewCover(load) {
  const image = await load().catch(error => {
    console.error("Could not read the cover:", error);
    return null;
  });
  if (!image) return;
  const url = URL.createObjectURL(image);
  const probe = new Image();
  probe.src = url;
  try {
    await probe.decode();
  } catch {
    URL.revokeObjectURL(url);
    notice("Couldn't show this cover.", true);
    return;
  }
  openImageViewer(url, `Cover · ${probe.naturalWidth} × ${probe.naturalHeight} · ${formatBytes(image.size)}`, { owned: true });
}
// The covers by the playing track and on an album's page open it.
elements["now-cover"].addEventListener("click", () => {
  if (player.path) viewCover(() => covers.image(player.path));
});
elements["library-cover"].addEventListener("click", () => {
  if (libraryCoverTracks?.length) viewCover(() => covers.albumImage(libraryCoverTracks));
});

$("media-info-close").addEventListener("click", () => mediaInfo.close());
mediaInfo.addEventListener("close", () => {
  for (const url of mediaInfoUrls) URL.revokeObjectURL(url);
  mediaInfoUrls = [];
});
// The details as plain text, like MediaInfo's text view; the button says when it's done.
$("media-info-copy").addEventListener("click", async () => {
  if (!mediaInfoSections) return;
  const button = $("media-info-copy");
  try {
    await navigator.clipboard.writeText(mediaInfoText(mediaInfoSections));
    button.textContent = "Copied";
  } catch (error) {
    console.error("Could not copy the details:", error);
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 1500);
});

// Visualizer recordings: the 3D terrain's rows saved to a file (each marked as recorded live or filled in, with the
// Smooth setting it was made with), and loaded back to look at.
$("visualizer-download").addEventListener("click", () => {
  const recording = visualizer.recording();
  if (!recording) {
    notice("Nothing recorded yet. Play a track with the 3D view on.", true);
    return;
  }
  // A loaded recording keeps the track it was saved with.
  let info = recording.track;
  if (info === undefined) {
    const track = player.path ? trackFor(player.path) : null;
    const title = track?.title || (player.path ? relativePath(player.path).split("/").pop().replace(/\.[^.]*$/, "") : "");
    info = player.path ? { title, artist: track?.artist || "", album: track?.album || "", file: relativePath(player.path) } : null;
  }
  const fileName = safeFileName(info?.title && `${info.title} - visualizer`, "visualizer recording", ".json");
  downloadJson(fileName, serializeRecording({ ...recording, track: info }));
  const filled = recording.rows.filter(row => row?.source === "filled").length;
  notice(`Saved ${recording.rows.length.toLocaleString()} rows (${filled.toLocaleString()} filled in) to ${fileName}.`);
});
$("visualizer-load").addEventListener("click", () => $("visualizer-load-file").click());
$("visualizer-load-file").addEventListener("change", async () => {
  const file = $("visualizer-load-file").files[0];
  $("visualizer-load-file").value = "";
  if (!file) return;
  try {
    const recording = parseRecording(await file.text());
    await visualizer.loadRecording(recording);
    const name = recording.track?.title || file.name;
    notice(`Showing the recording of ${name}. Playing records over it.`);
  } catch (error) {
    if (!(error instanceof RecordingFileError)) console.error("Could not load the recording:", error);
    notice(error instanceof RecordingFileError ? error.message : "Couldn't load this recording.", true);
  }
});

// Smoothing of the wave (both views), 0-100%, remembered per browser.
function setVisualizerSmoothing(percent) {
  const value = Math.min(100, Math.max(0, Math.round(percent / 5) * 5));
  visualizer.setSmoothing(value / 100);
  $("visualizer-smooth").value = String(value);
  $("visualizer-smooth-value").textContent = value ? `${value}%` : "Off";
  try { localStorage.setItem("visualizerSmoothing", String(value)); } catch {}
}
$("visualizer-smooth").addEventListener("input", event => setVisualizerSmoothing(Number(event.target.value)));
$("visualizer-smooth").addEventListener("wheel", event => {
  event.preventDefault();
  setVisualizerSmoothing(Number($("visualizer-smooth").value) + (event.deltaY < 0 ? 5 : -5));
}, { passive: false });
try { setVisualizerSmoothing(Number(localStorage.getItem("visualizerSmoothing")) || 0); } catch { setVisualizerSmoothing(0); }

// The 3D history as bars (Off) or a smooth sheet, blended over more time the higher it goes. Remembered per browser.
function setVisualizerSheet(percent) {
  const value = Math.min(100, Math.max(0, Math.round(percent / 5) * 5));
  visualizer.setSheet(value / 100);
  $("visualizer-sheet").value = String(value);
  $("visualizer-sheet-value").textContent = value ? `${value}%` : "Off";
  try { localStorage.setItem("visualizerSheet", String(value)); } catch {}
}
$("visualizer-sheet").addEventListener("input", event => setVisualizerSheet(Number(event.target.value)));
$("visualizer-sheet").addEventListener("wheel", event => {
  event.preventDefault();
  setVisualizerSheet(Number($("visualizer-sheet").value) + (event.deltaY < 0 ? 5 : -5));
}, { passive: false });
try { setVisualizerSheet(Number(localStorage.getItem("visualizerSheet")) || 0); } catch { setVisualizerSheet(0); }
try { setVisualizerMode(localStorage.getItem("visualizerMode")); } catch { setVisualizerMode("2d"); }
// The year chart only scrolls sideways, so a vertical wheel scrolls it horizontally (until it reaches an end).
elements["analysis-chart"].addEventListener("wheel", event => {
  const chart = elements["analysis-chart"];
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || chart.scrollWidth <= chart.clientWidth) return;
  const max = chart.scrollWidth - chart.clientWidth;
  if ((event.deltaY < 0 && chart.scrollLeft <= 0) || (event.deltaY > 0 && chart.scrollLeft >= max - 1)) return;
  event.preventDefault();
  const step = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * chart.clientWidth : event.deltaY;
  chart.scrollLeft += step;
}, { passive: false });
for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => { if (currentView === "visualizer") visualizer.connect(); });

// While music plays, switch to the visualizer after a stretch without user input.
const IDLE_VISUALIZER_MS = 30_000;
let idleTimer = null;
function scheduleIdleVisualizer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const typing = document.activeElement?.matches("input:not([type=range]), textarea");
    // Lyrics are being read along, so stay there.
    if (!player.path || player.audio.paused || currentView === "visualizer" || currentView === "lyrics" || typing || document.hidden) return;
    currentView = "visualizer";
    render();
  }, IDLE_VISUALIZER_MS);
}
for (const type of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(type, scheduleIdleVisualizer, { passive: true });
player.audio.addEventListener("play", scheduleIdleVisualizer);
for (const metric of ["albums", "tracks"]) {
  elements[`analysis-${metric}`].addEventListener("click", () => {
    analysisMetric = metric;
    render();
  });
}
elements["save-playlist"].addEventListener("click", () => {
  closeGenerateOptions();
  elements["generate-form"].classList.add("hidden");
  if (elements["save-form"].classList.contains("hidden")) {
    elements["save-form"].classList.remove("hidden");
    const loaded = savedPlaylists.find(item => item.id === loadedPlaylistId());
    elements["playlist-name"].value = loaded?.name || "";
  }
  elements["playlist-name"].focus();
  const end = elements["playlist-name"].value.length;
  elements["playlist-name"].setSelectionRange(end, end);
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
elements["generate-playlist"].addEventListener("click", () => {
  elements["save-form"].classList.add("hidden");
  elements["generate-form"].classList.remove("hidden");
  focusGenerateMinutes();
});
elements["generate-cancel"].addEventListener("click", () => {
  closeGenerateOptions();
  elements["generate-form"].classList.add("hidden");
  elements["generate-playlist"].focus();
});
elements["generate-form"].addEventListener("submit", event => {
  event.preventDefault();
  closeGenerateOptions();
  generatePlaylist();
});
elements["generate-minutes"].addEventListener("focus", openGenerateOptions);
elements["generate-minutes"].addEventListener("click", openGenerateOptions);
elements["generate-minutes"].addEventListener("blur", closeGenerateOptions);
elements["generate-minutes"].addEventListener("input", () => {
  const input = elements["generate-minutes"];
  const digits = input.value.replace(/\D+/g, "");
  if (digits !== input.value) input.value = digits;
  syncGenerateOptions();
});
elements["generate-minutes"].addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    stepGenerateMinutes(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Escape" && isGenerateOptionsOpen()) {
    event.preventDefault();
    event.stopPropagation();
    closeGenerateOptions();
  }
});
// Clicking anywhere in the field (e.g. the "min" suffix) acts like clicking the input.
elements["generate-field"].addEventListener("pointerdown", event => {
  if (event.target === elements["generate-minutes"] || elements["generate-toggle"].contains(event.target)) return;
  event.preventDefault();
  focusGenerateMinutes(true);
});
elements["generate-toggle"].addEventListener("pointerdown", event => event.preventDefault());
elements["generate-toggle"].addEventListener("click", () => {
  if (isGenerateOptionsOpen()) closeGenerateOptions();
  else focusGenerateMinutes(true);
});
elements["generate-options"].addEventListener("pointerdown", event => event.preventDefault());
elements["generate-options"].addEventListener("click", event => {
  const option = event.target.closest("[data-minutes]");
  if (!option) return;
  elements["generate-minutes"].value = option.dataset.minutes;
  closeGenerateOptions();
  focusGenerateMinutes();
});
window.addEventListener("resize", closeGenerateOptions);
document.addEventListener("scroll", closeGenerateOptions, true);
renderGenerateOptions();
elements["context-info"].addEventListener("click", () => {
  const path = contextInfoPath;
  hideContextMenu();
  if (path) openMediaInfo(path);
});
elements["context-tags"].addEventListener("click", () => {
  const path = contextTagPath;
  hideContextMenu();
  if (path) openTagEditor(path);
});
// Arrow keys move between the menu's items.
elements["context-menu"].addEventListener("keydown", event => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = [...elements["context-menu"].querySelectorAll("button:not(.hidden):not(:disabled)")];
  const index = items.indexOf(document.activeElement);
  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
});
elements["context-remove"].addEventListener("click", () => {
  const row = contextRow;
  const remove = contextRemove;
  hideContextMenu();
  remove?.();
  row?.focus();
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !elements["context-menu"].classList.contains("hidden")) {
    const row = contextRow;
    hideContextMenu();
    row?.focus();
  }
});
window.addEventListener("blur", hideContextMenu);
window.addEventListener("resize", hideContextMenu);
document.addEventListener("scroll", hideContextMenu, true);
// The browser's own context menu is off across the app, except in text fields, where it gives paste, spelling and the
// like. Rows open their own menu; anywhere else gets the general one, except over a dialog (which sits above any menu)
// and where right-click does something itself ([data-no-context-menu], such as panning the 3D visualizer).
const TEXT_FIELDS = "textarea, [contenteditable]:not([contenteditable='false']), input:is([type=text], [type=search], [type=number], [type=url], [type=email]), input:not([type])";
document.addEventListener("contextmenu", event => {
  if (event.target.closest?.(TEXT_FIELDS)) return;
  event.preventDefault();
  const rowMenuOpen = !elements["context-menu"].classList.contains("hidden");
  if (!rowMenuOpen && !event.target.closest?.("dialog, [data-no-context-menu]")) openGeneralMenu(event);
});
elements["context-reload"].addEventListener("click", () => location.reload());

// Installing as an app (its own window, the Start menu; see manifest.webmanifest). The browser says when it can be
// installed; until then, and once installed, the menu doesn't offer it.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => { installPrompt = null; });
elements["context-install"].addEventListener("click", async () => {
  hideContextMenu();
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  await prompt.prompt();
});
// Lets the installed app start without a connection (see sw.js).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => console.error("Could not set up offline use:", error));
}
elements["clear-playlist"].addEventListener("click", () => {
  const count = playlistPaths().length;
  if (window.confirm(`Clear the current playlist (${count} ${count === 1 ? "track" : "tracks"})?`)) updatePlaylist([]);
});
elements["rename-form"].addEventListener("submit", event => {
  event.preventDefault();
  renameSavedPlaylist();
});
elements["rename-cancel"].addEventListener("click", closeRename);
elements["rename-input"].addEventListener("keydown", event => {
  if (event.key === "Escape") closeRename();
});
elements["import-file"].addEventListener("change", () => {
  const files = [...elements["import-file"].files];
  elements["import-file"].value = "";
  importPlaylists(files);
});
elements.previous.addEventListener("click", () => advance(-1));
elements.next.addEventListener("click", () => advance(1));
elements.stop.addEventListener("click", () => {
  player.stop();
  clearSession();
});
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

// Playback speed: a small menu of presets next to the time. Remembered per browser; pitch is kept by the browser.
const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
let playbackSpeed = 1;
try {
  const stored = Number(localStorage.getItem("playbackSpeed"));
  if (SPEEDS.includes(stored)) playbackSpeed = stored;
} catch {}

function applySpeed() {
  // The default rate is what a newly loaded track starts with; loading resets the current rate to it.
  player.audio.defaultPlaybackRate = playbackSpeed;
  player.audio.playbackRate = playbackSpeed;
  const text = `${playbackSpeed}×`;
  elements["speed-label"].textContent = text;
  elements.speed.setAttribute("aria-label", `Playback speed ${text}`);
  elements.speed.toggleAttribute("data-changed", playbackSpeed !== 1);
  markSpeed(playbackSpeed);
}

function setSpeed(speed) {
  playbackSpeed = speed;
  try { localStorage.setItem("playbackSpeed", String(speed)); } catch {}
  applySpeed();
  renderPlaylistStats();
}

// A small preset menu under (or above) its button, like the playback speed's. `items` are [value, text] pairs; picking
// one calls `onPick` with its value. Returns a function that marks the current value.
function presetMenu(button, menu, items, onPick) {
  menu.replaceChildren(...items.map(([value, text], index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitemradio");
    item.dataset.index = index;
    item.tabIndex = -1;
    item.className = "group flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left tabular-nums hover:bg-tint focus-visible:bg-tint focus-visible:outline-none aria-checked:font-semibold aria-checked:text-deep";
    item.innerHTML = `<span></span><svg aria-hidden="true" class="invisible h-4 w-4 group-aria-checked:visible"><use href="#icon-added"></use></svg>`;
    item.firstElementChild.textContent = text;
    return item;
  }));

  function open() {
    menu.classList.remove("hidden");
    const bounds = button.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(bounds.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 4))}px`;
    const below = bounds.bottom + 4;
    menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 4 ? Math.max(4, bounds.top - menu.offsetHeight - 4) : below}px`;
    button.setAttribute("aria-expanded", "true");
    (menu.querySelector("[aria-checked=true]") || menu.firstElementChild).focus();
  }

  function close(focusButton = false) {
    if (menu.classList.contains("hidden")) return;
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    if (focusButton) button.focus();
  }

  button.addEventListener("click", () => {
    if (menu.classList.contains("hidden")) open();
    else close();
  });
  menu.addEventListener("click", event => {
    const item = event.target.closest("[data-index]");
    if (!item) return;
    onPick(items[Number(item.dataset.index)][0]);
    close(true);
  });
  menu.addEventListener("keydown", event => {
    const children = [...menu.children];
    const index = children.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: children.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      children[Math.max(0, Math.min(children.length - 1, moves[event.key]))].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!button.contains(event.target) && !menu.contains(event.target)) close();
  });
  window.addEventListener("resize", () => close());
  document.addEventListener("scroll", () => close(), true);

  return current => {
    for (const item of menu.children) item.setAttribute("aria-checked", String(items[Number(item.dataset.index)][0] === current));
  };
}

const markSpeed = presetMenu(elements.speed, elements["speed-menu"], SPEEDS.map(speed => [speed, `${speed}×`]), setSpeed);
applySpeed();

// Gap: how long to wait after a track ends (or its cut fades out) before the next playlist track starts. Infinity
// stops there instead; Next or Play carry on by hand. Remembered per browser.
const GAPS = [0, 1, 2, 5, 10, Infinity];
const gapText = gap => (gap === Infinity ? "∞" : String(gap));
let playbackGap = 0;
try {
  const stored = Number(localStorage.getItem("playbackGap"));
  if (GAPS.includes(stored)) playbackGap = stored;
} catch {}
// The wait in progress: the finished track, its timer and when the next one starts.
let gapWait = null;

const markGap = presetMenu(elements.gap, elements["gap-menu"], GAPS.map(gap => [gap, gapText(gap)]), setGap);

function renderGap() {
  elements["gap-label"].textContent = gapText(playbackGap);
  elements.gap.toggleAttribute("data-changed", playbackGap !== 0);
  const setting = playbackGap === Infinity ? "stop after each track" : playbackGap ? `${playbackGap} seconds` : "none";
  elements.gap.setAttribute("aria-label", gapWait ? `Waiting for the next track; wait before the next track: ${setting}` : `Wait before the next track: ${setting}`);
  markGap(playbackGap);
}

// The countdown: a line along the finished track's bottom border in the current playlist, shrinking away over the
// wait. Redrawn (picking up where it is) whenever the playlist rows are rebuilt.
function renderGapCountdown() {
  elements.playlist.querySelector("[data-gap-countdown]")?.remove();
  const row = gapWait && elements.playlist.querySelector(`[data-path="${CSS.escape(gapWait.path)}"]`);
  if (!row) return;
  const left = Math.max(0, gapWait.until - performance.now());
  const line = document.createElement("span");
  line.dataset.gapCountdown = "";
  line.setAttribute("aria-hidden", "true");
  line.className = "pointer-events-none absolute -bottom-px left-0 h-px bg-primary";
  line.style.width = `${(left / (gapWait.seconds * 1000)) * 100}%`;
  row.classList.add("relative");
  row.append(line);
  line.getBoundingClientRect();
  line.style.transition = `width ${left}ms linear`;
  line.style.width = "0";
}

function setGap(gap) {
  playbackGap = gap;
  try { localStorage.setItem("playbackGap", String(gap)); } catch {}
  // A wait already running keeps going only if there's still something to wait for.
  if (gapWait) {
    const { path } = gapWait;
    cancelGap();
    if (gap !== Infinity) waitThenAdvance(path, gap);
  }
  renderGap();
  renderPlaylistStats();
}

function cancelGap() {
  if (!gapWait) return;
  clearTimeout(gapWait.timer);
  gapWait = null;
  renderGapCountdown();
  renderGap();
}

function waitThenAdvance(path, seconds) {
  const wait = { path, seconds, until: performance.now() + seconds * 1000 };
  wait.timer = setTimeout(() => {
    if (gapWait !== wait) return;
    cancelGap();
    if (player.path === path) advance(1);
  }, seconds * 1000);
  gapWait = wait;
  renderGapCountdown();
  renderGap();
}

// A track is done (ended, or its cut faded out): move on to the next playlist track after the gap.
function finishTrack() {
  const paths = playlistPaths();
  const index = paths.indexOf(player.path);
  if (index < 0 || index >= paths.length - 1 || playbackGap === Infinity) return;
  if (playbackGap === 0) advance(1);
  else waitThenAdvance(player.path, playbackGap);
}

// Playing anything (this track again, or another) or stopping ends the wait.
player.audio.addEventListener("play", cancelGap);
player.audio.addEventListener("emptied", cancelGap);
renderGap();

player.audio.addEventListener("timeupdate", () => saveSession());
player.audio.addEventListener("play", () => saveSession(true));
player.audio.addEventListener("pause", () => saveSession(true));
player.audio.addEventListener("ended", () => {
  lastSessionSave = 0;
  if (player.path) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ path: player.path, time: 0, playing: false }));
    } catch (error) {
      console.error("Could not save the playback position:", error);
    }
  }
});
window.addEventListener("pagehide", () => saveSession(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSession(true);
});

// Cut ("skip after" internally): once a track has played this share of its length, it fades out and the next one starts. 0 is off.
// Playing anywhere past the point, reached naturally or by moving the playing thumb there, fades out and moves on.
const SKIP_FADE_SECONDS = 3;
let skipAfter = 0;
try {
  const stored = Number(localStorage.getItem("skipAfter"));
  // An earlier version stored "off" as 100.
  if (Number.isInteger(stored) && stored >= 0 && stored < 100 && stored % 5 === 0) skipAfter = stored;
} catch {}
// The fade in progress: the track, the listener's volume to restore, and when it started.
let skipFade = null;

// The volume the listener set, even while a fade has lowered the actual one.
function listenerVolume() {
  return skipFade ? skipFade.volume : player.audio.volume;
}

function cancelSkipFade() {
  if (!skipFade) return;
  clearInterval(skipFade.timer);
  const { volume } = skipFade;
  skipFade = null;
  player.audio.volume = volume;
}

function startSkipFade() {
  const fade = { path: player.path, volume: player.audio.volume, start: performance.now() };
  fade.timer = setInterval(() => {
    // Pausing, stopping or another track ends the fade with the volume restored.
    if (skipFade !== fade || player.path !== fade.path || player.audio.paused) return cancelSkipFade();
    const progress = (performance.now() - fade.start) / (SKIP_FADE_SECONDS * 1000);
    if (progress < 1) {
      player.audio.volume = fade.volume * (1 - progress);
      return;
    }
    player.audio.pause();
    cancelSkipFade();
    finishTrack();
  }, 50);
  skipFade = fade;
}

// The cut is set with a scissors handle on the progress slider, dragged in from the right end: cutting 30% means skipping
// after 70%. No cut (the handle at the end) is off.
const cutAmount = () => (skipAfter === 0 ? 0 : 100 - skipAfter);

function renderSkipAfter() {
  const cut = cutAmount();
  const handle = elements["cut-handle"];
  handle.style.left = `calc(8px + (100% - 16px) * ${1 - cut / 100})`;
  handle.setAttribute("aria-valuenow", String(cut));
  handle.setAttribute("aria-valuetext", cut ? `Cut the last ${cut}%: fade out at ${skipAfter}% and play the next track` : "No cut");
  handle.title = cut ? `Cut the last ${cut}%: fades out at ${skipAfter}% and plays the next track` : "Drag left to cut the end of each track";
  handle.toggleAttribute("data-active", cut > 0);
  renderSkipMarker();
}

function setCut(cut) {
  const clamped = Math.min(95, Math.max(0, Math.round(cut / 5) * 5));
  setSkipAfter(clamped === 0 ? 0 : 100 - clamped);
}

// The cut part of the progress slider is masked: clear at the cut point, turning into a translucent wash (the card's
// surface color, white in the light theme) over the fade. The thumb (16px) is inset at both ends of the track, hence the offset.
function renderSkipMarker() {
  const marker = elements["cut-zone"];
  marker.classList.toggle("hidden", skipAfter === 0);
  if (skipAfter === 0) return;
  const start = skipAfter / 100;
  const { duration } = player.audio;
  // The fade's share of the band; without a known track length, a short default.
  const fade = Number.isFinite(duration) && duration > 0 ? Math.min(1, SKIP_FADE_SECONDS / (duration * (1 - start))) : 0.15;
  marker.style.left = `calc(8px + (100% - 16px) * ${start})`;
  marker.style.background = `linear-gradient(to right, rgb(var(--c-surface) / 0), rgb(var(--c-surface) / 0.7) ${(fade * 100).toFixed(2)}%, rgb(var(--c-surface) / 0.7))`;
}

function setSkipAfter(value) {
  skipAfter = Math.min(95, Math.max(0, value));
  try { localStorage.setItem("skipAfter", String(skipAfter)); } catch {}
  if (skipAfter === 0) cancelSkipFade();
  renderSkipAfter();
  renderPlaylistStats();
}

// How long a track takes to listen to: up to the cut point plus the fade (which runs in real time while playback goes
// on at the current speed), never more than the whole track, at the playback speed.
function listeningSeconds(duration) {
  if (!Number.isFinite(duration)) return duration;
  const played = skipAfter > 0 ? Math.min(duration, duration * skipAfter / 100 + SKIP_FADE_SECONDS * playbackSpeed) : duration;
  return played / playbackSpeed;
}

player.audio.addEventListener("timeupdate", () => {
  const { currentTime, duration, paused } = player.audio;
  const point = duration * skipAfter / 100;
  const crossed = skipAfter > 0 && !skipFade && !paused && Number.isFinite(duration) && currentTime >= point;
  if (crossed) startSkipFade();
});
player.audio.addEventListener("seeking", cancelSkipFade);
// The fade's share of the band depends on the track's length.
player.audio.addEventListener("durationchange", renderSkipMarker);
player.audio.addEventListener("emptied", renderSkipMarker);
// Dragging the handle: its position along the track (thumb insets excluded) sets the cut, in steps of 5%.
elements["cut-handle"].addEventListener("pointerdown", event => {
  event.preventDefault();
  const handle = elements["cut-handle"];
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    const bounds = handle.parentElement.getBoundingClientRect();
    const position = (moveEvent.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16);
    setCut((1 - position) * 100);
  };
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
});
// Keys follow the handle's direction on screen: left cuts more, right less.
elements["cut-handle"].addEventListener("keydown", event => {
  const cut = cutAmount();
  const next = { ArrowLeft: cut + 5, ArrowDown: cut + 5, ArrowRight: cut - 5, ArrowUp: cut - 5, PageDown: cut + 20, PageUp: cut - 20, Home: 0, End: 95 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  setCut(next);
});
elements["cut-handle"].addEventListener("wheel", event => {
  event.preventDefault();
  setCut(cutAmount() + (event.deltaY < 0 ? 5 : -5));
}, { passive: false });
renderSkipAfter();

function renderVolume() {
  const volume = listenerVolume();
  const { muted } = player.audio;
  const level = muted ? 0 : Math.round(volume * 100);
  elements.volume.value = String(level);
  elements.volume.title = `Volume ${level}%`;
  elements["volume-value"].textContent = `${level}%`;
  const label = muted || volume === 0 ? "Unmute" : "Mute";
  elements.mute.setAttribute("aria-label", label);
  elements.mute.title = label;
  elements.mute.querySelector("use").setAttribute("href", level === 0 ? "#icon-muted" : "#icon-volume");
}

function saveVolume() {
  try {
    localStorage.setItem("volume", JSON.stringify({ volume: listenerVolume(), muted: player.audio.muted }));
  } catch (error) {
    console.error("Could not save volume:", error);
  }
}

try {
  const stored = JSON.parse(localStorage.getItem("volume"));
  if (Number.isFinite(stored?.volume)) player.audio.volume = Math.min(1, Math.max(0, stored.volume));
  player.audio.muted = stored?.muted === true;
} catch (error) {
  console.error("Could not restore volume:", error);
}
player.audio.addEventListener("volumechange", () => {
  renderVolume();
  saveVolume();
});
function setVolumeLevel(level) {
  cancelSkipFade();
  player.audio.muted = level === 0;
  if (level > 0) player.audio.volume = level / 100;
  renderVolume();
}

elements.volume.addEventListener("input", () => setVolumeLevel(Number(elements.volume.value)));
elements.volume.addEventListener("wheel", event => {
  event.preventDefault();
  // The wheel moves in steps of 5, landing on multiples of 5 (e.g. 34 → 35 → 40); dragging keeps the slider's finer step.
  const WHEEL_STEP = 5;
  const current = player.audio.muted ? 0 : Math.round(listenerVolume() * 100);
  const next = event.deltaY < 0 ? Math.floor(current / WHEEL_STEP) * WHEEL_STEP + WHEEL_STEP : Math.ceil(current / WHEEL_STEP) * WHEEL_STEP - WHEEL_STEP;
  setVolumeLevel(Math.min(100, Math.max(0, next)));
}, { passive: false });
elements.mute.addEventListener("click", () => {
  cancelSkipFade();
  if (player.audio.muted || player.audio.volume === 0) {
    player.audio.muted = false;
    if (player.audio.volume === 0) player.audio.volume = 0.5;
  } else {
    player.audio.muted = true;
  }
});
renderVolume();

const routeModes = { tracks: "track", artists: "artist", albums: "album" };
let historyReady = false;
const trackSortKeys = new Set([...sortButtons].map(button => button.dataset.sort));
const groupSortKeys = new Set([...groupSortButtons].map(button => button.dataset.groupSort));
// A sort read from the URL, applied by render() once it has settled the album-view defaults ("default" = that view's default).
let routeTrackSort = null;

// Which list the library view shows: a list of artists/albums (with its group mode), or tracks (with their default sort).
function libraryShape() {
  const artistAlbums = libraryMode === "artist" && libraryGroup !== null;
  const grouped = libraryMode !== "track" && (libraryGroup === null || (artistAlbums && artistAlbum === null));
  const albumTracks = (libraryMode === "artist" && artistAlbum !== null) || (libraryMode === "album" && libraryGroup !== null);
  return { grouped, groupMode: artistAlbums ? "album" : libraryMode, sortSlot: artistAlbums ? "artistAlbum" : libraryMode, trackDefault: albumTracks ? "trackNumber" : "title" };
}

// "?sort=key&order=desc" for the visible list, or "" when it uses its default sort.
function sortQuery() {
  const shape = libraryShape();
  const { key, direction } = shape.grouped ? groupSort[shape.sortSlot] : { key: sortKey, direction: sortDirection };
  const defaultKey = shape.grouped ? groupSortDefaults[shape.sortSlot] : shape.trackDefault;
  if (key === defaultKey && direction === "ascending") return "";
  const params = new URLSearchParams({ sort: key });
  if (direction === "descending") params.set("order", "desc");
  return `?${params}`;
}

function applySortQuery(query) {
  const params = new URLSearchParams(query);
  const key = params.get("sort");
  const direction = params.get("order") === "desc" ? "descending" : "ascending";
  const shape = libraryShape();
  if (shape.grouped) {
    const valid = groupSortKeys.has(key) && !(shape.sortSlot === "artistAlbum" && key === "artist");
    groupSort[shape.sortSlot] = valid ? { key, direction } : { key: groupSortDefaults[shape.sortSlot], direction: "ascending" };
  } else {
    routeTrackSort = trackSortKeys.has(key) ? { key, direction } : "default";
  }
}

function routeHash() {
  const encode = value => encodeURIComponent(value);
  if (currentView === "visualizer") return "#/visualizer";
  if (currentView === "lyrics") return "#/lyrics";
  if (currentView === "analysis") {
    if (analysisYear !== null) return `#/analysis/${analysisMetric}/${analysisYear}`;
    return analysisMetric === "albums" ? "#/analysis" : `#/analysis/${analysisMetric}`;
  }
  if (currentView === "playlists") return selectedPlaylistId ? `#/playlists/${encode(selectedPlaylistId)}` : "#/playlists";
  const segments = [`${libraryMode}s`];
  if (libraryMode !== "track" && libraryGroup !== null) {
    segments.push(encode(libraryGroup));
    if (libraryMode === "artist" && artistAlbum !== null) segments.push(encode(artistAlbum));
  }
  return `#/${segments.join("/")}${sortQuery()}`;
}

function syncHash() {
  const hash = routeHash();
  if (location.hash === hash) return;
  // A sort change alone replaces the entry, so Back doesn't step through every sort click.
  const samePage = location.hash.split("?")[0] === hash.split("?")[0];
  try {
    history[historyReady && !samePage ? "pushState" : "replaceState"](null, "", hash);
  } catch (error) {
    console.error("Could not update the address:", error);
  }
}

function applyRoute() {
  let parts;
  const [path, query = ""] = location.hash.split("?");
  try {
    parts = path.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  } catch {
    parts = [];
  }
  const [name, group, album] = parts;
  if (name === "visualizer") {
    currentView = "visualizer";
    return;
  }
  if (name === "lyrics") {
    currentView = "lyrics";
    return;
  }
  if (name === "analysis") {
    currentView = "analysis";
    analysisMetric = group === "tracks" ? "tracks" : "albums";
    analysisYear = Number.isSafeInteger(Number(album)) && album ? Number(album) : null;
    return;
  }
  if (name === "playlists") {
    currentView = "playlists";
    selectedPlaylistId = group || null;
    return;
  }
  currentView = "library";
  libraryMode = routeModes[name] || "track";
  libraryGroup = libraryMode === "track" ? null : group ?? null;
  artistAlbum = libraryMode === "artist" && libraryGroup !== null ? album ?? null : null;
  applySortQuery(query);
}

function validateRoute() {
  if (!library) return;
  if (analysisYear !== null && !buildYearTimeline(library.tracks).years.some(item => item.year === analysisYear)) analysisYear = null;
  if (libraryMode !== "track" && libraryGroup !== null && !library.tracks.some(track => groupKey(track, libraryMode) === libraryGroup)) {
    libraryGroup = null;
    artistAlbum = null;
  } else if (artistAlbum !== null && !library.tracks.some(track => groupKey(track, "artist") === libraryGroup && groupKey(track, "album") === artistAlbum)) {
    artistAlbum = null;
  }
  if (selectedPlaylistId && !savedPlaylists.some(saved => saved.id === selectedPlaylistId)) selectedPlaylistId = null;
}

window.addEventListener("popstate", () => {
  applyRoute();
  validateRoute();
  selectedPlaylistPaths = null;
  elements.search.value = "";
  render();
  refreshSelectedPlaylistMatch();
});

async function init() {
  applyRoute();
  render();
  if (!("showDirectoryPicker" in window)) {
    notice("Folder access requires a modern Chromium browser and a secure context (HTTPS or localhost).", true);
  }
  try {
    const [storedLibrary, storedPlaylists] = await Promise.all([loadLibrary(), loadSavedPlaylists()]);
    library = migrateLibrary(storedLibrary);
    savedPlaylists = storedPlaylists.map(migrateSavedPlaylist);
    for (const saved of savedPlaylists.filter(isDirectPlaylist)) registerDirectTracks(saved);
    // Dropped music not kept by a direct-play playlist was only in memory and can't be played after a reload.
    if (library?.playlist.some(path => isDropped(path) && !dropped.has(path))) library = { ...library, playlist: library.playlist.filter(path => !isDropped(path) || dropped.has(path)) };
    if (library && library !== storedLibrary) await saveLibrary(library);
    // Show the library right away; access checks follow.
    validateRoute();
    render();
    await Promise.all((library?.sources || []).map(checkPermission));
    if (library?.sources.some(source => !source.contents && permissionOf(source) === "granted")) {
      const sources = [];
      for (const source of library.sources) {
        let contents = source.contents;
        if (!contents && permissionOf(source) === "granted") {
          try {
            contents = await listContents(source.handle);
          } catch (error) {
            console.error(`Could not list "${source.name}":`, error);
          }
        }
        sources.push(contents ? { ...source, contents } : source);
      }
      library = { ...library, sources };
      await saveLibrary(library);
    }
    const locked = sourcesNeedingAccess();
    if (locked.length) notice(`Access needed for ${quoteNames(locked.map(source => source.name))}. Use Reconnect in Sources to play or rescan.`, true);
  } catch (error) {
    console.error("Could not load library:", error);
    notice("Couldn't open local storage. Check your browser's storage settings and reload.", true);
    elements["choose-folder"].disabled = true;
    historyReady = true;
    return;
  }
  busy = false;
  pendingSession = readSession();
  validateRoute();
  render();
  historyReady = true;
  refreshSelectedPlaylistMatch();
  restoreSession();
}

initTheme();
const themeButtons = [...document.querySelectorAll("[data-theme-option]")];
function renderThemeSwitch() {
  for (const button of themeButtons) button.setAttribute("aria-pressed", String(button.dataset.themeOption === currentPreference()));
}
for (const button of themeButtons) button.addEventListener("click", () => setPreference(button.dataset.themeOption));
document.addEventListener("themechange", renderThemeSwitch);
renderThemeSwitch();
initTooltips();
const ready = init();

// Files opened with the installed app ("Open with", or a double-click once it's the default; see file_handlers in
// manifest.webmanifest) arrive in the running window and are played like music dropped on the current playlist.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    await ready;
    await addToPlaylist({ count: files.length, files: [], handles: files.map(handle => Promise.resolve(handle)) }, { playNow: true });
  });
}
