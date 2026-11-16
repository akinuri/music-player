const FFT_SIZE = 2048;
const MIN_DB = -90;
const MAX_DB = -10;
const MAX_FREQ = 20000;
const MARGIN = { left: 8, right: 8, top: 26, bottom: 8 };
const FONT = "11px ui-monospace, SFMono-Regular, Consolas, monospace";

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

export function formatFrequency(hz) {
  if (hz >= 1000) return `${parseFloat((hz / 1000).toFixed(hz >= 10000 ? 1 : 2))} kHz`;
  return `${Math.round(hz)} Hz`;
}

export class Visualizer {
  constructor(audio, canvas) {
    this.audio = audio;
    this.canvas = canvas;
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
    this.analyser.smoothingTimeConstant = 0.75;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    const source = this.context.createMediaElementSource(this.audio);
    source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  start() {
    this.connect();
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  draw() {
    this.frame = requestAnimationFrame(() => this.draw());
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

    const binHz = this.sampleRate / FFT_SIZE;
    const minFreq = binHz;
    const maxFreq = Math.min(MAX_FREQ, this.sampleRate / 2);
    const count = Math.max(16, Math.min(96, Math.floor(plot.width / 9)));
    const edges = bandEdges(count, minFreq, maxFreq);
    if (this.levels.length !== count) {
      this.levels = new Array(count).fill(0);
      this.peaks = new Array(count).fill(0);
      this.snapshot = null;
    }

    const paused = this.audio.paused;
    const holding = paused && this.audio.readyState > 0;
    // Pausing leaves a faded ghost of that moment while the live bars die down; stopping drops the ghost.
    if (holding && !this.wasHolding) this.snapshot = [...this.levels];
    if (!holding) this.snapshot = null;
    this.wasHolding = holding;
    let target = new Array(count).fill(0);
    if (this.analyser && !paused) {
      this.analyser.getByteFrequencyData(this.data);
      target = bandLevels(this.data, edges, binHz);
    }
    this.levels = this.levels.map((level, i) => Math.max(target[i], level * 0.9));
    if (!holding) this.peaks = this.peaks.map((peak, i) => Math.max(this.levels[i], peak - (paused ? 0.02 : 0.004)));
    this.ghost += ((this.snapshot ? 0.3 : 0) - this.ghost) * 0.15;
    if (this.snapshot) this.ghostLevels = this.snapshot;

    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = FONT;
    const xOf = hz => plot.left + (plot.width * Math.log(hz / minFreq)) / Math.log(maxFreq / minFreq);
    const yOf = level => plot.top + plot.height * (1 - level);

    const gradient = context.createLinearGradient(0, plot.top + plot.height, 0, plot.top);
    gradient.addColorStop(0, "#315e55");
    gradient.addColorStop(1, "#7cc3a6");
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

    context.fillStyle = "#1f3a33";
    this.peaks.forEach((peak, i) => {
      if (peak <= 0.01) return;
      const x = xOf(edges[i]);
      context.fillRect(x, yOf(peak) - 2, Math.max(1, xOf(edges[i + 1]) - x - 1), 2);
    });

    this.drawHover(context, plot, edges, xOf, yOf);
  }

  drawHover(context, plot, edges, xOf, yOf) {
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#5d7079";
    const hover = this.hover;
    const index = hover ? edges.findIndex((edge, i) => i + 1 < edges.length && hover.x >= xOf(edge) && hover.x < xOf(edges[i + 1])) : -1;
    if (index < 0 || hover.y < plot.top || hover.y > plot.top + plot.height) {
      context.fillText("Hover a bar for exact values", plot.left, plot.top - 9);
      return;
    }
    const x = xOf(edges[index]);
    context.fillStyle = "rgba(49, 94, 85, 0.12)";
    context.fillRect(x, plot.top, Math.max(1, xOf(edges[index + 1]) - x - 1), plot.height);
    const reading = level => (level <= 0.002 ? "silent" : String(Math.round(level * (MAX_DB - MIN_DB))));
    context.fillStyle = "#273b44";
    const shown = this.snapshot ?? this.levels;
    context.fillText(`${formatFrequency(edges[index])} – ${formatFrequency(edges[index + 1])}   loudness ${reading(shown[index])}`, plot.left, plot.top - 9);
  }
}
