import test from "node:test";
import assert from "node:assert/strict";
import { filterLibraryTracks, groupArtistLabel, groupLibraryTracks, sortLibraryGroups, sortLibraryTracks } from "../src/library.js";

const tracks = [
  { path: "one.mp3", title: "One", artist: "Alpha", album: "Shared" },
  { path: "two.mp3", title: "Two", artist: "Alpha", album: "Other" },
  { path: "three.mp3", title: "Three", artist: "Beta", album: "Shared" },
  { path: "unknown.mp3", title: "Unknown", artist: "", album: "" }
];

test("artist album browsing keeps tracks scoped to the chosen artist and album", () => {
  assert.deepEqual(filterLibraryTracks(tracks, "artist", "Alpha", null, "").map(track => track.path), ["one.mp3", "two.mp3"]);
  assert.deepEqual(filterLibraryTracks(tracks, "artist", "Alpha", "Shared", "").map(track => track.path), ["one.mp3"]);
  assert.deepEqual(filterLibraryTracks(tracks, "album", "Shared", null, "").map(track => track.path), ["one.mp3", "three.mp3"]);
});

test("unknown artist and album groups and search remain scoped", () => {
  assert.deepEqual(filterLibraryTracks(tracks, "artist", "", "", "").map(track => track.path), ["unknown.mp3"]);
  assert.deepEqual(filterLibraryTracks(tracks, "artist", "Alpha", null, "other").map(track => track.path), ["two.mp3"]);
  assert.deepEqual(filterLibraryTracks(tracks, "artist", "Alpha", "Shared", "three"), []);
});

test("groups filtered tracks with distinct album counts and known durations", () => {
  const songs = [
    { path: "a", artist: "Alpha", album: "Shared", duration: 60 },
    { path: "b", artist: "Alpha", album: "Shared", duration: null },
    { path: "c", artist: "Alpha", album: "", duration: 30 },
    { path: "d", artist: "", album: "", duration: null }
  ];
  const groups = groupLibraryTracks(songs, "artist");
  assert.deepEqual(groups.map(group => [group.key, group.tracks.length, group.albums.size, group.duration, group.knownDurations]), [
    ["Alpha", 3, 2, 90, 2],
    ["", 1, 1, 0, 0]
  ]);
  assert.deepEqual(groupLibraryTracks(songs.slice(0, 2), "album").map(group => [group.key, group.tracks.length]), [["Shared", 2]]);
});

test("sorts group counts and keeps entirely unknown durations last", () => {
  const groups = groupLibraryTracks([
    { artist: "A", album: "One", duration: 20 },
    { artist: "B", album: "One", duration: null },
    { artist: "C", album: "Two", duration: 50 },
    { artist: "C", album: "Three", duration: null }
  ], "artist");
  assert.deepEqual(sortLibraryGroups([...groups], "artist", "albums", "descending").map(group => group.key), ["C", "A", "B"]);
  assert.deepEqual(sortLibraryGroups([...groups], "artist", "duration", "ascending").map(group => group.key), ["A", "C", "B"]);
  assert.deepEqual(sortLibraryGroups([...groups], "artist", "duration", "descending").map(group => group.key), ["C", "A", "B"]);
});

test("album year is the earliest known track year and unknown years sort last", () => {
  const groups = groupLibraryTracks([
    { artist: "A", album: "New", year: 2010 },
    { artist: "A", album: "New", year: 2008 },
    { artist: "A", album: "Old", year: 1999 },
    { artist: "A", album: "None", year: null }
  ], "album");
  assert.deepEqual(groups.map(group => [group.key, group.year]), [["New", 2008], ["Old", 1999], ["None", null]]);
  assert.deepEqual(sortLibraryGroups([...groups], "album", "year", "ascending").map(group => group.key), ["Old", "New", "None"]);
  assert.deepEqual(sortLibraryGroups([...groups], "album", "year", "descending").map(group => group.key), ["New", "Old", "None"]);
});

test("album artist label handles single, multiple and unknown artists, and sorts by it", () => {
  const groups = groupLibraryTracks([
    { artist: "Zed", album: "Solo" },
    { artist: "Amy", album: "Mixed" },
    { artist: "Bob", album: "Mixed" },
    { artist: "", album: "Anon" }
  ], "album");
  assert.deepEqual(groups.map(groupArtistLabel), ["Zed", "Various artists", "Unknown artist"]);
  assert.deepEqual(sortLibraryGroups([...groups], "album", "artist", "ascending").map(group => group.key), ["Anon", "Mixed", "Solo"]);
});

test("sorts text columns in either direction with numeric ordering", () => {
  const songs = [
    { title: "Track 10", artist: "Beta", path: "b.mp3" },
    { title: "Track 2", artist: "Alpha", path: "a.mp3" }
  ];
  assert.deepEqual(sortLibraryTracks([...songs], "title", "ascending").map(track => track.title), ["Track 2", "Track 10"]);
  assert.deepEqual(sortLibraryTracks([...songs], "path", "descending").map(track => track.path), ["b.mp3", "a.mp3"]);
});

test("sorts albums using the displayed fallback for missing tags", () => {
  const songs = [
    { title: "First", album: "Zeta", path: "a.mp3" },
    { title: "Second", path: "b.mp3" },
    { title: "Third", album: "Alpha", path: "c.mp3" }
  ];
  assert.deepEqual(sortLibraryTracks([...songs], "album", "ascending").map(track => track.title), ["Third", "Second", "First"]);
  assert.deepEqual(sortLibraryTracks([...songs], "album", "descending").map(track => track.title), ["First", "Second", "Third"]);
});

test("keeps unknown durations last in both sort directions", () => {
  const songs = [
    { title: "Missing", path: "missing.mp3", duration: null },
    { title: "Long", path: "long.mp3", duration: 90 },
    { title: "Short", path: "short.mp3", duration: 10 }
  ];
  assert.deepEqual(sortLibraryTracks([...songs], "duration", "ascending").map(track => track.title), ["Short", "Long", "Missing"]);
  assert.deepEqual(sortLibraryTracks([...songs], "duration", "descending").map(track => track.title), ["Long", "Short", "Missing"]);
});

test("sorts track numbers numerically and keeps missing numbers last", () => {
  const songs = [
    { title: "Missing", path: "missing.mp3" },
    { title: "Ten", path: "ten.mp3", trackNumber: 10 },
    { title: "Two", path: "two.mp3", trackNumber: 2 },
    { title: "Unknown", path: "unknown.mp3", trackNumber: null }
  ];
  assert.deepEqual(sortLibraryTracks([...songs], "trackNumber", "ascending").map(track => track.title), ["Two", "Ten", "Missing", "Unknown"]);
  assert.deepEqual(sortLibraryTracks([...songs], "trackNumber", "descending").map(track => track.title), ["Ten", "Two", "Missing", "Unknown"]);
});
