import { getTrackFile } from "./filesystem.js";

export class Playback {
  constructor({ onChange, onEnded, onError }) {
    this.audio = new Audio();
    this.path = null;
    this.pendingPath = null;
    this.url = null;
    this.request = 0;
    this.onChange = onChange;
    for (const event of ["play", "pause", "timeupdate", "durationchange", "loadedmetadata"]) {
      this.audio.addEventListener(event, onChange);
    }
    this.audio.addEventListener("ended", onEnded);
    this.audio.addEventListener("error", () => {
      if (this.path && this.audio.error) onError(new Error("The audio file could not be decoded or played."));
    });
  }

  stop() {
    this.request++;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.path = null;
    this.pendingPath = null;
    this.onChange();
  }

  // `path` identifies the track (what `this.path` reports); `filePath` locates it inside `directory` when they differ.
  // `file` plays a File directly (e.g. dropped music that isn't in any folder source).
  async play(directory, path, { startAt = 0, autoplay = true, filePath = path, file: given = null } = {}) {
    this.stop();
    const request = this.request;
    this.pendingPath = path;
    try {
      const file = given || await getTrackFile(directory, filePath);
      if (request !== this.request) return;
      this.pendingPath = null;
      this.url = URL.createObjectURL(file);
      this.path = path;
      if (startAt > 0) {
        this.audio.addEventListener("loadedmetadata", () => {
          if (request === this.request && startAt < this.audio.duration) this.audio.currentTime = startAt;
        }, { once: true });
      }
      this.audio.src = this.url;
      this.onChange();
      if (autoplay) await this.audio.play();
    } catch (error) {
      if (request !== this.request) return;
      this.pendingPath = null;
      throw error;
    }
  }
}
