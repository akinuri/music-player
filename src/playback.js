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

  async play(directory, path) {
    this.stop();
    const request = this.request;
    this.pendingPath = path;
    try {
      const file = await getTrackFile(directory, path);
      if (request !== this.request) return;
      this.pendingPath = null;
      this.url = URL.createObjectURL(file);
      this.path = path;
      this.audio.src = this.url;
      this.onChange();
      await this.audio.play();
    } catch (error) {
      if (request !== this.request) return;
      this.pendingPath = null;
      throw error;
    }
  }
}
