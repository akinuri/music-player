// Writes text fields, lyrics and a comment into an MP3's ID3v2 tag. Only the fields given change: every other frame
// (cover art, lyrics in other languages, players' own comments, …) is copied byte for byte, and the audio after the
// tag is untouched.
// Tags are kept in their version (2.3 or 2.4); a file without one gets a 2.3 tag, the most widely read.

export class TagWriteError extends Error {}

// Field name → text frame id, per tag version. The year has its own frame in each.
const TEXT_FRAMES = { title: "TIT2", artist: "TPE1", album: "TALB", genre: "TCON", trackNumber: "TRCK", albumArtist: "TPE2", composer: "TCOM", lyricist: "TEXT", discNumber: "TPOS", copyright: "TCOP" };
const FRAMES = {
  3: { ...TEXT_FRAMES, year: "TYER" },
  4: { ...TEXT_FRAMES, year: "TDRC" }
};
// Fields kept in frames with a language and a description besides the text, and which of several such frames is the
// field: the first lyrics frame; the first comment without a description (players keep their own data in described
// comments, such as iTunes' "iTunNORM", which must stay as they are).
const LANGUAGE_FIELDS = {
  lyrics: { id: "USLT", isField: () => true },
  comment: { id: "COMM", isField: content => content.description === "" }
};
// Year frames of either version, replaced together so a file doesn't end up with two years.
const YEAR_FRAMES = ["TYER", "TDRC"];

// The numbered genres of ID3v1 (0-79) and their common extensions (80-191), which ID3v2 genres may refer to.
const GENRES = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age",
  "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal",
  "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical",
  "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "Alternative Rock", "Bass", "Soul", "Punk",
  "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial",
  "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap",
  "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi",
  "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk-Rock",
  "National Folk", "Swing", "Fast Fusion", "Bebop", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock",
  "Progressive Rock", "Psychedelic Rock", "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening",
  "Acoustic", "Humour", "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus",
  "Porn Groove", "Satire", "Slow Jam", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul",
  "Freestyle", "Duet", "Punk Rock", "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Goa", "Drum & Bass",
  "Club-House", "Hardcore", "Terror", "Indie", "BritPop", "Afro-Punk", "Polsk Punk", "Beat", "Christian Gangsta Rap",
  "Heavy Metal", "Black Metal", "Crossover", "Contemporary Christian", "Christian Rock", "Merengue", "Salsa",
  "Thrash Metal", "Anime", "J-Pop", "Synthpop", "Abstract", "Art Rock", "Baroque", "Bhangra", "Big Beat", "Breakbeat",
  "Chillout", "Downtempo", "Dub", "EBM", "Eclectic", "Electro", "Electroclash", "Emo", "Experimental", "Garage", "Global",
  "IDM", "Illbient", "Industro-Goth", "Jam Band", "Krautrock", "Leftfield", "Lounge", "Math Rock", "New Romantic",
  "Nu-Breakz", "Post-Punk", "Post-Rock", "Psytrance", "Shoegaze", "Space Rock", "Trop Rock", "World Music", "Neoclassical",
  "Audiobook", "Audio Theatre", "Neue Deutsche Welle", "Podcast", "Indie Rock", "G-Funk", "Dubstep", "Garage Rock",
  "Psybient"];

