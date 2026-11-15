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
      return { path, title: track?.title || "", artist: track?.artist || "", duration: track?.duration ?? null };
    }),
    savedAt: Date.now()
  };
}

export async function playlistMatchesLibrary(playlist, library) {
  return !!library && await playlist.folderHandle.isSameEntry(library.handle);
}
