export function groupKey(track, mode) {
  return track[mode] || "";
}

export function filterLibraryTracks(tracks, mode, group, artistAlbum, query) {
  return tracks.filter(track =>
    (mode === "track" || group === null || groupKey(track, mode) === group) &&
    (mode !== "artist" || artistAlbum === null || groupKey(track, "album") === artistAlbum) &&
    [track.title, track.artist || "Unknown artist", track.album || "Unknown album", track.path]
      .some(value => value.toLocaleLowerCase().includes(query))
  );
}

export function groupLibraryTracks(tracks, mode) {
  const groups = new Map();
  for (const track of tracks) {
    const key = groupKey(track, mode);
    if (!groups.has(key)) groups.set(key, { key, tracks: [],     albums: new Set(), duration: 0, knownDurations: 0, year: null });
    const group = groups.get(key);
    group.tracks.push(track);
        if (Number.isFinite(track.year) && (group.year === null || track.year < group.year)) group.year = track.year;
    group.albums.add(groupKey(track, "album"));
    if (Number.isFinite(track.duration)) {
      group.duration += track.duration;
      group.knownDurations++;
    }
  }
  return [...groups.values()];
}

export function sortLibraryGroups(groups, mode, key, direction) {
  const name = group => group.key || (mode === "artist" ? "Unknown artist" : "Unknown album");
  const compareNames = (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: "base", numeric: true });
  const sign = direction === "ascending" ? 1 : -1;
  return groups.sort((a, b) => {
    if (key === "duration" && (a.knownDurations === 0) !== (b.knownDurations === 0)) return a.knownDurations ? -1 : 1;
    if (key === "year" && (a.year === null) !== (b.year === null)) return a.year === null ? 1 : -1;
    const comparison = key === "name" ? compareNames(a, b)
      : key === "year" ? (a.year ?? 0) - (b.year ?? 0)
      : key === "albums" ? a.albums.size - b.albums.size
      : key === "tracks" ? a.tracks.length - b.tracks.length
      : a.duration - b.duration;
    return sign * comparison || compareNames(a, b);
  });
}

export function sortLibraryTracks(tracks, key, direction) {
  const sign = direction === "ascending" ? 1 : -1;
  return tracks.sort((a, b) => {
    let comparison;
    if (key === "duration" || key === "trackNumber") {
      const aKnown = Number.isFinite(a[key]);
      const bKnown = Number.isFinite(b[key]);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      comparison = aKnown ? a[key] - b[key] : 0;
    } else {
      const aValue = key === "album" ? a.album || "Unknown album" : a[key];
      const bValue = key === "album" ? b.album || "Unknown album" : b[key];
      comparison = aValue.localeCompare(bValue, undefined, { sensitivity: "base", numeric: true });
    }
    return sign * comparison || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
  });
}
