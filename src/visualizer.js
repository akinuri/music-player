import { themeColor, themeRgb } from "./theme.js";

const FFT_SIZE = 2048;
const MIN_DB = -90;
const MAX_DB = -10;
const MARGIN = { left: 8, right: 8, top: 26, bottom: 8 };
const FONT = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
// The 2D bar count for a plot width, so 3D shows the same bars.
// Both views show the analyser's full range, from its first band up to half the sample rate (the top of the audio),
// as the same fixed number of log-spaced bars, whatever the size of the panel.
const BANDS = 96;

// Log-spaced band edges (Hz): count bands need count + 1 edges.
export function bandEdges(count, minFreq, maxFreq) {
  return Array.from({ length: count + 1 }, (_, i) => minFreq * (maxFreq / minFreq) ** (i / count));
}

// Level (0-1) of each band. Bins within a band are reduced to their peak;
// a band narrower than one bin is interpolated between the neighbouring bins instead.
export function bandLevels(data, edges, binHz) {
  const levels = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const first = Math.ceil(edges[i] / binHz);
    const last = Math.min(data.length - 1, Math.floor(edges[i + 1] / binHz));
    let value = 0;
    if (first <= last) {
      for (let bin = first; bin <= last; bin++) value = Math.max(value, data[bin]);
    } else {
      const position = Math.sqrt(edges[i] * edges[i + 1]) / binHz;
      const low = Math.min(data.length - 1, Math.floor(position));
      const high = Math.min(data.length - 1, low + 1);
      value = data[low] + (data[high] - data[low]) * (position - low);
    }
    levels.push(value / 255);
  }
  return levels;
}

// Blurs levels across neighbouring bands with a Gaussian of the given width (in bands); 0 returns them unchanged.
export function smoothLevels(levels, sigma) {
  if (sigma <= 0) return levels;
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
  return levels.map((_, i) => {
    let sum = 0;
    let total = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= levels.length) continue;
      sum += levels[j] * weights[k + radius];
      total += weights[k + radius];
    }
    return sum / total;
  });
}

export function formatFrequency(hz) {
  if (hz >= 1000) return `${parseFloat((hz / 1000).toFixed(hz >= 10000 ? 1 : 2))} kHz`;
  return `${Math.round(hz)} Hz`;
}

export class Visualizer {
  // canvas: the 2D bars. stage: where the 3D terrain renders (loaded on first use).
  constructor(audio, canvas, stage) {
    this.audio = audio;
    this.canvas = canvas;
    this.stage = stage;
    this.mode = "2d";
    this.terrain = null;
    this.terrainLoading = null;
    this.onTerrainError = () => {};
    this.visible = false;
    this.smoothing = 0;
    this.sheet = 0;
    audio.addEventListener("play", () => this.resumeRecording());
    this.context = null;
    this.analyser = null;
    this.data = null;
    this.levels = [];
    this.peaks = [];
    this.snapshot = null;
    this.ghostLevels = null;
    this.ghost = 0;
    this.wasHolding = false;
    this.frame = 0;
    this.hover = null;
    canvas.addEventListener("pointermove", event => {
      const bounds = canvas.getBoundingClientRect();
      this.hover = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; });
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48000;
  }

