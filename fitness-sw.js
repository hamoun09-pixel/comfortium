/* Service worker FitCoach — portée limitée à /fitness.html */
const CACHE = "fitcoach-v2";
const ASSETS = ["/fitness.html", "/fitness.webmanifest", "/fitness-icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Page : réseau d'abord (pour recevoir les mises à jour), cache en secours (hors-ligne)
  if (e.request.mode === "navigate" || url.pathname === "/fitness.html") {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put("/fitness.html", r.clone())); return r; })
        .catch(() => caches.match("/fitness.html"))
    );
    return;
  }
  // Ressources : cache d'abord
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }))
  );
});
