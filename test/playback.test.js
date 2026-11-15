import test from "node:test";
import assert from "node:assert/strict";
import { Playback } from "../src/playback.js";

test("restoring a track can seek to a saved position without autoplaying", async () => {
  const originalAudio = globalThis.Audio;
  const originalCreate = URL.createObjectURL;
  let playCalls = 0;
  const listeners = {};
  globalThis.Audio = class {
    duration = 100;
    currentTime = 0;
    addEventListener(name, handler) { listeners[name] = handler; }
    pause() {}
    removeAttribute() {}
    load() {}
    async play() { playCalls++; }
  };
  URL.createObjectURL = () => "blob:test";
  try {
    const player = new Playback({ onChange() {}, onEnded() {}, onError() {} });
    const directory = { getFileHandle: async () => ({ getFile: async () => new Blob(["audio"]) }) };
    await player.play(directory, "song.mp3", { startAt: 42, autoplay: false });
    listeners.loadedmetadata();
    assert.equal(player.path, "song.mp3");
    assert.equal(player.audio.currentTime, 42);
    assert.equal(playCalls, 0);
  } finally {
    globalThis.Audio = originalAudio;
    URL.createObjectURL = originalCreate;
  }
});

test("stopping while a file is opening prevents it from starting later", async () => {
  const originalAudio = globalThis.Audio;
  let resolveFile;
  let playCalls = 0;
  globalThis.Audio = class {
    addEventListener() {}
    pause() {}
    removeAttribute() {}
    load() {}
    async play() { playCalls++; }
  };
  try {
    const player = new Playback({ onChange() {}, onEnded() {}, onError() {} });
    const directory = { getFileHandle: async () => ({ getFile: () => new Promise(resolve => { resolveFile = resolve; }) }) };
    const opening = player.play(directory, "song.mp3");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(player.pendingPath, "song.mp3");
    player.stop();
    resolveFile(new Blob(["audio"]));
    await opening;
    assert.equal(playCalls, 0);
    assert.equal(player.path, null);
    assert.equal(player.pendingPath, null);
  } finally {
    globalThis.Audio = originalAudio;
  }
});
