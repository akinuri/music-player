import test from "node:test";
import assert from "node:assert/strict";
import { buildYearTimeline } from "../src/analysis.js";

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
