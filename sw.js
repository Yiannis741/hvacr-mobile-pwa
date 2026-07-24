// Ελάχιστο service worker — μόνο για να είναι "installable" το PWA (Add to Home Screen).
// Δεν κάνει καθόλου caching των Google API κλήσεων (πάντα ζωντανά δεδομένα).
//
// ΣΗΜΑΝΤΙΚΟ: network-first (όχι cache-first) για τα δικά μας αρχεία shell, ώστε κάθε
// νέα έκδοση που ανεβαίνει στο GitHub Pages να φτάνει αμέσως στο κινητό όσο υπάρχει
// σύνδεση — το cache χρησιμεύει μόνο ως fallback όταν δεν υπάρχει δίκτυο.
// Αν ποτέ χρειαστεί να αλλάξει η στρατηγική, ανέβασε και ΝΕΟ όνομα cache (HV_CACHE) —
// αλλιώς οι φυλλομετρητές δεν ξαναβλέπουν καν αυτό το ίδιο το sw.js ως "αλλαγμένο".
const HV_CACHE = "hvacr-shell-v12";
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
    caches.open(HV_CACHE).then((cache) =>
      Promise.all(HV_SHELL_FILES.map((url) => fetch(url, { cache: "reload" }).then((r) => cache.put(url, r)).catch(() => {})))
    )
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
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(HV_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