// A genre frame's text as a name: "(17)" and "17" are Rock, "(17)Rock music" keeps its own words, "((" is a literal
// "(", RX and CR are Remix and Cover; several values (2.4 separates them with nulls) are joined with commas.
export function genreText(text) {
  const name = ref => /^\d+$/.test(ref) ? GENRES[Number(ref)] ?? ref : ref === "RX" ? "Remix" : ref === "CR" ? "Cover" : ref;
  return text.split("\0").map(part => {
    const refs = [];
    let rest = part.trim();
    for (let match; (match = rest.match(/^\((\d+|RX|CR)\)/));) {
      refs.push(match[1]);
      rest = rest.slice(match[0].length);
    }
    rest = rest.replace(/^\(\(/, "(").trim();
    if (rest && !refs.length && /^\d+$/.test(rest)) return name(rest);
    return rest || refs.map(name).join(", ");
  }).filter(Boolean).join(", ");
}

// ID3v1: the old fixed 128-byte tag at the very end of a file (30 Latin-1 characters per text, a numbered genre; the
// track number in "v1.1"). Read from the whole file or just its last 128 bytes; null without one.
export function readId3v1(bytes) {
  if (bytes.length < 128) return null;
  const at = bytes.length - 128;
  if (bytes[at] !== 0x54 || bytes[at + 1] !== 0x41 || bytes[at + 2] !== 0x47) return null;
  const text = (from, length) => Array.from(bytes.subarray(at + from, at + from + length), byte => String.fromCharCode(byte)).join("").replace(/[\0 ]+$/, "");
  const v11 = bytes[at + 125] === 0 && bytes[at + 126] !== 0;
  return {
    version: v11 ? "1.1" : "1.0",
    title: text(3, 30), artist: text(33, 30), album: text(63, 30), year: text(93, 4),
    comment: text(97, v11 ? 28 : 30), track: v11 ? bytes[at + 126] : null,
    genre: bytes[at + 127] === 255 ? "" : genreText(`(${bytes[at + 127]})`)
  };
}

// The length of the ID3v2 tag at the start of a file, from its first 10 bytes (0 without one), so the tag can be read
// without the audio.
export function tagLength(header) {
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return 0;
  return 10 + synchsafe(header, 6) + (header[3] === 4 && header[5] & 0x10 ? 10 : 0);
}

// The genre as a name, from the bytes of a tag (or a whole file); "" without one.
export function readGenre(bytes) {
  const frame = readTagFrames(bytes)?.frames.find(entry => entry.id === "TCON");
  return frame ? genreText(frameText(frame.raw)) : "";
}

const synchsafe = (bytes, at) => (bytes[at] << 21) | (bytes[at + 1] << 14) | (bytes[at + 2] << 7) | bytes[at + 3];
const plain = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const toSynchsafe = value => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
const toPlain = value => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

// The existing tag: version, its frames (raw bytes, by id) and where the audio starts. Null without a tag.
export function readTagFrames(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const version = bytes[3];
  const flags = bytes[5];
  const size = synchsafe(bytes, 6);
  const footer = version === 4 && flags & 0x10 ? 10 : 0;
  const audioStart = 10 + size + footer;
  if (version !== 3 && version !== 4) throw new TagWriteError(`This file's tag (ID3v2.${version}) is too old to edit here.`);
  // Unsynchronised tags rewrite their bytes throughout; rare, and not worth the risk.
  if (flags & 0x80) throw new TagWriteError("This file's tag uses an encoding (unsynchronisation) that can't be edited here.");
  if (audioStart > bytes.length) throw new TagWriteError("This file's tag is damaged.");
  let at = 10;
  if (flags & 0x40) at += version === 4 ? synchsafe(bytes, at) : plain(bytes, at) + 4;
  const end = 10 + size;
  const frames = [];
  while (at + 10 <= end && bytes[at] !== 0) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const frameSize = version === 4 ? synchsafe(bytes, at + 4) : plain(bytes, at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || at + 10 + frameSize > end) throw new TagWriteError("This file's tag is damaged.");
    frames.push({ id, raw: bytes.subarray(at, at + 10 + frameSize) });
    at += 10 + frameSize;
  }
  return { version, frames, audioStart };
}

// Text in one of ID3's four encodings: 0 Latin-1, 1 UTF-16 with a byte-order mark, 2 UTF-16 big-endian, 3 UTF-8.
export function decodeText(data, encoding) {
  if (encoding === 0) return Array.from(data, byte => String.fromCharCode(byte)).join("");
  if (encoding === 3) return new TextDecoder("utf-8").decode(data);
  if (encoding === 2) return new TextDecoder("utf-16be").decode(data);
  // The byte-order mark says which end comes first (little-endian without one).
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
  return new TextDecoder("utf-16le").decode(data[0] === 0xff && data[1] === 0xfe ? data.subarray(2) : data);
}

// The encoding to write texts in: UTF-8 in 2.4 tags; in 2.3, Latin-1 when it can hold them, else UTF-16.
const encodingFor = (version, texts) => version === 4 ? 3 : texts.every(text => /^[\x00-\xff]*$/.test(text)) ? 0 : 1;

function encodeText(text, encoding) {
  if (encoding === 3) return new TextEncoder().encode(text);
  if (encoding === 0) return Uint8Array.from(text, char => char.charCodeAt(0));
  if (!text) return new Uint8Array(0);
  // UTF-16 with a byte-order mark, little-endian.
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = code >> 8;
  }
  return bytes;
}

