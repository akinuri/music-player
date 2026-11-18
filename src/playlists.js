import { relativePath, splitKey, trackKey } from "./sources.js";

const EXPORT_FORMAT = "music-player-playlists";

export class PlaylistFileError extends Error {}

function snapshotTrack(path, track) {
  return { path, title: track?.title || "", artist: track?.artist || "", album: track?.album || "", year: track?.year ?? null, trackNumber: track?.trackNumber ?? null, duration: track?.duration ?? null };
}

// The playlist's own record of the folders its tracks come from (id, handle, name), so it can find them again later.
function sourcesFor(paths, sources) {
  const used = new Set(paths.map(path => splitKey(path).sourceId));
  return sources.filter(source => used.has(source.id)).map(({ id, handle, name }) => ({ id, handle, name }));
}

export function createSavedPlaylist(name, library, existing, id = crypto.randomUUID()) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a playlist name.");
  if (!library?.playlist?.length) throw new Error("Add tracks before saving the playlist.");

  const tracksByPath = new Map(library.tracks.map(track => [track.path, track]));
  return {
    id: existing?.id || id,
    name: trimmedName,
    sources: sourcesFor(library.playlist, library.sources),
    tracks: library.playlist.map(path => snapshotTrack(path, tracksByPath.get(path))),
    savedAt: Date.now()
  };
}

// Playlists saved before multiple sources existed had one folder for all tracks.
export function migrateSavedPlaylist(saved) {
  if (Array.isArray(saved?.sources)) return saved;
  const { folderHandle, folderName, ...rest } = saved;
  return {
    ...rest,
    sources: [{ id: "folder", handle: folderHandle ?? null, name: folderName || "" }],
    tracks: saved.tracks.map(track => ({ ...track, path: trackKey("folder", track.path) }))
  };
}

export function playlistSourceNames(saved) {
  return [...new Set(saved.sources.map(source => source.name).filter(Boolean))];
}

// Exported tracks name their folder rather than an internal id, so files stay readable and portable.
export function serializePlaylists(playlists) {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: 2,
    playlists: playlists.map(({ name, sources, tracks }) => {
      const names = new Map(sources.map(source => [source.id, source.name]));
      return { name, tracks: tracks.map(track => ({ ...track, source: names.get(splitKey(track.path).sourceId) || "", path: relativePath(track.path) })) };
    })
  }, null, 2);
}

const text = value => typeof value === "string" ? value : "";
const wholeNumber = value => Number.isSafeInteger(value) && value > 0 ? value : null;

// Returns playlists whose tracks carry their folder name in `source` and a path relative to it.
// Version 1 files had one `folderName` per playlist.
export function parsePlaylists(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new PlaylistFileError("The file is not valid JSON.");
  }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.playlists)) throw new PlaylistFileError("This is not an exported playlist file.");
  return data.playlists.map(item => {
    const name = text(item?.name).trim();
    if (!name || !Array.isArray(item.tracks)) throw new PlaylistFileError("A playlist in the file has no name or tracks.");
    return {
      name,
      tracks: item.tracks.filter(track => text(track?.path)).map(track => ({
        source: text(track.source) || text(item.folderName),
        path: track.path,
        title: text(track.title),
        artist: text(track.artist),
        album: text(track.album),
        year: wholeNumber(track.year),
        trackNumber: wholeNumber(track.trackNumber),
        duration: Number.isFinite(track.duration) && track.duration > 0 ? track.duration : null
      }))
    };
  });
}

export function uniquePlaylistName(name, existingNames) {
  const taken = new Set(existingNames.map(existing => existing.toLocaleLowerCase()));
  let candidate = name;
  for (let number = 2; taken.has(candidate.toLocaleLowerCase()); number++) candidate = `${name} (${number})`;
  return candidate;
}

// Imported tracks are matched to library sources by folder name. With a single source, unnamed or unknown folders map to it
// (as files from before multiple sources expect). Unmatched folders are kept by name so adding them later resolves the tracks.
export function createImportedPlaylist(parsed, library, existingNames, id = crypto.randomUUID()) {
  const tracksByPath = new Map(library.tracks.map(track => [track.path, track]));
  const byName = name => library.sources.find(source => source.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const sources = new Map();
  const sourceFor = name => {
    const match = (name && byName(name)) || (library.sources.length === 1 ? library.sources[0] : null);
    const source = match ? { id: match.id, handle: match.handle, name: match.name } : { id: `missing-${name.toLocaleLowerCase()}`, handle: null, name };
    sources.set(source.id, source);
    return source.id;
  };
  const tracks = parsed.tracks.map(({ source, ...track }) => {
    const path = trackKey(sourceFor(source), track.path);
    return tracksByPath.has(path) ? snapshotTrack(path, tracksByPath.get(path)) : { ...track, path };
  });
  return { id, name: uniquePlaylistName(parsed.name, existingNames), sources: [...sources.values()], tracks, savedAt: Date.now() };
}

// Maps a saved playlist's tracks onto the library's current sources: same source, else the same folder on disk
// (e.g. re-added), else a folder with the same name. Returns the current keys and the names of folders not found.
export async function resolvePlaylist(saved, library) {
  const current = library?.sources || [];
  const mapping = new Map();
  for (const source of saved.sources) {
    let match = current.find(item => item.id === source.id);
    for (const candidate of match || !source.handle ? [] : current) {
      if (await source.handle.isSameEntry(candidate.handle)) {
        match = candidate;
        break;
      }
    }
    const sameName = current.filter(item => item.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());
    match ||= sameName.length === 1 ? sameName[0] : null;
    mapping.set(source.id, match?.id ?? null);
  }
  const missing = new Set();
  const paths = saved.tracks.map(track => {
    const { sourceId, path } = splitKey(track.path);
    const target = mapping.get(sourceId);
    if (!target) {
      missing.add(saved.sources.find(source => source.id === sourceId)?.name || "an unknown folder");
      return track.path;
    }
    return trackKey(target, path);
  });
  return { paths, missing: [...missing] };
}

// Takes shuffled tracks until the total reaches the target (the last track may overshoot). Tracks with unknown duration can't be measured, so they are skipped.
export function generatePlaylistPaths(tracks, targetSeconds, { exclude = [], random = Math.random } = {}) {
  const skip = new Set(exclude);
  const pool = tracks.filter(track => Number.isFinite(track.duration) && track.duration > 0 && !skip.has(track.path));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const paths = [];
  let duration = 0;
  for (const track of pool) {
    if (duration >= targetSeconds) break;
    paths.push(track.path);
    duration += track.duration;
  }
  return { paths, duration, available: pool.length };
}
