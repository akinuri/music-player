export async function* findMp3Files(directory, prefix = "") {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      yield* findMp3Files(handle, path);
    } else if (handle.kind === "file" && /\.mp3$/i.test(name)) {
      yield { path, handle };
    }
  }
}

export async function getTrackFile(directory, path) {
  const parts = path.split("/");
  const name = parts.pop();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  const handle = await directory.getFileHandle(name);
  return handle.getFile();
}

// The file next to `path` with the same base name and the given extension (case-insensitive), or null.
export async function findSiblingFile(directory, path, extension) {
  const parts = path.split("/");
  const name = parts.pop();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  const wanted = `${name.replace(/\.[^.]*$/, "")}${extension}`.toLowerCase();
  for await (const [entry, handle] of directory.entries()) {
    if (handle.kind === "file" && entry.toLowerCase() === wanted) return handle.getFile();
  }
  return null;
}

export async function scanLibrary(directory, readMetadata, onProgress = () => {}) {
  const tracks = [];
  const warnings = [];
  for await (const { path, handle } of findMp3Files(directory)) {
    const file = await handle.getFile();
    const metadata = await readMetadata(file);
    if (metadata.issues.length) warnings.push({ path, issues: metadata.issues });
    tracks.push({
      path,
      title: metadata.title || file.name.replace(/\.mp3$/i, ""),
      artist: metadata.artist || "",
      album: metadata.album || "",
      trackNumber: metadata.trackNumber ?? null,
      year: metadata.year ?? null,
      duration: metadata.duration,
      size: file.size,
      lastModified: file.lastModified
    });
    onProgress(tracks.length);
  }
  return { tracks, warnings };
}
