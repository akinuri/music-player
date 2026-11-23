import test from "node:test";
import assert from "node:assert/strict";
import { smoothLevels } from "../src/visualizer.js";

test("smoothing blurs levels across neighbouring bands and keeps the overall level", () => {
  const levels = [0, 0, 1, 0, 0];
  assert.deepEqual(smoothLevels(levels, 0), levels);
  const smoothed = smoothLevels(levels, 1);
  assert.ok(smoothed[2] < 1 && smoothed[2] > smoothed[1] && smoothed[1] > smoothed[0]);
  assert.ok(Math.abs(smoothed[1] - smoothed[3]) < 1e-9);
  assert.ok(smoothLevels([0.5, 0.5, 0.5], 2).every(level => Math.abs(level - 0.5) < 1e-9));
});
