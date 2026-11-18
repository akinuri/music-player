const FLAKE_DENSITY = 1 / 14000; // flakes per px²
const MAX_FLAKES = 140;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const STORAGE_KEY = "snow";

let canvas = null;
let context = null;
let flakes = [];
let frame = 0;
let last = 0;

function makeFlake(width, height, anywhere) {
  return {
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : -8,
    radius: 1 + Math.random() * 2.4,
    speed: 22 + Math.random() * 38,
    drift: 8 + Math.random() * 14,
    phase: Math.random() * Math.PI * 2,
  };
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const wanted = Math.min(MAX_FLAKES, Math.round(window.innerWidth * window.innerHeight * FLAKE_DENSITY));
  while (flakes.length < wanted) flakes.push(makeFlake(window.innerWidth, window.innerHeight, true));
  flakes.length = Math.min(flakes.length, wanted);
}

function tick(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgb(255 255 255 / 0.85)";
  for (const flake of flakes) {
    flake.y += flake.speed * dt;
    flake.phase += dt;
    flake.x += Math.sin(flake.phase) * flake.drift * dt;
    if (flake.y > height + 8) Object.assign(flake, makeFlake(width, height, false));
    if (flake.x < -8) flake.x = width + 8;
    else if (flake.x > width + 8) flake.x = -8;
    context.beginPath();
    context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
    context.fill();
  }
  frame = requestAnimationFrame(tick);
}

function stopLoop() {
  cancelAnimationFrame(frame);
  frame = 0;
}

function startLoop() {
  if (frame || document.hidden) return;
  last = performance.now();
  frame = requestAnimationFrame(tick);
}

export function startSnow() {
  if (canvas || window.matchMedia(REDUCED_MOTION).matches) return;
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:50";
  document.body.append(canvas);
  context = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  startLoop();
}

export function stopSnow() {
  if (!canvas) return;
  stopLoop();
  window.removeEventListener("resize", resize);
  document.removeEventListener("visibilitychange", onVisibility);
  canvas.remove();
  canvas = context = null;
  flakes = [];
}

function onVisibility() {
  if (document.hidden) stopLoop();
  else startLoop();
}

let enabled = true;

export function snowEnabled() {
  return enabled;
}

export function setSnowEnabled(value) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts until reload.
  }
  document.dispatchEvent(new CustomEvent("snowchange"));
}

// Snow only falls in the Christmas theme, when the user has not turned it off, and not with reduced motion.
export function initSnow() {
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabled = true;
  }
  const sync = () => (enabled && document.documentElement.dataset.theme === "christmas" ? startSnow() : stopSnow());
  document.addEventListener("themechange", sync);
  document.addEventListener("snowchange", sync);
  window.matchMedia(REDUCED_MOTION).addEventListener("change", event => {
    if (event.matches) stopSnow();
    else sync();
  });
  sync();
}
