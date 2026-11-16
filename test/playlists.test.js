import test from "node:test";
import assert from "node:assert/strict";
import { createImportedPlaylist, createSavedPlaylist, generatePlaylistPaths, parsePlaylists, PlaylistFileError, playlistMatchesLibrary, serializePlaylists } from "../src/playlists.js";

test("playlists round-trip through export files and reject foreign or broken files", () => {
  const playlist = { name: "Mix", folderName: "Music", folderHandle: {}, tracks: [{ path: "a/one.mp3", title: "One", artist: "A", album: "B", year: 2001, trackNumber: 3, duration: 90 }] };
  assert.deepEqual(parsePlaylists(serializePlaylists([playlist])), [{ name: "Mix", folderName: "Music", tracks: playlist.tracks }]);
  assert.equal(serializePlaylists([playlist]).includes("folderHandle"), false);
  const messy = JSON.stringify({ format: "music-player-playlists", playlists: [{ name: " Messy ", tracks: [{ path: "x.mp3", year: "2000", trackNumber: 0, duration: -5, title: 7 }, { path: "" }, null] }] });
  assert.deepEqual(parsePlaylists(messy), [{ name: "Messy", folderName: "", tracks: [{ path: "x.mp3", title: "", artist: "", album: "", year: null, trackNumber: null, duration: null }] }]);
  for (const bad of ["{", "{}", JSON.stringify({ format: "music-player-playlists", playlists: [{ tracks: [] }] }), JSON.stringify({ format: "other", playlists: [] })]) {
    assert.throws(() => parsePlaylists(bad), PlaylistFileError);
  }
});

test("imported playlists get a unique name and refresh tags from the connected library", () => {
  const library = { handle: {}, folderName: "Music", tracks: [{ path: "a.mp3", title: "Fresh", artist: "Now", album: "Alb", year: 2010, trackNumber: 2, duration: 100 }] };
  const parsed = { name: "Mix", folderName: "Old", tracks: [{ path: "a.mp3", title: "Stale", artist: "", album: "", year: null, trackNumber: null, duration: null }, { path: "gone.mp3", title: "Gone", artist: "", album: "", year: null, trackNumber: null, duration: 5 }] };
  const imported = createImportedPlaylist(parsed, library, ["mix", "Mix (2)"], "id-9");
  assert.equal(imported.name, "Mix (3)");
  assert.equal(imported.folderHandle, library.handle);
  assert.equal(imported.folderName, "Music");
  assert.equal(imported.tracks[0].title, "Fresh");
  assert.equal(imported.tracks[1].title, "Gone");
});

test("generates random tracks until the target is reached, skipping excluded and unmeasurable tracks", () => {
  const tracks = [
    { path: "a", duration: 100 },
    { path: "b", duration: 200 },
    { path: "c", duration: 300 },
    { path: "d", duration: null },
    { path: "e", duration: 50 }
  ];
  const first = () => 0;
  const result = generatePlaylistPaths(tracks, 400, { exclude: ["a"], random: first });
  // Stops once the target is reached, without skipping long tracks to fill the gap.
  assert.ok(result.duration >= 400);
  assert.ok(result.duration - tracks.find(track => track.path === result.paths.at(-1)).duration < 400);
  assert.ok(!result.paths.includes("a") && !result.paths.includes("d"));
  assert.equal(result.duration, result.paths.reduce((sum, path) => sum + tracks.find(track => track.path === path).duration, 0));
  assert.equal(new Set(result.paths).size, result.paths.length);
  assert.equal(generatePlaylistPaths(tracks, 10).paths.length, 1);
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
