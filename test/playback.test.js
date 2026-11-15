import test from "node:test";
import assert from "node:assert/strict";
import { Playback } from "../src/playback.js";

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
