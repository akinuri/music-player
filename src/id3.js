// Writes a few text fields into an MP3's ID3v2 tag. Only the fields given change: every other frame (cover art,
// embedded lyrics, comments, …) is copied byte for byte, and the audio after the tag is untouched.
// Tags are kept in their version (2.3 or 2.4); a file without one gets a 2.3 tag, the most widely read.

export class TagWriteError extends Error {}

// Field name → frame id, per tag version. The year has its own frame in each.
const FRAMES = {
  3: { title: "TIT2", artist: "TPE1", album: "TALB", genre: "TCON", trackNumber: "TRCK", year: "TYER" },
  4: { title: "TIT2", artist: "TPE1", album: "TALB", genre: "TCON", trackNumber: "TRCK", year: "TDRC" }
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

// The text of a text frame (any of the four encodings), without terminators.
export function frameText(raw) {
  const data = raw.subarray(11);
  const encoding = raw[10];
  let text;
  if (encoding === 0) text = Array.from(data, byte => String.fromCharCode(byte)).join("");
  else if (encoding === 3) text = new TextDecoder("utf-8").decode(data);
  else if (encoding === 2) text = new TextDecoder("utf-16be").decode(data);
  // UTF-16 with a byte-order mark, which says which end comes first (little-endian without one).
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder("utf-16be").decode(data.subarray(2));
  else text = new TextDecoder("utf-16le").decode(data[0] === 0xff && data[1] === 0xfe ? data.subarray(2) : data);
  return text.replace(/\0+$/, "");
}

function textFrame(id, text, version) {
  let encoding;
  let body;
  if (version === 4) {
    encoding = 3;
    body = new TextEncoder().encode(text);
  } else if (/^[\x00-\xff]*$/.test(text)) {
    encoding = 0;
    body = Uint8Array.from(text, char => char.charCodeAt(0));
  } else {
    // UTF-16 with a byte-order mark, little-endian.
    encoding = 1;
    body = new Uint8Array(2 + text.length * 2);
    body[0] = 0xff;
    body[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      body[2 + i * 2] = code & 0xff;
      body[3 + i * 2] = code >> 8;
    }
  }
  const size = body.length + 1;
  const frame = new Uint8Array(10 + size);
  frame.set(Array.from(id, char => char.charCodeAt(0)), 0);
  frame.set(version === 4 ? toSynchsafe(size) : toPlain(size), 4);
  frame[10] = encoding;
  frame.set(body, 11);
  return frame;
}

// changes: any of { title, artist, album, genre, trackNumber, year }; "" or null removes the field. Returns the new file.
export function writeTags(bytes, changes) {
  const existing = readTagFrames(bytes);
  const version = existing?.version ?? 3;
  const frames = existing?.frames ?? [];
  const ids = FRAMES[version];
  const replaced = new Set();
  const added = [];
  for (const [field, value] of Object.entries(changes)) {
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
  const audio = bytes.subarray(existing?.audioStart ?? 0);
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
