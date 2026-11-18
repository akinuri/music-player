// A library can have several source folders. Tracks are keyed "sourceId:relative/path", so keys stay unique across
// folders while everything that stores keys (playlists, session, caches) keeps treating them as opaque strings.

export function trackKey(sourceId, relativePath) {
  return `${sourceId}:${relativePath}`;
}

export function splitKey(key) {
  const index = key.indexOf(":");
  return index < 0 ? { sourceId: null, path: key } : { sourceId: key.slice(0, index), path: key.slice(index + 1) };
}

// The path inside its folder, for display.
export function relativePath(key) {
  return splitKey(key).path;
}

// Libraries saved before multiple sources existed had one `handle`; they become a library with one source.
export function migrateLibrary(stored, newId = () => crypto.randomUUID()) {
  if (!stored || Array.isArray(stored.sources)) return stored || null;
  const id = newId();
  return {
    sources: [{ id, handle: stored.handle, name: stored.folderName || stored.handle?.name || "Music", scannedAt: stored.scannedAt ?? null }],
    tracks: (stored.tracks || []).map(track => ({ ...track, path: trackKey(id, track.path) })),
    playlist: (stored.playlist || []).map(path => trackKey(id, path)),
    loadedPlaylistId: stored.loadedPlaylistId ?? null
  };
}

// Adds the source (or updates it in place) and replaces its tracks with freshly scanned ones (relative paths).
export function withSourceTracks(library, source, scannedTracks) {
  const sources = library?.sources || [];
  const known = sources.some(item => item.id === source.id);
  return {
    sources: known ? sources.map(item => item.id === source.id ? source : item) : [...sources, source],
    tracks: [
      ...(library?.tracks || []).filter(track => splitKey(track.path).sourceId !== source.id),
      ...scannedTracks.map(track => ({ ...track, path: trackKey(source.id, track.path) }))
    ],
    playlist: library?.playlist || [],
    loadedPlaylistId: library?.loadedPlaylistId ?? null
  };
}

// Drops a source with its tracks, including them in the current playlist.
export function withoutSource(library, sourceId) {
  const keep = path => splitKey(path).sourceId !== sourceId;
  return {
    ...library,
    sources: library.sources.filter(source => source.id !== sourceId),
    tracks: library.tracks.filter(track => keep(track.path)),
    playlist: library.playlist.filter(keep)
  };
}
