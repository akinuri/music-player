import test from "node:test";
import assert from "node:assert/strict";
import { createSavedPlaylist, playlistMatchesLibrary } from "../src/playlists.js";

test("saves an independent playlist snapshot, retaining missing tracks", () => {
  const handle = {};
  const library = {
    handle, folderName: "Music", playlist: ["one.mp3", "missing.mp3"],
    tracks: [{ path: "one.mp3", title: "One", artist: "Artist", duration: 123 }]
  };
  const saved = createSavedPlaylist("  Mix  ", library, null, "id-1");
  library.playlist.pop();
  assert.equal(saved.name, "Mix");
  assert.equal(saved.id, "id-1");
  assert.equal(saved.folderHandle, handle);
  assert.deepEqual(saved.tracks, [{ path: "one.mp3", title: "One", artist: "Artist", duration: 123 }, { path: "missing.mp3", title: "", artist: "", duration: null }]);
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
