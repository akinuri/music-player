import test from "node:test";
import assert from "node:assert/strict";
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { readMetadata } from "../src/metadata.js";

test("reads track numbers from MP3 tags and treats missing or invalid values as unknown", async t => {
  let tag;
  t.mock.method(jsmediatags, "read", (file, callbacks) => callbacks.onSuccess({ tags: { track: tag } }));
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(URL, "revokeObjectURL", () => {});
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class {
    duration = 10;
    removeAttribute() {}
    load() {}
    set src(value) { queueMicrotask(() => this.onloadedmetadata()); }
  };
  t.after(() => {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  });
  for (const [value, expected] of [["03/12", 3], [4, 4], [" 7 ", 7], ["", null], [undefined, null], ["0", null], ["4x", null], ["4/abc", null]]) {
    tag = value;
    assert.equal((await readMetadata({})).trackNumber, expected, `track tag ${String(value)}`);
  }
});
