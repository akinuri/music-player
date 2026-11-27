// Media info: everything that can be read about an audio file, like MediaInfo's view of it. MP3s are read in depth
// (every MPEG frame, the Xing/Info/VBRI and LAME headers, ID3v2 with each frame, ID3v1 and APE tags); other formats
// get their file details only. Pure: the caller reads the file and shows the sections.

import { decodeText, genreText, languageFrameContent, readTagFrames, terminator } from "./id3.js";

// Kilobits per second by version (1, or 2 for MPEG-2 and 2.5), layer and the header's index.
const BITRATES = {
  1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
};
const SAMPLE_RATES = { "1": [44100, 48000, 32000], "2": [22050, 24000, 16000], "2.5": [11025, 12000, 8000] };
const CHANNEL_MODES = ["Stereo", "Joint stereo", "Dual channel", "Mono"];
const EMPHASIS = ["None", "50/15 µs", "Reserved", "CCITT J.17"];

// Names of ID3v2 frames, for those worth naming; others show their id.
const FRAME_NAMES = {
  TIT1: "Grouping", TIT2: "Title", TIT3: "Subtitle", TPE1: "Artist", TPE2: "Album artist", TPE3: "Conductor",
  TPE4: "Remixed by", TALB: "Album", TCOM: "Composer", TEXT: "Lyricist", TCON: "Genre", TRCK: "Track", TPOS: "Disc",
  TYER: "Year", TDAT: "Date", TIME: "Time", TDRC: "Recorded", TDRL: "Released", TDOR: "Original release",
  TORY: "Original year", TDTG: "Tagged", TBPM: "BPM", TKEY: "Key", TLAN: "Language", TLEN: "Length (ms)",
  TMED: "Media", TMOO: "Mood", TPUB: "Publisher", TCOP: "Copyright", TENC: "Encoded by", TSSE: "Encoder settings",
  TSRC: "ISRC", TOPE: "Original artist", TOAL: "Original album", TOLY: "Original lyricist", TOFN: "Original file name",
  TSOP: "Artist sort", TSOA: "Album sort", TSOT: "Title sort", TSO2: "Album artist sort", TSOC: "Composer sort",
  TCMP: "Compilation", TFLT: "File type", TOWN: "Owner", TRSN: "Radio station", TPRO: "Produced", TIPL: "Involved people",
  TMCL: "Musicians", IPLS: "Involved people", TXXX: "User text", COMM: "Comment", USLT: "Lyrics", SYLT: "Synced lyrics",
  APIC: "Picture", PRIV: "Private data", UFID: "Unique file id", POPM: "Rating", PCNT: "Play count", GEOB: "Object",
  MCDI: "CD identifier", RVA2: "Volume adjustment", RVAD: "Volume adjustment", EQU2: "Equalisation", GRP1: "Grouping",
  MVNM: "Movement", MVIN: "Movement number", WXXX: "User URL", WOAR: "Artist page", WOAF: "File page",
  WOAS: "Source page", WCOM: "Buy page", WCOP: "Copyright page", WORS: "Radio page", WPAY: "Payment page",
  WPUB: "Publisher page", USER: "Terms of use", OWNE: "Ownership", ETCO: "Event timing", SEEK: "Seek", SIGN: "Signature"
};
const PICTURE_TYPES = ["Other", "File icon", "Other file icon", "Front cover", "Back cover", "Leaflet", "Media", "Lead artist",
  "Artist", "Conductor", "Band", "Composer", "Lyricist", "Recording location", "During recording", "During performance",
  "Video capture", "Bright coloured fish", "Illustration", "Band logo", "Publisher logo"];

const latin1 = data => Array.from(data, byte => String.fromCharCode(byte)).join("");
const trimNulls = text => text.replace(/\0+$/, "");
const plural = (count, word) => `${count.toLocaleString("en")} ${word}${count === 1 ? "" : "s"}`;

