// The service worker that lets the installed app start without a connection. Network first: the app's own files are
// fetched as usual (so a new version shows on the next load) and a copy is kept, which is used only when offline.
// Music never passes through here; it's read from disk with the File System Access API.

const CACHE = "music-player";
// What the app needs to start; the 3D visualizer (dist/terrain.js) is kept once it has been used.
const SHELL = ["./", "./index.html", "./dist/app.js", "./dist/styles.css", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    }
  })());
});
