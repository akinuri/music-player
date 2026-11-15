import test from "node:test";
import assert from "node:assert/strict";
import { createSavedPlaylist, generatePlaylistPaths, playlistMatchesLibrary } from "../src/playlists.js";

test("generates a random selection within the target, skipping excluded and unmeasurable tracks", () => {
  const tracks = [
    { path: "a", duration: 100 },
    { path: "b", duration: 200 },
    { path: "c", duration: 300 },
    { path: "d", duration: null },
    { path: "e", duration: 50 }
  ];
  const first = () => 0;
  const result = generatePlaylistPaths(tracks, 400, { exclude: ["a"], random: first });
  assert.ok(result.duration <= 400);
  assert.ok(!result.paths.includes("a") && !result.paths.includes("d"));
  assert.equal(result.duration, result.paths.reduce((sum, path) => sum + tracks.find(track => track.path === path).duration, 0));
  assert.equal(new Set(result.paths).size, result.paths.length);
  assert.deepEqual(generatePlaylistPaths(tracks, 10), { paths: [], duration: 0, available: 4 });
  assert.deepEqual(generatePlaylistPaths(tracks, 10000, { exclude: ["a", "b", "c", "e"] }), { paths: [], duration: 0, available: 0 });
  assert.equal(generatePlaylistPaths(tracks, 10000).paths.length, 4);
});

test("saves an independent playlist snapshot, retaining missing tracks", () => {
  const handle = {};
  const library = {
    handle, folderName: "Music", playlist: ["one.mp3", "missing.mp3"],
    tracks: [{ path: "one.mp3", title: "One", artist: "Artist", album: "Album", year: 2002, trackNumber: 5, duration: 123 }]
  };
  const saved = createSavedPlaylist("  Mix  ", library, null, "id-1");
  library.playlist.pop();
  assert.equal(saved.name, "Mix");
  assert.equal(saved.id, "id-1");
  assert.equal(saved.folderHandle, handle);
  assert.deepEqual(saved.tracks, [
    { path: "one.mp3", title: "One", artist: "Artist", album: "Album", year: 2002, trackNumber: 5, duration: 123 },
    { path: "missing.mp3", title: "", artist: "", album: "", year: null, trackNumber: null, duration: null }
  ]);
});

test("replacing a playlist keeps its identity and validates the input", () => {
  const library = { handle: {}, folderName: "Music", playlist: ["one.mp3"], tracks: [] };
  assert.equal(createSavedPlaylist("Mix", library, { id: "original" }, "new").id, "original");
  assert.throws(() => createSavedPlaylist("  ", library, null, "id"), /playlist name/);
  assert.throws(() => createSavedPlaylist("Mix", { ...library, playlist: [] }, null, "id"), /Add tracks/);
});

test("checks folder identity rather than matching folder names", async () => {
  const currentHandle = {};
  const saved = { folderHandle: { isSameEntry: async handle => handle === currentHandle } };
  assert.equal(await playlistMatchesLibrary(saved, { handle: currentHandle }), true);
  assert.equal(await playlistMatchesLibrary(saved, { handle: {} }), false);
  assert.equal(await playlistMatchesLibrary(saved, null), false);
});
