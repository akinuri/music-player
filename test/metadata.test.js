import test from "node:test";
import assert from "node:assert/strict";
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { readMetadata } from "../src/metadata.js";

test("reads track numbers from MP3 tags and treats missing or invalid values as unknown", async t => {
  let tag;
  let year;
  t.mock.method(jsmediatags, "read", (file, callbacks) => callbacks.onSuccess({ tags: { track: tag, year } }));
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
  for (const [value, expected] of [["1999", 1999], ["2004-05-06", 2004], [2010, 2010], ["", null], [undefined, null], ["99", null], ["20045", null], ["0000", null]]) {
    year = value;
    assert.equal((await readMetadata({})).year, expected, `year tag ${String(value)}`);
  }
});
