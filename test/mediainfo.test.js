import test from "node:test";
import assert from "node:assert/strict";
import { describeMedia, formatBytes, formatDuration, mediaInfoText, parseFrameHeader } from "../src/mediainfo.js";

const ascii = text => Array.from(text, char => char.charCodeAt(0));
const safe32 = value => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
const be32 = value => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

// An MPEG-1 Layer III frame at 44.1 kHz: index 9 is 128 kb/s (417 bytes), 14 is 320 kb/s (1044 bytes). Joint stereo.
function frame(bitrateIndex, body = []) {
  const header = parseFrameHeader(Uint8Array.of(0xff, 0xfb, bitrateIndex << 4, 0x44), 0);
  const bytes = new Uint8Array(header.length);
  bytes.set([0xff, 0xfb, bitrateIndex << 4, 0x44]);
  bytes.set(body, 4);
  return [...bytes];
}
const file = (bytes, name = "song.mp3") => ({ name, size: bytes.length, type: "audio/mpeg", lastModified: 0, path: `Music/${name}` });
const rowsOf = (sections, title) => Object.fromEntries(sections.find(section => section.title === title)?.rows ?? []);

test("frame headers decode version, layer, bit rate, sample rate and length", () => {
  const header = parseFrameHeader(Uint8Array.of(0xff, 0xfb, 0x92, 0x44), 0);
  assert.equal(header.version, "1");
  assert.equal(header.layer, 3);
  assert.equal(header.bitrate, 128000);
  assert.equal(header.sampleRate, 44100);
  assert.equal(header.length, 418);
  assert.equal(header.channelMode, 1);
  assert.equal(parseFrameHeader(Uint8Array.of(0xff, 0xfb, 0xf0, 0x44), 0), null);
  assert.equal(parseFrameHeader(Uint8Array.of(0x49, 0x44, 0x33, 0x03), 0), null);
});

test("a constant bit rate stream: frames, duration and bit rate", () => {
  const bytes = Uint8Array.from(Array.from({ length: 50 }, () => frame(9)).flat());
  const audio = rowsOf(describeMedia(file(bytes), bytes), "Audio");
  assert.equal(audio.Format, "MPEG-1 Audio Layer III");
  assert.equal(audio["Bit rate mode"], "Constant");
  assert.equal(audio.Frames, "50 × 1,152 samples");
  assert.equal(audio.Duration, formatDuration((50 * 1152) / 44100));
  assert.equal(audio["Channel mode"], "Joint stereo (plain)");
});

