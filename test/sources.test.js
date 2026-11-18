import test from "node:test";
import assert from "node:assert/strict";
import { migrateLibrary, relativePath, splitKey, trackKey, withoutSource, withSourceTracks } from "../src/sources.js";

test("track keys join and split on the first colon", () => {
  assert.equal(trackKey("s1", "a/b.mp3"), "s1:a/b.mp3");
  assert.deepEqual(splitKey("s1:a/b:c.mp3"), { sourceId: "s1", path: "a/b:c.mp3" });
  assert.deepEqual(splitKey("plain.mp3"), { sourceId: null, path: "plain.mp3" });
  assert.equal(relativePath("s1:a/b.mp3"), "a/b.mp3");
});

test("migrates a single-folder library into one source, re-keying tracks and the playlist", () => {
  const handle = { name: "Music" };
  const migrated = migrateLibrary({ handle, folderName: "Music", scannedAt: 5, tracks: [{ path: "a.mp3", title: "A" }], playlist: ["a.mp3"], loadedPlaylistId: "p" }, () => "s1");
  assert.deepEqual(migrated, {
    sources: [{ id: "s1", handle, name: "Music", scannedAt: 5 }],
    tracks: [{ path: "s1:a.mp3", title: "A" }],
    playlist: ["s1:a.mp3"],
    loadedPlaylistId: "p"
  });
  assert.equal(migrateLibrary(migrated), migrated);
  assert.equal(migrateLibrary(undefined), null);
});

test("rescanning a source replaces only its tracks; removing one drops its tracks and playlist entries", () => {
  const one = { id: "s1", name: "One" };
  const two = { id: "s2", name: "Two" };
  let library = withSourceTracks(null, one, [{ path: "a.mp3" }]);
  library = withSourceTracks(library, two, [{ path: "b.mp3" }]);
  library = { ...library, playlist: ["s1:a.mp3", "s2:b.mp3"] };
  library = withSourceTracks(library, { ...one, scannedAt: 9 }, [{ path: "c.mp3" }]);
  assert.deepEqual(library.sources.map(source => [source.id, source.scannedAt]), [["s1", 9], ["s2", undefined]]);
  assert.deepEqual(library.tracks.map(track => track.path), ["s2:b.mp3", "s1:c.mp3"]);
  assert.deepEqual(library.playlist, ["s1:a.mp3", "s2:b.mp3"]);
  const removed = withoutSource(library, "s1");
  assert.deepEqual(removed.sources.map(source => source.id), ["s2"]);
  assert.deepEqual(removed.tracks.map(track => track.path), ["s2:b.mp3"]);
  assert.deepEqual(removed.playlist, ["s2:b.mp3"]);
});
