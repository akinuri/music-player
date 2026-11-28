// Cover art for tracks and albums: the tag's picture (the front cover first), else an image in the track's folder
// (cover.jpg, folder.png, …). Each becomes a small thumbnail, so lists of many covers don't decode full-size images,
// and is kept in IndexedDB by track path and modification time, so it's there at once after a reload and looked up
// again when the file changes. Covers are handed out as object URLs.

import { findFolderImage } from "./filesystem.js";
import { readCover, tagLength } from "./id3.js";
import { loadCover, saveCover } from "./storage.js";

// Thumbnails fit this square: sharp in a grid card on a high-density screen, a fraction of a full-size cover.
const THUMBNAIL_SIZE = 320;
// Files read at once while covers load (a long list scrolled into view asks for many).
const CONCURRENT_READS = 4;
// An album's cover is looked for in its first few tracks (in track order), not all of them.
const ALBUM_TRACKS_TRIED = 3;
// What load() gives when the file can't be reached right now (its folder needs reconnecting): not remembered, so it's
// tried again later.
const UNREACHABLE = Symbol("unreachable");

const albumTracksTried = tracks => [...tracks].sort((a, b) => (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity)).slice(0, ALBUM_TRACKS_TRIED);

async function thumbnail(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

export class Covers {
  // file(path): the track's File, or null when it can't be reached now. folder(path): { directory, path } to look for a folder image in, or null.
  // key(path): what to keep its thumbnail under (null: don't keep it, as for dropped music).
  constructor({ file, folder, key }) {
    Object.assign(this, { file, folder, key });
    this.urls = new Map();
    this.reading = 0;
    this.waiting = [];
  }

  // The track's cover as an object URL, or null without one.
  track(path) {
    if (!this.urls.has(path)) {
      const forgetting = () => {
        this.urls.delete(path);
        return null;
      };
      this.urls.set(path, this.load(path).then(url => url === UNREACHABLE ? forgetting() : url, error => {
        console.error("Could not read a cover:", error);
        return forgetting();
      }));
    }
    return this.urls.get(path);
  }

  // An album's cover: that of its first track (by track number) that has one, among the first few.
  async album(tracks) {
    for (const track of albumTracksTried(tracks)) {
      const url = await this.track(track.path);
      if (url) return url;
    }
    return null;
  }

  // The full-size cover image (a Blob), for viewing it; null without one.
  async image(path) {
    const image = await this.find(path);
    return image === UNREACHABLE ? null : image;
  }

  async albumImage(tracks) {
    for (const track of albumTracksTried(tracks)) {
      const image = await this.image(track.path);
      if (image) return image;
    }
    return null;
  }

  // Drops what's known of a track's cover (its file changed), so it's looked up again.
  forget(path) {
    const url = this.urls.get(path);
    this.urls.delete(path);
    url?.then(value => value && URL.revokeObjectURL(value));
  }

  async load(path) {
    const key = this.key(path);
    if (key) {
      const stored = await loadCover(key).catch(() => undefined);
      if (stored !== undefined) return stored ? URL.createObjectURL(stored) : null;
    }
    const image = await this.limited(() => this.find(path));
    if (image === UNREACHABLE) return UNREACHABLE;
    const small = image ? await thumbnail(image).catch(() => null) : null;
    if (key) saveCover(key, small).catch(error => console.error("Could not keep a cover:", error));
    return small ? URL.createObjectURL(small) : null;
  }

  // The full-size image: the tag's picture, else the folder's.
  async find(path) {
    const file = await this.file(path);
    if (!file) return UNREACHABLE;
    const length = tagLength(new Uint8Array(await file.slice(0, 10).arrayBuffer()));
    if (length) {
      const cover = readCover(new Uint8Array(await file.slice(0, length).arrayBuffer()));
      if (cover) return new Blob([cover.data], { type: cover.mime });
    }
    const folder = this.folder(path);
    return folder ? findFolderImage(folder.directory, folder.path) : null;
  }

  // Runs a file read once fewer than CONCURRENT_READS are going.
  async limited(task) {
    if (this.reading >= CONCURRENT_READS) await new Promise(resolve => this.waiting.push(resolve));
    this.reading++;
    try {
      return await task();
    } finally {
      this.reading--;
      this.waiting.shift()?.();
    }
  }
}
