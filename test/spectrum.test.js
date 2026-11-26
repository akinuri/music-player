import test from "node:test";
import assert from "node:assert/strict";
import { mixToMono, Spectrum } from "../src/spectrum.js";
import { simulateRows } from "../src/visualizer.js";

const RANGE = { minDecibels: -90, maxDecibels: -10 };

// The spec's analyser computed the slow way: windowed DFT, 1/N scale, dB, bytes (no smoothing).
function referenceBytes(samples, end, size) {
  const bytes = [];
  for (let k = 0; k < size / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < size; n++) {
      const index = end - size + n;
      const x = index >= 0 && index < samples.length ? samples[index] : 0;
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / size) + 0.08 * Math.cos((4 * Math.PI * n) / size);
      re += x * w * Math.cos((2 * Math.PI * k * n) / size);
      im -= x * w * Math.sin((2 * Math.PI * k * n) / size);
    }
    const decibels = 20 * Math.log10(Math.hypot(re, im) / size);
    bytes.push(Math.min(255, Math.max(0, Math.floor((255 / 80) * (decibels + 90)))) || 0);
  }
  return bytes;
}

test("the spectrum matches the analyser's definition (windowed DFT in decibels)", () => {
  const size = 64;
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const samples = Float32Array.from({ length: 200 }, () => random() * 0.5);
  const spectrum = new Spectrum(size, RANGE);
  for (const end of [size, 150, 30]) {
    const actual = [...spectrum.analyse(samples, end, 0)];
    const expected = referenceBytes(samples, end, size);
    // Rounding may land a value on the other side of an integer.
    actual.forEach((value, k) => assert.ok(Math.abs(value - expected[k]) <= 1, `bin ${k} at ${end}: ${value} vs ${expected[k]}`));
  }
});

test("a sine peaks in its own bin; silence reads as zero", () => {
  const size = 256;
  const bin = 20;
  const samples = Float32Array.from({ length: size }, (_, n) => Math.sin((2 * Math.PI * bin * n) / size));
  const bytes = [...new Spectrum(size, RANGE).analyse(samples, size, 0)];
  assert.equal(bytes.indexOf(Math.max(...bytes)), bin);
  assert.ok(new Spectrum(size, RANGE).analyse(new Float32Array(size), size, 0).every(value => value === 0));
});

test("smoothing carries the previous analysis over, and reset forgets it", () => {
  const size = 64;
  const loud = Float32Array.from({ length: size }, (_, n) => Math.sin((2 * Math.PI * 5 * n) / size));
  const spectrum = new Spectrum(size, RANGE);
  const fresh = spectrum.analyse(loud, size, 0)[5];
  const fading = spectrum.analyse(new Float32Array(size), size, 0.8)[5];
  assert.ok(fading > 0 && fading < fresh);
  spectrum.reset();
  assert.equal(spectrum.analyse(new Float32Array(size), size, 0.8)[5], 0);
});

test("channels mix to their average", () => {
  assert.deepEqual([...mixToMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])], [0.5, 0.5]);
  const mono = Float32Array.of(0.25);
  assert.equal(mixToMono([mono]), mono);
});

test("simulated rows cover exactly the gap, in order, with the tone in the right band", () => {
  const sampleRate = 8000;
  const samples = Float32Array.from({ length: sampleRate * 4 }, (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / sampleRate));
  const rows = [...simulateRows({ samples, sampleRate, first: 2, last: 5, step: 0.5, duration: 4, bands: 24, smoothing: 0 })];
  assert.deepEqual(rows.map(entry => entry.row), [2, 3, 4, 5]);
  for (const { levels } of rows) {
    assert.equal(levels.length, 24);
    const loudest = levels.indexOf(Math.max(...levels));
    // 24 log-spaced bands from 3.9 Hz to 4 kHz: 1 kHz falls in band 19.
    assert.equal(loudest, 19);
  }
});

test("a gain of one half reads 6.02 dB lower, as Chromium's analyser does", () => {
  const size = 256;
  const samples = Float32Array.from({ length: size }, (_, n) => 0.1 * Math.sin((2 * Math.PI * 20 * n) / size));
  const range = { minDecibels: -100, maxDecibels: 0 };
  const full = new Spectrum(size, range).analyse(samples, size, 0)[20];
  const half = new Spectrum(size, { ...range, gain: 0.5 }).analyse(samples, size, 0)[20];
  // 6.02 dB is 15.4 steps of the 0-255 scale over 100 dB; flooring can make it one more.
  assert.ok(full - half >= 15 && full - half <= 16, `${full} vs ${half}`);
});
