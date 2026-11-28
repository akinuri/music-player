import test from "node:test";
import assert from "node:assert/strict";
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { frameText, genreText, languageFrameContent, readCover, readFields, readGenre, readLyricsText, readTagFrames, tagLength, TagWriteError, writeTags } from "../src/id3.js";

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

const lyricsOf = tags => typeof tags.lyrics === "string" ? tags.lyrics : tags.lyrics?.lyrics;

test("lyrics replace the first lyrics frame in place, keeping its language; others stay", async () => {
  const french = frame("USLT", [0, ...ascii("fra"), ...ascii("fr"), 0, ...ascii("Les lumieres")]);
  const original = mp3([text("TIT2", "Clocks"), LYRICS, COVER, french]);
  const lyrics = "[00:29.78] The lights go out\n[00:33.70] Tides";
  const written = writeTags(original, { lyrics });
  const frames = readTagFrames(written).frames;
  assert.deepEqual(frames.map(entry => entry.id), ["TIT2", "USLT", "APIC", "USLT"]);
  assert.deepEqual(languageFrameContent(frames[1].raw), { language: "eng", description: "", text: lyrics });
  assert.deepEqual([...frames[3].raw], french);
  assert.equal(readLyricsText(written), lyrics);
  assert.equal(lyricsOf(await readWithJsmediatags(written)), lyrics);
});

test("lyrics are added when missing, in UTF-16 or UTF-8 when needed, and removed when emptied", async () => {
  const lyrics = "Işıklar söner\n時計";
  for (const version of [3, 4]) {
    const written = writeTags(mp3([text("TIT2", "Saat", version)], { version }), { lyrics });
    const content = languageFrameContent(readTagFrames(written).frames.find(entry => entry.id === "USLT").raw);
    assert.deepEqual(content, { language: "XXX", description: "", text: lyrics });
    assert.equal(lyricsOf(await readWithJsmediatags(written)), lyrics);
  }
  const removed = writeTags(mp3([text("TIT2", "Clocks"), LYRICS]), { lyrics: "" });
  assert.deepEqual(readTagFrames(removed).frames.map(entry => entry.id), ["TIT2"]);
  assert.equal(readLyricsText(removed), "");
});

test("a UTF-16 lyrics frame with a description reads back whole", () => {
  const utf16 = value => [0xff, 0xfe, ...ascii(value).flatMap(code => [code, 0])];
  const original = mp3([frame("USLT", [1, ...ascii("tur"), ...utf16("d"), 0, 0, ...utf16("x")])]);
  const written = writeTags(original, { lyrics: "Söz" });
  assert.deepEqual(languageFrameContent(readTagFrames(written).frames[0].raw), { language: "tur", description: "d", text: "Söz" });
});

test("extra text fields are read and written like the others", async () => {
  const original = mp3([text("TIT2", "Clocks"), text("TPE2", "Coldplay"), text("TPOS", "1/1"), COVER]);
  assert.deepEqual(readFields(original), { title: "Clocks", albumArtist: "Coldplay", discNumber: "1/1" });
  const written = writeTags(original, { albumArtist: "Various Artists", composer: "Guy Berryman", lyricist: "Chris Martin", copyright: "2002 EMI", discNumber: "" });
  assert.deepEqual(readFields(written), { title: "Clocks", albumArtist: "Various Artists", composer: "Guy Berryman", lyricist: "Chris Martin", copyright: "2002 EMI" });
  assert.deepEqual([...frameOf(written, "APIC").raw], COVER);
  const tags = await readWithJsmediatags(written);
  assert.equal(tags.TPE2.data, "Various Artists");
  assert.equal(tags.TCOM.data, "Guy Berryman");
  assert.equal(tags.TEXT.data, "Chris Martin");
});

test("the comment is the undescribed one; players' described comments stay as they are", () => {
  const itunes = frame("COMM", [0, ...ascii("eng"), ...ascii("iTunNORM"), 0, ...ascii(" 00000A1B 00000C2D")]);
  const plain = frame("COMM", [0, ...ascii("eng"), 0, ...ascii("Ripped from CD")]);
  const original = mp3([itunes, text("TIT2", "Clocks"), plain]);
  assert.equal(readFields(original).comment, "Ripped from CD");
  const written = writeTags(original, { comment: "Best version" });
  const frames = readTagFrames(written).frames;
  assert.deepEqual([...frames[0].raw], itunes);
  assert.deepEqual(languageFrameContent(frames[2].raw), { language: "eng", description: "", text: "Best version" });
  // Only a described comment: a new plain one is added, the described one stays.
  const added = writeTags(mp3([itunes]), { comment: "Note" });
  assert.deepEqual(readTagFrames(added).frames.map(entry => entry.id), ["COMM", "COMM"]);
  assert.deepEqual([...readTagFrames(added).frames[0].raw], itunes);
  assert.equal(readFields(added).comment, "Note");
  assert.equal(readFields(writeTags(original, { comment: "" })).comment, undefined);
});

test("the cover is the front-cover picture, else the first one", () => {
  const picture = (type, bytes) => frame("APIC", [0, ...ascii("image/jpeg"), 0, type, 0, ...bytes]);
  const both = mp3([picture(4, [1, 1]), text("TIT2", "Clocks"), picture(3, [3, 3, 3])]);
  assert.deepEqual(readCover(both), { mime: "image/jpeg", data: Uint8Array.of(3, 3, 3) });
  assert.deepEqual([...readCover(mp3([picture(0, [7])])).data], [7]);
  assert.equal(readCover(mp3([text("TIT2", "Clocks")])), null);
  assert.equal(readCover(Uint8Array.from(AUDIO)), null);
  // Bare formats ("PNG") read as image types.
  assert.equal(readCover(mp3([frame("APIC", [0, ...ascii("PNG"), 0, 3, 0, 9])])).mime, "image/png");
});
