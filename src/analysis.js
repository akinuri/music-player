import { groupLibraryTracks } from "./library.js";

const MAX_FILLED_SPAN = 120;

// Counts albums and tracks per release year. An album belongs to the earliest year found among its tracks.
export function buildYearTimeline(tracks) {
  const byYear = new Map();
  const entry = year => {
    if (!byYear.has(year)) byYear.set(year, { year, tracks: [], albums: [] });
    return byYear.get(year);
  };
  let unknownTracks = 0;
  for (const track of tracks) {
    if (Number.isFinite(track.year)) entry(track.year).tracks.push(track);
    else unknownTracks++;
  }
  let unknownAlbums = 0;
  for (const album of groupLibraryTracks(tracks, "album")) {
    if (Number.isFinite(album.year)) entry(album.year).albums.push(album);
    else unknownAlbums++;
  }
  const known = [...byYear.keys()].sort((a, b) => a - b);
  const min = known[0] ?? null;
  const max = known.at(-1) ?? null;
  const years = [];
  if (known.length) {
    const fill = max - min <= MAX_FILLED_SPAN;
    for (const year of fill ? Array.from({ length: max - min + 1 }, (_, i) => min + i) : known) {
      years.push(byYear.get(year) || { year, tracks: [], albums: [] });
    }
  }
  return {
    years,
    min,
    max,
    knownTracks: tracks.length - unknownTracks,
    knownAlbums: years.reduce((sum, item) => sum + item.albums.length, 0),
    unknownTracks,
    unknownAlbums
  };
}