  // Routing the audio through Web Audio needs a running context; connecting a suspended one would mute playback.
  connect() {
    if (this.analyser) return;
    this.context ??= new AudioContext();
    if (this.context.state !== "running") {
      this.context.resume().then(() => this.connect(), () => {});
      return;
    }
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.minDecibels = MIN_DB;
    this.analyser.maxDecibels = MAX_DB;
    this.analyser.smoothingTimeConstant = this.timeSmoothing();
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    const source = this.context.createMediaElementSource(this.audio);
    source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  start() {
    this.visible = true;
    this.connect();
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  // Leaving the visualizer stops drawing. Once the 3D terrain exists, analysis keeps running while music plays so the
  // terrain records the whole song; it rests when playback pauses and resumes with it.
  stop() {
    this.visible = false;
    if (this.terrain && !this.audio.paused) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  resumeRecording() {
    if (this.terrain && !this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  // Smoothing strength, 0-1: blurs across up to ±3 bands and averages over a longer window (shared by both views).
  setSmoothing(strength) {
    this.smoothing = Math.min(1, Math.max(0, strength));
    if (this.analyser) this.analyser.smoothingTimeConstant = this.timeSmoothing();
  }

  timeSmoothing() {
    return 0.75 + this.smoothing * 0.2;
  }

  // How smooth the 3D history is drawn: 0 = bars, above that a sheet blended over time (0-1).
  setSheet(strength) {
    this.sheet = strength;
    this.terrain?.setSheet(strength);
  }

  setMode(mode) {
    this.mode = mode === "3d" ? "3d" : "2d";
  }

  // three.js lives in its own bundle next to this one; it's fetched the first time 3D is shown.
  loadTerrain() {
    this.terrainLoading ??= import(new URL("./terrain.js", import.meta.url).href)
      .then(({ Terrain }) => {
        this.terrain = new Terrain(this.stage, BANDS);
        this.terrain.setSheet(this.sheet);
      })
      .catch(error => {
        console.error("Could not load the 3D visualizer:", error);
        this.onTerrainError(error);
      });
  }

  // One analysis per frame, whichever view is showing, so 2D and 3D always show the same moment: the same bar levels,
  // peaks and (when paused) the same frozen slice.
  analyse() {
    const binHz = this.sampleRate / FFT_SIZE;
    const minFreq = binHz;
    const maxFreq = this.sampleRate / 2;
    const count = BANDS;
    const edges = bandEdges(count, minFreq, maxFreq);
    if (this.levels.length !== count) {
      this.levels = new Array(count).fill(0);
      this.peaks = new Array(count).fill(0);
      this.snapshot = null;
    }
    const paused = this.audio.paused;
    const holding = paused && this.audio.readyState > 0;
    // Pausing keeps the moment it stopped on (shown as a ghost in 2D while the live bars die down, and as the frozen
    // front row in 3D); stopping drops it.
    if (holding && !this.wasHolding) this.snapshot = [...this.levels];
    if (!holding) this.snapshot = null;
    this.wasHolding = holding;
    let target = new Array(count).fill(0);
    if (this.analyser && !paused) {
      this.analyser.getByteFrequencyData(this.data);
      target = smoothLevels(bandLevels(this.data, edges, binHz), this.smoothing * 3);
    }
    this.levels = this.levels.map((level, i) => Math.max(target[i], level * 0.9));
    if (!holding) this.peaks = this.peaks.map((peak, i) => Math.max(this.levels[i], peak - (paused ? 0.02 : 0.004)));
    this.ghost += ((this.snapshot ? 0.3 : 0) - this.ghost) * 0.15;
    if (this.snapshot) this.ghostLevels = this.snapshot;
    return { edges, minFreq, maxFreq, count };
  }

  // The song position places the row; the source URL tells tracks apart. While playing, the front row is exactly the
  // 2D bars; paused, it stays on the slice it stopped at, the one the 2D ghost shows.
  recordTerrain(range) {
    this.terrain?.record(this.levels, { playing: !this.audio.paused, track: this.audio.currentSrc || null, time: this.audio.currentTime, duration: this.audio.duration, range });
  }

  draw3d() {
    if (!this.terrain) {
      this.loadTerrain();
      return;
    }
    this.terrain.render({ peaks: this.peaks, playing: !this.audio.paused, low: themeRgb("viz-a"), high: themeRgb("viz-b"), peak: themeRgb("viz-peak"), background: themeRgb("surface"), grid: themeRgb("soft") });
  }

  draw() {
    this.frame = requestAnimationFrame(() => this.draw());
    const { edges, minFreq, maxFreq, count } = this.analyse();
    this.recordTerrain([minFreq, maxFreq]);
    if (!this.visible) {
      // Recording in the background: rest once playback pauses (resumeRecording starts again on play).
      if (this.audio.paused) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      return;
    }
    if (this.mode === "3d") return this.draw3d();
    const { canvas } = this;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const plot = { left: MARGIN.left, top: MARGIN.top, width: width - MARGIN.left - MARGIN.right, height: height - MARGIN.top - MARGIN.bottom };
    if (plot.width < 120 || plot.height < 60) return;

    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = FONT;
    const xOf = hz => plot.left + (plot.width * Math.log(hz / minFreq)) / Math.log(maxFreq / minFreq);
    const yOf = level => plot.top + plot.height * (1 - level);

    const gradient = context.createLinearGradient(0, plot.top + plot.height, 0, plot.top);
    gradient.addColorStop(0, themeColor("viz-a"));
    gradient.addColorStop(1, themeColor("viz-b"));
    context.fillStyle = gradient;
    const drawBars = levels => levels.forEach((level, i) => {
      const x = xOf(edges[i]);
      const barWidth = Math.max(1, xOf(edges[i + 1]) - x - 1);
      const barHeight = Math.max(1, level * plot.height);
      context.fillRect(x, plot.top + plot.height - barHeight, barWidth, barHeight);
    });
    if (this.ghost > 0.01 && this.ghostLevels?.length === count) {
      context.globalAlpha = this.ghost;
      drawBars(this.ghostLevels);
      context.globalAlpha = 1;
    }
    drawBars(this.levels);

    // Peak markers (each bar's recent high, sinking slowly) fade with the bars while paused.
    context.fillStyle = themeColor("viz-peak");
    context.globalAlpha = 1 - this.ghost / 0.3 * 0.7;
    this.peaks.forEach((peak, i) => {
      if (peak <= 0.01) return;
      const x = xOf(edges[i]);
      context.fillRect(x, yOf(peak) - 2, Math.max(1, xOf(edges[i + 1]) - x - 1), 2);
    });
    context.globalAlpha = 1;

    this.drawHover(context, plot, edges, xOf, yOf);
  }

  drawHover(context, plot, edges, xOf, yOf) {
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = themeColor("soft");
    const hover = this.hover;
    const index = hover ? edges.findIndex((edge, i) => i + 1 < edges.length && hover.x >= xOf(edge) && hover.x < xOf(edges[i + 1])) : -1;
    if (index < 0 || hover.y < plot.top || hover.y > plot.top + plot.height) {
      context.fillText("Hover a bar for exact values", plot.left, plot.top - 9);
      return;
    }
    const x = xOf(edges[index]);
    context.fillStyle = themeColor("primary", 0.12);
    context.fillRect(x, plot.top, Math.max(1, xOf(edges[index + 1]) - x - 1), plot.height);
    const reading = level => (level <= 0.002 ? "silent" : String(Math.round(level * (MAX_DB - MIN_DB))));
    context.fillStyle = themeColor("fg-2");
    const shown = this.snapshot ?? this.levels;
    context.fillText(`${formatFrequency(edges[index])} – ${formatFrequency(edges[index + 1])}   loudness ${reading(shown[index])}`, plot.left, plot.top - 9);
  }
}