// What ends a string inside a frame: one zero byte, or two in UTF-16.
export const terminator = encoding => encoding === 1 || encoding === 2 ? [0, 0] : [0];

function frame(id, body, version) {
  const bytes = new Uint8Array(10 + body.length);
  bytes.set(Array.from(id, char => char.charCodeAt(0)), 0);
  bytes.set(version === 4 ? toSynchsafe(body.length) : toPlain(body.length), 4);
  bytes.set(body, 10);
  return bytes;
}

// The text of a text frame, without terminators.
export function frameText(raw) {
  return decodeText(raw.subarray(11), raw[10]).replace(/\0+$/, "");
}

function textFrame(id, text, version) {
  const encoding = encodingFor(version, [text]);
  return frame(id, [encoding, ...encodeText(text, encoding)], version);
}

// A lyrics (USLT) or comment (COMM) frame: a three-letter language, a short description and the text.
export function languageFrameContent(raw) {
  const encoding = raw[10];
  const language = String.fromCharCode(raw[11], raw[12], raw[13]);
  const rest = raw.subarray(14);
  // The description ends at the first terminator (in UTF-16, a zero pair on a character boundary).
  const width = terminator(encoding).length;
  let end = 0;
  while (end + width <= rest.length && !(rest[end] === 0 && (width === 1 || rest[end + 1] === 0))) end += width;
  return {
    language,
    description: decodeText(rest.subarray(0, end), encoding),
    text: decodeText(rest.subarray(Math.min(rest.length, end + width)), encoding).replace(/\0+$/, "")
  };
}

function languageFrame(id, { language, description, text }, version) {
  const encoding = encodingFor(version, [description, text]);
  const lang = (language || "XXX").padEnd(3, " ").slice(0, 3);
  return frame(id, [encoding, ...Array.from(lang, char => char.charCodeAt(0) & 0xff), ...encodeText(description, encoding), ...terminator(encoding), ...encodeText(text, encoding)], version);
}

// A picture frame's (APIC) content, from its data (after the frame header): format, picture type (3 is the front
// cover), description and the image itself.
export function parsePicture(data) {
  const encoding = data[0];
  const mimeEnd = data.indexOf(0, 1);
  const mime = String.fromCharCode(...data.subarray(1, mimeEnd < 0 ? 1 : mimeEnd)) || "image/";
  const type = data[mimeEnd + 1];
  const width = terminator(encoding).length;
  let end = mimeEnd + 2;
  while (end + width <= data.length && !(data[end] === 0 && (width === 1 || data[end + 1] === 0))) end += width;
  return {
    mime: mime.includes("/") ? mime : `image/${mime.toLowerCase()}`,
    type,
    description: decodeText(data.subarray(mimeEnd + 2, end), encoding),
    image: data.subarray(Math.min(data.length, end + width))
  };
}

// The cover in a tag (or a whole file): the front cover, else the first picture; null without one.
export function readCover(bytes) {
  const frames = readTagFrames(bytes)?.frames ?? [];
  const index = coverFrameIndex(frames);
  const picture = index >= 0 ? parsePicture(frames[index].raw.subarray(10)) : null;
  return picture?.image.length ? { mime: picture.mime, data: picture.image, type: picture.type } : null;
}

// Which picture frame is the cover: the front cover, else the first picture; -1 without any.
function coverFrameIndex(frames) {
  const pictures = frames.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.id === "APIC");
  return (pictures.find(({ entry }) => parsePicture(entry.raw.subarray(10)).type === 3) ?? pictures[0])?.index ?? -1;
}

// A picture frame. The image goes in as bytes, not spread into an array (covers run to megabytes).
function pictureFrame({ mime, type, description, data }, version) {
  const encoding = encodingFor(version, [description]);
  const head = [encoding, ...Array.from(mime, char => char.charCodeAt(0) & 0xff), 0, type, ...encodeText(description, encoding), ...terminator(encoding)];
  const body = new Uint8Array(head.length + data.length);
  body.set(head, 0);
  body.set(data, head.length);
  return frame("APIC", body, version);
}

// Where a language field (lyrics, comment) is among the frames, or -1.
function languageFrameIndex(frames, field) {
  const { id, isField } = LANGUAGE_FIELDS[field];
  return frames.findIndex(entry => entry.id === id && isField(languageFrameContent(entry.raw)));
}

// The lyrics players show (the first lyrics frame), from the bytes of a tag or a whole file; "" without any.
export function readLyricsText(bytes) {
  return readFields(bytes).lyrics ?? "";
}

