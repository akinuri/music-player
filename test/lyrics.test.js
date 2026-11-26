import test from "node:test";
import assert from "node:assert/strict";
import { activeLyricIndex, decodeText, DEFAULT_LYRICS_FORMAT, formatOffset, isLyricsFile, lyricsFormat, parseLyrics, roundOffset } from "../src/lyrics.js";

test("plain lyrics keep their lines, including blank stanza breaks", () => {
  assert.deepEqual(parseLyrics("One\r\nTwo\n\nThree"), {
    synced: false,
    lines: [{ time: null, text: "One" }, { time: null, text: "Two" }, { time: null, text: "" }, { time: null, text: "Three" }]
  });
  assert.deepEqual(parseLyrics("  "), { synced: false, lines: [] });
  assert.deepEqual(parseLyrics(null), { synced: false, lines: [] });
});

test("LRC lyrics become synced lines sorted by time, with repeated stamps, offsets and header tags", () => {
  const result = parseLyrics("[ar:Someone]\n[offset:+500]\n[00:10.50]First\n[01:02.00][00:05]Chorus\n[00:20.25] Last ");
  assert.equal(result.synced, true);
  assert.deepEqual(result.lines, [
    { time: 5.5, text: "Chorus" },
    { time: 11, text: "First" },
    { time: 20.75, text: "Last" },
    { time: 62.5, text: "Chorus" }
  ]);
});

test("a stray timestamp in plain lyrics doesn't make them synced", () => {
  assert.equal(parseLyrics("Verse one\nVerse two\nVerse three\n[00:10] odd").synced, false);
});

test("finds the line playing at a given time", () => {
  const lines = [{ time: 5 }, { time: 10 }, { time: 20 }];
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 5), 0);
  assert.equal(activeLyricIndex(lines, 19.9), 1);
  assert.equal(activeLyricIndex(lines, 300), 2);
});

test("decodes text files as UTF-8, UTF-16 with BOM, or Windows-1252", () => {
  assert.equal(decodeText(new TextEncoder().encode("\ufeffCafé")), "Café");
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0xe9, 0x00])), "Hé");
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0xe9])), "Hé");
  assert.equal(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9])), "Café");
});

test("lyrics formats are looked up by id, falling back to the default for unknown or missing ids", () => {
  assert.equal(lyricsFormat("txt").extension, ".txt");
  assert.equal(lyricsFormat("lrc").extension, ".lrc");
  assert.equal(lyricsFormat("nope").id, DEFAULT_LYRICS_FORMAT);
  assert.equal(lyricsFormat(null).id, DEFAULT_LYRICS_FORMAT);
});

test("lyrics files are recognised by any format's extension, case-insensitively", () => {
  assert.equal(isLyricsFile("05 - Clocks.lrc"), true);
  assert.equal(isLyricsFile("05 - Clocks.TXT"), true);
  assert.equal(isLyricsFile("05 - Clocks.txt2"), false);
  assert.equal(isLyricsFile("playlists.json"), false);
});

test("lyrics offsets round to tenths without drift and read with a sign", () => {
  assert.equal(roundOffset(0.1 + 0.2), 0.3);
  assert.equal(roundOffset(-0.04), 0);
  assert.equal(roundOffset("nope"), 0);
  assert.equal(formatOffset(1.5), "+1.5 s");
  assert.equal(formatOffset(-0.5), "−0.5 s");
  assert.equal(formatOffset(0), "±0.0 s");
});
