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

// Formats browsers commonly play. The library indexes MP3s only; dropped music may be any of these.
export const isAudioFile = name => /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|weba|webm)$/i.test(name);

export async function* findAudioFiles(directory, prefix = "") {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") yield* findAudioFiles(handle, path);
    else if (handle.kind === "file" && isAudioFile(name)) yield { path, handle };
  }
}

export async function getTrackFileHandle(directory, path) {
  const parts = path.split("/");
  const name = parts.pop();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  return directory.getFileHandle(name);
}

export async function getTrackFile(directory, path) {
  return (await getTrackFileHandle(directory, path)).getFile();
}

// The first few top-level entries of a folder (sub-folders first), so folders with the same name
// can be told apart. Browsers don't reveal a folder's location on disk.
export async function listContents(directory, limit = 3) {
  const folders = [];
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith(".")) continue;
    (handle.kind === "directory" ? folders : files).push(name);
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const names = [...folders.sort(byName), ...files.sort(byName)];
  return { names: names.slice(0, limit), more: names.length > limit };
}

// The file next to `path` with the same base name and the given extension (case-insensitive), or null.
export async function findSiblingFile(directory, path, extension) {
  const { handle } = await findSibling(directory, path, extension);
  return handle ? handle.getFile() : null;
}

// The same, for writing: the folder it's in, its name (as found, or as it would be created) and its handle (null when
// there is no such file yet).
export async function findSibling(directory, path, extension) {
  const parts = path.split("/");
  const name = parts.pop();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  const base = `${name.replace(/\.[^.]*$/, "")}${extension}`;
  const wanted = base.toLowerCase();
  for await (const [entry, handle] of directory.entries()) {
    if (handle.kind === "file" && entry.toLowerCase() === wanted) return { directory, name: entry, handle };
  }
  return { directory, name: base, handle: null };
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
