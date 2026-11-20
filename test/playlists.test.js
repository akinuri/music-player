import test from "node:test";
import assert from "node:assert/strict";
import { createImportedPlaylist, createSavedPlaylist, generatePlaylistPaths, migrateSavedPlaylist, parsePlaylists, PlaylistFileError, resolvePlaylist, serializePlaylists } from "../src/playlists.js";

const track = (path, extra = {}) => ({ path, title: "", artist: "", album: "", year: null, trackNumber: null, duration: null, ...extra });

test("playlists round-trip through export files by folder name, and reject foreign or broken files", () => {
  const playlist = { name: "Mix", sources: [{ id: "s1", handle: {}, name: "Music" }], tracks: [track("s1:a/one.mp3", { title: "One", artist: "A", album: "B", year: 2001, trackNumber: 3, duration: 90 })] };
  const exported = serializePlaylists([playlist]);
  assert.equal(exported.includes("handle"), false);
  assert.deepEqual(parsePlaylists(exported), [{ name: "Mix", tracks: [{ source: "Music", ...track("a/one.mp3", { title: "One", artist: "A", album: "B", year: 2001, trackNumber: 3, duration: 90 }) }] }]);
  const messy = JSON.stringify({ format: "music-player-playlists", playlists: [{ name: " Messy ", tracks: [{ path: "x.mp3", year: "2000", trackNumber: 0, duration: -5, title: 7 }, { path: "" }, null] }] });
  assert.deepEqual(parsePlaylists(messy), [{ name: "Messy", tracks: [{ source: "", ...track("x.mp3") }] }]);
  for (const bad of ["{", "{}", JSON.stringify({ format: "music-player-playlists", playlists: [{ tracks: [] }] }), JSON.stringify({ format: "other", playlists: [] })]) {
    assert.throws(() => parsePlaylists(bad), PlaylistFileError);
  }
});

test("version 1 export files use the playlist's folder name for every track", () => {
  const v1 = JSON.stringify({ format: "music-player-playlists", version: 1, playlists: [{ name: "Old", folderName: "Music", tracks: [{ path: "a.mp3" }] }] });
  assert.deepEqual(parsePlaylists(v1)[0].tracks.map(item => [item.source, item.path]), [["Music", "a.mp3"]]);
});

test("imported playlists match folders by name, refresh tags, and keep unknown folders for later", () => {
  const music = { id: "s1", handle: {}, name: "Music" };
  const extra = { id: "s2", handle: {}, name: "Extra" };
  const library = { sources: [music, extra], tracks: [track("s1:a.mp3", { title: "Fresh", duration: 100 })] };
  const parsed = { name: "Mix", tracks: [{ source: "music", ...track("a.mp3", { title: "Stale" }) }, { source: "Elsewhere", ...track("gone.mp3", { title: "Gone" }) }] };
  const imported = createImportedPlaylist(parsed, library, ["mix", "Mix (2)"], "id-9");
  assert.equal(imported.name, "Mix (3)");
  assert.deepEqual(imported.tracks.map(item => [item.path, item.title]), [["s1:a.mp3", "Fresh"], ["missing-elsewhere:gone.mp3", "Gone"]]);
  assert.deepEqual(imported.sources.map(source => [source.id, source.name]), [["s1", "Music"], ["missing-elsewhere", "Elsewhere"]]);
  // With one folder, files from before multiple sources map to it regardless of name.
  const single = createImportedPlaylist({ name: "Solo", tracks: [{ source: "Old name", ...track("a.mp3") }] }, { sources: [music], tracks: [] }, [], "id-10");
  assert.deepEqual(single.tracks.map(item => item.path), ["s1:a.mp3"]);
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
  assert.ok(result.duration - tracks.find(item => item.path === result.paths.at(-1)).duration < 400);
  assert.ok(!result.paths.includes("a") && !result.paths.includes("d"));
  assert.equal(result.duration, result.paths.reduce((sum, path) => sum + tracks.find(item => item.path === path).duration, 0));
  assert.equal(new Set(result.paths).size, result.paths.length);
  assert.equal(generatePlaylistPaths(tracks, 10).paths.length, 1);
  assert.deepEqual(generatePlaylistPaths(tracks, 10000, { exclude: ["a", "b", "c", "e"] }), { paths: [], duration: 0, available: 0 });
  assert.equal(generatePlaylistPaths(tracks, 10000).paths.length, 4);
});

