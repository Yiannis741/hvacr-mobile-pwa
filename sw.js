// Ελάχιστο service worker — μόνο για να είναι "installable" το PWA (Add to Home Screen).
// Δεν κάνει καθόλου caching των Google API κλήσεων (πάντα ζωντανά δεδομένα).
const HV_CACHE = "hvacr-shell-v1";
const HV_SHELL_FILES = [
  "./index.html",
  "./config.js",
  "./auth.js",
  "./picker.js",
  "./drive.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(HV_CACHE).then((cache) => cache.addAll(HV_SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== HV_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Ποτέ cache για Google APIs — μόνο για τα δικά μας στατικά αρχεία shell.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
