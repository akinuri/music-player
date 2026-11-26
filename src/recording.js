// Visualizer recordings: the 3D terrain's rows saved to a JSON file and loaded back. Each row keeps how it was made
// (recorded live, or filled in from the file) and the Smooth setting at the time, so live and filled rows can be
// compared like for like.

const FORMAT = "music-player-visualizer-recording";
const VERSION = 1;
// Levels are 0-1; four decimals is finer than the analyser's 1/255 steps.
const round = value => Math.round(value * 10000) / 10000;

export class RecordingFileError extends Error {}

// rows: one entry per terrain row, null for a gap, else { source: "live" | "filled", smoothing, levels }.
export function serializeRecording({ track, duration, step, analyser, rows }) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    track,
    duration,
    step,
    analyser,
    rows: rows.map(row => row && { source: row.source, smoothing: round(row.smoothing), levels: Array.from(row.levels, round) })
  });
}

export function parseRecording(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RecordingFileError("This file isn't a visualizer recording.");
  }
  if (data?.format !== FORMAT) throw new RecordingFileError("This file isn't a visualizer recording.");
  if (data.version !== VERSION) throw new RecordingFileError("This recording was saved by a different version of the player.");
  const positive = value => Number.isFinite(value) && value > 0;
  if (!positive(data.duration) || !positive(data.step) || !Array.isArray(data.rows) || !data.rows.length) {
    throw new RecordingFileError("This recording is incomplete.");
  }
  const bands = data.rows.find(Boolean)?.levels?.length;
  if (!bands) throw new RecordingFileError("This recording is empty.");
  const rows = data.rows.map(row => {
    if (row === null) return null;
    const valid = (row.source === "live" || row.source === "filled") && Number.isFinite(row.smoothing)
      && Array.isArray(row.levels) && row.levels.length === bands && row.levels.every(Number.isFinite);
    if (!valid) throw new RecordingFileError("This recording is damaged.");
    return { source: row.source, smoothing: row.smoothing, levels: row.levels.map(level => Math.min(1, Math.max(0, level))) };
  });
  return { track: data.track ?? null, duration: data.duration, step: data.step, analyser: data.analyser ?? null, bands, rows };
}