// Every field writeTags knows that the tag has, as text (genres as names), from the bytes of a tag or a whole file.
export function readFields(bytes) {
  const tag = readTagFrames(bytes);
  if (!tag) return {};
  const fields = {};
  for (const [field, id] of Object.entries(FRAMES[tag.version])) {
    const raw = tag.frames.find(entry => entry.id === id)?.raw;
    if (raw) fields[field] = field === "genre" ? genreText(frameText(raw)) : frameText(raw);
  }
  for (const field of Object.keys(LANGUAGE_FIELDS)) {
    const index = languageFrameIndex(tag.frames, field);
    if (index >= 0) fields[field] = languageFrameContent(tag.frames[index].raw).text;
  }
  return fields;
}

// changes: any of the fields in FRAMES and LANGUAGE_FIELDS, and cover; "" or null removes the field.
// dropId3v1: leave out the ID3v1 tag at the end, if there is one (it would keep the old values). Returns the new file.
export function writeTags(bytes, changes, { dropId3v1 = false } = {}) {
  const existing = readTagFrames(bytes);
  const version = existing?.version ?? 3;
  let frames = existing?.frames ?? [];
  // The cover replaces its picture frame where it stands, keeping its type and description (a new one is the front
  // cover); other pictures (back cover, artist, …) stay. changes.cover: { mime, data }, or null to remove it.
  if ("cover" in changes) {
    const index = coverFrameIndex(frames);
    const old = index >= 0 ? parsePicture(frames[index].raw.subarray(10)) : null;
    const cover = changes.cover;
    const replacement = cover ? { id: "APIC", raw: pictureFrame({ mime: cover.mime, data: cover.data, type: old?.type ?? 3, description: old?.description ?? "" }, version) } : null;
    if (index >= 0) frames = [...frames.slice(0, index), ...(replacement ? [replacement] : []), ...frames.slice(index + 1)];
    else if (replacement) frames = [...frames, replacement];
  }
  // Lyrics and comments replace their frame where it stands (keeping its language and description); other such
  // frames (in other languages, or described) stay.
  for (const field of Object.keys(LANGUAGE_FIELDS)) {
    if (!(field in changes)) continue;
    const text = changes[field] ?? "";
    const index = languageFrameIndex(frames, field);
    const old = index >= 0 ? languageFrameContent(frames[index].raw) : null;
    const id = LANGUAGE_FIELDS[field].id;
    const replacement = text ? { id, raw: languageFrame(id, { language: old?.language, description: old?.description ?? "", text }, version) } : null;
    if (index >= 0) frames = [...frames.slice(0, index), ...(replacement ? [replacement] : []), ...frames.slice(index + 1)];
    else if (replacement) frames = [...frames, replacement];
  }
  const ids = FRAMES[version];
  const replaced = new Set();
  const added = [];
  for (const [field, value] of Object.entries(changes)) {
    if (field in LANGUAGE_FIELDS || field === "cover") continue;
    const id = ids[field];
    if (!id) throw new Error(`Unknown tag field: ${field}`);
    if (field === "year") YEAR_FRAMES.forEach(yearId => replaced.add(yearId));
    else replaced.add(id);
    let text = value === null || value === undefined ? "" : String(value).trim();
    // A track number keeps the album's track count ("5/12") it had.
    if (field === "trackNumber" && text) {
      const old = frames.find(frame => frame.id === "TRCK");
      const total = old && frameText(old.raw).match(/\/\s*(\d+)\s*$/)?.[1];
      if (total) text = `${text}/${total}`;
    }
    if (text) added.push(textFrame(id, text, version));
  }
  const kept = frames.filter(frame => !replaced.has(frame.id)).map(frame => frame.raw);
  // New fields go first, where readers look; a little padding lets later edits by other tools stay in place.
  const parts = [...added, ...kept];
  const padding = 1024;
  const size = parts.reduce((sum, part) => sum + part.length, 0) + padding;
  const audio = bytes.subarray(existing?.audioStart ?? 0, dropId3v1 && readId3v1(bytes) ? bytes.length - 128 : bytes.length);
  const output = new Uint8Array(10 + size + audio.length);
  output.set([0x49, 0x44, 0x33, version, 0, 0], 0);
  output.set(toSynchsafe(size), 6);
  let at = 10;
  for (const part of parts) {
    output.set(part, at);
    at += part.length;
  }
  output.set(audio, 10 + size);
  return output;
}
