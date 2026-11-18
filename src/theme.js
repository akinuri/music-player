export const THEME_PREFERENCES = ["system", "light", "dark", "christmas"];
// Seasonal default: first-time visitors get the winter theme. Change this one line to ship another default.
export const DEFAULT_PREFERENCE = "christmas";
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const META_COLORS = { light: "#e6eaed", dark: "#0f1517", christmas: "#0e1410" };

// "christmas" never comes from the system preference; it is the default or an explicit choice.
// Anything unknown (or no stored value) means the default preference.
export function normalizePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_PREFERENCE;
}

export function resolveTheme(preference, prefersDark) {
  const normalized = normalizePreference(preference);
  if (normalized === "system") return prefersDark ? "dark" : "light";
  return normalized;
}

export function readPreference(storage = globalThis.localStorage) {
  try {
    return normalizePreference(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function writePreference(preference, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts until reload.
  }
}

// Colors live in CSS variables as "r g b" triplets, so canvas code can read the active theme's values.
const triplets = new Map();
export function themeColor(name, alpha = 1) {
  if (!triplets.has(name)) triplets.set(name, getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim());
  return `rgb(${triplets.get(name)} / ${alpha})`;
}

let preference = DEFAULT_PREFERENCE;

export function currentPreference() {
  return preference;
}

function apply() {
  const media = window.matchMedia(DARK_QUERY);
  const theme = resolveTheme(preference, media.matches);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLORS[theme]);
  triplets.clear();
  document.dispatchEvent(new CustomEvent("themechange", { detail: { preference, theme } }));
}

export function setPreference(value) {
  preference = normalizePreference(value);
  writePreference(preference);
  apply();
}

export function initTheme() {
  preference = readPreference();
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (preference === "system") apply();
  });
  apply();
}