export function formatBytes(bytes) {
  const units = ["bytes", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const short = unit ? `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}` : plural(bytes, "byte");
  return unit ? `${short} (${plural(bytes, "byte")})` : short;
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const hours = Math.floor(minutes / 60);
  const clock = `${hours ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : minutes}:${rest.toFixed(3).padStart(6, "0")}`;
  return `${clock} (${Math.round(seconds * 1000).toLocaleString("en")} ms)`;
}

const kbps = bitsPerSecond => `${Number((bitsPerSecond / 1000).toFixed(1)).toLocaleString("en")} kb/s`;

// One MPEG audio frame header at `at`, or null when the bytes there aren't one.
export function parseFrameHeader(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[at + 1] >> 3) & 3;
  const layerBits = (bytes[at + 1] >> 1) & 3;
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const version = versionBits === 3 ? "1" : versionBits === 2 ? "2" : "2.5";
  const layer = 4 - layerBits;
  const bitrate = BITRATES[version === "1" ? 1 : 2][layer][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (bytes[at + 2] >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && version !== "1" ? 576 : 1152;
  const length = layer === 1 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  const channelMode = bytes[at + 3] >> 6;
  return {
    version, layer, bitrate, sampleRate, padding, samples, length, channelMode,
    modeExtension: (bytes[at + 3] >> 4) & 3,
    crc: !(bytes[at + 1] & 1),
    private: bytes[at + 2] & 1,
    copyright: !!(bytes[at + 3] & 8),
    original: !!(bytes[at + 3] & 4),
    emphasis: bytes[at + 3] & 3
  };
}

// A frame header there, confirmed by another right after it (a lone sync pattern is often just data).
function confirmedFrame(bytes, at, end) {
  const header = parseFrameHeader(bytes, at);
  if (!header) return null;
  const next = at + header.length;
  if (next + 4 > end) return header;
  const following = parseFrameHeader(bytes, next);
  return following && following.version === header.version && following.layer === header.layer && following.sampleRate === header.sampleRate ? header : null;
}

const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const le32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

// The Xing/Info header (and LAME's extension of it) or the VBRI header in the first frame, if any.
function readVbrHeader(bytes, at, header) {
  const mono = header.channelMode === 3;
  const sideInfo = header.version === "1" ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const xing = at + 4 + (header.crc ? 2 : 0) + sideInfo;
  const tag = latin1(bytes.subarray(xing, xing + 4));
  if (tag === "Xing" || tag === "Info") {
    const flags = u32(bytes, xing + 4);
    let field = xing + 8;
    const result = { kind: tag, vbr: tag === "Xing" };
    if (flags & 1) { result.frames = u32(bytes, field); field += 4; }
    if (flags & 2) { result.bytes = u32(bytes, field); field += 4; }
    if (flags & 4) field += 100;
    if (flags & 8) { result.quality = u32(bytes, field); field += 4; }
    // LAME (and compatible encoders) continue with their own block right after.
    const encoder = latin1(bytes.subarray(field, field + 9));
    if (/^[A-Za-z]{3,4}\d/.test(encoder)) {
      result.encoder = encoder.replace(/[^\x20-\x7e]/g, "").trim();
      const method = bytes[field + 9] & 15;
      // The LAME tag's method numbers: 3 is LAME's old VBR, 4 its current (default) one.
      result.method = ["Unknown", "CBR", "ABR", "VBR (old)", "VBR", "VBR (method 3)", "VBR (method 4)", "Unknown", "CBR (2 pass)", "ABR (2 pass)"][method] ?? "Unknown";
      if (bytes[field + 10]) result.lowpass = bytes[field + 10] * 100;
      const delay = (bytes[field + 21] << 4) | (bytes[field + 22] >> 4);
      const padding = ((bytes[field + 22] & 15) << 8) | bytes[field + 23];
      result.delay = delay;
      result.padding = padding;
    }
    return result;
  }
  const vbri = at + 4 + 32;
  if (latin1(bytes.subarray(vbri, vbri + 4)) === "VBRI") {
    return { kind: "VBRI", vbr: true, bytes: u32(bytes, vbri + 10), frames: u32(bytes, vbri + 14) };
  }
  return null;
}

// Where the trailing tags are: ID3v1 (the last 128 bytes) and APEv2 (just before it, or at the very end).
function readTrailingTags(bytes) {
  let end = bytes.length;
  let id3v1 = null;
  if (end >= 128 && latin1(bytes.subarray(end - 128, end - 125)) === "TAG") {
    const at = end - 128;
    const text = (from, length) => latin1(bytes.subarray(at + from, at + from + length)).replace(/[\0 ]+$/, "");
    const v11 = bytes[at + 125] === 0 && bytes[at + 126] !== 0;
    id3v1 = {
      version: v11 ? "1.1" : "1.0",
      title: text(3, 30), artist: text(33, 30), album: text(63, 30), year: text(93, 4),
      comment: text(97, v11 ? 28 : 30), track: v11 ? bytes[at + 126] : null,
      genre: bytes[at + 127] === 255 ? "" : genreText(`(${bytes[at + 127]})`)
    };
    end = at;
  }
  let ape = null;
  if (end >= 32 && latin1(bytes.subarray(end - 32, end - 24)) === "APETAGEX") {
    const footer = end - 32;
    const size = le32(bytes, footer + 12);
    const hasHeader = !!(bytes[footer + 23] & 0x80);
    ape = { version: le32(bytes, footer + 8) === 2000 ? "2" : "1", size: size + (hasHeader ? 32 : 0), items: le32(bytes, footer + 16) };
    end = Math.max(0, end - ape.size);
  }
  return { id3v1, ape, end };
}

// A frame's value as text (and, for pictures, the image), from its data.
function describeFrame(id, data) {
  const encoding = data[0];
  const split = from => {
    // A string ending at the encoding's terminator, then the rest.
    const width = terminator(encoding).length;
    let end = from;
    while (end + width <= data.length && !(data[end] === 0 && (width === 1 || data[end + 1] === 0))) end += width;
    return [decodeText(data.subarray(from, end), encoding), Math.min(data.length, end + width)];
  };
  if (id === "TXXX") {
    const [description, rest] = split(1);
    return { value: `${description}: ${trimNulls(decodeText(data.subarray(rest), encoding))}` };
  }
  if (id === "TCON") return { value: genreText(trimNulls(decodeText(data.subarray(1), encoding))) };
  if (id[0] === "T") return { value: trimNulls(decodeText(data.subarray(1), encoding)).replace(/\0/g, " / ") };
  if (id === "WXXX") {
    const [description, rest] = split(1);
    return { value: `${description ? `${description}: ` : ""}${trimNulls(latin1(data.subarray(rest)))}` };
  }
  if (id[0] === "W") return { value: trimNulls(latin1(data)) };
  if (id === "COMM" || id === "USLT") {
    const raw = new Uint8Array(10 + data.length);
    raw.set(data, 10);
    const { language, description, text } = languageFrameContent(raw);
    const lines = text.split(/\r\n?|\n/).length;
    const shown = !text ? "(empty)" : id === "USLT" ? `${plural(lines, "line")}, ${plural(text.length, "character")}` : text;
    return { value: `${shown}${description ? ` (${description})` : ""}${language.trim() && language !== "XXX" ? ` [${language}]` : ""}` };
  }
  if (id === "APIC") {
    const mimeEnd = data.indexOf(0, 1);
    const mime = latin1(data.subarray(1, mimeEnd)) || "image/";
    const type = data[mimeEnd + 1];
    let description = "";
    let rest = mimeEnd + 2;
    const width = terminator(encoding).length;
    let end = rest;
    while (end + width <= data.length && !(data[end] === 0 && (width === 1 || data[end + 1] === 0))) end += width;
    description = decodeText(data.subarray(rest, end), encoding);
    rest = Math.min(data.length, end + width);
    const image = data.subarray(rest);
    const fullMime = mime.includes("/") ? mime : `image/${mime.toLowerCase()}`;
    return {
      value: `${PICTURE_TYPES[type] ?? `Type ${type}`}, ${fullMime}, ${formatBytes(image.length)}${description ? `, "${description}"` : ""}`,
      picture: { mime: fullMime, type: PICTURE_TYPES[type] ?? `Type ${type}`, description, data: image }
    };
  }
  if (id === "POPM") {
    const end = data.indexOf(0);
    const email = latin1(data.subarray(0, end));
    const rating = data[end + 1];
    const counter = data.length > end + 2 ? data.subarray(end + 2).reduce((sum, byte) => sum * 256 + byte, 0) : null;
    return { value: `${rating}/255${email ? ` by ${email}` : ""}${counter !== null ? `, played ${plural(counter, "time")}` : ""}` };
  }
  if (id === "PCNT") return { value: plural(data.reduce((sum, byte) => sum * 256 + byte, 0), "play") };
  if (id === "PRIV" || id === "UFID") {
    const end = data.indexOf(0);
    return { value: `${latin1(data.subarray(0, end < 0 ? data.length : end))} (${formatBytes(end < 0 ? 0 : data.length - end - 1)})` };
  }
  return { value: formatBytes(data.length) };
}

// The ID3v2 tag at the start: header details and every frame. Tags this player can't edit are still described.
function readId3v2(bytes) {
  if (bytes.length < 10 || latin1(bytes.subarray(0, 3)) !== "ID3") return null;
  const version = bytes[3];
  const flags = bytes[5];
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const tag = { version: `2.${version}.${bytes[4]}`, size: size + 10 + (version === 4 && flags & 0x10 ? 10 : 0), flags: [], frames: [], padding: 0, note: "" };
  if (flags & 0x80) tag.flags.push("Unsynchronised");
  if (flags & 0x40) tag.flags.push("Extended header");
  if (flags & 0x20) tag.flags.push("Experimental");
  if (version === 4 && flags & 0x10) tag.flags.push("Footer");
  let parsed = null;
  try {
    parsed = readTagFrames(bytes.subarray(0, Math.min(bytes.length, tag.size)));
  } catch (error) {
    tag.note = error.message.replace("can't be edited here", "can't be listed here").replace("too old to edit here", "too old to list here");
    return tag;
  }
  let used = 10;
  for (const { id, raw } of parsed.frames) {
    used += raw.length;
    const frameFlags = raw[9];
    // Per-frame compression, encryption or unsynchronisation leaves the data unreadable as is.
    const packed = version === 4 ? frameFlags & 0x0e : frameFlags & 0xc0;
    let start = 10;
    if (version === 4) start += (frameFlags & 0x40 ? 1 : 0) + (frameFlags & 0x01 ? 4 : 0);
    else start += (frameFlags & 0x20 ? 1 : 0);
    const data = raw.subarray(start);
    let described;
    try {
      described = packed ? { value: `Compressed or encrypted (${formatBytes(data.length)})` } : describeFrame(id, data);
    } catch {
      described = { value: `Unreadable (${formatBytes(data.length)})` };
    }
    tag.frames.push({ id, name: FRAME_NAMES[id] ?? id, size: raw.length, ...described });
  }
  tag.padding = Math.max(0, tag.size - used - (version === 4 && flags & 0x10 ? 10 : 0));
  return tag;
}

// Walks every MPEG frame between `start` and `end`: count, bit rates, and anything in between that isn't audio.
function scanFrames(bytes, start, end) {
  let at = start;
  let first = null;
  let firstAt = -1;
  let frames = 0;
  let audioBytes = 0;
  let junk = 0;
  let lead = 0;
  const bitrates = new Map();
  while (at + 4 <= end) {
    const header = first ? parseFrameHeader(bytes, at) : confirmedFrame(bytes, at, end);
    if (!header || (first && (header.version !== first.version || header.layer !== first.layer || header.sampleRate !== first.sampleRate))) {
      at++;
      if (first) junk++;
      else lead++;
      continue;
    }
    if (!first) {
      first = header;
      firstAt = at;
    }
    frames++;
    audioBytes += Math.min(header.length, end - at);
    bitrates.set(header.bitrate, (bitrates.get(header.bitrate) ?? 0) + 1);
    at += header.length;
  }
  return { first, firstAt, frames, audioBytes, junk, lead, bitrates };
}

const yesNo = value => value ? "Yes" : "No";

// Sections of [label, value] rows (and pictures) describing the file. file: { name, size, type, lastModified, path }.
// bytes: the whole file, for MP3s; other formats pass null.
export function describeMedia(file, bytes) {
  const sections = [];
  const general = [
    ["Name", file.name],
    ...(file.path ? [["Location", file.path]] : []),
    ["Size", formatBytes(file.size)],
    ...(file.lastModified ? [["Modified", new Date(file.lastModified).toLocaleString()]] : []),
    ["Type", file.type || "Unknown"]
  ];
  sections.push({ title: "File", rows: general });
  if (!bytes) {
    sections.push({ title: "Audio", rows: [["Details", "Only MP3 files are analysed in depth."]] });
    return sections;
  }

  const id3v2 = readId3v2(bytes);
  const trailing = readTrailingTags(bytes);
  const audioStart = id3v2 ? Math.min(bytes.length, id3v2.size) : 0;
  const scan = scanFrames(bytes, audioStart, trailing.end);
  const header = scan.first;
  if (header) {
    const vbr = readVbrHeader(bytes, scan.firstAt, header);
    // A Xing/Info/VBRI header frame holds no audio.
    const frames = vbr ? Math.max(0, scan.frames - 1) : scan.frames;
    const audioBytes = vbr ? scan.audioBytes - header.length : scan.audioBytes;
    const duration = (frames * header.samples) / header.sampleRate;
    const rates = [...scan.bitrates.keys()].filter(rate => !vbr || scan.bitrates.get(rate) > (rate === header.bitrate ? 1 : 0));
    const variable = rates.length > 1 || !!vbr?.vbr;
    const mode = CHANNEL_MODES[header.channelMode];
    const extension = header.channelMode === 1 && header.layer === 3 ? ` (${[header.modeExtension & 2 ? "M/S" : "", header.modeExtension & 1 ? "Intensity" : ""].filter(Boolean).join(" + ") || "plain"})` : "";
    const rows = [
      ["Format", `MPEG-${header.version} Audio Layer ${["I", "II", "III"][header.layer - 1]}`],
      ["Duration", duration ? formatDuration(duration) : "Unknown"],
      ["Bit rate mode", variable ? "Variable" : "Constant"],
      ["Bit rate", duration ? kbps((audioBytes * 8) / duration) + (variable ? " (average)" : "") : kbps(header.bitrate)],
      ...(variable && rates.length > 1 ? [["Bit rate range", `${kbps(Math.min(...rates))} – ${kbps(Math.max(...rates))}`]] : []),
      ["Overall bit rate", duration ? kbps((file.size * 8) / duration) : "Unknown"],
      ["Sample rate", `${(header.sampleRate / 1000).toLocaleString("en")} kHz`],
      ["Channels", header.channelMode === 3 ? "1 (mono)" : "2"],
      ["Channel mode", mode + extension],
      ["Frames", `${frames.toLocaleString("en")} × ${header.samples.toLocaleString("en")} samples`],
      ["Stream size", formatBytes(audioBytes)],
      ["CRC", yesNo(header.crc)],
      ["Copyrighted", yesNo(header.copyright)],
      ["Original", yesNo(header.original)],
      ["Emphasis", EMPHASIS[header.emphasis]]
    ];
    if (vbr) {
      rows.push(["Header", `${vbr.kind}${vbr.frames !== undefined && vbr.frames !== frames ? ` (says ${plural(vbr.frames, "frame")})` : ""}`]);
      if (vbr.encoder) rows.push(["Encoder", vbr.encoder]);
      if (vbr.method) rows.push(["Encoder mode", vbr.method]);
      if (vbr.quality !== undefined && vbr.encoder) rows.push(["Encoder quality", String(vbr.quality)]);
      if (vbr.lowpass) rows.push(["Low-pass filter", `${(vbr.lowpass / 1000).toLocaleString("en")} kHz`]);
      if (vbr.delay !== undefined) rows.push(["Encoder delay / padding", `${plural(vbr.delay, "sample")} / ${plural(vbr.padding, "sample")}`]);
    }
    if (scan.lead) rows.push(["Bytes before audio", formatBytes(scan.lead)]);
    if (scan.junk) rows.push(["Unreadable bytes", formatBytes(scan.junk)]);
    sections.push({ title: "Audio", rows });
  } else {
    sections.push({ title: "Audio", rows: [["Details", "No MPEG audio frames found."]] });
  }

  if (id3v2) {
    const rows = [
      ["Version", `ID3v${id3v2.version}`],
      ["Size", formatBytes(id3v2.size)],
      ...(id3v2.frames.length || !id3v2.note ? [["Padding", formatBytes(id3v2.padding)]] : []),
      ...(id3v2.flags.length ? [["Flags", id3v2.flags.join(", ")]] : []),
      ...(id3v2.note ? [["Frames", id3v2.note]] : []),
      ...id3v2.frames.map(frame => [frame.name === frame.id ? frame.id : `${frame.name} (${frame.id})`, frame.value])
    ];
    sections.push({ title: "ID3v2 tag", rows, pictures: id3v2.frames.filter(frame => frame.picture).map(frame => frame.picture) });
  }
  if (trailing.ape) {
    sections.push({ title: "APE tag", rows: [["Version", `APEv${trailing.ape.version}`], ["Size", formatBytes(trailing.ape.size)], ["Items", trailing.ape.items.toLocaleString("en")]] });
  }
  if (trailing.id3v1) {
    const tag = trailing.id3v1;
    sections.push({
      title: "ID3v1 tag",
      rows: [["Version", `ID3v${tag.version}`], ["Title", tag.title], ["Artist", tag.artist], ["Album", tag.album], ["Year", tag.year], ...(tag.track ? [["Track", String(tag.track)]] : []), ["Comment", tag.comment], ["Genre", tag.genre]].filter(([, value]) => value !== "")
    });
  }
  return sections;
}

// The sections as plain text, for copying.
export function mediaInfoText(sections) {
  return sections.map(section => {
    const width = Math.max(...section.rows.map(([label]) => label.length));
    return [section.title, ...section.rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`)].join("\n");
  }).join("\n\n");
}
