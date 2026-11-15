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
    tracks: library.playlist.map(path => {
      const track = tracksByPath.get(path);
      return { path, title: track?.title || "", artist: track?.artist || "", album: track?.album || "", year: track?.year ?? null, trackNumber: track?.trackNumber ?? null, duration: track?.duration ?? null };
    }),
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
