// An offline copy of the Web Audio AnalyserNode's frequency analysis, as the spec defines it: the latest fftSize
// samples, a Blackman window, an FFT scaled by 1/fftSize, smoothing over time, then decibels mapped onto 0-255.
// The 3D terrain uses it to fill rows it missed (hidden tab, a jump ahead) from the decoded file.

export class Spectrum {
  // gain: scales the magnitudes before decibels; 1 is the spec's formula (see ANALYSER_GAIN in visualizer.js).
  constructor(fftSize, { minDecibels, maxDecibels, gain = 1 }) {
    this.size = fftSize;
    this.gain = gain;
    this.minDecibels = minDecibels;
    this.maxDecibels = maxDecibels;
    const half = fftSize / 2;
    this.window = new Float64Array(fftSize);
    for (let n = 0; n < fftSize; n++) {
      this.window[n] = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / fftSize) + 0.08 * Math.cos((4 * Math.PI * n) / fftSize);
    }
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / fftSize);
      this.sin[k] = -Math.sin((2 * Math.PI * k) / fftSize);
    }
    this.reversed = new Uint32Array(fftSize);
    const bits = Math.log2(fftSize);
    for (let i = 0; i < fftSize; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.smoothed = new Float64Array(half);
    this.bytes = new Uint8Array(half);
  }

  // Forgets the smoothing history, as a fresh analyser would.
  reset() {
    this.smoothed.fill(0);
  }

  // Analyses the fftSize samples ending just before index `end` (silence before the start), like
  // getByteFrequencyData at that moment; `smoothing` is the analyser's smoothingTimeConstant. Returns a shared buffer.
  analyse(samples, end, smoothing) {
    const { size, re, im, reversed, window, cos, sin, smoothed, bytes } = this;
    const start = end - size;
    for (let n = 0; n < size; n++) {
      const index = start + n;
      re[reversed[n]] = index >= 0 && index < samples.length ? samples[index] * window[n] : 0;
      im[reversed[n]] = 0;
    }
    for (let length = 2; length <= size; length *= 2) {
      const half = length / 2;
      const stride = size / length;
      for (let offset = 0; offset < size; offset += length) {
        for (let k = 0; k < half; k++) {
          const a = offset + k;
          const b = a + half;
          const wr = cos[k * stride];
          const wi = sin[k * stride];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const scale = 255 / (this.maxDecibels - this.minDecibels);
    const keep = 1 - smoothing;
    const magnitudeScale = this.gain / size;
    for (let k = 0; k < smoothed.length; k++) {
      const value = smoothing * smoothed[k] + keep * Math.sqrt(re[k] * re[k] + im[k] * im[k]) * magnitudeScale;
      smoothed[k] = Number.isFinite(value) ? value : 0;
      // log10(0) is -Infinity, which clamps to 0 like any level below minDecibels.
      const byte = Math.floor(scale * (20 * Math.log10(smoothed[k]) - this.minDecibels));
      bytes[k] = byte > 255 ? 255 : byte > 0 ? byte : 0;
    }
    return bytes;
  }
}

// The channels mixed to one, as the analyser hears them.
export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= channels.length;
  return mono;
}