test("saves an independent playlist snapshot with the folders it uses, retaining missing tracks", () => {
  const handle = {};
  const library = {
    sources: [{ id: "s1", handle, name: "Music", scannedAt: 1 }, { id: "s2", handle: {}, name: "Unused" }],
    playlist: ["s1:one.mp3", "s1:missing.mp3"],
    tracks: [track("s1:one.mp3", { title: "One", artist: "Artist", album: "Album", year: 2002, trackNumber: 5, duration: 123 })]
  };
  const saved = createSavedPlaylist("  Mix  ", library, null, "id-1");
  library.playlist.pop();
  assert.equal(saved.name, "Mix");
  assert.equal(saved.id, "id-1");
  assert.deepEqual(saved.sources, [{ id: "s1", handle, name: "Music" }]);
  assert.deepEqual(saved.tracks, [
    track("s1:one.mp3", { title: "One", artist: "Artist", album: "Album", year: 2002, trackNumber: 5, duration: 123 }),
    track("s1:missing.mp3")
  ]);
});

test("replacing a playlist keeps its identity and validates the input", () => {
  const library = { sources: [], playlist: ["s1:one.mp3"], tracks: [] };
  assert.equal(createSavedPlaylist("Mix", library, { id: "original" }, "new").id, "original");
  assert.throws(() => createSavedPlaylist("  ", library, null, "id"), /playlist name/);
  assert.throws(() => createSavedPlaylist("Mix", { ...library, playlist: [] }, null, "id"), /Add tracks/);
});

test("migrates single-folder saved playlists", () => {
  const folderHandle = {};
  const migrated = migrateSavedPlaylist({ id: "p", name: "Old", folderHandle, folderName: "Music", tracks: [track("a.mp3")], savedAt: 1 });
  assert.deepEqual(migrated, { id: "p", name: "Old", sources: [{ id: "folder", handle: folderHandle, name: "Music" }], tracks: [track("folder:a.mp3")], savedAt: 1 });
  assert.equal(migrateSavedPlaylist(migrated), migrated);
});

test("direct-play tracks resolve to themselves and their file handles stay out of exports", async () => {
  const saved = { name: "Direct play 001", instant: true, sources: [], tracks: [track("drop:ab12/Song.mp3", { title: "Song", handle: { kind: "file" }, relative: "Song.mp3" })] };
  assert.deepEqual(await resolvePlaylist(saved, { sources: [] }), { paths: ["drop:ab12/Song.mp3"], missing: [] });
  const exported = JSON.parse(serializePlaylists([saved])).playlists[0].tracks[0];
  assert.equal("handle" in exported || "relative" in exported, false);
  assert.equal(exported.title, "Song");
});

test("resolves saved tracks to current sources by id, then same folder on disk, then unique name", async () => {
  const disk = {};
  const current = [{ id: "s1", handle: {}, name: "Music" }, { id: "s2", handle: disk, name: "Renamed" }, { id: "s3", handle: {}, name: "Extra" }];
  const saved = {
    sources: [
      { id: "s1", handle: {}, name: "Music" },
      { id: "old", handle: { isSameEntry: async handle => handle === disk }, name: "Whatever" },
      { id: "missing-extra", handle: null, name: "extra" },
      { id: "gone", handle: { isSameEntry: async () => false }, name: "Gone" }
    ],
    tracks: [track("s1:a.mp3"), track("old:b.mp3"), track("missing-extra:c.mp3"), track("gone:d.mp3")]
  };
  assert.deepEqual(await resolvePlaylist(saved, { sources: current }), { paths: ["s1:a.mp3", "s2:b.mp3", "s3:c.mp3", "gone:d.mp3"], missing: ["Gone"] });
  assert.deepEqual((await resolvePlaylist(saved, null)).missing, ["Music", "Whatever", "extra", "Gone"]);
});
