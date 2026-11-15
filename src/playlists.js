const EXPORT_FORMAT = "music-player-playlists";

export class PlaylistFileError extends Error {}

function snapshotTrack(path, track) {
  return { path, title: track?.title || "", artist: track?.artist || "", album: track?.album || "", year: track?.year ?? null, trackNumber: track?.trackNumber ?? null, duration: track?.duration ?? null };
}

export function createSavedPlaylist(name, library, existing, id = crypto.randomUUID()) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a playlist name.");
  if (!library?.playlist?.length) throw new Error("Add tracks before saving the playlist.");

  const tracksByPath = new Map(library.tracks.map(track => [track.path, track]));
  return {
    id: existing?.id || id,
    name: trimmedName,
    folderHandle: library.handle,
    folderName: library.folderName,
    tracks: library.playlist.map(path => snapshotTrack(path, tracksByPath.get(path))),
    savedAt: Date.now()
  };
}

export function serializePlaylists(playlists) {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: 1,
    playlists: playlists.map(({ name, folderName, tracks }) => ({ name, folderName, tracks }))
  }, null, 2);
}

const text = value => typeof value === "string" ? value : "";
const wholeNumber = value => Number.isSafeInteger(value) && value > 0 ? value : null;

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
      folderName: text(item.folderName),
      tracks: item.tracks.filter(track => text(track?.path)).map(track => ({
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

// Imported playlists belong to the connected folder; tracks found in it use its current tags.
export function createImportedPlaylist(parsed, library, existingNames, id = crypto.randomUUID()) {
  const tracksByPath = new Map(library.tracks.map(track => [track.path, track]));
  return {
    id,
    name: uniquePlaylistName(parsed.name, existingNames),
    folderHandle: library.handle,
    folderName: library.folderName,
    tracks: parsed.tracks.map(track => tracksByPath.has(track.path) ? snapshotTrack(track.path, tracksByPath.get(track.path)) : track),
    savedAt: Date.now()
  };
}

// Picks random tracks without exceeding the target. Tracks with unknown duration can't be measured, so they are skipped.
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
    if (duration + track.duration <= targetSeconds) {
      paths.push(track.path);
      duration += track.duration;
    }
  }
  return { paths, duration, available: pool.length };
}

export async function playlistMatchesLibrary(playlist, library) {
  return !!library && await playlist.folderHandle.isSameEntry(library.handle);
}
