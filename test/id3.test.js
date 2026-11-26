import test from "node:test";
import assert from "node:assert/strict";
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { frameText, genreText, readGenre, readTagFrames, tagLength, TagWriteError, writeTags } from "../src/id3.js";

const ascii = text => Array.from(text, char => char.charCodeAt(0));
const be32 = value => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const safe32 = value => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];

function frame(id, body, version = 3) {
  return [...ascii(id), ...(version === 4 ? safe32(body.length) : be32(body.length)), 0, 0, ...body];
}
const text = (id, value, version = 3) => frame(id, [version === 4 ? 3 : 0, ...(version === 4 ? new TextEncoder().encode(value) : ascii(value))], version);

// A tag of the given frames plus some padding, followed by fake audio.
function mp3(frames, { version = 3, flags = 0 } = {}) {
  const body = [...frames.flat(), ...new Array(16).fill(0)];
  return Uint8Array.from([...ascii("ID3"), version, 0, flags, ...safe32(body.length), ...body, ...AUDIO]);
}
const AUDIO = [0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5];
const COVER = frame("APIC", [0, ...ascii("image/png"), 0, 3, 0, 0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const LYRICS = frame("USLT", [0, ...ascii("eng"), 0, ...ascii("The lights go out")]);

const readWithJsmediatags = bytes => new Promise((resolve, reject) => {
  jsmediatags.read(Buffer.from(bytes), { onSuccess: ({ tags }) => resolve(tags), onError: reject });
});
const frameOf = (bytes, id) => readTagFrames(bytes).frames.find(entry => entry.id === id);

test("changed fields are rewritten; other frames and the audio stay byte for byte", async () => {
  const original = mp3([text("TIT2", "Clock"), COVER, text("TRCK", "5/12"), LYRICS, text("TPE1", "Coldplay")]);
  const written = writeTags(original, { title: "Clocks", trackNumber: 7 });
  assert.deepEqual([...frameOf(written, "APIC").raw], COVER);
  assert.deepEqual([...frameOf(written, "USLT").raw], LYRICS);
  assert.deepEqual([...written.subarray(written.length - AUDIO.length)], AUDIO);
  assert.equal(frameText(frameOf(written, "TIT2").raw), "Clocks");
  // The album's track count is kept.
  assert.equal(frameText(frameOf(written, "TRCK").raw), "7/12");
  assert.equal(frameText(frameOf(written, "TPE1").raw), "Coldplay");
  const tags = await readWithJsmediatags(written);
  assert.equal(tags.title, "Clocks");
  assert.equal(tags.artist, "Coldplay");
  assert.equal(tags.track, "7/12");
});

test("text outside Latin-1 is written as UTF-16 in 2.3 tags and UTF-8 in 2.4 tags", async () => {
  for (const version of [3, 4]) {
    const written = writeTags(mp3([text("TIT2", "Old", version)], { version }), { title: "Saat · 時計", artist: "Sigur Rós" });
    assert.equal(readTagFrames(written).version, version);
    assert.equal(frameOf(written, "TIT2").raw[10], version === 4 ? 3 : 1);
    const tags = await readWithJsmediatags(written);
    assert.equal(tags.title, "Saat · 時計");
    assert.equal(tags.artist, "Sigur Rós");
  }
});

test("years use their version's frame and replace the other version's", () => {
  const v3 = writeTags(mp3([text("TDRC", "1999")]), { year: 2002 });
  assert.deepEqual(readTagFrames(v3).frames.map(entry => entry.id), ["TYER"]);
  const v4 = writeTags(mp3([text("TYER", "1999", 4)], { version: 4 }), { year: 2002 });
  assert.deepEqual(readTagFrames(v4).frames.map(entry => entry.id), ["TDRC"]);
  assert.equal(frameText(frameOf(v4, "TDRC").raw), "2002");
});

test("an empty value removes the field", () => {
  const written = writeTags(mp3([text("TIT2", "Clocks"), text("TALB", "A Rush of Blood")]), { album: "" });
  assert.deepEqual(readTagFrames(written).frames.map(entry => entry.id), ["TIT2"]);
});

test("a file without a tag gets a 2.3 tag in front of the untouched audio", async () => {
  const written = writeTags(Uint8Array.from(AUDIO), { title: "Clocks", year: 2002 });
  assert.equal(readTagFrames(written).version, 3);
  assert.deepEqual([...written.subarray(written.length - AUDIO.length)], AUDIO);
  const tags = await readWithJsmediatags(written);
  assert.equal(tags.title, "Clocks");
  assert.equal(tags.year, "2002");
});

test("tags that can't be edited safely are refused", () => {
  assert.throws(() => writeTags(mp3([text("TIT2", "x")], { flags: 0x80 }), { title: "y" }), TagWriteError);
  const v22 = Uint8Array.from([...ascii("ID3"), 2, 0, 0, ...safe32(0), ...AUDIO]);
  assert.throws(() => writeTags(v22, { title: "y" }), /too old/);
  const damaged = mp3([text("TIT2", "x")]);
  damaged[17] = 0x7f;
  assert.throws(() => writeTags(damaged, { title: "y" }), /damaged/);
});

test("numbered genres read as names, own words win, and several values are joined", () => {
  assert.equal(genreText("(17)"), "Rock");
  assert.equal(genreText("17"), "Rock");
  assert.equal(genreText("(17)Rock music"), "Rock music");
  assert.equal(genreText("(17)(20)"), "Rock, Alternative");
  assert.equal(genreText("((Live)"), "(Live)");
  assert.equal(genreText("(RX)"), "Remix");
  assert.equal(genreText("Shoegaze"), "Shoegaze");
  assert.equal(genreText("13\0Indie Rock"), "Pop, Indie Rock");
  assert.equal(genreText("(999)"), "999");
});

test("the genre is read from just the tag, and written as a name", () => {
  const original = mp3([text("TIT2", "Clocks"), text("TCON", "(20)"), COVER]);
  const length = tagLength(original.subarray(0, 10));
  assert.equal(length, original.length - AUDIO.length);
  assert.equal(tagLength(Uint8Array.from(AUDIO.concat(0, 0, 0, 0, 0, 0))), 0);
  assert.equal(readGenre(original.subarray(0, length)), "Alternative");
  const written = writeTags(original, { genre: "Alternative Rock" });
  assert.equal(readGenre(written), "Alternative Rock");
  assert.deepEqual([...frameOf(written, "APIC").raw], COVER);
});
