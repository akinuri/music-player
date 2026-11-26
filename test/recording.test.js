import test from "node:test";
import assert from "node:assert/strict";
import { parseRecording, RecordingFileError, serializeRecording } from "../src/recording.js";

const sample = {
  track: { title: "Clocks", artist: "", album: "", file: "05 - Clocks.mp3" },
  duration: 1.2,
  step: 0.5,
  analyser: { sampleRate: 48000, fftSize: 2048, minDecibels: -90, maxDecibels: -10, bands: 3 },
  rows: [
    { source: "live", smoothing: 0.25, levels: Float32Array.of(0.123456, 0, 1) },
    null,
    { source: "filled", smoothing: 0.25, levels: [0.5, 0.25, 0.75] }
  ]
};

test("a recording survives saving and loading, gaps and row sources included", () => {
  const loaded = parseRecording(serializeRecording(sample));
  assert.equal(loaded.bands, 3);
  assert.deepEqual(loaded.track, sample.track);
  assert.deepEqual(loaded.analyser, sample.analyser);
  assert.deepEqual(loaded.rows, [
    { source: "live", smoothing: 0.25, levels: [0.1235, 0, 1] },
    null,
    { source: "filled", smoothing: 0.25, levels: [0.5, 0.25, 0.75] }
  ]);
  assert.equal(loaded.duration, 1.2);
  assert.equal(loaded.step, 0.5);
});

test("files that aren't usable recordings are refused with a readable reason", () => {
  const broken = changes => JSON.stringify({ ...JSON.parse(serializeRecording(sample)), ...changes });
  for (const text of ["not json", "{}", JSON.stringify({ format: "other" })]) {
    assert.throws(() => parseRecording(text), RecordingFileError);
  }
  assert.throws(() => parseRecording(broken({ version: 2 })), /different version/);
  assert.throws(() => parseRecording(broken({ duration: 0 })), /incomplete/);
  assert.throws(() => parseRecording(broken({ rows: [null, null] })), /empty/);
  assert.throws(() => parseRecording(broken({ rows: [{ source: "live", smoothing: 0, levels: [1, 2, 3] }, { source: "live", smoothing: 0, levels: [1] }] })), /damaged/);
  assert.throws(() => parseRecording(broken({ rows: [{ source: "guessed", smoothing: 0, levels: [1] }] })), /damaged/);
});

test("levels outside 0-1 are clamped when loading", () => {
  const text = JSON.stringify({ ...JSON.parse(serializeRecording(sample)), rows: [{ source: "live", smoothing: 0, levels: [-1, 2, 0.5] }] });
  assert.deepEqual(parseRecording(text).rows[0].levels, [0, 1, 0.5]);
});
