import test from "node:test";
import assert from "node:assert/strict";
import { findAudioFiles, findFolderImage, findSiblingFile, getTrackFile, isAudioFile, listContents, scanLibrary } from "../src/filesystem.js";

function file(name, overrides = {}) {
  return { kind: "file", getFile: async () => ({ name, size: 12, lastModified: 1, ...overrides }) };
}

function directory(entries) {
  return { kind: "directory", async *entries() { yield* entries; } };
}

test("indexes MP3 files recursively, preserving paths and metadata fallbacks", async () => {
  const root = directory([
    ["song.MP3", file("song.MP3")],
    ["notes.txt", file("notes.txt")],
    ["album", directory([["song.mp3", file("song.mp3")]])]
  ]);
  const progress = [];
  const result = await scanLibrary(root, async input => input.name === "song.MP3"
    ? { title: "Tagged", artist: "Artist", album: "Album", trackNumber: 3, duration: 123, issues: [] }
    : { title: "", artist: "", duration: null, issues: ["metadata", "duration"] }, count => progress.push(count));
  assert.deepEqual(result.tracks.map(track => [track.path, track.title, track.artist, track.album, track.trackNumber, track.duration]), [
    ["song.MP3", "Tagged", "Artist", "Album", 3, 123],
    ["album/song.mp3", "song", "", "", null, null]
  ]);
  assert.deepEqual(result.warnings, [{ path: "album/song.mp3", issues: ["metadata", "duration"] }]);
  assert.deepEqual(progress, [1, 2]);
});

test("reports only affected paths and their specific metadata issues", async () => {
  const root = directory([
    ["tags.mp3", file("tags.mp3")],
    ["nested", directory([["duration.mp3", file("duration.mp3")]])],
    ["ok.mp3", file("ok.mp3")]
  ]);
  const issues = { "tags.mp3": ["metadata"], "duration.mp3": ["duration"], "ok.mp3": [] };
  const result = await scanLibrary(root, async input => ({ title: "", artist: "", duration: 10, issues: issues[input.name] }));
  assert.deepEqual(result.warnings, [
    { path: "tags.mp3", issues: ["metadata"] },
    { path: "nested/duration.mp3", issues: ["duration"] }
  ]);
});

test("rejects a partial scan when a file cannot be read", async () => {
  const root = directory([["bad.mp3", { kind: "file", getFile: async () => { throw new Error("access denied"); } }]]);
  await assert.rejects(scanLibrary(root, async () => ({})), /access denied/);
});

test("rejects a partial scan when a subfolder cannot be traversed", async () => {
  const root = directory([["restricted", { kind: "directory", async *entries() { throw new Error("access denied"); } }]]);
  await assert.rejects(scanLibrary(root, async () => ({})), /access denied/);
});

test("resolves a playlist path through subfolders to the original file", async () => {
  const original = { name: "song.mp3" };
  const album = { getFileHandle: async name => {
    assert.equal(name, "song.mp3");
    return { getFile: async () => original };
  } };
  const root = { getDirectoryHandle: async name => {
    assert.equal(name, "Album");
    return album;
  } };
  assert.equal(await getTrackFile(root, "Album/song.mp3"), original);
});

test("finds a same-named sibling file case-insensitively, in nested folders", async () => {
  const nested = directory([["Song.MP3", file("Song.MP3")], ["song.TXT", file("song.TXT")], ["other.txt", file("other.txt")]]);
  const root = directory([["a.mp3", file("a.mp3")], ["album", nested]]);
  root.getDirectoryHandle = async name => {
    if (name !== "album") throw new Error("missing");
    return nested;
  };
  assert.equal((await findSiblingFile(root, "album/Song.MP3", ".txt")).name, "song.TXT");
  assert.equal(await findSiblingFile(root, "a.mp3", ".txt"), null);
});

test("lists a folder's first entries, sub-folders first in natural order, skipping hidden ones", async () => {
  const root = directory([["b.mp3", file("b.mp3")], ["Rock", directory([])], [".hidden", directory([])], ["Album 10", directory([])], ["Album 2", directory([])], ["a.jpg", file("a.jpg")]]);
  assert.deepEqual(await listContents(root), { names: ["Album 2", "Album 10", "Rock"], more: true });
  assert.deepEqual(await listContents(root, 10), { names: ["Album 2", "Album 10", "Rock", "a.jpg", "b.mp3"], more: false });
});

test("finds playable audio of common formats recursively, for dropped folders", async () => {
  const root = directory([["a.MP3", file("a.MP3")], ["cover.jpg", file("cover.jpg")], ["disc 2", directory([["b.flac", file("b.flac")], ["c.m4a", file("c.m4a")], ["notes.txt", file("notes.txt")]])]]);
  const paths = [];
  for await (const { path } of findAudioFiles(root)) paths.push(path);
  assert.deepEqual(paths, ["a.MP3", "disc 2/b.flac", "disc 2/c.m4a"]);
  assert.equal(isAudioFile("x.opus"), true);
  assert.equal(isAudioFile("x.mp3.txt"), false);
});

test("the folder's cover image is found by its usual names, the most specific first", async () => {
  const withDirectories = entries => {
    const folder = directory(entries);
    folder.getDirectoryHandle = async name => entries.find(([entry]) => entry === name)[1];
    return folder;
  };
  const album = withDirectories([
    ["01 - Song.mp3", file("01 - Song.mp3")],
    ["Folder.JPG", file("Folder.JPG")],
    ["cover.png", file("cover.png")],
    ["covers.jpg", file("covers.jpg")],
    ["back.jpg", file("back.jpg")]
  ]);
  const root = withDirectories([["Album", album]]);
  assert.equal((await findFolderImage(root, "Album/01 - Song.mp3")).name, "cover.png");
  assert.equal(await findFolderImage(withDirectories([["back.jpg", file("back.jpg")]]), "song.mp3"), null);
  assert.equal((await findFolderImage(withDirectories([["AlbumArtSmall.jpg", file("AlbumArtSmall.jpg")]]), "song.mp3")).name, "AlbumArtSmall.jpg");
});
