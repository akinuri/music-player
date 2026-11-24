export const THEME_PREFERENCES = ["system", "light", "dark"];
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const META_COLORS = { light: "#e6eaed", dark: "#0f1517" };

// Anything unknown (or no stored value) means "follow the system".
export function normalizePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function resolveTheme(preference, prefersDark) {
  const normalized = normalizePreference(preference);
  if (normalized === "system") return prefersDark ? "dark" : "light";
  return normalized;
}

// Storage is resolved inside the try: merely reading globalThis.localStorage throws when site data is blocked.
export function readPreference(storage) {
  try {
    storage ??= globalThis.localStorage;
    return normalizePreference(storage?.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function writePreference(preference, storage) {
  try {
    storage ??= globalThis.localStorage;
    if (preference === "system") storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, preference);
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

// The same theme color as [r, g, b] (0-255), for code that can't take CSS color strings (WebGL).
export function themeRgb(name) {
  themeColor(name);
  return triplets.get(name).split(/\s+/).map(Number);
}

let preference = "system";

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
  // Anything that restyles <html> (e.g. a userscript setting its own data-* theme attribute) may change the
  // color variables, so drop the cached values and let canvases pick up the new ones on their next draw.
  new MutationObserver(() => triplets.clear()).observe(document.documentElement, { attributes: true });
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (preference === "system") apply();
  });
  apply();
}
