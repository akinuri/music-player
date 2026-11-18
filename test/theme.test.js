import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PREFERENCE, normalizePreference, readPreference, resolveTheme } from "../src/theme.js";

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
  assert.equal(normalizePreference("system"), "system");
  assert.equal(normalizePreference("purple"), DEFAULT_PREFERENCE);
  assert.equal(normalizePreference(null), DEFAULT_PREFERENCE);
});

test("readPreference reads storage and survives a failing one", () => {
  assert.equal(readPreference({ getItem: () => "dark" }), "dark");
  assert.equal(readPreference({ getItem: () => null }), DEFAULT_PREFERENCE);
  assert.equal(readPreference({ getItem() { throw new Error("denied"); } }), DEFAULT_PREFERENCE);
});

test("readPreference survives a localStorage global that throws on access", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  try {
    assert.equal(readPreference(), "system");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});
