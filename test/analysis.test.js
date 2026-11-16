import test from "node:test";
import assert from "node:assert/strict";
import { buildYearTimeline } from "../src/analysis.js";
import { bandEdges, bandLevels, formatFrequency } from "../src/visualizer.js";

test("builds contiguous log-spaced band edges", () => {
  const edges = bandEdges(3, 20, 20000);
  assert.equal(edges.length, 4);
  assert.ok(Math.abs(edges[0] - 20) < 1e-9 && Math.abs(edges[3] - 20000) < 1e-6);
  assert.ok(Math.abs(edges[1] - 200) < 1e-6 && Math.abs(edges[2] - 2000) < 1e-6);
});

test("reduces wide bands to their peak bin and interpolates narrow ones", () => {
  const data = new Uint8Array(512);
  data[10] = 255;
  data[11] = 100;
  data[2] = 200;
  data[3] = 100;
  // One band covers bins 8-12 (peak 255); the next sits between bins 2 and 3 without containing either.
  const wide = bandLevels(data, [8 * 10, 12 * 10], 10);
  assert.equal(wide[0], 1);
  const narrow = bandLevels(data, [2.2 * 10, 2.8 * 10], 10);
  assert.ok(narrow[0] > 100 / 255 && narrow[0] < 200 / 255);
  assert.ok(bandLevels(data, bandEdges(64, 20, 20000), 20).every(level => level >= 0 && level <= 1));
});

test("formats frequencies for axis readouts", () => {
  assert.equal(formatFrequency(440), "440 Hz");
  assert.equal(formatFrequency(1250), "1.25 kHz");
  assert.equal(formatFrequency(16000), "16 kHz");
});

test("builds a continuous year timeline with album and track counts", () => {
  const tracks = [
    { title: "a", album: "First", year: 2001 },
    { title: "b", album: "First", year: 2003 },
    { title: "c", album: "Second", year: 2003 },
    { title: "d", album: "Loose", year: null },
    { title: "e", album: "", year: null }
  ];
  const timeline = buildYearTimeline(tracks);
  assert.deepEqual(timeline.years.map(item => [item.year, item.tracks.length, item.albums.length]), [[2001, 1, 1], [2002, 0, 0], [2003, 2, 1]]);
  assert.deepEqual(timeline.years[0].albums.map(album => album.key), ["First"]);
  assert.deepEqual([timeline.min, timeline.max, timeline.knownTracks, timeline.knownAlbums, timeline.unknownTracks, timeline.unknownAlbums], [2001, 2003, 3, 2, 2, 2]);
});

test("timeline is empty without years and skips empty years across huge spans", () => {
  assert.deepEqual(buildYearTimeline([{ title: "x", album: "Y", year: null }]).years, []);
  assert.equal(buildYearTimeline([]).min, null);
  const sparse = buildYearTimeline([{ title: "a", album: "A", year: 1 }, { title: "b", album: "B", year: 2020 }]);
  assert.deepEqual(sparse.years.map(item => item.year), [1, 2020]);
});
