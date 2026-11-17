const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const LRC_TAG = /^\[(?:ar|ti|al|au|by|re|ve|length|offset|la|id|#):[^\]]*\]$/i;

// Splits lyrics into lines. Text in LRC format ("[01:23.45] line") becomes synced: each line gets a start time in seconds.
export function parseLyrics(text) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return { synced: false, lines: [] };
  const rows = raw.split("\n");
  const offsetTag = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]$/im);
  const offset = offsetTag ? Number(offsetTag[1]) / 1000 : 0;
  const timed = [];
  let stamped = 0;
  for (const row of rows) {
    const stamps = [...row.matchAll(STAMP)];
    if (!stamps.length) continue;
    stamped++;
    const textPart = row.replace(STAMP, "").trim();
    for (const [, minutes, seconds] of stamps) {
      timed.push({ time: Math.max(0, Number(minutes) * 60 + Number(seconds.replace(":", ".")) + offset), text: textPart });
    }
  }
  const content = rows.filter(row => row.trim() && !LRC_TAG.test(row.trim()));
  if (stamped && stamped >= content.length / 2) {
    return { synced: true, lines: timed.sort((a, b) => a.time - b.time) };
  }
  return { synced: false, lines: rows.map(row => ({ time: null, text: row.trim() })) };
}

// Text files may be UTF-8, UTF-16 (with BOM) or a legacy Windows code page; this picks the right decoding.
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Index of the synced line playing at `time`, or -1 before the first line.
export function activeLyricIndex(lines, time) {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].time <= time; i++) index = i;
  return index;
}
