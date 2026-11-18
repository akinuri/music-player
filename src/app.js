import { findSiblingFile, getTrackFile, scanLibrary } from "./filesystem.js";
import { readLyrics, readMetadata } from "./metadata.js";
import { activeLyricIndex, decodeText, parseLyrics } from "./lyrics.js";
import { loadLibrary, saveLibrary, deleteLibrary, loadSavedPlaylists, saveSavedPlaylist, deleteSavedPlaylist } from "./storage.js";
import { Playback } from "./playback.js";
import { buildYearTimeline } from "./analysis.js";
import { Visualizer } from "./visualizer.js";
import { initTooltips } from "./tooltips.js";
import { initSnow } from "./snow.js";
import { currentPreference, initTheme, setPreference } from "./theme.js";
import { createImportedPlaylist, createSavedPlaylist, generatePlaylistPaths, parsePlaylists, PlaylistFileError, playlistMatchesLibrary, serializePlaylists } from "./playlists.js";
import { filterLibraryTracks, groupArtistLabel, groupKey, groupLibraryTracks, sortLibraryGroups, sortLibraryTracks } from "./library.js";

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(["choose-folder", "reconnect", "rescan", "reset-library", "search", "track-count", "artist-nav-count", "album-nav-count", "track-nav-count", "library-heading", "library-title", "tracks-table", "track-rows", "groups-table", "group-rows", "group-albums-col", "group-albums-heading", "group-artist-col", "group-artist-heading", "group-year-col", "group-year-heading", "group-name-heading", "track-artist-col", "track-artist-heading", "track-album-col", "track-album-heading", "library-meta", "notice", "notice-content", "notice-progress", "dismiss-notice", "empty", "empty-title", "empty-description", "nav-library", "nav-artist", "nav-album", "nav-track", "nav-playlists", "nav-analysis", "nav-visualizer", "visualizer-view", "visualizer-empty", "nav-lyrics", "lyrics-view", "lyrics-meta", "lyrics-lines", "lyrics-empty", "analysis-view", "analysis-heading", "analysis-title", "analysis-meta", "analysis-albums", "analysis-tracks", "analysis-empty", "analysis-body", "analysis-chart", "analysis-detail", "playlist-nav-items", "library-view", "playlists-view", "saved-title", "saved-playlists-heading", "saved-meta", "saved-actions", "import-file", "rename-form", "rename-input", "rename-submit", "rename-cancel", "saved-playlists", "saved-empty", "playlist", "playlist-stats-tabs", "playlist-count", "playlist-nav-count", "playlist-duration", "playlist-empty", "save-playlist", "save-form", "playlist-name", "save-submit", "save-cancel", "generate-playlist", "generate-form", "generate-field", "generate-minutes", "generate-toggle", "generate-options", "generate-submit", "generate-cancel", "clear-playlist", "context-menu", "context-remove", "now-playing", "now-artist", "previous", "play-pause", "stop", "next", "elapsed", "seek", "playback-duration", "mute", "volume", "volume-value"].map(id => [id, $(id)]));
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
let selectedPlaylistId = null;
let renamingId = null;
let analysisMetric = "albums";
let analysisYear = null;
const analysisSort = { albums: { column: 0, direction: "ascending" }, tracks: { column: null, direction: "ascending" } };
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
const visualizer = new Visualizer(player.audio, $("visualizer-canvas"));

const NOTICE_DURATION = 5000;
const ERROR_NOTICE_DURATION = NOTICE_DURATION * 10;
let noticeTimer = 0;

function hideNotice() {
  clearTimeout(noticeTimer);
  elements.notice.classList.add("hidden");
  elements.notice.classList.remove("flex");
}