test("a variable stream with a Xing header, junk in the middle and both trailing tags", () => {
  // The Xing header sits after the side info (32 bytes for MPEG-1 stereo), with LAME's block after its fields.
  // LAME's block: its version, then the method (low 4 bits), low-pass (× 100 Hz), …, and at 21-23 the encoder delay
  // and padding as two 12-bit numbers (576 and 528).
  const lame = [...ascii("LAME3.100"), 0x24, 190, ...new Array(10).fill(0), 0x24, 0x02, 0x10];
  const xing = [...ascii("Xing"), ...be32(1 | 2 | 8), ...be32(4), ...be32(5000), ...be32(57), ...lame];
  const header = frame(9, [...new Array(32).fill(0), ...xing]);
  const ape = [...ascii("APETAGEX"), 0xd0, 0x07, 0, 0, 32, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const v1 = [...ascii("TAG"), ...ascii("Clocks".padEnd(30, "\0")), ...ascii("Coldplay".padEnd(30, "\0")), ...ascii("".padEnd(30, "\0")), ...ascii("2002"), ...ascii("".padEnd(28, "\0")), 0, 5, 20];
  const bytes = Uint8Array.from([...header, ...frame(9), ...frame(14), 1, 2, 3, ...frame(14), ...frame(9), ...ape, ...v1]);
  const sections = describeMedia(file(bytes), bytes);
  const audio = rowsOf(sections, "Audio");
  assert.equal(audio["Bit rate mode"], "Variable");
  assert.equal(audio["Bit rate range"], "128 kb/s – 320 kb/s");
  assert.equal(audio.Frames, "4 × 1,152 samples");
  assert.equal(audio.Header, "Xing");
  assert.equal(audio.Encoder, "LAME3.100");
  assert.equal(audio["Encoder mode"], "VBR");
  assert.equal(audio["Low-pass filter"], "19 kHz");
  assert.equal(audio["Encoder delay / padding"], "576 samples / 528 samples");
  assert.equal(audio["Unreadable bytes"], "3 bytes");
  assert.deepEqual(rowsOf(sections, "APE tag"), { Version: "APEv2", Size: "32 bytes", Items: "1" });
  const v1Rows = rowsOf(sections, "ID3v1 tag");
  assert.equal(v1Rows.Title, "Clocks");
  assert.equal(v1Rows.Track, "5");
  assert.equal(v1Rows.Genre, "Alternative");
});

test("ID3v2 frames are listed with names and readable values; pictures come along", () => {
  const textFrame = (id, value) => [...ascii(id), ...be32(value.length + 1), 0, 0, 0, ...ascii(value)];
  const raw = (id, body) => [...ascii(id), ...be32(body.length), 0, 0, ...body];
  const png = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3];
  const frames = [
    ...textFrame("TIT2", "Clocks"),
    ...textFrame("TCON", "(17)"),
    ...raw("TXXX", [0, ...ascii("MOOD"), 0, ...ascii("Calm")]),
    ...raw("COMM", [0, ...ascii("eng"), 0, ...ascii("Nice")]),
    ...raw("USLT", [0, ...ascii("eng"), 0, ...ascii("One\nTwo")]),
    ...raw("APIC", [0, ...ascii("image/png"), 0, 3, 0, ...png]),
    ...raw("POPM", [...ascii("me@x"), 0, 196, 0, 0, 0, 7]),
    ...raw("ZZZZ", [1, 2, 3])
  ];
  const body = [...frames, ...new Array(20).fill(0)];
  const bytes = Uint8Array.from([...ascii("ID3"), 3, 0, 0, ...safe32(body.length), ...body, ...frame(9), ...frame(9)]);
  const sections = describeMedia(file(bytes), bytes);
  const tag = rowsOf(sections, "ID3v2 tag");
  assert.equal(tag.Version, "ID3v2.3.0");
  assert.equal(tag.Padding, "20 bytes");
  assert.equal(tag["Title (TIT2)"], "Clocks");
  assert.equal(tag["Genre (TCON)"], "Rock");
  assert.equal(tag["User text (TXXX)"], "MOOD: Calm");
  assert.equal(tag["Comment (COMM)"], "Nice [eng]");
  assert.equal(tag["Lyrics (USLT)"], "2 lines, 7 characters [eng]");
  assert.equal(tag["Picture (APIC)"], "Front cover, image/png, 7 bytes");
  assert.equal(tag["Rating (POPM)"], "196/255 by me@x, played 7 times");
  assert.equal(tag.ZZZZ, "3 bytes");
  const [picture] = sections.find(section => section.title === "ID3v2 tag").pictures;
  assert.deepEqual([...picture.data], png);
  assert.equal(rowsOf(sections, "Audio").Frames, "2 × 1,152 samples");
});

test("other formats get their file details only; text output lines up", () => {
  const sections = describeMedia({ name: "song.flac", size: 2048, type: "audio/flac", path: "" }, null);
  assert.deepEqual(sections.map(section => section.title), ["File", "Audio"]);
  assert.equal(rowsOf(sections, "File").Size, "2.00 KiB (2,048 bytes)");
  assert.equal(mediaInfoText(sections).split("\n")[1], "Name  song.flac");
  assert.equal(formatBytes(1), "1 byte");
});
