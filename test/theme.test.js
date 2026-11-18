import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreference, readPreference, resolveTheme } from "../src/theme.js";

test("resolveTheme follows the system only for the system preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("christmas", false), "christmas");
  assert.equal(resolveTheme("christmas", true), "christmas");
});

test("normalizePreference falls back to system for unknown values", () => {
  assert.equal(normalizePreference("dark"), "dark");
  assert.equal(normalizePreference("christmas"), "christmas");
  assert.equal(normalizePreference("purple"), "system");
  assert.equal(normalizePreference(null), "system");
});

test("readPreference reads storage and survives a failing one", () => {
  assert.equal(readPreference({ getItem: () => "dark" }), "dark");
  assert.equal(readPreference({ getItem: () => null }), "system");
  assert.equal(readPreference({ getItem() { throw new Error("denied"); } }), "system");
});