// Notices dismiss themselves, errors after a longer time; in-progress messages stay.
function notice(message, error = false, warnings = [], { sticky = false } = {}) {
  clearTimeout(noticeTimer);
  const element = elements.notice;
  const content = elements["notice-content"];
  content.textContent = message;
  element.className = `relative overflow-hidden flex items-start gap-3 rounded-lg border px-4 py-3 text-base ${error ? "border-bd-danger bg-danger-soft text-danger" : "border-bd-ok bg-ok-soft text-forest"}`;
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

function albumText(track) {
  return `${track.album || "Unknown album"}${Number.isFinite(track.year) ? ` (${track.year})` : ""}`;
}

function renderCrumbs(container, crumbs) {
  container.replaceChildren();
  crumbs.forEach((crumb, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.setAttribute("aria-hidden", "true");
      separator.className = "font-normal";
      separator.textContent = ">";
      container.append(separator);
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "font-medium text-deep-2 hover:text-deep hover:underline";
    if (index === crumbs.length - 1) link.setAttribute("aria-current", "page");
    link.textContent = crumb.label;
    link.addEventListener("click", crumb.action);
    container.append(link);
  });
}

function renderMeta(container, items) {
  container.replaceChildren(...items.map(text => {
    const chip = document.createElement("span");
    chip.className = "rounded-md bg-tint px-2 py-0.5 text-deep";
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

function renderPlayback() {
  const track = trackFor(player.path);
  const index = playlistPaths().indexOf(player.path);
  setTitle(elements["now-playing"], player.path ? track?.title || player.path : "Nothing playing", track?.trackNumber);
  const details = track ? [track.artist || "Unknown artist", albumText(track)].join(" · ") : "";
  setPageTitle(track ? `${track.title || player.path} · ${track.artist || "Unknown artist"}` : "Music player", !!track && !player.audio.paused);
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

// Lyrics of the playing track, read from the file on demand and cached per path.
const lyricsCache = new Map();
let lyricsShown = null;
let lyricsActive = -1;
let lyricsUserScrolledAt = 0;

async function loadLyrics(path) {
  lyricsCache.set(path, { status: "loading" });
  let entry;
  // Embedded lyrics win; otherwise a same-named .txt next to the MP3 is used.
  let text = "";
  let source = "Embedded";
  let failed = false;
  try {
    text = await readLyrics(await getTrackFile(library.handle, path));
  } catch (error) {
    console.error("Could not read embedded lyrics:", error);
    failed = true;
  }
  if (!text.trim()) {
    try {
      const sidecar = await findSiblingFile(library.handle, path, ".txt");
      if (sidecar) {
        text = decodeText(await sidecar.arrayBuffer());
        source = sidecar.name;
      }
    } catch (error) {
      console.error("Could not read lyrics file:", error);
      failed = true;
    }
  }
  const parsed = parseLyrics(text);
  entry = parsed.lines.length ? { status: "ready", source, ...parsed } : { status: failed ? "error" : "none" };
  if (!library || lyricsCache.get(path)?.status !== "loading") return;
  lyricsCache.set(path, entry);
  if (currentView === "lyrics" && player.path === path) renderLyrics();
}

function renderLyrics() {
  const path = player.path;
  const track = path && trackFor(path);
  const meta = track ? [track.title || path, track.artist || "Unknown artist"] : path ? [path] : [];
  const source = path && lyricsCache.get(path)?.source;
  if (source) meta.push(source);
  const metaKey = meta.join("\n");
  if (elements["lyrics-meta"].dataset.key !== metaKey) {
    elements["lyrics-meta"].dataset.key = metaKey;
    renderMeta(elements["lyrics-meta"], meta);
  }
  if (path && library && !lyricsCache.has(path)) loadLyrics(path);
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
      : entry.status === "none" ? "No lyrics in this file or a matching .txt file."
      : entry.status === "error" ? "Couldn't read lyrics from this file."
      : "";
    elements["lyrics-empty"].textContent = message;
    elements["lyrics-empty"].classList.toggle("hidden", !message);
  }
  if (entry?.status === "ready" && entry.synced) highlightLyric(entry.lines);
}

// Highlights the synced line being sung and keeps it centred, unless the user scrolled the lyrics recently.
function highlightLyric(lines) {
  const index = activeLyricIndex(lines, (player.audio.currentTime || 0) + 0.2);
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
  player.audio.currentTime = Number(row.dataset.time);
  lyricsUserScrolledAt = 0;
});
for (const type of ["wheel", "touchmove"]) elements["lyrics-lines"].addEventListener(type, () => { lyricsUserScrolledAt = Date.now(); }, { passive: true });

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
  elements["playlist-duration"].textContent = formatTotal(part.map(path => trackFor(path) || { duration: null }));
  for (const tab of elements["playlist-stats-tabs"].children) tab.setAttribute("aria-selected", String(tab.dataset.stats === playlistStats));
}
elements["playlist-stats-tabs"].addEventListener("click", event => {
  const tab = event.target.closest("[data-stats]");
  if (!tab) return;
  playlistStats = tab.dataset.stats;
  try { localStorage.setItem("playlistStats", playlistStats); } catch {}
  renderPlaylistStats();
});

// Brings the playing track into view when it changes. Only the playlist list scrolls, never the page.
let scrolledPath = null;
function scrollToPlayingRow() {
  const row = player.path && elements.playlist.querySelector(`[data-path="${CSS.escape(player.path)}"]`);
  const scroller = elements.playlist.closest(".overflow-y-auto");
  if (!player.path) scrolledPath = null;
  if (!row || !scroller || !scroller.clientHeight) return;
  scrolledPath = player.path;
  const view = scroller.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  if (bounds.top >= view.top && bounds.bottom <= view.bottom) return;
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

function button(icon, label, action, disabled = false, compact = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = buttonTitles[icon];
  element.className = `flex ${compact ? "h-8 w-8" : "h-10 w-10"} shrink-0 items-center justify-center rounded border border-bd-in bg-field text-fg-2 hover:bg-tint-2 disabled:cursor-not-allowed disabled:opacity-40`;
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
      bar.className = `absolute bottom-0 left-1/2 w-5 -translate-x-1/2 rounded-t ${isSelected ? "bg-primary" : "bg-primary-light"}`;
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
    nav.className = "flex min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-base hover:bg-tint";
    const name = document.createElement("span");
    name.className = "min-w-0 break-words";
    name.textContent = saved.name;
    const count = document.createElement("span");
    count.className = "shrink-0 text-soft";
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
  const tracks = library?.tracks || [];
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
  const folderLabel = library ? "Change folder" : "Choose folder";
  elements["choose-folder"].setAttribute("aria-label", folderLabel);
  elements["choose-folder"].title = folderLabel;
  elements.reconnect.classList.toggle("hidden", !library || permission === "granted");
  elements.reconnect.classList.toggle("flex", !!library && permission !== "granted");
  elements.reconnect.disabled = busy;
  elements["choose-folder"].disabled = busy || !("showDirectoryPicker" in window);
  // Draw attention to the folder button until there is something to play.
  elements["choose-folder"].classList.toggle("motion-safe:animate-attention", !library && !elements["choose-folder"].disabled);
  elements.rescan.disabled = busy || !library || permission !== "granted";
  elements["reset-library"].classList.toggle("hidden", !library);
  elements["reset-library"].classList.toggle("flex", !!library);
  elements["reset-library"].disabled = busy;
  elements["group-rows"].replaceChildren();
  elements["track-rows"].replaceChildren();
  if (grouped) {
    for (const [position, group] of groups.entries()) {
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
      nameCell.className = "px-3 py-3";
      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "block max-w-full truncate text-left font-medium text-fg-2";
      nameButton.textContent = name;
      nameButton.title = name;
      nameButton.addEventListener("click", open);
      nameCell.append(nameButton);
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
      actions.className = "flex justify-end gap-2";
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
  } else filtered.forEach((track, position) => {
    const row = document.createElement("tr");
    row.className = "border-b border-bd-3 hover:bg-field last:border-b-0";
    const added = playlistPaths().includes(track.path);
    const actions = document.createElement("div");
    actions.className = "flex justify-end gap-2";
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
  elements["empty-title"].textContent = query ? "No tracks found" : library ? "No MP3 files found" : "No folder selected";
  elements["empty-description"].textContent = query ? "Try a different search term." : library ? "Add MP3 files to your folder and rescan to see them here." : "Choose a folder to index your MP3 files. Files are not uploaded.";
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
    const importButton = button("import", "Import playlists", () => elements["import-file"].click(), busy || !library);
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
      const currentTrack = selectedPlaylistMatchesLibrary ? trackFor(track.path) : null;
      const albumName = track.album || currentTrack?.album;
      const row = itemRow(
        index,
        track.title || currentTrack?.title || track.path,
        [track.artist || currentTrack?.artist || "Unknown artist", albumName ? albumText({ album: albumName, year: track.year ?? currentTrack?.year }) : ""].filter(Boolean).join(" · "),
        formatDuration(track.duration),
        "select-none sm:px-6"
      );
      setTitle(row.querySelector("[data-title]"), track.title || currentTrack?.title || track.path, track.trackNumber ?? currentTrack?.trackNumber);
      row.addEventListener("dblclick", () => playSavedTrack(selected, track.path));
      row.tabIndex = 0;
      row.classList.add("focus-visible:outline", "focus-visible:outline-2", "focus-visible:-outline-offset-2", "focus-visible:outline-primary");
      row.addEventListener("keydown", event => {
        if (event.target === row && event.key === "Delete" && !busy) removeSavedTrack(selected, index);
      });
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        openContextMenu(row, () => removeSavedTrack(selected, index), event);
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
  elements["save-playlist"].disabled = busy || !paths.length;
  elements["save-submit"].disabled = busy || !paths.length;
  elements["playlist-name"].disabled = busy;
  elements["save-cancel"].disabled = busy;
  for (const id of ["generate-playlist", "generate-submit", "generate-minutes", "generate-toggle", "generate-cancel"]) elements[id].disabled = busy || !library;
  elements.playlist.replaceChildren();
  paths.forEach((path, index) => {
    const track = trackFor(path);
    const row = itemRow(index, track?.title || path, track ? track.artist || "Unknown artist" : "Not found in library", track ? formatDuration(track.duration) : "", "select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary");
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
      openContextMenu(row, () => updatePlaylist(paths.filter((_, i) => i !== index)), event);
    });
    makeReorderable(row, index, elements.playlist, (from, to) => updatePlaylist(moveItem(paths, from, to)));
    elements.playlist.append(row);
  });
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
const dropMarks = ["shadow-[inset_0_2px_0_#315e55]", "shadow-[inset_0_-2px_0_#315e55]"];

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
}

function openContextMenu(row, onRemove, event) {
  hideContextMenu();
  contextRow = row;
  contextRemove = onRemove;
  row.classList.add("outline", "outline-2", "-outline-offset-2", "outline-primary");
  const menu = elements["context-menu"];
  menu.classList.remove("hidden");
  const keyboard = event.clientX === 0 && event.clientY === 0;
  const bounds = row.getBoundingClientRect();
  const x = keyboard ? bounds.left + 24 : event.clientX;
  const y = keyboard ? bounds.bottom : event.clientY;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  elements["context-remove"].disabled = busy;
  elements["context-remove"].focus();
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

function exportPlaylists(playlists, name) {
  const fileName = `${name.replace(/[^\p{L}\p{N} _.-]+/gu, "").trim() || "playlist"}.json`;
  const url = URL.createObjectURL(new Blob([serializePlaylists(playlists)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (existing && !window.confirm(`Replace the saved playlist "${existing.name}" from "${existing.folderName}"?`)) return;
  busy = true;
  render();
  try {
    const saved = createSavedPlaylist(name, library, existing);
    await saveSavedPlaylist(saved);
    savedPlaylists = [...savedPlaylists.filter(item => item.id !== saved.id), saved];
    library = { ...library, loadedPlaylistId: saved.id };
    await saveLibrary(library);
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
  if (matches === undefined) return false;
  if (!matches) {
    notice(`Choose the folder "${saved.folderName}" before loading this playlist.`, true);
    return false;
  }
  if (await updatePlaylist(saved.tracks.map(track => track.path), { loadedPlaylistId: saved.id })) {
    notice(`Loaded playlist "${saved.name}".`);
    return true;
  }
  return false;
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

async function playSavedTrack(saved, path) {
  if (busy) return;
  const paths = saved.tracks.map(track => track.path);
  const alreadyLoaded = library?.loadedPlaylistId === saved.id && playlistPaths().length === paths.length && playlistPaths().every((item, index) => item === paths[index]);
  if (alreadyLoaded || await loadPlaylist(saved)) playTrack(path);
}

async function removeSavedPlaylist(saved) {
  if (busy || !window.confirm(`Delete the saved playlist "${saved.name}"?`)) return;
  busy = true;
  render();
  try {
    await deleteSavedPlaylist(saved.id);
    savedPlaylists = savedPlaylists.filter(item => item.id !== saved.id);
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
  if (!library || busy) return false;
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
  if (!session || !library || permission !== "granted" || player.path || player.pendingPath) return;
  pendingSession = null;
  if (!playlistPaths().includes(session.path) || !trackFor(session.path)) {
    clearSession();
    return;
  }
  try {
    await player.play(library.handle, session.path, { startAt: session.time, autoplay: session.playing });
  } catch (error) {
    // Browsers may block autoplay after a reload; the track stays loaded and paused.
    if (error.name === "NotAllowedError" || error.name === "AbortError") return;
    console.error("Could not restore playback:", error);
    clearSession();
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
  notice("Scanning your folder…", false, [], { sticky: true });
  try {
    const { tracks, warnings } = await scanLibrary(handle, readMetadata, count => notice(`Scanning your folder… ${count.toLocaleString()} tracks indexed`, false, [], { sticky: true }));
    const sameFolder = library && await library.handle.isSameEntry(handle);
    const next = { handle, folderName: handle.name, tracks, scannedAt: Date.now(), playlist: sameFolder ? playlistPaths() : [], loadedPlaylistId: sameFolder ? library.loadedPlaylistId ?? null : null };
    await saveLibrary(next);
    if (!sameFolder) {
      player.stop();
      clearSession();
      libraryGroup = null;
      artistAlbum = null;
    }
    library = next;
    lyricsCache.clear();
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

elements["dismiss-notice"].addEventListener("click", hideNotice);

// Forgets the folder, its index and the current playlist. Saved playlists are kept.
async function resetLibrary() {
  if (busy || !library) return;
  busy = true;
  render();
  try {
    await deleteLibrary();
    player.stop();
    clearSession();
    library = null;
    permission = "prompt";
    libraryGroup = null;
    artistAlbum = null;
    await refreshSelectedPlaylistMatch();
    notice("Library reset. Choose a folder to start again.");
  } catch (error) {
    console.error("Library reset failed:", error);
    notice("Couldn't reset the library. Check your browser's storage settings and try again.", true);
  } finally {
    busy = false;
    render();
    if (!library) elements["choose-folder"].focus();
  }
}

elements["reset-library"].addEventListener("click", () => {
  if (confirm("Reset the library? This forgets the folder, its index and the current playlist. Saved playlists are kept.")) resetLibrary();
});

const dropActive = ["scale-[2]", "border-2", "border-dashed", "!border-primary", "!animate-none"];
// Extra emphasis while the drag is over the button itself, i.e. a drop would land.
const dropHover = ["!border-solid", "!bg-accent-soft", "!text-deep", "ring-4", "ring-primary/20"];

const dragHasFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
const canDropFolder = () => !busy && "showDirectoryPicker" in window && "getAsFileSystemHandle" in DataTransferItem.prototype;

async function dropFolder(dataTransfer) {
  try {
    const handles = await Promise.all([...dataTransfer.items].filter(item => item.kind === "file").map(item => item.getAsFileSystemHandle()));
    const folder = handles.find(handle => handle?.kind === "directory");
    if (!folder) notice("Drop a folder, not files.", true);
    else await runScan(folder);
  } catch (error) {
    console.error("Folder drop failed:", error);
    notice("Couldn't open that folder. Check browser permissions and try again.", true);
  }
}

function dropPlaylistFiles(dataTransfer) {
  const files = [...dataTransfer.files].filter(file => file.type === "application/json" || /.json$/i.test(file.name));
  if (!files.length) notice("Drop playlist .json files.", true);
  else importPlaylists(files);
}

// Buttons that accept dropped files. The import button is re-created on render, so targets are looked up on demand.
const dropTargets = [
  { element: () => elements["choose-folder"], enabled: canDropFolder, drop: dropFolder, text: "Drop folder" },
  // The playlists card clips its contents (rounded corners), which would cut off the enlarged button, so unclip it while dragging.
  { element: () => document.querySelector("[data-drop=playlists]"), enabled: () => !busy && !!library, drop: dropPlaylistFiles, text: "Drop playlists (.json)", unclip: node => node.closest("section") }
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
  label.style.top = `${Math.min(bounds.bottom + 6, window.innerHeight - label.offsetHeight - 4)}px`;
}

function setDropState(active, hovered = null) {
  for (const target of dropTargets) {
    const node = target.element();
    if (!node) continue;
    const on = active && !!node.offsetParent && target.enabled();
    node.classList.toggle("relative", on);
    node.classList.toggle("z-10", on);
    for (const name of dropActive) node.classList.toggle(name, on);
    for (const name of dropHover) node.classList.toggle(name, on && node === hovered);
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
    if (permission === "granted") {
      notice("Folder reconnected. You can play tracks or rescan your library.");
      restoreSession();
    } else notice("Folder access was not granted. Reconnect or choose the folder again to play or rescan.", true);
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
    const loaded = savedPlaylists.find(item => item.id === library?.loadedPlaylistId);
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
  if (event.key === "Escape" && contextRow) {
    const row = contextRow;
    hideContextMenu();
    row.focus();
  }
});
window.addEventListener("blur", hideContextMenu);
window.addEventListener("resize", hideContextMenu);
document.addEventListener("scroll", hideContextMenu, true);
elements.playlist.addEventListener("contextmenu", event => {
  if (!event.target.closest("[data-path]")) event.preventDefault();
});
elements["clear-playlist"].addEventListener("click", () => updatePlaylist([]));
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

function renderVolume() {
  const { volume, muted } = player.audio;
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
    localStorage.setItem("volume", JSON.stringify({ volume: player.audio.volume, muted: player.audio.muted }));
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
  player.audio.muted = level === 0;
  if (level > 0) player.audio.volume = level / 100;
  renderVolume();
}

elements.volume.addEventListener("input", () => setVolumeLevel(Number(elements.volume.value)));
elements.volume.addEventListener("wheel", event => {
  event.preventDefault();
  const step = Number(elements.volume.step) || 1;
  const current = player.audio.muted ? 0 : Math.round(player.audio.volume * 100);
  setVolumeLevel(Math.min(100, Math.max(0, current + (event.deltaY < 0 ? step : -step))));
}, { passive: false });
elements.mute.addEventListener("click", () => {
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
  selectedPlaylistMatchesLibrary = false;
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
    library = storedLibrary || null;
    savedPlaylists = storedPlaylists;
    if (library) {
      try {
        permission = await library.handle.queryPermission({ mode: "read" });
        if (permission !== "granted") notice("Permission needed to play or rescan. Use Reconnect to grant folder access.", true);
      } catch (error) {
        console.error("Could not check folder permission:", error);
        notice("The saved folder is unavailable. Choose the folder again to restore access.", true);
      }
    }
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
initSnow();
const themeButtons = [...document.querySelectorAll("[data-theme-option]")];
function renderThemeSwitch() {
  for (const button of themeButtons) button.setAttribute("aria-pressed", String(button.dataset.themeOption === currentPreference()));
}
for (const button of themeButtons) button.addEventListener("click", () => setPreference(button.dataset.themeOption));
document.addEventListener("themechange", renderThemeSwitch);
renderThemeSwitch();
initTooltips();
init();
