const APP_CACHE = "hak-btt2-app-v5";
const DATA_CACHE = "hak-btt2-data-v5";

const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png",
  "./btt2-workspace.css",
  "./btt-time.js",
  "./btt2-drawings.js",
  "./btt2-phone.js",
  "./btt2-positions.js",
  "./btt2-workspace.js",
  "./confirmed-ranges.js",
  "./haks-ui.js",
  "./list-order.js",
  "./observations.js",
  "./position-tools.js",
  "./vendor/lightweight-charts.standalone.production.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_DATA_CACHE") {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Market data CSVs: Always try network first so newly published candles show immediately,
  // fallback to cached phone storage when offline.
  if (url.pathname.includes("/data/")) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cacheKey = url.origin + url.pathname;
        try {
          const fresh = await fetch(event.request);
          if (fresh && fresh.ok) {
            cache.put(cacheKey, fresh.clone());
            return fresh;
          }
        } catch (_) {}
        const cached = await cache.match(cacheKey) || await cache.match(event.request);
        if (cached) return cached;
        throw new Error("Offline and not cached");
      })
    );
    return;
  }

  if (url.pathname.includes("/chart/")) {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        try {
          const fresh = await fetch(event.request);
          if (fresh && fresh.ok) {
            cache.put(event.request, fresh.clone());
            return fresh;
          }
        } catch (_) {}
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw new Error("Offline");
      })
    );
  }
});
